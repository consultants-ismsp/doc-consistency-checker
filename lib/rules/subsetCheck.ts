// 공통 차집합(누락) 검사: source 집합 ⊆ target 집합인지 보고, 빠진 값을 적발.
// cross_reference(연계)와 subset(자산 정합)이 같은 로직을 공유한다 — 라벨/메시지/type만 다름.
import { cmp, Model } from "../normalize";
import type { Finding, Source } from "../schema";
import { RuleError } from "./base";

// 세부번호(2.5.1-1)를 통제번호(2.5.1) 수준으로 축약. 통제번호 형태가 아니면 원본 유지.
export function controlNo(v: string): string {
  const m = String(v).match(/^\s*(\d+\.\d+\.\d+)/);
  return m ? m[1] : String(v);
}

// 룰 spec 의 normalize 문자열 → 정규화 함수. 미지정이면 undefined(정규화 없음).
export function normalizerOf(name: unknown): ((v: string) => string) | undefined {
  return name === "control_no" ? controlNo : undefined;
}

interface Ref {
  role: string;
  field: string;
}
interface SubsetKind {
  errLabel: string; // RuleError 접두("cross_reference" | "subset")
  type: "cross_ref" | "subset"; // Finding.type
  msgPrefix: string; // 메시지 접두("연계 누락" | "자산 정합 누락")
  normalize?: (v: string) => string; // 비교 전 값 정규화(예: 세부번호 2.5.1-1 → 통제번호 2.5.1)
  ignore?: string[]; // source 값 중 이 정규식에 걸리면 비교에서 제외(서술문 조각·집계표현 등 자산 아님)
}

export function checkSubset(model: Model, src: Ref, tgt: Ref, id: string, kind: SubsetKind): Finding[] {
  const norm = kind.normalize ?? ((v: string) => v);
  // ignore 패턴은 원본 값 기준으로 걸러낸다(정규화 전). 자산명일 리 없는 문장 조각 제거용.
  const ignoreRes = (kind.ignore ?? []).map((p) => new RegExp(p));
  const ignored = (v: string) => ignoreRes.some((re) => re.test(v));
  const srcVals: Array<[string, Source]> = model
    .fieldValues(src.role, src.field)
    .filter(([v]) => !ignored(v))
    .map(([v, s]) => [norm(v), s]);
  const tgtVals = model.fieldValues(tgt.role, tgt.field).map(([v]) => norm(v));
  // 한쪽이 통째로 없으면 '검사 불가'로 스킵 — 없다고 전부 누락 처리하지 않는다.
  if (srcVals.length === 0) {
    throw new RuleError(`${kind.errLabel} '${id}': source 값 없음 (${src.role}.${src.field})`);
  }
  if (tgtVals.length === 0) {
    throw new RuleError(`${kind.errLabel} '${id}': target 값 없음 → 검사 불가 (${tgt.role}.${tgt.field})`);
  }

  const targetSet = new Set(tgtVals);
  const missing = srcVals.filter(([v]) => !targetSet.has(v));
  if (!missing.length) return [];

  const missVals = [...new Set(missing.map(([v]) => v))].sort(cmp);
  const docs = [...new Set(missing.map(([, s]) => s.doc))].sort(cmp);
  return [
    {
      rule_id: id,
      type: kind.type,
      severity: "high",
      docs,
      locations: missing.map(([, s]) => s),
      expected: `${src.role}.${src.field} ⊆ ${tgt.role}.${tgt.field}`,
      actual: "누락: " + missVals.join(", "),
      message: `${kind.msgPrefix}: ${src.field} 중 ` + missVals.join(", ") + ` 이(가) ${tgt.role}.${tgt.field}에 없음`,
    },
  ];
}
