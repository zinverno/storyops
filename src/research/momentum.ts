import type { PublicationMetrics } from '../publications/schema.js';
import { round } from './structure.js';
import type { Momentum } from './types.js';

/**
 * Heuristic momentum score. This is ONE advisory signal, not a quality score
 * and not a prediction. It exists so that a 12-hour-old article and a
 * year-old article are not compared by total views alone.
 *
 *   ageHours = max(1, collectedAt − publishedAt)
 *   ageDays  = max(0.25, ageHours / 24)
 *
 *   components (each only if the metric is present):
 *     viewVelocity     = log10(1 + views / ageHours)            weight 0.40
 *     ratingVelocity   = sign(r) · log10(1 + |rating| / ageDays) weight 0.25
 *     bookmarkVelocity = log10(1 + bookmarks / ageDays)          weight 0.20
 *     commentVelocity  = log10(1 + comments / ageDays)           weight 0.15
 *
 *   score    = Σ(weight · component) / Σ(weight of present components)
 *   coverage = Σ(weight of present components)
 *
 * Missing metrics are listed in `missing`; they are not treated as zero.
 * Scores are only comparable within one snapshot.
 */
export const MOMENTUM_FORMULA =
  'score = Σ(w·c)/Σw over present components; c: viewVelocity=log10(1+views/ageHours) w0.40, ratingVelocity=sign(r)·log10(1+|r|/ageDays) w0.25, bookmarkVelocity=log10(1+bookmarks/ageDays) w0.20, commentVelocity=log10(1+comments/ageDays) w0.15; ageHours=max(1,h), ageDays=max(0.25,ageHours/24). Missing metrics are excluded, not zeroed.';

const WEIGHTS = { viewVelocity: 0.4, ratingVelocity: 0.25, bookmarkVelocity: 0.2, commentVelocity: 0.15 } as const;

export function computeMomentum(metrics: PublicationMetrics, publishedAt: string | undefined, collectedAt: Date): Momentum | undefined {
  if (!publishedAt) return undefined;
  const published = Date.parse(publishedAt);
  if (Number.isNaN(published)) return undefined;
  const ageHours = Math.max(1, (collectedAt.getTime() - published) / 3_600_000);
  const ageDays = Math.max(0.25, ageHours / 24);
  const components: Record<string, number> = {};
  const missing: string[] = [];

  if (metrics.views !== undefined) components.viewVelocity = Math.log10(1 + metrics.views / ageHours);
  else missing.push('views');
  if (metrics.rating !== undefined) components.ratingVelocity = Math.sign(metrics.rating) * Math.log10(1 + Math.abs(metrics.rating) / ageDays);
  else missing.push('rating');
  if (metrics.bookmarks !== undefined) components.bookmarkVelocity = Math.log10(1 + metrics.bookmarks / ageDays);
  else missing.push('bookmarks');
  if (metrics.comments !== undefined) components.commentVelocity = Math.log10(1 + metrics.comments / ageDays);
  else missing.push('comments');

  let weighted = 0;
  let coverage = 0;
  for (const [name, value] of Object.entries(components)) {
    const weight = WEIGHTS[name as keyof typeof WEIGHTS];
    weighted += weight * value;
    coverage += weight;
  }
  if (coverage === 0) return { score: 0, ageHours: round(ageHours, 1), components: {}, missing, coverage: 0 };
  const rounded: Record<string, number> = {};
  for (const [k, v] of Object.entries(components)) rounded[k] = round(v, 4);
  return { score: round(weighted / coverage, 4), ageHours: round(ageHours, 1), components: rounded, missing, coverage: round(coverage, 2) };
}
