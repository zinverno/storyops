import { z } from 'zod';
import type { PlatformStrategy, PublicationType } from '../../platforms/schema.js';
import { checkStyle } from '../author/style-check.js';
import { mdList } from '../shared/markdown.js';
import { shortHash } from '../shared/hash.js';
import type { CanonicalStory } from '../stories/schema.js';
import { abbreviate, itemsByPriority, verbatimPhrase, type AuthorInput } from './author-input.js';
import { isUnresolved, todo, type EditorialIssue } from './common.js';
import { provenanceSchema, type Provenance } from './provenance.js';
import type { LoadedStyle, StyleCatalog } from './styles.js';

/**
 * Editorial Direction: the specific editorial decision for one article on
 * one platform. Deterministic code records references and known facts and
 * leaves `TODO(agent)` decisions; the editorial-author skill fills them.
 */

export const EDITORIAL_DIRECTION_SCHEMA_VERSION = 1;

const materialRefSchema = z.object({ itemId: z.string(), priority: z.string(), text: z.string() });

export const conflictSchema = z.object({
  id: z.string(),
  kind: z.enum(['author-input-internal', 'verbatim-vs-style-rule', 'author-material-vs-style', 'other']),
  description: z.string(),
  items: z.array(z.string()).default([]),
  /** Empty = unresolved. Conflicts are surfaced, never silently resolved. */
  resolution: z.string().default(''),
  resolvedBy: z.enum(['author', 'agent']).optional(),
});
export type EditorialConflict = z.infer<typeof conflictSchema>;

export const directionSchema = z.object({
  schemaVersion: z.literal(EDITORIAL_DIRECTION_SCHEMA_VERSION),
  story: z.string(),
  platform: z.string(),
  publicationType: z.string(),
  generatedAt: z.string(),
  updatedAt: z.string(),
  basedOn: provenanceSchema,
  reviewRequired: z.array(z.string()).default([]),
  references: z.object({
    story: z.string(),
    evidence: z.string(),
    brief: z.string().nullable(),
    authorInput: z.string(),
    authorProfile: z.string().nullable(),
    patternTransfer: z.string(),
    voicePlan: z.string(),
    research: z.string().nullable(),
  }),
  style: z.object({
    id: z.string().nullable(),
    version: z.string().nullable(),
    status: z.enum(['selected', 'pending']),
    chosenBy: z.enum(['user', 'agent', 'config-default']).optional(),
    rationale: z.string().default(''),
    /** Deterministic shortlist: presets whose suitable types include the publication type. */
    candidates: z.array(z.object({ id: z.string(), displayName: z.string(), description: z.string() })).default([]),
  }),
  authorVoice: z.object({ styleProfile: z.string(), tone: z.string(), voiceNotes: z.array(z.string()) }),
  readerPromise: z.string(),
  coreAngle: z.string(),
  primaryConflict: z.string(),
  secondaryThemes: z.array(z.string()).default([]),
  notAbout: z.array(z.string()).default([]),
  openingApproach: z.string(),
  narrativeEmphasis: z.string(),
  technicalDepth: z.string(),
  personalDepth: z.string(),
  humorPolicy: z.string(),
  codePolicy: z.string(),
  visualPolicy: z.string(),
  lengthRange: z.object({ min: z.number().int().nonnegative(), max: z.number().int().positive(), unit: z.enum(['words', 'characters']), source: z.string() }).nullable(),
  material: z.object({ mustAppear: z.array(materialRefSchema), mustNotAppear: z.array(materialRefSchema) }),
  conflicts: z.array(conflictSchema).default([]),
  authorVoiceReferences: z.object({
    /** A small selection of the author's OWN publications used as voice samples (never external authors). */
    selected: z.array(z.object({ publicationId: z.string(), title: z.string().optional(), use: z.string(), reusable: z.boolean().default(false) })).default([]),
    candidates: z.array(z.object({ publicationId: z.string(), title: z.string(), platform: z.string(), date: z.string().optional() })).default([]),
  }),
  /** Screenshot/diagram integration: which visual supports which section and story claim. */
  visuals: z.array(z.object({ visualId: z.string(), kind: z.string(), purpose: z.string(), section: z.string().default(''), claim: z.string().default('') })).default([]),
});
export type EditorialDirection = z.infer<typeof directionSchema>;

export const DIRECTION_REQUIRED_TEXT = ['readerPromise', 'coreAngle', 'primaryConflict', 'openingApproach', 'narrativeEmphasis', 'technicalDepth', 'personalDepth', 'humorPolicy', 'codePolicy', 'visualPolicy'] as const;

