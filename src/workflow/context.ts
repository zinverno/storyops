import path from 'node:path';
import { createDefaultRegistry, type PlatformRegistry } from '../../platforms/registry.js';
import { loadConfig } from '../config/load.js';
import type { EditorialConfig } from '../config/schema.js';
import { HttpCache } from '../research/cache.js';
import { HttpClient } from '../research/http.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { createLogger, type Logger } from '../shared/logger.js';
import { resolveWorkspace, type WorkspacePaths } from '../shared/workspace.js';

export interface AppContext {
  workspace: WorkspacePaths;
  config: EditorialConfig;
  registry: PlatformRegistry;
  clock: Clock;
  logger: Logger;
  /** Injected fetch (tests); defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface ContextOptions {
  root?: string;
  configFile?: string;
  clock?: Clock;
  logger?: Logger;
  registry?: PlatformRegistry;
  fetchImpl?: typeof fetch;
}

export async function loadContext(options: ContextOptions = {}): Promise<AppContext> {
  const root = path.resolve(options.root ?? process.cwd());
  const configFile = path.resolve(root, options.configFile ?? 'editorial.config.json');
  const config = await loadConfig(configFile);
  const workspace = resolveWorkspace(root, { configFile, editorialDir: config.paths.editorialDir, articlesDir: config.paths.articlesDir });
  const ctx: AppContext = {
    workspace,
    config,
    registry: options.registry ?? createDefaultRegistry(),
    clock: options.clock ?? systemClock,
    logger: options.logger ?? createLogger(),
  };
  if (options.fetchImpl) ctx.fetchImpl = options.fetchImpl;
  return ctx;
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

export function projectDir(ctx: AppContext, projectId: string): string {
  return path.join(ctx.workspace.projectsDir, projectId);
}
