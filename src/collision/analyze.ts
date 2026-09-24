import type { ContinuityMap } from '../continuity/schema.js';
import type { NarrativeGapReport } from '../narrative/schema.js';
import type { Publication } from '../publications/schema.js';
import type { ResearchSnapshot } from '../research/types.js';
import { titleFeatures } from '../research/structure.js';
import { compare, overlapLevel, SIMILARITY_METHOD } from '../similarity/index.js';
import type { Clock } from '../shared/clock.js';
import { tokenize, unique } from '../shared/text.js';

export interface CollisionInput {
  topic: string;
  /** Optional longer description / canonical story text for a richer comparison. */
  description?: string;
  publications: readonly Publication[];
  continuity?: ContinuityMap;
  snapshots?: readonly ResearchSnapshot[];
  gap?: NarrativeGapReport;
  clock: Clock;
}

export interface OverlapMatch {
  id: string;
  title: string;
  url?: string;
  platform: string;
  level: 'high' | 'moderate' | 'low';
  cosine: number;
  bm25Normalized: number;
  keywordJaccard: number;
  headingOverlap: number;
  sharedTerms: string[];
}

export interface CollisionReport {
  schemaVersion: 1;
  generatedAt: string;
  topic: string;
  method: string;
  authorOverlap: OverlapMatch[];
  ecosystemOverlap: OverlapMatch[];
  ecosystemSources: Array<{ platform: string; collectedAt: string; sampleSize: number; status: string }>;
  alreadyCoveredConcepts: Array<{ concept: string; coverage: 'explained' | 'mentioned'; publicationIds: string[] }>;
  saturatedAngles: Array<{ label: string; share: number; count: number; sampleSize: number; platform: string; examples: string[] }>;
  novelContribution: { terms: string[]; gaps: string[] };
  alternativeAngles: Array<{ angle: string; why: string; evidence: string[] }>;
  summary: string[];
  notes: string[];
}

/**
 * Topic collision: how much a proposed topic overlaps with (A) what the
 * author already published and (B) what the platform currently publishes.
 * Topical overlap is not plagiarism and is never reported as such.
 */
