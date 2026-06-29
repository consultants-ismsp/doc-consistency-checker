// 추출 프롬프트 — 역할별로 '무엇을 원문 그대로 뽑을지'만 지시한다.
// LLM은 추출만: 판단·계산·요약·정규화 금지. {blocks} 자리에 렌더한 블록을 끼워 넣는다.
// 룰(검산·일치·부분집합)이 동작하려면 수치 key·필드명을 아래 '정규 이름'으로 정확히 뽑아야 한다.
import type { ProperNoun } from "./config";

export const SYSTEM_PROMPT = `당신은 문서에서 값만 그대로 추출하는 도구입니다.
판단·계산·요약·정규화를 하지 마세요. 숫자 변환·단위 변경도 하지 마세요.
원문에 없는 값은 만들지 마세요. 애매하면 비워 두세요.
모든 값에는 출처(section, para_index, snippet)를 원문 그대로 포함하세요.
반드시 지정된 JSON 형식 하나만 출력하세요. 다른 말은 쓰지 마세요.
`;

// 용어 추출 규칙(여러 역할 공통) — 표기 차이만 잡기 위한 것.
const TERM_RULES = `규칙(용어 term_hits):
- '하나의 대상을 가리키는 명칭'의 표기 차이를 잡기 위한 것입니다.
- 한 개념(concept_hint)에는 같은 대상의 다른 표기만 묶으세요. 서로 다른 항목을 묶지 마세요.
- 약어와 풀이(예: ISMS-P ↔ 정보보호 및 개인정보보호 관리체계)는 변형으로 내지 마세요.
- 판단·요약하지 마세요. 없으면 비웁니다.`;

