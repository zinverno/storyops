import YAML from 'yaml';
import { z } from 'zod';
import { EditorialError } from '../shared/errors.js';
import { hashText, shortHash } from '../shared/hash.js';

/**
 * Author input: raw, informal material the author wants in (or out of) the
 * article. `author-input.md` is the canonical, human-edited representation;
 * the structure below is always derived from it and never stored as the
 * source of truth. Author input is editorial source material, not factual
 * evidence: a fact only enters the article through the canonical story.
 */

export const AUTHOR_INPUT_SCHEMA_VERSION = 1;

/** Precedence inside explicit author material: avoid > verbatim > must > should > may > background. */
export const materialPrioritySchema = z.enum(['verbatim', 'must', 'should', 'may', 'background', 'avoid']);
export type MaterialPriority = z.infer<typeof materialPrioritySchema>;
export const MATERIAL_PRECEDENCE: readonly MaterialPriority[] = ['avoid', 'verbatim', 'must', 'should', 'may', 'background'];

export const inputSectionSchema = z.enum(['verbatim', 'must', 'should', 'may', 'background', 'avoid', 'raw-notes', 'personal-context', 'humor', 'questions']);
export type InputSection = z.infer<typeof inputSectionSchema>;

/**
 * Effective priority of an item. `unclassified` (raw notes) is optional
 * material the editorial pass triages; `question` is never published.
 */
export const itemPrioritySchema = z.enum([...materialPrioritySchema.options, 'unclassified', 'question']);
export type ItemPriority = z.infer<typeof itemPrioritySchema>;

interface SectionDef {
  id: InputSection;
  heading: string;
  aliases: string[];
  priority: ItemPriority;
  description: string;
}

export const INPUT_SECTIONS: readonly SectionDef[] = [
  { id: 'verbatim', heading: 'VERBATIM', aliases: ['EXACT', 'EXACT PHRASES'], priority: 'verbatim', description: 'Exact phrases that must appear exactly as written (surrounding quotes are delimiters and are not part of the phrase). The audit checks them character by character; only whitespace is normalised.' },
  { id: 'must', heading: 'MUST USE', aliases: ['MUST'], priority: 'must', description: 'Ideas, episodes or points that must appear in the article. Wording may change.' },
  { id: 'should', heading: 'SHOULD USE', aliases: ['SHOULD'], priority: 'should', description: 'Material that should normally appear unless there is a strong editorial reason not to.' },
  { id: 'may', heading: 'MAY USE', aliases: ['MAY', 'OPTIONAL'], priority: 'may', description: 'Optional ideas, jokes, examples or side notes.' },
  { id: 'background', heading: 'BACKGROUND ONLY', aliases: ['BACKGROUND'], priority: 'background', description: 'Context for the agent. Not published unless promoted to another section.' },
  { id: 'avoid', heading: 'DO NOT USE', aliases: ['AVOID', 'DONT USE', 'DO NOT'], priority: 'avoid', description: 'Things that must not appear in the article. Quoted fragments ("..." or «...») are checked literally.' },
  { id: 'raw-notes', heading: 'RAW NOTES', aliases: ['NOTES', 'RAW'], priority: 'unclassified', description: 'Unstructured thoughts. The editorial pass decides what to do with them.' },
  { id: 'personal-context', heading: 'PERSONAL CONTEXT', aliases: ['PERSONAL'], priority: 'may', description: 'Motives, experiences or reactions that cannot be inferred from Git. The only legitimate source of first-person experiences in the article.' },
  { id: 'humor', heading: 'POSSIBLE HUMOR', aliases: ['HUMOR', 'HUMOUR', 'POSSIBLE HUMOUR', 'JOKES'], priority: 'may', description: 'Optional jokes or humorous observations.' },
  { id: 'questions', heading: 'QUESTIONS / UNCERTAINTIES', aliases: ['QUESTIONS', 'UNCERTAINTIES'], priority: 'question', description: 'Things the author is unsure about. Never published as statements.' },
];

export const PRIORITY_TO_SECTION: Record<MaterialPriority, InputSection> = { verbatim: 'verbatim', must: 'must', should: 'should', may: 'may', background: 'background', avoid: 'avoid' };

export const authorInputItemSchema = z.object({
  /** Content-derived id (`<section>-<hash>`): editing an item's text gives it a new id on purpose. */
  id: z.string(),
  section: inputSectionSchema,
  priority: itemPrioritySchema,
  text: z.string(),
  /** 1-based line range in author-input.md. */
  lines: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  /** Personal context: author-supplied experience that may be told in the first person. */
  authorExperience: z.boolean().default(false),
});
export type AuthorInputItem = z.infer<typeof authorInputItemSchema>;

