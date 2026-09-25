import { z } from 'zod';
import type { ResearchSnapshot } from '../research/types.js';
import { mdList } from '../shared/markdown.js';
import { forbiddenPhrases, containsPhrase, type AuthorInput } from './author-input.js';
import { isUnresolved, type EditorialIssue } from './common.js';
import { findExternalOverlap } from './originality.js';
import { provenanceSchema, type Provenance } from './provenance.js';

/**
 * Pattern Transfer answers one question: which abstract observations from
 * current platform research are actually used in THIS article, and where?
 *
 *   trend research → abstract pattern → editorial decision
 *
 * never "successful article → imitate article". It is built from the
 * compressed research snapshot (observations, metrics, provenance); it never
 * needs, and never stores, researched article text.
 */

export const PATTERN_TRANSFER_SCHEMA_VERSION = 1;

export const patternDecisionSchema = z.enum(['pending', 'apply', 'adapt', 'skip']);
export type PatternDecision = z.infer<typeof patternDecisionSchema>;

export const skipReasonSchema = z.enum(['conflicts-with-author-voice', 'does-not-fit-story', 'not-supported-by-evidence', 'would-create-clickbait', 'weak-sample', 'overridden-by-author-input', 'other']);

export const patternItemSchema = z.object({
  /** Observation id from the snapshot, or `saturated:<term>` for a saturated angle. */
  id: z.string(),
  kind: z.enum(['observation', 'saturated-angle']),
  /** The abstract observation, as the snapshot states it. */
  observation: z.string(),
  metric: z.string().optional(),
  strength: z.enum(['weak', 'moderate', 'notable']),
  sample: z.object({ window: z.string().optional(), size: z.number().int(), groupSize: z.number().int().optional(), comparisonSize: z.number().int().optional() }),
  provenance: z.object({ snapshot: z.string(), collectedAt: z.string(), status: z.string(), supportingArticleIds: z.array(z.string()) }),
  limitations: z.array(z.string()).default([]),
  decision: patternDecisionSchema.default('pending'),
  /** rule = deterministic default (weak observations start as skip); agent/author = an editorial decision. */
  decidedBy: z.enum(['rule', 'agent', 'author']).optional(),
  rationale: z.string().default(''),
  skipReason: skipReasonSchema.optional(),
  /** Where in the article (opening, title, first technical section, beat id…). Required for apply/adapt. */
  placement: z.array(z.string()).default([]),
  /** The concrete editorial consequence for this article. Required for apply/adapt. */
  consequence: z.string().default(''),
  /** Item-specific safeguards, in addition to the artifact-wide ones. */
  safeguards: z.array(z.string()).default([]),
  /** Author input items this pattern conflicts with. Author MUST/VERBATIM material wins. */
  conflictsWithAuthorItems: z.array(z.string()).default([]),
});
export type PatternItem = z.infer<typeof patternItemSchema>;

export const patternTransferSchema = z.object({
  schemaVersion: z.literal(PATTERN_TRANSFER_SCHEMA_VERSION),
  story: z.string(),
  platform: z.string(),
  generatedAt: z.string(),
  updatedAt: z.string(),
  basedOn: provenanceSchema,
  /** Messages from `editorial plan` refreshes that the editor must review; validation blocks while non-empty. */
  reviewRequired: z.array(z.string()).default([]),
  /** Apply to every pattern. */
  safeguards: z.array(z.string()).default([]),
  items: z.array(patternItemSchema),
  notes: z.array(z.string()).default([]),
});
export type PatternTransfer = z.infer<typeof patternTransferSchema>;

export const PATTERN_SAFEGUARDS = [
  'Do not copy any title, wording, opening or structure of a specific researched article.',
  'Apply only where the canonical story genuinely supports it; never invent conflict, results or emotion to fit a pattern.',
  'Author voice and explicit author material take precedence over this pattern.',
];

export const ORIGINALITY_RULES = [
  'Trend research may teach structures, frequencies, presentation tendencies and abstract patterns.',
  'It must not produce copied passages, light paraphrases, imitation of distinctive wording, one-author style cloning, or successful-title templates with swapped nouns.',
  'A skipped pattern with a clear reason is a successful outcome.',
];

export interface SnapshotRef {
  snapshot: ResearchSnapshot;
  /** Workspace-relative path of the snapshot JSON. */
  file: string;
}

