import { z } from 'zod';
import type { PlatformConfig } from '../src/config/schema.js';
import type { Publication } from '../src/publications/schema.js';
import type { Clock } from '../src/shared/clock.js';
import type { Logger } from '../src/shared/logger.js';
import type { HttpClient } from '../src/research/http.js';
import type { FailureRecord, SourceRecord, TrendArticle } from '../src/research/types.js';

/**
 * Platform strategy, version 2 (StoryOps v3). A strategy describes how to
 * ANALYSE a platform and REVIEW a human-written article's fit for it. It no
 * longer describes how to generate a publication: v1 fields for draft
 * skeletons, openings and headline templates were removed.
 */
export const PLATFORM_STRATEGY_SCHEMA_VERSION = 2;

/**
 * Every rule is explicitly one of:
 * - `constraint`: a hard platform limit (e.g. a documented character limit).
 * - `recommendation`: stable platform convention, reported as context only.
 * `source` says where the rule comes from so it can be re-verified.
 */
export const ruleSchema = z.object({
  kind: z.enum(['constraint', 'recommendation']),
  text: z.string().min(1),
  source: z.string().optional(),
});
export type StrategyRule = z.infer<typeof ruleSchema>;

const rules = z.array(ruleSchema);

/** Kinds of technical articles; review profiles and length context are keyed by them. */
export const publicationTypeSchema = z.enum([
  'engineering-story',
  'architecture-deep-dive',
  'postmortem',
  'experiment',
  'tutorial',
  'release-retrospective',
  'migration-story',
  'refactor-story',
  'product-update',
  'technical-announcement',
  'short-project-update',
  'technical-mini-post',
  'channel-longread',
]);
export type PublicationType = z.infer<typeof publicationTypeSchema>;

export const lengthRangeSchema = z.object({
  unit: z.enum(['words', 'characters']),
  min: z.number().int().nonnegative(),
  max: z.number().int().positive(),
  kind: z.enum(['constraint', 'recommendation']),
  note: z.string().optional(),
});
export type LengthRange = z.infer<typeof lengthRangeSchema>;

export const platformStrategySchema = z.object({
  schemaVersion: z.literal(PLATFORM_STRATEGY_SCHEMA_VERSION),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  displayName: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  /** How StoryOps can learn about this platform. */
  research: z.object({
    liveResearch: z.enum(['implemented', 'unsupported', 'not-applicable']),
    authorHistory: z.enum(['implemented', 'manual-import', 'not-applicable']),
    /** Datasets can always be imported (`storyops research import`); live research may still be unsupported. */
    importSupported: z.boolean(),
    sources: z.array(z.string()),
    limitations: z.array(z.string()),
  }),
  /**
   * Context for platform-fit review. Everything here is reported as context
   * next to the author's own choices; none of it overrides the author.
   */
  reviewContext: z.object({
    /** Typical length per article kind (context, not a target). */
    typicalLength: z.record(z.string(), lengthRangeSchema),
    /** Whether sectioned long-form is usual. */
    sections: z.enum(['usual', 'optional', 'not-rendered']),
    code: z.enum(['common', 'when-useful', 'rare']),
    images: z.object({ min: z.number().int().nonnegative(), max: z.number().int().positive() }),
    /** Generic, context-free introductions (reviewed as a structure finding when discouraged). */
    genericIntro: z.enum(['discouraged', 'neutral']),
    marketingTolerance: z.enum(['none', 'low', 'moderate']),
    conventions: rules,
  }),
  formatting: z.object({
    format: z.enum(['markdown', 'html', 'plain-text', 'telegram-markdown']),
    constraints: rules,
  }),
  metadata: z.object({
    required: z.array(z.string()),
    optional: z.array(z.string()),
  }),
});
export type PlatformStrategy = z.infer<typeof platformStrategySchema>;

export interface ResearchContext {
  http: HttpClient;
  logger: Logger;
  clock: Clock;
  config: PlatformConfig;
}

export interface CollectionResult<T> {
  items: T[];
  sources: SourceRecord[];
  failures: FailureRecord[];
  warnings: string[];
}

export interface TrendWindow {
  id: string;
  period: string;
  hub?: string;
  url: string;
}

export interface TrendCollectionOptions {
  periods: string[];
  hubs: string[];
  maxArticlesPerPeriod: number;
  fetchArticleBodies: boolean;
  /**
   * Article ids whose abstract features are already stored and unchanged.
   * Their bodies are not downloaded again (metrics still come from list pages).
   */
  knownFeatures?: ReadonlySet<string>;
}

/** Optional live-research capability of a platform. */
export interface PlatformResearchAdapter {
  collectAuthorHistory?(profileUrl: string, ctx: ResearchContext, options: { maxArticles: number }): Promise<CollectionResult<Publication>>;
  collectTrends?(ctx: ResearchContext, options: TrendCollectionOptions): Promise<CollectionResult<TrendArticle> & { windows: TrendWindow[] }>;
}

/**
 * A platform module = strategy (required) + optional research adapter.
 * Registering one never requires changes in the database, topic, author,
 * repository or review layers.
 */
export interface PlatformModule {
  strategy: PlatformStrategy;
  research?: PlatformResearchAdapter;
}
