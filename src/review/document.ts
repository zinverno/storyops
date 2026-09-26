import { splitSentences, wordCount } from '../shared/text.js';
import { parseArticle, type ArticleBlock, type ParsedArticle } from './parse.js';

/**
 * The review's view of an article: blocks, prose sentences with line
 * numbers, and sections. Inline code is masked so language checks do not
 * fire on identifiers; fenced code blocks are skipped entirely.
 */

export interface Sentence {
  text: string;
  line: number;
  block: number;
}

export interface Section {
  heading?: string;
  level: number;
  startLine: number;
  endLine: number;
  blocks: ArticleBlock[];
  text: string;
  words: number;
}

export interface ReviewDocument {
  parsed: ParsedArticle;
  title?: string;
  prose: ArticleBlock[];
  sentences: Sentence[];
  sections: Section[];
  words: number;
  lineCount: number;
}

/** Replaces inline code with same-length placeholders (keeps offsets and line numbers). */
export function maskInlineCode(text: string): string {
  return text.replace(/`[^`\n]*`/g, (m) => '·'.repeat(m.length));
}

export function blockProse(b: ArticleBlock): string {
  const text = b.kind === 'list' ? b.text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '') : b.kind === 'quote' ? b.text.replace(/^\s*>\s?/gm, '') : b.text;
  return maskInlineCode(text.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
}

export function buildDocument(markdown: string): ReviewDocument {
  const parsed = parseArticle(markdown);
  const prose = parsed.blocks.filter((b) => b.kind === 'paragraph' || b.kind === 'list' || b.kind === 'quote');
  const sentences: Sentence[] = [];
  parsed.blocks.forEach((b, blockIndex) => {
    if (!prose.includes(b)) return;
    const text = blockProse(b);
    let cursor = 0;
    for (const s of splitSentences(text)) {
      const firstWord = s.slice(0, Math.min(12, s.length));
      const at = text.indexOf(firstWord, cursor);
      const offset = at >= 0 ? at : cursor;
      cursor = offset + Math.max(1, s.length - 5);
      sentences.push({ text: s, line: b.startLine + text.slice(0, offset).split('\n').length - 1, block: blockIndex });
    }
  });
  const sections: Section[] = [];
  let current: Section = { level: 0, startLine: 1, endLine: 1, blocks: [], text: '', words: 0 };
  const flush = () => {
    const proseText = current.blocks.filter((b) => prose.includes(b)).map(blockProse).join('\n\n');
    current.text = proseText;
    current.words = wordCount(proseText);
    if (current.blocks.length || current.heading) sections.push(current);
  };
  let title: string | undefined;
  for (const b of parsed.blocks) {
    if (b.kind === 'heading' && b.level === 1 && title === undefined) {
      title = b.text;
      continue;
    }
    if (b.kind === 'heading' && (b.level ?? 2) <= 2) {
      flush();
      current = { heading: b.text, level: b.level ?? 2, startLine: b.startLine, endLine: b.endLine, blocks: [], text: '', words: 0 };
      continue;
    }
    current.blocks.push(b);
    current.endLine = b.endLine;
  }
  flush();
  const doc: ReviewDocument = { parsed, prose, sentences, sections, words: wordCount(prose.map(blockProse).join('\n')), lineCount: parsed.lines.length };
  if (title !== undefined) doc.title = title;
  return doc;
}

/** Line number of a character offset inside a block's prose text. */
export function lineInBlock(b: ArticleBlock, text: string, offset: number): number {
  return b.startLine + text.slice(0, offset).split('\n').length - 1;
}

export function excerptOf(text: string, max = 160): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
