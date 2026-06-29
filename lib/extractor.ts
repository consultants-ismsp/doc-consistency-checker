// 역할별 추출기. Python core/extractor.py 동작 재현.
// LLM은 추출만. 비교·검산·판정은 코드가 한다. 값은 원문 그대로.
// 긴 문서는 블록 단위로 청크해 호출 후 병합한다.
import type { LLMProvider } from "./llm/base";
import { LLMError } from "./llm/base";
import type { Block, ParsedDoc } from "./loader";
import type { ProperNoun } from "./config";
import { properNounInstruction, ROLE_PROMPTS, STANDARD_AUDIT_SYSTEM, standardAuditUser, SYSTEM_PROMPT, TYPO_INSTRUCTION } from "./prompts";
import type { ExtractedItem, Source } from "./schema";

export const CHUNK_BLOCKS = 60;

export class Extractor {
  private provider: LLMProvider;
  private chunkBlocks: number;

  constructor(provider: LLMProvider, chunkBlocks = CHUNK_BLOCKS) {
    this.provider = provider;
    this.chunkBlocks = chunkBlocks;
  }

  // 이 문서가 몇 번 LLM 호출되는지(진행률 총량 계산용). 최소 1.
  chunkCount(parsed: ParsedDoc): number {
    const n = parsed.blocks.length;
    return Math.max(1, Math.ceil(n / this.chunkBlocks));
  }

  async extract(
    parsed: ParsedDoc,
    onChunk?: () => void,
    detectTypos = false,
    properNouns: ProperNoun[] = []
  ): Promise<ExtractedItem[]> {
    const template =
      this.loadRolePrompt(parsed.role) +
      (detectTypos ? TYPO_INSTRUCTION : "") +
      properNounInstruction(properNouns);
    const items: ExtractedItem[] = [];
    const chunkErrors: string[] = [];
    for (const chunk of this.chunks(parsed.blocks)) {
      const user = template.replace("{blocks}", this.renderBlocks(chunk));
      let raw: any = null;
      try {
        raw = await this.provider.complete(SYSTEM_PROMPT, user, {});
      } catch (e) {
        // 문서 1개 청크 실패해도 전체 중단 금지 → 기록 후 진행
        if (!(e instanceof LLMError)) throw e;
        chunkErrors.push((e as Error).message);
        console.error(`추출 실패: ${parsed.file} role=${parsed.role}: ${(e as Error).message}`);
      }
      if (raw != null) items.push(...this.mapItems(raw, parsed));
      if (onChunk) onChunk(); // 청크 1개 끝(성공·실패 무관) → 진행률 +1
    }
    // 한 항목도 못 뽑았는데 호출이 실패했었다면 조용히 넘기지 말고 위로 올린다(화면에 표시).
    if (!items.length && chunkErrors.length) {
      throw new LLMError(`추출 0건 — LLM 호출 실패: ${chunkErrors[0]}`);
    }
    return items;
  }

  // 표준 용어 의미비교: 산출물이 쓴 용어 목록을 공식 표준 용어와 대조해 (비표준표기→표준어) 쌍을 받는다.
  // LLM은 의미비교만, 적발(Finding)은 코드가 한다. 호출 1회(전체 distinct 용어).
  async auditStandardTerms(terms: string[], standards: string[]): Promise<Array<{ used: string; standard: string }>> {
    if (!terms.length || !standards.length) return [];
    const raw = await this.provider.complete(STANDARD_AUDIT_SYSTEM, standardAuditUser(terms, standards), {});
    const out: Array<{ used: string; standard: string }> = [];
    const seen = new Set(terms);
    for (const p of asList(raw?.pairs)) {
      if (!isPlainObject(p) || !p.used || !p.standard) continue;
      const used = String(p.used);
      const standard = String(p.standard);
      // 환각 방어: 실제 문서가 쓴 용어이고, 표준과 다를 때만 채택.
      if (used !== standard && seen.has(used)) out.push({ used, standard });
    }
    return out;
  }

