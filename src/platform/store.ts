import type { PlatformStrategy } from '../../platforms/schema.js';
import { json, parseJson, type StoryDb } from '../db/database.js';
import { canonicalUrl } from '../publications/store.js';
import { structuralFeaturesSchema, type ResearchSnapshot, type StructuralFeatures, type TrendArticle } from '../research/types.js';
import { hashJson } from '../shared/hash.js';

/**
 * Persists research runs. Research is historical: each run is a new row, an
 * article seen again is the SAME article with a new metric observation, and
 * abstract features are only rewritten when their content hash changes.
 */

export type RunOrigin = 'live' | 'cache' | 'partial' | 'import' | 'legacy-snapshot';

export interface RecordRunOptions {
  origin: RunOrigin;
  label?: string;
  /** Content fingerprint of an imported file; the same file imported twice is recorded once. */
  fingerprint?: string;
}

export interface RecordRunResult {
  runId: number;
  duplicate: boolean;
  newArticles: number;
  seenAgain: number;
  metricObservations: number;
  featuresWritten: number;
  featuresUnchanged: number;
  articleIds: string[];
}

export function ensurePlatform(db: StoryDb, strategy: Pick<PlatformStrategy, 'id' | 'displayName'> & { research: Pick<PlatformStrategy['research'], 'liveResearch'> }, now: string): void {
  db.run(
    `INSERT INTO platforms (id, display_name, live_research, first_seen_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, live_research = excluded.live_research`,
    [strategy.id, strategy.displayName, strategy.research.liveResearch, now],
  );
}

export interface ArticleFeatureRow {
  has_body: number;
  word_count: number | null;
  heading_count: number | null;
  heading_density: number | null;
  intro_words: number | null;
  code_blocks: number | null;
  code_density: number | null;
  image_count: number | null;
  diagram_count: number | null;
  list_density: number | null;
  quote_density: number | null;
  first_person: number | null;
  conflict_first: number | null;
  number_in_headline: number | null;
  question_headline: number | null;
  before_after: number | null;
  postmortem: number | null;
  tutorial: number | null;
  architecture: number | null;
  measurements: number | null;
  conclusion_kind: string | null;
}

const bool = (v: boolean | undefined): number | null => (v === undefined ? null : v ? 1 : 0);
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** Conflict appears within this many words of the start (same threshold as pattern extraction). */
export const CONFLICT_FIRST_WORDS = 150;

/** Abstract feature vector of an article (title + structure). Never contains text. */
export function articleFeatures(a: TrendArticle): ArticleFeatureRow {
  const t = a.titleFeatures;
  const s = a.structure;
  const blocks = s ? (s.paragraphs ?? 0) + (s.listBlocks ?? 0) + (s.quoteBlocks ?? 0) + s.codeBlocks + s.images + s.sectionCount : 0;
  return {
    has_body: s ? 1 : 0,
    word_count: s?.wordCount ?? null,
    heading_count: s?.sectionCount ?? null,
    heading_density: s && s.wordCount > 0 ? round((s.sectionCount * 1000) / s.wordCount, 2) : null,
    intro_words: s?.introWords ?? null,
    code_blocks: s?.codeBlocks ?? null,
    code_density: s?.codeDensity ?? null,
    image_count: s?.images ?? null,
    diagram_count: s?.diagramHints ?? null,
    list_density: s && s.listBlocks !== undefined && blocks > 0 ? round(s.listBlocks / blocks) : null,
    quote_density: s && s.quoteBlocks !== undefined && blocks > 0 ? round(s.quoteBlocks / blocks) : null,
    first_person: bool(t?.firstPerson),
    conflict_first: s ? (s.wordsBeforeConflict !== undefined && s.wordsBeforeConflict <= CONFLICT_FIRST_WORDS ? 1 : 0) : bool(t?.conflictFraming),
    number_in_headline: bool(t?.hasNumber),
    question_headline: bool(t?.isQuestion),
    before_after: t || s ? ((t?.beforeAfterFraming ?? false) || (s?.beforeAfterStructure ?? false) ? 1 : 0) : null,
    postmortem: t || s ? ((t?.postmortemFraming ?? false) || (s?.postmortemStructure ?? false) ? 1 : 0) : null,
    tutorial: t || s ? ((t?.howToFraming ?? false) || (s?.tutorialStructure ?? false) ? 1 : 0) : null,
    architecture: t || s ? ((t?.architectureFraming ?? false) || (s?.architectureStructure ?? false) ? 1 : 0) : null,
    measurements: s ? (s.hasMeasurements ? 1 : 0) : null,
    conclusion_kind: s?.conclusionKind ?? null,
  };
}

