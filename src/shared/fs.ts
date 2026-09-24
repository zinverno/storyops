import { mkdir, readFile, rename, writeFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import { EditorialError } from './errors.js';

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export function pathExists(p: string): boolean {
  return existsSync(p);
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Atomic text write: write to a temp file in the same directory, then rename. */
export async function writeText(file: string, content: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, file);
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readText(file: string): Promise<string> {
  return readFile(file, 'utf8');
}

/**
 * Reads and validates JSON. Validation errors are reported with the file path
 * and the failing fields so that hand-edited artifacts are easy to fix.
 */
export async function readJson<T extends z.ZodType>(file: string, schema: T): Promise<z.infer<T>> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    throw new EditorialError('FILE_NOT_FOUND', `Cannot read ${file}`, { cause: error });
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new EditorialError('INVALID_JSON', `${file} is not valid JSON`, { cause: error });
  }
  return parseWithSchema(schema, data, file);
}

export async function readJsonIfExists<T extends z.ZodType>(file: string, schema: T): Promise<z.infer<T> | undefined> {
  if (!existsSync(file)) return undefined;
  return readJson(file, schema);
}

export function parseWithSchema<T extends z.ZodType>(schema: T, data: unknown, label: string): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 8)
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new EditorialError('SCHEMA_VALIDATION', `${label} failed validation:\n${issues}`);
  }
  return result.data;
}

export async function listFilesRecursive(dir: string, options: { ignore?: (rel: string) => boolean; maxFiles?: number } = {}): Promise<string[]> {
  const results: string[] = [];
  const max = options.maxFiles ?? 50_000;
  async function walk(current: string): Promise<void> {
    if (results.length >= max) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      if (options.ignore?.(entry.isDirectory() ? `${rel}/` : rel)) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        results.push(rel);
        if (results.length >= max) return;
      }
    }
  }
  await walk(dir);
  return results;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}
