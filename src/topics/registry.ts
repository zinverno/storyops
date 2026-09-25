import { normalizeGlossary, type StoryOpsConfig } from '../config/schema.js';
import { json, parseJson, type StoryDb } from '../db/database.js';
import { slugify } from '../shared/text.js';
import { compileTopics, matchTopics, type CompiledTopic } from './match.js';
import { BUILTIN_TOPICS, type TopicDefinition, type TopicSpecificity } from './taxonomy.js';

/**
 * The topic set of a workspace: built-in taxonomy + `topics` from the config
 * + one project topic per glossary entry of every configured project.
 */

export type TopicOrigin = 'builtin' | 'config' | 'glossary' | 'module' | 'query';

export interface WorkspaceTopic extends TopicDefinition {
  origin: TopicOrigin;
  /** Project ids a glossary topic belongs to. */
  projects: string[];
}

/** Stable id for a glossary term: explicit id, else the first ASCII alias, else the transliterated term. */
export function glossaryTopicId(entry: { term: string; aliases: string[]; id?: string | undefined }): string {
  if (entry.id) return entry.id;
  const ascii = [entry.term, ...entry.aliases].find((a) => /^[\x20-\x7e]+$/.test(a) && /[a-z]/i.test(a));
  return slugify(ascii ?? entry.term, 48);
}

export function workspaceTopics(config: Pick<StoryOpsConfig, 'topics' | 'projects'>): WorkspaceTopic[] {
  const byId = new Map<string, WorkspaceTopic>();
  for (const t of BUILTIN_TOPICS) byId.set(t.id, { ...t, origin: 'builtin', projects: [] });
  for (const t of config.topics) {
    const def: WorkspaceTopic = { id: t.id, label: t.label, aliases: t.aliases, related: t.related, hubs: t.hubs, specificity: t.specificity, origin: 'config', projects: [] };
    if (t.parent) def.parent = t.parent;
    byId.set(t.id, def);
  }
  for (const project of config.projects) {
    for (const entry of normalizeGlossary(project.glossary)) {
      const id = glossaryTopicId(entry);
      const existing = byId.get(id);
      if (existing && existing.origin !== 'glossary') {
        // A project term that reuses a built-in id (e.g. "sqlite" → databases) extends it.
        existing.aliases = [...new Set([...existing.aliases, entry.term, ...entry.aliases])];
        existing.projects = [...new Set([...existing.projects, project.id])];
        continue;
      }
      byId.set(id, {
        id,
        label: entry.term,
        aliases: [...new Set(entry.aliases)],
        related: entry.related,
        specificity: 'project' as TopicSpecificity,
        origin: 'glossary',
        projects: [...new Set([...(existing?.projects ?? []), project.id])],
      });
    }
  }
  return [...byId.values()];
}

/** Upserts topic definitions. Topics that disappeared from the config stay (history refers to them). */
export function syncTopics(db: StoryDb, topics: readonly WorkspaceTopic[], now: string): void {
  db.tx(() => {
    for (const t of topics) {
      db.run(
        `INSERT INTO topics (id, label, aliases, parent_id, origin, specificity, related, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, aliases = excluded.aliases, origin = excluded.origin,
           specificity = excluded.specificity, related = excluded.related, updated_at = excluded.updated_at`,
        [t.id, t.label, json(t.aliases), t.origin, t.specificity, json(t.related ?? []), now, now],
      );
    }
    // Parents in a second pass so declaration order does not matter.
    for (const t of topics) if (t.parent && topics.some((p) => p.id === t.parent)) db.run('UPDATE topics SET parent_id = ? WHERE id = ?', [t.parent, t.id]);
  });
}

export interface StoredTopic {
  id: string;
  label: string;
  aliases: string[];
  parentId?: string;
  origin: TopicOrigin;
  specificity: TopicSpecificity;
  related: string[];
}

export function loadTopics(db: StoryDb): StoredTopic[] {
  return db.all<{ id: string; label: string; aliases: string; parent_id: string | null; origin: string; specificity: string; related: string }>('SELECT id, label, aliases, parent_id, origin, specificity, related FROM topics ORDER BY id').map((r) => {
    const t: StoredTopic = { id: r.id, label: r.label, aliases: parseJson(r.aliases, []), origin: r.origin as TopicOrigin, specificity: r.specificity as TopicSpecificity, related: parseJson(r.related, []) };
    if (r.parent_id) t.parentId = r.parent_id;
    return t;
  });
}