export const ROLE_PROMPTS: Record<string, string> = {
  general: `아래는 임의의 업무 문서 블록입니다. 특정 양식을 가정하지 말고,
문서 간 정합성 비교에 쓸 '수치'와 '용어 표현'만 원문 그대로 추출하세요.

추출 형식(JSON):
{
  "numbers": [
    {"key": "수치의 이름/라벨(원문에 적힌 항목명)", "value": 0,
     "source": {"section": "...", "para_index": 0, "snippet": "원문 일부"}}
  ],
  "term_hits": [
    {"value": "문서가 쓴 표현(예: 어플리케이션)", "concept_hint": "그 표현이 가리키는 개념(예: 애플리케이션)",
     "source": {"section": "...", "para_index": 0, "snippet": "..."}}
  ]
}

규칙(수치):
- value는 원문 그대로. 합산·계산·단위변환 하지 마세요.
- 정량 수치만: 건수·개수·금액·비율(%)·점수·인원·기준값 등. 날짜·기간·버전·문서번호는 제외.
- key(항목명)는 '무엇의 값인지' 분명해야 합니다. '총계' 같은 일반어 단독 사용 금지.

${TERM_RULES}

[문서 블록]
{blocks}
`,

  // RFP(제안요청서): 발주처 입력. 정합성 비교에서는 제외되지만 추출은 general 과 동일.
  rfp: `아래는 발주처가 작성한 RFP(제안요청서) 문서 블록입니다. 특정 양식을 가정하지 말고,
'수치'와 '용어 표현'만 원문 그대로 추출하세요. (이 문서는 정합성 비교 대상이 아닌 참조 입력입니다.)

추출 형식(JSON):
{
  "numbers": [
    {"key": "수치의 이름/라벨", "value": 0,
     "source": {"section": "...", "para_index": 0, "snippet": "원문 일부"}}
  ],
  "term_hits": [
    {"value": "문서가 쓴 표현", "concept_hint": "그 표현이 가리키는 개념",
     "source": {"section": "...", "para_index": 0, "snippet": "..."}}
  ]
}

규칙: value는 원문 그대로. 추론·요약 금지. 없으면 비웁니다.

[문서 블록]
{blocks}
`,

  // 수행계획서: 프로젝트 범위 수치(점검항목 수 등)와 용어.
  plan: `아래는 ISMS-P 인증 컨설팅 '수행계획서' 문서 블록입니다. 프로젝트 범위 수치와 용어를 원문 그대로 추출하세요.

추출 형식(JSON):
{
  "numbers": [
    {"key": "전체점검항목수", "value": 399, "source": {"section": "...", "para_index": 0, "snippet": "..."}}
  ],
  "term_hits": [
    {"value": "표현", "concept_hint": "개념", "source": {"section": "...", "para_index": 0, "snippet": "..."}}
  ]
}

규칙(수치) — 아래 정규 key 이름을 '공백 없이' 그대로 사용하세요(있는 것만):
- "전체점검항목수": ISMS-P(금융권) 점검항목 전체 개수(예: 399).
- "인증기준수": 인증기준 개수(예: 101).
- 그 외 수치는 원문 항목명을 key로(공백 없이). value는 원문 숫자 그대로, 계산 금지.

${TERM_RULES}

[문서 블록]
{blocks}
`,

  // 수준평가보고서(docx/xlsx): 통제항목 판정(Y/P/N) + 취약항목 + 점검항목 수치.
  level_eval: `아래는 ISMS-P '수준평가보고서' 문서 블록입니다. 통제항목별 판정과 점검항목 수치를 원문 그대로 추출하세요.
판정 척도: 양호=Y, 미흡=P, 취약=N, 해당없음=N/A.

추출 형식(JSON):
{
  "verdicts": [
    {"key": "통제항목번호(예 1.1.1)", "value": "Y|P|N|N/A",
     "source": {"section": "...", "para_index": 0, "snippet": "..."}}
  ],
  "fields": {
    "취약항목ID": [
      {"value": "취약(N) 판정된 통제항목번호", "source": {"section": "...", "para_index": 0, "snippet": "..."}}
    ]
  },
  "numbers": [
    {"key": "전체점검항목수", "value": 399, "source": {"section": "...", "para_index": 0, "snippet": "..."}}
  ],
  "term_hits": [
    {"value": "표현", "concept_hint": "개념", "source": {"section": "...", "para_index": 0, "snippet": "..."}}
  ]
}

규칙:
- verdicts.value 는 반드시 Y/P/N/N/A 문자로(양호→Y, 미흡→P, 취약→N). 한글 등급명 그대로 넣지 마세요.
- "취약항목ID"에는 판정이 N(취약)인 통제항목번호만 넣으세요.
- numbers 정규 key(공백 없이, 있는 것만): "전체점검항목수"(예 399), "적용점검항목수"(N/A 제외 적용분, 예 330), "제외점검항목수"(N/A 개수, 예 69).
- 추론·집계·계산하지 마세요. 없으면 비웁니다.

${TERM_RULES}

[문서 블록]
{blocks}
`,

  // 위험평가(결과)보고서(docx/xlsx): 위험 건수·등급별·이행수준 수치 + 대표자산.
  risk_eval: `아래는 ISMS-P '위험평가 보고서' 문서 블록입니다. 위험 관련 수치와 대표자산을 원문 그대로 추출하세요.

추출 형식(JSON):
{
  "numbers": [
    {"key": "노출위험건수", "value": 217, "source": {"section": "...", "para_index": 0, "snippet": "..."}}
  ],
  "fields": {
    "대표자산": [
      {"value": "자산명", "source": {"section": "...", "para_index": 0, "snippet": "..."}}
    ]
  },
  "term_hits": [
    {"value": "표현", "concept_hint": "개념", "source": {"section": "...", "para_index": 0, "snippet": "..."}}
  ]
}

규칙(수치) — 아래 정규 key 이름을 '공백 없이' 그대로 사용하세요(있는 것만). value는 원문 숫자 그대로, 계산 금지:
- "노출위험건수": 자산취약점 기반 노출위험 총 건수(예 217).
- "높음위험건수" / "보통위험건수" / "낮음위험건수": 위험등급별 건수(예 99 / 117 / 1).
- "미부분이행건수": 관리체계 기반 미·부분이행 합(예 161).
- "부분이행건수": 부분이행(P) 개수(예 140). "미이행건수": 미이행(N) 개수(예 21).
- "대표자산"에는 위험평가 대상이 된 자산명을 원문 그대로 나열하세요.

${TERM_RULES}

[문서 블록]
{blocks}
`,

  // 개선과제정의서: 개선과제가 대상으로 삼는 통제항목번호.
  task_def: `아래는 ISMS-P '개선과제 정의서' 문서 블록입니다. 개선과제가 대상으로 삼는 통제항목번호를 원문 그대로 추출하세요.

추출 형식(JSON):
{
  "fields": {
    "개선대상통제항목ID": [
      {"value": "개선과제 대상 통제항목번호(예 2.6.1)", "source": {"section": "...", "para_index": 0, "snippet": "..."}}
    ]
  },
  "term_hits": [
    {"value": "표현", "concept_hint": "개념", "source": {"section": "...", "para_index": 0, "snippet": "..."}}
  ]
}

규칙: 대상 통제항목번호를 원문 그대로 나열하세요. 추론·집계하지 마세요. 없으면 비웁니다.

${TERM_RULES}

[문서 블록]
{blocks}
`,

  // 자산관리대장(xlsx): 자산명 목록.
  asset: `아래는 '자산관리대장' 문서 블록입니다(엑셀 시트 셀). 자산명 목록을 원문 그대로 추출하세요.

추출 형식(JSON):
{
  "fields": {
    "자산명": [
      {"value": "자산명", "source": {"section": "...", "para_index": 0, "snippet": "..."}}
    ]
  }
}

규칙: 실제 보유 자산의 이름만 원문 그대로 나열하세요(분류명·설명문 말고 개별 자산명). 추론·중복정리 하지 마세요. 없으면 비웁니다.

[문서 블록]
{blocks}
`,

  // 체크리스트·법령매핑(xlsx): 통제번호(마스터 통제항목 목록).
  checklist: `아래는 '금융권 ISMS-P 체크리스트(법령 매핑)' 문서 블록입니다(엑셀 시트 셀).
통제항목 마스터 목록의 통제번호를 원문 그대로 추출하세요.

추출 형식(JSON):
{
  "fields": {
    "통제번호": [
      {"value": "통제항목번호(예 1.1.1)", "source": {"section": "...", "para_index": 0, "snippet": "..."}}
    ]
  },
  "term_hits": [
    {"value": "표현", "concept_hint": "개념", "source": {"section": "...", "para_index": 0, "snippet": "..."}}
  ]
}

규칙: 통제번호(예 1.1.1, 2.6.1)를 원문 그대로 나열하세요. 세부번호(1.1.1-1)는 통제번호 부분만. 추론하지 마세요.

${TERM_RULES}

[문서 블록]
{blocks}
`,
};

