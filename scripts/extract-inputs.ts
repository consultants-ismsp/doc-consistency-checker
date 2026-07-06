// 개발용 추출 하네스 — 앱과 똑같은 경로(loader→extractor→OpenAI호환 공급자)로
// _inputs/ 의 실제 문서를 추출해 out/extracted/*.json 으로 저장한다.
// 앱(웹)은 그대로 클라이언트사이드 유지 — 이건 로컬에서 같은 API 호출을 재현하는 테스트용.
//
// 키는 .env.local 의 OPENROUTER_API_KEY 를 읽어 쓰며 화면/로그에 절대 찍지 않는다.
//
// 사용:
//   npx tsx scripts/extract-inputs.ts --smoke        # 가장 작은 문서 1청크만(인증·모델 검증, ~1회 호출)
//   npx tsx scripts/extract-inputs.ts --only=개선과제  # 파일명에 '개선과제' 포함만
//   npx tsx scripts/extract-inputs.ts --max-chunks=2  # 문서당 청크 상한(비용 절약)
//   npx tsx scripts/extract-inputs.ts                 # 전체(docx+xlsx) 추출

// Node엔 DOMParser가 없어 loader import 전에 전역 폴리필을 심는다.
import { DOMParser } from "@xmldom/xmldom";
(globalThis as any).DOMParser = DOMParser;

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { CHUNK_BLOCKS, Extractor } from "../lib/extractor";
import { parseDoc } from "../lib/loader";
import { makeProvider } from "../lib/llm/factory";
import { SETTINGS_DEFAULT, buildProperNouns } from "../lib/config";

const ROOT = resolve(__dirname, "..");

// 파일명 → 역할 (app/page.tsx inferRole 과 동일 규칙)
function inferRole(name: string): string {
  // macOS는 파일명을 NFD(자모 분해)로 주기도 해서 NFC로 정규화 후 매칭한다.
  const n = name.normalize("NFC").toLowerCase().replace(/\s/g, "");
  if (/(rfp|제안요청|과업지시|과업내용)/.test(n)) return "rfp";
  if (n.includes("수행계획")) return "plan";
  if (n.includes("수준평가")) return "level_eval";
  if (n.includes("위험평가") || n.includes("위험분석")) return "risk_eval";
  if (n.includes("개선과제")) return "task_def";
  if (n.includes("자산")) return "asset";
  if (n.includes("체크리스트") || n.includes("법령")) return "checklist";
  return "general";
}

