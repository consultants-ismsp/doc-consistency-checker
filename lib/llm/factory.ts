// 설정(LlmSettings) → 공급자 객체. Python core/llm/factory.py 동등.
// provider 문자열만 보고 고른다. custom은 OpenAI 호환 사내망 엔드포인트로 동작.
import type { LlmSettings } from "../config";
import { AnthropicProvider } from "./anthropic";
import type { LLMProvider } from "./base";
import { OpenAICompatibleProvider } from "./openaiCompatible";

export function makeProvider(cfg: LlmSettings, apiKey?: string): LLMProvider {
  const provider = (cfg.provider || "claude").toLowerCase();

  // openrouter/solar/openai/gemini/custom 은 OpenAI 호환 → base_url만 다르고 같은 구현
  if (
    provider === "openrouter" ||
    provider === "solar" ||
    provider === "openai" ||
    provider === "gemini" ||
    provider === "custom"
  ) {
    if (!cfg.base_url) throw new Error(`'${provider}' 공급자는 base_url 이 필요합니다`);
    return new OpenAICompatibleProvider({
      baseUrl: cfg.base_url,
      model: cfg.model,
      apiKey,
    });
  }
  if (provider === "claude") {
    return new AnthropicProvider({
      model: cfg.model,
      apiKey,
      baseUrl: cfg.base_url, // 사내 프록시가 있으면 교체 가능
    });
  }
  throw new Error(`알 수 없는 LLM provider: ${provider}`);
}