// ── 표준 용어 의미비교(LLM) ──
// 산출물이 쓴 용어 중, 의미는 공식 표준 용어와 같은데 표기/띄어쓰기/표현만 다른 것을 LLM이 골라낸다.
// (판정·계산이 아니라 '용어 의미비교' — role-split에서 LLM에게 허용된 일.)
export const STANDARD_AUDIT_SYSTEM = `당신은 ISMS-P 산출물의 용어 표기를 공식 표준 용어와 대조하는 도구입니다.
의미가 같은데 표기·띄어쓰기·표현만 표준과 다른 용어만 찾으세요.
의미가 다르거나, 표준 목록에 대응이 없거나, 표준과 완전히 동일하면 절대 넣지 마세요.
추측하지 말고 확실한 것만. 지정한 JSON 하나만 출력하세요.`;

export function standardAuditUser(terms: string[], standards: string[]): string {
  return (
    `[공식 표준 용어]\n${standards.join(", ")}\n\n` +
    `[문서가 쓴 용어]\n${terms.join(", ")}\n\n` +
    `위 '문서가 쓴 용어' 중에서 의미는 공식 표준 용어와 같지만 표기/띄어쓰기/표현이 다른 것만 쌍으로 출력하세요.\n` +
    `형식(JSON): {"pairs": [{"used": "문서표현", "standard": "대응 공식표준어"}]}`
  );
}

// ── 오타 점검(LLM) ──
// 추출 프롬프트에 덧붙여, 같은 패스에서 명백한 오타/맞춤법 오류도 함께 보고하게 한다(추가 호출 없음).
// 적발만 — 고치지 않는다. 확실한 것만(고유명사·전문용어·영문은 제외).
export const TYPO_INSTRUCTION = `
추가로, 위 블록에 '명백한 오타·맞춤법 오류'가 있으면 typos 배열에도 넣으세요(없으면 빈 배열).
- 확실한 것만: 잘못된 글자·받침·띄어쓰기 오류 등. 고유명사·전문용어·영문·숫자는 건드리지 마세요.
- 특히 회사명·브랜드·제품명 등 고유명사는 표준 외래어 표기와 달라도 의도된 표기이니 오타로 보지 마세요(예: 회사명 '컨술탄츠').
- 의미 추측·문장 교정은 하지 마세요. 원문 표기를 그대로 두고 교정안만 제시.
형식: "typos": [{"wrong": "원문오타표기", "suggestion": "교정안", "source": {"section": "...", "para_index": 0, "snippet": "원문 일부"}}]
`;

// ── 회사명(고유명사) 표기 통일 ──
// 회사명이 블록에 나오면 표기가 달라도 concept_hint를 '표준 표기'로 고정해 term_hits로 뽑게 한다.
// → 코드(모드A)가 문서 간 표기 갈림을 적발한다(판정은 코드, LLM은 같은 대상 인식·추출만).
// 이 이름들은 오타로는 보고하지 않게 한다(의도된 브랜드 표기). 입력이 없으면 빈 문자열.
export function properNounInstruction(names: ProperNoun[]): string {
  if (!names.length) return "";
  const lines = names.map((n) => `- ${n.label}: "${n.canonical}"`).join("\n");
  return `
추가로, 아래 '회사명(고유명사)'이 블록에 나오면 표기가 조금 달라도 term_hits 에 넣으세요.
- concept_hint 는 반드시 아래 '표준 표기' 그대로 적으세요(문서 간 표기 통일 검사에 씁니다).
- value 에는 문서에 실제로 적힌 표기를 그대로 적으세요.
- 이 회사명들은 오타(typos)로 보고하지 마세요.
${lines}
`;
}

// 역할 표시명 — UI 드롭다운용
export const ROLE_LABELS: Record<string, string> = {
  general: "일반문서",
  rfp: "RFP(제안요청서·참조)",
  plan: "수행계획서",
  level_eval: "수준평가보고서",
  risk_eval: "위험평가보고서",
  task_def: "개선과제정의서",
  asset: "자산관리대장",
  checklist: "체크리스트·법령매핑",
};
