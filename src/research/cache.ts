import path from 'node:path';
import { readdir, rm, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { ensureDir, pathExists, writeJson } from '../shared/fs.js';
import { sha256 } from '../shared/hash.js';
import { sanitizeUrl } from '../shared/redact.js';

export const cacheEntrySchema = z.object({
  schemaVersion: z.literal(1),
  platform: z.string(),
  url: z.string(),
  fetchedAt: z.string(),
  status: z.number().int(),
  contentType: z.string().optional(),
  /** Final URL after redirects; the entry itself is keyed by the originally requested `url`. */
  finalUrl: z.string().optional(),
  /** Validators for conditional re-requests (If-None-Match / If-Modified-Since). */
  etag: z.string().optional(),
  lastModified: z.string().optional(),
  body: z.string(),
});
export type CacheEntry = z.infer<typeof cacheEntrySchema>;

export interface CacheLookup {
  entry: CacheEntry;
  ageHours: number;
  fresh: boolean;
}

/**
 * File-based HTTP response cache: `<cacheDir>/<platform>/<sha256(url)>.json`.
 * Entries are timestamped, grouped by platform, human-inspectable JSON, and
 * can be invalidated per platform or entirely. Only public, unauthenticated
 * responses are cached; no request headers or cookies are stored.
 */
export class HttpCache {
  constructor(
    private readonly dir: string,
    private readonly ttlHours: number,
  ) {}

  private fileFor(platform: string, url: string): string {
    return path.join(this.dir, platform, `${sha256(url).slice(0, 32)}.json`);
  }

  async get(platform: string, url: string, now: Date): Promise<CacheLookup | undefined> {
    const file = this.fileFor(platform, url);
    if (!pathExists(file)) return undefined;
    try {
      const entry = cacheEntrySchema.parse(JSON.parse(await readFile(file, 'utf8')));
      const ageHours = (now.getTime() - Date.parse(entry.fetchedAt)) / 3_600_000;
      return { entry, ageHours, fresh: ageHours <= this.ttlHours };
    } catch {
      return undefined; // corrupt entry: treat as a miss
    }
  }

  async set(entry: Omit<CacheEntry, 'schemaVersion'>): Promise<void> {
    await ensureDir(path.join(this.dir, entry.platform));
    await writeJson(this.fileFor(entry.platform, entry.url), { schemaVersion: 1, ...entry, url: entry.url });
  }

  async list(platform?: string): Promise<Array<{ platform: string; url: string; finalUrl?: string; fetchedAt: string; status: number; bytes: number }>> {
    if (!pathExists(this.dir)) return [];
    const platforms = platform ? [platform] : (await readdir(this.dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    const rows = [];
    for (const p of platforms.sort()) {
      const dir = path.join(this.dir, p);
      if (!pathExists(dir)) continue;
      for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
        try {
          const entry = cacheEntrySchema.parse(JSON.parse(await readFile(path.join(dir, file), 'utf8')));
          rows.push({ platform: p, url: sanitizeUrl(entry.url), ...(entry.finalUrl ? { finalUrl: sanitizeUrl(entry.finalUrl) } : {}), fetchedAt: entry.fetchedAt, status: entry.status, bytes: entry.body.length });
        } catch {
          // skip unreadable entries
        }
      }
    }
    return rows;
  }

  async clear(platform?: string): Promise<void> {
    const target = platform ? path.join(this.dir, platform) : this.dir;
    await rm(target, { recursive: true, force: true });
  }
}
