// 기존 Python config/*.yaml 을 그대로 가져온 '동작의 정답' 데이터.
// 룰·용어사전·공급자 설정의 의미를 동일하게 유지한다.
import type { Glossary } from "./terms";
import type { RuleSpec } from "./schema";

// ── 브릿지X 산출물 정합 룰셋 (실제 산출물 0626 기준 재작성) ──
// 산출물은 다음 흐름으로 나오고, 룰은 이 의존 체인을 따라 정합성을 본다:
//   법령매핑(checklist=통제항목 마스터) → 수행계획(plan) → 자산관리대장(asset)
//   → 수준평가(level_eval) → 위험평가(risk_eval) → 개선과제(task_def)
// 즉 통제항목을 참조하는 산출물은 모두 checklist 통제번호의 부분집합이어야 하고,
// 자산을 참조하면 asset 자산명의 부분집합, 취약 항목은 평가→개선으로 추적된다.
// 규칙은 전부 코드가 계산/비교한다(LLM은 추출만). 참조 역할/필드 없으면 그 룰만 스킵.
export const RULES_BRIDGEX: RuleSpec[] = [
  // (1) 문서 내 수치 검산 — 합이 안 맞으면 적발. (키는 공백 없는 정규 이름으로 추출됨)
  // 위험등급 합: 노출위험 = 높음 + 보통 + 낮음
  { id: "위험등급-합-검산", type: "value_formula", expr: "노출위험건수 == 높음위험건수 + 보통위험건수 + 낮음위험건수" },
  // 이행수준 합: 미·부분이행 = 부분이행(P) + 미이행(N)
  { id: "이행수준-합-검산", type: "value_formula", expr: "미부분이행건수 == 부분이행건수 + 미이행건수" },
  // 점검항목 적용: 전체 = 적용 + 제외(N/A)
  { id: "점검항목-적용-검산", type: "value_formula", expr: "전체점검항목수 == 적용점검항목수 + 제외점검항목수" },
  // 개선과제 종합표: 총건수 = 관리체계 + 자산취약점. (종합표 서두 선언값끼리 검산)
  { id: "개선과제-총계-검산", type: "value_formula", expr: "개선과제총건수 == 관리체계개선과제건수 + 자산취약점개선과제건수" },

  // (2) 문서 간 수치 일치 — 같은 수치가 문서마다 다르면 적발.
  { id: "전체점검항목수-일치", type: "value_match", key: "전체점검항목수", must_equal_across: ["plan", "level_eval"] },
  // 위험평가는 docx(결과보고서)와 xlsx(보고서)가 같은 risk_eval 역할 → 두 문서 간 비교.
  { id: "노출위험건수-일치", type: "value_match", key: "노출위험건수", must_equal_across: ["risk_eval"] },
  { id: "미부분이행건수-일치", type: "value_match", key: "미부분이행건수", must_equal_across: ["risk_eval"] },
  // 개선과제 카드별 미흡건수 합이 위험평가 산정치와 맞아야 함(코드가 카드합을 계산).
  //  - 관리체계 카드합 == 위험평가 미부분이행건수(취약N+미흡P)
  //  - 자산취약점 카드합 == 위험평가 노출위험건수
  { id: "관리체계카드합-미부분이행-일치", type: "value_sum_match", sum: { role: "task_def", key: "관리체계카드미흡건수" }, equals: { role: "risk_eval", key: "미부분이행건수" } },
  { id: "자산취약점카드합-노출위험-일치", type: "value_sum_match", sum: { role: "task_def", key: "자산취약점카드미흡건수" }, equals: { role: "risk_eval", key: "노출위험건수" } },

  // (3) 통제항목 추적 — 흐름을 따라 부분집합이어야 함. 누락 적발.
  // 마스터 정의: 수준평가가 평가한 통제항목은 모두 법령매핑(마스터)에 정의돼 있어야 함.
  //   (평가통제항목ID 는 수준평가 판정 키에서 코드가 파생 — pipeline.withDerivedFields)
  // 통제항목ID 는 문서마다 세부번호(2.5.1-1)까지 쓰기도 해서, 추적 비교는 통제번호(2.5.1) 수준으로 정규화한다.
  {
    id: "수준평가-마스터정의-누락",
    type: "cross_reference",
    source: { role: "level_eval", field: "평가통제항목ID" },
    target: { role: "checklist", field: "통제번호" },
    relation: "subset",
    normalize: "control_no",
  },
  // 수준평가에서 취약(N) 판정된 통제항목은 모두 개선과제로 정의돼야 함.
  {
    id: "취약항목-개선과제-누락",
    type: "cross_reference",
    source: { role: "level_eval", field: "취약항목ID" },
    target: { role: "task_def", field: "개선대상통제항목ID" },
    relation: "subset",
    normalize: "control_no",
  },
  // 개선과제 대상은 수준평가에서 실제 평가된 통제항목이어야 함(평가 안 된 항목을 가리키면 적발).
  {
    id: "개선과제-평가항목-추적",
    type: "cross_reference",
    source: { role: "task_def", field: "개선대상통제항목ID" },
    target: { role: "level_eval", field: "평가통제항목ID" },
    relation: "subset",
    normalize: "control_no",
  },
  // 개선과제가 가리키는 통제항목번호는 법령매핑(마스터 목록)에 정의돼 있어야 함.
  {
    id: "개선과제-통제번호-정의",
    type: "cross_reference",
    source: { role: "task_def", field: "개선대상통제항목ID" },
    target: { role: "checklist", field: "통제번호" },
    relation: "subset",
    normalize: "control_no",
  },
  // 위험평가에 등장한 대표자산은 자산관리대장에 등록돼 있어야 함.
  // 대표자산 값 중 자산명일 리 없는 서술문 조각·집계표현은 비교에서 제외(오탐 방지).
  // 예: "20개 대표 자산(…[표 14] 참조)", "감사 대상 전 자산", "자산명 상세 목록 참조".
  {
    id: "위험평가-자산-누락",
    type: "subset",
    source: { role: "risk_eval", field: "대표자산" },
    target: { role: "asset", field: "자산명" },
    ignore: ["참조", "\\[표", "상세\\s*목록", "대상\\s*전\\s*자산"],
  },

  // (4) 판정 종속(자동) — 부모 통제항목이 N/P인데 자식이 Y면 모순. 계층 있을 때만 동작.
  { id: "구조적-종속-모순", type: "dependency", mode: "structural", rule: "parent_not_y_then_child_not_y" },
];

