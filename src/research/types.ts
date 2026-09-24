import { z } from 'zod';
import { publicationMetricsSchema } from '../publications/schema.js';

export const titleFeaturesSchema = z.object({
  chars: z.number().int(),
  words: z.number().int(),
  isQuestion: z.boolean(),
  hasNumber: z.boolean(),
  firstPerson: z.boolean(),
  conflictFraming: z.boolean(),
  postmortemFraming: z.boolean(),
  beforeAfterFraming: z.boolean(),
  howToFraming: z.boolean(),
  hasSubtitleSeparator: z.boolean(),
  aiTopic: z.boolean(),
});
export type TitleFeatures = z.infer<typeof titleFeaturesSchema>;

export const structuralFeaturesSchema = z.object({
  wordCount: z.number().int(),
  introWords: z.number().int(),
  sectionCount: z.number().int(),
  codeBlocks: z.number().int(),
  /** Code lines / (code lines + prose lines estimate). */
  codeDensity: z.number(),
  images: z.number().int(),
  imagesPer1000Words: z.number(),
  diagramHints: z.number().int(),
  hasMeasurements: z.boolean(),
  /** Words of prose before the first code block, measurement or technical heading; undefined if none. */
  wordsBeforeFirstTechnicalDetail: z.number().int().optional(),
  /** Words before the first sentence describing a concrete problem/conflict; undefined if none detected. */
  wordsBeforeConflict: z.number().int().optional(),
  conclusionKind: z.enum(['summary', 'next-steps', 'questions', 'none']),
  postmortemStructure: z.boolean(),
  beforeAfterStructure: z.boolean(),
});
export type StructuralFeatures = z.infer<typeof structuralFeaturesSchema>;

export const momentumSchema = z.object({
  score: z.number(),
  ageHours: z.number(),
  components: z.record(z.string(), z.number()),
  missing: z.array(z.string()),
  /** Share of the formula's weight backed by real data (0..1). */
  coverage: z.number(),
});
export type Momentum = z.infer<typeof momentumSchema>;

/**
 * Research record for someone else's article. It intentionally contains only
 * metadata, numbers and abstract structural features: never body text, never
 * reusable passages. Titles are kept as provenance (they are shown on public
 * listing pages) and are not used as templates.
 */
export const trendArticleSchema = z.object({
  id: z.string(),
  platform: z.string(),
  url: z.string(),
  title: z.string(),
  author: z.string().optional(),
  publishedAt: z.string().optional(),
  /** When the metrics were observed (fetch time of the listing page). */
  observedAt: z.string().optional(),
  hubs: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  metrics: publicationMetricsSchema.default({}),
  /** Where this article was seen (e.g. "weekly", "weekly:programming"). */
  seenIn: z.array(z.string()).default([]),
  titleFeatures: titleFeaturesSchema.optional(),
  structure: structuralFeaturesSchema.optional(),
  momentum: momentumSchema.optional(),
  lifetimeRank: z.number().int().optional(),
  momentumRank: z.number().int().optional(),
  warnings: z.array(z.string()).default([]),
});
export type TrendArticle = z.infer<typeof trendArticleSchema>;

export const sourceRecordSchema = z.object({
  url: z.string(),
  fetchedAt: z.string(),
  fromCache: z.boolean(),
  cacheAgeHours: z.number().optional(),
  stale: z.boolean().optional(),
  window: z.string().optional(),
});
export type SourceRecord = z.infer<typeof sourceRecordSchema>;

export const failureRecordSchema = z.object({ url: z.string().optional(), stage: z.string(), reason: z.string() });
export type FailureRecord = z.infer<typeof failureRecordSchema>;

export const observationSchema = z.object({
  id: z.string(),
  /** An inspectable statement about the sample. Never a recommendation. */
  statement: z.string(),
  metric: z.string(),
  sample: z.object({ window: z.string(), size: z.number().int(), groupSize: z.number().int().optional(), comparisonSize: z.number().int().optional() }),
  values: z.record(z.string(), z.union([z.number(), z.string()])),
  articleIds: z.array(z.string()),
  strength: z.enum(['weak', 'moderate', 'notable']),
  limitations: z.array(z.string()),
});
export type Observation = z.infer<typeof observationSchema>;

export const saturatedAngleSchema = z.object({
  term: z.string(),
  label: z.string(),
  share: z.number(),
  count: z.number().int(),
  sampleSize: z.number().int(),
  exampleArticleIds: z.array(z.string()),
});
export type SaturatedAngle = z.infer<typeof saturatedAngleSchema>;

export const RESEARCH_SNAPSHOT_SCHEMA_VERSION = 1;

export const researchSnapshotSchema = z.object({
  schemaVersion: z.literal(RESEARCH_SNAPSHOT_SCHEMA_VERSION),
  platform: z.string(),
  collectedAt: z.string(),
  /** live: everything fetched now; partial: some sources failed or came from stale cache; cache: offline/cached only. */
  status: z.enum(['live', 'partial', 'cache', 'unsupported', 'failed']),
  windows: z.array(z.object({ id: z.string(), period: z.string(), hub: z.string().optional(), url: z.string() })),
  filters: z.object({ hubs: z.array(z.string()), periods: z.array(z.string()), maxArticlesPerPeriod: z.number().int().optional() }),
  sampleSize: z.number().int(),
  sources: z.array(sourceRecordSchema),
  failures: z.array(failureRecordSchema),
  articles: z.array(trendArticleSchema),
  observations: z.array(observationSchema),
  saturatedAngles: z.array(saturatedAngleSchema),
  limitations: z.array(z.string()),
  momentumFormula: z.string(),
  /** Oldest source fetch time; used to disclose cache age. */
  oldestSourceAt: z.string().optional(),
});
export type ResearchSnapshot = z.infer<typeof researchSnapshotSchema>;