// .env.local 에서 KEY=VALUE 한 줄만 뽑는다(값은 반환만, 로그 금지).
function readEnvKey(name: string): string | undefined {
  try {
    const txt = readFileSync(resolve(ROOT, ".env.local"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    /* 파일 없음 → undefined */
  }
  return undefined;
}

function stem(name: string): string {
  const base = name.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}
function safeName(s: string): string {
  // NFC 정규화 필수 — macOS NFD 파일명은 한글이 자모로 분해돼 있어 [가-힣]에 안 걸리고
  // 전부 '_'로 날아가 이름이 뭉개진다(예: 브릿지X_개선과제 → X).
  return s.normalize("NFC").replace(/[^\w가-힣.-]+/gu, "_").replace(/^_+|_+$/g, "") || "doc";
}

function arg(flag: string): string | undefined {
  const hit = process.argv.find((a) => a === flag || a.startsWith(flag + "="));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.split("=").slice(1).join("=") : "";
}

async function main() {
  const dry = arg("--dry") !== undefined; // 파싱만 하고 청크 수만 보고(API 0회)
  const apiKey = readEnvKey("OPENROUTER_API_KEY");
  if (!apiKey && !dry) {
    console.error("✗ .env.local 에 OPENROUTER_API_KEY 가 없습니다. 한 줄로 넣어주세요: OPENROUTER_API_KEY=sk-or-...");
    process.exit(1);
  }
  if (!dry) {
    console.log(`키 로드됨: OPENROUTER_API_KEY (길이 ${apiKey!.length}, 값은 표시 안 함)`);
    console.log(`모델: ${SETTINGS_DEFAULT.model}  base_url: ${SETTINGS_DEFAULT.base_url}\n`);
  }

  const smoke = arg("--smoke") !== undefined;
  const only = arg("--only");
  const maxChunks = smoke ? 1 : arg("--max-chunks") ? parseInt(arg("--max-chunks")!, 10) : Infinity;
  const typos = arg("--typos") !== undefined;
  const force = arg("--force") !== undefined; // 이미 추출된 JSON도 다시 추출
  const INPUT_DIR = resolve(ROOT, arg("--dir") || "_inputs");
  const OUT_DIR = resolve(ROOT, arg("--out") || "out/extracted");
  const excludes = (arg("--exclude") || "").split(",").map((s) => s.normalize("NFC").trim()).filter(Boolean);

  // 대상 파일: docx/xlsx 만(PDF·dotfile 제외)
  let files = readdirSync(INPUT_DIR)
    .filter((f) => /\.(docx|xlsx)$/i.test(f) && !f.startsWith("."))
    .sort();
  if (only) files = files.filter((f) => f.normalize("NFC").includes(only.normalize("NFC")));
  if (excludes.length) files = files.filter((f) => !excludes.some((x) => f.normalize("NFC").includes(x)));
  if (smoke) {
    // 가장 작은 파일 1개만
    const withSize = files.map((f) => ({ f, size: readFileSync(resolve(INPUT_DIR, f)).length }));
    withSize.sort((a, b) => a.size - b.size);
    files = withSize.length ? [withSize[0].f] : [];
  }

  if (!files.length) {
    console.error("대상 파일이 없습니다.");
    process.exit(1);
  }

  const extractor = dry ? null : new Extractor(makeProvider(SETTINGS_DEFAULT, apiKey));
  const properNouns = buildProperNouns([]); // 수행사(컨술탄츠) 고정만

  if (!dry) mkdirSync(OUT_DIR, { recursive: true });
  console.log(`대상 ${files.length}개 | 청크 상한 ${maxChunks === Infinity ? "없음" : maxChunks} | 오타점검 ${typos}${dry ? " | DRY(파싱만)" : ""}\n`);

  let totalCalls = 0;
  let totalChunks = 0;
  for (const file of files) {
    const role = inferRole(file);
    const outName = safeName(stem(file)) + (/\.xlsx$/i.test(file) ? "_xlsx" : "") + ".json";
    // resume: 이미 추출된 파일은 건너뛴다(중단 후 재실행해도 재추출 비용 0). --force 로 무시.
    if (!dry && !force && existsSync(resolve(OUT_DIR, outName))) {
      console.log(`▶ ${file}  [이미 추출됨 — 건너뜀]`);
      continue;
    }
    const data = readFileSync(resolve(INPUT_DIR, file));
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    try {
      const parsed = await parseDoc(file, buf as ArrayBuffer, role);
      // 청크 상한 적용(비용 절약/스모크)
      if (maxChunks !== Infinity) parsed.blocks = parsed.blocks.slice(0, maxChunks * CHUNK_BLOCKS);
      const nChunks = Math.max(1, Math.ceil(parsed.blocks.length / CHUNK_BLOCKS));
      totalChunks += nChunks;
      process.stdout.write(`▶ ${file}  [role=${role}] blocks=${parsed.blocks.length} chunks=${nChunks}`);
      if (dry) {
        console.log(""); // 청크 수만 보고하고 다음 파일로
        continue;
      }
      process.stdout.write(" … ");

      let calls = 0;
      const items = await extractor!.extract(parsed, () => { calls++; }, typos, properNouns);
      totalCalls += calls;

      // 필드별 개수 요약
      const byField: Record<string, number> = {};
      for (const it of items) byField[it.field] = (byField[it.field] || 0) + 1;
      const summary = Object.entries(byField).sort().map(([k, v]) => `${k}:${v}`).join(" ");
      console.log(`추출 ${items.length}건  {${summary}}`);

      writeFileSync(
        resolve(OUT_DIR, outName),
        JSON.stringify({ name: safeName(stem(file)), file, role, items: items.map((it) => extractor!.itemDict(it)) }, null, 2),
        "utf8"
      );
    } catch (e) {
      console.log(`\n  ✗ 실패: ${(e as Error).message}`);
    }
  }
  if (dry) {
    console.log(`\n[DRY] 총 청크 ~${totalChunks}개 = 예상 LLM 호출 수. (API 미사용)`);
  } else {
    console.log(`\n완료. 총 LLM 호출 ~${totalCalls}회. 저장 위치: ${OUT_DIR}`);
  }
}

main().catch((e) => {
  console.error("하네스 오류:", (e as Error).message);
  process.exit(1);
});
