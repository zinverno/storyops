import { z } from 'zod';
import { mdList } from '../shared/markdown.js';
import type { CanonicalStory } from '../stories/schema.js';
import { abbreviate, type AuthorInput, type ItemPriority } from './author-input.js';
import { isUnresolved, todo, type EditorialIssue } from './common.js';
import type { PatternTransfer } from './pattern-transfer.js';
import { provenanceSchema, type Provenance } from './provenance.js';

/**
 * Voice Plan: how facts become a living narrative. It answers what the
 * reader should experience, how the narrative moves, where the conflict
 * appears, which technical details become episodes, where the author speaks
 * in the first person, where the prose slows down and which sections risk
 * turning into documentation. Deterministic code prefills only what is known
 * (author material to place, limitations to place, the calibration rule).
 */

export const VOICE_PLAN_SCHEMA_VERSION = 1;

export const beatSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  summary: z.string(),
  /** Why this beat exists for the reader. */
  purpose: z.string().default(''),
  mode: z.enum(['scene', 'explanation', 'reflection', 'context', 'code', 'visual', 'transition', 'limitation']),
  pace: z.enum(['brisk', 'steady', 'slow']).default('steady'),
  /** Canonical story claim ids this beat relies on. Facts enter the article only through these. */
  claimIds: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  authorItemIds: z.array(z.string()).default([]),
  /** Pattern transfer items (apply/adapt) that shape this beat. Packaging only, never facts. */
  patternIds: z.array(z.string()).default([]),
  visualIds: z.array(z.string()).default([]),
});
export type Beat = z.infer<typeof beatSchema>;

const materialStatusSchema = z.enum(['pending', 'planned', 'omitted', 'optional']);

export const voicePlanSchema = z.object({
  schemaVersion: z.literal(VOICE_PLAN_SCHEMA_VERSION),
  story: z.string(),
  platform: z.string(),
  style: z.string().nullable(),
  generatedAt: z.string(),
  updatedAt: z.string(),
  basedOn: provenanceSchema,
  reviewRequired: z.array(z.string()).default([]),
  readerExperience: z.string(),
  narrativeMovement: z.array(beatSchema).default([]),
  conflictPlacement: z.string(),
  delayedContext: z.array(z.string()).default([]),
  technicalEpisodes: z.array(z.object({ detail: z.string(), episode: z.string(), beatId: z.string(), claimIds: z.array(z.string()).default([]) })).default([]),
  firstPersonMoments: z.array(z.object({ beatId: z.string(), note: z.string(), authorItemId: z.string().optional() })).default([]),
  authorMaterial: z
    .array(z.object({ itemId: z.string(), priority: z.string(), text: z.string(), status: materialStatusSchema, beatId: z.string().default(''), reason: z.string().default('') }))
    .default([]),
  openQuestions: z.array(z.object({ itemId: z.string(), text: z.string(), answer: z.string().default('') })).default([]),
  humor: z.array(z.object({ beatId: z.string(), note: z.string(), authorItemId: z.string().optional() })).default([]),
  slowDown: z.array(z.object({ beatId: z.string(), why: z.string() })).default([]),
  documentationRisks: z.array(z.object({ beatId: z.string(), risk: z.string(), mitigation: z.string() })).default([]),
  limitations: z.array(z.object({ text: z.string(), beatId: z.string().default(''), approach: z.string().default('') })).default([]),
  calibration: z.object({
    required: z.boolean(),
    reason: z.string(),
    /** The central technical episode the 400–800 word sample is taken from. */
    episode: z.string().default(''),
    status: z.enum(['pending', 'shown', 'approved', 'skipped']).default('pending'),
    skipReason: z.string().default(''),
    sample: z.string(),
  }),
});
export type VoicePlan = z.infer<typeof voicePlanSchema>;

const TRACKED: readonly ItemPriority[] = ['verbatim', 'must', 'should', 'may', 'unclassified'];
const REQUIRED: readonly string[] = ['verbatim', 'must', 'should'];

/** Long-form output gets a voice calibration sample before the full draft. */
export function calibrationRule(lengthRange: { max: number; unit: 'words' | 'characters' } | null): { required: boolean; reason: string } {
  if (!lengthRange) return { required: false, reason: 'No length target; decide per request.' };
  const words = lengthRange.unit === 'words' ? lengthRange.max : Math.round(lengthRange.max / 6.5);
  return words >= 1500
    ? { required: true, reason: `Long-form (up to ${lengthRange.max} ${lengthRange.unit}): show a 400–800 word sample of the central episode before the full draft, unless the user asked to proceed directly or already approved the voice.` }
    : { required: false, reason: `Short-form (up to ${lengthRange.max} ${lengthRange.unit}): no calibration pause.` };
}

