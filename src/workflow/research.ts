import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { StoryDb } from '../db/database.js';
import { patternReport, saturationAll, saturationFor, topicLandscape, trendFor, windowEnding, type PatternReportItem, type TopicLandscapeRow } from '../platform/analytics.js';
import { renderPatterns, renderSaturation, renderTopicTrend, renderTrends } from '../platform/render.js';
import { articlesWithBodyFeatures, ensurePlatform, listRuns, recordResearchRun, type RecordRunResult, type RunOrigin, type RunSummary } from '../platform/store.js';
import { publicationMetricsSchema } from '../publications/schema.js';
import { MOMENTUM_FORMULA } from '../research/momentum.js';
import { extractObservations, saturatedAngles } from '../research/patterns.js';
import { analyseArticles, runTrendResearch, type ResearchRunResult } from '../research/runner.js';
import { titleFeatures } from '../research/structure.js';
import { RESEARCH_SNAPSHOT_SCHEMA_VERSION, structuralFeaturesSchema, type ResearchSnapshot, type TrendArticle } from '../research/types.js';
import { StoryOpsError } from '../shared/errors.js';
import { parseWithSchema, writeJson, writeText } from '../shared/fs.js';
import { sha256 } from '../shared/hash.js';
import { compileStoredTopics, loadTopics, recordTrendSnapshots, resolveTopic, tagPlatformArticles, type StoredTopic } from '../topics/registry.js';
import type { SaturationReport } from '../topics/saturation.js';
import type { TrendBasis, TrendReport } from '../topics/trends.js';
import { createHttpClient, db, saveDb, type AppContext } from './context.js';

/**
 * Platform research and platform intelligence workflows. Every run is
 * recorded in the database (history accumulates) and also written as a dated
 * report in .storyops/research/<date>/<platform>.{json,md}.
 */

function originOf(snapshot: ResearchSnapshot): RunOrigin {
  return snapshot.status === 'live' ? 'live' : snapshot.status === 'cache' ? 'cache' : 'partial';
}

/** Records a snapshot, tags topics and derives per-topic trend snapshots. */
export function ingestSnapshot(database: StoryDb, ctx: AppContext, snapshot: ResearchSnapshot, origin: RunOrigin, options: { label?: string; fingerprint?: string } = {}): RecordRunResult {
  const platform = ctx.registry.has(snapshot.platform) ? ctx.registry.get(snapshot.platform).strategy : { id: snapshot.platform, displayName: snapshot.platform, research: { liveResearch: 'unsupported' as const } };
  ensurePlatform(database, platform, ctx.clock.now().toISOString());
  const result = recordResearchRun(database, snapshot, { origin, ...options });
  if (!result.duplicate) {
    tagPlatformArticles(database, compileStoredTopics(loadTopics(database)), result.articleIds);
    recordTrendSnapshots(database, result.runId);
  }
  return result;
}

export interface PlatformResearchResult extends ResearchRunResult {
  run?: RecordRunResult;
}

export async function researchPlatformWorkflow(
  ctx: AppContext,
  platformId: string,
  options: { refresh?: boolean; offline?: boolean; periods?: string[]; hubs?: string[]; maxArticlesPerPeriod?: number } = {},
): Promise<PlatformResearchResult> {
  const platform = ctx.registry.get(platformId);
  const platformConfig = ctx.config.platforms[platformId] ?? { enabled: true };
  const database = await db(ctx);
  const http = createHttpClient(ctx, { refresh: options.refresh ?? false, offline: options.offline ?? false });
  const result: PlatformResearchResult = await runTrendResearch({
    platform,
    platformConfig,
    researchDir: ctx.workspace.researchDir,
    http,
    clock: ctx.clock,
    logger: ctx.logger,
    ...(options.refresh ? {} : { knownFeatures: articlesWithBodyFeatures(database, platformId) }),
    ...(options.periods ? { periods: options.periods } : {}),
    ...(options.hubs ? { hubs: options.hubs } : {}),
    ...(options.maxArticlesPerPeriod ? { maxArticlesPerPeriod: options.maxArticlesPerPeriod } : {}),
  });
  if (!result.fallback && result.snapshot.sampleSize > 0) {
    result.run = ingestSnapshot(database, ctx, result.snapshot, originOf(result.snapshot));
    ctx.logger.info(`Recorded research run #${result.run.runId}: ${result.run.newArticles} new article(s), ${result.run.seenAgain} seen again, ${result.run.featuresWritten} feature set(s) written, ${result.run.featuresUnchanged} unchanged.`);
  } else ensurePlatform(database, platform.strategy, ctx.clock.now().toISOString());
  await saveDb(ctx);
  return result;
}

