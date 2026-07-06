// 파이프라인: load → extract → normalize → check → report.
// Python core/pipeline.py 의 검사 순서·로직을 그대로 재현한다.
// 전부 브라우저에서 동작(서버로 문서 안 보냄).
import { type ProperNoun, REFERENCE_ROLES, STANDARD_TERMS } from "./config";
import { Extractor } from "./extractor";
import type { LLMProvider } from "./llm/base";
import { parseDoc, type ParsedDoc } from "./loader";
import { autoValueConsistency, build, Model } from "./normalize";
import { buildPayload, sortFindings, type Payload, type ReportMeta } from "./report";
import { RuleEngine } from "./rules/engine";
import type { ExtractedItem, Finding, RuleSpec, Source } from "./schema";
import { buildTermHits, TermChecker, type Glossary } from "./terms";

export interface InputDoc {
  file: string; // 파일명
  role: string; // general 기본
  data: ArrayBuffer; // docx 바이트(브라우저 메모리)
}

export interface ProgressEvent {
  frac: number;
  label: string;
}

export interface PipelineResult {
  findings: Finding[];
  model: Model;
  errors: Array<{ file?: string; error?: string }>;
  skipped: Array<[string, string]>;
  meta: ReportMeta;
  payload: Payload;
  // 문서별 추출 JSON(캐시 저장/다운로드용) — Python out/extracted/*.json 과 동일 구조
  extractedByDoc: Array<{ name: string; items: Record<string, unknown>[] }>;
}

export class Pipeline {
  private extractor: Extractor;
  private engine: RuleEngine;
  private terms: TermChecker;

  constructor(provider: LLMProvider) {
    this.extractor = new Extractor(provider);
    this.engine = new RuleEngine();
    this.terms = new TermChecker();
  }