export interface DirectionInput {
  story: CanonicalStory;
  strategy: PlatformStrategy;
  publicationType: PublicationType;
  style?: LoadedStyle;
  styleChosenBy?: 'user' | 'agent' | 'config-default';
  styleCandidates: LoadedStyle[];
  authorInput: AuthorInput;
  authorVoice: EditorialDirection['authorVoice'];
  voiceCandidates: EditorialDirection['authorVoiceReferences']['candidates'];
  references: EditorialDirection['references'];
  basedOn: Provenance;
  now: string;
  previous?: EditorialDirection;
  reviewRequired?: string[];
}

function detectConflicts(input: DirectionInput): EditorialConflict[] {
  const conflicts: EditorialConflict[] = [];
  const add = (kind: EditorialConflict['kind'], description: string, items: string[]) => conflicts.push({ id: `${kind}-${shortHash(`${description}|${items.join(',')}`, 8)}`, kind, description, items, resolution: '' });
  for (const issue of input.authorInput.issues.filter((i) => i.severity === 'error')) add('author-input-internal', `author-input.md${issue.line ? ` line ${issue.line}` : ''}: ${issue.message}`, []);
  const by = itemsByPriority(input.authorInput);
  for (const item of by.verbatim) {
    const findings = checkStyle(verbatimPhrase(item), input.authorVoice.styleProfile).findings.filter((f) => f.severity !== 'info');
    for (const f of findings) {
      add('verbatim-vs-style-rule', `VERBATIM phrase "${abbreviate(item.text)}" triggers style rule "${f.rule}". Author material outranks the style profile: keep it exactly (the audit marks it as author-provided) or ask the author to change it.`, [item.id]);
    }
  }
  const preset = input.style?.preset;
  if (preset) {
    const personal = input.authorInput.items.filter((i) => i.section === 'personal-context');
    if (personal.length && preset.personalPresence === 'none') add('author-material-vs-style', `Style "${preset.id}" has no personal presence, but the author supplied ${personal.length} personal-context item(s). Author material outranks the preset: use them or record why not.`, personal.map((i) => i.id));
    // POSSIBLE HUMOR is optional material; only jokes the author requires collide with a humorless preset.
    const requiredHumor = [...by.must, ...by.verbatim, ...by.should].filter((i) => /шут|юмор|joke|humou?r/i.test(i.text));
    if (requiredHumor.length && preset.humorLevel === 'none') add('author-material-vs-style', `Style "${preset.id}" uses no humor, but required author material contains a joke. Author material outranks the preset.`, requiredHumor.map((i) => i.id));
  }
  return conflicts;
}

