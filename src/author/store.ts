import type { StoryOpsConfig } from '../config/schema.js';
import { json, parseJson, type StoryDb } from '../db/database.js';
import { publicationSchema, type Publication } from '../publications/schema.js';
import { canonicalUrl, dedupePublications, sortPublications } from '../publications/store.js';
import { hashJson } from '../shared/hash.js';

/**
 * The author's own publication archive, stored in the database. This is the
 * author's own writing, so its text is kept: coverage and overlap need it.
 * Research on OTHER authors never stores text.
 */

export const SELF = 'self';

export function ensureAuthor(db: StoryDb, config: Pick<StoryOpsConfig, 'author'>, now: string): void {
  db.tx(() => {
    db.run(`INSERT INTO authors (id, name, is_self, created_at) VALUES (?, ?, 1, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name`, [SELF, config.author.name, now]);
    db.run('DELETE FROM author_profiles WHERE author_id = ?', [SELF]);
    for (const [platform, url] of Object.entries(config.author.profiles)) db.run('INSERT INTO author_profiles (author_id, platform_id, url) VALUES (?, ?, ?)', [SELF, platform, url]);
  });
}

export interface SaveResult {
  added: number;
  updated: number;
  unchanged: number;
}

/** Upserts publications (by id, then canonical URL). Unchanged content is not rewritten. */
export function savePublications(db: StoryDb, publications: readonly Publication[], authorId = SELF): SaveResult {
  const result: SaveResult = { added: 0, updated: 0, unchanged: 0 };
  db.tx(() => {
    for (const raw of publications) {
      const pub = publicationSchema.parse(raw);
      const { source: _source, ...content } = pub;
      const hash = hashJson(content);
      const canon = pub.url ? canonicalUrl(pub.url) : null;
      const existing =
        db.get<{ id: string; content_hash: string }>('SELECT id, content_hash FROM author_publications WHERE id = ?', [pub.id]) ??
        (canon ? db.get<{ id: string; content_hash: string }>('SELECT id, content_hash FROM author_publications WHERE canonical_url = ? AND author_id = ?', [canon, authorId]) : undefined);
      if (existing?.content_hash === hash) {
        result.unchanged += 1;
        continue;
      }
      if (existing && existing.id !== pub.id) db.run('DELETE FROM author_publications WHERE id = ?', [existing.id]);
      db.run(
        `INSERT OR REPLACE INTO author_publications (id, author_id, platform_id, title, url, canonical_url, published_at, depth, word_count, projects, source, collected_at, content_hash, record)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [pub.id, authorId, pub.platform, pub.title, pub.url, canon, pub.publicationDate, pub.depth, pub.wordCount, json(pub.projectReferences), pub.source.adapter, pub.source.collectedAt, hash, json(pub)],
      );
      if (existing) result.updated += 1;
      else result.added += 1;
    }
  });
  return result;
}

export function loadPublications(db: StoryDb, authorId = SELF): Publication[] {
  const rows = db.all<{ record: string }>('SELECT record FROM author_publications WHERE author_id = ?', [authorId]);
  const pubs = rows.map((r) => publicationSchema.parse(parseJson(r.record, {})));
  return sortPublications(dedupePublications(pubs));
}

export function publicationCount(db: StoryDb, authorId = SELF): number {
  return db.value<number>('SELECT COUNT(*) FROM author_publications WHERE author_id = ?', [authorId]) ?? 0;
}
