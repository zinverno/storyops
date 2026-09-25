import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { z } from 'zod';
import { publicationTypeSchema } from '../../platforms/schema.js';
import { StoryOpsError } from '../shared/errors.js';
import { pathExists } from '../shared/fs.js';
import { hashJson } from '../shared/hash.js';

/**
 * Review profiles: what a reviewer should expect from a given KIND of
 * article (engineering story, postmortem, tutorial…). They were the v2
 * "style presets"; in v3 they only drive review findings, never prose.
 * Built-in YAML files live in `review-profiles/`; workspace files in
 * `.storyops/review-profiles/`. Adding one needs no code.
 */

export const REVIEW_PROFILE_SCHEMA_VERSION = 2;

export const reviewProfileSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_PROFILE_SCHEMA_VERSION),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and hyphens'),
    version: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().min(1),
    expectations: z
      .object({
        /** Is the author's own perspective expected? (Reviews never suggest inventing experiences.) */
        firstPerson: z.enum(['expected', 'optional']),
        flow: z.enum(['problem-driven', 'chronological', 'architecture-first', 'incident-timeline', 'step-by-step', 'argument', 'retrospective', 'user-problem-driven']),
        /** Should a concrete problem be visible early? */
        conflictEarly: z.boolean(),
        technicalDepth: z.enum(['low', 'moderate', 'high', 'very-high']),
        codeRole: z.enum(['none', 'sparing', 'supporting', 'central']),
        limitations: z.enum(['expected', 'optional']),
        /** Warn when the article reads like README / release notes / a spec. */
        documentationRisk: z.enum(['warn', 'ignore']),
      })
      .strict(),
    /** Things a reviewer (human or agent) should watch for; reported, never auto-fixed. */
    watchFor: z.array(z.string().min(1)).default([]),
    publicationTypes: z.array(publicationTypeSchema).min(1),
    notes: z.array(z.string()).default([]),
  })
  .strict();
export type ReviewProfile = z.infer<typeof reviewProfileSchema>;

export interface LoadedProfile {
  profile: ReviewProfile;
  source: 'built-in' | 'workspace';
  file: string;
  hash: string;
}

export interface ProfileIssue {
  severity: 'error' | 'warning';
  file: string;
  message: string;
}

const PROFILE_FILE = /\.(ya?ml|json)$/i;

/** Directory of the built-in profiles (works from src/ and dist/). */
export function builtInProfilesDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, 'review-profiles');
    if (pathExists(path.join(candidate, 'engineering-story.yaml'))) return candidate;
    dir = path.dirname(dir);
  }
  throw new StoryOpsError('PROFILES_MISSING', 'Cannot locate the built-in review-profiles/ directory.');
}

export function parseReviewProfile(source: string, file: string): { profile?: ReviewProfile; issues: ProfileIssue[] } {
  let data: unknown;
  try {
    data = /\.json$/i.test(file) ? JSON.parse(source) : YAML.parse(source);
  } catch (error) {
    return { issues: [{ severity: 'error', file, message: `not valid ${/\.json$/i.test(file) ? 'JSON' : 'YAML'}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}` }] };
  }
  if (data && typeof data === 'object' && (data as { schemaVersion?: unknown }).schemaVersion === 1) {
    return { issues: [{ severity: 'error', file, message: 'this is a v2 style preset (schemaVersion 1); run `storyops migrate` to convert it into a review profile' }] };
  }
  const result = reviewProfileSchema.safeParse(data);
  if (!result.success) return { issues: result.error.issues.slice(0, 10).map((i) => ({ severity: 'error' as const, file, message: `${i.path.join('.') || '(root)'}: ${i.message}` })) };
  const expected = path.basename(file).replace(PROFILE_FILE, '');
  if (result.data.id !== expected) return { issues: [{ severity: 'error', file, message: `id "${result.data.id}" must match the file name "${expected}"` }] };
  return { profile: result.data, issues: [] };
}

export class ProfileCatalog {
  private readonly profiles = new Map<string, LoadedProfile>();
  readonly issues: ProfileIssue[] = [];

  add(p: LoadedProfile): boolean {
    const existing = this.profiles.get(p.profile.id);
    if (existing) {
      this.issues.push({ severity: 'error', file: p.file, message: `duplicate profile id "${p.profile.id}" (already defined in ${existing.file}); choose a new id` });
      return false;
    }
    this.profiles.set(p.profile.id, p);
    return true;
  }

