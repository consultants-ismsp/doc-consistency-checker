// 룰 엔진: 설정의 type 문자열 → 룰 클래스 매핑, 순회·실행.
// 참조 역할/필드가 없으면 그 룰만 '검사 불가'로 스킵하고 알린다(전체 중단 금지).
// Python core/rules/engine.py 동작 재현.
import { Model } from "../normalize";
import type { Finding, RuleSpec } from "../schema";
import { BaseRule, RuleError } from "./base";
import { CrossRefRule } from "./crossRefRule";
import { DependencyRule } from "./dependencyRule";
import { SubsetRule } from "./subsetRule";
import { ValueFormulaRule, ValueMatchRule } from "./valueRule";
import { ValueSumMatchRule } from "./valueSumRule";

type RuleCtor = new (spec: RuleSpec) => BaseRule;

const RULE_MAP: Record<string, RuleCtor> = {
  value_match: ValueMatchRule,
  value_formula: ValueFormulaRule,
  value_sum_match: ValueSumMatchRule,
  cross_reference: CrossRefRule,
  dependency: DependencyRule,
  subset: SubsetRule,
};

export class RuleEngine {
  private map: Record<string, RuleCtor>;
  skipped: Array<[string, string]> = []; // (rule_id, 사유)

  constructor(ruleMap?: Record<string, RuleCtor>) {
    this.map = ruleMap ?? RULE_MAP;
  }

  build(spec: RuleSpec): BaseRule {
    const cls = spec.type ? this.map[spec.type] : undefined;
    if (!cls) throw new RuleError(`알 수 없는 룰 type: ${spec.type}`);
    return new cls(spec);
  }

  run(spec: RuleSpec, model: Model): Finding[] {
    try {
      const rule = this.build(spec);
      return rule.check(model);
    } catch (e) {
      if (e instanceof RuleError) {
        this.skipped.push([spec.id ?? "?", e.message]);
        return [];
      }
      throw e;
    }
  }

  runAll(specs: RuleSpec[], model: Model): Finding[] {
    let findings: Finding[] = [];
    for (const spec of specs) findings = findings.concat(this.run(spec, model));
    return findings;
  }
}
