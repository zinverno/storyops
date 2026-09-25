import path from 'node:path';
import { buildAuthorProfile, authorProfileSchema, renderAuthorProfile, type AuthorProfile } from '../author/profile.js';
import { buildCoverageMap, COVERAGE_LABEL, coverageText, storeCoverage, type TopicCoverage } from '../author/coverage.js';
import { loadPublications, savePublications } from '../author/store.js';
import { buildContinuity } from '../continuity/build.js';
import { renderContinuityMarkdown } from '../continuity/render.js';
import type { ContinuityMap } from '../continuity/schema.js';
import { continuitySchema } from '../continuity/schema.js';
import { candidateForQuery } from '../opportunity/discover.js';
import type { OpportunityCandidate } from '../opportunity/types.js';
import { importMarkdownPublication } from '../publications/import.js';
import { buildPublicationIndex } from '../publications/index-builder.js';
import type { PublicationIndex } from '../publications/index-schema.js';
import type { Publication } from '../publications/schema.js';
import type { FailureRecord } from '../research/types.js';
import { repositoryTopicMap } from '../repo/store.js';
import { errorMessage } from '../shared/errors.js';
import { readJsonIfExists, writeJson, writeText } from '../shared/fs.js';
import { mdList, mdTable } from '../shared/markdown.js';
import { loadTopics, type StoredTopic } from '../topics/registry.js';
import { createHttpClient, db, saveDb, type AppContext } from './context.js';

export interface AuthorSyncResult {
  collected: number;
  added: number;
  updated: number;
  unchanged: number;
  byPlatform: Record<string, number>;
  failures: FailureRecord[];
  skipped: Array<{ platform: string; reason: string }>;
}

/** Collects the author's public publications from configured profiles with a live author-history adapter (Habr). */
export async function authorSync(ctx: AppContext, options: { platforms?: string[]; maxArticles?: number; refresh?: boolean; offline?: boolean } = {}): Promise<AuthorSyncResult> {
  const http = createHttpClient(ctx, { refresh: options.refresh ?? false, offline: options.offline ?? false });
  const database = await db(ctx);
  const result: AuthorSyncResult = { collected: 0, added: 0, updated: 0, unchanged: 0, byPlatform: {}, failures: [], skipped: [] };
  const profiles = Object.entries(ctx.config.author.profiles).filter(([platform]) => !options.platforms || options.platforms.includes(platform));
  if (profiles.length === 0) ctx.logger.warn('No author profiles configured (author.profiles). Import publications with `storyops author import`.');
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
      result.skipped.push({ platform: platformId, reason: 'no live author-history adapter; use `storyops author import`' });
      continue;
    }
    try {
      const collected = await module.research.collectAuthorHistory(url, { http, logger: ctx.logger, clock: ctx.clock, config: platformConfig }, { maxArticles: options.maxArticles ?? 100 });
      const saved = savePublications(database, collected.items);
      result.collected += collected.items.length;
      result.added += saved.added;
      result.updated += saved.updated;
      result.unchanged += saved.unchanged;
      result.byPlatform[platformId] = collected.items.length;
      result.failures.push(...collected.failures);
      ctx.logger.info(`${module.strategy.displayName}: ${collected.items.length} publication(s) (${saved.added} new, ${saved.updated} updated, ${saved.unchanged} unchanged).`);
    } catch (error) {
      result.failures.push({ stage: `author-history:${platformId}`, reason: errorMessage(error) });
      ctx.logger.warn(`${module.strategy.displayName}: author history failed: ${errorMessage(error)}`);
    }
  }
  await saveDb(ctx);
  return result;
}

/** Imports one of the author's own publications from Markdown (+ frontmatter). Drafts are not publications. */
export async function importPublication(ctx: AppContext, file: string, options: { platform?: string; url?: string; date?: string } = {}): Promise<{ publication: Publication; added: boolean }> {
  const publication = await importMarkdownPublication(file, { ...options, clock: ctx.clock });
  if (!ctx.registry.has(publication.platform)) ctx.logger.warn(`Platform "${publication.platform}" has no registered strategy; the publication is still stored in the archive.`);
  const saved = savePublications(await db(ctx), [publication]);
  await saveDb(ctx);
  return { publication, added: saved.added > 0 };
}

export interface MemoryArtifacts {
  publications: Publication[];
  index: PublicationIndex;
  continuity: ContinuityMap;
  profile: AuthorProfile;
  coverage: TopicCoverage[];
}

/** Latest repository change per topic (across configured projects), for "outdated" coverage. */
function latestRepoChanges(ctx: AppContext, topics: readonly StoredTopic[]): { changes: Map<string, string>; projectsByTopic: Map<string, string[]> } {
  const changes = new Map<string, string>();
  const projectsByTopic = new Map<string, string[]>();
  for (const project of ctx.config.projects) {
    for (const rt of repositoryTopicMap(ctx.database!, project.id, topics)) {
      if (!changes.has(rt.topicId) || rt.lastEventAt > changes.get(rt.topicId)!) changes.set(rt.topicId, rt.lastEventAt);
      projectsByTopic.set(rt.topicId, [...new Set([...(projectsByTopic.get(rt.topicId) ?? []), project.id])]);
    }
  }
  return { changes, projectsByTopic };
}

