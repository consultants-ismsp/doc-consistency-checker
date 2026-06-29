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
import { runChecksOnly } from "../lib/pipeline";
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