export function buildVoicePlan(input: {
  story: CanonicalStory;
  platform: string;
  style: string | null;
  authorInput: AuthorInput;
  lengthRange: { max: number; unit: 'words' | 'characters' } | null;
  basedOn: Provenance;
  now: string;
  previous?: VoicePlan;
  reviewRequired?: string[];
  samplePath: string;
}): VoicePlan {
  const prev = input.previous;
  const prevMaterial = new Map((prev?.authorMaterial ?? []).map((m) => [m.itemId, m]));
  const authorMaterial = input.authorInput.items
    .filter((i) => TRACKED.includes(i.priority))
    .map((i) => {
      const old = prevMaterial.get(i.id);
      if (old) return { ...old, priority: i.priority, text: i.text };
      return { itemId: i.id, priority: i.priority, text: i.text, status: REQUIRED.includes(i.priority) ? ('pending' as const) : ('optional' as const), beatId: '', reason: '' };
    });
  const prevQuestions = new Map((prev?.openQuestions ?? []).map((q) => [q.itemId, q]));
  const openQuestions = input.authorInput.items.filter((i) => i.priority === 'question').map((i) => ({ itemId: i.id, text: i.text, answer: prevQuestions.get(i.id)?.answer ?? '' }));
  const prevLimits = new Map((prev?.limitations ?? []).map((l) => [l.text, l]));
  const limitations = input.story.limitations.map((text) => prevLimits.get(text) ?? { text, beatId: '', approach: '' });
  const rule = calibrationRule(input.lengthRange);
  const calibration = prev ? { ...prev.calibration, required: rule.required, reason: rule.reason, sample: input.samplePath } : { required: rule.required, reason: rule.reason, episode: '', status: 'pending' as const, skipReason: '', sample: input.samplePath };

  return voicePlanSchema.parse({
    schemaVersion: VOICE_PLAN_SCHEMA_VERSION,
    story: input.story.slug,
    platform: input.platform,
    style: input.style,
    generatedAt: prev?.generatedAt ?? input.now,
    updatedAt: input.now,
    basedOn: input.basedOn,
    reviewRequired: [...new Set([...(prev?.reviewRequired ?? []), ...(input.reviewRequired ?? [])])],
    readerExperience: prev?.readerExperience ?? todo('what the reader should experience (not "a description of the architecture")'),
    narrativeMovement: prev?.narrativeMovement ?? [],
    conflictPlacement: prev?.conflictPlacement ?? todo('where the conflict appears (which beat, how early)'),
    delayedContext: prev?.delayedContext ?? [],
    technicalEpisodes: prev?.technicalEpisodes ?? [],
    firstPersonMoments: prev?.firstPersonMoments ?? [],
    authorMaterial,
    openQuestions,
    humor: prev?.humor ?? [],
    slowDown: prev?.slowDown ?? [],
    documentationRisks: prev?.documentationRisks ?? [],
    limitations,
    calibration,
  });
}

const TREND_PREFIX = /^(?:pattern|trend|research|saturated|observation):/i;

