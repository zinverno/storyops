import type { PlatformStrategy, PublicationType } from '../../platforms/schema.js';
import type { CollisionReport } from '../collision/analyze.js';
import { explainedConcepts } from '../continuity/build.js';
import type { ContinuityMap } from '../continuity/schema.js';
import type { EvidenceMap } from '../evidence/schema.js';
import type { NarrativeGapReport } from '../narrative/schema.js';
import { titleFeatures } from '../research/structure.js';
import type { ResearchSnapshot } from '../research/types.js';
import type { Clock } from '../shared/clock.js';
import { lengthTarget } from '../platforms/render.js';
import type { CanonicalStory } from '../stories/schema.js';
import { validateStory } from '../stories/validate.js';

/**
 * Where a packaging recommendation comes from. Order encodes the priority
 * model: factual truth > author voice > continuity > platform strategy > trends.
 */
export type RecommendationSource = 'evidence' | 'author-voice' | 'continuity' | 'narrative-gap' | 'platform-strategy' | 'trend-observation' | 'topic-collision';

export interface PackagingRecommendation {
  text: string;
  source: RecommendationSource;
  provenance: string;
  advisory: boolean;
}

export interface Brief {
  schemaVersion: 1;
  generatedAt: string;
  story: string;
  platform: string;
  strategyVersion: string;
  publicationType: PublicationType;
  workingTitle: string;
  coreQuestion: string;
  whyNow: string;
  targetReader: string;
  relationToPrevious: string[];
  alreadyExplained: string[];
  doNotReExplain: string[];
  narrativeGap: string;
  uniqueContribution: string[];
  platformContext: { status: string; lines: string[] };
  mainTechnicalConflict: string;
  importantEvidence: string[];
  screenshotsRequired: string[];
  potentialDiagrams: string[];
  expectedStructure: Array<{ id: string; purpose: string }>;
  knownLimitations: string[];
  claimsRequiringVerification: string[];
  packaging: PackagingRecommendation[];
  lengthTarget: string;
  readiness: { readyForDrafting: boolean; blockers: string[] };
}

export interface BriefInput {
  story: CanonicalStory;
  strategy: PlatformStrategy;
  publicationType?: PublicationType;
  continuity?: ContinuityMap;
  gap?: NarrativeGapReport;
  collision?: CollisionReport;
  snapshot?: { snapshot: ResearchSnapshot; ageHours: number; fallbackReason?: string };
  evidence?: EvidenceMap;
  clock: Clock;
}

const TODO = (what: string) => `TODO(agent): ${what}`;