export const authorInputIssueSchema = z.object({ severity: z.enum(['error', 'warning']), message: z.string(), line: z.number().int().optional() });
export type AuthorInputIssue = z.infer<typeof authorInputIssueSchema>;

export const authorInputSchema = z.object({
  schemaVersion: z.literal(AUTHOR_INPUT_SCHEMA_VERSION),
  story: z.string().optional(),
  /** sha256 of the file (line endings normalised); recorded by derived plans to detect drift. */
  sourceHash: z.string(),
  items: z.array(authorInputItemSchema),
  issues: z.array(authorInputIssueSchema),
});
export type AuthorInput = z.infer<typeof authorInputSchema>;

const normHeading = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const HEADING_INDEX = new Map<string, SectionDef>();
for (const def of INPUT_SECTIONS) for (const h of [def.heading, ...def.aliases]) HEADING_INDEX.set(normHeading(h), def);

export function sectionDef(id: InputSection): SectionDef {
  return INPUT_SECTIONS.find((d) => d.id === id)!;
}

/** Collapses runs of whitespace (including line breaks from wrapping). The only normalisation applied to exact phrases. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

const QUOTE_PAIRS: Array<[string, string]> = [
  ['"', '"'],
  ['«', '»'],
  ['“', '”'],
  ['„', '“'],
  ["'", "'"],
];

/** Removes one pair of matching quotes around the whole text; quotes mark a phrase, they are not part of it. */
export function stripEnclosingQuotes(text: string): string {
  const t = text.trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (t.length > open.length + close.length && t.startsWith(open) && t.endsWith(close)) {
      const inner = t.slice(open.length, t.length - close.length);
      if (!inner.includes(open) && !inner.includes(close)) return inner.trim();
    }
  }
  return t;
}

/**
 * Literal phrases a DO NOT USE item forbids: quoted fragments inside the item
 * when there are any (`не писать «революционный»` → `революционный`),
 * otherwise the whole item.
 */
export function forbiddenPhrases(item: Pick<AuthorInputItem, 'text'>): string[] {
  const quoted = [...item.text.matchAll(/"([^"\n]+)"|«([^»\n]+)»|“([^”\n]+)”/g)].map((m) => (m[1] ?? m[2] ?? m[3] ?? '').trim()).filter(Boolean);
  if (quoted.length > 0) return quoted;
  const whole = stripEnclosingQuotes(item.text);
  return whole ? [whole] : [];
}

/** The exact phrase of a VERBATIM item. */
export function verbatimPhrase(item: Pick<AuthorInputItem, 'text'>): string {
  return stripEnclosingQuotes(item.text);
}

const BULLET = /^ {0,3}(?:[-*+]|\d{1,3}[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

function splitFrontmatter(source: string): { data: Record<string, unknown> | undefined; body: string; bodyStartLine: number; error?: string } {
  if (!/^\uFEFF?---\n/.test(source)) return { data: undefined, body: source, bodyStartLine: 1 };
  const match = source.match(/^\uFEFF?---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!match) return { data: undefined, body: source, bodyStartLine: 1, error: 'frontmatter starts with "---" but is never closed' };
  let parsed: unknown;
  try {
    parsed = YAML.parse(match[1] ?? '');
  } catch (error) {
    return { data: undefined, body: source, bodyStartLine: 1, error: `frontmatter is not valid YAML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}` };
  }
  if (parsed !== null && parsed !== undefined && (typeof parsed !== 'object' || Array.isArray(parsed))) return { data: undefined, body: source, bodyStartLine: 1, error: 'frontmatter must be a YAML mapping (key: value)' };
  const consumed = match[0];
  return { data: (parsed as Record<string, unknown> | null) ?? {}, body: source.slice(consumed.length), bodyStartLine: consumed.split('\n').length - (consumed.endsWith('\n') ? 0 : 1) };
}

/** Replaces HTML comments with the same number of line breaks so line numbers stay correct. */
export function blankOutComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));
}

/**
 * Parses author-input.md. Throws EditorialError for malformed frontmatter
 * (the file cannot be trusted); everything else is reported as issues.
 * An empty file is valid and yields no items.
 */
