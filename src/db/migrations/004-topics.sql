-- 004: topic intelligence. One canonical `topics` table; platform, author and
-- repository topics are link tables (plus the views platform_topics and
-- author_topics for convenient inspection).

CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  parent_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  -- builtin | config | glossary | module
  origin TEXT NOT NULL,
  -- generic | technology | practice | project
  specificity TEXT NOT NULL,
  related TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE platform_article_topics (
  article_id TEXT NOT NULL REFERENCES platform_articles(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  PRIMARY KEY (article_id, topic_id)
);

CREATE TABLE trend_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  platform_id TEXT NOT NULL,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  taken_at TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  article_count INTEGER NOT NULL,
  share REAL NOT NULL,
  author_count INTEGER NOT NULL,
  median_momentum_percentile REAL,
  UNIQUE (run_id, topic_id)
);
CREATE INDEX trend_snapshots_topic_time ON trend_snapshots(platform_id, topic_id, taken_at);

CREATE TABLE author_topic_coverage (
  author_id TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL REFERENCES author_publications(id) ON DELETE CASCADE,
  -- mentioned | explained | deeply-covered
  level TEXT NOT NULL,
  occurrences INTEGER NOT NULL,
  in_heading INTEGER NOT NULL,
  in_title INTEGER NOT NULL,
  PRIMARY KEY (author_id, topic_id, publication_id)
);

CREATE TABLE repository_topics (
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES repository_events(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  PRIMARY KEY (repository_id, topic_id, event_id)
);

CREATE TABLE topic_candidates (
  id TEXT PRIMARY KEY,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  repository_id TEXT REFERENCES repositories(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE topic_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id TEXT NOT NULL REFERENCES topic_candidates(id) ON DELETE CASCADE,
  generated_at TEXT NOT NULL,
  platform_id TEXT,
  dimensions TEXT NOT NULL,
  report TEXT NOT NULL
);
CREATE INDEX topic_opportunities_candidate ON topic_opportunities(candidate_id, generated_at);

CREATE TABLE topic_overlap (
  candidate_id TEXT NOT NULL REFERENCES topic_candidates(id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL REFERENCES author_publications(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  coverage TEXT NOT NULL,
  shared_terms TEXT NOT NULL DEFAULT '[]',
  computed_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, publication_id)
);

CREATE VIEW platform_topics AS
  SELECT pat.topic_id AS topic_id,
         a.platform_id AS platform_id,
         COUNT(*) AS article_count,
         COUNT(DISTINCT a.author) AS author_count,
         MIN(a.published_at) AS first_published_at,
         MAX(a.published_at) AS last_published_at,
         MIN(a.first_seen_at) AS first_seen_at,
         MAX(a.last_seen_at) AS last_seen_at
    FROM platform_article_topics pat
    JOIN platform_articles a ON a.id = pat.article_id
   GROUP BY pat.topic_id, a.platform_id;

CREATE VIEW author_topics AS
  SELECT c.author_id AS author_id,
         c.topic_id AS topic_id,
         COUNT(*) AS publications,
         SUM(CASE WHEN c.level = 'deeply-covered' THEN 1 ELSE 0 END) AS deep_publications,
         MAX(p.published_at) AS last_published_at
    FROM author_topic_coverage c
    JOIN author_publications p ON p.id = c.publication_id
   GROUP BY c.author_id, c.topic_id;
