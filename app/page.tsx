"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import Dashboard from "../components/Dashboard";
import {
  buildProperNouns,
  GLOSSARY_DEFAULT,
  PERFORMER,
  PROVIDER_PRESETS,
  RULESETS,
  SETTINGS_DEFAULT,
  type LlmSettings,
  type ProviderId,
} from "../lib/config";
import { makeProvider } from "../lib/llm/factory";
import { Pipeline, type InputDoc, type PipelineResult, type ProgressEvent } from "../lib/pipeline";
import { renderHtml } from "../lib/report";
import { ROLE_LABELS } from "../lib/prompts";
import { buildSampleResult } from "../lib/sample";

interface PickedFile {
  name: string;
  data: ArrayBuffer;
  role: string;
}

// Dashboard·다운로드·요약에 필요한 부분만(실제 결과/예시 결과 공통 형태)
type ViewResult = Pick<PipelineResult, "payload" | "findings" | "errors" | "extractedByDoc">;

// 파일명으로 역할을 추론(명확한 것만). 애매하면 general — 사용자가 드롭다운에서 바꿀 수 있다.
function inferRole(name: string): string {
  // macOS 등에서 파일명이 NFD(자모 분해)로 들어오면 한글 매칭이 어긋난다 → NFC로 정규화.
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

function UploadIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 15V4m0 0L8 8m4-4l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14v3a3 3 0 003 3h10a3 3 0 003-3v-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 2.5h7l5 5V20a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 016 20V4A1.5 1.5 0 017.5 2.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M13 2.5V8h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export default function Page() {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [provider, setProvider] = useState<ProviderId>(SETTINGS_DEFAULT.provider);
  const [model, setModel] = useState<string>(SETTINGS_DEFAULT.model);
  const [baseUrl, setBaseUrl] = useState<string>(SETTINGS_DEFAULT.base_url ?? "");
  const [apiKey, setApiKey] = useState<string>("");
  const [rulesetId, setRulesetId] = useState<string>("default");
  const [auditStandard, setAuditStandard] = useState<boolean>(true);
  const [detectTypos, setDetectTypos] = useState<boolean>(false);
  const [clientName, setClientName] = useState<string>(""); // 고객사명(쉼표로 여러 개) — 메모리에만

  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ViewResult | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [light, setLight] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLight(document.documentElement.classList.contains("theme-light"));
  }, []);
  const toggleTheme = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("theme-light", next);
    try {
      localStorage.setItem("docchecker.theme", next ? "light" : "dark");
    } catch {
      /* localStorage 불가 환경 무시 */
    }
  };

  const onProvider = (p: ProviderId) => {
    setProvider(p);
    const preset = PROVIDER_PRESETS[p];
    setModel(preset.model);
    setBaseUrl(preset.base_url ?? "");
  };

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const arr = Array.from(list).filter((f) => /\.(docx|xlsx)$/i.test(f.name));
    const picked: PickedFile[] = [];
    for (const f of arr) {
      const data = await f.arrayBuffer();
      picked.push({ name: f.name, data, role: inferRole(f.name) });
    }
    setFiles((prev) => [...prev, ...picked]);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDrag(false);
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const showDemo = () => {
    setError(null);
    setProgress(null);
    setIsDemo(true);
    setResult(buildSampleResult());
    // 결과 영역으로 부드럽게 스크롤
    setTimeout(() => document.getElementById("result-panel")?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const run = async () => {
    setError(null);
    setResult(null);
    setIsDemo(false);
    if (files.length < 2) {
      setError("문서를 2개 이상 넣어주세요(문서 간 비교).");
      return;
    }
    const settings: LlmSettings = {
      provider,
      model,
      base_url: baseUrl || undefined,
      api_key_env: PROVIDER_PRESETS[provider].api_key_env,
    };
    let providerObj;
    try {
      providerObj = makeProvider(settings, apiKey || undefined);
    } catch (e) {
      setError((e as Error).message);
      return;
    }

    const rules = RULESETS.find((r) => r.id === rulesetId)?.rules ?? [];
    const glossary = GLOSSARY_DEFAULT; // 용어사전(모드 B)은 항상 적용 — 무료·결정적
    const docs: InputDoc[] = files.map((f) => ({ file: f.name, role: f.role, data: f.data }));

    setRunning(true);
    setProgress({ frac: 0, label: "시작…" });
    try {
      const pipeline = new Pipeline(providerObj);
      const res = await pipeline.run(docs, rules, glossary, {
        onProgress: (e) => setProgress(e),
        generatedAt: new Date().toLocaleString("ko-KR"),
        auditStandard,
        detectTypos,
        // 수행사(고정) + 고객사(런타임 입력) 회사명 → 문서 간 표기 통일 검사·오타 제외
        properNouns: buildProperNouns(clientName.split(",")),
      });
      setResult(res);
      if (res.errors.length && res.findings.length === 0) {
        setError(`추출에 실패한 문서가 있습니다: ${res.errors.map((e) => e.file).join(", ")}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const downloadDashboard = () => {
    if (!result) return;
    const html = renderHtml(result.payload);
    download(html, "dashboard.html", "text/html");
  };
  // PDF 바로 저장(대화상자 없음). 라이트 리포트를 오프스크린 iframe에 렌더 →
  // html2canvas로 캡처 → jsPDF로 A4 페이지 분할해 .pdf 다운로드.
  const exportPdf = async () => {
    if (!result || pdfBusy) return;
    setError(null);
    setPdfBusy(true);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:980px;height:1400px;border:0;background:#fff";
    document.body.appendChild(iframe);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);
      const cw = iframe.contentWindow;
      if (!cw) throw new Error("렌더 프레임을 만들 수 없습니다.");
      cw.document.open();
      cw.document.write(renderHtml(result.payload, { hideFilters: true }));
      cw.document.close();
      // 폰트/레이아웃 안정화 대기
      await new Promise((r) => setTimeout(r, 400));
      const body = cw.document.body;
      iframe.style.height = `${body.scrollHeight + 40}px`;
      const canvas = await html2canvas(body, {
        scale: 2,
        backgroundColor: "#ffffff",
        windowWidth: 980,
        width: 980,
        height: body.scrollHeight,
        useCORS: true,
      });
      const pdf = new jsPDF("p", "mm", "a4");
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pw) / canvas.width;
      const img = canvas.toDataURL("image/png");
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(img, "PNG", 0, position, pw, imgH);
      heightLeft -= ph;
      while (heightLeft > 0) {
        position -= ph;
        pdf.addPage();
        pdf.addImage(img, "PNG", 0, position, pw, imgH);
        heightLeft -= ph;
      }
      pdf.save("문서정합성검사_결과.pdf");
    } catch (e) {
      setError("PDF 생성 실패: " + (e as Error).message);
    } finally {
      iframe.remove();
      setPdfBusy(false);
    }
  };
  const downloadExtracted = () => {
    if (!result) return;
    for (const doc of result.extractedByDoc) {
      download(JSON.stringify(doc.items, null, 2), `${doc.name}.json`, "application/json");
    }
  };

  return (
    <>
      <nav className="nav">
        <div className="inner">
          <div className="brand">
            {/* 테마별 로고 — CSS로 토글(페인트 전 테마 클래스 적용 → 깜빡임 없음) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo brand-logo-light" src="/consultants-logo.png" alt="CONSULTANTS — YOUR PARTNER IN SECURITY" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo brand-logo-dark" src="/consultants-logo-light.png" alt="CONSULTANTS — YOUR PARTNER IN SECURITY" />
            <span className="brand-sep" />
            <span className="name">
              문서 정합성 검사기
              <small>ISMS-P 산출물 정합성 점검</small>
            </span>
          </div>
          <span className="spacer" />
          <button className="themebtn" onClick={toggleTheme} title="테마 전환" aria-label="테마 전환">
            {light ? "🌙" : "☀️"}
          </button>
        </div>
      </nav>

      <header className="hero">
        <div className="inner">
          <div className="eyebrow">ISMS-P 산출물 정합성 점검</div>
          <h1>
            문서 세트의 <b>어긋난 곳</b>만 콕 집어냅니다
          </h1>
          <p>
            여러 산출물을 넣으면 용어 불일치 · 수치 불일치 · 판정/연계/종속 모순을 찾아 출처와 함께 보여줍니다.
            숫자·논리는 코드가, 텍스트 추출은 AI가 담당합니다.
          </p>
          <div className="herocta">
            <button className="btn" onClick={showDemo}>
              예시 결과 보기
            </button>
            <span className="herocta-note">업로드·API 키 없이 결과 화면을 미리 볼 수 있어요</span>
          </div>
          <div className="trust">
            <span>브라우저에서 처리 — 문서 서버 전송 없음</span>
            <span>API 키는 메모리에만, 저장 안 함</span>
            <span>출처(문서·절·단락·원문) 부착</span>
          </div>
        </div>
      </header>

      <div className="layout">
        {error && <div className="err">{error}</div>}

        {/* 1) 문서 */}
        <div className="panel">
          <h2>
            <span className="step">1</span>문서 업로드 (.docx · .xlsx 2개 이상)
          </h2>
          <div
            className={`dropzone ${drag ? "drag" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
          >
            <span className="big">
              <UploadIcon />
            </span>
            여기로 .docx · .xlsx 파일을 끌어다 놓거나 클릭해 선택
            <input
              ref={inputRef}
              type="file"
              accept=".docx,.xlsx"
              multiple
              style={{ display: "none" }}
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>
          {files.length > 0 && (
            <div className="filelist">
              {files.map((f, i) => (
                <div className={`fileitem${f.role === "general" ? " warn" : ""}`} key={i}>
                  <span className="ic">
                    <DocIcon />
                  </span>
                  <span className="nm">{f.name}</span>
                  {f.role === "general" && (
                    <span className="role-warn" title="파일명으로 문서 종류를 인식하지 못했습니다. 직접 지정하세요.">
                      ⚠ 종류 확인
                    </span>
                  )}
                  <select
                    value={f.role}
                    onChange={(e) =>
                      setFiles((prev) => prev.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))
                    }
                  >
                    {Object.entries(ROLE_LABELS).map(([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button className="rm" title="제거" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="hint">
            문서 종류는 <b>파일명으로 자동 인식</b>됩니다(수행계획서·수준평가·위험평가·개선과제·자산관리대장·체크리스트).
            인식하지 못한 파일만 <b>⚠ 종류 확인</b>으로 표시되니, 그 파일만 직접 지정하면 됩니다.
          </div>
        </div>

        {/* 2) AI / 룰 설정 */}
        <div className="panel">
          <h2>
            <span className="step">2</span>AI 공급자 · 룰 설정
          </h2>
          <div className="grid">
            <div className="field">
              <label>공급자</label>
              <select value={provider} onChange={(e) => onProvider(e.target.value as ProviderId)}>
                <option value="claude">Claude (Anthropic)</option>
                <option value="openrouter">OpenRouter (Claude Sonnet 4.6)</option>
                <option value="openai">OpenAI 호환</option>
                <option value="solar">Solar (Upstage)</option>
                <option value="gemini">Gemini (OpenAI 호환)</option>
                <option value="custom">사내망/커스텀 (OpenAI 호환)</option>
              </select>
            </div>
            <div className="field">
              <label>모델</label>
              <input type="text" value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
            {provider === "custom" && (
              <div className="field">
                <label>base_url</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://.../v1"
                />
              </div>
            )}
            <div className="field">
              <label>API 키</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
              />
            </div>
            <div className="field">
              <label>룰셋</label>
              <select value={rulesetId} onChange={(e) => setRulesetId(e.target.value)}>
                {RULESETS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>고객사명 (회사명 표기 통일 검사용)</label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="예: 브릿지X (여러 개면 쉼표로)"
              />
            </div>
          </div>

          <div className="checks">
            <label className="check">
              <input type="checkbox" checked={auditStandard} onChange={(e) => setAuditStandard(e.target.checked)} />
              공식 표준용어 점검 (LLM, 호출 1회)
            </label>
            <label className="check">
              <input type="checkbox" checked={detectTypos} onChange={(e) => setDetectTypos(e.target.checked)} />
              오타 점검 (LLM, 추출 시 함께)
            </label>
          </div>
          <div className="hint">
            자동 비교(용어 모드 A + 수치 자동)는 항상 동작합니다. 모드 B는 표준어 사전 위반(medium)을 추가로 적발합니다.
            키는 메모리(state)에만 두며 디스크·번들에 저장하지 않습니다.
            수행사명은 <b>{PERFORMER.canonical}</b>로 고정되며, 고객사명을 입력하면 두 회사명이 모든 문서에서 같은 표기로
            쓰였는지 검사합니다(달라지면 적발, 표준 표기는 오타로 보지 않음). 비워두면 회사명 검사를 건너뜁니다.
          </div>
        </div>

        {/* 3) 실행 */}
        <div className="panel">
          <h2>
            <span className="step">3</span>검사 실행
          </h2>
          <div className="actions">
            <button className="btn" onClick={run} disabled={running}>
              {running ? "검사 중…" : "정합성 검사 실행"}
            </button>
            {result && (
              <>
                <button className="btn secondary" onClick={exportPdf} disabled={pdfBusy}>
                  {pdfBusy ? "PDF 생성 중…" : "PDF로 저장"}
                </button>
                <button className="btn secondary" onClick={downloadDashboard}>
                  대시보드 HTML 내려받기
                </button>
                <button className="btn secondary" onClick={downloadExtracted}>
                  추출 JSON 내려받기
                </button>
              </>
            )}
          </div>
          {progress && (
            <div style={{ marginTop: 16 }}>
              <div className="progress">
                <div style={{ width: `${Math.round(progress.frac * 100)}%` }} />
              </div>
              <div className="proglabel">
                {progress.label} ({Math.round(progress.frac * 100)}%)
              </div>
            </div>
          )}
        </div>

        {/* 4) 결과 */}
        {result && (
          <div className="panel" id="result-panel">
            <h2>
              <span className="step">4</span>결과
            </h2>
            {isDemo && (
              <div className="demonote">
                예시(데모) 결과입니다 — 모순을 심어둔 샘플 문서 5종에 실제 검사 엔진을 돌린 화면입니다. 내 문서로 보려면
                위에서 업로드 후 <b>검사 실행</b>하세요.
              </div>
            )}
            <Dashboard payload={result.payload} />
          </div>
        )}
      </div>
    </>
  );
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