function itemsFromSnapshot(ref: SnapshotRef): PatternItem[] {
  const s = ref.snapshot;
  const base = { file: ref.file, collectedAt: s.collectedAt, status: s.status };
  const items: PatternItem[] = s.observations.map((o) =>
    patternItemSchema.parse({
      id: o.id,
      kind: 'observation',
      observation: o.statement,
      metric: o.metric,
      strength: o.strength,
      sample: { window: o.sample.window, size: o.sample.size, ...(o.sample.groupSize !== undefined ? { groupSize: o.sample.groupSize } : {}), ...(o.sample.comparisonSize !== undefined ? { comparisonSize: o.sample.comparisonSize } : {}) },
      provenance: { snapshot: base.file, collectedAt: base.collectedAt, status: base.status, supportingArticleIds: o.articleIds.slice(0, 10) },
      limitations: o.limitations,
    }),
  );
  for (const a of s.saturatedAngles) {
    items.push(
      patternItemSchema.parse({
        id: `saturated:${a.term}`,
        kind: 'saturated-angle',
        observation: `Saturated angle in the sample: ${a.label} (${a.count} of ${a.sampleSize} titles, ${Math.round(a.share * 100)}%).`,
        metric: 'title-share',
        strength: a.share >= 0.4 ? 'notable' : 'moderate',
        sample: { size: a.sampleSize },
        provenance: { snapshot: base.file, collectedAt: base.collectedAt, status: base.status, supportingArticleIds: a.exampleArticleIds },
        limitations: ['Title-level lexical grouping; says nothing about article quality.'],
      }),
    );
  }
  // Deterministic policy, not editorial reasoning: weak observations start as
  // "skip" so the editor's attention goes to the stronger ones. Any decision can be changed.
  for (const item of items) {
    if (item.strength === 'weak') {
      item.decision = 'skip';
      item.decidedBy = 'rule';
      item.skipReason = 'weak-sample';
      item.rationale = 'Weak observation: skipped by default. Promote it only with a story-specific reason.';
    }
  }
  return items;
}

/**
 * Builds (or refreshes) the pattern transfer scaffold. On refresh, decisions
 * are kept for observations whose id and statement are unchanged; changed or
 * new observations start pending.
 */
export function buildPatternTransfer(input: { story: string; platform: string; now: string; basedOn: Provenance; snapshot?: SnapshotRef; previous?: PatternTransfer; reviewRequired?: string[] }): PatternTransfer {
  const fresh = input.snapshot ? itemsFromSnapshot(input.snapshot) : [];
  const prev = new Map((input.previous?.items ?? []).map((i) => [i.id, i]));
  const items = fresh.map((item) => {
    const old = prev.get(item.id);
    if (!old || old.observation !== item.observation) return item;
    return { ...item, decision: old.decision, ...(old.decidedBy ? { decidedBy: old.decidedBy } : {}), rationale: old.rationale, ...(old.skipReason ? { skipReason: old.skipReason } : {}), placement: old.placement, consequence: old.consequence, safeguards: old.safeguards, conflictsWithAuthorItems: old.conflictsWithAuthorItems };
  });
  const notes = input.snapshot
    ? [`Built from the compressed research snapshot ${input.snapshot.file} (N=${input.snapshot.snapshot.sampleSize}, status ${input.snapshot.snapshot.status}); no researched article bodies are needed or stored.`]
    : ['No research snapshot for this platform: packaging relies on the stable platform strategy. This is a valid state.'];
  return patternTransferSchema.parse({
    schemaVersion: PATTERN_TRANSFER_SCHEMA_VERSION,
    story: input.story,
    platform: input.platform,
    generatedAt: input.previous?.generatedAt ?? input.now,
    updatedAt: input.now,
    basedOn: input.basedOn,
    reviewRequired: [...new Set([...(input.previous?.reviewRequired ?? []), ...(input.reviewRequired ?? [])])],
    safeguards: PATTERN_SAFEGUARDS,
    items,
    notes,
  });
}

const isBlank = isUnresolved;