export function buildDirection(input: DirectionInput): EditorialDirection {
  const { story, strategy, style, previous } = input;
  const preset = style?.preset;
  const by = itemsByPriority(input.authorInput);
  const range = strategy.content.expectedLength[input.publicationType];
  const keep = <K extends keyof EditorialDirection>(key: K, fallback: EditorialDirection[K]): EditorialDirection[K] => (previous ? previous[key] : fallback);
  const sameStyle = previous?.style.id && preset && previous.style.id === preset.id;
  const conflicts = detectConflicts(input).map((c) => {
    const old = previous?.conflicts.find((p) => p.id === c.id);
    return old ? { ...c, resolution: old.resolution, ...(old.resolvedBy ? { resolvedBy: old.resolvedBy } : {}) } : c;
  });
  // Conflicts the editor added by hand (kind "other") are kept.
  for (const c of previous?.conflicts ?? []) if (c.kind === 'other' && !conflicts.some((x) => x.id === c.id)) conflicts.push(c);
  const humorItems = input.authorInput.items.filter((i) => i.section === 'humor').length;
  const typeChanged = previous !== undefined && previous.publicationType !== input.publicationType;
  const review = [...(input.reviewRequired ?? []), ...(typeChanged ? [`publication type changed from "${previous!.publicationType}" to "${input.publicationType}"; the length range was reset from the platform strategy — review this plan, then clear reviewRequired.`] : [])];

  return directionSchema.parse({
    schemaVersion: EDITORIAL_DIRECTION_SCHEMA_VERSION,
    story: story.slug,
    platform: strategy.id,
    publicationType: input.publicationType,
    generatedAt: previous?.generatedAt ?? input.now,
    updatedAt: input.now,
    basedOn: input.basedOn,
    reviewRequired: [...new Set([...(previous?.reviewRequired ?? []), ...review])],
    references: input.references,
    style: preset
      ? {
          id: preset.id,
          version: preset.version,
          status: 'selected',
          chosenBy: sameStyle && previous?.style.chosenBy ? previous.style.chosenBy : (input.styleChosenBy ?? 'user'),
          rationale: sameStyle ? previous!.style.rationale : input.styleChosenBy === 'user' ? 'Named by the user.' : '',
          candidates: input.styleCandidates.map((s) => ({ id: s.preset.id, displayName: s.preset.displayName, description: s.preset.description })),
        }
      : { id: null, version: null, status: 'pending', rationale: '', candidates: input.styleCandidates.map((s) => ({ id: s.preset.id, displayName: s.preset.displayName, description: s.preset.description })) },
    authorVoice: input.authorVoice,
    readerPromise: keep('readerPromise', todo('what the reader gets from this article, in one sentence (not a feature list)')),
    coreAngle: keep('coreAngle', todo(`the angle that makes this story worth telling now${story.narrativeGap ? ` (narrative gap: "${abbreviate(story.narrativeGap, 160)}")` : ''}`)),
    primaryConflict: keep('primaryConflict', todo(`the conflict the article is built around${story.problem ? ` (story problem: "${abbreviate(story.problem, 160)}")` : ''}`)),
    secondaryThemes: keep('secondaryThemes', []),
    notAbout: keep('notAbout', []),
    openingApproach: keep('openingApproach', todo(`how the article opens${preset ? `; style: ${preset.openingBehavior}` : ''}; platform: ${strategy.opening.preferred}`)),
    narrativeEmphasis: keep('narrativeEmphasis', todo('what the narrative dwells on and what it passes quickly')),
    technicalDepth: keep('technicalDepth', todo(`confirm technical depth (style: ${preset?.technicalDepth ?? '?'}; platform: ${strategy.content.technicalDetail})`)),
    personalDepth: keep('personalDepth', todo(`confirm personal presence (style: ${preset?.personalPresence ?? '?'}; author personal-context items: ${input.authorInput.items.filter((i) => i.section === 'personal-context').length}). Never invent experiences.`)),
    humorPolicy: keep('humorPolicy', todo(`humor policy (style: ${preset?.humorLevel ?? '?'}; author humor items: ${humorItems})`)),
    codePolicy: keep('codePolicy', todo(`code policy (style: ${preset?.codeUsage ?? '?'}; platform: ${strategy.structure.code})`)),
    visualPolicy: keep('visualPolicy', todo(`visual policy (style: ${preset?.visualUsage ?? '?'}; platform screenshots: ${strategy.media.screenshots}, diagrams: ${strategy.media.diagrams})`)),
    lengthRange: previous && !typeChanged ? previous.lengthRange : (range ? { min: range.min, max: range.max, unit: range.unit, source: `${strategy.id}@${strategy.version} ${input.publicationType} (${range.kind})` } : null),
    material: {
      mustAppear: [...by.verbatim, ...by.must].map((i) => ({ itemId: i.id, priority: i.priority, text: i.text })),
      mustNotAppear: by.avoid.map((i) => ({ itemId: i.id, priority: i.priority, text: i.text })),
    },
    conflicts,
    authorVoiceReferences: { selected: previous?.authorVoiceReferences.selected ?? [], candidates: input.voiceCandidates },
    visuals: story.possibleVisuals.map((v) => {
      const old = previous?.visuals.find((x) => x.visualId === v.id);
      return { visualId: v.id, kind: v.kind, purpose: v.purpose, section: old?.section ?? '', claim: old?.claim ?? v.supports ?? '' };
    }),
  });
}

export function validateDirection(d: EditorialDirection, context: { catalog: StyleCatalog; publicationIds: ReadonlySet<string> }): EditorialIssue[] {
  const artifact = 'direction';
  const issues: EditorialIssue[] = [];
  const err = (message: string) => issues.push({ severity: 'error', artifact, message });
  const warn = (message: string) => issues.push({ severity: 'warning', artifact, message });
  if (!d.style.id || d.style.status !== 'selected') {
    err(`No article style selected. Candidates for ${d.publicationType}: ${d.style.candidates.map((c) => c.id).join(', ') || '(none)'}; re-run \`editorial plan --style <id>\`.`);
  } else if (!context.catalog.has(d.style.id)) {
    err(`Selected style "${d.style.id}" does not exist (see \`editorial-kit styles list\`).`);
  } else {
    const preset = context.catalog.get(d.style.id).preset;
    if (!(preset.suitablePublicationTypes as string[]).includes(d.publicationType)) warn(`Style "${preset.id}" does not list "${d.publicationType}" among its suitable publication types (${preset.suitablePublicationTypes.join(', ')}).`);
    if (d.style.chosenBy === 'agent' && isUnresolved(d.style.rationale)) err('The style was chosen by the agent but no rationale is recorded (style.rationale).');
  }
  const unresolved = DIRECTION_REQUIRED_TEXT.filter((k) => isUnresolved(d[k]));
  if (unresolved.length) err(`Unresolved fields: ${unresolved.join(', ')}.`);
  if (d.notAbout.length === 0) err('State at least one thing this article is NOT about (notAbout).');
  if (!d.lengthRange) warn('No length range (the platform strategy has none for this publication type).');
  for (const c of d.conflicts) if (isUnresolved(c.resolution)) err(`Unresolved conflict ${c.id}: ${c.description}`);
  if (d.authorVoiceReferences.selected.length > 3) warn(`${d.authorVoiceReferences.selected.length} voice references selected; prefer a small, relevant selection (≤ 3).`);
  for (const ref of d.authorVoiceReferences.selected) {
    if (!context.publicationIds.has(ref.publicationId)) err(`Voice reference "${ref.publicationId}" is not one of the author's stored publications. Only the author's own writing may serve as a voice sample.`);
  }
  for (const v of d.visuals) if (isUnresolved(v.section)) warn(`Visual "${v.visualId}" has no supported section yet.`);
  return issues;
}

