import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Clock } from '../shared/clock.js';
import { EditorialError } from '../shared/errors.js';
import { parseFrontmatter } from '../shared/frontmatter.js';
import { parseMarkdownStructure } from '../shared/markdown.js';
import { slugify, wordCount } from '../shared/text.js';
import { depthSchema, publicationSchema, type Publication } from './schema.js';
import { estimateDepth } from './depth.js';

const frontmatterSchema = z.object({
  title: z.string().optional(),
  platform: z.string().optional(),
  url: z.string().url().optional(),
  date: z.union([z.string(), z.date()]).optional(),
  tags: z.array(z.string()).optional(),
  hubs: z.array(z.string()).optional(),
  projects: z.array(z.string()).optional(),
  depth: depthSchema.optional(),
  id: z.string().optional(),
  language: z.string().optional(),
});

export interface ImportOptions {
  platform?: string;
  url?: string;
  date?: string;
  clock: Clock;
}

/**
 * Imports a publication written anywhere (Telegram post, LinkedIn post,
 * personal blog) from a Markdown file with optional YAML frontmatter.
 * This is how platforms without a live author-history adapter participate in
 * cross-platform continuity.
 */
export async function importMarkdownPublication(file: string, options: ImportOptions): Promise<Publication> {
  const source = await readFile(file, 'utf8');
  const { data, body } = parseFrontmatter(source);
  const fm = frontmatterSchema.safeParse(data);
  if (!fm.success) {
    throw new EditorialError('IMPORT_FRONTMATTER', `Invalid frontmatter in ${file}: ${fm.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const meta = fm.data;
  const platform = options.platform ?? meta.platform;
  if (!platform) {
    throw new EditorialError('IMPORT_PLATFORM', `Cannot determine platform for ${file}`, { hint: 'Pass --platform or add `platform:` to the frontmatter.' });
  }
  const structure = parseMarkdownStructure(body);
  const title = meta.title ?? structure.title ?? path.basename(file, path.extname(file));
  const rawDate = options.date ?? (meta.date instanceof Date ? meta.date.toISOString() : meta.date);
  const publicationDate = rawDate ? normalizeDate(rawDate) : undefined;
  const words = wordCount(structure.plainText);
  const localId = meta.id ?? `${publicationDate?.slice(0, 10) ?? 'undated'}-${slugify(title, 40)}`;

  return publicationSchema.parse({
    id: `${platform}:${localId}`,
    platform,
    title,
    url: options.url ?? meta.url,
    publicationDate,
    language: meta.language,
    text: structure.plainText,
    lead: structure.introText.slice(0, 600) || undefined,
    headings: structure.headings,
    codeBlocks: structure.codeBlocks,
    tags: meta.tags ?? [],
    hubs: meta.hubs ?? [],
    media: structure.images.map((img) => ({ type: 'image' as const, src: img.src, alt: img.alt })),
    projectReferences: meta.projects ?? [],
    depth: meta.depth ?? estimateDepth({ words, headings: structure.headings.length, codeBlocks: structure.codeBlocks.length }),
    wordCount: words,
    source: { adapter: 'markdown-import', collectedAt: options.clock.now().toISOString(), warnings: [] },
  });
}

function normalizeDate(value: string): string {
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) throw new EditorialError('IMPORT_DATE', `Unrecognised date: ${value}`, { hint: 'Use ISO 8601, e.g. 2026-03-14.' });
  return parsed.toISOString();
}
