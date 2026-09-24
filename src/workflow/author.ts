import { buildAuthorProfile, authorProfileSchema, renderAuthorProfile, type AuthorProfile } from '../author/profile.js';
import { buildContinuity } from '../continuity/build.js';
import { renderContinuityMarkdown } from '../continuity/render.js';
import type { ContinuityMap } from '../continuity/schema.js';
import { continuitySchema } from '../continuity/schema.js';
import { importMarkdownPublication } from '../publications/import.js';
import { buildPublicationIndex } from '../publications/index-builder.js';
import { publicationIndexSchema, type PublicationIndex } from '../publications/index-schema.js';
import type { Publication } from '../publications/schema.js';
import { loadPublications, savePublication } from '../publications/store.js';
import { EditorialError, errorMessage } from '../shared/errors.js';
import { readJsonIfExists, writeJson, writeText } from '../shared/fs.js';
import type { FailureRecord } from '../research/types.js';
import { createHttpClient, type AppContext } from './context.js';

export interface AuthorSyncResult {
  collected: number;
  byPlatform: Record<string, number>;
  failures: FailureRecord[];
  skipped: Array<{ platform: string; reason: string }>;
}

/** Collects the author's public publications from every configured profile with an author-history adapter. */
export async function authorSync(ctx: AppContext, options: { platforms?: string[]; maxArticles?: number; refresh?: boolean; offline?: boolean } = {}): Promise<AuthorSyncResult> {
  const http = createHttpClient(ctx, { refresh: options.refresh ?? false, offline: options.offline ?? false });
  const result: AuthorSyncResult = { collected: 0, byPlatform: {}, failures: [], skipped: [] };
  const profiles = Object.entries(ctx.config.author.profiles).filter(([platform]) => !options.platforms || options.platforms.includes(platform));
  if (profiles.length === 0) ctx.logger.warn('No author profiles configured (author.profiles). Import publications with `editorial-kit author import`.');
  for (const [platformId, url] of profiles) {
    if (!ctx.registry.has(platformId)) {
      result.skipped.push({ platform: platformId, reason: 'no registered platform with this id' });
      continue;
    }
    const module = ctx.registry.get(platformId);
    const platformConfig = ctx.config.platforms[platformId] ?? { enabled: true };
    if (platformConfig.enabled === false) {
      result.skipped.push({ platform: platformId, reason: 'disabled in config' });
      continue;
    }
    if (!module.research?.collectAuthorHistory) {
      result.skipped.push({ platform: platformId, reason: 'no live author-history adapter; use `editorial-kit author import`' });
      continue;
    }
    try {
      const collected = await module.research.collectAuthorHistory(url, { http, logger: ctx.logger, clock: ctx.clock, config: platformConfig }, { maxArticles: options.maxArticles ?? 100 });
      for (const pub of collected.items) await savePublication(ctx.workspace, pub);
      result.collected += collected.items.length;
      result.byPlatform[platformId] = collected.items.length;
      result.failures.push(...collected.failures);
      ctx.logger.info(`${module.strategy.displayName}: stored ${collected.items.length} publication(s).`);
    } catch (error) {
      result.failures.push({ stage: `author-history:${platformId}`, reason: errorMessage(error) });
      ctx.logger.warn(`${module.strategy.displayName}: author history failed: ${errorMessage(error)}`);
    }
  }
  return result;
}

export async function importPublication(ctx: AppContext, file: string, options: { platform?: string; url?: string; date?: string } = {}): Promise<{ publication: Publication; file: string }> {
  const publication = await importMarkdownPublication(file, { ...options, clock: ctx.clock });
  if (!ctx.registry.has(publication.platform)) {
    ctx.logger.warn(`Platform "${publication.platform}" has no registered strategy; the publication is still stored for continuity.`);
  }
  const stored = await savePublication(ctx.workspace, publication);
  return { publication, file: stored };
}

export interface MemoryArtifacts {
  publications: Publication[];
  index: PublicationIndex;
  continuity: ContinuityMap;
  profile: AuthorProfile;
}

/** Rebuilds the publication index, continuity map and author profile from stored publications. */
export async function rebuildAuthorMemory(ctx: AppContext): Promise<MemoryArtifacts> {
  const publications = await loadPublications(ctx.workspace);
  const index = buildPublicationIndex(publications, ctx.config.projects, ctx.clock);
  await writeJson(ctx.workspace.publicationIndex, index);
  const continuity = buildContinuity(index, ctx.config, ctx.clock);
  await writeJson(ctx.workspace.continuityJson, continuity);
  await writeText(ctx.workspace.continuityMd, renderContinuityMarkdown(continuity));
  const previous = await readJsonIfExists(ctx.workspace.authorProfileJson, authorProfileSchema);
  const profile = buildAuthorProfile(ctx.config, publications, index, continuity, ctx.clock, previous);
  await writeJson(ctx.workspace.authorProfileJson, profile);
  await writeText(ctx.workspace.authorProfileMd, renderAuthorProfile(profile));
  ctx.logger.info(`Indexed ${publications.length} publication(s); continuity map and author profile updated.`);
  return { publications, index, continuity, profile };
}

export async function loadContinuity(ctx: AppContext): Promise<ContinuityMap | undefined> {
  return readJsonIfExists(ctx.workspace.continuityJson, continuitySchema);
}

export async function loadIndex(ctx: AppContext): Promise<PublicationIndex | undefined> {
  return readJsonIfExists(ctx.workspace.publicationIndex, publicationIndexSchema);
}

export async function requireContinuity(ctx: AppContext): Promise<ContinuityMap> {
  const existing = await loadContinuity(ctx);
  if (existing) return existing;
  const publications = await loadPublications(ctx.workspace);
  if (publications.length === 0) {
    throw new EditorialError('NO_PUBLICATIONS', 'No publications stored yet.', { hint: 'Run `editorial-kit author sync` or `editorial-kit author import <file>` first.' });
  }
  return (await rebuildAuthorMemory(ctx)).continuity;
}
