-- 005: read-only article reviews. Only findings are stored; the reviewed
-- article is never copied into the database (excerpts are short and redacted).

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  article_key TEXT NOT NULL,
  article_path TEXT NOT NULL,
  article_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  profile TEXT,
  options TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX reviews_article ON reviews(article_key, created_at);

CREATE TABLE review_findings (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  category TEXT NOT NULL,
  rule TEXT NOT NULL,
  severity TEXT NOT NULL,
  line_start INTEGER,
  line_end INTEGER,
  excerpt TEXT,
  problem TEXT NOT NULL,
  why TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  evidence TEXT,
  -- open | accepted | dismissed | resolved
  status TEXT NOT NULL
);
CREATE INDEX review_findings_review ON review_findings(review_id);

CREATE TABLE review_suggestions (
  finding_id TEXT PRIMARY KEY REFERENCES review_findings(id) ON DELETE CASCADE,
  alternative TEXT NOT NULL,
  span_chars INTEGER NOT NULL
);

-- Author decisions survive re-reviews of the same article, so an intentionally
-- dismissed finding is not raised again as new.
CREATE TABLE review_decisions (
  article_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  decided_at TEXT NOT NULL,
  PRIMARY KEY (article_key, fingerprint)
);
