import { rawTokens, stem, isStopword } from '../shared/text.js';
import type { Observation, SaturatedAngle, TrendArticle } from './types.js';

/**
 * Abstract editorial pattern extraction. Produces OBSERVATIONS about a sample
 * (counts, shares, medians) with provenance. It never produces
 * recommendations; those are made later, in briefs, and are labelled advisory.
 */

interface BooleanFeature {
  id: string;
  label: string;
  /** Returns undefined when the feature cannot be evaluated for an article. */
  get: (a: TrendArticle) => boolean | undefined;
  needsBody?: boolean;
}

export const CONFLICT_EARLY_WORDS = 150;
export const TECHNICAL_EARLY_WORDS = 200;

const FEATURES: BooleanFeature[] = [
  { id: 'title-conflict', label: 'frame the title around a concrete problem or conflict', get: (a) => a.titleFeatures?.conflictFraming },
  { id: 'title-question', label: 'use a question as the title', get: (a) => a.titleFeatures?.isQuestion },
  { id: 'title-number', label: 'include a number in the title', get: (a) => a.titleFeatures?.hasNumber },
  { id: 'title-first-person', label: 'use first-person framing in the title', get: (a) => a.titleFeatures?.firstPerson },
  { id: 'title-before-after', label: 'use before/after or migration framing in the title', get: (a) => a.titleFeatures?.beforeAfterFraming },
  { id: 'title-postmortem', label: 'use postmortem framing in the title', get: (a) => a.titleFeatures?.postmortemFraming },
  { id: 'title-how-to', label: 'use how-to framing in the title', get: (a) => a.titleFeatures?.howToFraming },
  { id: 'title-ai', label: 'put AI/LLM in the title', get: (a) => a.titleFeatures?.aiTopic },
  {
    id: 'body-conflict-early',
    label: `describe a concrete technical problem within the first ${CONFLICT_EARLY_WORDS} words`,
    get: (a) => (a.structure ? a.structure.wordsBeforeConflict !== undefined && a.structure.wordsBeforeConflict <= CONFLICT_EARLY_WORDS : undefined),
    needsBody: true,
  },
  {
    id: 'body-technical-early',
    label: `reach the first technical detail (code, inline code or a measurement) within the first ${TECHNICAL_EARLY_WORDS} words`,
    get: (a) => (a.structure ? a.structure.wordsBeforeFirstTechnicalDetail !== undefined && a.structure.wordsBeforeFirstTechnicalDetail <= TECHNICAL_EARLY_WORDS : undefined),
    needsBody: true,
  },
  { id: 'body-measurements', label: 'report measurements', get: (a) => a.structure?.hasMeasurements, needsBody: true },
  { id: 'body-code', label: 'include code blocks', get: (a) => (a.structure ? a.structure.codeBlocks > 0 : undefined), needsBody: true },
  { id: 'body-diagrams', label: 'include diagram-like images', get: (a) => (a.structure ? a.structure.diagramHints > 0 : undefined), needsBody: true },
  { id: 'body-before-after', label: 'use before/after section structure', get: (a) => a.structure?.beforeAfterStructure, needsBody: true },
  { id: 'body-postmortem', label: 'use postmortem section structure', get: (a) => a.structure?.postmortemStructure, needsBody: true },
  { id: 'body-next-steps', label: 'end with a "what next" section', get: (a) => (a.structure ? a.structure.conclusionKind === 'next-steps' : undefined), needsBody: true },
];

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export interface SplitSample {
  top: TrendArticle[];
  rest: TrendArticle[];
}

/** Top third by heuristic momentum (at least 3, at most half the sample). */
export function splitByMomentum(articles: readonly TrendArticle[]): SplitSample {
  const scored = articles.filter((a) => a.momentum).sort((a, b) => b.momentum!.score - a.momentum!.score || a.id.localeCompare(b.id));
  const topSize = Math.min(Math.floor(scored.length / 2), Math.max(3, Math.round(scored.length / 3)));
  return { top: scored.slice(0, topSize), rest: scored.slice(topSize) };
}

