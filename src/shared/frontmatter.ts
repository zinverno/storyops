import YAML from 'yaml';

export interface FrontmatterDocument {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}

/** Splits a `---` YAML frontmatter block from a Markdown document. */
export function parseFrontmatter(source: string): FrontmatterDocument {
  const match = source.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: source, hasFrontmatter: false };
  const parsed: unknown = YAML.parse(match[1] ?? '');
  const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  return { data, body: match[2] ?? '', hasFrontmatter: true };
}

export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  return `---\n${YAML.stringify(data).trimEnd()}\n---\n\n${body.replace(/^\n+/, '')}`;
}