// ── 공식 ISMS-P 표준 용어 (LLM 의미비교 기준 어휘) ──
// 금융보안원 「금융권 ISMS-P 점검항목 안내서(2023.12.)」 개요의 통제항목명+분야명 119개.
// (오프라인 1회 추출 — scripts/extract-standard-terms.ts. 런타임은 PDF를 읽지 않고 이 상수만 쓴다.)
// 산출물이 의미는 같으나 표기가 다른 용어를 쓰면 LLM이 이 목록과 의미비교해 적발한다(코드는 적발만).
export const STANDARD_TERMS: string[] = [
  "가명정보 처리", "개인정보 간접수집", "개인정보 목적 외 이용 및 제공", "개인정보 보유 및 이용 시 보호조치",
  "개인정보 수집 시 보호조치", "개인정보 수집 제한", "개인정보 수집·이용", "개인정보 제3자 제공",
  "개인정보 제공 시 보호조치", "개인정보 처리 업무 위탁", "개인정보 처리방침 공개", "개인정보 파기 시 보호조치",
  "개인정보 품질보장", "개인정보 현황관리", "개인정보의 국외이전", "개인정보의 파기",
  "경영진의 참여", "공개서버 보안", "관리체계 개선", "관리체계 기반 마련",
  "관리체계 운영", "관리체계 점검", "관리체계 점검 및 개선", "네트워크 접근",
  "데이터베이스 접근", "로그 및 접속기록 관리", "로그 및 접속기록 점검", "마케팅 목적의 개인정보 수집·이용",
  "무선 네트워크 접근", "물리 보안", "민감정보 및 고유식별정보의 처리 제한", "반출입 기기 통제",
  "백업 및 복구관리", "범위 설정", "법적 요구사항 준수 검토", "변경관리",
  "보안 서약", "보안 요구사항 검토 및 시험", "보안 요구사항 정의", "보안 위반 시 조치",
  "보안시스템 운영", "보조저장매체 관리", "보호구역 내 작업", "보호구역 지정",
  "보호대책 공유", "보호대책 구현", "보호대책 선정", "보호설비 운영",
  "비밀번호 관리", "사고 대응 및 복구", "사고 대응 훈련 및 개선", "사고 예방 및 대응",
  "사고 예방 및 대응체계 구축", "사용자 계정 관리", "사용자 식별", "사용자 인증",
  "성능 및 장애관리", "소스 프로그램 관리", "시간 동기화", "시스템 및 서비스 보안관리",
  "시스템 및 서비스 운영관리", "시험 데이터 보안", "시험과 운영 환경 분리", "악성코드 통제",
  "암호정책 적용", "암호키 관리", "암호화 적용", "업무용 단말기기 보안",
  "업무환경 보안", "영업의 양수 등에 따른 개인정보의 이전", "외부자 계약 변경 및 만료 시 보안", "외부자 계약 시 보안",
  "외부자 보안", "외부자 보안 이행 관리", "외부자 현황 관리", "운영현황 관리",
  "운영환경 이관", "원격접근 통제", "위험 관리", "위험 평가",
  "응용프로그램 접근", "이상행위 분석 및 모니터링", "이용자 단말기 접근 보호", "인식제고 및 교육훈련",
  "인적 보안", "인증 및 권한관리", "인터넷 접속 통제", "자원 할당",
  "재해 복구", "재해 복구 시험 및 개선", "전자거래 및 핀테크 보안", "접근권한 검토",
  "접근통제", "정보시스템 도입 및 개발 보안", "정보시스템 보호", "정보시스템 접근",
  "정보자산 관리", "정보자산 식별", "정보자산의 재사용 및 폐기", "정보전송 보안",
  "정보주체 권리보장", "정보주체 권리보호", "정보주체에 대한 통지", "정책 수립",
  "정책의 유지관리", "조직 구성", "조직의 유지관리", "주민등록번호 처리 제한",
  "주요 직무자 지정 및 관리", "직무 분리", "처리목적 달성 후 보유 시 조치", "최고책임자의 지정",
  "출입통제", "취약점 점검 및 조치", "클라우드 보안", "퇴직 및 직무변경 관리",
  "특수 계정 및 권한관리", "패치관리", "현황 및 흐름분석",
];