export function renderDirection(d: EditorialDirection): string {
  const t = (s: string) => (isUnresolved(s) ? `_${s || 'TODO'}_` : s);
  const out = [
    `# Editorial direction — ${d.story} (${d.platform})`,
    '',
    `Publication type: ${d.publicationType}. Style: ${d.style.id ? `**${d.style.id}**@${d.style.version} (${d.style.chosenBy ?? '?'})` : '_not selected_'}. Updated ${d.updatedAt}.`,
    '',
    '> Priority: factual truth > explicit author material > author voice > article style > narrative continuity > platform strategy > current trend patterns.',
    '> Never draft prose directly from story.json, evidence.md or the brief: follow this direction and the voice plan.',
    '',
  ];
  if (d.reviewRequired.length) out.push('## Review required', '', mdList(d.reviewRequired), '');
  out.push(
    '## Decision',
    '',
    `- Reader promise: ${t(d.readerPromise)}`,
    `- Core angle: ${t(d.coreAngle)}`,
    `- Primary conflict: ${t(d.primaryConflict)}`,
    `- Secondary themes: ${d.secondaryThemes.join('; ') || '—'}`,
    `- Not about: ${d.notAbout.join('; ') || '_TODO_'}`,
    `- Opening: ${t(d.openingApproach)}`,
    `- Narrative emphasis: ${t(d.narrativeEmphasis)}`,
    `- Technical depth: ${t(d.technicalDepth)}`,
    `- Personal depth: ${t(d.personalDepth)}`,
    `- Humor: ${t(d.humorPolicy)}`,
    `- Code: ${t(d.codePolicy)}`,
    `- Visuals: ${t(d.visualPolicy)}`,
    `- Length: ${d.lengthRange ? `${d.lengthRange.min}–${d.lengthRange.max} ${d.lengthRange.unit} (${d.lengthRange.source})` : '—'}`,
    '',
  );
  if (d.style.status === 'selected' && d.style.rationale) out.push(`Style rationale: ${d.style.rationale}`, '');
  if (d.style.status === 'pending') out.push('## Style candidates', '', mdList(d.style.candidates.map((c) => `\`${c.id}\` — ${c.description}`)), '');
  out.push(
    '## Author material',
    '',
    'Must appear:',
    '',
    mdList(d.material.mustAppear.map((m) => `[${m.priority}] ${abbreviate(m.text, 140)} (\`${m.itemId}\`)`)),
    '',
    'Must not appear:',
    '',
    mdList(d.material.mustNotAppear.map((m) => `${abbreviate(m.text, 140)} (\`${m.itemId}\`)`)),
    '',
    '## Conflicts',
    '',
    mdList(d.conflicts.map((c) => `${c.resolution ? '✓' : '✗ UNRESOLVED'} ${c.description}${c.resolution ? ` → ${c.resolution}` : ''}`)),
    '',
    '## Author voice',
    '',
    `Style profile \`${d.authorVoice.styleProfile}\`${d.authorVoice.tone ? `; tone: ${d.authorVoice.tone}` : ''}.`,
    '',
    mdList(d.authorVoice.voiceNotes),
    '',
    'Voice references (own publications only):',
    '',
    mdList(d.authorVoiceReferences.selected.map((r) => `${r.title ?? r.publicationId} — ${r.use}${r.reusable ? ' (exact reuse allowed)' : ''}`), '_none selected_'),
    '',
    `Candidates: ${d.authorVoiceReferences.candidates.map((c) => `\`${c.publicationId}\` ${c.title}`).join('; ') || '—'}`,
    '',
    '## Visuals',
    '',
    mdList(d.visuals.map((v) => `\`${v.visualId}\` (${v.kind}): ${v.purpose} → section: ${v.section || '_TODO_'}; claim: ${v.claim || '—'}`)),
    '',
    '## References',
    '',
    mdList(Object.entries(d.references).map(([k, v]) => `${k}: ${v ?? '—'}`)),
    '',
  );
  return out.join('\n');
}
