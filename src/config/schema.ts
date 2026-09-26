import { z } from 'zod';

/** Version 2 = StoryOps v3 (content intelligence). Version 1 files (editorial-kit) are still accepted. */
export const CONFIG_SCHEMA_VERSION = 2;

const periodSchema = z.enum(['daily', 'weekly', 'monthly', 'yearly', 'alltime']);
export type ResearchPeriod = z.infer<typeof periodSchema>;

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and hyphens');

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
    /** Fetch article pages to extract abstract structural features (headings, code, images). Bodies are discarded. */
    fetchArticleBodies: z.boolean().optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type PlatformConfig = z.infer<typeof platformConfigSchema>;

export const glossaryEntrySchema = z.object({
  term: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  /** Stable topic id (default: derived from the first ASCII alias or the term). */
  id: slug.optional(),
  /** Built-in topics that give platform context for this project concept (e.g. ["databases"]). */
  related: z.array(z.string()).default([]),
});
export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>;

export function normalizeGlossary(entries: ReadonlyArray<string | GlossaryEntry>): GlossaryEntry[] {
  return entries.map((e) => (typeof e === 'string' ? { term: e, aliases: [], related: [] } : { ...e, aliases: e.aliases ?? [], related: e.related ?? [] }));
}

export const projectConfigSchema = z.object({
  /** Stable project id used in artifacts and as the repository id (e.g. "notegarden"). */
  id: slug,
  name: z.string().min(1),
  /** Path to the project repository, relative to the workspace root or absolute. */
  path: z.string().min(1).optional(),
  /** Extra words that identify the project in publications (brand spellings, old names). */
  aliases: z.array(z.string()).default([]),
  /**
   * Project vocabulary. Each entry becomes a project topic: a term, or a term
   * with aliases (other spellings, other languages, code identifiers):
   * { "term": "модель здоровья", "aliases": ["health model", "health"], "related": ["architecture"] }.
   */
  glossary: z.array(z.union([z.string(), glossaryEntrySchema])).default([]),
});
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/** Additional workspace topics (beyond the built-in taxonomy and project glossaries). */
export const topicConfigSchema = z.object({
  id: slug,
  label: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  parent: z.string().optional(),
  related: z.array(z.string()).default([]),
  hubs: z.array(z.string()).default([]),
  specificity: z.enum(['generic', 'technology', 'practice', 'project']).default('technology'),
});
export type TopicConfig = z.infer<typeof topicConfigSchema>;

/**
 * Thresholds of the transparent analyses. Every state a report assigns names
 * the rule and the numbers that produced it; changing these changes the
 * labels, never hidden scores.
 */
export const saturationThresholdsSchema = z.object({
  /** Articles in the window below which no state other than insufficient-data is assigned. */
  minSample: z.number().int().positive().default(15),
  highlySaturatedShare: z.number().min(0).max(1).default(0.3),
  crowdedShare: z.number().min(0).max(1).default(0.15),
  activeShare: z.number().min(0).max(1).default(0.05),
  activeCount: z.number().int().positive().default(4),
  /** Relative growth vs the previous window that marks a small topic as emerging. */
  emergingGrowth: z.number().positive().default(0.5),
  emergingMaxShare: z.number().min(0).max(1).default(0.1),
});
export type SaturationThresholds = z.infer<typeof saturationThresholdsSchema>;

export const trendSettingsSchema = z.object({
  /** Width of one comparison bucket in days. */
  windowDays: z.number().int().positive().default(7),
  /** Buckets with data needed before a direction is reported. */
  minPoints: z.number().int().min(2).default(3),
  /** Minimum articles in a bucket for it to count. */
  minBucketSample: z.number().int().positive().default(5),
  /** Relative change of the topic share (later half vs earlier half) that counts as rising/declining. */
  changeThreshold: z.number().positive().default(0.2),
  /** Absolute share change that must also be exceeded (guards tiny shares). */
  minAbsoluteChange: z.number().min(0).default(0.02),
  /** Topic articles needed across the usable buckets before a direction is reported. */
  minTopicArticles: z.number().int().min(1).default(4),
});
export type TrendSettings = z.infer<typeof trendSettingsSchema>;

