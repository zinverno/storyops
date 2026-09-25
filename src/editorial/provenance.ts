import { z } from 'zod';
import type { PlatformStrategy } from '../../platforms/schema.js';
import type { AuthorProfile } from '../author/profile.js';
import { hashJson } from '../shared/hash.js';
import type { CanonicalStory } from '../stories/schema.js';

/**
 * Inputs an editorial plan was built from. Every derived editorial artifact
 * records this block; `editorial validate` recomputes it and reports each
 * difference as drift, in the spirit of evidence drift. Stale plans are never
 * used silently.
 */
export const provenanceSchema = z.object({
  story: z.object({ slug: z.string(), hash: z.string() }),
  authorInput: z.object({ hash: z.string(), items: z.number().int() }).nullable(),
  authorProfile: z.object({ hash: z.string(), styleProfile: z.string(), source: z.enum(['author-profile', 'config']) }),
  style: z.object({ id: z.string(), version: z.string(), hash: z.string() }).nullable(),
  platformStrategy: z.object({ id: z.string(), version: z.string(), hash: z.string() }),
  research: z
    .object({ platform: z.string(), collectedAt: z.string(), file: z.string(), hash: z.string(), status: z.string(), sampleSize: z.number().int() })
    .nullable(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/**
 * Story content hash. `outputs` and `updatedAt` are bookkeeping written by
 * `repurpose`/`saveStory`; excluding them means only substantive edits to
 * the story make an editorial plan stale.
 */
export function storyContentHash(story: CanonicalStory): string {
  const { outputs: _outputs, updatedAt: _updatedAt, ...content } = story;
  return hashJson(content);
}

/** The author's voice: the manual profile section plus the style profile. Derived statistics are excluded. */
export function authorVoiceRef(profile: AuthorProfile | undefined, configStyleProfile: string, language: string): Provenance['authorProfile'] {
  if (profile) return { hash: hashJson({ manual: profile.manual, styleProfile: profile.styleProfile, language: profile.language }), styleProfile: profile.styleProfile, source: 'author-profile' };
  return { hash: hashJson({ manual: null, styleProfile: configStyleProfile, language }), styleProfile: configStyleProfile, source: 'config' };
}

export function strategyRef(strategy: PlatformStrategy): Provenance['platformStrategy'] {
  return { id: strategy.id, version: strategy.version, hash: hashJson(strategy) };
}

export interface DriftItem {
  input: keyof Provenance;
  message: string;
}

const INPUT_LABEL: Record<keyof Provenance, string> = {
  story: 'canonical story (story.json)',
  authorInput: 'author input (author-input.md)',
  authorProfile: 'author voice profile',
  style: 'article style preset',
  platformStrategy: 'platform strategy',
  research: 'research snapshot',
};

/**
 * Compares recorded vs current provenance. `artifact` names the plan in the
 * message, e.g. "author input (author-input.md) changed since voice plan was created".
 */
export function compareProvenance(recorded: Provenance, current: Provenance, artifact: string, only?: ReadonlyArray<keyof Provenance>): DriftItem[] {
  const keys = only ?? (Object.keys(INPUT_LABEL) as Array<keyof Provenance>);
  const drift: DriftItem[] = [];
  for (const key of keys) {
    const a = recorded[key];
    const b = current[key];
    if (hashJson(a ?? null) === hashJson(b ?? null)) continue;
    drift.push({ input: key, message: describeChange(key, a, b, artifact) });
  }
  return drift;
}

function describeChange(key: keyof Provenance, a: unknown, b: unknown, artifact: string): string {
  const label = INPUT_LABEL[key];
  if (a === null || a === undefined) return `${label} appeared since ${artifact} was created`;
  if (b === null || b === undefined) return `${label} is gone since ${artifact} was created`;
  if (key === 'style') {
    const x = a as Provenance['style'];
    const y = b as Provenance['style'];
    if (x && y && x.id !== y.id) return `article style changed from "${x.id}" to "${y.id}" since ${artifact} was created`;
    if (x && y && x.version !== y.version) return `${label} "${y.id}" changed version ${x.version} → ${y.version} since ${artifact} was created`;
  }
  if (key === 'platformStrategy') {
    const x = a as Provenance['platformStrategy'];
    const y = b as Provenance['platformStrategy'];
    if (x.version !== y.version) return `${label} ${y.id} changed version ${x.version} → ${y.version} since ${artifact} was created`;
  }
  if (key === 'research') {
    const x = a as NonNullable<Provenance['research']>;
    const y = b as NonNullable<Provenance['research']>;
    if (x.file !== y.file) return `${label} changed (${x.collectedAt.slice(0, 10)} → ${y.collectedAt.slice(0, 10)}) since ${artifact} was created`;
    return `${label} ${y.file} was modified since ${artifact} was created`;
  }
  return `${label} changed since ${artifact} was created`;
}
