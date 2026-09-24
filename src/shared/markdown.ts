/**
 * Minimal Markdown helpers: rendering tables/lists for reports and a tiny
 * structural parser for Markdown publications (headings, code blocks, images).
 * This is deliberately not a full CommonMark implementation.
 */

export function mdEscape(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function mdTable(headers: string[], rows: Array<Array<string | number | undefined | null>>): string {
  const head = `| ${headers.map(mdEscape).join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map((cell) => mdEscape(cell === undefined || cell === null ? '—' : String(cell))).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

export function mdList(items: readonly string[], empty = '_none_'): string {
  if (items.length === 0) return empty;
  return items.map((item) => `- ${item}`).join('\n');
}

export interface MarkdownStructure {
  title: string | undefined;
  headings: Array<{ level: number; text: string }>;
  codeBlocks: Array<{ language: string | undefined; lines: number }>;
  images: Array<{ alt: string; src: string }>;
  links: string[];
  /** Body text with code blocks removed. */
  plainText: string;
  /** Word count of text before the first H2/H3 heading. */
  introText: string;
}

export function parseMarkdownStructure(markdown: string): MarkdownStructure {
  const headings: MarkdownStructure['headings'] = [];
  const codeBlocks: MarkdownStructure['codeBlocks'] = [];
  const images: MarkdownStructure['images'] = [];
  const links: string[] = [];
  const textLines: string[] = [];
  const introLines: string[] = [];
  let title: string | undefined;
  let inCode = false;
  let codeLang: string | undefined;
  let codeLines = 0;
  let seenSection = false;

  for (const line of markdown.split(/\r?\n/)) {
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)/);
    if (fence) {
      if (inCode) {
        codeBlocks.push({ language: codeLang, lines: codeLines });
        inCode = false;
      } else {
        inCode = true;
        codeLang = fence[2] || undefined;
        codeLines = 0;
      }
      continue;
    }
    if (inCode) {
      codeLines += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!.trim();
      if (level === 1 && title === undefined) title = text;
      else {
        headings.push({ level, text });
        seenSection = true;
      }
      continue;
    }
    for (const img of line.matchAll(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g)) images.push({ alt: img[1] ?? '', src: img[2] ?? '' });
    for (const link of line.matchAll(/(?<!!)\[[^\]]*\]\((https?:[^)\s]+)[^)]*\)/g)) links.push(link[1] ?? '');
    const cleaned = line.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    textLines.push(cleaned);
    if (!seenSection) introLines.push(cleaned);
  }
  if (inCode) codeBlocks.push({ language: codeLang, lines: codeLines });

  return {
    title,
    headings,
    codeBlocks,
    images,
    links,
    plainText: textLines.join('\n').trim(),
    introText: introLines.join('\n').trim(),
  };
}
