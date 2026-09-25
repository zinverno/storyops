import type { AnalysisConfig } from '../config/schema.js';
import { parseJson, type StoryDb } from '../db/database.js';
import type { StoredTopic } from '../topics/registry.js';
import { activityLevel, analyzeSaturation, type ActivityLevel, type SaturationReport, type WindowArticle } from '../topics/saturation.js';
import { trendDirection, type TrendBasis, type TrendObservation, type TrendReport } from '../topics/trends.js';

/**
 * Platform intelligence queries over the accumulated research history.
 * Windows are defined by article publication dates; trend history comes from
 * research runs (or publication dates when there are too few runs).
 */

const DAY = 86_400_000;

export interface Window {
  start: string;
  end: string;
  days: number;
}

export function windowEnding(end: Date, days: number): Window {
  return { start: new Date(end.getTime() - days * DAY).toISOString(), end: end.toISOString(), days };
}

export function previousWindow(w: Window): Window {
  const span = Date.parse(w.end) - Date.parse(w.start);
  return { start: new Date(Date.parse(w.start) - span).toISOString(), end: w.start, days: w.days };
}

/** Articles published in (start, end], with topics and their best momentum percentile across runs. */
export function windowArticles(db: StoryDb, platform: string, w: Pick<Window, 'start' | 'end'>): WindowArticle[] {
  const rows = db.all<{ id: string; title: string; author: string | null; published_at: string; topics: string | null }>(
    `SELECT a.id, a.title, a.author, a.published_at, GROUP_CONCAT(pat.topic_id, '|') AS topics
       FROM platform_articles a
       LEFT JOIN platform_article_topics pat ON pat.article_id = a.id
      WHERE a.platform_id = ? AND a.published_at IS NOT NULL AND a.published_at > ? AND a.published_at <= ?
      GROUP BY a.id ORDER BY a.published_at, a.id`,
    [platform, w.start, w.end],
  );
  const percentiles = momentumPercentiles(db, platform);
  return rows.map((r) => {
    const a: WindowArticle = { id: r.id, title: r.title, publishedAt: r.published_at, topics: r.topics ? r.topics.split('|') : [] };
    if (r.author) a.author = r.author;
    const p = percentiles.get(r.id);
    if (p !== undefined) a.momentumPercentile = p;
    return a;
  });
}

/** Best (highest) momentum percentile of each article across the runs it appeared in. */
function momentumPercentiles(db: StoryDb, platform: string): Map<string, number> {
  const rows = db.all<{ article_id: string; momentum_rank: number; scored: number }>(
    `SELECT ra.article_id, ra.momentum_rank,
            (SELECT COUNT(*) FROM research_run_articles x WHERE x.run_id = ra.run_id AND x.momentum_rank IS NOT NULL) AS scored
       FROM research_run_articles ra JOIN research_runs r ON r.id = ra.run_id
      WHERE r.platform_id = ? AND ra.momentum_rank IS NOT NULL`,
    [platform],
  );
  const out = new Map<string, number>();
  for (const r of rows) {
    const p = r.scored > 1 ? 1 - (r.momentum_rank - 1) / (r.scored - 1) : 1;
    out.set(r.article_id, Math.max(out.get(r.article_id) ?? 0, p));
  }
  return out;
}

export function saturationFor(db: StoryDb, platform: string, topic: Pick<StoredTopic, 'id' | 'label' | 'aliases'>, w: Window, analysis: AnalysisConfig, cache?: { current: WindowArticle[]; previous: WindowArticle[] }): SaturationReport {
  const prev = previousWindow(w);
  const current = cache?.current ?? windowArticles(db, platform, w);
  const previous = cache?.previous ?? windowArticles(db, platform, prev);
  return analyzeSaturation({ platform, topicId: topic.id, label: topic.label, aliases: topic.aliases, window: { start: w.start, end: w.end }, current, previous, thresholds: analysis.saturation });
}

/** Saturation of every topic that has at least one article in the window (sorted by share, then id). */
export function saturationAll(db: StoryDb, platform: string, topics: readonly StoredTopic[], w: Window, analysis: AnalysisConfig): SaturationReport[] {
  const current = windowArticles(db, platform, w);
  const previous = windowArticles(db, platform, previousWindow(w));
  const present = new Set(current.flatMap((a) => a.topics));
  return topics
    .filter((t) => present.has(t.id))
    .map((t) => saturationFor(db, platform, t, w, analysis, { current, previous }))
    .sort((a, b) => b.metrics.share - a.metrics.share || a.topicId.localeCompare(b.topicId));
}

