import type { PlatformModule } from '../../platforms/schema.js';
import type { PlatformConfig } from '../config/schema.js';
import type { Clock } from '../shared/clock.js';
import { errorMessage } from '../shared/errors.js';
import type { Logger } from '../shared/logger.js';
import type { HttpClient } from './http.js';
import { computeMomentum, MOMENTUM_FORMULA } from './momentum.js';
import { extractObservations, saturatedAngles } from './patterns.js';
import { findLatestSnapshot, saveSnapshot, snapshotAgeHours } from './snapshot.js';
import { RESEARCH_SNAPSHOT_SCHEMA_VERSION, type ResearchSnapshot, type StructuralFeatures, type TrendArticle } from './types.js';

export interface ResearchRunOptions {
  platform: PlatformModule;
  platformConfig: PlatformConfig;
  researchDir: string;
  http: HttpClient;
  clock: Clock;
  logger: Logger;
  periods?: string[];
  hubs?: string[];
  maxArticlesPerPeriod?: number;
  save?: boolean;
  /** Stored structural features; those article bodies are not fetched again and the stored features are reused. */
  knownFeatures?: ReadonlyMap<string, StructuralFeatures>;
}

export interface ResearchRunResult {
  snapshot: ResearchSnapshot;
  files?: { json: string; md: string };
  /** Set when live collection failed and an earlier snapshot is returned instead. */
  fallback?: { reason: string; snapshotFile: string; ageHours: number };
}

/** Adds momentum, ranks, observations and saturation to collected articles. */
export function analyseArticles(articles: TrendArticle[], collectedAt: Date): { articles: TrendArticle[]; observationsWindow: string } {
  for (const a of articles) {
    const observed = a.observedAt ? new Date(a.observedAt) : collectedAt;
    const m = computeMomentum(a.metrics, a.publishedAt, observed);
    if (m) a.momentum = m;
  }
  [...articles].sort((a, b) => (b.metrics.views ?? -1) - (a.metrics.views ?? -1) || a.id.localeCompare(b.id)).forEach((a, i) => {
    if (a.metrics.views !== undefined) a.lifetimeRank = i + 1;
  });
  [...articles].filter((a) => a.momentum).sort((a, b) => b.momentum!.score - a.momentum!.score || a.id.localeCompare(b.id)).forEach((a, i) => {
    a.momentumRank = i + 1;
  });
  return { articles, observationsWindow: 'combined' };
}

