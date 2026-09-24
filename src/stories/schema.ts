import { z } from 'zod';
import { claimSchema } from '../evidence/schema.js';

export const CANONICAL_STORY_SCHEMA_VERSION = 1;

const measurementSchema = z.object({
  what: z.string(),
  value: z.string(),
  unit: z.string().optional(),
  method: z.string().optional(),
  /** Evidence refs. A measurement without evidence fails validation. */
  evidence: z.array(z.string()).default([]),
});

const decisionSchema = z.object({
  decision: z.string(),
  why: z.string().optional(),
  alternatives: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
});

const approachSchema = z.object({
  approach: z.string(),
  whyInsufficient: z.string(),
  evidence: z.array(z.string()).default([]),
});

const visualSchema = z.object({
  id: z.string(),
  kind: z.enum(['screenshot', 'diagram', 'code', 'chart', 'table']),
  description: z.string(),
  purpose: z.string(),
  supports: z.string().optional(),
  /** For screenshots: URL path or app state to capture, when known. */
  target: z.string().optional(),
});

const relationSchema = z.object({
  publicationId: z.string(),
  title: z.string().optional(),
  url: z.string().optional(),
  relation: z.enum(['continues', 'updates', 'corrects', 'references', 'contrasts']),
  note: z.string().optional(),
});

/**
 * The canonical story: WHAT happened, independent of any platform.
 * Platform outputs are derived from this, never from each other.
 */
export const canonicalStorySchema = z.object({
  schemaVersion: z.literal(CANONICAL_STORY_SCHEMA_VERSION),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  status: z.enum(['skeleton', 'draft', 'verified']),
  language: z.string().default('ru'),
  topic: z.string().min(1),
  project: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  context: z.string().default(''),
  previousState: z.string().default(''),
  problem: z.string().default(''),
  constraints: z.array(z.string()).default([]),
  turningPoint: z.string().default(''),
  solution: z.string().default(''),
  technicalDecisions: z.array(decisionSchema).default([]),
  failedOrInsufficientApproaches: z.array(approachSchema).default([]),
  /** Evidence refs relevant to the story as a whole. */
  evidence: z.array(z.string()).default([]),
  measurements: z.array(measurementSchema).default([]),
  results: z.array(z.object({ text: z.string(), evidence: z.array(z.string()).default([]) })).default([]),
  limitations: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  relationToPreviousPublications: z.array(relationSchema).default([]),
  narrativeGap: z.string().default(''),
  possibleVisuals: z.array(visualSchema).default([]),
  claims: z.array(claimSchema).default([]),
  /** Where the skeleton came from (narrative gap report, project report...). */
  provenance: z.array(z.string()).default([]),
  /** Fields still to be completed by the author/agent. */
  pending: z.array(z.string()).default([]),
  /** Platform outputs derived from this story. */
  outputs: z.array(z.object({ platform: z.string(), path: z.string(), publicationType: z.string(), createdAt: z.string() })).default([]),
});
export type CanonicalStory = z.infer<typeof canonicalStorySchema>;
export type StoryVisual = z.infer<typeof visualSchema>;