/** Rules every resolved pattern transfer must satisfy. */
export function validatePatternTransfer(pt: PatternTransfer, context: { authorInput?: AuthorInput; snapshot?: ResearchSnapshot }): EditorialIssue[] {
  const artifact = 'pattern-transfer';
  const issues: EditorialIssue[] = [];
  const err = (message: string) => issues.push({ severity: 'error', artifact, message });
  const warn = (message: string) => issues.push({ severity: 'warning', artifact, message });
  const authorItems = new Map((context.authorInput?.items ?? []).map((i) => [i.id, i]));
  const avoid = (context.authorInput?.items ?? []).filter((i) => i.priority === 'avoid');
  for (const item of pt.items) {
    const label = `pattern "${item.id}"`;
    if (item.decision === 'pending') {
      err(`${label}: decision pending (apply, adapt or skip).`);
      continue;
    }
    if (isBlank(item.rationale)) err(`${label}: decision "${item.decision}" has no rationale.`);
    if (item.decision === 'apply' || item.decision === 'adapt') {
      if (item.placement.length === 0) err(`${label}: "${item.decision}" requires a placement (where in the article).`);
      if (isBlank(item.consequence)) err(`${label}: "${item.decision}" requires the concrete editorial consequence for this article.`);
      if (item.kind === 'saturated-angle' && item.decision === 'apply' && !/avoid|не |without|instead/i.test(item.consequence)) {
        warn(`${label}: a saturated angle is a reason to avoid an angle; check that "apply" does not mean joining it.`);
      }
    }
    for (const id of item.conflictsWithAuthorItems) {
      const a = authorItems.get(id);
      if (!a) {
        warn(`${label}: conflicts with unknown author input item "${id}" (author-input.md changed?).`);
        continue;
      }
      if ((a.priority === 'must' || a.priority === 'verbatim' || a.priority === 'avoid') && item.decision === 'apply') {
        err(`${label}: conflicts with author ${a.priority.toUpperCase()} item "${a.id}". Explicit author material takes precedence over an advisory trend: skip or adapt the pattern.`);
      }
    }
    for (const a of avoid) {
      for (const phrase of forbiddenPhrases(a)) {
        if (containsPhrase(`${item.consequence}\n${item.placement.join('\n')}`, phrase, { caseInsensitive: true })) err(`${label}: its consequence uses "${phrase}", which the author's DO NOT USE forbids.`);
      }
    }
  }
  // External text must never enter the artifact: the only external text we hold is titles.
  if (context.snapshot) {
    const texts = pt.items.flatMap((i) => [
      { where: `${i.id}.rationale`, text: i.rationale },
      { where: `${i.id}.consequence`, text: i.consequence },
      { where: `${i.id}.placement`, text: i.placement.join(' ') },
      ...i.safeguards.map((s, n) => ({ where: `${i.id}.safeguards[${n}]`, text: s })),
    ]);
    texts.push(...pt.notes.map((n, k) => ({ where: `notes[${k}]`, text: n })));
    for (const m of findExternalOverlap(texts, context.snapshot.articles.map((a) => ({ id: a.id, text: a.title })))) {
      err(`pattern transfer ${m.where} repeats wording of researched article ${m.id} ("${m.sequence}"). Store abstract patterns, never external text or title templates.`);
    }
  }
  return issues;
}

export function renderPatternTransfer(pt: PatternTransfer): string {
  const r = pt.basedOn.research;
  const out = [
    `# Pattern transfer — ${pt.story} (${pt.platform})`,
    '',
    r ? `Research: \`${r.file}\` — ${r.collectedAt.slice(0, 10)}, status ${r.status}, N=${r.sampleSize}.` : 'Research: none (stable platform strategy only).',
    `Updated ${pt.updatedAt}.`,
    '',
    '> trend research → abstract pattern → editorial decision. Never "successful article → imitate article".',
    '> Trends influence packaging and structure, never substance. They never override facts or explicit author decisions.',
    '',
    mdList(ORIGINALITY_RULES),
    '',
    'Safeguards for every pattern:',
    '',
    mdList(pt.safeguards),
    '',
  ];
  if (pt.reviewRequired.length) out.push('## Review required', '', mdList(pt.reviewRequired), '');
  const groups: Array<[string, PatternItem[]]> = [
    ['Applied / adapted', pt.items.filter((i) => i.decision === 'apply' || i.decision === 'adapt')],
    ['Pending', pt.items.filter((i) => i.decision === 'pending')],
    ['Skipped', pt.items.filter((i) => i.decision === 'skip')],
  ];
  for (const [title, items] of groups) {
    out.push(`## ${title} (${items.length})`, '');
    if (items.length === 0) out.push('_none_', '');
    for (const i of items) {
      out.push(`### ${i.id} — ${i.decision.toUpperCase()}${i.decidedBy ? ` (${i.decidedBy})` : ''}`, '');
      out.push(`- Observation: ${i.observation}`);
      out.push(`- Strength: ${i.strength}; sample ${i.sample.size}${i.sample.groupSize !== undefined ? ` (${i.sample.groupSize} vs ${i.sample.comparisonSize ?? '?'})` : ''}; snapshot ${i.provenance.collectedAt.slice(0, 10)} (${i.provenance.status}); supporting ids: ${i.provenance.supportingArticleIds.slice(0, 5).join(', ') || '—'}`);
      if (i.rationale) out.push(`- Rationale: ${i.rationale}${i.skipReason ? ` [${i.skipReason}]` : ''}`);
      if (i.decision === 'apply' || i.decision === 'adapt' || i.decision === 'pending') {
        out.push(`- Placement: ${i.placement.join(', ') || '_TODO_'}`);
        out.push(`- Our use: ${i.consequence || '_TODO_'}`);
      }
      if (i.conflictsWithAuthorItems.length) out.push(`- Conflicts with author input: ${i.conflictsWithAuthorItems.join(', ')}`);
      if (i.safeguards.length) out.push(`- Extra safeguards: ${i.safeguards.join(' ')}`);
      out.push('');
    }
  }
  if (pt.notes.length) out.push('## Notes', '', mdList(pt.notes), '');
  return out.join('\n');
}
