import { COVERAGE_LABEL, coverageText, type TopicCoverage } from '../author/coverage.js';
import type { PatternReportItem } from '../platform/analytics.js';
import type { Publication } from '../publications/schema.js';
import { eventDate, type EventType, type RepoEvent } from '../repo/events.js';
import type { RepoTopicSummary } from '../repo/store.js';
import { compare, overlapLevel } from '../similarity/index.js';
import { truncate, unique } from '../shared/text.js';
import { compileTopics, matchTopics, stems } from '../topics/match.js';
import type { StoredTopic } from '../topics/registry.js';
import type { Dimensions, EventRef, Level, OpportunityCandidate, OverlapLevel, PublicationRef, Quadrant, ThemeContext } from './types.js';

/**
 * Opportunity discovery: repository topic + author coverage + platform
 * landscape → a candidate with separate dimensions. Rules are documented
 * here and repeated in every report's `method`.
 */

export const DISCOVERY_METHOD = [
  'Candidates: project topics (config glossary, config topics marked "project", repository modules) with at least one repository event.',
  'Repository novelty: high = a significant event (new subsystem, state-model change, persistence, split, migration, removal/failed approach, API redesign, security fix, ADR, limitation, or a bug fix/refactor backed by code and tests) after the last publication covering the topic; medium = only minor events after it; low = nothing new since the last publication.',
  'Evidence strength: the strongest event (strong ≥ 4 independent signals, moderate ≥ 2; a type read from a commit message alone stays weak).',
  'Author overlap: from the coverage map (not covered → none, briefly mentioned → low, covered → medium, deeply covered → high); lexical similarity (TF-IDF cosine) lists related publications but does not change the level.',
  'Platform activity, saturation and trend: the topic itself when the platform sample contains it, otherwise its related built-in themes (config "related", or built-in topics matched by the same repository events).',
  'Technical specificity: high = project topic with code and tests in its events; medium = project topic without tests, or a technology/practice topic; low = generic framing.',
  'Matrix: novelty high/medium vs low × platform activity high/medium vs low. No ranking and no combined score.',
].join(' ');

export const NOTICE = 'StoryOps does not choose topics. Candidates are listed alphabetically; every dimension is shown separately so the author can weigh them.';

const SIGNIFICANT: ReadonlySet<EventType> = new Set(['new-subsystem', 'state-model-change', 'new-persistence-layer', 'architecture-split', 'migration', 'failed-approach', 'removed-subsystem', 'feature-reversal', 'api-redesign', 'security-fix', 'architecture-decision', 'limitation-discovered', 'testing-strategy-change', 'new-integration']);

const DAY = 86_400_000;

export interface PlatformLookup {
  id: string;
  /** Saturation/activity/trend of a topic on the platform, or undefined without data. */
  theme(topicId: string): Omit<ThemeContext, 'relation'> | undefined;
}

export interface DiscoveryInput {
  repo: { id: string; name: string } | null;
  repoTopics: readonly RepoTopicSummary[];
  topics: readonly StoredTopic[];
  coverage: readonly TopicCoverage[];
  publications: readonly Publication[];
  platform?: PlatformLookup;
  patterns?: readonly PatternReportItem[];
  now: Date;
  since?: string;
}

function eventRef(e: RepoEvent): EventRef {
  const r: EventRef = { id: e.id, type: e.type, aspects: e.aspects, date: eventDate(e), summary: e.summary, strength: e.evidenceStrength, basis: e.basis, evidence: e.evidence.map((x) => ({ kind: x.kind, ref: x.ref, ...(x.note ? { note: x.note } : {}) })) };
  if (e.subsystem) r.subsystem = e.subsystem;
  return r;
}

const hasTests = (e: RepoEvent) => e.evidence.some((x) => x.kind === 'test') || /test/.test(e.strengthReason);
const hasCode = (e: RepoEvent) => /source changes/.test(e.strengthReason);

