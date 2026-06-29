// 룰 베이스. Python core/rules/base.py 동등.
import type { Model } from "../normalize";
import type { Finding, RuleSpec } from "../schema";

// 검사 불가(참조 역할/필드 없음 등) → 엔진이 잡아 해당 룰만 스킵한다.
export class RuleError extends Error {}

export abstract class BaseRule {
  spec: RuleSpec;
  id: string;
  static type: string;

  constructor(spec: RuleSpec) {
    this.spec = spec;
    this.id = spec.id ?? "?";
  }

  abstract check(model: Model): Finding[];
}
