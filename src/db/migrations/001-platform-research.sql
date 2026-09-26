-- 001: platform intelligence and research history.
-- Research runs accumulate; an article observed in several runs is ONE row in
-- platform_articles with one metric observation per run. External article
-- bodies are never stored: only metadata, metrics and abstract features.

CREATE TABLE platforms (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  live_research TEXT NOT NULL,
  first_seen_at TEXT NOT NULL
);

CREATE TABLE research_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  collected_at TEXT NOT NULL,
  -- live | cache | partial | import | legacy-snapshot
  origin TEXT NOT NULL,
  status TEXT NOT NULL,
  label TEXT,
  periods TEXT NOT NULL DEFAULT '[]',
  hubs TEXT NOT NULL DEFAULT '[]',
  windows TEXT NOT NULL DEFAULT '[]',
  sample_size INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  cached_source_count INTEGER NOT NULL DEFAULT 0,
  failures TEXT NOT NULL DEFAULT '[]',
  limitations TEXT NOT NULL DEFAULT '[]',
  momentum_formula TEXT,
  -- sha256 of the imported snapshot or dataset: importing the same file twice is a no-op.
  fingerprint TEXT,
  UNIQUE (platform_id, fingerprint)
);
CREATE INDEX research_runs_platform_time ON research_runs(platform_id, collected_at);

CREATE TABLE platform_articles (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  published_at TEXT,
  hubs TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (platform_id, canonical_url)
);
CREATE INDEX platform_articles_published ON platform_articles(platform_id, published_at);

CREATE TABLE research_run_articles (
  run_id INTEGER NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES platform_articles(id) ON DELETE CASCADE,
  seen_in TEXT NOT NULL DEFAULT '[]',
  momentum_rank INTEGER,
  lifetime_rank INTEGER,
  PRIMARY KEY (run_id, article_id)
);

CREATE TABLE platform_article_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id TEXT NOT NULL REFERENCES platform_articles(id) ON DELETE CASCADE,
  run_id INTEGER NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  views REAL,
  views_approximate INTEGER,
  rating REAL,
  votes REAL,
  comments REAL,
  bookmarks REAL,
  reading_time_minutes REAL,
  momentum_score REAL,
  momentum_coverage REAL,
  age_hours REAL,
  UNIQUE (article_id, run_id)
);

CREATE TABLE platform_article_features (
  article_id TEXT PRIMARY KEY REFERENCES platform_articles(id) ON DELETE CASCADE,
  -- hash of the abstract feature vector (never of external text)
  content_hash TEXT NOT NULL,
  extracted_at TEXT NOT NULL,
  has_body INTEGER NOT NULL,
  word_count INTEGER,
  heading_count INTEGER,
  heading_density REAL,
  intro_words INTEGER,
  code_blocks INTEGER,
  code_density REAL,
  image_count INTEGER,
  diagram_count INTEGER,
  list_density REAL,
  quote_density REAL,
  first_person INTEGER,
  conflict_first INTEGER,
  number_in_headline INTEGER,
  question_headline INTEGER,
  before_after INTEGER,
  postmortem INTEGER,
  tutorial INTEGER,
  architecture INTEGER,
  measurements INTEGER,
  conclusion_kind TEXT,
  -- the abstract structural feature record (counts and booleans; no text)
  structure TEXT
);

CREATE TABLE pattern_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  pattern_id TEXT NOT NULL,
  statement TEXT NOT NULL,
  strength TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  group_size INTEGER,
  comparison_size INTEGER,
  top_share REAL,
  rest_share REAL,
  observation_values TEXT NOT NULL DEFAULT '{}',
  article_ids TEXT NOT NULL DEFAULT '[]',
  limitations TEXT NOT NULL DEFAULT '[]',
  UNIQUE (run_id, pattern_id)
);
