// 수치 룰: value_match(역할 간 동일) / value_formula(검산). 계산은 코드가 한다.
// Python core/rules/value_rule.py 동작 재현.
import { Model } from "../normalize";
import type { ExtractedItem, Finding } from "../schema";
import { BaseRule, RuleError } from "./base";

export class ValueMatchRule extends BaseRule {
  static type = "value_match";

  check(model: Model): Finding[] {
    const key = String(this.spec.key);
    const roles = new Set<string>(this.spec.must_equal_across ?? []);

    // 지정 역할들에서 '문서별' 수치값을 모은다(문서당 첫 값).
    const perDoc = new Map<string, ExtractedItem>();
    for (const it of model.items) {
      if (it.field === "number" && roles.has(it.role) && String(it.key) === key) {
        if (!perDoc.has(it.doc)) perDoc.set(it.doc, it);
      }
    }
    if (perDoc.size < 2) {
      throw new RuleError(`value_match '${this.id}': '${key}' 값을 가진 문서가 2개 미만`);
    }

    // 숫자 핵심으로 비교(단위·기호 무시): '101개'→101, '3구간'→3, '69.9%'→69.9.
    const norm = (v: unknown): string => {
      const m = String(v).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
      return m ? m[0] : String(v).replace(/ /g, "").trim();
    };

    const distinct = new Set([...perDoc.values()].map((it) => norm(it.value)));
    if (distinct.size > 1) {
      const sorted = [...perDoc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const actual = sorted.map(([d, it]) => `${d}=${it.value}`).join(", ");
      return [
        {
          rule_id: this.id,
          type: "value",
          severity: "high",
          docs: [...perDoc.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
          locations: [...perDoc.values()].map((it) => it.source),
          expected: `${key} 문서 간 동일`,
          actual,
          message: `수치 불일치: '${key}'이(가) 문서마다 다름 (${actual})`,
        },
      ];
    }
    return [];
  }
}

export class ValueFormulaRule extends BaseRule {
  static type = "value_formula";

  check(model: Model): Finding[] {
    const expr = String(this.spec.expr);
    const ns = model.numbersNamespace();
    const needed = namesIn(expr);
    const missing = needed.filter((n) => !(n in ns));
    if (missing.length) {
      throw new RuleError(`value_formula '${this.id}': 값 없음 ${JSON.stringify(missing)}`);
    }

    const ok = safeEval(expr, ns);
    if (!ok) {
      const locs = model.items
        .filter((it) => it.field === "number" && it.key !== null && needed.includes(it.key))
        .map((it) => it.source);
      const actual = needed.map((n) => `${n}=${ns[n]}`).join(", ");
      return [
        {
          rule_id: this.id,
          type: "value",
          severity: "high",
          docs: [...new Set(locs.map((s) => s.doc))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
          locations: locs,
          expected: `${expr} 참`,
          actual,
          message: `검산 실패: ${expr} (${actual})`,
        },
      ];
    }
    return [];
  }
}

// --- 안전한 산식 평가 (LLM 아님, 코드가 계산) ---
// 한글 식별자를 포함하는 식을 직접 토크나이즈/파싱해 평가한다.
// 지원: + - * / %, 단항 -, 비교 == != < <= > >=, 괄호, 이름, 숫자 상수.

type Tok = { t: string; v: string };

function tokenize(expr: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const ops = ["==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/", "%", "(", ")"];
  while (i < expr.length) {
    const c = expr[i];
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    let matched = false;
    for (const op of ops) {
      if (expr.startsWith(op, i)) {
        toks.push({ t: "op", v: op });
        i += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    // 숫자
    const num = /^\d+(?:\.\d+)?/.exec(expr.slice(i));
    if (num) {
      toks.push({ t: "num", v: num[0] });
      i += num[0].length;
      continue;
    }
    // 이름: 공백/연산자/괄호가 아닌 연속 문자(한글 포함)
    const nm = /^[^\s+\-*/%()<>=!]+/.exec(expr.slice(i));
    if (nm) {
      toks.push({ t: "name", v: nm[0] });
      i += nm[0].length;
      continue;
    }
    throw new RuleError(`허용되지 않은 문자: ${c}`);
  }
  return toks;
}

export function namesIn(expr: string): string[] {
  const names = new Set<string>();
  for (const tk of tokenize(expr)) if (tk.t === "name") names.add(tk.v);
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function safeEval(expr: string, ns: Record<string, number>): boolean {
  const toks = tokenize(expr);
  let pos = 0;
  const peek = () => toks[pos];
  const eat = () => toks[pos++];

  // 비교(최하위) → 덧셈 → 곱셈 → 단항 → 기본
  function parseCompare(): number | boolean {
    let left: any = parseAdd();
    const tk = peek();
    if (tk && tk.t === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(tk.v)) {
      eat();
      const right: any = parseAdd();
      switch (tk.v) {
        case "==": return left === right;
        case "!=": return left !== right;
        case "<": return left < right;
        case "<=": return left <= right;
        case ">": return left > right;
        case ">=": return left >= right;
      }
    }
    return left;
  }
  function parseAdd(): number {
    let left = parseMul();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = eat().v;
      const right = parseMul();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseMul(): number {
    let left = parseUnary();
    while (peek() && peek().t === "op" && ["*", "/", "%"].includes(peek().v)) {
      const op = eat().v;
      const right = parseUnary();
      left = op === "*" ? left * right : op === "/" ? left / right : left % right;
    }
    return left;
  }
  function parseUnary(): number {
    if (peek() && peek().t === "op" && peek().v === "-") {
      eat();
      return -parseUnary();
    }
    return parsePrimary();
  }
  function parsePrimary(): number {
    const tk = eat();
    if (!tk) throw new RuleError("식이 비정상 종료됨");
    if (tk.t === "num") return parseFloat(tk.v);
    if (tk.t === "name") {
      if (!(tk.v in ns)) throw new RuleError(`이름 없음: ${tk.v}`);
      return ns[tk.v];
    }
    if (tk.t === "op" && tk.v === "(") {
      const v = parseCompare();
      const close = eat();
      if (!close || close.v !== ")") throw new RuleError("괄호 짝 안 맞음");
      return v as number;
    }
    throw new RuleError(`허용되지 않은 토큰: ${tk.v}`);
  }

  const result = parseCompare();
  if (pos !== toks.length) throw new RuleError("식 파싱 미완료");
  return Boolean(result);
}
