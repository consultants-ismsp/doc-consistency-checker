// 예시(데모) 결과 — 업로드·LLM 없이 결과 화면을 미리 보기 위한 샘플.
// 실제 검사 엔진(runChecksOnly)을 그대로 통과시켜 Finding을 만든다(가짜 결과가 아님).
// 새 브릿지X 룰셋(RULES_BRIDGEX)의 검산·일치·연계·부분집합·종속·용어를 골고루 보여준다.
import { RULES_BRIDGEX, GLOSSARY_DEFAULT } from "./config";
import { runChecksOnly } from "./pipeline";
import { buildPayload } from "./report";
import type { ExtractedItem, Finding, Source } from "./schema";

function src(doc: string, section: string, para: number, snippet: string): Source {
  return { doc, section, para_index: para, snippet };
}
function num(doc: string, role: string, key: string, value: number, section: string, para: number, snippet: string): ExtractedItem {
  return { doc, role, field: "number", key, value, source: src(doc, section, para, snippet) };
}
function verdict(doc: string, role: string, key: string, value: string, section: string, para: number, snippet: string): ExtractedItem {
  return { doc, role, field: "verdict", key, value, source: src(doc, section, para, snippet) };
}
function field(doc: string, role: string, fname: string, value: string, section: string, para: number, snippet: string): ExtractedItem {
  return { doc, role, field: fname, key: null, value, source: src(doc, section, para, snippet) };
}
function term(doc: string, role: string, value: string, concept: string, section: string, para: number, snippet: string): ExtractedItem {
  return { doc, role, field: "term", key: concept, value, source: src(doc, section, para, snippet) };
}

const F = {
  plan: "(주)브릿지X_수행계획서.docx",
  level: "브릿지X_수준평가보고서.docx",
  riskDoc: "브릿지X_위험평가결과보고서.docx",
  riskXlsx: "브릿지X_위험평가보고서.xlsx",
  task: "브릿지X_개선과제정의서.docx",
  asset: "브릿지X_자산관리대장.xlsx",
  checklist: "체크리스트_법령매핑.xlsx",
};

// 수행계획서: 전체 점검항목 399. 발주기관 표기 '브릿지X'.
const plan: ExtractedItem[] = [
  num(F.plan, "plan", "전체점검항목수", 399, "1.2", 8, "금융권 ISMS-P 점검항목 399개를 대상으로 한다."),
  term(F.plan, "plan", "브릿지X", "발주기관", "2.1", 3, "발주기관: 브릿지X"),
];

// 수준평가보고서: 전체 398(계획서 399와 불일치) / 적용 330 + 제외 69 = 399(검산 통과).
// 구조적 종속 모순: 2.5(부분이행 P)인데 자식 2.5.1(양호 Y). 취약(N) 항목 2.5.1, 2.5.5.
const level: ExtractedItem[] = [
  num(F.level, "level_eval", "전체점검항목수", 398, "2.2", 5, "점검항목 398개 적용"),
  num(F.level, "level_eval", "적용점검항목수", 330, "2.2", 6, "N/A 제외 후 330개 기준"),
  num(F.level, "level_eval", "제외점검항목수", 69, "2.2", 7, "N/A 69개 제외"),
  verdict(F.level, "level_eval", "2.5", "P", "3", 40, "2.5 접근통제 — 미흡(P)"),
  verdict(F.level, "level_eval", "2.5.1", "Y", "3", 41, "2.5.1 사용자 식별 — 양호(Y)"),
  verdict(F.level, "level_eval", "2.5.5", "N", "3", 45, "2.5.5 특수 권한 관리 — 취약(N)"),
  verdict(F.level, "level_eval", "2.1.4", "N", "3", 18, "2.1.4 — 취약(N) (마스터에 없는 항목)"),
  field(F.level, "level_eval", "취약항목ID", "2.5.5", "3", 45, "취약 항목: 2.5.5"),
  field(F.level, "level_eval", "취약항목ID", "2.1.4", "3", 18, "취약 항목: 2.1.4"),
  term(F.level, "level_eval", "(주)브릿지X", "발주기관", "1.1", 2, "발주기관: (주)브릿지X"),
];

// 위험평가 결과보고서(docx): 노출위험 217 ≠ 높음99+보통117+낮음2(=218) → 검산 실패.
// 미·부분이행 161 = 부분140 + 미이행21 → 검산 통과.
const riskDoc: ExtractedItem[] = [
  num(F.riskDoc, "risk_eval", "노출위험건수", 217, "3.1", 10, "자산취약점 기반 노출위험 총 217건"),
  num(F.riskDoc, "risk_eval", "높음위험건수", 99, "3.1", 11, "높음 99건"),
  num(F.riskDoc, "risk_eval", "보통위험건수", 117, "3.1", 12, "보통 117건"),
  num(F.riskDoc, "risk_eval", "낮음위험건수", 2, "3.1", 13, "낮음 2건"),
  num(F.riskDoc, "risk_eval", "미부분이행건수", 161, "3.2", 20, "관리체계 기반 미·부분이행 161개"),
  num(F.riskDoc, "risk_eval", "부분이행건수", 140, "3.2", 21, "부분이행(P) 140개"),
  num(F.riskDoc, "risk_eval", "미이행건수", 21, "3.2", 22, "미이행(N) 21개"),
  field(F.riskDoc, "risk_eval", "대표자산", "회원 DB", "2.1", 30, "대표자산: 회원 DB"),
  field(F.riskDoc, "risk_eval", "대표자산", "결제 엔진 서버", "2.1", 31, "대표자산: 결제 엔진 서버"),
];

