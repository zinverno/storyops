import { z } from 'zod';
import { findPhrase, normalizeWhitespace } from './author-input.js';

/**
 * A draft as the audit sees it: publishable text only (frontmatter and HTML
 * comments are blanked out, keeping line numbers), split into numbered
 * blocks. Paragraph numbers (¶) count every non-heading block.
 */

export interface DraftBlock {
  /** 1-based paragraph number; headings have none. */
  paragraph?: number;
  kind: 'paragraph' | 'heading' | 'list' | 'code' | 'quote' | 'table' | 'image';
  /** Heading level (1–6), headings only. */
  level?: number;
  startLine: number;
  endLine: number;
  text: string;
}

export interface ParsedDraft {
  /** Original file lines. */
  lines: string[];
  /** Publishable text with non-publishable parts replaced by blank lines (same line count). */
  publishable: string;
  blocks: DraftBlock[];
  paragraphCount: number;
}

function blank(match: string): string {
  return match.replace(/[^\n]/g, '');
}

export function parseDraft(markdown: string): ParsedDraft {
  const text = markdown.replace(/\r\n?/g, '\n');
  const publishable = text.replace(/^\uFEFF?---\n[\s\S]*?\n---[ \t]*(?=\n|$)/, blank).replace(/<!--[\s\S]*?-->/g, blank);
  const lines = publishable.split('\n');
  const blocks: DraftBlock[] = [];
  let current: { kind: DraftBlock['kind']; start: number; lines: string[] } | undefined;
  let fence = false;
  const flush = (end: number) => {
    if (!current) return;
    const body = current.lines.join('\n');
    if (body.trim()) blocks.push({ kind: current.kind, startLine: current.start, endLine: end, text: body });
    current = undefined;
  };
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/^\s*(```|~~~)/.test(line)) {
      if (fence) {
        current!.lines.push(line);
        flush(n);
        fence = false;
      } else {
        flush(n - 1);
        fence = true;
        current = { kind: 'code', start: n, lines: [line] };
      }
      return;
    }
    if (fence) {
      current!.lines.push(line);
      return;
    }
    if (line.trim() === '') {
      flush(n - 1);
      return;
    }
    if (/^#{1,6}\s/.test(line)) {
      flush(n - 1);
      blocks.push({ kind: 'heading', level: line.match(/^#+/)![0].length, startLine: n, endLine: n, text: line.replace(/^#{1,6}\s+/, '').replace(/\s*#*\s*$/, '') });
      return;
    }
    if (!current) {
      const kind: DraftBlock['kind'] = /^\s*(?:[-*+]|\d+[.)])\s/.test(line) ? 'list' : /^\s*>/.test(line) ? 'quote' : /^\s*\|/.test(line) ? 'table' : /^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line) ? 'image' : 'paragraph';
      current = { kind, start: n, lines: [] };
    }
    current.lines.push(line);
  });
  flush(lines.length);
  let p = 0;
  for (const b of blocks) if (b.kind !== 'heading') b.paragraph = ++p;
  return { lines: text.split('\n'), publishable, blocks, paragraphCount: p };
}

export const locationSchema = z
  .object({
    /** Inclusive paragraph range [from, to] (¶ numbers from the audit's paragraph index). */
    paragraphs: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
    /** Inclusive 1-based line range in the output file. */
    lines: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
    /** A section heading (text without #). */
    heading: z.string().optional(),
    /** Short quote from the location; verified to be there (whitespace-insensitive). */
    excerpt: z.string().optional(),
  })
  .refine((l) => l.paragraphs || l.lines || l.heading || l.excerpt, { message: 'a location needs paragraphs, lines, heading or excerpt' });
export type OutputLocation = z.infer<typeof locationSchema>;

/** Publishable text covered by a location, or an error message. */
export function resolveLocation(draft: ParsedDraft, loc: OutputLocation): { text: string } | { error: string } {
  const parts: string[] = [];
  if (loc.paragraphs) {
    const [a, b] = loc.paragraphs;
    if (a > b) return { error: `paragraph range ${a}–${b} is reversed` };
    if (b > draft.paragraphCount) return { error: `paragraph ${b} does not exist (the output has ${draft.paragraphCount})` };
    parts.push(...draft.blocks.filter((x) => x.paragraph !== undefined && x.paragraph >= a && x.paragraph <= b).map((x) => x.text));
  }
  if (loc.lines) {
    const [a, b] = loc.lines;
    if (a > b) return { error: `line range ${a}–${b} is reversed` };
    const total = draft.publishable.split('\n').length;
    if (b > total) return { error: `line ${b} does not exist (the output has ${total} lines)` };
    parts.push(draft.publishable.split('\n').slice(a - 1, b).join('\n'));
  }
  if (loc.heading) {
    const want = normalizeWhitespace(loc.heading).toLowerCase();
    const idx = draft.blocks.findIndex((x) => x.kind === 'heading' && normalizeWhitespace(x.text).toLowerCase() === want);
    if (idx < 0) return { error: `heading "${loc.heading}" does not exist` };
    const end = draft.blocks.findIndex((x, i) => i > idx && x.kind === 'heading');
    parts.push(...draft.blocks.slice(idx, end < 0 ? undefined : end).map((x) => x.text));
  }
  if (parts.length === 0) parts.push(draft.publishable);
  const text = parts.join('\n');
  if (!text.trim()) return { error: 'the location contains no publishable text (only comments or blank lines)' };
  if (loc.excerpt && findPhrase(text, loc.excerpt) < 0) return { error: `excerpt "${loc.excerpt.slice(0, 60)}" is not in the referenced location` };
  return { text };
}

/** 1-based line of a character offset in the publishable text. */
export function lineAt(draft: ParsedDraft, index: number): number {
  return draft.publishable.slice(0, index).split('\n').length;
}

export function paragraphAtLine(draft: ParsedDraft, line: number): number | undefined {
  return draft.blocks.find((b) => b.startLine <= line && b.endLine >= line)?.paragraph;
}

/** Compact ¶ index for audit.md so the agent can map items without re-reading the whole draft. */
export function paragraphIndex(draft: ParsedDraft, width = 90): string[] {
  return draft.blocks.map((b) => {
    const snippet = normalizeWhitespace(b.text).slice(0, width);
    return b.kind === 'heading' ? `§ L${b.startLine} ${snippet}` : `¶${b.paragraph} L${b.startLine}–${b.endLine} [${b.kind}] ${snippet}${normalizeWhitespace(b.text).length > width ? '…' : ''}`;
  });
}
