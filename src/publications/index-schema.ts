import { z } from 'zod';
import { depthSchema } from './schema.js';

export const PUBLICATION_INDEX_SCHEMA_VERSION = 1;

/**
 * A derived field records how its value was obtained. Deterministic
 * heuristics fill `heuristic`; anything they cannot decide is `unresolved`
 * and left for the agent (or the author) to fill in as `agent`/`manual`.
 */
export const derivedFieldSchema = z.object({
  values: z.array(z.string()),
  method: z.enum(['heuristic', 'agent', 'manual', 'unresolved']),
  note: z.string().optional(),
});
export type DerivedField = z.infer<typeof derivedFieldSchema>;

export const publicationRoleSchema = z.enum(['project-introduction', 'architecture', 'update', 'postmortem', 'tutorial', 'release', 'opinion', 'other']);
export type PublicationRole = z.infer<typeof publicationRoleSchema>;

export const conceptMentionSchema = z.object({
  concept: z.string(),
  /** Normalised key used for matching across publications. */
  key: z.string(),
  depth: z.enum(['mentioned', 'explained']),
  occurrences: z.number().int(),
  inHeading: z.boolean(),
  source: z.enum(['glossary', 'heading', 'key-term']),
});
export type ConceptMention = z.infer<typeof conceptMentionSchema>;

export const publicationIndexEntrySchema = z.object({
  publicationId: z.string(),
  platform: z.string(),
  title: z.string(),
  url: z.string().optional(),
  date: z.string().optional(),
  depth: depthSchema,
  wordCount: z.number().int(),
  projects: derivedFieldSchema,
  roles: z.array(publicationRoleSchema),
  mainSubject: derivedFieldSchema,
  mainThesis: derivedFieldSchema,
  concepts: z.array(conceptMentionSchema),
  architectureDescribed: derivedFieldSchema,
  problemsIntroduced: derivedFieldSchema,
  resultsReported: derivedFieldSchema,
  futurePlans: derivedFieldSchema,
  openQuestions: derivedFieldSchema,
});
export type PublicationIndexEntry = z.infer<typeof publicationIndexEntrySchema>;

export const publicationIndexSchema = z.object({
  schemaVersion: z.literal(PUBLICATION_INDEX_SCHEMA_VERSION),
  generatedAt: z.string(),
  method: z.string(),
  entries: z.array(publicationIndexEntrySchema),
});
export type PublicationIndex = z.infer<typeof publicationIndexSchema>;