export interface RuleSetOption {
  id: string;
  label: string;
  rules: RuleSpec[];
}

export const RULESETS: RuleSetOption[] = [
  { id: "bridgex", label: "브릿지X 산출물 정합 (수행계획/수준평가/위험평가/개선과제/자산/체크리스트)", rules: RULES_BRIDGEX },
  { id: "none", label: "룰 없음 (자동 용어·수치 비교만)", rules: [] },
];

// ── config/glossary.yaml (모드 B 용어사전) ──
export const GLOSSARY_DEFAULT: Glossary = {
  terms: [
    { standard: "파기", variants: ["없앰"], except_context: ["파일 삭제", "로그 삭제"] },
    { standard: "개인정보처리자", variants: ["정보처리자", "처리자"] },
    // 실제 산출물에서 자산대장은 '애플리케이션', 본문은 '어플리케이션' 혼용 — 표준 표기로 통일.
    { standard: "애플리케이션", variants: ["어플리케이션"] },
  ],
};

// ── 문서 역할 분류 (산출물 정합성 재설계 v2) ──
// reference 역할(RFP)은 발주처 입력 — 비전문 용어가 정상이므로 정합성(용어·자동 수치) 비교에서 완전 제외.
// 여기 없는 역할은 모두 정합성 대상(deliverable). 표준어는 문서가 아니라 외부 glossary 가 정의한다(D2).
export const REFERENCE_ROLES: ReadonlySet<string> = new Set<string>(["rfp"]);

