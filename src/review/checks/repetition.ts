import { isStopword, rawTokens, stem, wordCount } from '../../shared/text.js';
import { blockProse, excerptOf, type ReviewDocument } from '../document.js';
import type { PendingFinding } from '../types.js';

/**
 * Repetition inside the article: near-duplicate paragraphs, phrases repeated
 * many times and concepts defined more than once. Nothing is deleted; each
 * finding points at both places and says what looks duplicated.
 */

export const DUPLICATE_PARAGRAPH_THRESHOLD = 0.6;

function vector(text: string): Map<string, number> {
  const v = new Map<string, number>();
  for (const t of rawTokens(text)) {
    if (t.length < 3 || isStopword(t) || /^\d+$/.test(t)) continue;
    const s = stem(t);
    v.set(s, (v.get(s) ?? 0) + 1);
  }
  return v;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, x] of a) {
    na += x * x;
    const y = b.get(k);
    if (y) dot += x * y;
  }
  for (const y of b.values()) nb += y * y;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function repetitionFindings(doc: ReviewDocument, options: { language: 'ru' | 'en' }): PendingFinding[] {
  const ru = options.language === 'ru';
  const findings: PendingFinding[] = [];
  const paras = doc.parsed.blocks.filter((b) => b.kind === 'paragraph' && wordCount(blockProse(b)) >= 15).map((b) => ({ b, text: blockProse(b), v: vector(blockProse(b)) }));
  for (let i = 0; i < paras.length; i += 1) {
    for (let j = i + 1; j < paras.length; j += 1) {
      const a = paras[i]!;
      const c = paras[j]!;
      const sim = cosine(a.v, c.v);
      if (sim < DUPLICATE_PARAGRAPH_THRESHOLD) continue;
      const shared = [...a.v.keys()].filter((k) => c.v.has(k));
      if (shared.length < 6) continue;
      const surface = rawTokens(a.text).filter((t) => shared.includes(stem(t)) && t.length >= 4);
      findings.push({
        category: 'repetition',
        rule: 'near-duplicate-paragraphs',
        severity: 'warning',
        lines: { start: c.b.startLine, end: c.b.endLine },
        excerpt: excerptOf(c.text, 120),
        problem: ru ? `Абзац (строки ${c.b.startLine}–${c.b.endLine}) почти повторяет абзац в строках ${a.b.startLine}–${a.b.endLine} (сходство ${Math.round(sim * 100)}%).` : `Paragraph (lines ${c.b.startLine}–${c.b.endLine}) nearly repeats lines ${a.b.startLine}–${a.b.endLine} (similarity ${Math.round(sim * 100)}%).`,
        why: ru ? 'Повторённая мысль отнимает у читателя время и размывает структуру.' : 'A repeated idea costs the reader time and blurs the structure.',
        suggestion: ru ? 'Решить, где мысль нужнее, и оставить её в одном месте (или явно сослаться на первое упоминание).' : 'Decide where the idea belongs and keep it once (or refer back to it).',
        related: { lines: { start: a.b.startLine, end: a.b.endLine }, similarity: Math.round(sim * 100) / 100, details: [`${ru ? 'общие слова' : 'shared words'}: ${[...new Set(surface)].slice(0, 10).join(', ')}`] },
      });
    }
  }

  // Phrases (4 consecutive words) repeated 3+ times in the prose
  const grams = new Map<string, number[]>();
  for (const s of doc.sentences) {
    const tokens = rawTokens(s.text);
    const seen = new Set<string>();
    for (let i = 0; i + 4 <= tokens.length; i += 1) {
      const gram = tokens.slice(i, i + 4);
      if (gram.every((t) => isStopword(t) || t.length < 3)) continue;
      const key = gram.join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      grams.set(key, [...(grams.get(key) ?? []), s.line]);
    }
  }
  const repeated = [...grams].filter(([, lines]) => lines.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, 3);
  for (const [phrase, lines] of repeated) {
    findings.push({
      category: 'repetition',
      rule: 'repeated-phrase',
      severity: 'suggestion',
      lines: { start: lines[0]!, end: lines.at(-1)! },
      excerpt: phrase,
      problem: ru ? `Фраза «${phrase}» повторяется ${lines.length} раз (строки ${lines.join(', ')}).` : `The phrase "${phrase}" appears ${lines.length} times (lines ${lines.join(', ')}).`,
      why: ru ? 'Частый повтор одной формулировки заметен.' : 'A repeated wording is noticeable.',
      suggestion: ru ? 'Проверить, нужна ли фраза каждый раз.' : 'Check whether every occurrence is needed.',
    });
  }

  // The same concept defined twice ("X — это …")
  const DEF = /^([\p{L}\p{N}`«»"_-]+(?:\s+[\p{L}\p{N}`«»"_-]+){0,2})\s+[—–-]\s+это(?![\p{L}])/u;
  const defs = new Map<string, number[]>();
  for (const s of doc.sentences) {
    const m = s.text.trim().match(DEF);
    if (!m) continue;
    const key = rawTokens(m[1]!).map(stem).join(' ');
    defs.set(key, [...(defs.get(key) ?? []), s.line]);
  }
  for (const [term, lines] of defs) {
    if (lines.length < 2) continue;
    findings.push({
      category: 'repetition',
      rule: 'repeated-definition',
      severity: 'suggestion',
      lines: { start: lines[1]!, end: lines[1]! },
      excerpt: term,
      problem: ru ? `Понятие определяется несколько раз (строки ${lines.join(', ')}).` : `The concept is defined more than once (lines ${lines.join(', ')}).`,
      why: ru ? 'Повторное определение заставляет читателя сравнивать две формулировки.' : 'Two definitions make the reader compare them.',
      suggestion: ru ? 'Оставить одно определение, в остальных местах сослаться на него.' : 'Keep one definition and refer to it.',
    });
  }
  return findings;
}