// ------------------------------------------------------------------ import

/**
 * Import format for platforms without live research (or older data):
 * { schemaVersion: 1, platform, collectedAt, label?, articles: [{ id, url,
 * title, author?, publishedAt?, hubs?, tags?, metrics?, structure? }] }.
 * Only metadata, metrics and abstract features are accepted; there is no
 * field for article bodies.
 */
export const datasetSchema = z.object({
  schemaVersion: z.literal(1),
  platform: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  collectedAt: z.string().datetime({ offset: true }),
  label: z.string().optional(),
  window: z.string().optional(),
  articles: z.array(
    z.object({
      id: z.string().min(1),
      url: z.string().url(),
      title: z.string().min(1),
      author: z.string().optional(),
      publishedAt: z.string().datetime({ offset: true }).optional(),
      hubs: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
      metrics: publicationMetricsSchema.default({}),
      structure: structuralFeaturesSchema.optional(),
    }).strict(),
  ),
});
export type Dataset = z.infer<typeof datasetSchema>;

export function snapshotFromDataset(dataset: Dataset): ResearchSnapshot {
  const collectedAt = new Date(dataset.collectedAt);
  const window = dataset.window ?? 'imported';
  const articles: TrendArticle[] = dataset.articles.map((a) => {
    const t: TrendArticle = { id: a.id.includes(':') ? a.id : `${dataset.platform}:${a.id}`, platform: dataset.platform, url: a.url, title: a.title, hubs: a.hubs, tags: a.tags, metrics: a.metrics, seenIn: [window], titleFeatures: titleFeatures(a.title), warnings: [], observedAt: dataset.collectedAt };
    if (a.author) t.author = a.author;
    if (a.publishedAt) t.publishedAt = a.publishedAt;
    if (a.structure) t.structure = a.structure;
    return t;
  });
  analyseArticles(articles, collectedAt);
  return {
    schemaVersion: RESEARCH_SNAPSHOT_SCHEMA_VERSION,
    platform: dataset.platform,
    collectedAt: dataset.collectedAt,
    status: 'cache',
    windows: [{ id: window, period: window, url: 'import' }],
    filters: { hubs: [], periods: [window] },
    sampleSize: articles.length,
    sources: [],
    failures: [],
    articles,
    observations: extractObservations(articles, window),
    saturatedAngles: saturatedAngles(articles),
    limitations: [`Imported dataset${dataset.label ? ` "${dataset.label}"` : ''}; StoryOps did not collect it and cannot vouch for its sampling.`],
    momentumFormula: MOMENTUM_FORMULA,
  };
}

export async function importDatasetWorkflow(ctx: AppContext, file: string): Promise<{ run: RecordRunResult; snapshot: ResearchSnapshot }> {
  const raw = await readFile(file, 'utf8');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new StoryOpsError('DATASET_INVALID_JSON', `${file} is not valid JSON`, { cause: error });
  }
  const dataset = parseWithSchema(datasetSchema, data, file);
  const snapshot = snapshotFromDataset(dataset);
  const database = await db(ctx);
  const run = ingestSnapshot(database, ctx, snapshot, 'import', { label: dataset.label ?? path.basename(file), fingerprint: sha256(raw.replace(/\r\n?/g, '\n')) });
  await saveDb(ctx);
  return { run, snapshot };
}

// ----------------------------------------------------------------- history

export async function researchHistoryWorkflow(ctx: AppContext, options: { platform?: string; limit?: number } = {}): Promise<{ runs: RunSummary[]; articles: number; metricObservations: number }> {
  const database = await db(ctx);
  const runs = listRuns(database, options);
  const where = options.platform ? ' WHERE platform_id = ?' : '';
  const params = options.platform ? [options.platform] : [];
  return {
    runs,
    articles: database.value<number>(`SELECT COUNT(*) FROM platform_articles${where}`, params) ?? 0,
    metricObservations: database.value<number>(`SELECT COUNT(*) FROM platform_article_metrics m JOIN platform_articles a ON a.id = m.article_id${options.platform ? ' WHERE a.platform_id = ?' : ''}`, params) ?? 0,
  };
}

// ------------------------------------------------------ trends / saturation

function platformOrDefault(ctx: AppContext, platform?: string): string {
  const id = platform ?? ctx.config.research.defaultPlatform;
  ctx.registry.get(id);
  return id;
}