/** Observations for trend direction: one per research run (topic count vs run sample). */
export function runObservations(db: StoryDb, platform: string, topicId: string, since?: string): TrendObservation[] {
  return db.all<{ collected_at: string; sample: number; count: number | null }>(
    `SELECT r.collected_at,
            (SELECT COUNT(*) FROM research_run_articles ra WHERE ra.run_id = r.id) AS sample,
            (SELECT t.article_count FROM trend_snapshots t WHERE t.run_id = r.id AND t.topic_id = ?) AS count
       FROM research_runs r
      WHERE r.platform_id = ? ${since ? 'AND r.collected_at > ?' : ''}
      ORDER BY r.collected_at`,
    [topicId, platform, ...(since ? [since] : [])],
  )
    .filter((r) => r.sample > 0)
    .map((r) => ({ at: r.collected_at, sample: r.sample, count: r.count ?? 0 }));
}

/** Observations from publication dates: one per article (count 1 when it carries the topic). */
export function publicationObservations(db: StoryDb, platform: string, topicId: string, since?: string): TrendObservation[] {
  return db.all<{ published_at: string; has_topic: number }>(
    `SELECT a.published_at, EXISTS(SELECT 1 FROM platform_article_topics p WHERE p.article_id = a.id AND p.topic_id = ?) AS has_topic
       FROM platform_articles a WHERE a.platform_id = ? AND a.published_at IS NOT NULL ${since ? 'AND a.published_at > ?' : ''}`,
    [topicId, platform, ...(since ? [since] : [])],
  ).map((r) => ({ at: r.published_at, sample: 1, count: r.has_topic ? 1 : 0 }));
}

export function trendFor(db: StoryDb, platform: string, topicId: string, analysis: AnalysisConfig, options: { end: Date; sinceDays?: number; basis?: TrendBasis; windowDays?: number }): TrendReport {
  const settings = { ...analysis.trends, ...(options.windowDays ? { windowDays: options.windowDays } : {}) };
  const since = options.sinceDays ? new Date(options.end.getTime() - options.sinceDays * DAY).toISOString() : undefined;
  const maxBuckets = options.sinceDays ? Math.ceil(options.sinceDays / settings.windowDays) : undefined;
  const common = { end: options.end.toISOString(), ...(maxBuckets ? { maxBuckets } : {}) };
  if (options.basis !== 'publication-dates') {
    const byRuns = trendDirection(runObservations(db, platform, topicId, since), settings, { basis: 'research-runs', ...common });
    if (options.basis === 'research-runs' || byRuns.direction !== 'insufficient-history') return byRuns;
  }
  return trendDirection(publicationObservations(db, platform, topicId, since), settings, { basis: 'publication-dates', ...common });
}

export interface TopicLandscapeRow {
  topicId: string;
  label: string;
  specificity: string;
  saturation: SaturationReport;
  activity: { level: ActivityLevel; reason: string };
  trend: TrendReport;
}

export function topicLandscape(db: StoryDb, platform: string, topics: readonly StoredTopic[], analysis: AnalysisConfig, end: Date, days = analysis.windowDays): TopicLandscapeRow[] {
  const w = windowEnding(end, days);
  const byId = new Map(topics.map((t) => [t.id, t]));
  return saturationAll(db, platform, topics, w, analysis).map((s) => ({
    topicId: s.topicId,
    label: s.label,
    specificity: byId.get(s.topicId)?.specificity ?? 'technology',
    saturation: s,
    activity: activityLevel(s, analysis.saturation),
    trend: trendFor(db, platform, s.topicId, analysis, { end }),
  }));
}

// ----------------------------------------------------------- pattern report

export interface PatternHistoryPoint {
  runId: number;
  collectedAt: string;
  topShare: number | null;
  restShare: number | null;
  strength: string;
  sampleSize: number;
}

export interface PatternReportItem {
  patternId: string;
  observation: string;
  strength: string;
  sampleSize: number;
  groupSize: number | null;
  comparisonSize: number | null;
  topShare: number | null;
  restShare: number | null;
  history: PatternHistoryPoint[];
  change: 'first-observed' | 'more-pronounced' | 'less-pronounced' | 'similar';
  examples: Array<{ id: string; url: string }>;
  possibleRelevance: string;
  limitations: string[];
  decision: 'left to the author';
}