/** Rebuilds the publication index, continuity map, author profile and coverage map from the archive. */
export async function rebuildAuthorMemory(ctx: AppContext): Promise<MemoryArtifacts> {
  const database = await db(ctx);
  const publications = loadPublications(database);
  const index = buildPublicationIndex(publications, ctx.config.projects, ctx.clock);
  await writeJson(ctx.workspace.publicationIndex, index);
  const continuity = buildContinuity(index, ctx.config, ctx.clock);
  await writeJson(ctx.workspace.continuityJson, continuity);
  await writeText(ctx.workspace.continuityMd, renderContinuityMarkdown(continuity));
  const previous = await readJsonIfExists(ctx.workspace.authorProfileJson, authorProfileSchema);
  const profile = buildAuthorProfile(ctx.config, publications, index, continuity, ctx.clock, previous);
  await writeJson(ctx.workspace.authorProfileJson, profile);
  await writeText(ctx.workspace.authorProfileMd, renderAuthorProfile(profile));
  const topics = loadTopics(database);
  const { changes, projectsByTopic } = latestRepoChanges(ctx, topics);
  const coverage = buildCoverageMap(publications, topics, { now: ctx.clock.now(), outdatedAfterDays: ctx.config.analysis.outdatedAfterDays, latestRepoChange: changes, projectsByTopic });
  storeCoverage(database, coverage);
  await saveDb(ctx);
  ctx.logger.info(`Indexed ${publications.length} publication(s); coverage map, continuity map and author profile updated.`);
  return { publications, index, continuity, profile, coverage };
}

export async function loadContinuity(ctx: AppContext): Promise<ContinuityMap | undefined> {
  return readJsonIfExists(ctx.workspace.continuityJson, continuitySchema);
}

export interface CoverageResult {
  rows: TopicCoverage[];
  publications: number;
  files: { json: string; md: string };
}

/** Coverage map: every covered topic plus every project topic (covered or not). */
export async function coverageWorkflow(ctx: AppContext, options: { all?: boolean } = {}): Promise<CoverageResult> {
  const memory = await rebuildAuthorMemory(ctx);
  const rows = memory.coverage.filter((c) => options.all || c.level !== 'not-covered' || c.specificity === 'project');
  rows.sort((a, b) => a.label.localeCompare(b.label));
  const files = { json: path.join(ctx.workspace.authorDir, 'coverage.json'), md: path.join(ctx.workspace.authorDir, 'coverage.md') };
  await writeJson(files.json, { generatedAt: ctx.clock.now().toISOString(), publications: memory.publications.length, rows });
  await writeText(files.md, renderCoverage(rows, memory.publications.length));
  return { rows, publications: memory.publications.length, files };
}

export function renderCoverage(rows: readonly TopicCoverage[], publications: number): string {
  return [
    '# Author coverage map',
    '',
    `${publications} publication(s) in the archive. Levels: briefly mentioned < covered < deeply covered; "revisited" = covered in ≥ 2 publications; "possibly outdated" = older than the threshold or the repository changed since.`,
    '',
    mdTable(['Topic', 'Coverage', 'Publications', 'Last', 'Platform', 'Projects'], rows.map((c) => [c.label, coverageText(c), c.publications.length, c.lastCoveredAt?.slice(0, 10) ?? '—', c.lastPlatform ?? '—', c.relatedProjects.join(', ') || '—'])),
    '',
    '## Details',
    '',
    ...rows.filter((c) => c.publications.length).flatMap((c) => [`### ${c.label}`, '', mdList(c.publications.map((p) => `"${p.title}" (${p.platform}, ${p.date?.slice(0, 10) ?? 'undated'}): ${COVERAGE_LABEL[p.level]} — ${p.occurrences} mention(s)${p.inTitle ? ', in the title' : ''}${p.inHeading ? ', in a heading' : ''}`)), ...(c.outdatedReason ? ['', `Possibly outdated: ${c.outdatedReason}.`] : []), '']),
  ].join('\n');
}

/** Duplicate-topic detection: a candidate topic compared with the author's archive. */
export async function overlapWorkflow(ctx: AppContext, query: string, options: { projectId?: string } = {}): Promise<{ candidate: OpportunityCandidate; interpretation: string }> {
  const memory = await rebuildAuthorMemory(ctx);
  const database = await db(ctx);
  const topics = loadTopics(database);
  const project = options.projectId ? ctx.config.projects.find((p) => p.id === options.projectId) : ctx.config.projects.length === 1 ? ctx.config.projects[0] : undefined;
  const repoTopics = project ? repositoryTopicMap(database, project.id, topics) : [];
  const candidate = candidateForQuery({ repo: project ? { id: project.id, name: project.name } : null, repoTopics, topics, coverage: memory.coverage, publications: memory.publications, now: ctx.clock.now() }, query);
  return { candidate, interpretation: interpretOverlap(candidate) };
}

/** Deterministic interpretation sentence: what is covered versus what is new. */
export function interpretOverlap(c: OpportunityCandidate): string {
  const o = c.dimensions.authorOverlap.level;
  const newCount = c.author.genuinelyNew.filter((x) => !x.startsWith('Nothing on this topic')).length;
  if (o === 'none' && c.author.similar.length === 0) return 'The archive does not discuss this topic.';
  if (o === 'none') return `The topic itself is not in the archive, but "${c.author.similar[0]!.title}" shares vocabulary with it.`;
  if (newCount > 0) return `The general subject has been discussed (${c.author.coverageText}), but ${newCount} repository change(s) since then have not.`;
  return `The subject has been discussed (${c.author.coverageText}) and no newer repository changes were found for it.`;
}
