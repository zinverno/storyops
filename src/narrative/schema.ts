import { z } from 'zod';

export const NARRATIVE_GAP_SCHEMA_VERSION = 1;

export const gapKindSchema = z.enum([
  'new-subsystem',
  'architecture-evolution',
  'major-refactor',
  'removed-approach',
  'migration',
  'performance-work',
  'bug-fixing',
  'release',
  'new-evidence',
  'design-decision',
  'untold-history',
]);
export type GapKind = z.infer<typeof gapKindSchema>;

export const gapSchema = z.object({
  id: z.string(),
  kind: gapKindSchema,
  title: z.string(),
  description: z.string(),
  since: z.string().optional(),
  coverage: z.enum(['not-covered', 'mentioned', 'explained']),
  strength: z.enum(['strong', 'moderate', 'weak']),
  strengthReason: z.string(),
  signals: z.object({ commits: z.number().int(), files: z.number().int(), testFiles: z.number().int(), docs: z.number().int() }),
  /** Evidence refs (paths, commit:<hash>, tag:<name>). */
  evidence: z.array(z.string()),
  terms: z.array(z.string()),
});
export type NarrativeGapItem = z.infer<typeof gapSchema>;

export const narrativeGapReportSchema = z.object({
  schemaVersion: z.literal(NARRATIVE_GAP_SCHEMA_VERSION),
  projectId: z.string(),
  generatedAt: z.string(),
  method: z.string(),
  boundary: z.object({ lastPublicationAt: z.string().optional(), lastPublicationId: z.string().optional(), publications: z.number().int() }),
  alreadyCovered: z.array(z.object({ label: z.string(), publicationId: z.string(), platform: z.string(), date: z.string().optional() })),
  newInProject: z.array(z.string()),
  gaps: z.array(gapSchema),
  coveredCandidates: z.array(z.object({ title: z.string(), coverage: z.enum(['mentioned', 'explained']), publicationIds: z.array(z.string()) })),
  headline: z.string().optional(),
  notes: z.array(z.string()),
});
export type NarrativeGapReport = z.infer<typeof narrativeGapReportSchema>;
