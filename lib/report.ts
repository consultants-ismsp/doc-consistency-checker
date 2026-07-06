// 리포트 구성 — Python core/report.py 동작 재현.
// (1) buildPayload: 심각도순 정렬 + type_label 부착 (UI 대시보드가 그대로 사용)
// (2) renderHtml: 인라인 CSS 단일 HTML 파일 export — Python 대시보드와 동일한 표시.
//     (Python은 클라 JS로 렌더하지만, export는 카드를 미리 렌더해 같은 화면을 낸다.)
import type { Finding } from "./schema";

export const TYPE_LABEL: Record<string, string> = {
  term: "용어",
  value: "수치",
  cross_ref: "연계",
  dependency: "종속",
  subset: "부분집합",
  typo: "오타",
};

const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export interface ReportMeta {
  title?: string;
  docs?: string[];
  generated_at?: string;
  errors?: Array<{ file?: string; error?: string }>;
  skipped_rules?: Array<[string, string]>;
}

export interface FindingDict {
  rule_id: string;
  type: string;
  type_label: string;
  severity: string;
  docs: string[];
  expected: string;
  actual: string;
  message: string;
  locations: Array<{ doc: string; section: string; para_index: number; snippet: string; heading?: string; cell?: string }>;
}

export interface Payload {
  meta: ReportMeta;
  findings: FindingDict[];
}

export function sortFindings(findings: Finding[]): Finding[] {
  // Python: sorted(findings, key=lambda f: SEV_ORDER.get(f.severity, 9)) — 안정 정렬
  return [...findings].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
}

export function findingDict(f: Finding): FindingDict {
  return {
    rule_id: f.rule_id,
    type: f.type,
    type_label: TYPE_LABEL[f.type] ?? f.type,
    severity: f.severity,
    docs: f.docs,
    expected: f.expected,
    actual: f.actual,
    message: f.message,
    locations: f.locations.map((s) => ({
      doc: s.doc,
      section: s.section,
      para_index: s.para_index,
      snippet: s.snippet,
      heading: s.heading,
      cell: s.cell,
    })),
  };
}

export function buildPayload(findings: Finding[], meta: ReportMeta): Payload {
  const sorted = sortFindings(findings);
  return { meta, findings: sorted.map(findingDict) };
}

function esc(s: unknown): string {
  return (s == null ? "" : String(s)).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string)
  );
}

// 사람이 문서에서 되짚기 쉬운 위치 앵커. 제목 텍스트/시트·셀 우선, 없으면 절번호로 폴백.
// (단락 인덱스는 기계 카운터라 사람에게 안 보여준다.)
export function locAnchor(l: { doc: string; section: string; heading?: string; cell?: string }): string {
  const isXlsx = /\.xlsx$/i.test(l.doc);
  const parts: string[] = [];
  if (isXlsx) {
    if (l.section) parts.push(`${l.section} 시트`);
    if (l.cell) parts.push(l.cell);
  } else {
    if (l.heading) parts.push(l.heading);
    else if (l.section) parts.push(`${l.section}절`);
    if (l.cell) parts.push(l.cell);
  }
  return parts.join(" · ");
}

function cardHtml(f: FindingDict): string {
  const locs = (f.locations || [])
    .map((l) => {
      const anchor = locAnchor(l);
      return (
        `<div class="loc"><div class="docline">📄 ${esc(l.doc)}</div>` +
        (l.snippet ? `<div class="snip"><span class="ctrlf">🔎 Ctrl+F</span>${esc(l.snippet)}</div>` : "") +
        (anchor ? `<div class="anchor">📍 ${esc(anchor)}</div>` : "") +
        `</div>`
      );
    })
    .join("");
  return (
    `<div class="f ${f.severity}" data-sev="${f.severity}" data-typ="${f.type}">` +
    `<div class="head">` +
    `<span class="badge b-type">${esc(f.type_label)}</span>` +
    `<span class="badge b-${f.severity}">${esc(f.severity)}</span>` +
    `<span class="rid">${esc(f.rule_id)}</span>` +
    `</div>` +
    `<div class="msg">${esc(f.message)}</div>` +
    `<div class="ev">기대: ${esc(f.expected)}\n실제: ${esc(f.actual)}</div>` +
    locs +
    `</div>`
  );
}