  has(id: string): boolean {
    return this.profiles.has(id);
  }

  get(id: string): LoadedProfile {
    const p = this.profiles.get(id);
    if (!p) throw new StoryOpsError('PROFILE_UNKNOWN', `Unknown review profile "${id}"`, { hint: `Available: ${this.ids().join(', ')} (\`storyops profiles list\`).` });
    return p;
  }

  ids(): string[] {
    return [...this.profiles.keys()].sort();
  }

  list(): LoadedProfile[] {
    return this.ids().map((id) => this.profiles.get(id)!);
  }
}

async function loadDir(catalog: ProfileCatalog, dir: string, source: LoadedProfile['source']): Promise<void> {
  if (!pathExists(dir)) return;
  const files = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && PROFILE_FILE.test(e.name)).map((e) => e.name).sort();
  for (const name of files) {
    const file = path.join(dir, name);
    const { profile, issues } = parseReviewProfile(await readFile(file, 'utf8'), file);
    catalog.issues.push(...issues);
    if (profile) catalog.add({ profile, source, file, hash: hashJson(profile) });
  }
}

export async function loadProfileCatalog(options: { builtInDir?: string; workspaceDir?: string } = {}): Promise<ProfileCatalog> {
  const catalog = new ProfileCatalog();
  await loadDir(catalog, options.builtInDir ?? builtInProfilesDir(), 'built-in');
  if (options.workspaceDir) await loadDir(catalog, options.workspaceDir, 'workspace');
  return catalog;
}

/**
 * Converts a v2 style preset (schemaVersion 1) into a review profile.
 * Generation guidance (preferred patterns, opening/section behaviour) is
 * dropped; perspective, flow, depth, code and failure handling become
 * review expectations; avoid-patterns become the watch list.
 */
export function presetToReviewProfile(preset: Record<string, unknown>): ReviewProfile {
  const s = (k: string) => String(preset[k] ?? '');
  const first = (s('perspective') === 'first-person' || s('perspective') === 'first-person-plural') && s('personalPresence') !== 'none' ? 'expected' : 'optional';
  const flow = s('narrativeMode');
  const types = Array.isArray(preset.suitablePublicationTypes) ? (preset.suitablePublicationTypes as string[]) : ['engineering-story'];
  return reviewProfileSchema.parse({
    schemaVersion: REVIEW_PROFILE_SCHEMA_VERSION,
    id: s('id'),
    version: '2.0.0-migrated',
    displayName: s('displayName'),
    description: s('description'),
    expectations: {
      firstPerson: first,
      flow,
      conflictEarly: ['problem-driven', 'user-problem-driven', 'incident-timeline'].includes(flow),
      technicalDepth: s('technicalDepth'),
      codeRole: s('codeUsage'),
      limitations: ['central', 'honest'].includes(s('failureDiscussion')) ? 'expected' : 'optional',
      documentationRisk: flow === 'step-by-step' ? 'ignore' : 'warn',
    },
    watchFor: Array.isArray(preset.avoidPatterns) ? (preset.avoidPatterns as string[]).filter((x) => !/story\.json|canonical/i.test(x)) : [],
    publicationTypes: types,
    notes: ['Migrated from a v2 style preset by `storyops migrate`.'],
  });
}

export function renderProfile(p: LoadedProfile): string {
  const x = p.profile;
  const e = x.expectations;
  return [
    `${x.displayName} (${x.id}@${x.version}, ${p.source})`,
    x.description,
    '',
    `first person: ${e.firstPerson}; flow: ${e.flow}; conflict early: ${e.conflictEarly ? 'yes' : 'no'}`,
    `technical depth: ${e.technicalDepth}; code: ${e.codeRole}; limitations: ${e.limitations}; documentation-risk warnings: ${e.documentationRisk}`,
    ...(x.watchFor.length ? ['watch for:', ...x.watchFor.map((w) => `  - ${w}`)] : []),
    `publication types: ${x.publicationTypes.join(', ')}`,
    '',
    'Used only to review a human-written article. StoryOps never writes in this style.',
  ].join('\n');
}