// 위험평가 보고서(xlsx): 노출위험 216 → docx의 217과 문서 간 불일치.
const riskXlsx: ExtractedItem[] = [
  num(F.riskXlsx, "risk_eval", "노출위험건수", 216, "통계", 2, "노출위험 216건"),
  num(F.riskXlsx, "risk_eval", "미부분이행건수", 161, "통계", 3, "미·부분이행 161개"),
];

// 개선과제정의서: 취약 항목 중 2.5.5만 개선과제로 정의 → 2.1.4 누락(연계 위반).
const task: ExtractedItem[] = [
  field(F.task, "task_def", "개선대상통제항목ID", "2.5.5", "3", 12, "개선과제 대상: 2.5.5"),
];

// 자산관리대장: 회원 DB만 등록 → 위험평가 대표자산 '결제 엔진 서버' 누락(부분집합 위반).
// 본문에 '어플리케이션' 사용 → 표준어 '애플리케이션' 위반(용어 모드B).
const asset: ExtractedItem[] = [
  field(F.asset, "asset", "자산명", "회원 DB", "05.데이터베이스", 4, "자산명: 회원 DB"),
  field(F.asset, "asset", "자산명", "웹/WAS 서버", "03.서버", 5, "자산명: 웹/WAS 서버"),
  term(F.asset, "asset", "어플리케이션", "애플리케이션", "02.어플리케이션", 1, "02. 어플리케이션(홈페이지/앱)"),
];

// 체크리스트(마스터): 1.1.1·2.5·2.5.1·2.5.5 정의. 2.1.4는 없음 → 수준평가 2.1.4가 마스터 미정의로 적발.
const checklist: ExtractedItem[] = [
  field(F.checklist, "checklist", "통제번호", "1.1.1", "체크리스트", 5, "1.1.1 경영진의 참여"),
  field(F.checklist, "checklist", "통제번호", "2.5", "체크리스트", 58, "2.5 접근통제"),
  field(F.checklist, "checklist", "통제번호", "2.5.1", "체크리스트", 60, "2.5.1 사용자 식별"),
  field(F.checklist, "checklist", "통제번호", "2.5.5", "체크리스트", 64, "2.5.5 특수 권한 관리"),
];

export interface SampleResult {
  payload: ReturnType<typeof runChecksOnly>["payload"];
  findings: ReturnType<typeof runChecksOnly>["findings"];
  skipped: Array<[string, string]>;
  errors: Array<{ file?: string; error?: string }>;
  extractedByDoc: Array<{ name: string; items: Record<string, unknown>[] }>;
}

export function buildSampleResult(): SampleResult {
  const groups = [plan, level, riskDoc, riskXlsx, task, asset, checklist];
  const res = runChecksOnly(groups, RULES_BRIDGEX, GLOSSARY_DEFAULT, {
    title: "문서 정합성 검사 결과 (예시)",
    generated_at: "예시 데이터 — 실제 검사 아님",
    docs: [F.plan, F.level, F.riskDoc, F.riskXlsx, F.task, F.asset, F.checklist],
  });
  // 표준용어 점검(LLM)은 런타임 전용이라 예시에선 1건을 합성해 화면을 보여준다.
  const stdFinding: Finding = {
    rule_id: "standard-term:사용자 계정 관리",
    type: "term",
    severity: "medium",
    docs: [F.level],
    locations: [src(F.level, "3", 37, "2.5.1 사용자계정관리 — 양호")],
    expected: "사용자 계정 관리",
    actual: "사용자계정관리",
    message: `공식 표준어 '사용자 계정 관리' 대신 '사용자계정관리' 사용 (${F.level})`,
  };
  // 오타 점검(LLM)도 런타임 전용 → 예시용 1건 합성.
  const typoFinding: Finding = {
    rule_id: "typo:취약점 점겁",
    type: "typo",
    severity: "low",
    docs: [F.riskDoc],
    locations: [src(F.riskDoc, "2.3", 8, "취약점 점겁 및 조치 결과")],
    expected: "취약점 점검",
    actual: "취약점 점겁",
    message: `오타 의심: '취약점 점겁' → '취약점 점검' (${F.riskDoc})`,
  };
  const findings = [...res.findings, stdFinding, typoFinding];
  const payload = buildPayload(findings, res.payload.meta);
  const extractedByDoc = groups.map((g) => ({
    name: stem(g[0].doc),
    items: g.map((it) => ({
      doc: it.doc, role: it.role, field: it.field, key: it.key, value: it.value,
      source: { doc: it.source.doc, section: it.source.section, para_index: it.source.para_index, snippet: it.source.snippet },
    })),
  }));
  return { payload, findings, skipped: res.skipped, errors: [], extractedByDoc };
}

function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
