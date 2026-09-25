import path from 'node:path';
import { json, parseJson, type StoryDb } from '../db/database.js';
import type { ProjectReport } from '../project/schema.js';
import { hashJson } from '../shared/hash.js';
import { slugify } from '../shared/text.js';
import { compileTopics, matchTopics } from '../topics/match.js';
import { syncTopics, type StoredTopic, type WorkspaceTopic } from '../topics/registry.js';
import { sortEvents, type EventBasis, type EventEvidence, type EventType, type EvidenceStrength, type RepoEvent } from './events.js';

/**
 * Repository snapshots, events and the repository topic map in the database.
 * Events are keyed by a content-derived id, so re-inspecting an unchanged
 * repository updates `last_seen_at` instead of duplicating events.
 */

export function ensureRepository(db: StoryDb, repo: { id: string; name: string; path?: string }, now: string): void {
  db.run(`INSERT INTO repositories (id, name, path, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, path = excluded.path`, [repo.id, repo.name, repo.path ?? null, now]);
}

export function recordSnapshot(db: StoryDb, report: ProjectReport): { snapshotId: number; unchanged: boolean } {
  const { inspectedAt: _at, root: _root, ...content } = report;
  const hash = hashJson(content);
  const existing = db.get<{ id: number }>('SELECT id FROM repository_snapshots WHERE repository_id = ? AND report_hash = ?', [report.projectId, hash]);
  if (existing) return { snapshotId: existing.id, unchanged: true };
  const r = db.run('INSERT INTO repository_snapshots (repository_id, inspected_at, head, commit_count, tag_count, report_hash, report) VALUES (?, ?, ?, ?, ?, ?, ?)', [report.projectId, report.inspectedAt, report.head ?? null, report.commits.length, report.tags.length, hash, json(report)]);
  return { snapshotId: r.lastInsertRowid, unchanged: false };
}

export function latestReport(db: StoryDb, repoId: string): ProjectReport | undefined {
  const row = db.get<{ report: string }>('SELECT report FROM repository_snapshots WHERE repository_id = ? ORDER BY inspected_at DESC, id DESC LIMIT 1', [repoId]);
  return row ? parseJson<ProjectReport | undefined>(row.report, undefined) : undefined;
}

