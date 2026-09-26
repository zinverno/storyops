import { mdList, mdTable } from '../shared/markdown.js';
import type { StoredTopic } from '../topics/registry.js';
import type { SaturationReport } from '../topics/saturation.js';
import type { TrendReport } from '../topics/trends.js';
import type { PatternReportItem, TopicLandscapeRow } from './analytics.js';

/** Markdown reports for platform intelligence. Popularity is never presented as quality. */

const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n * 100)}%`);
const d = (iso?: string | null) => (iso ? iso.slice(0, 10) : '—');

const CAVEAT = '> Descriptive statistics of research samples (platform top lists and imported datasets). A large share is not a verdict on a topic, and momentum is not quality.';

export function renderTrends(platform: string, window: { start: string; end: string; days: number }, runs: number, rows: readonly TopicLandscapeRow[]): string {
  return [
    `# Topic landscape — ${platform}`,
    '',
    `Window: ${d(window.start)} → ${d(window.end)} (${window.days} days). Research runs in history: ${runs}.`,
    '',
    CAVEAT,
    '',
    rows.length
      ? mdTable(
          ['Topic', 'Articles', 'Share', 'Authors', 'Saturation', 'Activity', 'Trend', 'Trend basis'],
          rows.map((r) => [r.label, `${r.saturation.metrics.articleCount}/${r.saturation.metrics.sampleSize}`, pct(r.saturation.metrics.share), r.saturation.metrics.authorCount, r.saturation.state, r.activity.level, r.trend.direction, r.trend.basis]),
        )
      : '_No articles with publication dates in this window. Run `storyops research platform <id>` or import a dataset._',
    '',
    '## Why each state',
    '',
    mdList(rows.map((r) => `**${r.label}** — ${r.saturation.state}: ${r.saturation.because.join('; ')}. Trend ${r.trend.direction}: ${r.trend.because.join('; ')}`)),
    '',
  ].join('\n');
}

export function renderSaturationBlock(s: SaturationReport): string[] {
  const m = s.metrics;
  return [
    `## ${s.label} (\`${s.topicId}\`): ${s.state}`,
    '',
    `Because: ${s.because.join('; ')}.`,
    '',
    mdTable(
      ['Dimension', 'Value'],
      [
        ['articles in window', `${m.articleCount} of ${m.sampleSize}`],
        ['article share', pct(m.share)],
        ['previous window', `${m.previousCount} of ${m.previousSampleSize} (${pct(m.previousShare)})`],
        ['growth vs previous window', m.growth === null ? '—' : `${m.growth >= 0 ? '+' : ''}${pct(m.growth)}`],
        ['distinct authors', `${m.authorCount} (diversity ${m.authorDiversity})`],
        ['top-author concentration', pct(m.topAuthorShare)],
        ['headline repetition', m.headlineRepetition],
        ['average age (days)', m.averageAgeDays],
        ['momentum distribution', m.momentum.scored ? `median percentile ${pct(m.momentum.medianPercentile)}, ${m.momentum.inTopThird}/${m.momentum.scored} in the top third` : '—'],
      ],
    ),
    '',
    'Rules (first match decides):',
    '',
    mdList(s.rules.map((r) => `${r.matched ? '✓' : '·'} ${r.state}: ${r.rule}`)),
    '',
    `Window ${d(s.window.start)} → ${d(s.window.end)}; previous window ${d(s.previousWindow.start)} → ${d(s.previousWindow.end)}. Examples: ${s.exampleArticleIds.join(', ') || '—'}.`,
    '',
    'Limitations:',
    '',
    mdList(s.limitations),
    '',
  ];
}

export function renderSaturation(platform: string, reports: readonly SaturationReport[]): string {
  return [`# Topic saturation — ${platform}`, '', CAVEAT, '', ...(reports.length ? reports.flatMap(renderSaturationBlock) : ['_No topics in this window._', ''])].join('\n');
}

export function renderTrendBlock(t: TrendReport): string[] {
  return [
    `Trend direction: **${t.direction}** (basis: ${t.basis}, ${t.windowDays}-day buckets, time range ${d(t.timeRange?.from)} → ${d(t.timeRange?.to)}, sample ${t.sampleSize}).`,
    '',
    mdList(t.because),
    '',
    t.buckets.length ? mdTable(['Bucket', 'Topic articles', 'Sample', 'Share', 'Used'], t.buckets.map((b) => [`${d(b.start)} → ${d(b.end)}`, b.count, b.sample, pct(b.share), b.usable ? 'yes' : 'no (too small)'])) : '_no data_',
    '',
    'Comparison window: later half of the usable buckets vs the earlier half. The direction describes the samples and implies no cause.',
    '',
  ];
}

export function renderTopicTrend(topic: StoredTopic, saturation: SaturationReport, trend: TrendReport): string {
  return [`# ${topic.label} — ${saturation.platform}`, '', CAVEAT, '', ...renderTrendBlock(trend), ...renderSaturationBlock(saturation)].join('\n');
}

export function renderPatterns(platform: string, report: { runId: number | null; collectedAt: string | null; items: readonly PatternReportItem[] }): string {
  const out = [
    `# Pattern report — ${platform}`,
    '',
    report.runId ? `Latest research run with observations: #${report.runId} (${report.collectedAt}).` : '_No research run with pattern observations yet._',
    '',
    '> Observed structure, framing, density and placement in the sample. Patterns are never applied to your article automatically, and titles, openings or phrasing of other authors are never reused. Decision: left to the author.',
    '',
  ];
  for (const p of report.items) {
    out.push(
      `## ${p.patternId}`,
      '',
      `Observed pattern: ${p.observation}`,
      '',
      `Strength: ${p.strength}. Sample: ${p.sampleSize}${p.groupSize !== null ? ` (${p.groupSize} higher-momentum vs ${p.comparisonSize} others)` : ''}.`,
      `Change over time: ${p.change}${p.history.length > 1 ? ` (${p.history.map((h) => `${d(h.collectedAt)}: ${pct(h.topShare)} vs ${pct(h.restShare)}`).join('; ')})` : ''}.`,
      `Examples: ${p.examples.map((e) => e.url || e.id).join(', ') || '—'}`,
      '',
      `Possible relevance: ${p.possibleRelevance}`,
      '',
      'Decision: left to the author.',
      '',
    );
  }
  return out.join('\n');
}
