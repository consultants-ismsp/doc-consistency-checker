// 추출 결과(ExtractedItem[]) → 룰이 비교할 공통 모델(Model).
// Python core/normalize.py 의 동작을 그대로 재현한다.
// Model은 도메인 무지. 판정·계산은 안 한다(룰엔진 몫).

import type { ExtractedItem, Finding, Source } from "./schema";

export class Model {
  items: ExtractedItem[];
  // items 는 생성 후 불변 → 반복 호출되는 파생값은 1회만 계산해 캐시한다.
  private _ns?: Record<string, number>;
  private _verdicts?: Record<string, ExtractedItem>;

  constructor(items: ExtractedItem[] = []) {
    this.items = items;
  }

  // 검산용 네임스페이스 {수치이름: 값}. 역할 무관 합치고, 충돌 나면 첫 값 유지.
  numbersNamespace(): Record<string, number> {
    if (this._ns) return this._ns;
    const ns: Record<string, number> = {};
    for (const it of this.items) {
      if (it.field !== "number" || it.key == null) continue;
      const val = Model.toInt(it.value);
      if (val === null) continue;
      if (it.key in ns) {
        // 충돌(불일치)은 value_match가 따로 잡음 → 첫 값 유지
        continue;
      }
      ns[it.key] = val;
    }
    this._ns = ns;
    return ns;
  }

  // 역할+필드의 값 목록 [(value, Source)] (cross_ref/subset용)
  fieldValues(role: string, fname: string): Array<[string, Source]> {
    const out: Array<[string, Source]> = [];
    for (const it of this.items) {
      if (it.role === role && it.field === fname) {
        out.push([String(it.value), it.source]);
      }
    }
    return out;
  }

  roles(): Set<string> {
    return new Set(this.items.map((it) => it.role));
  }

  // 판정 항목들 {key: ExtractedItem} — 같은 key 중복 시 마지막이 유지(Python dict와 동일)
  verdictItems(): Record<string, ExtractedItem> {
    if (this._verdicts) return this._verdicts;
    const out: Record<string, ExtractedItem> = {};
    for (const it of this.items) {
      if (it.field === "verdict" && it.key) {
        out[String(it.key)] = it;
      }
    }
    this._verdicts = out;
    return out;
  }

  verdict(key: string): string | null {
    const it = this.verdictItems()[String(key)];
    return it ? Model.normVerdict(it.value) : null;
  }

  // 계층 쌍 [(부모키, 자식키)]: 점 표기 prefix로 추정. 2.6 ⊃ 2.6.1
  hierarchyPairs(): Array<[string, string]> {
    const keys = Object.keys(this.verdictItems());
    const keySet = new Set(keys);
    const pairs: Array<[string, string]> = [];
    for (const child of keys) {
      const parent = child.includes(".") ? child.slice(0, child.lastIndexOf(".")) : null;
      if (parent && keySet.has(parent)) pairs.push([parent, child]);
    }
    return pairs;
  }

  static toInt(value: unknown): number | null {
    if (typeof value === "boolean") return null;
    if (typeof value === "number" && Number.isInteger(value)) return value;
    const m = String(value).replace(/,/g, "").match(/-?\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  // 판정값 표기 정규화(적합/부분적합/미흡 → Y/P/N). 비교 편의용, 값 자체는 보존.
  static normVerdict(value: unknown): string {
    if (typeof value === "boolean") return value === false ? "N" : "Y";
    const raw = String(value).trim();
    const s = raw.toUpperCase();
    const table: Record<string, string> = {
      적합: "Y",
      Y: "Y",
      부분적합: "P",
      P: "P",
      미흡: "N",
      N: "N",
    };
    if (raw in table) return table[raw];
    if (s in table) return table[s];
    return s;
  }
}

export function build(extracted: ExtractedItem[][]): Model {
  const items: ExtractedItem[] = [];
  for (const group of extracted) items.push(...group);
  return new Model(items);
}

// 무엇의 값인지 알 수 없는 일반 집계어 단독 라벨 — 비교하면 오탐(요구사항 총계 vs 투입 총계).
// 라벨이 '총계'처럼 일반어 하나뿐이면 비교에서 제외. ('요구사항 총계'처럼 맥락 붙으면 비교함.)
const GENERIC_NUMBER_LABELS = new Set<string>([
  "총계", "합계", "계", "소계", "총합", "합", "전체", "수량", "개수", "건수",
  "total", "sum", "subtotal", "count", "qty",
]);

function isGenericLabel(key: string): boolean {
  const norm = String(key).replace(/ /g, "").trim().toLowerCase();
  return GENERIC_NUMBER_LABELS.has(norm);
}

// 역할 없이 동작하는 자동 수치 교차 비교.
// 같은 항목명(key)이 2개 이상 '다른 문서'에 나오는데 값이 갈리면 적발.
// 단, '총계/합계' 같은 일반 집계어 단독 라벨은 제외한다.
export function autoValueConsistency(
  model: Model,
  skipKeys?: Set<string>,
  excludeRoles?: ReadonlySet<string>
): Finding[] {
  const skip = skipKeys ?? new Set<string>();
  const exRoles = excludeRoles;
  const byKey = new Map<string, ExtractedItem[]>();
  for (const it of model.items) {
    if (exRoles && exRoles.has(it.role)) continue; // reference 역할(RFP)은 자동 수치 비교 제외
    if (
      it.field === "number" &&
      it.key &&
      !skip.has(it.key) &&
      !isGenericLabel(it.key)
    ) {
      const k = String(it.key);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(it);
    }
  }

  const findings: Finding[] = [];
  for (const [key, items] of byKey) {
    // 문서당 첫 값만(같은 문서 내 중복은 비교 대상 아님)
    const perDoc = new Map<string, ExtractedItem>();
    for (const it of items) {
      if (!perDoc.has(it.doc)) perDoc.set(it.doc, it);
    }
    if (perDoc.size < 2) continue; // 한 문서에만 있으면 비교 불가
    const vals = new Set<number>();
    for (const it of perDoc.values()) {
      const v = Model.toInt(it.value);
      if (v !== null) vals.add(v);
    }
    if (vals.size > 1) {
      const sortedDocs = [...perDoc.entries()].sort((a, b) => cmp(a[0], b[0]));
      const actual = sortedDocs
        .map(([d, it]) => `${d}=${Model.toInt(it.value)}`)
        .join(", ");
      findings.push({
        rule_id: `auto-value:${key}`,
        type: "value",
        severity: "high",
        docs: [...perDoc.keys()].sort(cmp),
        locations: [...perDoc.values()].map((it) => it.source),
        expected: `${key} 문서 간 동일`,
        actual,
        message: `수치 불일치(자동): '${key}'이(가) 문서마다 다름 — ${actual}`,
      });
    }
  }
  return findings;
}

// Python sorted()는 코드포인트 기준 — JS 기본 정렬(UTF-16)과 BMP 영역에서 동일.
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
