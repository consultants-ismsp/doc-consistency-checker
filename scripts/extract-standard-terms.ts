// 공식 ISMS-P 표준 용어(통제항목명+분야명) 추출기 (오프라인 1회용).
// 금융보안원 점검항목 안내서 PDF 개요에서 통제항목명/분야명을 뽑아 TS 배열 리터럴로 출력.
// 출력 결과를 lib/config.ts 의 STANDARD_TERMS 에 붙여넣는다(런타임은 PDF를 읽지 않음).
import pdf from "pdf-parse";
import { readFileSync } from "node:fs";

const PDF = "_inputs/금융보안원 - 금융권에 적합한 ISMS-P 인증기준 점검항목 안내서(2023.12.) (1).pdf";

(async () => {
  const d = await pdf(readFileSync(PDF));
  const t = d.text.replace(/\r/g, "");
  const set = new Set<string>();
  // 통제항목명: "1.1.1 경영진의 참여"
  for (const m of t.matchAll(/\n[1-3]\.\d{1,2}\.\d{1,2}\s+([가-힣][가-힣A-Za-z0-9()·  ]{1,28})(?=\n)/g)) {
    set.add(m[1].trim());
  }
  // 분야명: "1.1 관리체계 기반 마련"
  for (const m of t.matchAll(/\n[1-3]\.\d{1,2}\s+([가-힣][가-힣A-Za-z0-9()·  ]{1,24})(?=\n)/g)) {
    if (!/\d/.test(m[1])) set.add(m[1].trim());
  }
  const terms = [...set].sort();
  console.log(`// 공식 ISMS-P 표준 용어 ${terms.length}개 (통제항목명 + 분야명)`);
  console.log("export const STANDARD_TERMS: string[] = [");
  for (let i = 0; i < terms.length; i += 4) {
    console.log("  " + terms.slice(i, i + 4).map((x) => `"${x}"`).join(", ") + ",");
  }
  console.log("];");
})();
