-- 002: author intelligence. The author's own publications (including their
-- text, which belongs to the author) are the basis of the coverage map.

CREATE TABLE authors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_self INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE author_profiles (
  author_id TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  platform_id TEXT NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY (author_id, platform_id)
);

CREATE TABLE author_publications (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  platform_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  canonical_url TEXT,
  published_at TEXT,
  depth TEXT,
  word_count INTEGER,
  projects TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  -- the full Publication record (JSON)
  record TEXT NOT NULL
);
CREATE INDEX author_publications_date ON author_publications(author_id, published_at);
