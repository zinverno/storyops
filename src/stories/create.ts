import type { ContinuityMap } from '../continuity/schema.js';
import type { Claim } from '../evidence/schema.js';
import type { NarrativeGapItem, NarrativeGapReport } from '../narrative/schema.js';
import type { ProjectReport } from '../project/schema.js';
import type { Clock } from '../shared/clock.js';
import { slugify, tokenize, truncate } from '../shared/text.js';
import { CANONICAL_STORY_SCHEMA_VERSION, canonicalStorySchema, type CanonicalStory } from './schema.js';

export interface CreateStoryInput {
  topic: string;
  projectId: string;
  slug?: string;
  language?: string;
  continuity?: ContinuityMap;
  gap?: NarrativeGapReport;
  report?: ProjectReport;
  clock: Clock;
}

/** Gaps relevant to the topic: lexical match first, otherwise the strongest non-weak gaps. */
export function relevantGaps(topic: string, gap: NarrativeGapReport | undefined): NarrativeGapItem[] {
  if (!gap) return [];
  const stems = new Set(tokenize(topic));
  const matched = gap.gaps.filter((g) => tokenize(`${g.title} ${g.terms.join(' ')}`).some((t) => stems.has(t)));
  if (matched.length > 0) return matched;
  return gap.gaps.filter((g) => g.strength !== 'weak').slice(0, 3);
}

/**
 * Creates a canonical story SKELETON. It pre-fills only what can be derived
 * deterministically (relation to previous publications, narrative gap,
 * evidence refs, factual claims about repository structure) and lists every
 * narrative field the author/agent still has to write in `pending`.
 * It never invents problems, results or measurements.
 */
export function createStorySkeleton(input: CreateStoryInput): CanonicalStory {
  const now = input.clock.now().toISOString();
  const project = input.continuity?.projects.find((p) => p.id === input.projectId);
  const pubs = (input.continuity?.publications ?? []).filter((p) => project?.publicationIds.includes(p.publicationId));
  const gaps = relevantGaps(input.topic, input.gap);

  // The story continues the last in-depth publication; brief posts are references.
  const continued = [...pubs].reverse().find((p) => p.depth !== 'brief') ?? pubs.at(-1);
  const relations: CanonicalStory['relationToPreviousPublications'] = pubs.map((p) => {
    const rel: CanonicalStory['relationToPreviousPublications'][number] = {
      publicationId: p.publicationId,
      title: p.title,
      relation: p === continued ? 'continues' : 'references',
      note: `${p.platform}, ${p.date?.slice(0, 10) ?? 'undated'}, ${p.depth}${p.roles.length ? `, ${p.roles.join('/')}` : ''}`,
    };
    if (p.url) rel.url = p.url;
    return rel;
  });

  const claims: Claim[] = [];
  const addClaim = (id: string, text: string, evidence: string[]) => {
    if (evidence.length && !claims.some((c) => c.id === id)) claims.push({ id, text, classification: 'verified-fact', evidence });
  };
  for (const g of gaps) {
    if (g.kind === 'new-subsystem') {
      const path = g.evidence[0]!;
      addClaim(`exists-${slugify(path, 40)}`, `The repository contains ${path} (${g.signals.files} files, ${g.signals.testFiles} test files).`, [path]);
    }
    if (g.kind === 'removed-approach') addClaim(`removed-${slugify(g.title, 40)}`, `${g.title.replace('Removed approach: ', '')} was removed from the repository.`, g.evidence.filter((e) => e.startsWith('commit:')));
    if (g.kind === 'migration' || g.kind === 'major-refactor') addClaim(`${g.kind}-commits`, `${g.signals.commits} ${g.kind === 'migration' ? 'migration' : 'refactoring'} commit(s) after the last publication.`, g.evidence);
  }

  const visuals: CanonicalStory['possibleVisuals'] = [];
  if (gaps.some((g) => g.kind === 'architecture-evolution')) {
    visuals.push({ id: 'architecture-before-after', kind: 'diagram', description: 'Architecture before and after the change', purpose: 'Show readers what changed relative to the architecture they already know.', supports: 'design' });
  }
  for (const g of gaps.filter((x) => x.kind === 'new-subsystem').slice(0, 3)) {
    visuals.push({ id: `screen-${slugify(g.terms[0] ?? g.id, 30)}`, kind: 'screenshot', description: `User-facing view of ${g.evidence[0]} (only if the product exposes one)`, purpose: 'Show the new subsystem as the user sees it.', supports: 'evidence' });
  }

  const previousState = continued
    ? `Readers last saw "${continued.title}" (${continued.date?.slice(0, 10) ?? 'undated'}). TODO: describe the state it presented, from that publication.`
    : '';
  const manifest = input.report?.metadata.manifests[0];

  const story: CanonicalStory = {
    schemaVersion: CANONICAL_STORY_SCHEMA_VERSION,
    slug: input.slug ?? slugify(input.topic),
    status: 'skeleton',
    language: input.language ?? 'ru',
    topic: input.topic,
    project: input.projectId,
    createdAt: now,
    updatedAt: now,
    context: manifest?.description ? truncate(manifest.description, 400) : '',
    previousState,
    problem: '',
    constraints: [],
    turningPoint: '',
    solution: '',
    technicalDecisions: [],
    failedOrInsufficientApproaches: [],
    evidence: [...new Set(gaps.flatMap((g) => g.evidence))].slice(0, 20),
    measurements: [],
    results: [],
    limitations: [],
    openQuestions: (input.continuity?.unfinishedThreads ?? []).filter((t) => project?.publicationIds.includes(t.publicationId)).slice(0, 5).map((t) => `Earlier ${t.kind}: ${t.text}`),
    relationToPreviousPublications: relations,
    narrativeGap: gaps.length ? gaps.map((g) => `${g.title} [${g.strength}; ${g.coverage}]`).join('\n') : (input.gap?.headline ?? ''),
    possibleVisuals: visuals,
    claims,
    provenance: [
      ...(input.gap ? [`narrative gap report ${input.gap.generatedAt}`] : []),
      ...(input.report ? [`project report ${input.report.inspectedAt}${input.report.head ? ` @ ${input.report.head.slice(0, 10)}` : ''}`] : []),
      ...(input.continuity ? [`continuity map ${input.continuity.generatedAt}`] : []),
    ],
    pending: ['problem', 'turningPoint', 'solution', 'technicalDecisions', 'constraints', 'failedOrInsufficientApproaches', 'results', 'limitations', ...(previousState.includes('TODO') ? ['previousState'] : []), ...(!manifest?.description ? ['context'] : [])],
    outputs: [],
  };
  return canonicalStorySchema.parse(story);
}