/** What a pattern may mean for a human author; phrased as context, never as an instruction. */
const RELEVANCE: Record<string, string> = {
  'body-conflict-early': 'May be relevant when the article has a real engineering conflict; it says nothing about articles without one.',
  'body-technical-early': 'May be relevant when the article has concrete code or measurements to show.',
  'body-measurements': 'Only relevant when real measurements exist; never a reason to invent numbers.',
  'body-code': 'Relevant when code carries the argument.',
  'body-diagrams': 'Relevant when there is an architecture or flow worth drawing.',
  'body-before-after': 'Relevant for migration or refactoring stories.',
  'body-postmortem': 'Relevant for incident write-ups.',
  'body-next-steps': 'Relevant when there are real next steps.',
  'title-conflict': 'Describes how titles in the sample are framed; titles are the author’s decision.',
  'title-question': 'Describes title framing in the sample only.',
  'title-number': 'Describes title framing in the sample only.',
  'title-first-person': 'Describes title framing in the sample only.',
  'title-before-after': 'Describes title framing in the sample only.',
  'title-postmortem': 'Describes title framing in the sample only.',
  'title-how-to': 'Describes title framing in the sample only.',
  'title-ai': 'Indicates how much of the sample is framed around AI.',
};

export function patternReport(db: StoryDb, platform: string, options: { runs?: number } = {}): { runId: number | null; collectedAt: string | null; items: PatternReportItem[] } {
  const runs = db.all<{ id: number; collected_at: string }>('SELECT id, collected_at FROM research_runs WHERE platform_id = ? ORDER BY collected_at DESC, id DESC LIMIT ?', [platform, options.runs ?? 12]);
  const latest = runs.find((r) => (db.value<number>('SELECT COUNT(*) FROM pattern_observations WHERE run_id = ?', [r.id]) ?? 0) > 0);
  if (!latest) return { runId: null, collectedAt: null, items: [] };
  const rows = db.all<{ pattern_id: string; statement: string; strength: string; sample_size: number; group_size: number | null; comparison_size: number | null; top_share: number | null; rest_share: number | null; article_ids: string; limitations: string }>(
    'SELECT * FROM pattern_observations WHERE run_id = ? ORDER BY pattern_id',
    [latest.id],
  );
  const runIds = runs.map((r) => r.id);
  const items = rows.map((o) => {
    const history = db
      .all<{ run_id: number; collected_at: string; top_share: number | null; rest_share: number | null; strength: string; sample_size: number }>(
        `SELECT p.run_id, r.collected_at, p.top_share, p.rest_share, p.strength, p.sample_size FROM pattern_observations p JOIN research_runs r ON r.id = p.run_id
          WHERE p.pattern_id = ? AND p.run_id IN (${runIds.map(() => '?').join(',')}) ORDER BY r.collected_at`,
        [o.pattern_id, ...runIds],
      )
      .map((h) => ({ runId: h.run_id, collectedAt: h.collected_at, topShare: h.top_share, restShare: h.rest_share, strength: h.strength, sampleSize: h.sample_size }));
    const gap = (p: PatternHistoryPoint) => (p.topShare !== null && p.restShare !== null ? p.topShare - p.restShare : null);
    const first = history[0];
    const last = history.at(-1);
    let change: PatternReportItem['change'] = 'first-observed';
    if (history.length > 1 && first && last) {
      const g0 = gap(first);
      const g1 = gap(last);
      change = g0 === null || g1 === null ? 'similar' : Math.abs(g1) - Math.abs(g0) >= 0.1 ? 'more-pronounced' : Math.abs(g0) - Math.abs(g1) >= 0.1 ? 'less-pronounced' : 'similar';
    }
    const ids = parseJson<string[]>(o.article_ids, []).slice(0, 5);
    const examples = ids.map((id) => ({ id, url: db.value<string>('SELECT url FROM platform_articles WHERE id = ?', [id]) ?? '' }));
    const item: PatternReportItem = {
      patternId: o.pattern_id,
      observation: o.statement,
      strength: o.strength,
      sampleSize: o.sample_size,
      groupSize: o.group_size,
      comparisonSize: o.comparison_size,
      topShare: o.top_share,
      restShare: o.rest_share,
      history,
      change,
      examples,
      possibleRelevance: RELEVANCE[o.pattern_id] ?? 'Descriptive statistic of the sample.',
      limitations: parseJson(o.limitations, []),
      decision: 'left to the author',
    };
    return item;
  });
  return { runId: latest.id, collectedAt: latest.collected_at, items };
}
