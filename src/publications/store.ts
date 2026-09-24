import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { pathExists, readJson, writeJson } from '../shared/fs.js';
import type { WorkspacePaths } from '../shared/workspace.js';
import { publicationSchema, type Publication } from './schema.js';

/**
 * Publications are stored one file per publication under
 * `.editorial/publications/<platform>/<id>.json` so that diffs stay readable
 * and manual edits are easy.
 */
export function publicationFile(workspace: WorkspacePaths, publication: Pick<Publication, 'platform' | 'id'>): string {
  const localId = publication.id.replace(/^[^:]+:/, '').replace(/[^a-zA-Z0-9._-]+/g, '-');
  return path.join(workspace.publicationsDir, publication.platform, `${localId}.json`);
}

export async function savePublication(workspace: WorkspacePaths, publication: Publication): Promise<string> {
  const file = publicationFile(workspace, publication);
  await writeJson(file, publicationSchema.parse(publication));
  return file;
}

export async function loadPublications(workspace: WorkspacePaths): Promise<Publication[]> {
  if (!pathExists(workspace.publicationsDir)) return [];
  const results: Publication[] = [];
  const platforms = (await readdir(workspace.publicationsDir, { withFileTypes: true })).filter((e) => e.isDirectory());
  for (const platform of platforms.sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(workspace.publicationsDir, platform.name);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
    for (const file of files) results.push(await readJson(path.join(dir, file), publicationSchema));
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