// 내보내기(HTML/PDF)는 항상 라이트 테마 — 인쇄·공유·가독성에 유리.
const STYLE = `
 body{font-family:"Pretendard Variable",Pretendard,"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;margin:0;background:#f6f8fb;color:#1e293b;-webkit-font-smoothing:antialiased;line-height:1.6}
 header{background:linear-gradient(120deg,#16205a 0%,#22306f 55%,#2f50c8 100%);border-bottom:1px solid #e2e8f4;padding:26px 24px;color:#fff}
 header h1{margin:0 0 6px;font-size:21px;color:#fff;font-weight:800;letter-spacing:-.02em}
 header .sub{font-size:13px;color:#cdd9ff}
 .wrap{max-width:1040px;margin:0 auto;padding:24px 24px 60px}
 .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:12px;margin-bottom:18px}
 .card{background:#fff;border:1px solid #e2e8f4;border-radius:12px;padding:15px 16px;box-shadow:0 1px 3px rgba(20,30,60,.05)}
 .card .n{font-size:25px;font-weight:800;color:#1f2a44;letter-spacing:-.04em}
 .card .l{font-size:11.5px;color:#5b6b80;margin-top:4px}
 .card.acc-high .n{color:#e23b3b}.card.acc-medium .n{color:#ef9f1a}.card.acc-low .n{color:#1faa55}
 .filters{margin:12px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
 .filters button{border:1px solid #e2e8f4;background:#fff;border-radius:14px;padding:6px 13px;cursor:pointer;font-size:12px;color:#5b6b80}
 .filters button.on{background:#2f50c8;color:#fff;border-color:#2f50c8}
 .f{background:#fff;border:1px solid #e2e8f4;border-radius:12px;padding:16px 18px;margin-bottom:11px;border-left:4px solid #cbd5e1;box-shadow:0 1px 3px rgba(20,30,60,.05)}
 .f.high{border-left-color:#e23b3b}.f.medium{border-left-color:#ef9f1a}.f.low{border-left-color:#1faa55}
 .f .head{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:2px}
 .f .rid{font-size:11.5px;color:#8a97ac;margin-left:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
 .badge{display:inline-block;font-size:10.5px;padding:3px 10px;border-radius:9px;color:#fff;font-weight:800}
 .b-type{background:#475569}.b-high{background:#e23b3b}.b-medium{background:#ef9f1a}.b-low{background:#1faa55}
 .f .msg{font-weight:700;margin:10px 0;color:#1f2a44;overflow-wrap:break-word;word-break:break-word}
 .f .ev{display:block;font-size:13px;color:#1f2a44;background:#f4f7fc;border:1px solid #e2e8f4;border-radius:8px;padding:11px 13px;margin-top:7px;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word}
 .loc{font-size:12px;color:#5b6b80;margin-top:12px}
 .loc .docline{font-weight:700;color:#1f2a44;margin-bottom:4px}
 .snip{display:block;font-size:12px;color:#1f2a44;background:#f4f7fc;border:1px solid #e2e8f4;border-radius:8px;padding:8px 11px;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word}
 .snip .ctrlf{display:inline-block;font-size:10.5px;font-weight:800;color:#2f50c8;background:#e7edff;border-radius:6px;padding:1px 7px;margin-right:7px;vertical-align:1px}
 .anchor{font-size:12px;color:#5b6b80;margin-top:5px}
 .empty{background:#fff;border:1px solid #e2e8f4;border-radius:12px;padding:40px;text-align:center;color:#1faa55;font-weight:800}
 @media print {
  @page { margin: 14mm; }
  body { -webkit-print-color-adjust:exact; print-color-adjust:exact }
  .wrap { padding:0 }
  .filters { display:none }
  .f { break-inside:avoid; page-break-inside:avoid }
 }
`;

