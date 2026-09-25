import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { pathExists, readJson } from '../shared/fs.js';
import { publicationSchema, type Publication } from './schema.js';

/**
 * Reads a v2 publication directory (`.editorial/publications/<platform>/<id>.json`,
 * one file per publication). In v3 publications live in the database; this
 * is used by `storyops migrate`.
 */
export async function loadPublicationFiles(dir: string): Promise<Publication[]> {
  if (!pathExists(dir)) return [];
  const results: Publication[] = [];
  const platforms = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory());
  for (const platform of platforms.sort((a, b) => a.name.localeCompare(b.name))) {
    const sub = path.join(dir, platform.name);
    const files = (await readdir(sub)).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
    for (const file of files) results.push(await readJson(path.join(sub, file), publicationSchema));
  }
  return sortPublications(dedupePublications(results));
}

/** Chronological order; undated publications go last, ties broken by id for determinism. */
export function sortPublications(publications: Publication[]): Publication[] {
  return [...publications].sort((a, b) => {
    const da = a.publicationDate ? Date.parse(a.publicationDate) : Number.POSITIVE_INFINITY;
    const db = b.publicationDate ? Date.parse(b.publicationDate) : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id);
  });
}

/** Deduplicates by id and by canonical URL, keeping the most recently collected record. */
export function dedupePublications(publications: Publication[]): Publication[] {
  const byKey = new Map<string, Publication>();
  for (const pub of publications) {
    const keys = [pub.id, pub.url ? canonicalUrl(pub.url) : undefined].filter((k): k is string => Boolean(k));
    const existingKey = keys.find((k) => byKey.has(k));
    const existing = existingKey ? byKey.get(existingKey) : undefined;
    const winner = !existing || Date.parse(pub.source.collectedAt) >= Date.parse(existing.source.collectedAt) ? pub : existing;
    if (existing) for (const [k, v] of byKey) if (v === existing) byKey.delete(k);
    for (const k of [winner.id, winner.url ? canonicalUrl(winner.url) : undefined, ...keys]) if (k) byKey.set(k, winner);
  }
  return [...new Set(byKey.values())];
}

export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return `${u.host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return url;
  }
}
