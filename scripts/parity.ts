// 패리티 검증: TS 엔진이 Python 구현과 동일한 Finding을 내는지 확인한다.
// (1) Python 단위테스트(test_rules / test_auto / test_terms) 포팅 → 동일 단정.
// (2) 실데이터: Python 추출 캐시(~/DocConsistencyChecker/out/extracted/*.json)로
//     runChecksOnly 실행 → Python rebuild_from_cache.py 와 같은 1건(term-split:발주기관) 기대.
//
// 실행: npm run parity   (tsx, Node 18)
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { Model, autoValueConsistency, build } from "../lib/normalize";
import { TermChecker, type TermHit } from "../lib/terms";
import { RuleEngine } from "../lib/rules/engine";
import { runChecksOnly, properNounMisspellings } from "../lib/pipeline";
import { locAnchor } from "../lib/report";
import { GLOSSARY_DEFAULT } from "../lib/config";
import type { ExtractedItem, Source } from "../lib/schema";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ FAIL: ${name}`);
  }
}
function eq(a: unknown, b: unknown, name: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

const src = (doc: string, sec = "1", para = 0, snip = ""): Source => ({
  doc,
  section: sec,
  para_index: para,
  snippet: snip || doc,
});
const num = (role: string, key: string, val: any, doc: string): ExtractedItem => ({
  doc,
  role,
  field: "number",
  key,
  value: val,
  source: src(doc),
});
const verdict = (key: string, val: any, doc = "GAP.docx"): ExtractedItem => ({
  doc,
  role: "gap",
  field: "verdict",
  key,
  value: val,
  source: src(doc),
});
const fieldItem = (role: string, fname: string, val: any, doc: string): ExtractedItem => ({
  doc,
  role,
  field: fname,
  key: null,
  value: val,
  source: src(doc),
});
const hit = (term: string, concept: string, doc: string): TermHit => ({
  term,
  concept,
  doc,
  role: "general", // deliverable — 용어 정합 비교 대상(기존 동작과 동일)
  source: src(doc, "3.2", 50, `...${term} 절차...`),
});

// ───────── test_rules.py ─────────
console.log("\n[test_rules.py]");
{
  // T1: 미흡건수 169 vs 168
  let m = new Model([num("status_report", "미흡건수", 169, "현황.docx"), num("gap", "미흡건수", 168, "GAP.docx")]);
  let f = new RuleEngine().run({ id: "count-match", type: "value_match", key: "미흡건수", must_equal_across: ["status_report", "gap"] }, m);
  ok(f.length === 1 && f[0].type === "value" && f[0].severity === "high", "T1 value_match mismatch");

  // value_match ok
  m = new Model([num("status_report", "미흡건수", 169, "현황.docx"), num("gap", "미흡건수", 169, "GAP.docx")]);
  eq(new RuleEngine().run({ id: "count-match", type: "value_match", key: "미흡건수", must_equal_across: ["status_report", "gap"] }, m), [], "value_match ok");

  // T2: formula fail
  m = new Model([num("status_report", "미흡건수", 169, "현황.docx"), num("status_report", "미흡", 140, "현황.docx"), num("status_report", "취약", 28, "현황.docx")]);
  f = new RuleEngine().run({ id: "count-formula", type: "value_formula", expr: "미흡건수 == 미흡 + 취약" }, m);
  ok(f.length === 1 && f[0].message.includes("검산"), "T2 formula fail");

  // formula ok
  m = new Model([num("status_report", "미흡건수", 169, "현황.docx"), num("status_report", "미흡", 140, "현황.docx"), num("status_report", "취약", 29, "현황.docx")]);
  eq(new RuleEngine().run({ id: "count-formula", type: "value_formula", expr: "미흡건수 == 미흡 + 취약" }, m), [], "formula ok");

  // T3: cross_ref missing
  m = new Model([fieldItem("gap", "미흡항목ID", "2.6.1", "GAP.docx"), fieldItem("gap", "미흡항목ID", "2.7.1", "GAP.docx"), fieldItem("plan", "이행과제대상ID", "2.7.1", "이행.docx")]);
  f = new RuleEngine().run({ id: "gap-to-plan", type: "cross_reference", source: { role: "gap", field: "미흡항목ID" }, target: { role: "plan", field: "이행과제대상ID" }, relation: "subset" }, m);
  ok(f.length === 1 && f[0].actual.includes("2.6.1"), "T3 cross_ref missing");

  // T4: structural dependency
  m = new Model([verdict("2.6", "P"), verdict("2.6.1", "Y")]);
  f = new RuleEngine().run({ id: "parent-child", type: "dependency", mode: "structural" }, m);
  ok(f.length === 1 && f[0].message.includes("구조적 종속"), "T4 structural dependency");

  // structural ok
  m = new Model([verdict("2.6", "Y"), verdict("2.6.1", "Y")]);
  eq(new RuleEngine().run({ id: "parent-child", type: "dependency", mode: "structural" }, m), [], "structural ok");

  // semantic dependency
  m = new Model([verdict("1.2", "N"), verdict("1.3", "Y")]);
  f = new RuleEngine().run({ id: "risk-to-control", type: "dependency", mode: "semantic", if: { item: "1.2", verdict: "N" }, then_not: { item: "1.3", verdict: "Y" } }, m);
  ok(f.length === 1 && f[0].message.includes("의미적 종속"), "semantic dependency");

  // subset asset missing
  m = new Model([fieldItem("risk", "대표자산", "DB서버", "위험.docx"), fieldItem("asset", "자산명", "웹서버", "자산.docx")]);
  f = new RuleEngine().run({ id: "asset-subset", type: "subset", source: { role: "risk", field: "대표자산" }, target: { role: "asset", field: "자산명" } }, m);
  ok(f.length === 1 && f[0].actual.includes("DB서버"), "subset asset missing");

  // subset ignore: 서술문 조각은 비교에서 제외 → 진짜 누락(DB서버)만 적발
  m = new Model([
    fieldItem("risk", "대표자산", "DB서버", "위험.docx"),
    fieldItem("risk", "대표자산", "20개 대표 자산([표 14] 참조)", "위험.docx"),
    fieldItem("risk", "대표자산", "감사 대상 전 자산", "위험.docx"),
    fieldItem("asset", "자산명", "웹서버", "자산.docx"),
  ]);
  f = new RuleEngine().run(
    { id: "asset-subset-ignore", type: "subset", source: { role: "risk", field: "대표자산" }, target: { role: "asset", field: "자산명" }, ignore: ["참조", "\\[표", "대상\\s*전\\s*자산"] },
    m
  );
  ok(f.length === 1 && f[0].actual.includes("DB서버") && !f[0].actual.includes("참조") && !f[0].actual.includes("전 자산"), "subset ignore: 서술문 조각 제외");

  // value_match role-free across docs
  m = new Model([
    { doc: "보고서.docx", role: "general", field: "number", key: "보안수준", value: "69.9%", source: src("보고서.docx") },
    { doc: "계획서.docx", role: "general", field: "number", key: "보안수준", value: "72.0%", source: src("계획서.docx") },
  ]);
  f = new RuleEngine().run({ id: "보안수준-일치", type: "value_match", key: "보안수준", must_equal_across: ["general"] }, m);
  ok(f.length === 1 && f[0].message.includes("보안수준"), "value_match role-free across docs");

  // value_match equal ignores space
  m = new Model([
    { doc: "A.docx", role: "general", field: "number", key: "평가평균", value: "69.9%", source: src("A.docx") },
    { doc: "B.docx", role: "general", field: "number", key: "평가평균", value: "69.9 %", source: src("B.docx") },
  ]);
  eq(new RuleEngine().run({ id: "평가평균-일치", type: "value_match", key: "평가평균", must_equal_across: ["general"] }, m), [], "value_match equal ignores space");

  // cross_ref absent target skipped
  m = new Model([fieldItem("gap", "미흡항목ID", "2.6.1", "GAP.docx")]);
  const eng = new RuleEngine();
  eq(eng.run({ id: "gap-to-plan", type: "cross_reference", source: { role: "gap", field: "미흡항목ID" }, target: { role: "plan", field: "이행과제대상ID" }, relation: "subset" }, m), [], "cross_ref absent target → skipped");
  ok(eng.skipped.length > 0 && eng.skipped[0][0] === "gap-to-plan", "cross_ref skipped recorded");

  // rule skipped when missing
  m = new Model([num("gap", "미흡건수", 1, "GAP.docx")]);
  const eng2 = new RuleEngine();
  eq(eng2.run({ id: "count-match", type: "value_match", key: "미흡건수", must_equal_across: ["status_report", "gap"] }, m), [], "value_match missing → skipped");
  ok(eng2.skipped.length > 0 && eng2.skipped[0][0] === "count-match", "value_match skipped recorded");

  // [보강] 세부번호 정규화(control_no): 2.5.1-1 ⊆ {2.5.1} 는 누락 아님
  const traceSpec = (extra: Record<string, any> = {}) => ({
    id: "추적", type: "cross_reference",
    source: { role: "task_def", field: "개선대상통제항목ID" },
    target: { role: "level_eval", field: "평가통제항목ID" },
    relation: "subset", ...extra,
  });
  m = new Model([
    fieldItem("task_def", "개선대상통제항목ID", "2.5.1-1", "개선.docx"),
    fieldItem("task_def", "개선대상통제항목ID", "2.6.1-2", "개선.docx"),
    fieldItem("level_eval", "평가통제항목ID", "2.5.1", "수준.docx"),
    fieldItem("level_eval", "평가통제항목ID", "2.6.1", "수준.docx"),
  ]);
  eq(new RuleEngine().run(traceSpec({ normalize: "control_no" }), m), [], "normalize control_no: 세부번호는 통제번호로 축약해 누락 아님");

  // 정규화해도 진짜 누락은 통제번호 단위로 적발
  m = new Model([
    fieldItem("task_def", "개선대상통제항목ID", "2.5.1-1", "개선.docx"),
    fieldItem("task_def", "개선대상통제항목ID", "2.9.9-1", "개선.docx"),
    fieldItem("level_eval", "평가통제항목ID", "2.5.1", "수준.docx"),
  ]);
  f = new RuleEngine().run(traceSpec({ normalize: "control_no" }), m);
  ok(f.length === 1 && f[0].actual.includes("2.9.9") && !f[0].actual.includes("2.9.9-1"), "normalize control_no: 진짜 누락은 통제번호로 적발");

  // normalize 미지정이면 기존대로 세부번호 그대로 비교 → 누락(하위호환)
  m = new Model([
    fieldItem("task_def", "개선대상통제항목ID", "2.5.1-1", "개선.docx"),
    fieldItem("level_eval", "평가통제항목ID", "2.5.1", "수준.docx"),
  ]);
  ok(new RuleEngine().run(traceSpec(), m).length === 1, "normalize 미지정: 기존대로 세부번호 그대로 비교");

  // [보강] value_sum_match: 카드별 수치 합 != 기준 → 적발
  const sumSpec = (sumKey: string, eqKey: string) => ({
    id: "카드합", type: "value_sum_match",
    sum: { role: "task_def", key: sumKey }, equals: { role: "risk_eval", key: eqKey },
  });
  m = new Model([
    num("task_def", "관리체계카드미흡건수", 30, "개선.docx"),
    num("task_def", "관리체계카드미흡건수", 7, "개선.docx"),
    num("task_def", "관리체계카드미흡건수", 144, "개선.docx"), // 합 181
    num("risk_eval", "미부분이행건수", 161, "위험.docx"),
  ]);
  f = new RuleEngine().run(sumSpec("관리체계카드미흡건수", "미부분이행건수"), m);
  ok(f.length === 1 && f[0].type === "value" && f[0].message.includes("181") && f[0].message.includes("161"), "value_sum_match: 카드합 181 ≠ 161 적발");

  // 합 == 기준 → 통과(오탐 없음)
  m = new Model([
    num("task_def", "자산취약점카드미흡건수", 100, "개선.docx"),
    num("task_def", "자산취약점카드미흡건수", 117, "개선.docx"), // 합 217
    num("risk_eval", "노출위험건수", 217, "위험.docx"),
  ]);
  eq(new RuleEngine().run(sumSpec("자산취약점카드미흡건수", "노출위험건수"), m), [], "value_sum_match: 합 217 == 217 통과");

  // 합산 대상(task_def)이 없으면 스킵
  m = new Model([num("risk_eval", "미부분이행건수", 161, "위험.docx")]);
  const eng3 = new RuleEngine();
  eq(eng3.run(sumSpec("관리체계카드미흡건수", "미부분이행건수"), m), [], "value_sum_match: 합산 대상 없으면 스킵");
  ok(eng3.skipped.length > 0 && eng3.skipped[0][0] === "카드합", "value_sum_match skip recorded");
}

// ───────── test_auto.py ─────────
console.log("\n[test_auto.py]");
{
  let m = new Model([num("general", "계약금액", 1000, "계약서A.docx"), num("general", "계약금액", 1200, "계약서B.docx")]);
  let f = autoValueConsistency(m);
  ok(f.length === 1 && f[0].type === "value" && f[0].severity === "high" && f[0].message.includes("계약금액") && f[0].actual.includes("1000") && f[0].actual.includes("1200"), "same key diff value across docs");

  m = new Model([num("general", "계약금액", 1000, "A.docx"), num("general", "계약금액", 1000, "B.docx")]);
  eq(autoValueConsistency(m), [], "same value no finding");

  m = new Model([num("general", "계약금액", 1000, "A.docx")]);
  eq(autoValueConsistency(m), [], "single doc not compared");

  m = new Model([num("general", "미흡건수", 169, "현황.docx"), num("general", "미흡건수", 168, "GAP.docx")]);
  eq(autoValueConsistency(m, new Set(["미흡건수"])), [], "skip_keys avoids duplicate");
  ok(autoValueConsistency(m).length === 1, "without skip_keys → 1");

  m = new Model([num("general", "총계", 40, "RFP.docx"), num("general", "총계", 5, "계획.docx")]);
  eq(autoValueConsistency(m), [], "generic label '총계' excluded");
  const m2 = new Model([num("general", "요구사항 총계", 40, "RFP.docx"), num("general", "요구사항 총계", 38, "계획.docx")]);
  ok(autoValueConsistency(m2).length === 1, "context label compared");
}

// ───────── test_terms.py ─────────
console.log("\n[test_terms.py]");
{
  const tc = new TermChecker();
  let f = tc.check([hit("파기", "데이터파기", "처리방침.docx"), hit("삭제", "데이터파기", "내부관리계획.docx")]);
  ok(f.length === 1 && f[0].type === "term" && f[0].severity === "low" && f[0].actual.includes("파기") && f[0].actual.includes("삭제"), "T5 term split detected");

  eq(tc.check([hit("삭제", "데이터파기", "처리방침.docx"), hit("삭제", "데이터파기", "내부관리계획.docx")]), [], "no split when same term");

  eq(tc.check([hit("파기", "데이터파기", "A.docx"), hit("위험", "위험도", "B.docx")]), [], "different concepts not merged");

  // T6 glossary violation
  const gloss = { terms: [{ standard: "파기", variants: ["삭제", "폐기"], except_context: ["파일 삭제", "로그 삭제"] }] };
  f = tc.check([hit("삭제", "데이터파기", "처리방침.docx"), hit("삭제", "데이터파기", "내부관리계획.docx")], gloss);
  const modeB = f.filter((x) => x.severity === "medium");
  ok(modeB.length === 2 && modeB.every((x) => x.expected === "파기" && x.actual === "삭제"), "T6 glossary violation (2 medium)");

  eq(tc.check([hit("관리체계 수립 및 운영", "영역", "보고서.docx"), hit("보호대책 요구사항", "영역", "보고서.docx"), hit("개인정보 처리 단계별 요구사항", "영역", "보고서.docx")]), [], "single-doc enumeration not flagged");

  eq(tc.check([hit("미흡", "등급", "A.docx"), hit("양호", "등급", "A.docx"), hit("미흡", "등급", "B.docx"), hit("양호", "등급", "B.docx")]), [], "same termset across docs not flagged");

  eq(tc.check([hit("DB", "데이터베이스", "계획.docx"), hit("DB", "데이터베이스", "보고서.docx"), hit("데이터베이스", "데이터베이스", "보고서.docx"), hit("데이터베이스(DB)", "데이터베이스", "보고서.docx")]), [], "shared term not flagged");
  eq(tc.check([hit("ISMS-P", "인증", "계획.docx"), hit("정보보호 및 개인정보보호 관리체계", "인증", "계획.docx"), hit("정보보호 및 개인정보보호 관리체계", "인증", "보고서.docx")]), [], "korean acronym+expansion shared not flagged");

  ok(tc.check([hit("브릿지X 머니 서비스TF", "조직명", "계획.docx"), hit("브릿지X", "조직명", "보고서.docx")]).length === 1, "disjoint terms flagged");

  eq(tc.check([hit("CISO", "책임자", "A.docx"), hit("Chief Information Security Officer", "책임자", "B.docx")]), [], "acronym expansion not flagged");
  eq(tc.check([hit("정보보호최고책임자(CISO)", "책임자", "A.docx"), hit("CISO", "책임자", "B.docx")]), [], "parenthetical acronym not flagged");

  const s: Source = { doc: "X.docx", section: "1", para_index: 1, snippet: "오래된 파일 삭제 작업" };
  eq(tc.check([{ term: "삭제", concept: "파일정리", doc: "X.docx", role: "general", source: s }], { terms: [{ standard: "파기", variants: ["삭제"], except_context: ["파일 삭제"] }] }), [], "glossary except_context");

  // ── 재설계 v2: reference 역할(RFP) 제외 ──
  const rfpHit = (term: string, concept: string, doc: string, role: string): TermHit => ({
    term, concept, doc, role, source: src(doc, "1", 1, `...${term}...`),
  });
  const EX = new Set<string>(["rfp"]);
  // RFP가 산출물과 다른 표현을 써도 제외되어 split 적발 안 됨(남은 1개 문서는 비교 불가).
  eq(
    tc.check(
      [rfpHit("없앰", "데이터파기", "RFP.docx", "rfp"), rfpHit("파기", "데이터파기", "이행계획서.docx", "plan")],
      null,
      { excludeRoles: EX }
    ),
    [],
    "reference(RFP) excluded from mode A split"
  );
  // RFP가 표준어 변형을 써도 모드B 미적발(제외).
  eq(
    tc.check([rfpHit("처리자", "개인정보처리자", "RFP.docx", "rfp")], { terms: [{ standard: "개인정보처리자", variants: ["처리자"] }] }, { excludeRoles: EX }),
    [],
    "reference(RFP) excluded from mode B glossary"
  );
  // 제외 안 하면(기존 동작) 동일 입력이 split 적발됨 → 필터가 실제로 동작함을 보장.
  ok(
    tc.check([rfpHit("없앰", "데이터파기", "A.docx", "general"), rfpHit("파기", "데이터파기", "B.docx", "plan")]).length === 1,
    "deliverable split still flagged when not excluded"
  );
}

// ───────── 위치 앵커 렌더(사람이 찾기 쉬운 좌표) ─────────
console.log("\n[locAnchor: 위치 표기]");
{
  ok(locAnchor({ doc: "위험.docx", section: "2.3", heading: "2.3 자산 식별 기준" }) === "2.3 자산 식별 기준", "docx: 제목텍스트 우선");
  ok(locAnchor({ doc: "위험.docx", section: "2.3" }) === "2.3절", "docx: 제목없으면 절번호 폴백");
  ok(locAnchor({ doc: "자산.xlsx", section: "자산목록", cell: "B12" }) === "자산목록 시트 · B12", "xlsx: 시트+셀");
  ok(locAnchor({ doc: "위험.docx", section: "5", heading: "5 자산 표", cell: "표3 · 5행 2열" }) === "5 자산 표 · 표3 · 5행 2열", "docx 표: 제목+셀");
  ok(locAnchor({ doc: "x.docx", section: "" }) === "", "앵커 없으면 빈 문자열(스니펫만)");
}

// ───────── 고유명사 오기(회사명 표준 표기) ─────────
console.log("\n[properNounMisspellings: 고유명사 오기]");
{
  const PN = [{ canonical: "컨술탄츠", label: "수행사" }];
  const item = (doc: string, role: string, value: string, snippet: string): ExtractedItem => ({
    doc, role, field: "term", key: "컨술탄츠", value,
    source: { doc, section: "1", para_index: 1, snippet },
  });

  let f = properNounMisspellings(build([[item("위험.docx", "risk_eval", "컨설탄츠", "수행사 컨설탄츠")]]), PN);
  ok(f.length === 1 && f[0].severity === "medium" && f[0].expected === "컨술탄츠" && f[0].actual === "컨설탄츠", "값이 오기 → medium 확정 적발");

  f = properNounMisspellings(build([[item("수준.docx", "level_eval", "담당자", "skshieldus.com/컨설탄츠 담당자")]]), PN);
  ok(f.length === 1 && f[0].actual === "컨설탄츠", "스니펫 속 오기(URL 조각)도 적발");

  f = properNounMisspellings(build([[item("A.docx", "plan", "컨술탄츠", "수행사 컨술탄츠 담당")]]), PN);
  ok(f.length === 0, "정확 표기(컨술탄츠)는 무탐");

  f = properNounMisspellings(build([[item("A.docx", "plan", "컨설탄츠", "컨설탄츠")], [item("B.docx", "level_eval", "컨설탄츠", "컨설탄츠")]]), PN);
  ok(f.length === 2, "모든 문서 동일 오기 → 문서별 각각 적발(모드A 사각지대 보완)");

  f = properNounMisspellings(build([[item("RFP.docx", "rfp", "컨설탄츠", "컨설탄츠")]]), PN);
  ok(f.length === 0, "참조(RFP) 역할은 고유명사 오기 제외");

  f = properNounMisspellings(build([[item("X.docx", "plan", "보안수준 평가", "정보보호 관리체계 점검 결과")]]), PN);
  ok(f.length === 0, "무관 텍스트 오탐 없음");
}

// ───────── 실데이터 패리티: Python 추출 캐시로 재검사 ─────────
console.log("\n[real-data parity: rebuild_from_cache 동등]");
{
  const cacheDir = join(homedir(), "DocConsistencyChecker", "out", "extracted");
  if (!existsSync(cacheDir)) {
    console.log(`  (스킵) 캐시 폴더 없음: ${cacheDir}`);
  } else {
    // rebuild_from_cache.py 와 동일하게 3종(제안요청서·수행계획서·수준평가보고서) 사용.
    // general.json(옛 중복본)은 제외.
    const files = readdirSync(cacheDir)
      .filter((f) => f.endsWith(".json") && f !== "general.json")
      .sort();
    console.log(`  대상 캐시: ${files.join(", ")}`);
    const loadItems = (path: string): ExtractedItem[] => {
      const arr = JSON.parse(readFileSync(path, "utf-8"));
      return arr.map((d: any): ExtractedItem => {
        const s = d.source || {};
        return {
          doc: d.doc,
          role: d.role ?? "general",
          field: d.field,
          key: d.key ?? null,
          value: d.value,
          source: { doc: s.doc ?? d.doc, section: s.section ?? "", para_index: parseInt(String(s.para_index ?? -1), 10) || -1, snippet: s.snippet ?? "" },
        };
      });
    };
    const extracted = files.map((f) => loadItems(join(cacheDir, f)));
    // 결정적 용어 엔진이 실데이터에서 알려진 분기를 그대로 재현하는지 확인(룰셋 무관, 룰 없이 용어만).
    // (옛 문서 캐시라 새 브릿지X 룰은 해당 역할이 없어 의미 없음 → 용어 엔진만 검증.)
    const res = runChecksOnly(extracted, [], GLOSSARY_DEFAULT);
    console.log(`  → 위반 ${res.findings.length}건`);
    for (const f of res.findings) console.log(`     [${f.severity}/${f.type}] ${f.rule_id}: ${f.message}`);
    ok(
      res.findings.some((f) => f.rule_id === "term-split:발주기관"),
      "실데이터: term-split:발주기관 분기 재현(결정적 엔진)"
    );
  }
}

console.log(`\n결과: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