export const analysisConfigSchema = z.object({
  /** Default analysis window for saturation and activity, in days. */
  windowDays: z.number().int().positive().default(30),
  saturation: saturationThresholdsSchema.default(saturationThresholdsSchema.parse({})),
  trends: trendSettingsSchema.default(trendSettingsSchema.parse({})),
  /** Author coverage older than this many days is reported as possibly outdated. */
  outdatedAfterDays: z.number().int().positive().default(730),
});
export type AnalysisConfig = z.infer<typeof analysisConfigSchema>;

export const storyOpsConfigSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]).default(CONFIG_SCHEMA_VERSION),
  language: z.string().min(2).default('ru'),
  author: z.object({
    name: z.string().min(1),
    /** platform id -> public profile URL. No platform is required. */
    profiles: z.record(z.string(), z.string().url()).default({}),
    /** Language profile used by review (ru-technical, en-technical). */
    styleProfile: z.string().default('ru-technical'),
  }),
  projects: z.array(projectConfigSchema).default([]),
  topics: z.array(topicConfigSchema).default([]),
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
  analysis: analysisConfigSchema.default(analysisConfigSchema.parse({})),
  review: z
    .object({
      /** Default review profile (see `storyops profiles list`), e.g. "engineering-story". */
      profile: slug.optional(),
      /** Maximum length of a local alternative in a finding (characters). */
      maxAlternativeChars: z.number().int().min(40).max(400).default(240),
    })
    .default({ maxAlternativeChars: 240 }),
  database: z.object({ file: z.string().optional() }).default({}),
  /** @deprecated screenshot capture was removed (StoryOps creates no publication assets). Accepted with a warning; ignored. */
  screenshots: z.object({}).passthrough().optional(),
  /** @deprecated v2 generation settings. Accepted with a warning; ignored. */
  editorial: z.object({ defaultStyle: z.string().optional() }).passthrough().optional(),
  paths: z
    .object({
      /** StoryOps data directory (database, cache, reports). */
      dataDir: z.string().default('.storyops'),
      /** Topic dossiers and opportunity reports. */
      topicsDir: z.string().default('topics'),
      /** Review reports. */
      reviewsDir: z.string().default('reviews'),
      /** Legacy v2 data directory; read by `storyops migrate`. */
      editorialDir: z.string().default('.editorial'),
      /** @deprecated v2 article workspaces; StoryOps no longer creates them. */
      articlesDir: z.string().optional(),
    })
    .default({ dataDir: '.storyops', topicsDir: 'topics', reviewsDir: 'reviews', editorialDir: '.editorial' }),
});

export type StoryOpsConfig = z.infer<typeof storyOpsConfigSchema>;

/** Deprecated, generation-oriented fields found in a raw config: warned about, never acted on. */
export function configDeprecations(raw: unknown): string[] {
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') return warnings;
  const r = raw as Record<string, unknown>;
  const editorial = r.editorial as Record<string, unknown> | undefined;
  if (editorial && Object.keys(editorial).length > 0) {
    warnings.push('config "editorial" (v2 editorial plan / style defaults) is deprecated and ignored: StoryOps no longer plans or drafts articles. Use "review.profile" to pick a review profile.');
  }
  if (r.screenshots !== undefined) {
    warnings.push('config "screenshots" is deprecated and ignored: StoryOps is analysis-only and no longer captures screenshots or other publication assets.');
  }
  const paths = r.paths as Record<string, unknown> | undefined;
  if (paths && 'articlesDir' in paths) warnings.push('config "paths.articlesDir" is deprecated and ignored: StoryOps no longer creates article workspaces. Existing article folders are left untouched.');
  if (r.schemaVersion === 1) warnings.push('config schemaVersion 1 (editorial-kit) is still accepted; run `storyops migrate` to write storyops.config.json (schemaVersion 2).');
  return warnings;
}