  async run(
    documents: InputDoc[],
    rules: RuleSpec[],
    glossary: Glossary | null,
    opts: {
      onProgress?: (e: ProgressEvent) => void;
      generatedAt?: string;
      auditStandard?: boolean;
      detectTypos?: boolean;
      properNouns?: ProperNoun[]; // 회사명(수행사 고정 + 런타임 고객사) — 표기 통일 검사·오타 제외용
    } = {}
  ): Promise<PipelineResult> {
    const emit = (frac: number, label: string) => {
      if (opts.onProgress) opts.onProgress({ frac: Math.max(0, Math.min(1, frac)), label });
    };

    // 1) 모든 문서 파싱(빠름) + 총 LLM 호출 수 집계
    emit(0, "문서 읽는 중…");
    const parsedDocs: Array<{ d: InputDoc; parsed: ParsedDoc }> = [];
    const errors: Array<{ file?: string; error?: string }> = [];
    for (const d of documents) {
      try {
        const parsed = await parseDoc(d.file, d.data, d.role);
        parsedDocs.push({ d, parsed });
      } catch (e) {
        errors.push({ file: d.file, error: (e as Error).message });
      }
    }

    const totalChunks = parsedDocs.reduce((acc, { parsed }) => acc + this.extractor.chunkCount(parsed), 0);
    const totalUnits = totalChunks + 2; // +검사 +대시보드
    let done = 0;

    // 2) 문서별 추출(청크마다 진행률 +1)
    const extracted: ExtractedItem[][] = [];
    const extractedByDoc: Array<{ name: string; items: Record<string, unknown>[] }> = [];
    for (const { d, parsed } of parsedDocs) {
      const name = d.file;
      emit(done / totalUnits, `추출 중: ${name}`);
      try {
        const items = await this.extractor.extract(
          parsed,
          () => {
            done += 1;
            emit(done / totalUnits, `추출 중: ${name}`);
          },
          opts.detectTypos,
          opts.properNouns
        );
        extracted.push(items);
        extractedByDoc.push({ name: safeName(stem(name)), items: items.map((it) => this.extractor.itemDict(it)) });
      } catch (e) {
        errors.push({ file: d.file, error: (e as Error).message });
      }
    }

    const model = build(withDerivedFields(extracted));

    // 3) 검사 — Python 과 동일 순서
    emit((totalChunks + 1) / totalUnits, "정합성 검사 중…");
    let findings: Finding[] = [];
    // (a) 자동 비교: 용어 갈림(모드A) + 사전(모드B, 있으면). reference 역할(RFP)은 제외.
    findings = findings.concat(
      this.terms.check(buildTermHits(model.items), glossary, { excludeRoles: REFERENCE_ROLES })
    );
    // (b) value_match 룰이 '실제로 동작할 때만' 그 키를 자동 비교에서 제외(중복 방지)
    const presentRoles = model.roles();
    const matchKeys = new Set<string>();
    for (const r of rules) {
      const across: string[] = r.must_equal_across ?? [];
      if (
        r.type === "value_match" &&
        r.key &&
        across.length > 0 &&
        across.every((role) => presentRoles.has(role))
      ) {
        matchKeys.add(r.key);
      }
    }
    findings = findings.concat(autoValueConsistency(model, matchKeys, REFERENCE_ROLES));
    // (c) 역할 기반 룰(연계/종속/자산 + 명시 수치). 역할/필드 없으면 스킵.
    findings = findings.concat(this.engine.runAll(rules, model));
    // (d) 표준 용어 의미비교(옵션, LLM 1회) — 비표준 표기 적발. reference 역할은 제외.
    if (opts.auditStandard) {
      emit((totalChunks + 1.5) / totalUnits, "표준 용어 점검 중…");
      findings = findings.concat(await this.auditStandardTerms(model));
    }
    // (e) 오타 — 추출 시 모은 typo 항목을 finding 으로(detectTypos 켰을 때만 존재).
    findings = findings.concat(typoFindings(model, opts.properNouns ?? []));
    // (f) 고유명사 오기 — 표준(canonical)과 한 글자만 다른 근접표기를 코드가 확정 적발.
    findings = findings.concat(properNounMisspellings(model, opts.properNouns ?? []));

    const meta: ReportMeta = {
      title: "문서 정합성 검사 결과",
      docs: documents.map((d) => d.file),
      generated_at: opts.generatedAt,
      errors,
      skipped_rules: this.engine.skipped,
    };
    emit((totalChunks + 2) / totalUnits, "대시보드 생성 중…");
    const payload = buildPayload(findings, meta);
    emit(1, "완료");

    return {
      findings: sortFindings(findings),
      model,
      errors,
      skipped: this.engine.skipped,
      meta,
      payload,
      extractedByDoc,
    };
  }

  // 표준 용어 의미비교(LLM 1회) → 비표준 표기 Finding. 실패해도 전체 중단 금지(빈 배열).
  private async auditStandardTerms(model: Model): Promise<Finding[]> {
    const termItems = model.items.filter((it) => it.field === "term" && !REFERENCE_ROLES.has(it.role));
    const distinct = [...new Set(termItems.map((it) => String(it.value)))];
    let pairs: Array<{ used: string; standard: string }> = [];
    try {
      pairs = await this.extractor.auditStandardTerms(distinct, STANDARD_TERMS);
    } catch (e) {
      console.warn(`표준 용어 점검 실패: ${(e as Error).message}`);
      return [];
    }
    const stdByUsed = new Map(pairs.map((p) => [p.used, p.standard]));
    // (문서, 사용표현)별로 묶어 한 건씩 적발 — 출처는 그 표현이 나온 위치들.
    const byKey = new Map<string, { doc: string; used: string; standard: string; locs: Source[] }>();
    for (const it of termItems) {
      const used = String(it.value);
      const standard = stdByUsed.get(used);
      if (!standard) continue;
      const k = `${it.doc}||${used}`;
      if (!byKey.has(k)) byKey.set(k, { doc: it.doc, used, standard, locs: [] });
      byKey.get(k)!.locs.push(it.source);
    }
    return [...byKey.values()].map((v) => ({
      rule_id: `standard-term:${v.standard}`,
      type: "term",
      severity: "medium",
      docs: [v.doc],
      locations: v.locs,
      expected: v.standard,
      actual: v.used,
      message: `공식 표준어 '${v.standard}' 대신 '${v.used}' 사용 (${v.doc})`,
    }));
  }
}