function requireTopic(topics: readonly StoredTopic[], query: string): StoredTopic {
  const id = resolveTopic(topics, query);
  const topic = id ? topics.find((t) => t.id === id) : undefined;
  if (!topic) throw new StoryOpsError('TOPIC_UNKNOWN', `Unknown topic "${query}"`, { hint: 'List topics with `storyops trends` or `storyops topics list`; add your own under "topics" in storyops.config.json.' });
  return topic;
}

async function reportFiles(ctx: AppContext, name: string, json: unknown, md: string): Promise<{ json: string; md: string }> {
  const files = { json: path.join(ctx.workspace.reportsDir, `${name}.json`), md: path.join(ctx.workspace.reportsDir, `${name}.md`) };
  await writeJson(files.json, json);
  await writeText(files.md, md);
  return files;
}

export interface TrendsResult {
  platform: string;
  window: { start: string; end: string; days: number };
  runs: number;
  rows: TopicLandscapeRow[];
  files: { json: string; md: string };
}

export async function trendsWorkflow(ctx: AppContext, options: { platform?: string; days?: number; limit?: number } = {}): Promise<TrendsResult> {
  const platform = platformOrDefault(ctx, options.platform);
  const database = await db(ctx);
  const days = options.days ?? ctx.config.analysis.windowDays;
  const end = ctx.clock.now();
  const rows = topicLandscape(database, platform, loadTopics(database), ctx.config.analysis, end, days).slice(0, options.limit ?? 50);
  const window = windowEnding(end, days);
  const runs = listRuns(database, { platform, limit: 1000 }).length;
  const files = await reportFiles(ctx, `trends-${platform}`, { platform, window, runs, rows }, renderTrends(platform, window, runs, rows));
  await saveDb(ctx);
  return { platform, window, runs, rows, files };
}

export async function topicTrendWorkflow(ctx: AppContext, query: string, options: { platform?: string; days?: number; windowDays?: number; basis?: TrendBasis; sinceDays?: number } = {}): Promise<{ topic: StoredTopic; saturation: SaturationReport; trend: TrendReport; files: { json: string; md: string } }> {
  const platform = platformOrDefault(ctx, options.platform);
  const database = await db(ctx);
  const topic = requireTopic(loadTopics(database), query);
  const end = ctx.clock.now();
  const saturation = saturationFor(database, platform, topic, windowEnding(end, options.days ?? ctx.config.analysis.windowDays), ctx.config.analysis);
  const trend = trendFor(database, platform, topic.id, ctx.config.analysis, { end, ...(options.windowDays ? { windowDays: options.windowDays } : {}), ...(options.basis ? { basis: options.basis } : {}), ...(options.sinceDays ? { sinceDays: options.sinceDays } : {}) });
  const files = await reportFiles(ctx, `trend-${platform}-${topic.id}`, { topic, saturation, trend }, renderTopicTrend(topic, saturation, trend));
  await saveDb(ctx);
  return { topic, saturation, trend, files };
}

export async function saturationWorkflow(ctx: AppContext, options: { platform?: string; topic?: string; days?: number } = {}): Promise<{ reports: SaturationReport[]; files: { json: string; md: string } }> {
  const platform = platformOrDefault(ctx, options.platform);
  const database = await db(ctx);
  const topics = loadTopics(database);
  const w = windowEnding(ctx.clock.now(), options.days ?? ctx.config.analysis.windowDays);
  const reports = options.topic ? [saturationFor(database, platform, requireTopic(topics, options.topic), w, ctx.config.analysis)] : saturationAll(database, platform, topics, w, ctx.config.analysis);
  const files = await reportFiles(ctx, `saturation-${platform}${options.topic ? `-${reports[0]!.topicId}` : ''}`, { platform, window: w, reports }, renderSaturation(platform, reports));
  await saveDb(ctx);
  return { reports, files };
}

export async function patternsWorkflow(ctx: AppContext, options: { platform?: string; runs?: number } = {}): Promise<{ platform: string; runId: number | null; collectedAt: string | null; items: PatternReportItem[]; files: { json: string; md: string } }> {
  const platform = platformOrDefault(ctx, options.platform);
  const database = await db(ctx);
  const report = patternReport(database, platform, options.runs ? { runs: options.runs } : {});
  const files = await reportFiles(ctx, `patterns-${platform}`, { platform, ...report }, renderPatterns(platform, report));
  await saveDb(ctx);
  return { platform, ...report, files };
}

/** Workspace topics (for `topics list`). */
export async function listTopicsWorkflow(ctx: AppContext): Promise<StoredTopic[]> {
  return loadTopics(await db(ctx));
}
