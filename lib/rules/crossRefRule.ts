// 연계 룰: source 집합 ⊆ target 집합. 차집합(누락)을 적발. 핵심 로직은 checkSubset 공유.
import { Model } from "../normalize";
import type { Finding } from "../schema";
import { BaseRule, RuleError } from "./base";
import { checkSubset } from "./subsetCheck";

export class CrossRefRule extends BaseRule {
  static type = "cross_reference";

  check(model: Model): Finding[] {
    const relation = this.spec.relation ?? "subset";
    if (relation !== "subset") {
      throw new RuleError(`cross_reference '${this.id}': 미지원 relation ${relation}`);
    }
    return checkSubset(model, this.spec.source, this.spec.target, this.id, {
      errLabel: "cross_reference",
      type: "cross_ref",
      msgPrefix: "연계 누락",
    });
  }
}