export function validateVoicePlan(vp: VoicePlan, context: { story: CanonicalStory; authorInput: AuthorInput; patternTransfer?: PatternTransfer; evidenceRefs?: ReadonlySet<string> }): EditorialIssue[] {
  const artifact = 'voice-plan';
  const issues: EditorialIssue[] = [];
  const err = (message: string) => issues.push({ severity: 'error', artifact, message });
  const warn = (message: string) => issues.push({ severity: 'warning', artifact, message });
  const claims = new Set(context.story.claims.map((c) => c.id));
  const authorItems = new Map(context.authorInput.items.map((i) => [i.id, i]));
  const patterns = new Map((context.patternTransfer?.items ?? []).map((p) => [p.id, p]));
  const visuals = new Set(context.story.possibleVisuals.map((v) => v.id));

  if (isUnresolved(vp.readerExperience)) err('readerExperience is unresolved.');
  if (isUnresolved(vp.conflictPlacement)) err('conflictPlacement is unresolved.');
  if (vp.narrativeMovement.length === 0) err('narrativeMovement is empty: plan the beats before drafting.');
  const beatIds = new Set<string>();
  for (const beat of vp.narrativeMovement) {
    if (beatIds.has(beat.id)) err(`Duplicate beat id "${beat.id}".`);
    beatIds.add(beat.id);
    if (isUnresolved(beat.summary)) err(`Beat "${beat.id}" has no summary.`);
    for (const id of beat.claimIds) {
      if (claims.has(id)) continue;
      if (patterns.has(id) || TREND_PREFIX.test(id)) err(`Beat "${beat.id}" lists trend pattern "${id}" as a claim. Trend patterns shape packaging; they can never become factual claims (use patternIds).`);
      else err(`Beat "${beat.id}" references claim "${id}", which is not in the canonical story. Facts enter the article only through story.json claims.`);
    }
    for (const id of beat.authorItemIds) if (!authorItems.has(id)) err(`Beat "${beat.id}" references author input item "${id}", which no longer exists (author-input.md changed).`);
    for (const id of beat.patternIds) {
      const p = patterns.get(id);
      if (!p) err(`Beat "${beat.id}" references unknown pattern "${id}".`);
      else if (p.decision !== 'apply' && p.decision !== 'adapt') err(`Beat "${beat.id}" uses pattern "${id}", whose decision is "${p.decision}".`);
    }
    for (const id of beat.visualIds) if (!visuals.has(id)) warn(`Beat "${beat.id}" references visual "${id}", which is not in story.possibleVisuals.`);
    if (context.evidenceRefs) for (const ref of beat.evidenceRefs) if (!context.evidenceRefs.has(ref)) warn(`Beat "${beat.id}" cites evidence "${ref}", which is not in the story's evidence.`);
  }
  const knownBeat = (id: string) => beatIds.has(id);
  for (const m of vp.authorMaterial) {
    const label = `${m.priority.toUpperCase()} item "${abbreviate(m.text, 60)}" (${m.itemId})`;
    if (!authorItems.has(m.itemId)) {
      err(`${label} is no longer in author-input.md; refresh with \`editorial plan\`.`);
      continue;
    }
    if (m.status === 'pending') {
      if (m.priority === 'should') warn(`${label} is not placed yet.`);
      else err(`${label} is not placed yet.`);
    }
    if (m.status === 'planned' && !knownBeat(m.beatId)) err(`${label} is planned for beat "${m.beatId}", which does not exist.`);
    if (m.status === 'omitted') {
      if (m.priority === 'verbatim') err(`${label}: a VERBATIM phrase cannot be omitted. Ask the author to move it to another section.`);
      else if (isUnresolved(m.reason)) err(`${label} is omitted without a reason.`);
      else if (m.priority === 'must') warn(`${label} is omitted: ${m.reason}`);
    }
  }
  for (const q of vp.openQuestions) if (isUnresolved(q.answer)) warn(`Author question not resolved yet: "${abbreviate(q.text, 80)}". Ask the author or keep it out of the article.`);
  for (const f of vp.firstPersonMoments) {
    if (!knownBeat(f.beatId)) err(`First-person moment references unknown beat "${f.beatId}".`);
    if (f.authorItemId && !authorItems.has(f.authorItemId)) err(`First-person moment references unknown author item "${f.authorItemId}".`);
  }
  for (const [name, list] of [['humor', vp.humor], ['slowDown', vp.slowDown], ['documentationRisks', vp.documentationRisks], ['technicalEpisodes', vp.technicalEpisodes]] as const) {
    for (const entry of list) if (!knownBeat(entry.beatId)) err(`${name} references unknown beat "${entry.beatId}".`);
  }
  for (const e of vp.technicalEpisodes) for (const id of e.claimIds) if (!claims.has(id)) err(`Technical episode "${abbreviate(e.detail, 40)}" references claim "${id}", which is not in the canonical story.`);
  if (vp.narrativeMovement.length > 0 && vp.documentationRisks.length === 0) warn('No documentation risks identified. Name the beats most likely to read like documentation and how to avoid it.');
  for (const l of vp.limitations) {
    if (!l.beatId) warn(`Limitation not placed: "${abbreviate(l.text, 80)}". Limitations should appear naturally, not as a dump at the end.`);
    else if (!knownBeat(l.beatId)) err(`Limitation "${abbreviate(l.text, 60)}" is placed in unknown beat "${l.beatId}".`);
  }
  for (const p of context.patternTransfer?.items ?? []) {
    if ((p.decision === 'apply' || p.decision === 'adapt') && !vp.narrativeMovement.some((b) => b.patternIds.includes(p.id))) warn(`Pattern "${p.id}" is ${p.decision === 'apply' ? 'applied' : 'adapted'} but no beat uses it (add it to a beat's patternIds).`);
  }
  if (vp.calibration.status === 'skipped' && isUnresolved(vp.calibration.skipReason)) err('Voice calibration was skipped without a reason.');
  return issues;
}

