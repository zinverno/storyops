import { rawTokens, stem } from '../shared/text.js';
import type { TopicDefinition } from './taxonomy.js';

/**
 * Deterministic topic matching. Text is split into stemmed tokens (hyphenated
 * compounds are also split: "ИИ-ассистенты" → "ии", "ассистент"), and an alias
 * matches when all of its stemmed words appear consecutively. Hubs and tags
 * match by slug. No weights, no probabilities: a topic either matches, with
 * the method recorded, or it does not.
 */

export type MatchMethod = 'title' | 'text' | 'heading' | 'hub' | 'tag' | 'term';

export interface TopicMatch {
  topicId: string;
  method: MatchMethod;
  alias: string;
  occurrences: number;
}

export function stems(text: string): string[] {
  const out: string[] = [];
  for (const token of rawTokens(text)) {
    out.push(stem(token));
    if (token.includes('-')) for (const part of token.split('-').filter(Boolean)) out.push(stem(part));
  }
  return out;
}

export function aliasStems(alias: string): string[] {
  return rawTokens(alias).flatMap((t) => (t.includes('-') ? t.split('-').filter(Boolean) : [t])).map(stem);
}

/** Number of times the phrase occurs in the token sequence. */
export function countPhrase(haystack: readonly string[], phrase: readonly string[]): number {
  if (phrase.length === 0) return 0;
  let count = 0;
  for (let i = 0; i + phrase.length <= haystack.length; i += 1) {
    let ok = true;
    for (let j = 0; j < phrase.length; j += 1) {
      if (haystack[i + j] !== phrase[j]) {
        ok = false;
        break;
      }
    }
    if (ok) count += 1;
  }
  return count;
}

export interface CompiledTopic {
  def: TopicDefinition;
  phrases: Array<{ alias: string; stems: string[] }>;
  hubs: Set<string>;
}

export function compileTopics(defs: readonly TopicDefinition[]): CompiledTopic[] {
  return defs.map((def) => ({
    def,
    // Label and aliases, deduplicated by their stems so "RAG" and "rag" are counted once.
    phrases: [def.label, ...def.aliases]
      .map((alias) => ({ alias, stems: aliasStems(alias) }))
      .filter((p) => p.stems.length > 0 && !(p.stems.length === 1 && p.stems[0]!.length < 2))
      .filter((p, i, all) => all.findIndex((q) => q.stems.join(' ') === p.stems.join(' ')) === i),
    hubs: new Set((def.hubs ?? []).map((h) => h.toLowerCase())),
  }));
}

/** Occurrences of a topic's aliases in pre-stemmed text. */
export function occurrences(topic: CompiledTopic, textStems: readonly string[]): { count: number; alias: string } {
  let count = 0;
  let alias = '';
  for (const p of topic.phrases) {
    const n = countPhrase(textStems, p.stems);
    if (n > 0 && !alias) alias = p.alias;
    count += n;
  }
  return { count, alias };
}

export interface MatchInput {
  title?: string;
  text?: string;
  headings?: readonly string[];
  hubs?: readonly string[];
  tags?: readonly string[];
  /** Free terms (module names, commit subjects…). */
  terms?: readonly string[];
}

/**
 * All topics matched by an item. The first matching source (in the order
 * hub, tag, title, heading, text, term) is recorded as the method.
 */
export function matchTopics(input: MatchInput, topics: readonly CompiledTopic[]): TopicMatch[] {
  const hubs = new Set((input.hubs ?? []).map((h) => h.toLowerCase()));
  const tagStems = (input.tags ?? []).map(stems);
  const title = input.title ? stems(input.title) : [];
  const headings = (input.headings ?? []).map(stems);
  const text = input.text ? stems(input.text) : [];
  const terms = (input.terms ?? []).map(stems);
  const matches: TopicMatch[] = [];
  for (const topic of topics) {
    const hub = [...topic.hubs].find((h) => hubs.has(h));
    if (hub) {
      matches.push({ topicId: topic.def.id, method: 'hub', alias: hub, occurrences: 1 });
      continue;
    }
    const sources: Array<[MatchMethod, Array<readonly string[]>]> = [
      ['tag', tagStems],
      ['title', [title]],
      ['heading', headings],
      ['text', [text]],
      ['term', terms],
    ];
    for (const [method, lists] of sources) {
      let total = 0;
      let alias = '';
      for (const list of lists) {
        const o = occurrences(topic, list);
        total += o.count;
        if (!alias && o.alias) alias = o.alias;
      }
      if (total > 0) {
        matches.push({ topicId: topic.def.id, method, alias, occurrences: total });
        break;
      }
    }
  }
  return matches;
}
