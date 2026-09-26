import type { SaturationThresholds } from '../config/schema.js';
import { isStopword } from '../shared/text.js';
import { stems } from './match.js';

/**
 * Topic saturation as a set of observable dimensions plus a qualitative
 * state derived from explicit rules. There is no hidden score: the report
 * lists every rule that was evaluated, with its numbers, and the first rule
 * that matched decides the state.
 *
 * States, in evaluation order:
 *   insufficient-data  fewer than `minSample` articles in the window
 *   highly-saturated   share ≥ highlySaturatedShare
 *   crowded            share ≥ crowdedShare
 *   emerging           ≥ 2 articles, share < emergingMaxShare and growth ≥ emergingGrowth
 *                      (or no articles in the previous window)
 *   active             share ≥ activeShare or ≥ activeCount articles
 *   sparse             otherwise
 *
 * A large share describes the sample, not the quality of a topic; reports
 * phrase it as "occupies a large share of the current sample".
 */

export type SaturationState = 'insufficient-data' | 'sparse' | 'emerging' | 'active' | 'crowded' | 'highly-saturated';

export interface WindowArticle {
  id: string;
  title: string;
  author?: string;
  publishedAt: string;
  topics: readonly string[];
  /** 0..1, 1 = highest heuristic momentum in its research run. */
  momentumPercentile?: number;
}

export interface SaturationInput {
  platform: string;
  topicId: string;
  label: string;
  /** Alias words of the topic, excluded when measuring headline repetition. */
  aliases?: readonly string[];
  window: { start: string; end: string };
  current: readonly WindowArticle[];
  previous: readonly WindowArticle[];
  thresholds: SaturationThresholds;
}

export interface RuleEvaluation {
  state: SaturationState;
  rule: string;
  matched: boolean;
}

export interface SaturationReport {
  platform: string;
  topicId: string;
  label: string;
  window: { start: string; end: string; days: number };
  previousWindow: { start: string; end: string };
  metrics: {
    articleCount: number;
    sampleSize: number;
    share: number;
    previousCount: number;
    previousSampleSize: number;
    previousShare: number;
    /** Relative change of the article count vs the previous window; null when the previous window had none. */
    growth: number | null;
    authorCount: number;
    /** Distinct authors / articles (1 = every article by a different author). */
    authorDiversity: number;
    /** Share of the topic's articles written by its most frequent author. */
    topAuthorShare: number;
    /** Mean pairwise Jaccard of title word stems, topic words excluded (0..1). */
    headlineRepetition: number;
    averageAgeDays: number;
    momentum: { scored: number; medianPercentile: number | null; inTopThird: number };
  };
  state: SaturationState;
  because: string[];
  rules: RuleEvaluation[];
  exampleArticleIds: string[];
  limitations: string[];
}

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

function titleWords(title: string, exclude: ReadonlySet<string>): Set<string> {
  return new Set(stems(title).filter((s) => s.length >= 3 && !isStopword(s) && !/^\d+$/.test(s) && !exclude.has(s)));
}

