import type { TrendSettings } from '../config/schema.js';

/**
 * Trend direction of a topic's share over time. Observations (research runs,
 * or article publication dates) are grouped into consecutive buckets of
 * `windowDays`, counted back from the end of the range. Buckets with fewer
 * than `minBucketSample` articles are ignored. With at least `minPoints`
 * usable buckets, the pooled share of the later half is compared with the
 * earlier half:
 *
 *   rising     relative change ≥ +changeThreshold and absolute change ≥ minAbsoluteChange
 *   declining  relative change ≤ −changeThreshold and absolute change ≥ minAbsoluteChange
 *   stable     otherwise
 *   insufficient-history  fewer than minPoints usable buckets, or fewer than
 *                         minTopicArticles topic articles in them
 *
 * The result describes movement in the samples; it does not imply a cause.
 */

export type TrendDirection = 'rising' | 'stable' | 'declining' | 'insufficient-history';
export type TrendBasis = 'research-runs' | 'publication-dates';

export interface TrendObservation {
  at: string;
  /** Topic articles in this observation. */
  count: number;
  /** All articles in this observation. */
  sample: number;
}

export interface TrendBucket {
  start: string;
  end: string;
  count: number;
  sample: number;
  share: number | null;
  usable: boolean;
}

export interface TrendReport {
  basis: TrendBasis;
  direction: TrendDirection;
  windowDays: number;
  timeRange: { from: string; to: string } | null;
  sampleSize: number;
  buckets: TrendBucket[];
  comparison: {
    earlier: { buckets: number; count: number; sample: number; share: number } | null;
    later: { buckets: number; count: number; sample: number; share: number } | null;
    relativeChange: number | null;
    absoluteChange: number | null;
  };
  because: string[];
}

const DAY = 86_400_000;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function trendDirection(observations: readonly TrendObservation[], settings: TrendSettings, options: { basis: TrendBasis; end?: string; maxBuckets?: number }): TrendReport {
  const w = settings.windowDays * DAY;
  const sorted = [...observations].filter((o) => !Number.isNaN(Date.parse(o.at))).sort((a, b) => a.at.localeCompare(b.at));
  const empty: TrendReport = { basis: options.basis, direction: 'insufficient-history', windowDays: settings.windowDays, timeRange: null, sampleSize: 0, buckets: [], comparison: { earlier: null, later: null, relativeChange: null, absoluteChange: null }, because: ['no observations'] };
  if (sorted.length === 0) return empty;
  const endMs = options.end ? Date.parse(options.end) : Date.parse(sorted.at(-1)!.at);
  const firstMs = Date.parse(sorted[0]!.at);
  const count = Math.min(options.maxBuckets ?? 52, Math.max(1, Math.ceil((endMs - firstMs + 1) / w)));
  const buckets: TrendBucket[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const bEnd = endMs - i * w;
    const bStart = bEnd - w;
    const inBucket = sorted.filter((o) => {
      const t = Date.parse(o.at);
      return t > bStart && t <= bEnd;
    });
    const c = inBucket.reduce((s, o) => s + o.count, 0);
    const n = inBucket.reduce((s, o) => s + o.sample, 0);
    buckets.push({ start: new Date(bStart).toISOString(), end: new Date(bEnd).toISOString(), count: c, sample: n, share: n ? r3(c / n) : null, usable: n >= settings.minBucketSample });
  }
  const usable = buckets.filter((b) => b.usable);
  const sampleSize = buckets.reduce((s, b) => s + b.sample, 0);
  const timeRange = { from: buckets[0]!.start, to: buckets.at(-1)!.end };
  if (usable.length < settings.minPoints) {
    return { ...empty, timeRange, sampleSize, buckets, because: [`${usable.length} usable ${settings.windowDays}-day bucket(s) with ≥ ${settings.minBucketSample} articles; at least ${settings.minPoints} are needed`] };
  }
  const topicArticles = usable.reduce((sum, b) => sum + b.count, 0);
  if (topicArticles < settings.minTopicArticles) {
    return { ...empty, timeRange, sampleSize, buckets, because: [`only ${topicArticles} topic article(s) in the usable buckets; at least ${settings.minTopicArticles} are needed for a direction`] };
  }
  const half = Math.floor(usable.length / 2);
  const earlierBuckets = usable.slice(0, half);
  const laterBuckets = usable.slice(usable.length - half);
  const pool = (bs: TrendBucket[]) => {
    const c = bs.reduce((s, b) => s + b.count, 0);
    const n = bs.reduce((s, b) => s + b.sample, 0);
    return { buckets: bs.length, count: c, sample: n, share: n ? r3(c / n) : 0 };
  };
  const earlier = pool(earlierBuckets);
  const later = pool(laterBuckets);
  const absoluteChange = r3(later.share - earlier.share);
  const relativeChange = earlier.share > 0 ? r3((later.share - earlier.share) / earlier.share) : later.share > 0 ? null : 0;
  let direction: TrendDirection = 'stable';
  const bigEnough = Math.abs(absoluteChange) >= settings.minAbsoluteChange;
  if (bigEnough && (relativeChange === null ? absoluteChange > 0 : relativeChange >= settings.changeThreshold)) direction = 'rising';
  else if (bigEnough && relativeChange !== null && relativeChange <= -settings.changeThreshold) direction = 'declining';
  const because = [
    `share ${pct(earlier.share)} in the earlier ${earlier.buckets} bucket(s) (${earlier.count}/${earlier.sample}) vs ${pct(later.share)} in the later ${later.buckets} (${later.count}/${later.sample})`,
    relativeChange === null ? 'topic absent from the earlier buckets' : `relative change ${relativeChange >= 0 ? '+' : ''}${pct(relativeChange)} (threshold ±${pct(settings.changeThreshold)}), absolute ${absoluteChange >= 0 ? '+' : ''}${pct(absoluteChange)} (minimum ${pct(settings.minAbsoluteChange)})`,
  ];
  return { basis: options.basis, direction, windowDays: settings.windowDays, timeRange, sampleSize, buckets, comparison: { earlier, later, relativeChange, absoluteChange }, because };
}
