import { analyzeCollision, type CollisionReport } from '../collision/analyze.js';
import { renderCollision } from '../collision/render.js';
import { loadPublications } from '../publications/store.js';
import { runTrendResearch, type ResearchRunResult } from '../research/runner.js';
import { findLatestSnapshot, snapshotAgeHours } from '../research/snapshot.js';
import type { ResearchSnapshot } from '../research/types.js';
import { writeJson, writeText } from '../shared/fs.js';
import { loadContinuity } from './author.js';
import { createHttpClient, type AppContext } from './context.js';
import { loadNarrativeGap } from './project.js';

export async function researchWorkflow(
  ctx: AppContext,
  platformId: string,
  options: { refresh?: boolean; offline?: boolean; periods?: string[]; hubs?: string[]; maxArticlesPerPeriod?: number } = {},
): Promise<ResearchRunResult> {
  const platform = ctx.registry.get(platformId);
  const platformConfig = ctx.config.platforms[platformId] ?? { enabled: true };
  const http = createHttpClient(ctx, { refresh: options.refresh ?? false, offline: options.offline ?? false });
  return runTrendResearch({
    platform,
    platformConfig,
    researchDir: ctx.workspace.researchDir,
    http,
    clock: ctx.clock,
    logger: ctx.logger,
    ...(options.periods ? { periods: options.periods } : {}),
    ...(options.hubs ? { hubs: options.hubs } : {}),
    ...(options.maxArticlesPerPeriod ? { maxArticlesPerPeriod: options.maxArticlesPerPeriod } : {}),
  });
}

export async function latestSnapshots(ctx: AppContext, platformIds?: string[]): Promise<Array<{ snapshot: ResearchSnapshot; file: string; ageHours: number }>> {
  const ids = platformIds ?? ctx.registry.ids();
  const result = [];
  for (const id of ids) {
    const found = await findLatestSnapshot(ctx.workspace.researchDir, id);
    if (found) result.push({ ...found, ageHours: snapshotAgeHours(found.snapshot, ctx.clock.now()) });
  }
  return result;
}

export async function collisionWorkflow(ctx: AppContext, topic: string, options: { description?: string; projectId?: string; output?: { json: string; md: string } } = {}): Promise<CollisionReport> {
  const publications = await loadPublications(ctx.workspace);
  const continuity = await loadContinuity(ctx);
  const snapshots = (await latestSnapshots(ctx)).map((s) => s.snapshot);
  const projectId = options.projectId ?? (ctx.config.projects.length === 1 ? ctx.config.projects[0]!.id : undefined);
  const gap = projectId ? await loadNarrativeGap(ctx, projectId) : undefined;
  const report = analyzeCollision({
    topic,
    publications,
    snapshots,
    clock: ctx.clock,
    ...(options.description ? { description: options.description } : {}),
    ...(continuity ? { continuity } : {}),
    ...(gap ? { gap } : {}),
  });
  if (options.output) {
    await writeJson(options.output.json, report);
    await writeText(options.output.md, renderCollision(report));
  }
  return report;
}