export function buildBrief(input: BriefInput): Brief {
  const { story, strategy } = input;
  const type = input.publicationType ?? strategy.content.defaultPublicationType;
  const validation = validateStory(story);
  const continuing = story.relationToPreviousPublications.filter((r) => r.relation === 'continues');
  const explained = input.continuity ? explainedConcepts(input.continuity, story.project) : [];
  const projectEntry = input.continuity?.projects.find((p) => p.id === story.project);
  const archGap = input.gap?.gaps.find((g) => g.kind === 'architecture-evolution');

  const packaging: PackagingRecommendation[] = [];
  if (continuing.length > 0) {
    const last = continuing[0]!;
    packaging.push({
      text: `Do not reintroduce the project from zero. Open from what changed since "${last.title ?? last.publicationId}" and link to it.`,
      source: 'continuity',
      provenance: `continuity map: ${projectEntry?.publicationIds.length ?? 0} earlier publication(s) about ${story.project}`,
      advisory: false,
    });
  }
  if (archGap) {
    packaging.push({
      text: 'Begin from the limitation of the previous architecture that readers already know, then show how it evolved.',
      source: 'narrative-gap',
      provenance: `narrative gap "${archGap.title}" (${archGap.strength}: ${archGap.strengthReason})`,
      advisory: false,
    });
  }
  packaging.push({ text: strategy.opening.preferred, source: 'platform-strategy', provenance: `${strategy.id}@${strategy.version} opening`, advisory: false });
  if (input.snapshot && input.snapshot.snapshot.platform === strategy.id) {
    const s = input.snapshot.snapshot;
    const age = `snapshot ${s.collectedAt.slice(0, 10)}, ${input.snapshot.ageHours}h old, status ${s.status}, N=${s.sampleSize}`;
    const conflict = s.observations.filter((o) => (o.id === 'title-conflict' || o.id === 'body-conflict-early') && o.values.topShare !== undefined && Number(o.values.topShare) > Number(o.values.restShare));
    if (conflict.length > 0) {
      packaging.push({
        text: 'Consider exposing the concrete technical conflict early (title and first section), if the story genuinely has one.',
        source: 'trend-observation',
        provenance: `${conflict.map((o) => `${o.id}: ${o.statement}`).join(' ')} (${age})`,
        advisory: true,
      });
    }
    const aiSaturated = s.saturatedAngles.find((a) => a.term === 'ai-generic');
    if (aiSaturated) {
      packaging.push({
        text: titleFeatures(story.topic).aiTopic
          ? 'The generic "AI in my project" framing is saturated in the current sample; lead with the concrete engineering change instead.'
          : 'AI-themed headlines are saturated in the current sample; avoid adding AI framing that the story does not need.',
        source: 'trend-observation',
        provenance: `saturated angle ${aiSaturated.count}/${aiSaturated.sampleSize} (${age})`,
        advisory: true,
      });
    }
  }
  for (const line of input.collision?.summary ?? []) {
    if (/overlap with your own|Saturated angle/i.test(line)) packaging.push({ text: line, source: 'topic-collision', provenance: `collision report ${input.collision!.generatedAt}`, advisory: true });
  }

  let platformContext: Brief['platformContext'];
  if (strategy.research.liveResearch !== 'implemented') {
    platformContext = { status: 'live research unsupported', lines: ['Using the stable platform strategy only.', ...strategy.research.limitations] };
  } else if (!input.snapshot) {
    platformContext = { status: 'no research snapshot', lines: ['Run `editorial-kit research --platform ' + strategy.id + '` for current context. Authoring can proceed without it.'] };
  } else {
    const s = input.snapshot.snapshot;
    platformContext = {
      status: `${s.status} snapshot from ${s.collectedAt.slice(0, 10)} (${input.snapshot.ageHours}h old)`,
      lines: [
        ...(input.snapshot.fallbackReason ? [`Live research failed (${input.snapshot.fallbackReason}); this is an earlier snapshot.`] : []),
        `Sample: ${s.sampleSize} articles; windows ${s.windows.map((w) => w.id).join(', ')}.`,
        ...s.observations.filter((o) => o.strength !== 'weak').map((o) => `Observation (${o.strength}): ${o.statement}`),
        ...s.saturatedAngles.map((a) => `Saturated: ${a.label} (${a.count}/${a.sampleSize})`),
      ],
    };
  }

  const verification = [
    ...story.claims.filter((c) => c.classification === 'unverified' || c.classification === 'hypothesis').map((c) => `${c.classification}: ${c.text}`),
    ...(input.evidence?.claims.filter((c) => c.status === 'missing-evidence' || c.status === 'broken-reference').map((c) => `${c.status}: ${c.text}`) ?? story.claims.filter((c) => c.classification === 'verified-fact' && c.evidence.length === 0).map((c) => `missing evidence: ${c.text}`)),
  ];

  const blockers = validation.issues.filter((i) => i.severity === 'error').map((i) => i.message);
  if (!input.evidence) blockers.push('Evidence has not been collected yet (`editorial-kit evidence --story …`).');
  else for (const issue of input.evidence.issues.filter((i) => i.severity === 'error')) blockers.push(issue.message);

  const sections = strategy.structures[type] ?? strategy.structures[strategy.content.defaultPublicationType] ?? [];
  return {
    schemaVersion: 1,
    generatedAt: input.clock.now().toISOString(),
    story: story.slug,
    platform: strategy.id,
    strategyVersion: strategy.version,
    publicationType: type,
    workingTitle: TODO(`working title for ${strategy.displayName} (concrete subject + change; see packaging notes)`),
    coreQuestion: story.problem ? `How was this solved: ${story.problem}` : TODO('the question this publication answers'),
    whyNow: input.gap?.boundary.lastPublicationAt ? `Project changed since the last publication (${input.gap.boundary.lastPublicationAt.slice(0, 10)}): ${input.gap.headline ?? 'see narrative gap'}` : story.narrativeGap || TODO('why this is worth publishing now'),
    targetReader: TODO(`target reader on ${strategy.displayName}`),
    relationToPrevious: story.relationToPreviousPublications.map((r) => `${r.relation}: ${r.title ?? r.publicationId}${r.url ? ` <${r.url}>` : ''}${r.note ? ` (${r.note})` : ''}`),
    alreadyExplained: [...(projectEntry?.coveredAspects.map((a) => `${a.label} — ${a.publication.title}`) ?? []), ...explained.map((c) => `concept: ${c.label}`)],
    doNotReExplain: explained.map((c) => c.label),
    narrativeGap: story.narrativeGap || input.gap?.headline || TODO('narrative gap'),
    uniqueContribution: (input.gap?.gaps ?? []).filter((g) => g.strength === 'strong').map((g) => `${g.title} — backed by ${g.strengthReason}`),
    platformContext,
    mainTechnicalConflict: story.problem || story.turningPoint || TODO('the main technical conflict, from evidence'),
    importantEvidence: input.evidence ? input.evidence.records.map((r) => `${r.ref} (${r.kind}) — ${r.title}`) : story.evidence,
    screenshotsRequired: story.possibleVisuals.filter((v) => v.kind === 'screenshot').map((v) => `${v.id}: ${v.description} — ${v.purpose}`),
    potentialDiagrams: story.possibleVisuals.filter((v) => v.kind === 'diagram').map((v) => `${v.id}: ${v.description} — ${v.purpose}`),
    expectedStructure: sections.map((s) => ({ id: s.id, purpose: s.purpose })),
    knownLimitations: story.limitations,
    claimsRequiringVerification: verification,
    packaging,
    lengthTarget: lengthTarget(strategy, type),
    readiness: { readyForDrafting: blockers.length === 0, blockers },
  };
}
