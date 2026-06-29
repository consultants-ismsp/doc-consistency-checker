// Claude 어댑터(브라우저 fetch). Python core/llm/anthropic.py 동작 재현.
// 구조화 출력은 '강제 도구 호출'(tool_choice)로 보장 — tool_use.input은 이미 파싱된 객체.
// temperature 0, 4xx 즉시 실패, 그 외 재시도.
// 브라우저 직접 호출은 anthropic-dangerous-direct-browser-access 헤더로 CORS 허용.
import { LLMError, type LLMProvider } from "./base";

export interface AnthropicOptions {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxRetries?: number;
  maxTokens?: number;
  anthropicVersion?: string;
}

export class AnthropicProvider implements LLMProvider {
  private model: string;
  private apiKey?: string;
  private baseUrl: string;
  private maxRetries: number;
  private maxTokens: number;
  private version: string;

  constructor(opts: AnthropicOptions) {
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
    this.maxRetries = opts.maxRetries ?? 2;
    this.maxTokens = opts.maxTokens ?? 8192;
    this.version = opts.anthropicVersion || "2023-06-01";
  }

  async complete(system: string, user: string, jsonSchema: Record<string, unknown>): Promise<any> {
    if (!this.apiKey) {
      throw new LLMError("API 키가 없음 (앱에서 입력하세요)");
    }
    // 강제 도구 호출로 JSON 객체 보장. 스키마 없으면 임의 객체 허용.
    const schema =
      jsonSchema && Object.keys(jsonSchema).length
        ? jsonSchema
        : { type: "object", additionalProperties: true };
    const tool = { name: "emit", description: "추출 결과 JSON을 그대로 전달한다.", input_schema: schema };

    const url = `${this.baseUrl}/v1/messages`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": this.version,
      "anthropic-dangerous-direct-browser-access": "true",
    };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    const body = JSON.stringify({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
      tools: [tool],
      tool_choice: { type: "tool", name: "emit" },
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
          if ([400, 401, 403, 404].includes(resp.status)) {
            throw new LLMError(`Claude 요청 실패(${resp.status}): ${txt.slice(0, 300)}`);
          }
          throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 300)}`);
        }
        const json = await resp.json();
        const content = json?.content ?? [];
        for (const block of content) {
          if (block?.type === "tool_use") return block.input; // 이미 파싱된 객체
        }
        throw new Error("tool_use 블록이 응답에 없음");
      } catch (e) {
        if (e instanceof LLMError) throw e; // 4xx 즉시 실패
        lastErr = e;
        console.warn(`Claude 호출/처리 실패(시도 ${attempt}): ${(e as Error).message}`);
      }
    }
    throw new LLMError(`Claude 추출 ${this.maxRetries + 1}회 실패: ${(lastErr as Error)?.message}`);
  }
}
