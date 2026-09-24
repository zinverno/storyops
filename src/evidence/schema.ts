import { z } from 'zod';

export const EVIDENCE_SCHEMA_VERSION = 1;

export const evidenceKindSchema = z.enum([
  'source-file',
  'test',
  'commit',
  'tag',
  'release',
  'pull-request',
  'doc',
  'adr',
  'changelog',
  'config',
  'benchmark',
  'screenshot',
  'runtime-output',
  'publication',
  'package-metadata',
]);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

/**
 * One piece of inspectable evidence. `ref` is the deterministic, human-writable
 * locator used in stories (e.g. `src/health/model.ts`, `src/a.ts#L10-L40`,
 * `commit:3f2a1bc`, `tag:v0.3.0`, `publication:habr:812345`, `screenshot:01-dashboard.png`).
 */
export const evidenceRecordSchema = z.object({
  schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION).default(EVIDENCE_SCHEMA_VERSION),
  id: z.string(),
  ref: z.string(),
  kind: evidenceKindSchema,
  title: z.string(),
  locator: z.object({
    path: z.string().optional(),
    lines: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
    commit: z.string().optional(),
    tag: z.string().optional(),
    url: z.string().optional(),
  }),
  /** Short, redacted excerpt. Never the whole file. */
  excerpt: z.string().optional(),
  /** sha256 of the referenced content at collection time; used to detect drift. */
  contentHash: z.string().optional(),
  date: z.string().optional(),
  collectedAt: z.string(),
});
export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;

/**
 * Claim classification. The single most important rule of the system:
 * a `future-plan` is never presented as implemented, and a `verified-fact`
 * must reference at least one evidence record.
 */
export const claimClassificationSchema = z.enum(['verified-fact', 'interpretation', 'opinion', 'hypothesis', 'future-plan', 'unverified']);
export type ClaimClassification = z.infer<typeof claimClassificationSchema>;

export const claimSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  text: z.string().min(1),
  classification: claimClassificationSchema,
  /** Evidence refs (see evidenceRecordSchema.ref). */
  evidence: z.array(z.string()).default([]),
  /** Optional free-text note from the author/agent about the claim. */
  note: z.string().optional(),
});
export type Claim = z.infer<typeof claimSchema>;

export const evidenceMapSchema = z.object({
  schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
  story: z.string(),
  projectRoot: z.string().optional(),
  collectedAt: z.string(),
  records: z.array(evidenceRecordSchema),
  claims: z.array(
    z.object({
      claimId: z.string(),
      text: z.string(),
      classification: claimClassificationSchema,
      evidenceIds: z.array(z.string()),
      unresolvedRefs: z.array(z.string()),
      suggestions: z.array(z.object({ ref: z.string(), title: z.string(), score: z.number() })),
      status: z.enum(['supported', 'missing-evidence', 'not-required', 'broken-reference']),
    }),
  ),
  issues: z.array(z.object({ severity: z.enum(['error', 'warning']), message: z.string(), claimId: z.string().optional() })),
});
export type EvidenceMap = z.infer<typeof evidenceMapSchema>;
