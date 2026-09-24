import { z } from 'zod';
import { depthSchema } from '../publications/schema.js';
import { publicationRoleSchema } from '../publications/index-schema.js';

export const CONTINUITY_SCHEMA_VERSION = 1;

const pubRef = z.object({ publicationId: z.string(), platform: z.string(), title: z.string(), date: z.string().optional(), depth: depthSchema });

export const continuitySchema = z.object({
  schemaVersion: z.literal(CONTINUITY_SCHEMA_VERSION),
  generatedAt: z.string(),
  author: z.string(),
  method: z.string(),
  publications: z.array(pubRef.extend({ url: z.string().optional(), roles: z.array(publicationRoleSchema), projects: z.array(z.string()) })),
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      publicationIds: z.array(z.string()),
      platforms: z.array(z.string()),
      firstPublishedAt: z.string().optional(),
      lastPublishedAt: z.string().optional(),
      coveredAspects: z.array(z.object({ aspect: z.string(), label: z.string(), publication: pubRef })),
    }),
  ),
  themes: z.array(z.object({ key: z.string(), label: z.string(), publicationIds: z.array(z.string()), platforms: z.array(z.string()) })),
  concepts: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      /** explained: explained in at least one standard/deep publication. mentioned: only mentioned, or only explained in brief posts. */
      coverage: z.enum(['explained', 'mentioned']),
      occurrences: z.array(pubRef.extend({ treatment: z.enum(['mentioned', 'explained']) })),
    }),
  ),
  repeatedExplanations: z.array(z.object({ key: z.string(), label: z.string(), publicationIds: z.array(z.string()) })),
  architectureDescribed: z.array(z.object({ publication: pubRef, items: z.array(z.string()) })),
  problemsIntroduced: z.array(z.object({ publication: pubRef, items: z.array(z.string()) })),
  claimsMade: z.array(z.object({ publication: pubRef, items: z.array(z.string()) })),
  resultsReported: z.array(z.object({ publication: pubRef, items: z.array(z.string()) })),
  promises: z.array(z.object({ publication: pubRef, text: z.string(), status: z.enum(['open', 'possibly-addressed']), addressedBy: z.string().optional() })),
  openQuestions: z.array(z.object({ publication: pubRef, text: z.string(), status: z.enum(['open', 'possibly-addressed']), addressedBy: z.string().optional() })),
  unfinishedThreads: z.array(z.object({ kind: z.enum(['promise', 'open-question']), text: z.string(), publicationId: z.string(), since: z.string().optional() })),
});
export type ContinuityMap = z.infer<typeof continuitySchema>;
export type PublicationRef = z.infer<typeof pubRef>;
