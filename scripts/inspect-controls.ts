// 통제항목 ID 포함관계 확인용 일회성 인스펙터.
import JSZip from "jszip";
import { readFileSync } from "node:fs";

const dec = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// ISMS-P 통제항목 패턴만: 첫자리 1~3, 각 세그먼트 1~2자리, 날짜성 배제
function controls(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b([1-3])\.(\d{1,2})\.(\d{1,2})\b/g)) {
    const a = m[1], b = m[2], c = m[3];
    if (+b > 20 || +c > 40) continue;
    out.add(`${a}.${b}.${c}`);
  }
  return out;
}
async function docxText(p: string) {
  const z = await JSZip.loadAsync(readFileSync(p));
  const x = await z.file("word/document.xml")!.async("string");
  let t = "";
  for (const m of x.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)) t += dec(m[1]) + " ";
  return t;
}
async function xlsxText(p: string) {
  const z = await JSZip.loadAsync(readFileSync(p));
  const f = z.file("xl/sharedStrings.xml");
  if (!f) return "";
  const x = await f.async("string");
  let t = "";
  for (const m of x.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += dec(m[1]) + " ";
  return t;
}
const sub = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x));

(async () => {
  const D = "_inputs/";
  const checklist = controls(await xlsxText(D + "체크리스트_법령 매핑.xlsx"));
  const level = controls((await docxText(D + "브릿지X_수준평가보고서.docx")) + (await xlsxText(D + "브릿지X_수준평가보고서.xlsx")));
  const risk = controls((await docxText(D + "브릿지X_위험평가결과보고서.docx")) + (await xlsxText(D + "브릿지X_위험평가보고서.xlsx")));
  const task = controls(await docxText(D + "브릿지X_개선과제정의서.docx"));
  console.log("checklist 통제번호:", checklist.size);
  console.log("level_eval 통제항목:", level.size);
  console.log("risk_eval 통제항목:", risk.size);
  console.log("task_def 통제항목:", task.size);
  console.log("--- 포함관계(누락 = 마스터 checklist에 없는 항목) ---");
  console.log("level ⊄ checklist 누락:", sub(level, checklist).sort().join(",") || "(완전포함)");
  console.log("risk  ⊄ checklist 누락:", sub(risk, checklist).sort().join(",") || "(완전포함)");
  console.log("task  ⊄ checklist 누락:", sub(task, checklist).sort().join(",") || "(완전포함)");
  console.log("task  ⊄ level     누락:", sub(task, level).sort().join(",") || "(완전포함)");
  console.log("checklist 샘플:", [...checklist].sort().slice(0, 20).join(","));
})().catch((e) => console.error(e));
