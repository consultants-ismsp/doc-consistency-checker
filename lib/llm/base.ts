// LLM 공급자 인터페이스. extractor는 이것만 알고 구현체는 모른다.
// Python core/llm/base.py 동등.

export interface LLMProvider {
  // 구조화 JSON 응답(객체)을 돌려준다. 구현체마다 내부 호출 방식만 다름.
  complete(system: string, user: string, jsonSchema: Record<string, unknown>): Promise<any>;
}

export class LLMError extends Error {}
