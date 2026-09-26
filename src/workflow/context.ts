import path from 'node:path';
import { createDefaultRegistry, type PlatformRegistry } from '../../platforms/registry.js';
import { loadConfig, resolveConfigFile } from '../config/load.js';
import type { StoryOpsConfig } from '../config/schema.js';
import { openDatabase, type OpenResult, type StoryDb } from '../db/database.js';
import { HttpCache } from '../research/cache.js';
import { HttpClient } from '../research/http.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { createLogger, type Logger } from '../shared/logger.js';
import { resolveWorkspace, type WorkspacePaths } from '../shared/workspace.js';
import { syncTopics, workspaceTopics } from '../topics/registry.js';
import { ensureAuthor } from '../author/store.js';

export interface AppContext {
  workspace: WorkspacePaths;
  config: StoryOpsConfig;
  configWarnings: string[];
  registry: PlatformRegistry;
  clock: Clock;
  logger: Logger;
  /** Injected fetch (tests); defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Open database (lazily opened by `db(ctx)`). */
  database?: StoryDb;
  dbOpen?: Omit<OpenResult, 'db'>;
}

export interface ContextOptions {
  root?: string;
  configFile?: string;
  clock?: Clock;
  logger?: Logger;
  registry?: PlatformRegistry;
  fetchImpl?: typeof fetch;
}

export function workspaceFor(root: string, config: StoryOpsConfig, configFile: string): WorkspacePaths {
  return resolveWorkspace(root, {
    configFile,
    dataDir: config.paths.dataDir,
    topicsDir: config.paths.topicsDir,
    reviewsDir: config.paths.reviewsDir,
    legacyDir: config.paths.editorialDir,
    ...(config.database.file ? { dbFile: config.database.file } : {}),
  });
}

export async function loadContext(options: ContextOptions = {}): Promise<AppContext> {
  const root = path.resolve(options.root ?? process.cwd());
  const { file } = resolveConfigFile(root, options.configFile);
  const { config, warnings } = await loadConfig(file);
  const logger = options.logger ?? createLogger();
  for (const w of warnings) logger.warn(w);
  const ctx: AppContext = {
    workspace: workspaceFor(root, config, file),
    config,
    configWarnings: warnings,
    registry: options.registry ?? createDefaultRegistry(),
    clock: options.clock ?? systemClock,
    logger,
  };
  if (options.fetchImpl) ctx.fetchImpl = options.fetchImpl;
  return ctx;
}

/**
 * Opens the workspace database (creating and migrating it when needed) and
 * syncs the workspace topics and author. Subsequent calls reuse it.
 */
export async function db(ctx: AppContext): Promise<StoryDb> {
  if (ctx.database) return ctx.database;
  const { db: database, ...info } = await openDatabase(ctx.workspace.dbFile, { clock: ctx.clock, backupDir: ctx.workspace.backupsDir });
  if (info.created) ctx.logger.info(`Created database ${path.relative(ctx.workspace.root, ctx.workspace.dbFile) || ctx.workspace.dbFile}.`);
  if (info.applied.length && !info.created) ctx.logger.info(`Database migrated to v${info.applied.at(-1)!.version} (${info.applied.map((m) => m.name).join(', ')}). Backup: ${info.backup ?? 'none'}.`);
  const now = ctx.clock.now().toISOString();
  syncTopics(database, workspaceTopics(ctx.config), now);
  ensureAuthor(database, ctx.config, now);
  ctx.database = database;
  ctx.dbOpen = info;
  return database;
}

/** Writes pending database changes to disk. */
export async function saveDb(ctx: AppContext): Promise<void> {
  if (ctx.database?.hasChanges) await ctx.database.save();
}

export function createHttpClient(ctx: AppContext, options: { refresh?: boolean; offline?: boolean } = {}): HttpClient {
  const r = ctx.config.research;
  return new HttpClient({
    cache: new HttpCache(ctx.workspace.cacheDir, r.cacheTtlHours),
    clock: ctx.clock,
    logger: ctx.logger.child('http'),
    minDelayMs: r.requestDelayMs,
    concurrency: r.concurrency,
    timeoutMs: r.timeoutMs,
    ...(options.refresh ? { refresh: true } : {}),
    ...(options.offline ? { offline: true } : {}),
    ...(r.userAgentContact ? { userAgentContact: r.userAgentContact } : {}),
    ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
  });
}