export function headlineRepetition(titles: readonly string[], aliases: readonly string[] = []): number {
  const exclude = new Set(aliases.flatMap((a) => stems(a)));
  const sets = titles.map((t) => titleWords(t, exclude)).filter((s) => s.size > 0);
  if (sets.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const a = sets[i]!;
      const b = sets[j]!;
      let inter = 0;
      for (const x of a) if (b.has(x)) inter += 1;
      total += inter / (a.size + b.size - inter);
      pairs += 1;
    }
  }
  return r2(total / pairs);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function analyzeSaturation(input: SaturationInput): SaturationReport {
  const t = input.thresholds;
  const start = Date.parse(input.window.start);
  const end = Date.parse(input.window.end);
  const days = Math.max(1, Math.round((end - start) / DAY));
  const topic = input.current.filter((a) => a.topics.includes(input.topicId));
  const prevTopic = input.previous.filter((a) => a.topics.includes(input.topicId));
  const sampleSize = input.current.length;
  const share = sampleSize ? topic.length / sampleSize : 0;
  const previousShare = input.previous.length ? prevTopic.length / input.previous.length : 0;
  const growth = prevTopic.length > 0 ? r2((topic.length - prevTopic.length) / prevTopic.length) : null;
  const authors = new Map<string, number>();
  for (const a of topic) authors.set(a.author ?? `unknown:${a.id}`, (authors.get(a.author ?? `unknown:${a.id}`) ?? 0) + 1);
  const scored = topic.filter((a) => a.momentumPercentile !== undefined).map((a) => a.momentumPercentile!);
  const metrics: SaturationReport['metrics'] = {
    articleCount: topic.length,
    sampleSize,
    share: r2(share),
    previousCount: prevTopic.length,
    previousSampleSize: input.previous.length,
    previousShare: r2(previousShare),
    growth,
    authorCount: authors.size,
    authorDiversity: topic.length ? r2(authors.size / topic.length) : 0,
    topAuthorShare: topic.length ? r2(Math.max(...authors.values()) / topic.length) : 0,
    headlineRepetition: headlineRepetition(topic.map((a) => a.title), [input.label, ...(input.aliases ?? [])]),
    averageAgeDays: topic.length ? Math.round((topic.reduce((s, a) => s + (end - Date.parse(a.publishedAt)), 0) / topic.length / DAY) * 10) / 10 : 0,
    momentum: { scored: scored.length, medianPercentile: scored.length ? r2(median(scored)!) : null, inTopThird: scored.filter((p) => p >= 2 / 3).length },
  };

  const growing = growth === null ? prevTopic.length === 0 && input.previous.length > 0 : growth >= t.emergingGrowth;
  const rules: Array<RuleEvaluation & { why: string }> = [
    { state: 'insufficient-data', rule: `window sample < ${t.minSample} articles`, matched: sampleSize < t.minSample, why: `only ${sampleSize} article(s) in the ${days}-day window (minimum ${t.minSample})` },
    { state: 'highly-saturated', rule: `share ≥ ${pct(t.highlySaturatedShare)}`, matched: share >= t.highlySaturatedShare, why: `${topic.length} of ${sampleSize} articles (${pct(share)}) in the window` },
    { state: 'crowded', rule: `share ≥ ${pct(t.crowdedShare)}`, matched: share >= t.crowdedShare, why: `${topic.length} of ${sampleSize} articles (${pct(share)}) in the window` },
    {
      state: 'emerging',
      rule: `≥ 2 articles, share < ${pct(t.emergingMaxShare)}, growth ≥ +${pct(t.emergingGrowth)} (or absent from the previous window)`,
      matched: topic.length >= 2 && share < t.emergingMaxShare && growing,
      why: `${topic.length} article(s) now vs ${prevTopic.length} in the previous window${growth !== null ? ` (${growth >= 0 ? '+' : ''}${pct(growth)})` : ''}`,
    },
    { state: 'active', rule: `share ≥ ${pct(t.activeShare)} or ≥ ${t.activeCount} articles`, matched: share >= t.activeShare || topic.length >= t.activeCount, why: `${topic.length} article(s), ${pct(share)} of the window sample` },
    { state: 'sparse', rule: 'none of the above', matched: true, why: `${topic.length} article(s), ${pct(share)} of the window sample` },
  ];
  const decisive = rules.find((r) => r.matched)!;
  const because = [decisive.why];
  if (decisive.state !== 'insufficient-data') {
    because.push(`${metrics.authorCount} distinct author(s)`);
    if (growth !== null) because.push(`${growth >= 0 ? '+' : ''}${pct(growth)} articles vs the previous ${days}-day window (${prevTopic.length} → ${topic.length})`);
    else if (input.previous.length > 0) because.push(`no articles on this topic in the previous ${days}-day window`);
    else because.push('no data for the previous window');
    if (metrics.headlineRepetition >= 0.2) because.push(`headline repetition ${metrics.headlineRepetition} (titles share many words beyond the topic name)`);
  }
  const limitations = [
    'Counts come from research samples (platform top lists and imported datasets), not from every article on the platform.',
    'Topics are matched lexically in titles, hubs and tags; misclassification is possible.',
    'A large share describes the sample; it says nothing about the quality or value of the topic.',
  ];
  if (sampleSize < 40) limitations.unshift(`Small window sample (N=${sampleSize}).`);
  return {
    platform: input.platform,
    topicId: input.topicId,
    label: input.label,
    window: { start: input.window.start, end: input.window.end, days },
    previousWindow: { start: new Date(start - (end - start)).toISOString(), end: input.window.start },
    metrics,
    state: decisive.state,
    because,
    rules: rules.map(({ state, rule, matched }) => ({ state, rule, matched })),
    exampleArticleIds: topic.slice(0, 5).map((a) => a.id),
    limitations,
  };
}

export type ActivityLevel = 'unknown' | 'low' | 'medium' | 'high';

/**
 * Current platform activity, derived from the saturation state so the two
 * never disagree: sparse → low, emerging/active → medium, crowded/highly
 * saturated → high, insufficient data → unknown.
 */
export function activityLevel(report: Pick<SaturationReport, 'state' | 'metrics'>, _thresholds?: SaturationThresholds): { level: ActivityLevel; reason: string } {
  const m = report.metrics;
  const counts = `${m.articleCount} article(s), ${pct(m.share)} of the window sample`;
  switch (report.state) {
    case 'insufficient-data':
      return { level: 'unknown', reason: `insufficient platform data (${m.sampleSize} articles in window)` };
    case 'sparse':
      return { level: 'low', reason: counts };
    case 'emerging':
    case 'active':
      return { level: 'medium', reason: counts };
    default:
      return { level: 'high', reason: counts };
  }
}