function externalId(articleId: string): string {
  return articleId.includes(':') ? articleId.slice(articleId.indexOf(':') + 1) : articleId;
}

/** Records one research snapshot (live, cached, imported or legacy) as a run. */
export function recordResearchRun(db: StoryDb, snapshot: ResearchSnapshot, options: RecordRunOptions): RecordRunResult {
  if (options.fingerprint) {
    const existing = db.get<{ id: number }>('SELECT id FROM research_runs WHERE platform_id = ? AND fingerprint = ?', [snapshot.platform, options.fingerprint]);
    if (existing) return { runId: existing.id, duplicate: true, newArticles: 0, seenAgain: 0, metricObservations: 0, featuresWritten: 0, featuresUnchanged: 0, articleIds: [] };
  }
  return db.tx(() => {
    const run = db.run(
      `INSERT INTO research_runs (platform_id, collected_at, origin, status, label, periods, hubs, windows, sample_size, source_count, cached_source_count, failures, limitations, momentum_formula, fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshot.platform,
        snapshot.collectedAt,
        options.origin,
        snapshot.status,
        options.label ?? null,
        json(snapshot.filters.periods),
        json(snapshot.filters.hubs),
        json(snapshot.windows),
        snapshot.articles.length,
        snapshot.sources.length,
        snapshot.sources.filter((s) => s.fromCache).length,
        json(snapshot.failures),
        json(snapshot.limitations),
        snapshot.momentumFormula,
        options.fingerprint ?? null,
      ],
    );
    const runId = run.lastInsertRowid;
    const result: RecordRunResult = { runId, duplicate: false, newArticles: 0, seenAgain: 0, metricObservations: 0, featuresWritten: 0, featuresUnchanged: 0, articleIds: [] };
    for (const a of snapshot.articles) {
      const canon = canonicalUrl(a.url);
      const byUrl = db.get<{ id: string }>('SELECT id FROM platform_articles WHERE platform_id = ? AND canonical_url = ?', [snapshot.platform, canon]);
      const id = byUrl?.id ?? a.id;
      const exists = byUrl ?? db.get<{ id: string }>('SELECT id FROM platform_articles WHERE id = ?', [id]);
      const seenAt = a.observedAt ?? snapshot.collectedAt;
      if (exists) {
        result.seenAgain += 1;
        db.run(
          `UPDATE platform_articles SET title = ?, author = COALESCE(?, author), published_at = COALESCE(?, published_at),
             hubs = CASE WHEN ? = '[]' THEN hubs ELSE ? END, tags = CASE WHEN ? = '[]' THEN tags ELSE ? END,
             last_seen_at = MAX(last_seen_at, ?), first_seen_at = MIN(first_seen_at, ?) WHERE id = ?`,
          [a.title, a.author ?? null, a.publishedAt ?? null, json(a.hubs), json(a.hubs), json(a.tags), json(a.tags), seenAt, seenAt, id],
        );
      } else {
        result.newArticles += 1;
        db.run(
          `INSERT INTO platform_articles (id, platform_id, external_id, url, canonical_url, title, author, published_at, hubs, tags, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, snapshot.platform, externalId(id), a.url, canon, a.title, a.author ?? null, a.publishedAt ?? null, json(a.hubs), json(a.tags), seenAt, seenAt],
        );
      }
      result.articleIds.push(id);
      db.run('INSERT OR REPLACE INTO research_run_articles (run_id, article_id, seen_in, momentum_rank, lifetime_rank) VALUES (?, ?, ?, ?, ?)', [runId, id, json(a.seenIn), a.momentumRank ?? null, a.lifetimeRank ?? null]);
      const m = a.metrics;
      db.run(
        `INSERT OR REPLACE INTO platform_article_metrics (article_id, run_id, observed_at, views, views_approximate, rating, votes, comments, bookmarks, reading_time_minutes, momentum_score, momentum_coverage, age_hours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, runId, seenAt, m.views, m.viewsApproximate, m.rating, m.votes, m.comments, m.bookmarks, m.readingTimeMinutes, a.momentum?.score, a.momentum?.coverage, a.momentum?.ageHours],
      );
      result.metricObservations += 1;
      if (a.titleFeatures || a.structure) {
        const features = articleFeatures(a);
        const hash = hashJson(features);
        const stored = db.get<{ content_hash: string; has_body: number }>('SELECT content_hash, has_body FROM platform_article_features WHERE article_id = ?', [id]);
        // Never replace body-derived features with title-only ones.
        if (stored && (stored.content_hash === hash || (stored.has_body === 1 && features.has_body === 0))) result.featuresUnchanged += 1;
        else {
          const cols = Object.keys(features);
          db.run(
            `INSERT OR REPLACE INTO platform_article_features (article_id, content_hash, extracted_at, structure, ${cols.join(', ')}) VALUES (?, ?, ?, ?, ${cols.map(() => '?').join(', ')})`,
            [id, hash, seenAt, a.structure ? json(a.structure) : null, ...cols.map((c) => features[c as keyof ArticleFeatureRow])],
          );
          result.featuresWritten += 1;
        }
      }
    }
    for (const o of snapshot.observations) {
      db.run(
        `INSERT OR REPLACE INTO pattern_observations (run_id, pattern_id, statement, strength, sample_size, group_size, comparison_size, top_share, rest_share, observation_values, article_ids, limitations)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [runId, o.id, o.statement, o.strength, o.sample.size, o.sample.groupSize, o.sample.comparisonSize, typeof o.values.topShare === 'number' ? o.values.topShare : null, typeof o.values.restShare === 'number' ? o.values.restShare : null, json(o.values), json(o.articleIds), json(o.limitations)],
      );
    }
    return result;
  });
}

