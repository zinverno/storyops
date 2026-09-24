import { z } from 'zod';
import type { PlatformConfig } from '../src/config/schema.js';
import type { Publication } from '../src/publications/schema.js';
import type { Clock } from '../src/shared/clock.js';
import type { Logger } from '../src/shared/logger.js';
import type { HttpClient } from '../src/research/http.js';
import type { FailureRecord, SourceRecord, TrendArticle } from '../src/research/types.js';
import type { CanonicalStory } from '../src/stories/schema.js';

export const PLATFORM_STRATEGY_SCHEMA_VERSION = 1;

/**
 * Every rule in a strategy is explicitly one of:
 * - `constraint`: a hard platform limit or requirement (e.g. a documented
 *   character limit). Violating it breaks publishing.
 * - `recommendation`: stable editorial guidance for the platform.
 * `source` says where the rule comes from so it can be re-verified.
 */
export const ruleSchema = z.object({
  kind: z.enum(['constraint', 'recommendation']),
  text: z.string().min(1),
  source: z.string().optional(),
});
export type StrategyRule = z.infer<typeof ruleSchema>;

const rules = z.array(ruleSchema);

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

export const platformStrategySchema = z.object({
  schemaVersion: z.literal(PLATFORM_STRATEGY_SCHEMA_VERSION),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  displayName: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  content: z.object({
    preferredDepth: z.enum(['brief', 'standard', 'deep']),
    technicalDetail: z.enum(['low', 'selective', 'moderate', 'high']),
    expectedLength: z.record(z.string(), lengthRangeSchema),
    supportedPublicationTypes: z.array(publicationTypeSchema).min(1),
    defaultPublicationType: publicationTypeSchema,
    rules,
  }),
  opening: z.object({
    preferred: z.string(),
    genericIntroPolicy: z.enum(['forbidden', 'discouraged']),
    previousPublicationCallback: z.enum(['required-for-series', 'recommended', 'optional', 'avoid']),
    rules,
  }),
  headline: z.object({
    maxLength: z.object({ chars: z.number().int().positive(), kind: z.enum(['constraint', 'recommendation']), source: z.string().optional() }).optional(),
    preferredPatterns: z.array(z.string()),
    avoidPatterns: z.array(z.string()),
    rules,
  }),
  structure: z.object({
    sections: z.enum(['required', 'recommended', 'optional', 'none']),
    paragraphDensity: z.enum(['short', 'medium', 'long']),
    lists: z.string(),
    code: z.enum(['encouraged', 'when-useful', 'sparingly', 'avoid']),
    rules,
  }),
  media: z.object({
    screenshots: z.enum(['encouraged', 'when-useful', 'limited', 'optional']),
    diagrams: z.enum(['encouraged', 'when-useful', 'limited', 'optional']),
    imageCount: z.object({ min: z.number().int().nonnegative(), max: z.number().int().positive() }),
    aspect: z.string().optional(),
    rules,
  }),
  links: z.object({ policy: z.string(), rules }),
  tone: z.object({
    formality: z.enum(['informal', 'conversational', 'professional', 'neutral']),
    marketingTolerance: z.enum(['none', 'low', 'moderate']),
    adjustments: z.array(z.string()),
    rules,
  }),
  formatting: z.object({
    format: z.enum(['markdown', 'html', 'plain-text', 'telegram-markdown']),
    constraints: rules,
  }),
  research: z.object({
    liveResearch: z.enum(['implemented', 'unsupported', 'not-applicable']),
    authorHistory: z.enum(['implemented', 'manual-import', 'not-applicable']),
    sources: z.array(z.string()),
    limitations: z.array(z.string()),
  }),
  metadata: z.object({
    required: z.array(z.string()),
    optional: z.array(z.string()),
  }),
  /**
   * Section skeletons per publication type. These are patterns the agent may
   * adapt, not templates it must fill.
   */
  structures: z.record(z.string(), z.array(z.object({ id: z.string(), purpose: z.string(), storyFields: z.array(z.string()) }))),
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

/** Optional live-research capability of a platform. */
export interface PlatformResearchAdapter {
  collectAuthorHistory?(profileUrl: string, ctx: ResearchContext, options: { maxArticles: number }): Promise<CollectionResult<Publication>>;
  collectTrends?(ctx: ResearchContext, options: { periods: string[]; hubs: string[]; maxArticlesPerPeriod: number; fetchArticleBodies: boolean }): Promise<CollectionResult<TrendArticle> & { windows: TrendWindow[] }>;
}

export interface RenderInput {
  story: CanonicalStory;
  strategy: PlatformStrategy;
  publicationType: PublicationType;
  storyPath: string;
}

/** Optional renderer producing the platform-specific draft workspace. */
export interface PlatformRenderer {
  render(input: RenderInput): string;
}

/**
 * A platform module = strategy (required) + optional research adapter +
 * optional renderer. Registering one never requires changing author memory,
 * continuity, narrative gap, stories, evidence or screenshots.
 */
export interface PlatformModule {
  strategy: PlatformStrategy;
  research?: PlatformResearchAdapter;
  renderer?: PlatformRenderer;
}
