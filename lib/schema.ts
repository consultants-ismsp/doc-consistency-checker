// 공통 데이터 모델. Python core/schema.py 와 동일한 구조.
// 단계마다 이 타입들을 주고받는다.

export interface Source {
  doc: string;
  section: string;
  para_index: number;
  snippet: string;
  // 사람이 문서에서 되짚기 쉬운 좌표(코드가 블록에서 결정적으로 붙임). 없으면 section/snippet로 폴백.
  heading?: string; // 가장 가까운 제목 텍스트(docx). 예: "2.3 자산 식별 기준"
  cell?: string; // 셀 주소. 엑셀 "B12" / docx 표 "표3 · 5행 2열"
}

export type FieldKind = "verdict" | "number" | "term" | string;

export interface ExtractedItem {
  doc: string;
  role: string;
  field: FieldKind; // verdict | number | term | (역할별 커스텀 필드명)
  key: string | null; // 2.6.1, 미흡건수 ...
  value: string | number;
  source: Source;
}

export type Severity = "high" | "medium" | "low";
export type FindingType = "term" | "value" | "cross_ref" | "dependency" | "subset" | "typo";

export interface Finding {
  rule_id: string;
  type: FindingType;
  severity: Severity;
  docs: string[];
  locations: Source[];
  expected: string;
  actual: string;
  message: string;
}

// 룰 스펙은 yaml dict 그대로 — 느슨한 타입(엔진은 도메인 무지).
export type RuleSpec = Record<string, any> & { id?: string; type?: string };
