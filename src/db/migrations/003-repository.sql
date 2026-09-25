-- 003: repository intelligence. Events are candidates inferred from history,
-- docs and paths; `basis` and `evidence_strength` say how much to trust them.

CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE repository_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  inspected_at TEXT NOT NULL,
  head TEXT,
  commit_count INTEGER NOT NULL,
  tag_count INTEGER NOT NULL,
  report_hash TEXT NOT NULL,
  report TEXT NOT NULL,
  UNIQUE (repository_id, report_hash)
);

CREATE TABLE repository_events (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  snapshot_id INTEGER REFERENCES repository_snapshots(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  date_start TEXT NOT NULL,
  date_end TEXT NOT NULL,
  summary TEXT NOT NULL,
  subsystem TEXT,
  files TEXT NOT NULL DEFAULT '[]',
  commits TEXT NOT NULL DEFAULT '[]',
  evidence_strength TEXT NOT NULL,
  strength_reason TEXT NOT NULL,
  -- commit-message | paths | docs | tags (what the type was inferred from)
  basis TEXT NOT NULL,
  confidence_note TEXT NOT NULL DEFAULT '',
  aspects TEXT NOT NULL DEFAULT '[]',
  terms TEXT NOT NULL DEFAULT '[]',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX repository_events_repo_date ON repository_events(repository_id, date_end);

CREATE TABLE repository_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES repository_events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  note TEXT,
  UNIQUE (event_id, kind, ref)
);
