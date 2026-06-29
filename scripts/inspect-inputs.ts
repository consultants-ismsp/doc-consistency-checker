// 실제 산출물 구조 분석용 일회성 인스펙터 (Node/tsx).
// loader는 브라우저 DOMParser 의존이라 여기선 jszip+정규식으로 텍스트만 추출.
import JSZip from "jszip";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "_inputs";

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

async function inspectDocx(name: string, buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml")!.async("string");
  // <w:t> 텍스트 추출
  const texts: string[] = [];
  const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml))) texts.push(decode(m[1]));
  const tableCount = (xml.match(/<w:tbl[ >]/g) || []).length;
  const full = texts.join(" ");
  console.log(`\n========== [DOCX] ${name} ==========`);
  console.log(`텍스트조각 ${texts.length}개, 표 ${tableCount}개, 총길이 ${full.length}`);

  // 통제항목ID 패턴(예 2.6.1)
  const ids = [...full.matchAll(/\b\d+\.\d+\.\d+\b/g)].map((x) => x[0]);
  const uniqIds = [...new Set(ids)];
  console.log(`통제항목ID(d.d.d) 고유 ${uniqIds.length}개:`, uniqIds.slice(0, 30).join(", "));
  // 판정값
  const verdicts = [...full.matchAll(/(적합|부분적합|미흡|이행|미이행|결함|양호|충족|미충족)/g)].map((x) => x[1]);
  const vc: Record<string, number> = {};
  for (const v of verdicts) vc[v] = (vc[v] || 0) + 1;
  console.log("판정어 빈도:", JSON.stringify(vc));
  // 숫자+라벨 후보(라벨 뒤 숫자)
  const numLabels = [...full.matchAll(/([가-힣A-Za-z()·\/\s]{2,18}?)\s*[:：]?\s*(\d{1,4})\s*(건|개|명|점|%|개소|영역|단계)/g)]
    .map((x) => `${x[1].trim()}=${x[2]}${x[3]}`);
  console.log("수치라벨 후보(앞30):", [...new Set(numLabels)].slice(0, 30).join(" | "));
  // 헤딩 후보(절번호로 시작하는 짧은 텍스트)
  const headings = texts.filter((t) => /^\s*\d+(\.\d+)*\s*[.)]?\s*\S/.test(t) && t.length < 40);
  console.log("헤딩/절 후보(앞25):", [...new Set(headings)].slice(0, 25).join(" | "));
  // 앞부분 텍스트 샘플
  console.log("본문 샘플(앞400자):", full.slice(0, 400).replace(/\s+/g, " "));
}

async function inspectXlsx(name: string, buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  const sheetNames = [...wb.matchAll(/<sheet[^>]*\bname="([^"]+)"/g)].map((x) => decode(x[1]));
  const ssFile = zip.file("xl/sharedStrings.xml");
  const ss = ssFile ? await ssFile.async("string") : "";
  const strings: string[] = [];
  const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(ss))) strings.push(decode(m[1]));
  console.log(`\n========== [XLSX] ${name} ==========`);
  console.log(`시트 ${sheetNames.length}개:`, sheetNames.join(" | "));
  console.log(`공유문자열 ${strings.length}개. 고유 헤더후보(앞60):`);
  console.log([...new Set(strings)].slice(0, 60).join(" | "));
  // 통제항목ID
  const ids = [...new Set(strings.join(" ").match(/\b\d+\.\d+\.\d+\b/g) || [])];
  if (ids.length) console.log(`통제항목ID 고유 ${ids.length}개:`, ids.slice(0, 30).join(", "));

  // 각 시트 첫 행(헤더) 추출 — sheet 파일에서 1행 셀
  for (let i = 0; i < sheetNames.length; i++) {
    const sf = zip.file(`xl/worksheets/sheet${i + 1}.xml`);
    if (!sf) continue;
    const sx = await sf.async("string");
    // 첫 <row ...>...</row>
    const rowM = /<row[^>]*>([\s\S]*?)<\/row>/.exec(sx);
    if (!rowM) continue;
    const cells = [...rowM[1].matchAll(/<c[^>]*\bt="s"[^>]*><v>(\d+)<\/v>/g)].map((x) => strings[parseInt(x[1], 10)]);
    const inlineNums = [...rowM[1].matchAll(/<c[^>]*><v>([\s\S]*?)<\/v>/g)].map((x) => x[1]);
    console.log(`  시트[${sheetNames[i]}] 1행:`, (cells.length ? cells : inlineNums).slice(0, 20).join(" | "));
  }
}

(async () => {
  const files = readdirSync(DIR).filter((f) => /\.(docx|xlsx)$/i.test(f));
  for (const f of files.sort()) {
    const buf = readFileSync(join(DIR, f));
    try {
      if (/\.docx$/i.test(f)) await inspectDocx(f, buf);
      else await inspectXlsx(f, buf);
    } catch (e) {
      console.log(`!! ${f} 실패:`, (e as Error).message);
    }
  }
})();