// 관리 대상 고유명사(회사명). 두 가지로 쓴다:
//  ① 오타 점검 과탐 제외(표준 외래어 표기와 달라도 의도된 표기라서)
//  ② 문서 간 표기 통일 검사 — 추출 때 concept 앵커로 묶어 모드A가 갈림을 적발.
// 회사명을 코드에 박으면 다른 사업에 못 쓰므로, '수행사'만 고정하고 '고객사'는 런타임 입력으로 받는다.
export interface ProperNoun {
  canonical: string; // 표준(정답) 표기
  label: string; // 역할 표시(수행사/고객사 등) — 프롬프트 안내·메시지용
}

// 수행사(이 도구를 쓰는 컨설팅사) — 고정. 산출물마다 바뀌지 않는다(브랜드=CONSULTANTS).
export const PERFORMER: ProperNoun = { canonical: "컨술탄츠", label: "수행사" };

// [수행사(고정) + 런타임 입력 고객사들]로 합친다. 빈 입력은 버린다.
export function buildProperNouns(clientNames: string[] = []): ProperNoun[] {
  const clients = clientNames
    .map((n) => n.trim())
    .filter(Boolean)
    .map((canonical) => ({ canonical, label: "고객사" }));
  return [PERFORMER, ...clients];
}

// ── config/settings.yaml + factory presets (LLM 공급자) ──
export type ProviderId = "claude" | "openrouter" | "solar" | "openai" | "gemini" | "custom";

export interface LlmSettings {
  provider: ProviderId;
  model: string;
  base_url?: string; // OpenAI 호환에서 사용
  api_key_env: string; // 표시용(브라우저는 환경변수 없음 — UI 입력 키 사용)
}

// 기본값: OpenRouter(OpenAI 호환). 매니저 발급 키가 OpenRouter라 기본을 여기로 둔다.
export const SETTINGS_DEFAULT: LlmSettings = {
  provider: "openrouter",
  model: "anthropic/claude-sonnet-4.6",
  base_url: "https://openrouter.ai/api/v1",
  api_key_env: "OPENROUTER_API_KEY",
};

// 공급자별 프리셋(코드 수정 없이 교체). base_url/model 교체 가능.
export const PROVIDER_PRESETS: Record<ProviderId, LlmSettings> = {
  claude: { provider: "claude", model: "claude-sonnet-4-5", api_key_env: "ANTHROPIC_API_KEY" },
  // OpenRouter: OpenAI 호환 엔드포인트로 Claude를 호출. 키는 openrouter.ai에서 발급(sk-or-...).
  openrouter: {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4.6",
    base_url: "https://openrouter.ai/api/v1",
    api_key_env: "OPENROUTER_API_KEY",
  },
  solar: { provider: "solar", model: "solar-pro2", base_url: "https://api.upstage.ai/v1", api_key_env: "UPSTAGE_API_KEY" },
  openai: { provider: "openai", model: "gpt-4o-mini", base_url: "https://api.openai.com/v1", api_key_env: "OPENAI_API_KEY" },
  gemini: {
    provider: "gemini",
    model: "gemini-1.5-flash",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    api_key_env: "GEMINI_API_KEY",
  },
  custom: { provider: "custom", model: "", base_url: "", api_key_env: "" },
};