function isSignificant(e: RepoEvent): boolean {
  if ([e.type, ...e.aspects].some((t) => SIGNIFICANT.has(t))) return true;
  if ((e.type === 'bug-fix' || e.type === 'large-refactor' || e.type === 'performance-work') && hasCode(e) && hasTests(e)) return true;
  return false;
}

const STRENGTH_ORDER = { weak: 1, moderate: 2, strong: 3 } as const;

function overlapFromCoverage(c: TopicCoverage | undefined): OverlapLevel {
  switch (c?.level) {
    case 'deeply-covered':
      return 'high';
    case 'explained':
      return 'medium';
    case 'mentioned':
      return 'low';
    default:
      return 'none';
  }
}

function quadrant(novelty: Level, activity: Dimensions['platformActivity']['level']): Quadrant {
  if (activity === 'unknown') return 'unknown platform data';
  const highNovelty = novelty !== 'low';
  const highActivity = activity !== 'low';
  if (highNovelty && highActivity) return 'active opportunity';
  if (highNovelty) return 'niche';
  if (highActivity) return 'crowded/repetitive';
  return 'low relevance';
}

const WHY: Partial<Record<EventType, (e: RepoEvent) => string>> = {
  'new-subsystem': (e) => `Introduces a subsystem (${e.subsystem ?? e.summary})${hasTests(e) ? ' with tests' : ''}.`,
  'state-model-change': (e) => `Changes how state is modelled (${e.summary}).`,
  'new-persistence-layer': (e) => `Adds or changes persistence (${e.summary}).`,
  'bug-fix': (e) => `Contains a concrete failure and its fix (${e.summary}): a real engineering conflict${hasTests(e) ? ', pinned by a test' : ''}.`,
  'failed-approach': (e) => `An approach was abandoned soon after it was introduced (${e.summary}).`,
  'removed-subsystem': (e) => `A subsystem was removed (${e.summary}): a design that stopped fitting.`,
  'feature-reversal': (e) => `A change was reverted (${e.summary}).`,
  'architecture-decision': (e) => `Backed by an architecture decision record (${e.summary.replace(/^ADR: /, '')}).`,
  migration: (e) => `A migration (${e.summary}).`,
  'large-refactor': (e) => `A structural refactoring (${e.summary}).`,
  'performance-work': (e) => `Performance work (${e.summary}).`,
  'architecture-split': (e) => `A component was split or extracted (${e.summary}).`,
  'api-redesign': (e) => `An interface changed incompatibly (${e.summary}).`,
  'security-fix': (e) => `A security-relevant fix (${e.summary}).`,
  'new-integration': (e) => `A new integration (${e.summary}).`,
  'limitation-discovered': (e) => `A limitation was discovered or documented (${e.summary}).`,
  'testing-strategy-change': (e) => `The testing approach changed (${e.summary}).`,
};

const DIRECTION: Partial<Record<EventType, string>> = {
  'bug-fix': 'the failure: how it showed up, why it happened, what the fix changed',
  'failed-approach': 'why the first approach did not hold',
  'removed-subsystem': 'what the removed design could not do any more',
  'state-model-change': 'what is persisted versus computed, and why the model changed',
  'new-persistence-layer': 'the persistence change and its trade-offs',
  'new-subsystem': 'the problem the new subsystem answers',
  migration: 'the migration path and what broke along the way',
  'architecture-decision': 'the decision record: options, choice, consequences',
  'performance-work': 'what was measured (only if measurements exist)',
};

const PATTERNS_FOR: Partial<Record<EventType, string[]>> = {
  'bug-fix': ['body-conflict-early', 'title-conflict'],
  'failed-approach': ['body-conflict-early', 'body-before-after'],
  'removed-subsystem': ['body-before-after'],
  migration: ['body-before-after', 'title-before-after'],
  'large-refactor': ['body-before-after'],
  'performance-work': ['body-measurements'],
  'new-subsystem': ['body-diagrams', 'body-code'],
  'state-model-change': ['body-diagrams', 'body-code'],
  'architecture-decision': ['body-diagrams'],
};