export function parseAuthorInput(source: string, options: { expectedStory?: string; label?: string } = {}): AuthorInput {
  const label = options.label ?? 'author-input.md';
  const text = source.replace(/\r\n?/g, '\n');
  const sourceHash = hashText(text);
  const issues: AuthorInputIssue[] = [];
  const fm = splitFrontmatter(text);
  if (fm.error) throw new EditorialError('AUTHOR_INPUT_FRONTMATTER', `${label}: ${fm.error}`, { hint: 'Fix the block between the two "---" lines, or delete it (frontmatter is optional).' });
  let story: string | undefined;
  if (fm.data) {
    const version = fm.data.schemaVersion;
    if (version !== undefined && version !== AUTHOR_INPUT_SCHEMA_VERSION) {
      throw new EditorialError('AUTHOR_INPUT_FRONTMATTER', `${label}: unsupported schemaVersion ${String(version)} (expected ${AUTHOR_INPUT_SCHEMA_VERSION})`);
    }
    if (fm.data.story !== undefined) {
      if (typeof fm.data.story !== 'string') throw new EditorialError('AUTHOR_INPUT_FRONTMATTER', `${label}: "story" must be a string (the article slug)`);
      story = fm.data.story;
    }
  }
  if (story && options.expectedStory && story !== options.expectedStory) {
    issues.push({ severity: 'error', message: `${label} belongs to story "${story}", not "${options.expectedStory}".` });
  }

  const lines = blankOutComments(fm.body).split('\n');
  const items: AuthorInputItem[] = [];
  let section: SectionDef = sectionDef('raw-notes');
  let current: { start: number; end: number; lines: string[] } | undefined;
  let inFence = false;
  const flush = () => {
    if (!current) return;
    const body = current.lines.join('\n').trim();
    if (body) {
      const itemText = section.id === 'verbatim' ? stripEnclosingQuotes(body) : body;
      items.push({ id: '', section: section.id, priority: section.priority, text: itemText, lines: [current.start, current.end], authorExperience: section.id === 'personal-context' });
    }
    current = undefined;
  };

  lines.forEach((raw, i) => {
    const lineNo = fm.bodyStartLine + i;
    if (FENCE.test(raw)) {
      inFence = !inFence;
      if (!current) current = { start: lineNo, end: lineNo, lines: [] };
      current.lines.push(raw);
      current.end = lineNo;
      return;
    }
    if (inFence) {
      current!.lines.push(raw);
      current!.end = lineNo;
      return;
    }
    const heading = raw.match(HEADING);
    if (heading) {
      flush();
      if (heading[1]!.length === 1) return; // document title
      const def = HEADING_INDEX.get(normHeading(heading[2]!));
      if (def) section = def;
      else {
        section = sectionDef('raw-notes');
        issues.push({ severity: 'warning', line: lineNo, message: `Unknown section "${heading[2]}"; its content is treated as RAW NOTES. Known sections: ${INPUT_SECTIONS.map((d) => d.heading).join(', ')}.` });
      }
      return;
    }
    if (raw.trim() === '') {
      flush();
      return;
    }
    const bullet = raw.match(BULLET);
    if (bullet) {
      flush();
      current = { start: lineNo, end: lineNo, lines: [bullet[1]!] };
      return;
    }
    if (!current) current = { start: lineNo, end: lineNo, lines: [] };
    current.lines.push(raw.trim());
    current.end = lineNo;
  });
  if (inFence) issues.push({ severity: 'warning', message: 'An unclosed code fence swallowed the rest of the file into one item.' });
  flush();

  const seen = new Map<string, number>();
  for (const item of items) {
    const base = `${item.section}-${shortHash(normalizeWhitespace(item.text), 8)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    item.id = n === 1 ? base : `${base}-${n}`;
    if (n > 1) issues.push({ severity: 'warning', line: item.lines[0], message: `Duplicate ${sectionDef(item.section).heading} item: "${abbreviate(item.text)}".` });
  }
  for (const item of items.filter((x) => x.section === 'verbatim')) {
    if (verbatimPhrase(item).length === 0) issues.push({ severity: 'error', line: item.lines[0], message: 'Empty VERBATIM phrase.' });
  }
  // Explicit conflicts inside author material are surfaced, never silently resolved.
  const avoid = items.filter((x) => x.section === 'avoid');
  for (const item of items.filter((x) => x.priority === 'verbatim' || x.priority === 'must' || x.priority === 'should')) {
    for (const a of avoid) {
      for (const phrase of forbiddenPhrases(a)) {
        if (containsPhrase(item.text, phrase, { caseInsensitive: true })) {
          issues.push({ severity: 'error', line: item.lines[0], message: `${sectionDef(item.section).heading} item "${abbreviate(item.text)}" contains "${phrase}", which DO NOT USE forbids. DO NOT USE wins; resolve the conflict in author-input.md.` });
        }
      }
    }
  }
  return authorInputSchema.parse({ schemaVersion: AUTHOR_INPUT_SCHEMA_VERSION, ...(story ? { story } : {}), sourceHash, items, issues });
}

export function abbreviate(text: string, max = 80): string {
  const t = normalizeWhitespace(text);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Whitespace-insensitive, whole-word phrase search. Returns the index in the
 * ORIGINAL text, or -1. Case folding is opt-in (used for DO NOT USE, never for VERBATIM).
 */
export function findPhrase(text: string, phrase: string, options: { caseInsensitive?: boolean } = {}): number {
  const needle = normalizeWhitespace(phrase);
  if (!needle) return -1;
  const pattern = needle
    .split(' ')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  // Unicode-aware word edges (JS \b is ASCII-only): «ИИ» must not match inside «линии».
  const start = /^[\p{L}\p{N}]/u.test(needle) ? '(?<![\\p{L}\\p{N}])' : '';
  const end = /[\p{L}\p{N}]$/u.test(needle) ? '(?![\\p{L}\\p{N}])' : '';
  const re = new RegExp(`${start}${pattern}${end}`, options.caseInsensitive ? 'iu' : 'u');
  const m = re.exec(text);
  return m ? m.index : -1;
}

export function containsPhrase(text: string, phrase: string, options: { caseInsensitive?: boolean } = {}): boolean {
  return findPhrase(text, phrase, options) >= 0;
}

/** Items grouped by effective priority. */
export function itemsByPriority(input: AuthorInput): Record<ItemPriority, AuthorInputItem[]> {
  const out = Object.fromEntries(itemPrioritySchema.options.map((p) => [p, [] as AuthorInputItem[]])) as Record<ItemPriority, AuthorInputItem[]>;
  for (const item of input.items) out[item.priority].push(item);
  return out;
}

export function authorInputTemplate(slug: string): string {
  const parts = ['---', `schemaVersion: ${AUTHOR_INPUT_SCHEMA_VERSION}`, `story: ${slug}`, '---', '', '# Author input', '', '<!--', 'Throw in raw thoughts, phrases, anecdotes, jokes and fragments. Nothing here has to be', 'complete or formal, and no section is required: an empty file is valid.', 'One item per bullet or per paragraph (separate items with a blank line).', 'This is editorial material, not evidence: facts still come from story.json.', '-->', ''];
  for (const def of INPUT_SECTIONS) parts.push(`## ${def.heading}`, '', `<!-- ${def.description} -->`, '');
  return parts.join('\n');
}

/**
 * Appends an item to a section of author-input.md, keeping everything else
 * byte-for-byte. Continuation lines are indented so they stay in the item.
 */
export function addAuthorInputItem(source: string, section: InputSection, text: string): string {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (!clean) throw new EditorialError('AUTHOR_INPUT_EMPTY', 'Refusing to add an empty item.');
  const [first, ...rest] = clean.split('\n');
  const entry = [`- ${first}`, ...rest.map((l) => (l.trim() ? `    ${l.trim()}` : '    '))].join('\n');
  const def = sectionDef(section);
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => {
    const h = l.match(/^##\s+(.+?)\s*#*\s*$/);
    return Boolean(h && HEADING_INDEX.get(normHeading(h[1]!))?.id === section);
  });
  if (start < 0) {
    const base = source.replace(/\s*$/, '');
    return `${base}${base ? '\n\n' : ''}## ${def.heading}\n\n${entry}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,2}\s/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1]!.trim() === '') insertAt -= 1;
  const prev = lines[insertAt - 1] ?? '';
  // A preceding paragraph item (not a bullet, heading or comment) must stay a separate item.
  const needsGap = insertAt === start + 1 || (!BULLET.test(prev) && !/^\s{4}/.test(prev));
  const block = needsGap ? ['', entry] : [entry];
  const tail = lines.slice(insertAt);
  const out = [...lines.slice(0, insertAt), ...block, ...(tail.length && tail[0]!.trim() !== '' ? [''] : []), ...tail];
  return out.join('\n');
}
