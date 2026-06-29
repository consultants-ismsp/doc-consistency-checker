// 종속 룰: 판정 종속 모순 적발. Python core/rules/dependency_rule.py 동작 재현.
// - structural: 계층(2.6 ⊃ 2.6.1)에서 부모가 N/P인데 자식이 Y면 모순. 전체 자동.
// - semantic: if 항목 판정이 성립하고 then_not 판정도 성립하면 모순. 핵심만 수기.
import { cmp, Model } from "../normalize";
import type { Finding, Source } from "../schema";
import { BaseRule, RuleError } from "./base";

export class DependencyRule extends BaseRule {
  static type = "dependency";

  check(model: Model): Finding[] {
    const mode = this.spec.mode;
    if (mode === "structural") return this.structural(model);
    if (mode === "semantic") return this.semantic(model);
    throw new RuleError(`dependency '${this.id}': 알 수 없는 mode ${mode}`);
  }

  private structural(model: Model): Finding[] {
    const verdicts = model.verdictItems();
    const findings: Finding[] = [];
    for (const [parent, child] of model.hierarchyPairs()) {
      const pv = model.verdict(parent);
      const cv = model.verdict(child);
      if ((pv === "N" || pv === "P") && cv === "Y") {
        const locs: Source[] = [verdicts[parent].source, verdicts[child].source];
        findings.push({
          rule_id: this.id,
          type: "dependency",
          severity: "high",
          docs: [...new Set(locs.map((s) => s.doc))].sort(cmp),
          locations: locs,
          expected: `부모 ${parent}=${pv}면 자식 ${child}는 Y 불가`,
          actual: `${parent}=${pv}, ${child}=${cv}`,
          message: `구조적 종속 모순: 부모 ${parent}=${pv}인데 자식 ${child}=${cv}`,
        });
      }
    }
    return findings;
  }

  private semantic(model: Model): Finding[] {
    const cond = this.spec.if;
    const forbid = this.spec.then_not;
    const verdicts = model.verdictItems();
    const iv = model.verdict(cond.item);
    const tv = model.verdict(forbid.item);
    if (iv === null || tv === null) {
      throw new RuleError(
        `dependency '${this.id}': 항목 판정 없음 (${cond.item} 또는 ${forbid.item})`
      );
    }

    if (iv === norm(cond.verdict) && tv === norm(forbid.verdict)) {
      const locs: Source[] = [verdicts[String(cond.item)].source, verdicts[String(forbid.item)].source];
      return [
        {
          rule_id: this.id,
          type: "dependency",
          severity: "high",
          docs: [...new Set(locs.map((s) => s.doc))].sort(cmp),
          locations: locs,
          expected: `${cond.item}=${cond.verdict}면 ${forbid.item}=${forbid.verdict} 불가`,
          actual: `${cond.item}=${iv}, ${forbid.item}=${tv}`,
          message: `의미적 종속 모순: ${cond.item}=${iv}인데 ${forbid.item}=${tv}`,
        },
      ];
    }
    return [];
  }
}

// YAML이 no/yes를 불리언으로 바꿀 수 있어 방어(판정 스킴은 Y/P/N).
function norm(v: unknown): string {
  if (typeof v === "boolean") return v === false ? "N" : "Y";
  const table: Record<string, string> = { 적합: "Y", 부분적합: "P", 미흡: "N" };
  const s = String(v).trim();
  return s in table ? table[s] : s.toUpperCase();
}