export function extractObservations(articles: readonly TrendArticle[], windowLabel: string): Observation[] {
  const { top, rest } = splitByMomentum(articles);
  const n = top.length + rest.length;
  const observations: Observation[] = [];
  if (top.length < 3 || rest.length < 2) return observations;
  const baseLimitations = [
    `Sample of ${n} articles from platform top lists; top lists are already a ranked, biased selection.`,
    'Grouping uses the heuristic momentum score, which is an advisory signal, not a measure of quality.',
    'Features are detected lexically (Russian/English keyword patterns) and can misclassify.',
  ];
  if (n < 20) baseLimitations.unshift(`Small sample (N=${n}); treat as anecdotal.`);

  for (const feature of FEATURES) {
    const evalTop = top.map((a) => ({ a, v: feature.get(a) })).filter((x) => x.v !== undefined);
    const evalRest = rest.map((a) => ({ a, v: feature.get(a) })).filter((x) => x.v !== undefined);
    if (evalTop.length < 3 || evalRest.length < 2) continue;
    const topHits = evalTop.filter((x) => x.v).length;
    const restHits = evalRest.filter((x) => x.v).length;
    const topShare = topHits / evalTop.length;
    const restShare = restHits / evalRest.length;
    const diff = topShare - restShare;
    if (Math.abs(diff) < 0.2 || (diff > 0 && topHits < 2)) continue;
    const strength: Observation['strength'] = Math.abs(diff) >= 0.4 && evalTop.length >= 5 ? 'notable' : Math.abs(diff) >= 0.25 ? 'moderate' : 'weak';
    const direction = diff > 0 ? 'more often' : 'less often';
    const limitations = [...baseLimitations];
    if (feature.needsBody) limitations.push(`Evaluated only on ${evalTop.length + evalRest.length} articles whose bodies were parsed.`);
    observations.push({
      id: feature.id,
      statement: `In the ${windowLabel} sample, ${topHits} of ${evalTop.length} higher-momentum articles ${feature.label}, vs ${restHits} of ${evalRest.length} others (${direction} among higher-momentum articles).`,
      metric: feature.id,
      sample: { window: windowLabel, size: evalTop.length + evalRest.length, groupSize: evalTop.length, comparisonSize: evalRest.length },
      values: { topHits, topSize: evalTop.length, restHits, restSize: evalRest.length, topShare: Math.round(topShare * 100) / 100, restShare: Math.round(restShare * 100) / 100 },
      articleIds: evalTop.filter((x) => x.v).map((x) => x.a.id),
      strength,
      limitations,
    });
  }

  // Descriptive medians (no comparison claims beyond the numbers themselves).
  const numeric: Array<[string, string, (a: TrendArticle) => number | undefined]> = [
    ['title-length', 'title length (characters)', (a) => a.titleFeatures?.chars],
    ['word-count', 'article length (words)', (a) => a.structure?.wordCount],
    ['section-count', 'number of sections', (a) => a.structure?.sectionCount],
    ['intro-words', 'introduction length before the first heading (words)', (a) => a.structure?.introWords],
    ['images-per-1000', 'images per 1000 words', (a) => a.structure?.imagesPer1000Words],
  ];
  for (const [id, label, get] of numeric) {
    const tv = top.map(get).filter((v): v is number => v !== undefined);
    const rv = rest.map(get).filter((v): v is number => v !== undefined);
    if (tv.length < 3 || rv.length < 2) continue;
    const mt = median(tv)!;
    const mr = median(rv)!;
    observations.push({
      id: `median-${id}`,
      statement: `Median ${label}: ${round1(mt)} among higher-momentum articles vs ${round1(mr)} among others in the ${windowLabel} sample.`,
      metric: id,
      sample: { window: windowLabel, size: tv.length + rv.length, groupSize: tv.length, comparisonSize: rv.length },
      values: { topMedian: round1(mt), restMedian: round1(mr) },
      articleIds: top.map((a) => a.id),
      strength: 'weak',
      limitations: [...baseLimitations, 'Medians describe the sample; they are not targets.'],
    });
  }
  return observations;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Saturated angles: themes that appear in a large share of sampled titles.
 * One semantic group is built in (AI/LLM topics, detected by titleFeatures);
 * the rest are frequent title stems.
 */
export function saturatedAngles(articles: readonly TrendArticle[], options: { minShare?: number; minCount?: number } = {}): SaturatedAngle[] {
  const minShare = options.minShare ?? 0.2;
  const minCount = options.minCount ?? 3;
  const n = articles.length;
  if (n === 0) return [];
  const result: SaturatedAngle[] = [];
  const ai = articles.filter((a) => a.titleFeatures?.aiTopic);
  if (ai.length >= minCount && ai.length / n >= minShare) {
    result.push({ term: 'ai-generic', label: 'AI / LLM / neural networks as the headline topic', share: Math.round((ai.length / n) * 100) / 100, count: ai.length, sampleSize: n, exampleArticleIds: ai.slice(0, 5).map((a) => a.id) });
  }
  const counts = new Map<string, { surface: string; ids: string[] }>();
  for (const a of articles) {
    const seen = new Set<string>();
    for (const token of rawTokens(a.title)) {
      if (token.length < 3 || isStopword(token) || /^\d+$/.test(token)) continue;
      const s = stem(token);
      if (seen.has(s)) continue;
      seen.add(s);
      const entry = counts.get(s) ?? { surface: token, ids: [] };
      entry.ids.push(a.id);
      counts.set(s, entry);
    }
  }
  for (const [s, { surface, ids }] of [...counts].sort((x, y) => y[1].ids.length - x[1].ids.length || x[0].localeCompare(y[0]))) {
    if (ids.length < minCount || ids.length / n < minShare) continue;
    result.push({ term: s, label: `"${surface}" in the title`, share: Math.round((ids.length / n) * 100) / 100, count: ids.length, sampleSize: n, exampleArticleIds: ids.slice(0, 5) });
  }
  return result;
}
