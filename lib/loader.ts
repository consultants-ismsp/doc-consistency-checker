// docx 로더 (브라우저). Python core/loader.py 동작 재현.
// jszip로 word/document.xml 을 풀어 단락/표 셀을 순서대로 뽑고 위치 메타(절번호 추정)를 붙인다.
// 같은 출처 위치 정보(절/단락/표 좌표)를 만든다.
import JSZip from "jszip";

export interface Block {
  text: string;
  kind: "para" | "cell";
  section: string;
  para_index: number;
  table_pos: [number, number, number] | null;
  heading: string; // 가장 가까운 제목 텍스트(사람이 찾기 쉬운 앵커). 없으면 ""
  cell: string; // 셀 주소 문자열. 엑셀 "B12" / docx 표 "표3 · 5행 2열". 표 아니면 ""
}

export interface ParsedDoc {
  file: string;
  role: string;
  blocks: Block[];
}

const SECTION_RE = /^\s*(\d+(?:\.\d+)*)/;
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// styleId -> 표시 이름(styles.xml). 없으면 styleId 그대로.
function buildStyleNames(stylesXml: Document | null): Record<string, string> {
  const map: Record<string, string> = {};
  if (!stylesXml) return map;
  const styles = stylesXml.getElementsByTagNameNS(W_NS, "style");
  for (let i = 0; i < styles.length; i++) {
    const st = styles[i];
    const id = st.getAttributeNS(W_NS, "styleId") || st.getAttribute("w:styleId");
    if (!id) continue;
    const nameEls = st.getElementsByTagNameNS(W_NS, "name");
    const name = nameEls.length ? nameEls[0].getAttributeNS(W_NS, "val") || nameEls[0].getAttribute("w:val") : null;
    map[id] = name || id;
  }
  return map;
}

function childrenByLocal(parent: Element, local: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (n.nodeType === 1 && (n as Element).localName === local) out.push(n as Element);
  }
  return out;
}

// 단락의 텍스트 = 모든 <w:t> 이어붙임(python-docx para.text 와 동등).
function paragraphText(p: Element): string {
  const ts = p.getElementsByTagNameNS(W_NS, "t");
  let s = "";
  for (let i = 0; i < ts.length; i++) s += ts[i].textContent || "";
  return s;
}

function pStyleId(p: Element): string {
  const pPrs = childrenByLocal(p, "pPr");
  if (!pPrs.length) return "";
  const styles = childrenByLocal(pPrs[0], "pStyle");
  if (!styles.length) return "";
  return styles[0].getAttributeNS(W_NS, "val") || styles[0].getAttribute("w:val") || "";
}

// 셀 텍스트 = 셀 안 단락들을 "\n"으로 이어붙임(python-docx _Cell.text 와 동등).
function cellText(tc: Element): string {
  const ps = tc.getElementsByTagNameNS(W_NS, "p");
  const parts: string[] = [];
  for (let i = 0; i < ps.length; i++) parts.push(paragraphText(ps[i]));
  return parts.join("\n");
}

function isHeading(styleId: string, styleName: string): boolean {
  const id = styleId || "";
  const name = styleName || "";
  return (
    /^heading/i.test(id) ||
    /^heading/i.test(name) ||
    id.startsWith("제목") ||
    name.startsWith("제목")
  );
}

