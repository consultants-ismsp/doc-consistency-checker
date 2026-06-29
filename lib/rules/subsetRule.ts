// 부분집합 룰(자산 정합 등): source ⊆ target. 차집합 적발. cross_ref와 핵심 로직 공유.
import { Model } from "../normalize";
import type { Finding } from "../schema";
import { BaseRule } from "./base";
import { checkSubset } from "./subsetCheck";

export class SubsetRule extends BaseRule {
  static type = "subset";

  check(model: Model): Finding[] {
    return checkSubset(model, this.spec.source, this.spec.target, this.id, {
      errLabel: "subset",
      type: "subset",
      msgPrefix: "자산 정합 누락",
    });
  }
}
