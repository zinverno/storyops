import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { StoryOpsError } from '../shared/errors.js';
import { parseWithSchema } from '../shared/fs.js';
import { configDeprecations, storyOpsConfigSchema, type ProjectConfig, type StoryOpsConfig } from './schema.js';

export const DEFAULT_CONFIG_FILE = 'storyops.config.json';
/** v2 (editorial-kit) config file name; still read when no storyops.config.json exists. */
export const LEGACY_CONFIG_FILE = 'editorial.config.json';

/**
 * Which config file a workspace uses: an explicit one, else storyops.config.json,
 * else the legacy editorial.config.json.
 */
export function resolveConfigFile(root: string, explicit?: string): { file: string; legacy: boolean } {
  if (explicit) return { file: path.resolve(root, explicit), legacy: path.basename(explicit) === LEGACY_CONFIG_FILE };
  const current = path.resolve(root, DEFAULT_CONFIG_FILE);
  if (existsSync(current)) return { file: current, legacy: false };
  const legacy = path.resolve(root, LEGACY_CONFIG_FILE);
  if (existsSync(legacy)) return { file: legacy, legacy: true };
  return { file: current, legacy: false };
}

export interface LoadedConfig {
  config: StoryOpsConfig;
  file: string;
  warnings: string[];
}

export async function loadConfig(configFile: string): Promise<LoadedConfig> {
  if (!existsSync(configFile)) {
    throw new StoryOpsError('CONFIG_NOT_FOUND', `Configuration file not found: ${configFile}`, {
      hint: 'Run `storyops init` to create one, or pass --config <file>.',
    });
  }
  let data: unknown;
  try {
    data = JSON.parse(await readFile(configFile, 'utf8'));
  } catch (error) {
    throw new StoryOpsError('CONFIG_INVALID_JSON', `${configFile} is not valid JSON`, { cause: error });
  }
  const warnings = configDeprecations(data);
  if (path.basename(configFile) === LEGACY_CONFIG_FILE) warnings.push(`using legacy ${LEGACY_CONFIG_FILE}; run \`storyops migrate\` to create ${DEFAULT_CONFIG_FILE} (the old file is kept).`);
  return { config: parseConfig(data, configFile), file: configFile, warnings };
}

export function parseConfig(data: unknown, label = 'configuration'): StoryOpsConfig {
  return parseWithSchema(storyOpsConfigSchema, data, label);
}

/** Resolves a configured project path relative to the workspace root. */
export function resolveProjectPath(root: string, project: ProjectConfig): string | undefined {
  if (!project.path) return undefined;
  return path.resolve(root, project.path);
}

export function findProject(config: StoryOpsConfig, id: string | undefined): ProjectConfig | undefined {
  if (!id) return config.projects.length === 1 ? config.projects[0] : undefined;
  return config.projects.find((p) => p.id === id || p.name.toLowerCase() === id.toLowerCase());
}

/** A minimal starter config. The author name and profiles are placeholders on purpose. */
export function starterConfig(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    language: 'ru',
    author: {
      name: 'Your Name',
      profiles: {},
      styleProfile: 'ru-technical',
    },
    projects: [],
    topics: [],
    research: { cacheTtlHours: 24, defaultPlatform: 'habr', requestDelayMs: 2000, concurrency: 2 },
    platforms: {
      habr: { enabled: true, periods: ['daily', 'weekly', 'monthly'], hubs: [], maxArticlesPerPeriod: 30 },
      medium: { enabled: true },
      linkedin: { enabled: true },
      telegram: { enabled: true },
      'generic-blog': { enabled: true },
    },
    analysis: { windowDays: 30 },
    review: {},
  };
}