// 필터 스크립트 — 미리 렌더된 카드를 data-sev/data-typ 기준으로 표시/숨김.
// (템플릿 리터럴 미사용: 정적 export 호환·이스케이프 안전)
const FILTER_JS = [
  "var sev='all',typ='all';",
  "function setOn(sel,btn){var ns=document.querySelectorAll(sel);for(var i=0;i<ns.length;i++)ns[i].classList.remove('on');btn.classList.add('on');}",
  "function render(){var cards=document.querySelectorAll('#list .f');var shown=0;for(var i=0;i<cards.length;i++){var c=cards[i];var ok=(sev==='all'||c.getAttribute('data-sev')===sev)&&(typ==='all'||c.getAttribute('data-typ')===typ);c.style.display=ok?'':'none';if(ok)shown++;}document.getElementById('empty').style.display=shown?'none':'';}",
  "var sb=document.querySelectorAll('[data-sevbtn]');for(var i=0;i<sb.length;i++){sb[i].onclick=function(){sev=this.getAttribute('data-sevbtn');setOn('[data-sevbtn]',this);render();};}",
  "var tb=document.querySelectorAll('[data-typbtn]');for(var i=0;i<tb.length;i++){tb[i].onclick=function(){typ=this.getAttribute('data-typbtn');setOn('[data-typbtn]',this);render();};}",
  "render();",
].join("\n");

// 단일 HTML 대시보드 export(라이트 테마). hideFilters=true 면 필터 버튼 생략(PDF 캡처용).
export function renderHtml(payload: Payload, opts: { hideFilters?: boolean } = {}): string {
  const F = payload.findings;
  const M = payload.meta;
  const title = esc(M.title || "문서 정합성 검사 결과");
  const count = (pred: (f: FindingDict) => boolean) => F.filter(pred).length;

  const cards: Array<[string, number, string]> = [
    ["전체", F.length, ""],
    ["high", count((f) => f.severity === "high"), "acc-high"],
    ["medium", count((f) => f.severity === "medium"), "acc-medium"],
    ["low", count((f) => f.severity === "low"), "acc-low"],
    ["용어", count((f) => f.type === "term"), ""],
    ["수치", count((f) => f.type === "value"), ""],
    ["연계", count((f) => f.type === "cross_ref"), ""],
    ["종속", count((f) => f.type === "dependency"), ""],
    ["부분집합", count((f) => f.type === "subset"), ""],
    ["오타", count((f) => f.type === "typo"), ""],
  ];
  const cardsHtml = cards
    .map(([l, n, acc]) => `<div class="card ${acc}"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`)
    .join("");

  const sevs: Array<[string, string]> = [
    ["all", "심각도 전체"],
    ["high", "high"],
    ["medium", "medium"],
    ["low", "low"],
  ];
  const TL: Record<string, string> = {
    all: "유형 전체",
    term: "용어",
    value: "수치",
    cross_ref: "연계",
    dependency: "종속",
    subset: "부분집합",
    typo: "오타",
  };
  const types = ["all", "term", "value", "cross_ref", "dependency", "subset", "typo"];
  const sevBtns = sevs
    .map(([s, lbl]) => `<button data-sevbtn="${s}" class="${s === "all" ? "on" : ""}">${esc(lbl)}</button>`)
    .join("");
  const typeBtns = types
    .map((t) => `<button data-typbtn="${t}" class="${t === "all" ? "on" : ""}">${esc(TL[t])}</button>`)
    .join("");

  const sub =
    `검사 일시 ${esc(M.generated_at || "-")} · 대상 문서 ${(M.docs || []).length}개 · 총 위반 ${F.length}건`;
  const listHtml = F.map(cardHtml).join("");

  const filtersHtml = opts.hideFilters
    ? ""
    : ` <div class="filters">${sevBtns}</div>\n <div class="filters">${typeBtns}</div>\n`;
  const scriptHtml = opts.hideFilters ? "" : `<script>${FILTER_JS}</script>\n`;

  return (
    `<!DOCTYPE html>\n<html lang="ko"><head><meta charset="utf-8">\n<title>${title}</title>\n` +
    `<style>${STYLE}</style></head>\n<body>\n` +
    `<header><h1>${title}</h1><div class="sub">${sub}</div></header>\n` +
    `<div class="wrap">\n` +
    ` <div class="cards">${cardsHtml}</div>\n` +
    filtersHtml +
    ` <div id="list">${listHtml}</div>\n` +
    ` <div id="empty" class="empty" style="display:none">✓ 해당 조건의 위반이 없습니다</div>\n` +
    `</div>\n` +
    scriptHtml +
    `</body></html>`
  );
}
