import path from 'node:path';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDatabase, openMemoryDatabase } from '../src/db/database.js';
import { loadMigrations, type Migration } from '../src/db/migrate.js';
import { ensurePlatform, listRuns, recordResearchRun } from '../src/platform/store.js';
import { RESEARCH_SNAPSHOT_SCHEMA_VERSION, type ResearchSnapshot, type TrendArticle } from '../src/research/types.js';
import { sha256 } from '../src/shared/hash.js';
import { fixedClock } from '../src/shared/clock.js';
import { tempDir } from './helpers.js';

const clock = fixedClock('2026-09-24T12:00:00.000Z');
const habr = { id: 'habr', displayName: 'Habr', research: { liveResearch: 'implemented' as const } };

function article(id: number, views: number, extra: Partial<TrendArticle> = {}): TrendArticle {
  return { id: `habr:${id}`, platform: 'habr', url: `https://habr.com/ru/articles/${id}/`, title: `Статья ${id}`, author: `a${id}`, publishedAt: '2026-09-20T10:00:00.000Z', hubs: [], tags: [], metrics: { views, rating: 10 }, seenIn: ['weekly'], warnings: [], ...extra };
}

function snapshot(collectedAt: string, articles: TrendArticle[]): ResearchSnapshot {
  return { schemaVersion: RESEARCH_SNAPSHOT_SCHEMA_VERSION, platform: 'habr', collectedAt, status: 'live', windows: [], filters: { hubs: [], periods: ['weekly'] }, sampleSize: articles.length, sources: [], failures: [], articles, observations: [], saturatedAngles: [], limitations: [], momentumFormula: 'f' };
}

