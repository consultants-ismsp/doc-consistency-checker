// 공통 차집합(누락) 검사: source 집합 ⊆ target 집합인지 보고, 빠진 값을 적발.
// cross_reference(연계)와 subset(자산 정합)이 같은 로직을 공유한다 — 라벨/메시지/type만 다름.
import { cmp, Model } from "../normalize";
import type { Finding } from "../schema";
import { RuleError } from "./base";

interface Ref {
  role: string;
  field: string;
}
interface SubsetKind {
  errLabel: string; // RuleError 접두("cross_reference" | "subset")
  type: "cross_ref" | "subset"; // Finding.type
  msgPrefix: string; // 메시지 접두("연계 누락" | "자산 정합 누락")
}

export function checkSubset(model: Model, src: Ref, tgt: Ref, id: string, kind: SubsetKind): Finding[] {
  const srcVals = model.fieldValues(src.role, src.field);
  const tgtVals = model.fieldValues(tgt.role, tgt.field);
  // 한쪽이 통째로 없으면 '검사 불가'로 스킵 — 없다고 전부 누락 처리하지 않는다.
  if (srcVals.length === 0) {
    throw new RuleError(`${kind.errLabel} '${id}': source 값 없음 (${src.role}.${src.field})`);
  }
  if (tgtVals.length === 0) {
    throw new RuleError(`${kind.errLabel} '${id}': target 값 없음 → 검사 불가 (${tgt.role}.${tgt.field})`);
  }

  const targetSet = new Set(tgtVals.map(([v]) => v));
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
