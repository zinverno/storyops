
/**
 * An article as the review sees it: publishable text only (frontmatter and
 * HTML comments are blanked out, keeping line numbers), split into numbered
 * blocks. Paragraph numbers (¶) count every non-heading block. Parsing never
 * touches the file; it works on the string the caller read.
 */

export interface ArticleBlock {
  /** 1-based paragraph number; headings have none. */
  paragraph?: number;
  kind: 'paragraph' | 'heading' | 'list' | 'code' | 'quote' | 'table' | 'image';
  /** Heading level (1–6), headings only. */
  level?: number;
  startLine: number;
  endLine: number;
  text: string;
}

export interface ParsedArticle {
  /** Original file lines. */
  lines: string[];
  /** Publishable text with non-publishable parts replaced by blank lines (same line count). */
  publishable: string;
  blocks: ArticleBlock[];
  paragraphCount: number;
}

function blank(match: string): string {
  return match.replace(/[^\n]/g, '');
}

export function parseArticle(markdown: string): ParsedArticle {
  const text = markdown.replace(/\r\n?/g, '\n');
  const publishable = text.replace(/^\uFEFF?---\n[\s\S]*?\n---[ \t]*(?=\n|$)/, blank).replace(/<!--[\s\S]*?-->/g, blank);
  const lines = publishable.split('\n');
  const blocks: ArticleBlock[] = [];
  let current: { kind: ArticleBlock['kind']; start: number; lines: string[] } | undefined;
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
      const kind: ArticleBlock['kind'] = /^\s*(?:[-*+]|\d+[.)])\s/.test(line) ? 'list' : /^\s*>/.test(line) ? 'quote' : /^\s*\|/.test(line) ? 'table' : /^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line) ? 'image' : 'paragraph';
      current = { kind, start: n, lines: [] };
    }
    current.lines.push(line);
  });
  flush(lines.length);
  let p = 0;
  for (const b of blocks) if (b.kind !== 'heading') b.paragraph = ++p;
  return { lines: text.split('\n'), publishable, blocks, paragraphCount: p };
}

/** 1-based line of a character offset in the publishable text. */
export function lineAt(article: ParsedArticle, index: number): number {
  return article.publishable.slice(0, index).split('\n').length;
}

export function paragraphAtLine(article: ParsedArticle, line: number): number | undefined {
  return article.blocks.find((b) => b.startLine <= line && b.endLine >= line)?.paragraph;
}