describe('database and migrations', () => {
  it('creates a new database with every migration applied, in order', async () => {
    const tmp = await tempDir();
    try {
      const file = path.join(tmp.dir, '.storyops', 'storyops.db');
      const { db, created, applied } = await openDatabase(file, { clock });
      expect(created).toBe(true);
      expect(applied.map((m) => m.version)).toEqual(loadMigrations().map((m) => m.version));
      expect(db.version()).toBe(5);
      expect(existsSync(file)).toBe(true);
      const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").map((r) => r.name);
      for (const t of ['platform_articles', 'platform_article_metrics', 'research_runs', 'trend_snapshots', 'author_publications', 'author_topic_coverage', 'repository_events', 'topic_opportunities', 'review_findings', 'review_decisions', 'platform_topics', 'author_topics']) expect(tables).toContain(t);
      db.close();
      // Re-opening applies nothing and writes no backup.
      const again = await openDatabase(file, { clock });
      expect(again.applied).toEqual([]);
      expect(again.backup).toBeUndefined();
      again.db.close();
    } finally {
      await tmp.cleanup();
    }
  });

  it('upgrades an older database transactionally, keeps its data and writes a backup first', async () => {
    const tmp = await tempDir();
    try {
      const file = path.join(tmp.dir, 'storyops.db');
      const all = loadMigrations();
      const old = await openDatabase(file, { clock, migrations: all.slice(0, 2) });
      expect(old.db.version()).toBe(2);
      ensurePlatform(old.db, habr, clock.now().toISOString());
      recordResearchRun(old.db, snapshot('2026-09-10T12:00:00.000Z', [article(1, 1000)]), { origin: 'live' });
      await old.db.save();
      old.db.close();
      const oldBytes = await readFile(file);

      const upgraded = await openDatabase(file, { clock, backupDir: path.join(tmp.dir, 'backups') });
      expect(upgraded.applied.map((m) => m.version)).toEqual([3, 4, 5]);
      expect(upgraded.db.version()).toBe(5);
      expect(upgraded.db.value('SELECT COUNT(*) FROM platform_articles')).toBe(1);
      expect(upgraded.backup).toBeDefined();
      expect(sha256(await readFile(upgraded.backup!))).toBe(sha256(oldBytes));
      expect(await readdir(path.join(tmp.dir, 'backups'))).toHaveLength(1);
      upgraded.db.close();
    } finally {
      await tmp.cleanup();
    }
  });

  it('rolls back a failing migration and leaves the file untouched', async () => {
    const tmp = await tempDir();
    try {
      const file = path.join(tmp.dir, 'storyops.db');
      const all = loadMigrations();
      const first = await openDatabase(file, { clock, migrations: all.slice(0, 1) });
      first.db.close();
      const before = sha256(await readFile(file));
      const broken: Migration = { version: 2, name: 'broken', sql: 'CREATE TABLE ok_table (id INTEGER);\nCREATE TABLE platforms (id TEXT);', checksum: 'x' };
      await expect(openDatabase(file, { clock, migrations: [all[0]!, broken] })).rejects.toThrow(/Migration 002-broken failed and was rolled back/);
      expect(sha256(await readFile(file))).toBe(before);
      const reopened = await openDatabase(file, { clock, migrations: all.slice(0, 1) });
      expect(reopened.db.version()).toBe(1);
      expect(reopened.db.value("SELECT COUNT(*) FROM sqlite_master WHERE name = 'ok_table'")).toBe(0);
      reopened.db.close();
    } finally {
      await tmp.cleanup();
    }
  });

  it('refuses edited migrations and databases from a newer StoryOps; never recreates the schema', async () => {
    const tmp = await tempDir();
    try {
      const file = path.join(tmp.dir, 'storyops.db');
      const all = loadMigrations();
      (await openDatabase(file, { clock })).db.close();
      const edited = all.map((m) => (m.version === 1 ? { ...m, checksum: sha256('edited') } : m));
      await expect(openDatabase(file, { clock, migrations: edited })).rejects.toThrow(/changed after it was applied/);
      await expect(openDatabase(file, { clock, migrations: all.slice(0, 3) })).rejects.toThrow(/newer StoryOps/);
      await writeFile(path.join(tmp.dir, 'garbage.db'), 'not a database at all, definitely not sqlite');
      await expect(openDatabase(path.join(tmp.dir, 'garbage.db'), { clock })).rejects.toThrow(/not a readable SQLite database/);
    } finally {
      await tmp.cleanup();
    }
  });

  it('stores an article seen again as ONE article with a new metric observation per run', async () => {
    const db = await openMemoryDatabase({ clock });
    ensurePlatform(db, habr, clock.now().toISOString());
    const r1 = recordResearchRun(db, snapshot('2026-09-17T12:00:00.000Z', [article(1, 1000), article(2, 500)]), { origin: 'live' });
    const r2 = recordResearchRun(db, snapshot('2026-09-24T12:00:00.000Z', [article(1, 4000), article(3, 200)]), { origin: 'live' });
    expect(r1).toMatchObject({ newArticles: 2, seenAgain: 0 });
    expect(r2).toMatchObject({ newArticles: 1, seenAgain: 1 });
    expect(db.value('SELECT COUNT(*) FROM platform_articles')).toBe(3);
    const views = db.all<{ views: number; observed_at: string }>("SELECT views, observed_at FROM platform_article_metrics WHERE article_id = 'habr:1' ORDER BY observed_at");
    expect(views).toEqual([
      { views: 1000, observed_at: '2026-09-17T12:00:00.000Z' },
      { views: 4000, observed_at: '2026-09-24T12:00:00.000Z' },
    ]);
    expect(db.get<{ first_seen_at: string; last_seen_at: string }>("SELECT first_seen_at, last_seen_at FROM platform_articles WHERE id = 'habr:1'")).toEqual({ first_seen_at: '2026-09-17T12:00:00.000Z', last_seen_at: '2026-09-24T12:00:00.000Z' });
    // Same URL under another id (e.g. a redirect-normalised URL) is still the same article.
    recordResearchRun(db, snapshot('2026-09-25T12:00:00.000Z', [article(99, 10, { url: 'https://habr.com/ru/articles/1/?utm=x' })]), { origin: 'live' });
    expect(db.value('SELECT COUNT(*) FROM platform_articles')).toBe(3);
  });

  it('keeps research history: runs accumulate and an imported file is recorded once', async () => {
    const db = await openMemoryDatabase({ clock });
    ensurePlatform(db, habr, clock.now().toISOString());
    recordResearchRun(db, snapshot('2026-09-03T12:00:00.000Z', [article(1, 100)]), { origin: 'import', fingerprint: 'abc', label: 'week 1' });
    const dup = recordResearchRun(db, snapshot('2026-09-03T12:00:00.000Z', [article(1, 100)]), { origin: 'import', fingerprint: 'abc', label: 'week 1' });
    recordResearchRun(db, snapshot('2026-09-10T12:00:00.000Z', [article(2, 100)]), { origin: 'live' });
    expect(dup.duplicate).toBe(true);
    const runs = listRuns(db, { platform: 'habr' });
    expect(runs.map((r) => r.collectedAt)).toEqual(['2026-09-10T12:00:00.000Z', '2026-09-03T12:00:00.000Z']);
    expect(runs[1]).toMatchObject({ origin: 'import', label: 'week 1', sampleSize: 1 });
  });

  it('rewrites abstract features only when their content hash changes and never stores article text', async () => {
    const db = await openMemoryDatabase({ clock });
    ensurePlatform(db, habr, clock.now().toISOString());
    const structure = { wordCount: 1500, introWords: 80, sectionCount: 5, codeBlocks: 2, codeDensity: 0.1, images: 2, imagesPer1000Words: 1.3, diagramHints: 1, hasMeasurements: true, wordsBeforeConflict: 40, conclusionKind: 'summary' as const, postmortemStructure: false, beforeAfterStructure: false };
    const a = article(1, 100, { structure });
    expect(recordResearchRun(db, snapshot('2026-09-17T12:00:00.000Z', [a]), { origin: 'live' }).featuresWritten).toBe(1);
    expect(recordResearchRun(db, snapshot('2026-09-24T12:00:00.000Z', [a]), { origin: 'live' })).toMatchObject({ featuresWritten: 0, featuresUnchanged: 1 });
    const row = db.get<Record<string, unknown>>('SELECT * FROM platform_article_features');
    expect(row).toMatchObject({ has_body: 1, heading_count: 5, code_blocks: 2, conflict_first: 1, measurements: 1 });
    const columns = db.all<{ name: string }>("SELECT name FROM pragma_table_info('platform_articles')").map((c) => c.name);
    expect(columns.some((c) => /text|body|content/.test(c))).toBe(false);
  });
});
