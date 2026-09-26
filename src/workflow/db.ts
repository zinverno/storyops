import path from 'node:path';
import { copyFile } from 'node:fs/promises';
import { databaseFileSize, openDatabase } from '../db/database.js';
import { loadMigrations } from '../db/migrate.js';
import { loadEvents, mapRepositoryTopics } from '../repo/store.js';
import { StoryOpsError } from '../shared/errors.js';
import { ensureDir, pathExists } from '../shared/fs.js';
import { compileStoredTopics, loadTopics, recordTrendSnapshots, syncTopics, tagPlatformArticles, workspaceTopics } from '../topics/registry.js';
import { rebuildAuthorMemory } from './author.js';
import { db, saveDb, type AppContext } from './context.js';

export const TABLES = [
  'platforms',
  'research_runs',
  'platform_articles',
  'research_run_articles',
  'platform_article_metrics',
  'platform_article_features',
  'pattern_observations',
  'topics',
  'platform_article_topics',
  'trend_snapshots',
  'authors',
  'author_profiles',
  'author_publications',
  'author_topic_coverage',
  'repositories',
  'repository_snapshots',
  'repository_events',
  'repository_evidence',
  'repository_topics',
  'topic_candidates',
  'topic_opportunities',
  'topic_overlap',
  'reviews',
  'review_findings',
  'review_suggestions',
  'review_decisions',
] as const;

export interface DbStatus {
  file: string;
  exists: boolean;
  bytes?: number;
  version: number;
  latest: number;
  pending: string[];
  applied: Array<{ version: number; name: string; appliedAt: string }>;
}

/** Inspects the database without migrating it. */
export async function dbStatusWorkflow(ctx: AppContext): Promise<DbStatus> {
  const file = ctx.workspace.dbFile;
  const migrations = loadMigrations();
  const latest = migrations.at(-1)?.version ?? 0;
  if (!pathExists(file)) return { file, exists: false, version: 0, latest, pending: migrations.map((m) => `${String(m.version).padStart(3, '0')}-${m.name}`), applied: [] };
  const { db: database } = await openDatabase(file, { readOnly: true });
  const applied = database.migrations();
  database.close();
  const version = applied.at(-1)?.version ?? 0;
  const bytes = await databaseFileSize(file);
  return { file, exists: true, ...(bytes !== undefined ? { bytes } : {}), version, latest, pending: migrations.filter((m) => m.version > version).map((m) => `${String(m.version).padStart(3, '0')}-${m.name}`), applied: applied.map((a) => ({ version: a.version, name: a.name, appliedAt: a.appliedAt })) };
}

export async function dbStatsWorkflow(ctx: AppContext): Promise<Record<string, number>> {
  const database = await db(ctx);
  await saveDb(ctx);
  return Object.fromEntries(TABLES.map((t) => [t, database.value<number>(`SELECT COUNT(*) FROM ${t}`) ?? 0]));
}

export async function dbVacuumWorkflow(ctx: AppContext): Promise<{ before?: number; after?: number }> {
  const database = await db(ctx);
  const before = await databaseFileSize(ctx.workspace.dbFile);
  database.vacuum();
  await database.save();
  const after = await databaseFileSize(ctx.workspace.dbFile);
  return { ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) };
}

export async function dbBackupWorkflow(ctx: AppContext, target?: string): Promise<string> {
  if (!pathExists(ctx.workspace.dbFile)) throw new StoryOpsError('DB_NOT_FOUND', 'No database to back up yet.');
  await saveDb(ctx);
  const dest = target ? path.resolve(target) : path.join(ctx.workspace.backupsDir, `storyops-${ctx.clock.now().toISOString().replace(/[:.]/g, '-')}.db`);
  await ensureDir(path.dirname(dest));
  await copyFile(ctx.workspace.dbFile, dest);
  return dest;
}

/**
 * Recomputes every DERIVED table from the stored base data (articles, runs,
 * publications, repository events): topic links, trend snapshots, author
 * coverage and the repository topic map. Base data is never deleted.
 */
export async function dbRebuildWorkflow(ctx: AppContext): Promise<{ articleTopicLinks: number; trendSnapshots: number; coverageRows: number; repositoryTopicLinks: number }> {
  const database = await db(ctx);
  const now = ctx.clock.now().toISOString();
  syncTopics(database, workspaceTopics(ctx.config), now);
  const links = tagPlatformArticles(database, compileStoredTopics(loadTopics(database)));
  let snapshots = 0;
  for (const r of database.all<{ id: number }>('SELECT id FROM research_runs ORDER BY id')) snapshots += recordTrendSnapshots(database, r.id);
  let repoLinks = 0;
  for (const r of database.all<{ id: string }>('SELECT id FROM repositories')) repoLinks += mapRepositoryTopics(database, r.id, loadEvents(database, r.id), workspaceTopics(ctx.config), now).links.length;
  await rebuildAuthorMemory(ctx);
  await saveDb(ctx);
  return { articleTopicLinks: links, trendSnapshots: snapshots, coverageRows: database.value<number>('SELECT COUNT(*) FROM author_topic_coverage') ?? 0, repositoryTopicLinks: repoLinks };
}