// 검사만 따로 — 캐시된 추출 결과(ExtractedItem[][])로 재검사. Python rebuild_from_cache.py 동등.
// (패리티 검증과 '룰만 바꿔 즉시 갱신'에 사용. LLM 호출 없음.)
export function runChecksOnly(
  extracted: ExtractedItem[][],
  rules: RuleSpec[],
  glossary: Glossary | null,
  meta: Partial<ReportMeta> = {},
  properNouns: ProperNoun[] = []
): { findings: Finding[]; skipped: Array<[string, string]>; payload: Payload; model: Model } {
  const model = build(withDerivedFields(extracted));
  const terms = new TermChecker();
  const engine = new RuleEngine();

  let findings: Finding[] = [];
  findings = findings.concat(
    terms.check(buildTermHits(model.items), glossary, { excludeRoles: REFERENCE_ROLES })
  );
  const presentRoles = model.roles();
  const matchKeys = new Set<string>();
  for (const r of rules) {
    const across: string[] = r.must_equal_across ?? [];
    if (r.type === "value_match" && r.key && across.length > 0 && across.every((role) => presentRoles.has(role))) {
      matchKeys.add(r.key);
    }
  }
  findings = findings.concat(autoValueConsistency(model, matchKeys, REFERENCE_ROLES));
  findings = findings.concat(engine.runAll(rules, model));
  findings = findings.concat(properNounMisspellings(model, properNouns));

  const fullMeta: ReportMeta = {
    title: "문서 정합성 검사 결과",
    docs: [...new Set(model.items.map((it) => it.doc))],
    errors: [],
    skipped_rules: engine.skipped,
    ...meta,
  };
  const payload = buildPayload(findings, fullMeta);
  return { findings, skipped: engine.skipped, payload, model };
}

// 추출 시 모은 오타(field="typo") 항목을 Finding 으로 변환. reference 역할(RFP)은 제외.
// (문서, 원문표기)별로 묶어 한 건씩. value=원문오타, key=교정안.
function typoFindings(model: Model, properNouns: ProperNoun[]): Finding[] {
  // reference 역할(RFP) 제외 + 회사명(수행사·고객사) 표준 표기 과탐 제거.
  const canon = new Set(properNouns.map((p) => p.canonical.trim()));
  const items = model.items.filter(
    (it) =>
      it.field === "typo" &&
      !REFERENCE_ROLES.has(it.role) &&
      !canon.has(String(it.value).trim())
  );
  const byKey = new Map<string, { doc: string; wrong: string; fix: string; locs: Source[] }>();
  for (const it of items) {
    const wrong = String(it.value);
    const fix = it.key ? String(it.key) : "";
    const k = `${it.doc}||${wrong}`;
    if (!byKey.has(k)) byKey.set(k, { doc: it.doc, wrong, fix, locs: [] });
    byKey.get(k)!.locs.push(it.source);
  }
  return [...byKey.values()].map((v) => ({
    rule_id: `typo:${v.wrong}`,
    type: "typo",
    severity: "low",
    docs: [v.doc],
    locations: v.locs,
    expected: v.fix || "(교정안 없음)",
    actual: v.wrong,
    message: `오타 의심: '${v.wrong}'${v.fix ? ` → '${v.fix}'` : ""} (${v.doc})`,
  }));
}