export function analyzeCollision(input: CollisionInput): CollisionReport {
  const queryText = `${input.topic}\n${input.description ?? ''}`;
  const queryStems = new Set(tokenize(queryText));

  const authorDocs = input.publications.map((p) => ({ id: p.id, text: `${p.title}\n${p.text}`, headings: p.headings.map((h) => h.text) }));
  const byId = new Map(input.publications.map((p) => [p.id, p]));
  const authorOverlap = compare({ id: 'query', text: queryText }, authorDocs)
    .slice(0, 5)
    .map((r) => {
      const p = byId.get(r.id)!;
      const m: OverlapMatch = { id: r.id, title: p.title, platform: p.platform, level: overlapLevel(r), cosine: r.cosine, bm25Normalized: r.bm25Normalized, keywordJaccard: r.keywordJaccard, headingOverlap: r.headingOverlap, sharedTerms: r.sharedTerms };
      if (p.url) m.url = p.url;
      return m;
    });

  const snapshots = input.snapshots ?? [];
  const ecoArticles = snapshots.flatMap((s) => s.articles);
  const ecoById = new Map(ecoArticles.map((a) => [a.id, a]));
  // Only public metadata (titles, tags, hubs) is compared; bodies are never stored.
  const ecosystemOverlap = compare(
    { id: 'query', text: input.topic },
    ecoArticles.map((a) => ({ id: a.id, text: `${a.title} ${a.tags.join(' ')}` })),
  )
    .filter((r) => r.cosine > 0)
    .slice(0, 5)
    .map((r) => {
      const a = ecoById.get(r.id)!;
      return { id: r.id, title: a.title, url: a.url, platform: a.platform, level: overlapLevel(r), cosine: r.cosine, bm25Normalized: r.bm25Normalized, keywordJaccard: r.keywordJaccard, headingOverlap: r.headingOverlap, sharedTerms: r.sharedTerms };
    });

  const alreadyCoveredConcepts = (input.continuity?.concepts ?? [])
    .filter((c) => {
      const stems = c.key.split(' ');
      return stems.length > 0 && stems.every((s) => queryStems.has(s));
    })
    .map((c) => ({ concept: c.label, coverage: c.coverage, publicationIds: unique(c.occurrences.map((o) => o.publicationId)) }));

  const topicFeatures = titleFeatures(input.topic);
  const saturated: CollisionReport['saturatedAngles'] = [];
  for (const s of snapshots) {
    for (const angle of s.saturatedAngles) {
      const hit = angle.term === 'ai-generic' ? topicFeatures.aiTopic : queryStems.has(angle.term);
      if (hit) saturated.push({ label: angle.label, share: angle.share, count: angle.count, sampleSize: angle.sampleSize, platform: s.platform, examples: angle.exampleArticleIds.map((id) => ecoById.get(id)?.title ?? id).slice(0, 3) });
    }
  }

  const authorVocabulary = new Set(input.publications.flatMap((p) => tokenize(`${p.title} ${p.text}`)));
  const ecoVocabulary = new Set(ecoArticles.flatMap((a) => tokenize(`${a.title} ${a.tags.join(' ')}`)));
  const novelTerms = [...queryStems].filter((s) => !authorVocabulary.has(s) && !ecoVocabulary.has(s)).sort();

  const openGaps = (input.gap?.gaps ?? []).filter((g) => g.coverage !== 'explained' && g.strength !== 'weak');
  const alternativeAngles = openGaps.slice(0, 4).map((g) => ({
    angle: g.title,
    why: `${g.strength} narrative gap (${g.strengthReason}); readers have not been told this yet.`,
    evidence: g.evidence.slice(0, 5),
  }));
  const topicMatchesGap = openGaps.filter((g) => tokenize(g.terms.join(' ')).some((t) => queryStems.has(t))).map((g) => g.title);

  const summary: string[] = [];
  const highAuthor = authorOverlap.filter((m) => m.level === 'high');
  if (highAuthor.length) summary.push(`High overlap with your own publication(s): ${highAuthor.map((m) => `"${m.title}"`).join(', ')}. Continue from them instead of repeating them.`);
  else if (authorOverlap.some((m) => m.level === 'moderate')) summary.push('Moderate overlap with your earlier publications: link back and skip what was already explained.');
  else summary.push('Low overlap with your earlier publications.');
  if (saturated.length) summary.push(`Saturated angle(s) in the current ${unique(saturated.map((s) => s.platform)).join('/')} sample: ${saturated.map((s) => `${s.label} (${s.count}/${s.sampleSize})`).join('; ')}. A generic framing would compete with many similar titles.`);
  if (topicMatchesGap.length) summary.push(`The topic touches open narrative gap(s): ${topicMatchesGap.join('; ')}.`);
  if (alternativeAngles.length && (saturated.length || highAuthor.length)) summary.push(`Consider a concrete, evidence-backed angle instead: ${alternativeAngles[0]!.angle}.`);
  if (snapshots.length === 0) summary.push('No research snapshot available: ecosystem overlap was not assessed.');

  return {
    schemaVersion: 1,
    generatedAt: input.clock.now().toISOString(),
    topic: input.topic,
    method: `${SIMILARITY_METHOD} Levels: high (cosine ≥ 0.35 or keyword Jaccard ≥ 0.30), moderate (≥ 0.15 / ≥ 0.12), low otherwise. Ecosystem comparison uses titles and tags only.`,
    authorOverlap,
    ecosystemOverlap,
    ecosystemSources: snapshots.map((s) => ({ platform: s.platform, collectedAt: s.collectedAt, sampleSize: s.sampleSize, status: s.status })),
    alreadyCoveredConcepts,
    saturatedAngles: saturated,
    novelContribution: { terms: novelTerms, gaps: topicMatchesGap.length ? topicMatchesGap : openGaps.slice(0, 2).map((g) => g.title) },
    alternativeAngles,
    summary,
    notes: ['Topical overlap is not plagiarism; it signals what readers may already have seen.', 'Scores are deterministic lexical measures, not semantic judgements. Read the matched titles.'],
  };
}
