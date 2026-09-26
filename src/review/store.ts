import { json, parseJson, type StoryDb } from '../db/database.js';
import { StoryOpsError } from '../shared/errors.js';
import type { FindingStatus, ReviewReport } from './types.js';

/**
 * Review persistence: reports, findings, local alternatives and the author's
 * decisions. Decisions are keyed by (article, fingerprint) so a dismissed
 * finding stays dismissed in later reviews of the same article.
 */

export function storeReview(db: StoryDb, r: ReviewReport): void {
  db.tx(() => {
    db.run('DELETE FROM reviews WHERE id = ?', [r.id]);
    db.run('INSERT INTO reviews (id, article_key, article_path, article_hash, created_at, profile, options, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [r.id, r.article.key, r.article.path, r.article.sha256, r.generatedAt, r.profile, json(r.context), json(r.summary)]);
    for (const f of r.findings) {
      const id = `${r.id}:${f.id}`;
      db.run(
        `INSERT INTO review_findings (id, review_id, fingerprint, category, rule, severity, line_start, line_end, excerpt, problem, why, suggestion, evidence, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, r.id, f.fingerprint, f.category, f.rule, f.severity, f.lines?.start, f.lines?.end, f.excerpt ?? null, f.problem, f.why, f.suggestion, f.evidence ? json(f.evidence) : null, f.status],
      );
      if (f.alternative) db.run('INSERT INTO review_suggestions (finding_id, alternative, span_chars) VALUES (?, ?, ?)', [id, f.alternative, f.alternative.length]);
    }
  });
}

export function loadDecisions(db: StoryDb, articleKey: string): Map<string, { status: FindingStatus; decidedAt: string }> {
  return new Map(db.all<{ fingerprint: string; status: string; decided_at: string }>('SELECT fingerprint, status, decided_at FROM review_decisions WHERE article_key = ?', [articleKey]).map((r) => [r.fingerprint, { status: r.status as FindingStatus, decidedAt: r.decided_at }]));
}

export function latestReviewId(db: StoryDb, articleKey?: string): string | undefined {
  return db.value<string>(`SELECT id FROM reviews ${articleKey ? 'WHERE article_key = ?' : ''} ORDER BY created_at DESC, id DESC LIMIT 1`, articleKey ? [articleKey] : []);
}

export interface StoredFinding {
  id: string;
  reviewId: string;
  category: string;
  rule: string;
  severity: string;
  lines: string;
  problem: string;
  status: string;
}

export function listFindings(db: StoryDb, reviewId: string): StoredFinding[] {
  return db
    .all<{ id: string; review_id: string; category: string; rule: string; severity: string; line_start: number | null; line_end: number | null; problem: string; status: string }>('SELECT * FROM review_findings WHERE review_id = ? ORDER BY id', [reviewId])
    .map((r) => ({ id: r.id.slice(r.id.lastIndexOf(':') + 1), reviewId: r.review_id, category: r.category, rule: r.rule, severity: r.severity, lines: r.line_start ? `L${r.line_start}${r.line_end && r.line_end !== r.line_start ? `–L${r.line_end}` : ''}` : '—', problem: r.problem, status: r.status }));
}

/** Records the author's decision on a finding (and remembers it for future reviews of the article). */
export function setFindingStatus(db: StoryDb, reviewId: string, findingId: string, status: FindingStatus, now: string, note?: string): { articleKey: string; fingerprint: string } {
  const row = db.get<{ fingerprint: string; article_key: string }>('SELECT f.fingerprint, r.article_key FROM review_findings f JOIN reviews r ON r.id = f.review_id WHERE f.id = ?', [`${reviewId}:${findingId}`]);
  if (!row) throw new StoryOpsError('FINDING_UNKNOWN', `No finding ${findingId} in review ${reviewId}`, { hint: 'List findings with `storyops findings list --review <id>`.' });
  db.tx(() => {
    db.run('UPDATE review_findings SET status = ? WHERE id = ?', [status, `${reviewId}:${findingId}`]);
    db.run('INSERT OR REPLACE INTO review_decisions (article_key, fingerprint, status, note, decided_at) VALUES (?, ?, ?, ?, ?)', [row.article_key, row.fingerprint, status, note ?? null, now]);
  });
  return { articleKey: row.article_key, fingerprint: row.fingerprint };
}

export function reviewSummary(db: StoryDb, reviewId: string): Record<string, unknown> | undefined {
  const row = db.get<{ summary: string }>('SELECT summary FROM reviews WHERE id = ?', [reviewId]);
  return row ? parseJson(row.summary, {}) : undefined;
}