  private loadRolePrompt(role: string): string {
    const p = ROLE_PROMPTS[role];
    if (!p) throw new LLMError(`역할 '${role}' 프롬프트 없음`);
    return p;
  }

  private *chunks(blocks: Block[]): Generator<Block[]> {
    for (let i = 0; i < blocks.length; i += this.chunkBlocks) {
      yield blocks.slice(i, i + this.chunkBlocks);
    }
  }

  private renderBlocks(blocks: Block[]): string {
    const lines: string[] = [];
    for (const b of blocks) {
      let pos = `[section=${b.section} para=${b.para_index}`;
      if (b.table_pos) {
        // Python 튜플 repr "(1, 0, 2)" 와 동일 표기
        pos += ` table=(${b.table_pos[0]}, ${b.table_pos[1]}, ${b.table_pos[2]})`;
      }
      pos += "]";
      lines.push(`${pos} ${b.text}`);
    }
    return lines.join("\n");
  }

  private mapItems(raw: any, parsed: ParsedDoc): ExtractedItem[] {
    // LLM이 스키마를 살짝 어겨도(리스트 항목이 dict 아닌 문자열 등) 죽지 않게 방어.
    const items: ExtractedItem[] = [];
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      console.warn(`추출 응답이 dict가 아님: ${parsed.file} role=${parsed.role}`);
      return items;
    }

    for (const v of asList(raw.verdicts)) {
      if (isPlainObject(v)) items.push(this.mk(parsed, "verdict", v.key, v.value, v.source));
    }
    for (const n of asList(raw.numbers)) {
      if (isPlainObject(n)) items.push(this.mk(parsed, "number", n.key, n.value, n.source));
      else if (isScalar(n)) items.push(this.mk(parsed, "number", null, n, null));
    }
    for (const t of asList(raw.term_hits)) {
      // 용어는 표면표현=value, 개념힌트=key
      if (isPlainObject(t)) items.push(this.mk(parsed, "term", t.concept_hint, t.value, t.source));
      else if (typeof t === "string") items.push(this.mk(parsed, "term", t, t, null));
    }
    for (const tp of asList(raw.typos)) {
      // 오타는 원문표기=value, 교정안=key. (rule엔 안 쓰이고 pipeline이 finding으로 변환)
      if (isPlainObject(tp) && tp.wrong) items.push(this.mk(parsed, "typo", tp.suggestion, tp.wrong, tp.source));
    }
    const fields = raw.fields;
    if (isPlainObject(fields)) {
      for (const [field, entries] of Object.entries(fields)) {
        for (const e of asList(entries)) {
          if (isPlainObject(e)) items.push(this.mk(parsed, field, e.key, e.value, e.source));
          else if (isScalar(e)) items.push(this.mk(parsed, field, null, e, null));
        }
      }
    }
    return items.filter((it) => it.value !== null && it.value !== undefined && it.value !== "");
  }

  private mk(parsed: ParsedDoc, field: string, key: any, value: any, src: any): ExtractedItem {
    if (!isPlainObject(src)) src = {};
    const source: Source = {
      doc: parsed.file,
      section: String(src.section ?? ""),
      para_index: safeInt(src.para_index),
      snippet: String(src.snippet ?? ""),
    };
    return {
      doc: parsed.file,
      role: parsed.role,
      field,
      key: key == null ? null : (typeof key === "string" ? key : String(key)),
      value: value as string | number,
      source,
    };
  }

  itemDict(it: ExtractedItem): Record<string, unknown> {
    return {
      doc: it.doc,
      role: it.role,
      field: it.field,
      key: it.key,
      value: it.value,
      source: {
        doc: it.source.doc,
        section: it.source.section,
        para_index: it.source.para_index,
        snippet: it.source.snippet,
      },
    };
  }
}

function asList(x: unknown): any[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function isPlainObject(x: unknown): x is Record<string, any> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isScalar(x: unknown): boolean {
  return typeof x === "string" || typeof x === "number";
}

function safeInt(x: unknown): number {
  const n = parseInt(String(x), 10);
  return Number.isNaN(n) ? -1 : n;
}
