// 합계 일치 룰: 한 역할의 특정 key 수치들을 코드가 모두 더해, 다른 역할의 기준 수치와 같은지 본다.
// 예: 개선과제 카드별 미흡건수 합 == 위험평가 미부분이행건수.
// 합산·비교는 코드가 한다(LLM은 카드별 원문 숫자만 추출). 대상/기준이 없으면 스킵.
import { cmp, Model } from "../normalize";
import type { Finding, Source } from "../schema";
import { BaseRule, RuleError } from "./base";

export class ValueSumMatchRule extends BaseRule {
  static type = "value_sum_match";

  check(model: Model): Finding[] {
    const sumRef = this.spec.sum; // { role, key } — 이 key 수치들을 전부 더한다
    const eqRef = this.spec.equals; // { role, key } — 이 기준 수치와 비교
    if (!sumRef?.role || !sumRef?.key || !eqRef?.role || !eqRef?.key) {
      throw new RuleError(`value_sum_match '${this.id}': sum/equals(role,key) 설정 필요`);
    }

    // 합산 대상 수집(같은 key 여러 건)
    const addends: Array<[number, Source]> = [];
    for (const it of model.items) {
      if (it.field === "number" && it.role === sumRef.role && String(it.key) === String(sumRef.key)) {
        const n = Model.toInt(it.value);
        if (n !== null) addends.push([n, it.source]);
      }
    }
    if (!addends.length) {
      throw new RuleError(`value_sum_match '${this.id}': 합산 대상 없음 (${sumRef.role}.${sumRef.key})`);
    }

    // 기준 수치(문서에 있는 첫 값)
    let base: number | null = null;
    let baseSrc: Source | null = null;
    for (const it of model.items) {
      if (it.field === "number" && it.role === eqRef.role && String(it.key) === String(eqRef.key)) {
        const n = Model.toInt(it.value);
        if (n !== null) {
          base = n;
          baseSrc = it.source;
          break;
        }
      }
    }
    if (base === null || baseSrc === null) {
      throw new RuleError(`value_sum_match '${this.id}': 기준 수치 없음 (${eqRef.role}.${eqRef.key})`);
    }

    const total = addends.reduce((a, [n]) => a + n, 0);
    if (total === base) return [];

    const locs: Source[] = [...addends.map(([, s]) => s), baseSrc];
    return [
      {
        rule_id: this.id,
        type: "value",
        severity: "high",
        docs: [...new Set(locs.map((s) => s.doc))].sort(cmp),
        locations: locs,
        expected: `${sumRef.role}.${sumRef.key} 합 == ${eqRef.role}.${eqRef.key}`,
        actual: `합계 ${total}(${addends.length}건) ≠ ${base}`,
        message: `합계 불일치: ${sumRef.key} 합 ${total} ≠ ${eqRef.key} ${base}`,
      },
    ];
  }
}
