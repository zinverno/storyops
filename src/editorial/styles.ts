import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { z } from 'zod';
import { publicationTypeSchema } from '../../platforms/schema.js';
import { EditorialError } from '../shared/errors.js';
import { pathExists } from '../shared/fs.js';
import { hashJson } from '../shared/hash.js';

/**
 * Article style presets: WHAT KIND of piece this is (engineering story,
 * dev diary, postmortem…). Distinct from the author's voice (how this author
 * sounds), the platform strategy (how a platform packages content) and the
 * publication type (the brief's structural slot). A preset never overrides
 * the author voice and never licenses invented facts or emotions.
 *
 * Presets are data: built-in YAML files in `styles/` plus validated
 * workspace-local files in `.editorial/styles/`. Adding one needs no code.
 */

export const STYLE_PRESET_SCHEMA_VERSION = 1;

export const stylePresetSchema = z
  .object({
    schemaVersion: z.literal(STYLE_PRESET_SCHEMA_VERSION),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and hyphens'),
    version: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().min(1),
    perspective: z.enum(['first-person', 'first-person-plural', 'mixed', 'impersonal']),
    narrativeMode: z.enum(['problem-driven', 'chronological', 'architecture-first', 'incident-timeline', 'step-by-step', 'argument', 'retrospective', 'user-problem-driven']),
    technicalDepth: z.enum(['low', 'moderate', 'high', 'very-high']),
    contextDepth: z.enum(['minimal', 'moderate', 'extensive']),
    pacing: z.enum(['brisk', 'steady', 'deliberate']),
    openingBehavior: z.string().min(1),
    sectionBehavior: z.string().min(1),
    codeUsage: z.enum(['none', 'sparing', 'supporting', 'central']),
    visualUsage: z.enum(['none', 'sparing', 'supporting', 'central']),
    humorLevel: z.enum(['none', 'light', 'moderate']),
    personalPresence: z.enum(['none', 'low', 'moderate', 'high']),
    failureDiscussion: z.enum(['not-applicable', 'brief', 'honest', 'central']),
    limitationsBehavior: z.string().min(1),
    preferredPatterns: z.array(z.string().min(1)).min(1),
    avoidPatterns: z.array(z.string().min(1)).min(1),
    suitablePublicationTypes: z.array(publicationTypeSchema).min(1),
    notes: z.array(z.string()).default([]),
  })
  .strict();
export type StylePreset = z.infer<typeof stylePresetSchema>;

export interface LoadedStyle {
  preset: StylePreset;
  source: 'built-in' | 'workspace';
  file: string;
  /** Content hash of the validated preset; recorded by editorial plans for drift detection. */
  hash: string;
}

export interface StyleIssue {
  severity: 'error' | 'warning';
  file: string;
  message: string;
}

/** Does this preset expect the author to be present in the first person? */
export function expectsFirstPerson(preset: StylePreset): boolean {
  return preset.perspective !== 'impersonal' && preset.personalPresence !== 'none';
}

export function styleRef(style: LoadedStyle): { id: string; version: string; hash: string } {
  return { id: style.preset.id, version: style.preset.version, hash: style.hash };
}

const STYLE_FILE = /\.(ya?ml|json)$/i;

/** Parses and validates one preset file. The id must match the file name. */
export function parseStylePreset(source: string, file: string): { style?: StylePreset; issues: StyleIssue[] } {
  let data: unknown;
  try {
    data = /\.json$/i.test(file) ? JSON.parse(source) : YAML.parse(source);
  } catch (error) {
    return { issues: [{ severity: 'error', file, message: `not valid ${/\.json$/i.test(file) ? 'JSON' : 'YAML'}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}` }] };
  }
  const result = stylePresetSchema.safeParse(data);
  if (!result.success) {
    return { issues: result.error.issues.slice(0, 10).map((i) => ({ severity: 'error' as const, file, message: `${i.path.join('.') || '(root)'}: ${i.message}` })) };
  }
  const expected = path.basename(file).replace(STYLE_FILE, '');
  if (result.data.id !== expected) return { issues: [{ severity: 'error', file, message: `id "${result.data.id}" must match the file name "${expected}"` }] };
  return { style: result.data, issues: [] };
}

export class StyleCatalog {
  private readonly styles = new Map<string, LoadedStyle>();
  readonly issues: StyleIssue[] = [];

  /** Adds a validated style; a duplicate id is rejected (the first one wins) and reported as an error. */
  add(style: LoadedStyle): boolean {
    const existing = this.styles.get(style.preset.id);
    if (existing) {
      this.issues.push({ severity: 'error', file: style.file, message: `duplicate style id "${style.preset.id}" (already defined in ${existing.file}); choose a new id, e.g. "my-${style.preset.id}"` });
      return false;
    }
    this.styles.set(style.preset.id, style);
    return true;
  }

  has(id: string): boolean {
    return this.styles.has(id);
  }

  get(id: string): LoadedStyle {
    const style = this.styles.get(id);
    if (!style) throw new EditorialError('STYLE_UNKNOWN', `Unknown article style "${id}"`, { hint: `Available styles: ${this.ids().join(', ')} (\`editorial-kit styles list\`).` });
    return style;
  }

  ids(): string[] {
    return [...this.styles.keys()].sort();
  }

  list(): LoadedStyle[] {
    return this.ids().map((id) => this.styles.get(id)!);
  }

  /** Presets whose suitable publication types include `type` (deterministic filter, not a recommendation). */
  suitableFor(type: string): LoadedStyle[] {
    return this.list().filter((s) => (s.preset.suitablePublicationTypes as string[]).includes(type));
  }
}

async function loadDir(catalog: StyleCatalog, dir: string, source: LoadedStyle['source']): Promise<void> {
  if (!pathExists(dir)) return;
  const files = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && STYLE_FILE.test(e.name)).map((e) => e.name).sort();
  for (const name of files) {
    const file = path.join(dir, name);
    const { style, issues } = parseStylePreset(await readFile(file, 'utf8'), file);
    catalog.issues.push(...issues);
    if (style) catalog.add({ preset: style, source, file, hash: hashJson(style) });
  }
}

/** Built-in presets first, then workspace-local ones. */
export async function loadStyleCatalog(options: { builtInDir: string; workspaceDir?: string }): Promise<StyleCatalog> {
  const catalog = new StyleCatalog();
  await loadDir(catalog, options.builtInDir, 'built-in');
  if (options.workspaceDir) await loadDir(catalog, options.workspaceDir, 'workspace');
  return catalog;
}

export function renderStylePreset(style: LoadedStyle): string {
  const p = style.preset;
  const list = (xs: string[]) => xs.map((x) => `  - ${x}`).join('\n');
  return [
    `${p.displayName} (${p.id}@${p.version}, ${style.source})`,
    p.description,
    '',
    `perspective: ${p.perspective}; narrative mode: ${p.narrativeMode}; pacing: ${p.pacing}`,
    `technical depth: ${p.technicalDepth}; context depth: ${p.contextDepth}`,
    `code: ${p.codeUsage}; visuals: ${p.visualUsage}; humor: ${p.humorLevel}; personal presence: ${p.personalPresence}; failures: ${p.failureDiscussion}`,
    `opening: ${p.openingBehavior}`,
    `sections: ${p.sectionBehavior}`,
    `limitations: ${p.limitationsBehavior}`,
    'preferred patterns:',
    list(p.preferredPatterns),
    'avoid:',
    list(p.avoidPatterns),
    `suitable publication types: ${p.suitablePublicationTypes.join(', ')}`,
    ...(p.notes.length ? ['notes:', list(p.notes)] : []),
  ].join('\n');
}
