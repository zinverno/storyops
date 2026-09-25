import { z } from 'zod';

/**
 * Review findings. A finding identifies a possible issue, explains it and
 * suggests a direction; it may carry ONE short local alternative for the
 * exact excerpt. Findings never contain rewritten paragraphs or articles.
 */

export const REVIEW_SCHEMA_VERSION = 1;

export const categorySchema = z.enum(['language', 'style', 'logic', 'factual', 'repetition', 'structure', 'clarity', 'platform-fit', 'archive', 'author-input']);
export type Category = z.infer<typeof categorySchema>;

export const severitySchema = z.enum(['info', 'suggestion', 'warning', 'error']);
export type Severity = z.infer<typeof severitySchema>;

export const findingStatusSchema = z.enum(['open', 'accepted', 'dismissed', 'resolved']);
export type FindingStatus = z.infer<typeof findingStatusSchema>;

export const evidenceStatusSchema = z.enum(['supported', 'partially-supported', 'unsupported', 'contradicted', 'needs-human-confirmation']);
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;

export const findingSchema = z.object({
  id: z.string(),
  /** Stable across re-reviews (rule + normalised excerpt), used to remember author decisions. */
  fingerprint: z.string(),
  category: categorySchema,
  rule: z.string(),
  severity: severitySchema,
  lines: z.object({ start: z.number().int().positive(), end: z.number().int().positive() }).optional(),
  excerpt: z.string().optional(),
  problem: z.string(),
  why: z.string(),
  suggestion: z.string(),
  /** One optional local alternative for the excerpt only. */
  alternative: z.string().optional(),
  evidence: z.object({ status: evidenceStatusSchema, refs: z.array(z.string()), note: z.string() }).optional(),
  related: z
    .object({
      lines: z.object({ start: z.number().int().positive(), end: z.number().int().positive() }).optional(),
      publicationId: z.string().optional(),
      title: z.string().optional(),
      similarity: z.number().optional(),
      details: z.array(z.string()).default([]),
    })
    .optional(),
  status: findingStatusSchema,
  /** Set when the status comes from an earlier author decision. */
  decidedAt: z.string().optional(),
});
export type Finding = z.infer<typeof findingSchema>;

export const claimSchema = z.object({
  line: z.number().int().positive(),
  text: z.string(),
  kind: z.enum(['quantitative', 'performance', 'adoption', 'repository', 'testing']),
  status: evidenceStatusSchema,
  refs: z.array(z.string()),
  note: z.string(),
});
export type Claim = z.infer<typeof claimSchema>;

export const reviewReportSchema = z.object({
  schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
  id: z.string(),
  generatedAt: z.string(),
  article: z.object({ path: z.string(), key: z.string(), sha256: z.string(), words: z.number().int(), lines: z.number().int() }),
  profile: z.string().nullable(),
  languageProfile: z.string(),
  context: z.object({
    repository: z.string().nullable(),
    platform: z.string().nullable(),
    archivePublications: z.number().int(),
    authorInput: z.string().nullable(),
  }),
  summary: z.object({
    total: z.number().int(),
    open: z.number().int(),
    byCategory: z.record(z.string(), z.number().int()),
    bySeverity: z.record(z.string(), z.number().int()),
    carriedDecisions: z.number().int(),
    droppedAlternatives: z.number().int(),
  }),
  findings: z.array(findingSchema),
  claims: z.array(claimSchema),
  metrics: z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
  watchFor: z.array(z.string()),
  notice: z.string(),
  limitations: z.array(z.string()),
});
export type ReviewReport = z.infer<typeof reviewReportSchema>;

/** A finding before ids, fingerprints and statuses are assigned. */
export type PendingFinding = Omit<Finding, 'id' | 'fingerprint' | 'status' | 'decidedAt'> & { key?: string };

export const REVIEW_NOTICE = 'StoryOps reviews; the author writes. Findings are possible issues with possible changes. Nothing was applied; the article file was not modified.';