export async function runTrendResearch(options: ResearchRunOptions): Promise<ResearchRunResult> {
  const { platform, platformConfig, clock, logger } = options;
  const strategy = platform.strategy;
  const now = clock.now();
  const periods = options.periods ?? platformConfig.periods ?? ['weekly'];
  const hubs = options.hubs ?? platformConfig.hubs ?? [];
  const maxArticlesPerPeriod = options.maxArticlesPerPeriod ?? platformConfig.maxArticlesPerPeriod ?? 30;

  if (!platform.research?.collectTrends) {
    const snapshot: ResearchSnapshot = {
      schemaVersion: RESEARCH_SNAPSHOT_SCHEMA_VERSION,
      platform: strategy.id,
      collectedAt: now.toISOString(),
      status: 'unsupported',
      windows: [],
      filters: { hubs, periods },
      sampleSize: 0,
      sources: [],
      failures: [],
      articles: [],
      observations: [],
      saturatedAngles: [],
      limitations: ['live research unsupported', ...strategy.research.limitations],
      momentumFormula: MOMENTUM_FORMULA,
    };
    logger.info(`${strategy.displayName}: live research unsupported. Import datasets with \`storyops research import\` instead.`);
    const result: ResearchRunResult = { snapshot };
    if (options.save !== false) result.files = await saveSnapshot(options.researchDir, snapshot);
    return result;
  }

  let collected;
  try {
    collected = await platform.research.collectTrends(
      { http: options.http, logger, clock, config: platformConfig },
      { periods, hubs, maxArticlesPerPeriod, fetchArticleBodies: platformConfig.fetchArticleBodies ?? true, ...(options.knownFeatures ? { knownFeatures: new Set(options.knownFeatures.keys()) } : {}) },
    );
  } catch (error) {
    return fallbackOrThrow(options, errorMessage(error));
  }
  if (collected.items.length === 0) {
    return fallbackOrThrow(options, collected.failures.map((f) => f.reason).join('; ') || 'no articles parsed');
  }

  const sourceTimes = new Map<string, string>();
  for (const s of collected.sources) if (s.window) sourceTimes.set(s.window, s.fetchedAt);
  for (const a of collected.items) a.observedAt ??= sourceTimes.get(a.seenIn[0] ?? '') ?? now.toISOString();
  for (const a of collected.items) if (!a.structure && options.knownFeatures?.has(a.id)) a.structure = options.knownFeatures.get(a.id)!;
  const { articles } = analyseArticles(collected.items, now);
  const observations = extractObservations(articles, periods.length === 1 ? periods[0]! : `combined ${periods.join('+')}`);
  const saturated = saturatedAngles(articles);

  const missingRating = articles.filter((a) => a.metrics.rating === undefined).length;
  const missingViews = articles.filter((a) => a.metrics.views === undefined).length;
  const withStructure = articles.filter((a) => a.structure).length;
  const limitations = [
    ...strategy.research.limitations,
    hubs.length ? `Only hubs ${hubs.join(', ')} were sampled; other hubs may behave differently.` : 'Sampled platform-wide top lists only.',
    `${missingRating} article(s) missing rating, ${missingViews} missing views.`,
    `${withStructure} of ${articles.length} article bodies parsed for structural features.`,
    'Momentum is a heuristic; observations describe this sample only and do not predict performance.',
  ];
  if (articles.length < 20) limitations.unshift(`Small sample (N=${articles.length}).`);
  if (collected.warnings.length) limitations.push(`Parser warnings: ${[...new Set(collected.warnings)].slice(0, 5).join('; ')}`);

  const fromCache = collected.sources.length > 0 && collected.sources.every((s) => s.fromCache);
  const anyStale = collected.sources.some((s) => s.stale);
  const status: ResearchSnapshot['status'] = collected.failures.length > 0 || anyStale ? 'partial' : fromCache ? 'cache' : 'live';
  const times = collected.sources.map((s) => s.fetchedAt).sort();
  const snapshot: ResearchSnapshot = {
    schemaVersion: RESEARCH_SNAPSHOT_SCHEMA_VERSION,
    platform: strategy.id,
    collectedAt: now.toISOString(),
    status,
    windows: collected.windows,
    filters: { hubs, periods, maxArticlesPerPeriod },
    sampleSize: articles.length,
    sources: collected.sources,
    failures: collected.failures,
    articles,
    observations,
    saturatedAngles: saturated,
    limitations,
    momentumFormula: MOMENTUM_FORMULA,
  };
  if (times[0]) snapshot.oldestSourceAt = times[0];
  logger.info(`${strategy.displayName} research: ${articles.length} articles, ${observations.length} observations, status ${status}.`);
  const result: ResearchRunResult = { snapshot };
  if (options.save !== false) result.files = await saveSnapshot(options.researchDir, snapshot);
  return result;
}

async function fallbackOrThrow(options: ResearchRunOptions, reason: string): Promise<ResearchRunResult> {
  const previous = await findLatestSnapshot(options.researchDir, options.platform.strategy.id);
  if (!previous) {
    const snapshot: ResearchSnapshot = {
      schemaVersion: RESEARCH_SNAPSHOT_SCHEMA_VERSION,
      platform: options.platform.strategy.id,
      collectedAt: options.clock.now().toISOString(),
      status: 'failed',
      windows: [],
      filters: { hubs: options.hubs ?? [], periods: options.periods ?? [] },
      sampleSize: 0,
      sources: [],
      failures: [{ stage: 'collect', reason }],
      articles: [],
      observations: [],
      saturatedAngles: [],
      limitations: ['Live research failed and no earlier snapshot exists.'],
      momentumFormula: MOMENTUM_FORMULA,
    };
    options.logger.warn(`Research failed (${reason}); no earlier snapshot available. No platform data was added.`);
    return { snapshot };
  }
  const ageHours = snapshotAgeHours(previous.snapshot, options.clock.now());
  options.logger.warn(`Research failed (${reason}). Using earlier snapshot ${previous.file} (${ageHours}h old).`);
  return { snapshot: previous.snapshot, fallback: { reason, snapshotFile: previous.file, ageHours } };
}