export function relatedThemes(topic: StoredTopic, repoTopic: RepoTopicSummary | undefined, topics: readonly StoredTopic[], allRepoTopics: readonly RepoTopicSummary[]): string[] {
  const builtin = new Set(topics.filter((t) => t.origin === 'builtin').map((t) => t.id));
  const eventIds = new Set(repoTopic?.events.map((e) => e.id) ?? []);
  const viaEvents = allRepoTopics.filter((rt) => builtin.has(rt.topicId) && rt.events.some((e) => eventIds.has(e.id))).map((rt) => rt.topicId);
  return unique([...topic.related, ...(topic.parentId ? [topic.parentId] : []), ...viaEvents]).filter((id) => id !== topic.id);
}

export function buildCandidate(input: DiscoveryInput, topic: StoredTopic, repoTopic: RepoTopicSummary | undefined, query?: string): OpportunityCandidate {
  const coverage = input.coverage.find((c) => c.topicId === topic.id);
  const events = (repoTopic?.events ?? []).filter((e) => e.type !== 'release' && (!input.since || e.dateEnd >= input.since)).sort((a, b) => eventDate(a).localeCompare(eventDate(b)) || a.id.localeCompare(b.id));
  const lastCovered = coverage?.lastCoveredAt;
  const newEvents = events.filter((e) => !lastCovered || Date.parse(eventDate(e)) > Date.parse(lastCovered));
  const significantNew = newEvents.filter(isSignificant);

  // Repository novelty
  let novelty: Dimensions['repositoryNovelty'];
  if (events.length === 0) novelty = { level: 'low', reason: 'no repository events for this topic' };
  else if (significantNew.length) novelty = { level: 'high', reason: `${significantNew.length} significant event(s) ${lastCovered ? `after the last publication on it (${lastCovered.slice(0, 10)})` : 'and no publication on it yet'}: ${unique(significantNew.map((e) => e.type)).join(', ')}` };
  else if (newEvents.length) novelty = { level: 'medium', reason: `${newEvents.length} minor event(s) after ${lastCovered ? `the last publication (${lastCovered.slice(0, 10)})` : 'the start'}` };
  else novelty = { level: 'low', reason: `no repository changes after the last publication on it (${lastCovered?.slice(0, 10) ?? '—'})` };

  const strongest = [...events].sort((a, b) => STRENGTH_ORDER[b.evidenceStrength] - STRENGTH_ORDER[a.evidenceStrength])[0];
  const evidence: Dimensions['evidenceStrength'] = strongest ? { level: strongest.evidenceStrength, reason: `${strongest.summary}: ${strongest.strengthReason}` } : { level: 'none', reason: 'no repository evidence' };

  // Author archive
  const overlap = overlapFromCoverage(coverage);
  const covPubs: PublicationRef[] = (coverage?.publications ?? []).map((p) => ({ id: p.publicationId, title: p.title, platform: p.platform, level: p.level, ...(p.date ? { date: p.date } : {}), ...(p.url ? { url: p.url } : {}) }));
  const queryText = [query ?? '', topic.label, ...topic.aliases, ...events.slice(0, 6).map((e) => e.summary)].join(' ');
  const similar = input.publications.length
    ? compare({ id: 'candidate', text: queryText }, input.publications.map((p) => ({ id: p.id, text: `${p.title} ${p.text}`, headings: p.headings.map((h) => h.text) })))
        .filter((r) => overlapLevel(r) !== 'low')
        .slice(0, 3)
        .map((r) => {
          const p = input.publications.find((x) => x.id === r.id)!;
          return { id: p.id, title: p.title, platform: p.platform, cosine: r.cosine, sharedTerms: r.sharedTerms.slice(0, 6), ...(p.publicationDate ? { date: p.publicationDate } : {}), ...(p.url ? { url: p.url } : {}) };
        })
    : [];
  const overlapReason = coverage && coverage.level !== 'not-covered' ? `${COVERAGE_LABEL[coverage.level]} in ${coverage.publications.length} publication(s), last ${coverage.lastCoveredAt?.slice(0, 10) ?? 'undated'}${coverage.outdated ? ` (possibly outdated: ${coverage.outdatedReason})` : ''}` : similar.length ? `topic not found in the archive; lexically related: "${similar[0]!.title}" (cosine ${similar[0]!.cosine})` : 'not found in the archive';

  // Platform
  let platform: OpportunityCandidate['platform'] = null;
  if (input.platform) {
    const own = input.platform.theme(topic.id);
    const themes: ThemeContext[] = [];
    if (own) themes.push({ ...own, relation: 'topic' });
    for (const id of relatedThemes(topic, repoTopic, input.topics, input.repoTopics)) {
      const t = input.platform.theme(id);
      if (t) themes.push({ ...t, relation: 'related' });
    }
    const rank = { unknown: 0, low: 1, medium: 2, high: 3 } as const;
    const primary = themes.find((t) => t.relation === 'topic' && t.articleCount > 0) ?? [...themes].filter((t) => t.relation === 'related').sort((a, b) => rank[b.activity] - rank[a.activity] || b.share - a.share)[0] ?? themes[0] ?? null;
    platform = { id: input.platform.id, primary, themes };
  }
  const primary = platform?.primary ?? null;
  const via = primary ? (primary.relation === 'topic' ? `"${primary.label}"` : `related theme "${primary.label}"`) : '';
  const activity: Dimensions['platformActivity'] = !platform ? { level: 'unknown', reason: 'no platform selected' } : primary ? { level: primary.activity, reason: `${via}: ${primary.articleCount} of ${primary.sampleSize} articles in the last ${primary.window.days} days` } : { level: 'unknown', reason: 'no platform data for this topic or its related themes' };
  const saturation: Dimensions['saturation'] = primary ? { state: primary.state, reason: `${via}: ${primary.because.join('; ')}` } : { state: 'unknown', reason: 'no platform data' };
  const trend: Dimensions['trendDirection'] = primary ? { direction: primary.trend, reason: via } : { direction: 'unknown', reason: 'no platform data' };

  // Specificity and recency
  const project = topic.specificity === 'project' || topic.origin === 'module';
  const specificity: Dimensions['technicalSpecificity'] = project
    ? events.some((e) => hasCode(e) && hasTests(e))
      ? { level: 'high', reason: 'project-specific topic with code and tests in its events' }
      : { level: 'medium', reason: 'project-specific topic without test evidence' }
    : topic.specificity === 'generic'
      ? { level: 'low', reason: 'generic framing shared by many unrelated articles' }
      : { level: 'medium', reason: `${topic.specificity} topic` };
  const lastEventAt = events.map((e) => e.dateEnd).sort().at(-1);
  const days = lastEventAt ? Math.round((input.now.getTime() - Date.parse(lastEventAt)) / DAY) : undefined;
  const recency: Dimensions['recency'] = lastEventAt && days !== undefined ? { level: days <= 90 ? 'recent' : days <= 365 ? 'this-year' : 'older', lastEventAt, days } : { level: 'unknown' };

  const dimensions: Dimensions = { repositoryNovelty: novelty, evidenceStrength: evidence, authorOverlap: { level: overlap, reason: overlapReason }, platformActivity: activity, saturation, trendDirection: trend, technicalSpecificity: specificity, recency };

  // Narrative-free descriptions
  const why = unique(events.filter((e) => isSignificant(e) || e.type === 'bug-fix').flatMap((e) => [e.type, ...e.aspects].map((t) => WHY[t]?.(e)).filter((x): x is string => Boolean(x)))).slice(0, 6);
  const whatChanged = events.map((e) => `${eventDate(e).slice(0, 10)} ${e.type}: ${e.summary}`);
  const alreadyCovered = covPubs.map((p) => `"${p.title}" (${p.platform}, ${p.date?.slice(0, 10) ?? 'undated'}): ${p.level ? COVERAGE_LABEL[p.level] : 'related'}`);
  const genuinelyNew = lastCovered ? newEvents.map((e) => `${eventDate(e).slice(0, 10)} ${e.summary}`) : events.length ? ['Nothing on this topic has been published yet.'] : [];
  const possibleDirections = unique(events.flatMap((e) => [e.type, ...e.aspects]).map((t) => DIRECTION[t]).filter((x): x is string => Boolean(x))).map((d) => `Possible direction (for the author to decide): ${d}.`);

  const patternIds = new Set(events.flatMap((e) => [e.type, ...e.aspects]).flatMap((t) => PATTERNS_FOR[t] ?? []));
  const patterns = (input.patterns ?? []).filter((p) => patternIds.has(p.patternId)).map((p) => ({ patternId: p.patternId, observation: p.observation, strength: p.strength, possibleRelevance: p.possibleRelevance }));

  const risks: string[] = [];
  if (overlap === 'high') risks.push(`Substantial overlap with your archive (${overlapReason}).`);
  if (saturation.state === 'crowded' || saturation.state === 'highly-saturated') risks.push(`${via} occupies a large share of the current platform sample (${primary!.articleCount}/${primary!.sampleSize}); framing may overlap with many recent articles.`);
  if (trend.direction === 'declining') risks.push(`${via} is declining in the research history.`);
  if (evidence.level === 'weak') risks.push('Evidence rests mainly on commit messages; verify the change in the code.');
  if (events.length && !events.some(hasTests)) risks.push('No test evidence for this topic.');
  if (activity.level === 'unknown' && platform) risks.push('Not enough platform data to describe activity or saturation.');

  const questions: string[] = [];
  for (const e of events.filter((x) => x.type === 'bug-fix' || x.aspects.includes('bug-fix')).slice(0, 2)) questions.push(`How was the problem behind "${truncate(e.summary, 90)}" discovered: in daily use, by a user, or only through tests?`);
  for (const e of events.filter((x) => x.type === 'failed-approach' || x.type === 'removed-subsystem').slice(0, 2)) questions.push(`Why was ${e.subsystem ?? 'it'} removed, and what replaced it?`);
  for (const e of events.filter((x) => x.type === 'performance-work' && !x.evidence.some((y) => y.kind === 'benchmark')).slice(0, 1)) questions.push(`Are there measurements for "${truncate(e.summary, 80)}"? None were found in the repository.`);
  for (const e of events.filter((x) => x.basis === 'commit-message').slice(0, 2)) questions.push(`The commit message suggests "${e.type}" for "${truncate(e.summary, 80)}". Does the code confirm that reading?`);
  if (covPubs.length && overlap !== 'low') questions.push(`What would a reader of "${covPubs.at(-1)!.title}" learn here that is new?`);
  if (coverage?.outdated) questions.push('Earlier publications describe a state that has since changed. Should readers be told what no longer holds?');

  const unknowns: string[] = [];
  if (!events.some((e) => e.evidence.some((x) => x.kind === 'benchmark'))) unknowns.push('No benchmark or measurement files found for this topic.');
  const messageOnly = events.filter((e) => e.basis === 'commit-message').length;
  if (messageOnly) unknowns.push(`${messageOnly} event type(s) inferred from commit messages only.`);
  unknowns.push('Motivation, user impact and production behaviour are not visible in the repository.');
  if (!platform) unknowns.push('No platform selected: activity and saturation unknown.');

  const q: Quadrant = quadrant(novelty.level, activity.level);
  const candidate: OpportunityCandidate = {
    id: topic.id,
    topic: { id: topic.id, label: topic.label, origin: topic.origin, specificity: topic.specificity },
    repository: input.repo && events.length ? { id: input.repo.id, name: input.repo.name, events: events.map(eventRef), ...(events[0] ? { firstEventAt: eventDate(events[0]) } : {}), ...(lastEventAt ? { lastEventAt } : {}) } : null,
    whyTechnicallyInteresting: why,
    whatChanged,
    author: { coverage: coverage?.level ?? 'not-covered', coverageText: coverage ? coverageText(coverage) : COVERAGE_LABEL['not-covered'], publications: covPubs, similar, alreadyCovered, genuinelyNew },
    platform,
    patterns,
    dimensions,
    quadrant: q,
    risks,
    questions,
    unknowns,
    possibleDirections,
  };
  if (query) candidate.query = query;
  return candidate;
}