// 고유명사(회사명 등) 오기 적발. 표준 표기(canonical)와 '한 글자만 다른' 근접표기를 코드가 확정 적발한다.
// 모드 A(문서 간 갈림)는 문서끼리 다를 때만 잡지만, 이 검사는 표준을 config가 이미 알기에
// 모든 문서가 똑같이 틀린 경우까지 잡는다. LLM 판정 없음 — canonical 길이 창을 훑어 편집거리 1을 센다.
export function properNounMisspellings(model: Model, properNouns: ProperNoun[]): Finding[] {
  const canons = properNouns
    .map((p) => ({ canonical: p.canonical.trim(), label: p.label }))
    // 3글자 미만은 한 글자 차이가 우연히 겹칠 위험이 커서 제외.
    .filter((p) => Array.from(p.canonical).length >= 3);
  if (!canons.length) return [];

  // (문서, 표준, 오기표기)별로 묶어 한 건. 출처는 그 오기가 나온 위치들.
  const byKey = new Map<string, { doc: string; canonical: string; wrong: string; label: string; locs: Source[] }>();
  for (const it of model.items) {
    if (REFERENCE_ROLES.has(it.role)) continue; // 참조문서(RFP)는 자기 표기 존중
    const texts = [String(it.value), it.source.snippet].filter(Boolean);
    for (const { canonical, label } of canons) {
      const wrongs = new Set<string>();
      for (const t of texts) collectNearMisses(t, canonical, wrongs);
      for (const wrong of wrongs) {
        const k = `${it.doc}||${canonical}||${wrong}`;
        if (!byKey.has(k)) byKey.set(k, { doc: it.doc, canonical, wrong, label, locs: [] });
        byKey.get(k)!.locs.push(it.source);
      }
    }
  }
  return [...byKey.values()].map((v) => ({
    rule_id: `proper-noun:${v.canonical}`,
    type: "term",
    severity: "medium",
    docs: [v.doc],
    locations: v.locs,
    expected: v.canonical,
    actual: v.wrong,
    message: `${v.label} 고유명사 '${v.canonical}'을(를) '${v.wrong}'(으)로 잘못 표기 (${v.doc})`,
  }));
}

// t 안에서 canonical 과 길이가 같고 딱 한 글자만 다른 조각(오기 후보)을 모은다. 정확 일치는 제외.
function collectNearMisses(t: string, canonical: string, out: Set<string>): void {
  const C = Array.from(canonical);
  const T = Array.from(t);
  const L = C.length;
  for (let i = 0; i + L <= T.length; i++) {
    let diff = 0;
    for (let j = 0; j < L && diff <= 1; j++) {
      if (T[i + j] !== C[j]) diff++;
    }
    if (diff === 1) out.add(T.slice(i, i + L).join(""));
  }
}

// 판정(verdict) 항목의 통제항목번호를 '평가통제항목ID' 필드로도 노출(코드 파생, LLM 재추출 없음).
// → "수준평가 평가항목 ⊆ 법령매핑 통제번호", "개선과제 ⊆ 수준평가 평가항목" 같은 추적 룰의 source/target 가 된다.
// 단, key 가 통제번호 형태(1.1.1)일 때만 파생한다. 문서에 판정표가 없어 LLM이 '4.3 개인정보…'
// 같은 절 제목을 판정으로 잘못 뽑으면, 그걸 평가항목으로 삼아 추적 룰이 대량 오탐을 내기 때문.
// (판정이 하나도 안 나오면 추적 룰은 'target 값 없음 → 검사 불가'로 깨끗이 스킵된다.)
const CONTROL_NO_RE = /^\s*\d+\.\d+\.\d+/;
function withDerivedFields(extracted: ExtractedItem[][]): ExtractedItem[][] {
  return extracted.map((group) => {
    const extra: ExtractedItem[] = [];
    for (const it of group) {
      if (it.field === "verdict" && it.key && CONTROL_NO_RE.test(String(it.key))) {
        extra.push({ ...it, field: "평가통제항목ID", key: null, value: String(it.key) });
      }
    }
    return extra.length ? [...group, ...extra] : group;
  });
}

function stem(name: string): string {
  const base = name.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

// Python _safe_name: 공백/특수문자 → _, 한글 유지
function safeName(s: string): string {
  const out = s.replace(/[^\w가-힣.-]+/gu, "_").replace(/^_+|_+$/g, "");
  return out || "doc";
}
