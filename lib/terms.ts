// 용어 비교 엔진. Python core/terms.py 동작 재현.
// 개념 묶기는 LLM(추출 힌트), 불일치 판정은 코드가 한다.
// - 모드 A: 한 개념을 문서마다 다른 표현으로 쓰면 적발(low, 표준 미정).
// - 모드 B: 사전이 있으면 표준어 외 변형 사용 적발(medium). except_context 제외.

import { cmp } from "./normalize";
import type { ExtractedItem, Finding, Source } from "./schema";

export interface TermHit {
  term: string; // 표면 표현, 원문 그대로 ("삭제")
  concept: string; // 같은 대상을 가리키는 개념 클러스터 id ("데이터파기")
  doc: string;
  role: string; // 문서 역할 (reference 역할은 용어 정합에서 제외)
  source: Source;
}

// 용어 정합에서 제외할 역할(예: RFP). 비면 전부 비교 → 기존 동작과 동일.
export interface TermCheckOptions {
  excludeRoles?: ReadonlySet<string>;
}

export interface GlossaryEntry {
  standard?: string;
  variants?: string[];
  except_context?: string[];
}
export interface Glossary {
  terms?: GlossaryEntry[];
}

export class TermChecker {
  check(hits: TermHit[], glossary?: Glossary | null, opts?: TermCheckOptions): Finding[] {
    // reference 역할(RFP 등)은 용어 정합 비교에서 완전 제외 — 비전문 용어가 정상이므로.
    const ex = opts?.excludeRoles;
    const scoped = ex && ex.size ? hits.filter((h) => !ex.has(h.role)) : hits;
    let findings = this.checkModeA(scoped);
    if (glossary) findings = findings.concat(this.checkModeB(scoped, glossary));
    return findings;
  }

  // 모드 A: 같은 개념을 '문서마다 다르게' 쓰면 적발(문서 간 불일치만).
  checkModeA(hits: TermHit[]): Finding[] {
    const findings: Finding[] = [];
    for (const [concept, group] of this.groupByConcept(hits)) {
      // 문서별 사용 표현 모음
      const byDoc = new Map<string, Set<string>>();
      for (const h of group) {
        if (!byDoc.has(h.doc)) byDoc.set(h.doc, new Set());
        byDoc.get(h.doc)!.add(h.term);
      }

      // ① 2개 이상 문서가 있고, 어떤 두 문서가 '공통 표현이 전혀 없을 때'만 적발.
      if (byDoc.size < 2) continue;
      if (!this.hasDisjointPair([...byDoc.values()])) continue;

      const distinctTerms = new Set(group.map((h) => h.term));
      // ② 남은 것 중에서도 표현이 모두 약어↔풀이 변형이면 제외.
      if (this.allAcronymVariants(distinctTerms)) continue;

      // doc_term = {doc: "/".join(sorted(terms))}
      const docTerm = new Map<string, string>();
      for (const [doc, terms] of byDoc) {
        docTerm.set(doc, [...terms].sort(cmp).join("/"));
      }
      const sortedDocTerm = [...docTerm.entries()].sort((a, b) => cmp(a[0], b[0]));
      const actual = sortedDocTerm.map(([d, t]) => `${d}=${t}`).join(", ");
      const msg =
        `개념 '${concept}' 표현이 문서마다 갈림: ` +
        sortedDocTerm.map(([d, t]) => `${d}「${t}」`).join(", ") +
        " (표준은 사람이 결정)";
      findings.push({
        rule_id: `term-split:${concept}`,
        type: "term",
        severity: "low",
        docs: [...byDoc.keys()].sort(cmp),
        locations: group.map((h) => h.source),
        expected: "문서 간 표현 일치",
        actual,
        message: msg,
      });
    }
    return findings;
  }

  // 모드 B: 사전 표준어 외 변형 사용 적발. except_context면 제외.
  checkModeB(hits: TermHit[], glossary: Glossary): Finding[] {
    const findings: Finding[] = [];
    for (const entry of glossary.terms ?? []) {
      const standard = entry.standard;
      const variants = new Set(entry.variants ?? []);
      const excepts = entry.except_context ?? [];
      for (const h of hits) {
        if (!variants.has(h.term)) continue;
        if (excepts.some((ex) => h.source.snippet.includes(ex))) continue; // 동음이의 예외
        findings.push({
          rule_id: `glossary:${standard}`,
          type: "term",
          severity: "medium",
          docs: [h.doc],
          locations: [h.source],
          expected: String(standard),
          actual: h.term,
          message: `표준어 '${standard}' 대신 '${h.term}' 사용 (${h.doc})`,
        });
      }
    }
    return findings;
  }

  private groupByConcept(hits: TermHit[]): Map<string, TermHit[]> {
    const groups = new Map<string, TermHit[]>();
    for (const h of hits) {
      if (!groups.has(h.concept)) groups.set(h.concept, []);
      groups.get(h.concept)!.push(h);
    }
    return groups;
  }

  // 어떤 두 문서가 공통 표현을 하나도 안 쓰는가(완전히 다른 단어를 쓰는가).
  private hasDisjointPair(docTermSets: Set<string>[]): boolean {
    for (let i = 0; i < docTermSets.length; i++) {
      for (let j = i + 1; j < docTermSets.length; j++) {
        if (isDisjoint(docTermSets[i], docTermSets[j])) return true;
      }
    }
    return false;
  }

  // 표현들이 모두 약어↔풀이 변형인가(둘씩 보아 한쪽이 다른 쪽의 약어).
  private allAcronymVariants(terms: Set<string>): boolean {
    const ts = [...terms].sort(cmp);
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        if (!acronymPair(ts[i], ts[j])) return false;
      }
    }
    return true;
  }
}

function isDisjoint(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return false;
  return true;
}

// 한쪽이 다른 쪽의 약어/풀이인지. 영문 머리글자 또는 괄호 약어 표기를 본다.
export function acronymPair(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const s = short.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (s.length >= 2 && s.length <= 8) {
    // 풀이의 영문 단어 머리글자 == 약어
    const words = long.match(/[A-Za-z]+/g) ?? [];
    const initials = words.map((w) => w[0]).join("").toUpperCase();
    if (s && s === initials) return true;
    // "정보보호최고책임자(CISO)" 처럼 괄호 안에 약어가 박힌 경우
    const re = new RegExp("\\(\\s*" + escapeRegex(short.trim()) + "\\s*\\)");
    if (re.test(long)) return true;
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildTermHits(items: ExtractedItem[]): TermHit[] {
  const hits: TermHit[] = [];
  for (const it of items) {
    if (it.field !== "term") continue;
    const concept = it.key || String(it.value); // 힌트 없으면 표현 자체를 개념으로
    hits.push({ term: String(it.value), concept, doc: it.doc, role: it.role, source: it.source });
  }
  return hits;
}
