import { z } from 'zod';

export const CONFIG_SCHEMA_VERSION = 1;

const periodSchema = z.enum(['daily', 'weekly', 'monthly', 'yearly', 'alltime']);
export type ResearchPeriod = z.infer<typeof periodSchema>;

/**
 * Per-platform config. Known keys are validated; platform adapters may read
 * additional keys through `options`, so adding a platform never requires
 * changing this schema.
 */
export const platformConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    periods: z.array(periodSchema).optional(),
    hubs: z.array(z.string().regex(/^[a-z0-9_-]+$/i, 'hub slugs contain only letters, digits, "_" and "-"')).optional(),
    maxArticlesPerPeriod: z.number().int().positive().max(200).optional(),
    /** Fetch article pages to extract structural features (headings, code, images). */
    fetchArticleBodies: z.boolean().optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type PlatformConfig = z.infer<typeof platformConfigSchema>;

export const glossaryEntrySchema = z.object({ term: z.string().min(1), aliases: z.array(z.string()).default([]) });
export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>;

export function normalizeGlossary(entries: ReadonlyArray<string | GlossaryEntry>): GlossaryEntry[] {
  return entries.map((e) => (typeof e === 'string' ? { term: e, aliases: [] } : e));
}

export const projectConfigSchema = z.object({
  /** Stable project id used in artifacts (e.g. "notegarden"). */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  /** Path to the project repository, relative to the workspace root or absolute. */
  path: z.string().min(1).optional(),
  /** Extra words that identify the project in publications (brand spellings, old names). */
  aliases: z.array(z.string()).default([]),
  /**
   * Project vocabulary; used to recognise concepts in publications and code.
   * An entry is a term, or a term with aliases (other spellings, other
   * languages, code identifiers): { "term": "модель здоровья", "aliases": ["health model", "health"] }.
   */
  glossary: z.array(z.union([z.string(), glossaryEntrySchema])).default([]),
});
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export const editorialConfigSchema = z.object({
  schemaVersion: z.literal(CONFIG_SCHEMA_VERSION).default(CONFIG_SCHEMA_VERSION),
  language: z.string().min(2).default('ru'),
  author: z
    .object({
      name: z.string().min(1),
      /** platform id -> public profile URL. No platform is required. */
      profiles: z.record(z.string(), z.string().url()).default({}),
      styleProfile: z.string().default('ru-technical'),
    }),
  projects: z.array(projectConfigSchema).default([]),
  research: z
    .object({
      cacheTtlHours: z.number().positive().default(24),
      defaultPlatform: z.string().default('habr'),
      /** Minimum delay between requests to the same host. Values below 1000ms are rejected. */
      requestDelayMs: z.number().int().min(1000).default(2000),
      concurrency: z.number().int().min(1).max(4).default(2),
      timeoutMs: z.number().int().positive().default(20_000),
      /** Optional contact URL/email appended to the User-Agent so site operators can reach you. */
      userAgentContact: z.string().optional(),
    })
    .default({ cacheTtlHours: 24, defaultPlatform: 'habr', requestDelayMs: 2000, concurrency: 2, timeoutMs: 20_000 }),
  platforms: z.record(z.string(), platformConfigSchema).default({}),
  screenshots: z
    .object({
      viewport: z.object({ width: z.number().int().min(320).max(3840), height: z.number().int().min(240).max(2160) }).default({ width: 1440, height: 1000 }),
      deviceScaleFactor: z.number().min(1).max(3).default(1),
      outputDir: z.string().default('images'),
      browserExecutablePath: z.string().optional(),
    })
    .default({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, outputDir: 'images' }),
  /** Optional Phase 2 editorial defaults. Article style is normally chosen per article. */
  editorial: z
    .object({
      /** Style preset used by `editorial plan` when no --style is given (e.g. "engineering-story"). */
      defaultStyle: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
    })
    .optional(),
  paths: z
    .object({
      editorialDir: z.string().default('.editorial'),
      articlesDir: z.string().default('articles'),
    })
    .default({ editorialDir: '.editorial', articlesDir: 'articles' }),
});

export type EditorialConfig = z.infer<typeof editorialConfigSchema>;