export function renderVoicePlan(vp: VoicePlan): string {
  const t = (s: string) => (isUnresolved(s) ? `_${s || 'TODO'}_` : s);
  const out = [`# Voice plan — ${vp.story} (${vp.platform})`, '', `Style: ${vp.style ?? '_not selected_'}. Updated ${vp.updatedAt}.`, '', '> How facts become narrative. Do not mirror story.json, evidence.md or the brief paragraph by paragraph.', ''];
  if (vp.reviewRequired.length) out.push('## Review required', '', mdList(vp.reviewRequired), '');
  out.push('## Reader experience', '', t(vp.readerExperience), '', `Conflict placement: ${t(vp.conflictPlacement)}`, '', '## Narrative movement', '');
  if (vp.narrativeMovement.length === 0) out.push('_TODO: plan the beats._', '');
  vp.narrativeMovement.forEach((b, i) => {
    const refs = [b.claimIds.length ? `claims: ${b.claimIds.join(', ')}` : '', b.authorItemIds.length ? `author: ${b.authorItemIds.join(', ')}` : '', b.patternIds.length ? `patterns: ${b.patternIds.join(', ')}` : '', b.visualIds.length ? `visuals: ${b.visualIds.join(', ')}` : ''].filter(Boolean).join('; ');
    out.push(`${i + 1}. **${b.id}** (${b.mode}, ${b.pace}) — ${b.summary}${b.purpose ? ` _Purpose: ${b.purpose}_` : ''}${refs ? `  \n   ${refs}` : ''}`);
  });
  out.push(
    '',
    '## Delayed context (after the hook)',
    '',
    mdList(vp.delayedContext),
    '',
    '## Technical details as episodes',
    '',
    mdList(vp.technicalEpisodes.map((e) => `${e.detail} → ${e.episode} (${e.beatId})`)),
    '',
    '## First person',
    '',
    mdList(vp.firstPersonMoments.map((f) => `${f.beatId}: ${f.note}${f.authorItemId ? ` (author: ${f.authorItemId})` : ''}`)),
    '',
    '## Author material',
    '',
    mdList(vp.authorMaterial.map((m) => `[${m.priority}] ${m.status.toUpperCase()}${m.beatId ? ` → ${m.beatId}` : ''}: ${abbreviate(m.text, 120)} (\`${m.itemId}\`)${m.reason ? ` — ${m.reason}` : ''}`)),
    '',
  );
  if (vp.openQuestions.length) out.push('## Author questions', '', mdList(vp.openQuestions.map((q) => `${abbreviate(q.text, 120)} → ${q.answer || '_unanswered_'}`)), '');
  out.push(
    '## Humor',
    '',
    mdList(vp.humor.map((h) => `${h.beatId}: ${h.note}`)),
    '',
    '## Slow down',
    '',
    mdList(vp.slowDown.map((s) => `${s.beatId}: ${s.why}`)),
    '',
    '## Documentation risks',
    '',
    mdList(vp.documentationRisks.map((d) => `${d.beatId}: ${d.risk} → ${d.mitigation}`)),
    '',
    '## Limitations (placed where they bite)',
    '',
    mdList(vp.limitations.map((l) => `${abbreviate(l.text, 120)} → ${l.beatId || '_not placed_'}${l.approach ? ` (${l.approach})` : ''}`)),
    '',
    '## Voice calibration',
    '',
    `${vp.calibration.required ? 'Required' : 'Not required'}: ${vp.calibration.reason}`,
    '',
    `Status: ${vp.calibration.status}${vp.calibration.skipReason ? ` (${vp.calibration.skipReason})` : ''}. Episode: ${vp.calibration.episode || '—'}. Sample: \`${vp.calibration.sample}\`.`,
    '',
  );
  return out.join('\n');
}
