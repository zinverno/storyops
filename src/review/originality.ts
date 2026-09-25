import { rawTokens } from '../shared/text.js';

/**
 * Deterministic originality check used by platform-fit review. The database
 * never stores other authors' article bodies; the only external text StoryOps
 * holds is article titles (kept as provenance). This finds long word
 * sequences an article shares with those titles. It cannot prove
 * originality; semantic imitation is left to the human or agent reviewer.
 */

export interface ExternalText {
  id: string;
  text: string;
}

export interface OverlapMatch {
  id: string;
  /** The shared word sequence, normalised. */
  sequence: string;
  /** Where it was found (field name, line…), supplied by the caller. */
  where: string;
}

export const MIN_SHARED_WORDS = 5;

function ngrams(tokens: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i += 1) out.add(tokens.slice(i, i + n).join(' '));
  return out;
}

/**
 * Returns shared sequences of at least `minWords` consecutive words between
 * each `text` and the external texts. Titles shorter than `minWords` match
 * only when they appear in full and have at least 4 words.
 */
export function findExternalOverlap(texts: ReadonlyArray<{ where: string; text: string }>, external: readonly ExternalText[], minWords = MIN_SHARED_WORDS): OverlapMatch[] {
  const prepared = external
    .map((e) => ({ id: e.id, tokens: rawTokens(e.text) }))
    .filter((e) => e.tokens.length >= 4)
    .map((e) => ({ id: e.id, n: Math.min(minWords, e.tokens.length), grams: ngrams(e.tokens, Math.min(minWords, e.tokens.length)) }));
  const matches: OverlapMatch[] = [];
  const seen = new Set<string>();
  for (const { where, text } of texts) {
    const tokens = rawTokens(text);
    for (const e of prepared) {
      for (const gram of ngrams(tokens, e.n)) {
        if (!e.grams.has(gram)) continue;
        const key = `${e.id}|${where}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({ id: e.id, sequence: gram, where });
      }
    }
  }
  return matches;
}