/** Stored structural features by article id (their bodies need not be fetched again). */
export function articlesWithBodyFeatures(db: StoryDb, platform: string): Map<string, StructuralFeatures> {
  const rows = db.all<{ article_id: string; structure: string | null }>('SELECT f.article_id, f.structure FROM platform_article_features f JOIN platform_articles a ON a.id = f.article_id WHERE a.platform_id = ? AND f.has_body = 1 AND f.structure IS NOT NULL', [platform]);
  const out = new Map<string, StructuralFeatures>();
  for (const r of rows) {
    const parsed = structuralFeaturesSchema.safeParse(parseJson(r.structure, null));
    if (parsed.success) out.set(r.article_id, parsed.data);
  }
  return out;
}

export interface RunSummary {
  id: number;
  platform: string;
  collectedAt: string;
  origin: string;
  status: string;
  label?: string;
  sampleSize: number;
  sources: number;
  cachedSources: number;
  periods: string[];
  hubs: string[];
  failures: number;
}

export function listRuns(db: StoryDb, options: { platform?: string; limit?: number } = {}): RunSummary[] {
  const rows = db.all<{ id: number; platform_id: string; collected_at: string; origin: string; status: string; label: string | null; sample_size: number; source_count: number; cached_source_count: number; periods: string; hubs: string; failures: string }>(
    `SELECT * FROM research_runs ${options.platform ? 'WHERE platform_id = ?' : ''} ORDER BY collected_at DESC, id DESC LIMIT ?`,
    [...(options.platform ? [options.platform] : []), options.limit ?? 50],
  );
  return rows.map((r) => {
    const s: RunSummary = { id: r.id, platform: r.platform_id, collectedAt: r.collected_at, origin: r.origin, status: r.status, sampleSize: r.sample_size, sources: r.source_count, cachedSources: r.cached_source_count, periods: parseJson(r.periods, []), hubs: parseJson(r.hubs, []), failures: parseJson<unknown[]>(r.failures, []).length };
    if (r.label) s.label = r.label;
    return s;
  });
}