/** Resolves free text ("AI agents", "ai-agents", an alias) to a known topic id. */
export function resolveTopic(topics: readonly WorkspaceTopic[] | readonly StoredTopic[], query: string): string | undefined {
  const q = query.trim().toLowerCase();
  const exact = topics.find((t) => t.id === q || t.label.toLowerCase() === q || t.aliases.some((a) => a.toLowerCase() === q));
  if (exact) return exact.id;
  const compiled = compileTopics(topics.map((t) => ({ id: t.id, label: t.label, aliases: t.aliases, specificity: t.specificity })));
  const matches = matchTopics({ title: query }, compiled);
  return matches.length === 1 ? matches[0]!.topicId : undefined;
}

/** Compiles stored topics for matching (parent ids included, so children roll up). */
export function compileStoredTopics(topics: readonly StoredTopic[]): CompiledTopic[] {
  return compileTopics(topics.map((t) => ({ id: t.id, label: t.label, aliases: t.aliases, specificity: t.specificity, related: t.related, ...(t.parentId ? { parent: t.parentId } : {}) })));
}

/**
 * (Re)assigns topics to platform articles from their title, hubs and tags.
 * A child topic also counts for its parent ("RAG" → "AI / LLM"), recorded
 * with method "parent".
 */
export function tagPlatformArticles(db: StoryDb, compiled: readonly CompiledTopic[], articleIds?: readonly string[]): number {
  const rows = articleIds?.length
    ? db.all<{ id: string; title: string; hubs: string; tags: string }>(`SELECT id, title, hubs, tags FROM platform_articles WHERE id IN (${articleIds.map(() => '?').join(',')})`, articleIds)
    : db.all<{ id: string; title: string; hubs: string; tags: string }>('SELECT id, title, hubs, tags FROM platform_articles');
  let links = 0;
  const parents = new Map(compiled.filter((c) => c.def.parent).map((c) => [c.def.id, c.def.parent!]));
  db.tx(() => {
    for (const r of rows) {
      db.run('DELETE FROM platform_article_topics WHERE article_id = ?', [r.id]);
      const matched = matchTopics({ title: r.title, hubs: parseJson(r.hubs, []), tags: parseJson(r.tags, []) }, compiled);
      const ids = new Set(matched.map((m) => m.topicId));
      const rows: Array<[string, string]> = matched.map((m) => [m.topicId, m.method]);
      for (const m of matched) {
        let parent = parents.get(m.topicId);
        for (let depth = 0; parent && depth < 4; depth += 1) {
          if (!ids.has(parent)) {
            ids.add(parent);
            rows.push([parent, 'parent']);
          }
          parent = parents.get(parent);
        }
      }
      for (const [topicId, method] of rows) {
        db.run('INSERT OR IGNORE INTO platform_article_topics (article_id, topic_id, method) VALUES (?, ?, ?)', [r.id, topicId, method]);
        links += 1;
      }
    }
  });
  return links;
}

/**
 * Per-topic share of one research run's sample. This is the history that
 * trend direction is computed from.
 */
export function recordTrendSnapshots(db: StoryDb, runId: number): number {
  const run = db.get<{ platform_id: string; collected_at: string; sample_size: number }>('SELECT platform_id, collected_at, sample_size FROM research_runs WHERE id = ?', [runId]);
  if (!run) return 0;
  const sample = db.value<number>('SELECT COUNT(*) FROM research_run_articles WHERE run_id = ?', [runId]) ?? 0;
  if (sample === 0) return 0;
  const scored = db.value<number>('SELECT COUNT(*) FROM research_run_articles WHERE run_id = ? AND momentum_rank IS NOT NULL', [runId]) ?? 0;
  const rows = db.all<{ topic_id: string; article_id: string; author: string | null; momentum_rank: number | null }>(
    `SELECT pat.topic_id, ra.article_id, a.author, ra.momentum_rank
       FROM research_run_articles ra
       JOIN platform_article_topics pat ON pat.article_id = ra.article_id
       JOIN platform_articles a ON a.id = ra.article_id
      WHERE ra.run_id = ?`,
    [runId],
  );
  const byTopic = new Map<string, typeof rows>();
  for (const r of rows) byTopic.set(r.topic_id, [...(byTopic.get(r.topic_id) ?? []), r]);
  db.tx(() => {
    db.run('DELETE FROM trend_snapshots WHERE run_id = ?', [runId]);
    for (const [topicId, list] of byTopic) {
      const percentiles = list.filter((x) => x.momentum_rank !== null && scored > 1).map((x) => 1 - (x.momentum_rank! - 1) / (scored - 1));
      db.run(
        'INSERT INTO trend_snapshots (run_id, platform_id, topic_id, taken_at, sample_size, article_count, share, author_count, median_momentum_percentile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [runId, run.platform_id, topicId, run.collected_at, sample, list.length, list.length / sample, new Set(list.map((x) => x.author ?? x.article_id)).size, percentiles.length ? median(percentiles) : null],
      );
    }
  });
  return byTopic.size;
}

export function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
