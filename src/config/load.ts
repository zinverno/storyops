import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { EditorialError } from '../shared/errors.js';
import { parseWithSchema } from '../shared/fs.js';
import { editorialConfigSchema, type EditorialConfig, type ProjectConfig } from './schema.js';

export const DEFAULT_CONFIG_FILE = 'editorial.config.json';

export async function loadConfig(configFile: string): Promise<EditorialConfig> {
  if (!existsSync(configFile)) {
    throw new EditorialError('CONFIG_NOT_FOUND', `Configuration file not found: ${configFile}`, {
      hint: 'Run `editorial-kit init` to create one, or pass --config <file>.',
    });
  }
  let data: unknown;
  try {
    data = JSON.parse(await readFile(configFile, 'utf8'));
  } catch (error) {
    throw new EditorialError('CONFIG_INVALID_JSON', `${configFile} is not valid JSON`, { cause: error });
  }
  return parseConfig(data, configFile);
}

export function parseConfig(data: unknown, label = 'configuration'): EditorialConfig {
  return parseWithSchema(editorialConfigSchema, data, label);
}

/** Resolves a configured project path relative to the workspace root. */
export function resolveProjectPath(root: string, project: ProjectConfig): string | undefined {
  if (!project.path) return undefined;
  return path.resolve(root, project.path);
}

export function findProject(config: EditorialConfig, id: string | undefined): ProjectConfig | undefined {
  if (!id) return config.projects.length === 1 ? config.projects[0] : undefined;
  return config.projects.find((p) => p.id === id || p.name.toLowerCase() === id.toLowerCase());
}

/** A minimal starter config. The author name and profiles are placeholders on purpose. */
export function starterConfig(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    language: 'ru',
    author: {
      name: 'Your Name',
      profiles: {},
      styleProfile: 'ru-technical',
    },
    projects: [],
    research: { cacheTtlHours: 24, defaultPlatform: 'habr', requestDelayMs: 2000, concurrency: 2 },
    platforms: {
      habr: { enabled: true, periods: ['daily', 'weekly', 'monthly'], hubs: [], maxArticlesPerPeriod: 30 },
      medium: { enabled: true },
      linkedin: { enabled: true },
      telegram: { enabled: true },
      'generic-blog': { enabled: true },
    },
    screenshots: { viewport: { width: 1440, height: 1000 }, outputDir: 'images' },
  };
}
