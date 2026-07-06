// 진단 하네스 — out/extracted/*.json 을 읽어 룰·용어를 돌리고 결과를 리포트한다.
// LLM 호출 없음(추출 캐시만 사용). 룰/용어를 고칠 때마다 이걸로 즉시 재검사한다.
//
// 사용: npx tsx scripts/diagnose.ts

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { runChecksOnly } from "../lib/pipeline";
import { RULES_BRIDGEX, GLOSSARY_DEFAULT, buildProperNouns } from "../lib/config";
import type { ExtractedItem } from "../lib/schema";

function arg(flag: string): string | undefined {
  const hit = process.argv.find((a) => a === flag || a.startsWith(flag + "="));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.split("=").slice(1).join("=") : "";
}
const OUT_DIR = resolve(__dirname, "..", arg("--dir") || "out/extracted");

function loadExtracted(): { groups: ExtractedItem[][]; docs: Array<{ name: string; role: string; n: number }> } {
  const files = readdirSync(OUT_DIR).filter((f) => f.endsWith(".json")).sort();
  const groups: ExtractedItem[][] = [];
  const docs: Array<{ name: string; role: string; n: number }> = [];
  for (const f of files) {
    const j = JSON.parse(readFileSync(resolve(OUT_DIR, f), "utf8"));
    const items = (j.items ?? []) as ExtractedItem[];
    groups.push(items);
    docs.push({ name: j.file ?? j.name ?? f, role: j.role ?? "?", n: items.length });
  }
  return { groups, docs };
}

function main() {
  const { groups, docs } = loadExtracted();
  if (!docs.length) {
    console.error("out/extracted/ 에 추출 JSON이 없습니다. 먼저 extract-inputs 를 돌리세요.");
    process.exit(1);
  }

  console.log("=== 추출 문서 ===");
  const roles = new Set<string>();
  for (const d of docs) {
    roles.add(d.role);
    console.log(`  ${d.role.padEnd(11)} ${d.name}  (항목 ${d.n})`);
  }

  // 역할×필드 커버리지 — 어떤 필드가 실제로 뽑혔는지(룰 발동 전제)
  console.log("\n=== 역할별 필드 커버리지 ===");
  const roleField = new Map<string, Map<string, number>>();
  for (const g of groups) {
    for (const it of g) {
      if (!roleField.has(it.role)) roleField.set(it.role, new Map());
      const m = roleField.get(it.role)!;
      const fk = it.field === "number" || it.field === "verdict" ? `${it.field}:${it.key ?? "?"}` : it.field;
      m.set(fk, (m.get(fk) || 0) + 1);
    }
  }
  for (const [role, m] of [...roleField.entries()].sort()) {
    const parts = [...m.entries()].sort().map(([k, v]) => `${k}(${v})`).join(", ");
    console.log(`  ${role}: ${parts}`);
  }

  // 룰 실행
  const { findings, skipped } = runChecksOnly(groups, RULES_BRIDGEX, GLOSSARY_DEFAULT, {}, buildProperNouns());

  console.log("\n=== 룰 발동 결과 ===");
  const firedIds = new Set(findings.map((f) => f.rule_id.split(":")[0]));
  const skippedIds = new Set(skipped.map(([id]) => id));
  for (const r of RULES_BRIDGEX) {
    const rid = String(r.id);
    const status = skippedIds.has(rid) ? "스킵" : firedIds.has(rid) ? "★적발" : "통과(이상없음)";
    console.log(`  [${status}] ${rid}`);
  }
  if (skipped.length) {
    console.log("\n  스킵 사유:");
    for (const [id, reason] of skipped) console.log(`   - ${id}: ${reason}`);
  }

  console.log(`\n=== 적발(Finding) ${findings.length}건 ===`);
  const byType: Record<string, number> = {};
  for (const f of findings) byType[f.type] = (byType[f.type] || 0) + 1;
  console.log("  유형별:", Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(" ") || "(없음)");
  for (const f of findings) {
    console.log(`\n  • [${f.severity}] ${f.rule_id}`);
    console.log(`    ${f.message}`);
    if (f.locations?.length) {
      const loc = f.locations[0];
      console.log(`    출처: ${loc.doc} §${loc.section} — "${(loc.snippet || "").slice(0, 60)}"  (외 ${f.locations.length - 1}곳)`);
    }
  }
}

main();