export function storeEvents(db: StoryDb, events: readonly RepoEvent[], snapshotId: number, now: string): { added: number; seenAgain: number } {
  let added = 0;
  let seenAgain = 0;
  db.tx(() => {
    for (const e of events) {
      const exists = db.get('SELECT id FROM repository_events WHERE id = ?', [e.id]);
      if (exists) {
        seenAgain += 1;
        db.run('UPDATE repository_events SET snapshot_id = ?, summary = ?, date_end = ?, evidence_strength = ?, strength_reason = ?, terms = ?, aspects = ?, confidence_note = ?, files = ?, commits = ?, type = ?, last_seen_at = ? WHERE id = ?', [snapshotId, e.summary, e.dateEnd, e.evidenceStrength, e.strengthReason, json(e.terms), json(e.aspects), e.confidenceNote, json(e.files), json(e.commits), e.type, now, e.id]);
        db.run('DELETE FROM repository_evidence WHERE event_id = ?', [e.id]);
      } else {
        added += 1;
        db.run(
          `INSERT INTO repository_events (id, repository_id, snapshot_id, type, date_start, date_end, summary, subsystem, files, commits, evidence_strength, strength_reason, basis, confidence_note, aspects, terms, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [e.id, e.repositoryId, snapshotId, e.type, e.dateStart, e.dateEnd, e.summary, e.subsystem ?? null, json(e.files), json(e.commits), e.evidenceStrength, e.strengthReason, e.basis, e.confidenceNote, json(e.aspects), json(e.terms), now, now],
        );
      }
      for (const ev of e.evidence) db.run('INSERT OR IGNORE INTO repository_evidence (event_id, kind, ref, note) VALUES (?, ?, ?, ?)', [e.id, ev.kind, ev.ref, ev.note ?? null]);
    }
  });
  return { added, seenAgain };
}

export function loadEvents(db: StoryDb, repoId: string, options: { since?: string; types?: readonly string[] } = {}): RepoEvent[] {
  const where = ['repository_id = ?'];
  const params: string[] = [repoId];
  if (options.since) {
    where.push('date_end >= ?');
    params.push(options.since);
  }
  if (options.types?.length) {
    where.push(`type IN (${options.types.map(() => '?').join(',')})`);
    params.push(...options.types);
  }
  const rows = db.all<{ id: string; repository_id: string; type: string; date_start: string; date_end: string; summary: string; subsystem: string | null; files: string; commits: string; evidence_strength: string; strength_reason: string; basis: string; confidence_note: string; aspects: string; terms: string }>(
    `SELECT * FROM repository_events WHERE ${where.join(' AND ')} ORDER BY date_end, id`,
    params,
  );
  return sortEvents(rows.map((r) => {
    const e: RepoEvent = {
      id: r.id,
      repositoryId: r.repository_id,
      type: r.type as EventType,
      aspects: parseJson<EventType[]>(r.aspects, []),
      dateStart: r.date_start,
      dateEnd: r.date_end,
      summary: r.summary,
      files: parseJson(r.files, []),
      commits: parseJson(r.commits, []),
      evidence: db.all<{ kind: string; ref: string; note: string | null }>('SELECT kind, ref, note FROM repository_evidence WHERE event_id = ? ORDER BY id', [r.id]).map((x) => ({ kind: x.kind as EventEvidence['kind'], ref: x.ref, ...(x.note ? { note: x.note } : {}) })),
      evidenceStrength: r.evidence_strength as EvidenceStrength,
      strengthReason: r.strength_reason,
      basis: r.basis as EventBasis,
      terms: parseJson(r.terms, []),
      confidenceNote: r.confidence_note,
    };
    if (r.subsystem) e.subsystem = r.subsystem;
    return e;
  }));
}

export interface RepoTopicLink {
  topicId: string;
  eventId: string;
  method: string;
}

/**
 * Maps events to topics: glossary/config/built-in aliases matched against the
 * event's terms; a subsystem that matches no project topic gets a module
 * topic named after it (origin "module"). Returns the new module topics.
 */
export function mapRepositoryTopics(db: StoryDb, repoId: string, events: readonly RepoEvent[], topics: readonly WorkspaceTopic[], now: string): { links: RepoTopicLink[]; moduleTopics: WorkspaceTopic[] } {
  const compiled = compileTopics(topics);
  const projectTopicIds = new Set(topics.filter((t) => t.specificity === 'project' || t.origin === 'config').map((t) => t.id));
  const links: RepoTopicLink[] = [];
  const moduleTopics = new Map<string, WorkspaceTopic>();
  for (const e of events) {
    if (e.type === 'release') continue;
    const matches = matchTopics({ terms: [...e.terms, ...e.files.map((f) => f.replace(/[/_.-]+/g, ' '))] }, compiled);
    for (const m of matches) links.push({ topicId: m.topicId, eventId: e.id, method: `term:${m.alias}` });
    const hasProjectTopic = matches.some((m) => projectTopicIds.has(m.topicId));
    if (!hasProjectTopic && e.subsystem) {
      const name = path.posix.basename(e.subsystem);
      const id = slugify(name, 48);
      if (!topics.some((t) => t.id === id)) {
        moduleTopics.set(id, { id, label: name.replace(/[-_]+/g, ' '), aliases: [name], specificity: 'project', origin: 'module', projects: [repoId] });
      }
      links.push({ topicId: id, eventId: e.id, method: `module:${e.subsystem}` });
    }
  }
  db.tx(() => {
    if (moduleTopics.size) syncTopics(db, [...moduleTopics.values()], now);
    db.run('DELETE FROM repository_topics WHERE repository_id = ?', [repoId]);
    for (const l of links) db.run('INSERT OR IGNORE INTO repository_topics (repository_id, topic_id, event_id, method) VALUES (?, ?, ?, ?)', [repoId, l.topicId, l.eventId, l.method]);
  });
  return { links, moduleTopics: [...moduleTopics.values()] };
}

export interface RepoTopicSummary {
  topicId: string;
  label: string;
  origin: string;
  specificity: string;
  events: RepoEvent[];
  firstEventAt: string;
  lastEventAt: string;
  types: EventType[];
}

export function repositoryTopicMap(db: StoryDb, repoId: string, topics: readonly StoredTopic[]): RepoTopicSummary[] {
  const events = new Map(loadEvents(db, repoId).map((e) => [e.id, e]));
  const rows = db.all<{ topic_id: string; event_id: string }>('SELECT topic_id, event_id FROM repository_topics WHERE repository_id = ? ORDER BY topic_id, event_id', [repoId]);
  const byTopic = new Map<string, RepoEvent[]>();
  for (const r of rows) {
    const e = events.get(r.event_id);
    if (e) byTopic.set(r.topic_id, [...(byTopic.get(r.topic_id) ?? []), e]);
  }
  const topicById = new Map(topics.map((t) => [t.id, t]));
  return [...byTopic]
    .map(([topicId, list]) => {
      const sorted = sortEvents(list);
      const t = topicById.get(topicId);
      return {
        topicId,
        label: t?.label ?? topicId,
        origin: t?.origin ?? 'module',
        specificity: t?.specificity ?? 'project',
        events: sorted,
        firstEventAt: sorted[0]!.dateStart,
        lastEventAt: sorted.map((e) => e.dateEnd).sort().at(-1)!,
        types: [...new Set(sorted.flatMap((e) => [e.type, ...e.aspects]))],
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
