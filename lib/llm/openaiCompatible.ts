// OpenAI 호환 공급자(브라우저 fetch). Solar/OpenAI/Gemini를 base_url만 바꿔 공용.
// Python core/llm/openai_compatible.py 동작 재현(response_format json_object, temperature 0, 재시도).
// 키는 메모리(state)에서만 전달.
import { LLMError, type LLMProvider } from "./base";

export interface OpenAICompatibleOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  maxRetries?: number;
  extraHeaders?: Record<string, string>;
}

export class OpenAICompatibleProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  private apiKey?: string;
  private maxRetries: number;
  private extraHeaders: Record<string, string>;

  constructor(opts: OpenAICompatibleOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.maxRetries = opts.maxRetries ?? 2;
    this.extraHeaders = opts.extraHeaders ?? {};
  }

  async complete(system: string, user: string): Promise<any> {
    const url = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.extraHeaders,
    };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    if (!this.apiKey) {
      throw new LLMError("API 키가 없음 (앱에서 입력하세요)");
    }

    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers,
          body,
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          // 인증/요청 오류(4xx)는 재시도 무의미 → 즉시 실패
          if (resp.status >= 400 && resp.status < 500) {
            throw new LLMError(`LLM 요청 실패(${resp.status}): ${txt.slice(0, 300)}`);
          }
          throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 300)}`);
        }
        const json = await resp.json();
        const content = json?.choices?.[0]?.message?.content;
        if (typeof content !== "string") throw new Error("응답에 content 없음");
        return parseJsonLoose(content);
      } catch (e) {
        if (e instanceof LLMError) throw e; // 4xx 즉시 실패
        lastErr = e;
        console.warn(`LLM 호출/파싱 실패(시도 ${attempt}): ${(e as Error).message}`);
      }
    }
    throw new LLMError(`LLM 응답 ${this.maxRetries + 1}회 실패: ${(lastErr as Error)?.message}`);
  }
}

// 일부 모델(특히 OpenRouter 경유 Claude)은 response_format을 무시하고 JSON을
// ```json ... ``` 코드펜스로 감싸거나 앞뒤에 설명을 붙여 보낸다. 그대로 JSON.parse 하면
// 깨지므로, 1차로 그대로 시도하고 실패하면 펜스를 벗기고 첫 {...} 블록만 추려 다시 파싱한다.
function parseJsonLoose(content: string): any {
  try {
    return JSON.parse(content);
  } catch {
    /* 아래에서 정리 후 재시도 */
  }
  let s = content.trim();
  // ```json ... ``` / ``` ... ``` 코드펜스 제거
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // 그래도 앞뒤 잡텍스트가 있으면 첫 '{' ~ 마지막 '}' 구간만 사용
  if (s[0] !== "{" && s[0] !== "[") {
    const start = s.search(/[{[]/);
    const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
  }
  return JSON.parse(s);
}
