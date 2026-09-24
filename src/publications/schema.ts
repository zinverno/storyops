import { z } from 'zod';

export const PUBLICATION_SCHEMA_VERSION = 1;

/** All metrics are optional: platforms expose different signals, and parsers may miss some. */
export const publicationMetricsSchema = z.object({
  views: z.number().nonnegative().optional(),
  /** True when the platform shows a rounded value such as "12K". */
  viewsApproximate: z.boolean().optional(),
  rating: z.number().optional(),
  votes: z.number().nonnegative().optional(),
  votesUp: z.number().nonnegative().optional(),
  votesDown: z.number().nonnegative().optional(),
  bookmarks: z.number().nonnegative().optional(),
  comments: z.number().nonnegative().optional(),
  readingTimeMinutes: z.number().nonnegative().optional(),
});
export type PublicationMetrics = z.infer<typeof publicationMetricsSchema>;

export const mediaSchema = z.object({
  type: z.enum(['image', 'video', 'embed', 'diagram']),
  src: z.string(),
  alt: z.string().optional(),
});

export const codeBlockSchema = z.object({
  language: z.string().optional(),
  lines: z.number().int().nonnegative(),
});

export const headingSchema = z.object({ level: z.number().int().min(1).max(6), text: z.string() });

/**
 * How deeply a publication treats its subject. Used for cross-platform
 * continuity: a short Telegram note ("brief") does not make a deep Habr
 * explanation redundant.
 */
export const depthSchema = z.enum(['brief', 'standard', 'deep']);
export type PublicationDepth = z.infer<typeof depthSchema>;

export const publicationSchema = z.object({
  schemaVersion: z.literal(PUBLICATION_SCHEMA_VERSION).default(PUBLICATION_SCHEMA_VERSION),
  /** Stable id: `<platform>:<platform-specific id>`. */
  id: z.string().min(3),
  platform: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url().optional(),
  publicationDate: z.string().datetime({ offset: true }).optional(),
  language: z.string().optional(),
  author: z.string().optional(),
  /** Plain body text (code blocks removed). Stored only for the author's own publications. */
  text: z.string().default(''),
  lead: z.string().optional(),
  headings: z.array(headingSchema).default([]),
  codeBlocks: z.array(codeBlockSchema).default([]),
  topics: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  hubs: z.array(z.string()).default([]),
  metrics: publicationMetricsSchema.default({}),
  media: z.array(mediaSchema).default([]),
  projectReferences: z.array(z.string()).default([]),
  /** Explicit claims captured by the author or an agent (optional). */
  claims: z.array(z.string()).default([]),
  depth: depthSchema.optional(),
  wordCount: z.number().int().nonnegative().optional(),
  source: z.object({
    adapter: z.string(),
    collectedAt: z.string().datetime({ offset: true }),
    fromCache: z.boolean().optional(),
    warnings: z.array(z.string()).default([]),
  }),
});
export type Publication = z.infer<typeof publicationSchema>;