function headingLevel(styleId: string, styleName: string): number {
  const m = (styleId + " " + styleName).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

function updateSection(text: string, styleId: string, styleName: string, headingNums: number[]): string {
  // 본문에 명시 절번호가 있으면 그대로 신뢰.
  const m = SECTION_RE.exec(text);
  if (m) return m[1];
  // 없으면 제목 계층으로 추정.
  const level = headingLevel(styleId, styleName);
  if (level <= 0) return "";
  while (headingNums.length < level) headingNums.push(0);
  headingNums.length = level; // del heading_nums[level:]
  headingNums[level - 1] += 1;
  return headingNums.map((n) => String(n)).join(".");
}

export async function parseDocx(fileName: string, data: ArrayBuffer, role: string): Promise<ParsedDoc> {
  const zip = await JSZip.loadAsync(data);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error(`문서를 찾을 수 없음(word/document.xml): ${fileName}`);
  const docXmlStr = await docFile.async("string");
  const stylesFile = zip.file("word/styles.xml");
  const stylesStr = stylesFile ? await stylesFile.async("string") : null;

  const parser = new DOMParser();
  const docXml = parser.parseFromString(docXmlStr, "application/xml");
  const stylesXml = stylesStr ? parser.parseFromString(stylesStr, "application/xml") : null;
  const styleNames = buildStyleNames(stylesXml);

  const bodies = docXml.getElementsByTagNameNS(W_NS, "body");
  const doc: ParsedDoc = { file: fileName, role, blocks: [] };
  if (!bodies.length) return doc;
  const body = bodies[0];

  let section = "";
  let heading = ""; // 가장 최근 제목 단락의 텍스트(사람이 눈으로 찾는 앵커)
  const headingNums: number[] = [];
  let paraIndex = 0;
  let tableNo = 0;

  for (let i = 0; i < body.childNodes.length; i++) {
    const node = body.childNodes[i];
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const local = el.localName;

    if (local === "p") {
      const rawText = paragraphText(el);
      const text = rawText.trim();
      const styleId = pStyleId(el);
      const styleName = styleNames[styleId] || "";
      if (isHeading(styleId, styleName)) {
        section = updateSection(text, styleId, styleName, headingNums);
        heading = text; // 제목 텍스트 그대로 기억(번호가 붙어있으면 함께)
      }
      if (text) {
        doc.blocks.push({ text, kind: "para", section, para_index: paraIndex, table_pos: null, heading, cell: "" });
      }
      paraIndex += 1;
    } else if (local === "tbl") {
      tableNo += 1;
      const rows = childrenByLocal(el, "tr");
      for (let r = 0; r < rows.length; r++) {
        const cells = childrenByLocal(rows[r], "tc");
        for (let c = 0; c < cells.length; c++) {
          const text = cellText(cells[c]).trim();
          if (text) {
            doc.blocks.push({
              text,
              kind: "cell",
              section,
              para_index: paraIndex,
              table_pos: [tableNo, r, c],
              heading,
              cell: `표${tableNo} · ${r + 1}행 ${c + 1}열`,
            });
          }
        }
      }
      paraIndex += 1;
    }
  }
  return doc;
}

// ── xlsx 로더 ──
// xlsx도 zip이라 같은 jszip로 푼다. 시트의 셀을 순서대로 뽑아 docx와 같은 Block 구조로 만든다.
// 매핑: 시트명 → section, (시트번호, 행, 열) → table_pos, kind="cell".
// 그래서 normalize/terms/rules/report 는 손대지 않아도 그대로 동작한다.
const SP_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// 셀 참조 "B3" → 0-based 열/행 인덱스.
function colIndexOf(ref: string): number {
  const m = /^([A-Za-z]+)/.exec(ref);
  if (!m) return 0;
  const letters = m[1].toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 64);
  return col - 1;
}
function rowIndexOf(ref: string, fallback: number): number {
  const m = /(\d+)$/.exec(ref);
  return m ? parseInt(m[1], 10) - 1 : fallback;
}
// 0-based 열 인덱스 → 엑셀 열문자(0→A, 26→AA). colIndexOf 의 역.
function colLetter(idx0: number): string {
  let n = idx0 + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// sharedStrings: <si> 안의 모든 <t>를 이어붙임(리치텍스트 런 <r><t> 포함).
function parseSharedStrings(xml: Document | null): string[] {
  const out: string[] = [];
  if (!xml) return out;
  const sis = xml.getElementsByTagNameNS(SP_NS, "si");
  for (let i = 0; i < sis.length; i++) {
    const ts = sis[i].getElementsByTagNameNS(SP_NS, "t");
    let s = "";
    for (let j = 0; j < ts.length; j++) s += ts[j].textContent || "";
    out.push(s);
  }
  return out;
}

function xlsxCellText(c: Element, shared: string[]): string {
  const t = c.getAttribute("t");
  if (t === "inlineStr") {
    const ts = c.getElementsByTagNameNS(SP_NS, "t");
    let s = "";
    for (let i = 0; i < ts.length; i++) s += ts[i].textContent || "";
    return s.trim();
  }
  const vs = c.getElementsByTagNameNS(SP_NS, "v");
  const raw = vs.length ? vs[0].textContent || "" : "";
  if (t === "s") {
    const idx = parseInt(raw, 10);
    return Number.isNaN(idx) ? "" : (shared[idx] ?? "").trim();
  }
  // 숫자·수식문자열(str)·불리언 등은 캐시된 값(<v>)을 그대로.
  return raw.trim();
}

// workbook 의 시트 순서·이름과, rels로 실제 시트 파일 경로를 푼다.
function resolveSheets(
  workbookXml: Document,
  relsXml: Document | null
): Array<{ name: string; path: string }> {
  const ridToTarget = new Map<string, string>();
  if (relsXml) {
    const rels = relsXml.getElementsByTagNameNS(PKG_REL_NS, "Relationship");
    for (let i = 0; i < rels.length; i++) {
      const id = rels[i].getAttribute("Id");
      let target = rels[i].getAttribute("Target") || "";
      if (!id || !target) continue;
      // Target은 xl/ 기준 상대경로(예: worksheets/sheet1.xml)
      target = target.replace(/^\//, "");
      ridToTarget.set(id, target.startsWith("xl/") ? target : `xl/${target}`);
    }
  }
  const out: Array<{ name: string; path: string }> = [];
  const sheets = workbookXml.getElementsByTagNameNS(SP_NS, "sheet");
  for (let i = 0; i < sheets.length; i++) {
    const name = sheets[i].getAttribute("name") || `Sheet${i + 1}`;
    const rid = sheets[i].getAttributeNS(OFFICE_REL_NS, "id") || sheets[i].getAttribute("r:id") || "";
    const path = ridToTarget.get(rid) || `xl/worksheets/sheet${i + 1}.xml`;
    out.push({ name, path });
  }
  return out;
}

export async function parseXlsx(fileName: string, data: ArrayBuffer, role: string): Promise<ParsedDoc> {
  const zip = await JSZip.loadAsync(data);
  const wbFile = zip.file("xl/workbook.xml");
  if (!wbFile) throw new Error(`엑셀 워크북을 찾을 수 없음(xl/workbook.xml): ${fileName}`);

  const parser = new DOMParser();
  const workbookXml = parser.parseFromString(await wbFile.async("string"), "application/xml");
  const relsFile = zip.file("xl/_rels/workbook.xml.rels");
  const relsXml = relsFile ? parser.parseFromString(await relsFile.async("string"), "application/xml") : null;
  const ssFile = zip.file("xl/sharedStrings.xml");
  const shared = parseSharedStrings(ssFile ? parser.parseFromString(await ssFile.async("string"), "application/xml") : null);

  const doc: ParsedDoc = { file: fileName, role, blocks: [] };
  const sheets = resolveSheets(workbookXml, relsXml);
  let paraIndex = 0;

  for (let s = 0; s < sheets.length; s++) {
    const sheetNo = s + 1;
    const sheetName = sheets[s].name;
    const sf = zip.file(sheets[s].path);
    if (!sf) continue;
    const sheetXml = parser.parseFromString(await sf.async("string"), "application/xml");
    const rows = sheetXml.getElementsByTagNameNS(SP_NS, "row");
    for (let r = 0; r < rows.length; r++) {
      const rowAttr = rows[r].getAttribute("r");
      const rowIdx = rowAttr ? parseInt(rowAttr, 10) - 1 : r;
      const cells = childrenByLocal(rows[r], "c");
      for (let c = 0; c < cells.length; c++) {
        const ref = cells[c].getAttribute("r") || "";
        const colIdx = ref ? colIndexOf(ref) : c;
        const cellRow = ref ? rowIndexOf(ref, rowIdx) : rowIdx;
        const text = xlsxCellText(cells[c], shared);
        if (text) {
          doc.blocks.push({
            text,
            kind: "cell",
            section: sheetName,
            para_index: paraIndex,
            table_pos: [sheetNo, cellRow, colIdx],
            heading: "", // 엑셀은 시트명(section)이 앵커라 제목 텍스트 없음
            cell: ref || `${colLetter(colIdx)}${cellRow + 1}`, // "B12"
          });
        }
        paraIndex += 1;
      }
    }
  }
  return doc;
}

// 형식 디스패처 — 확장자로 docx/xlsx 를 고른다.
export async function parseDoc(fileName: string, data: ArrayBuffer, role: string): Promise<ParsedDoc> {
  if (/\.xlsx$/i.test(fileName)) return parseXlsx(fileName, data, role);
  return parseDocx(fileName, data, role);
}