/** Candidates for every project topic with repository events, alphabetically (no ranking). */
export function discoverOpportunities(input: DiscoveryInput, options: { limit?: number } = {}): OpportunityCandidate[] {
  const byId = new Map(input.topics.map((t) => [t.id, t]));
  const candidates = input.repoTopics
    .filter((rt) => {
      const t = byId.get(rt.topicId);
      return t && (t.specificity === 'project' || t.origin === 'module') && rt.events.some((e) => e.type !== 'release');
    })
    .map((rt) => buildCandidate(input, byId.get(rt.topicId)!, rt))
    .filter((c) => c.repository !== null)
    .sort((a, b) => a.topic.label.localeCompare(b.topic.label));
  return options.limit ? candidates.slice(0, options.limit) : candidates;
}

/**
 * A candidate for free text ("generic AI plugin"): the topic it resolves to,
 * or an ad-hoc topic whose aliases are the text itself. Repository events
 * match when they share the text's content words.
 */
export function candidateForQuery(input: DiscoveryInput, query: string): OpportunityCandidate {
  const compiled = compileTopics(input.topics.map((t) => ({ id: t.id, label: t.label, aliases: t.aliases, specificity: t.specificity })));
  const exact = input.topics.find((t) => t.id === query.toLowerCase() || t.label.toLowerCase() === query.toLowerCase());
  const matched = exact ? [exact.id] : matchTopics({ title: query }, compiled).map((m) => m.topicId);
  const projectMatch = matched.map((id) => input.topics.find((t) => t.id === id)!).find((t) => t.specificity === 'project' || t.origin === 'module');
  if (projectMatch) return buildCandidate(input, projectMatch, input.repoTopics.find((rt) => rt.topicId === projectMatch.id), query);
  const words = new Set(stems(query).filter((s) => s.length >= 4));
  const events = input.repoTopics.flatMap((rt) => rt.events).filter((e, i, all) => all.findIndex((x) => x.id === e.id) === i && stems(`${e.summary} ${e.terms.join(' ')}`).filter((s) => words.has(s)).length >= Math.min(2, words.size));
  const builtin = matched.map((id) => input.topics.find((t) => t.id === id)!).filter(Boolean);
  const adhoc: StoredTopic = { id: `query-${query.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40)}`, label: query, aliases: [query], origin: 'query', specificity: builtin.some((t) => t.specificity === 'generic') ? 'generic' : builtin[0]?.specificity ?? 'technology', related: builtin.map((t) => t.id) };
  const pseudo: RepoTopicSummary | undefined = events.length ? { topicId: adhoc.id, label: query, origin: 'query', specificity: adhoc.specificity, events, firstEventAt: events[0]!.dateStart, lastEventAt: events.at(-1)!.dateEnd, types: unique(events.map((e) => e.type)) } : undefined;
  return buildCandidate({ ...input, topics: [...input.topics, adhoc] }, adhoc, pseudo, query);
}

export function opportunityMatrix(candidates: readonly OpportunityCandidate[]): Record<Quadrant, string[]> {
  const m: Record<Quadrant, string[]> = { 'active opportunity': [], niche: [], 'crowded/repetitive': [], 'low relevance': [], 'unknown platform data': [] };
  for (const c of candidates) m[c.quadrant].push(c.topic.label);
  return m;
}
