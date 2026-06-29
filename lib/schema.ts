// 공통 데이터 모델. Python core/schema.py 와 동일한 구조.
// 단계마다 이 타입들을 주고받는다.

export interface Source {
  doc: string;
  section: string;
  para_index: number;
  snippet: string;
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
