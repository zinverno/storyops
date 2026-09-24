import { bigrams, tokenize, unique } from '../shared/text.js';

/**
 * Deterministic, inspectable similarity. No embeddings, no external calls.
 *
 * Features: stemmed unigrams + stemmed bigrams (bigrams weighted 1.5×, so
 * shared phrases count more than shared words).
 * - cosine: TF-IDF cosine similarity with smoothed idf = ln((N+1)/(df+1)) + 1
 * - bm25: Okapi BM25 (k1=1.2, b=0.75) of the query against each document,
 *   also reported normalised by the query's self-score so it is in [0,1]
 * - keywordJaccard: |A∩B| / |A∪B| over each side's top-K TF-IDF terms
 * - headingOverlap: Jaccard over stemmed heading tokens
 */

export interface SimilarityDoc {
  id: string;
  text: string;
  headings?: readonly string[];
}

export interface SimilarityResult {
  id: string;
  cosine: number;
  bm25: number;
  bm25Normalized: number;
  keywordJaccard: number;
  headingOverlap: number;
  sharedTerms: string[];
}

export const SIMILARITY_METHOD =
  'TF-IDF cosine over stemmed unigrams+bigrams (idf=ln((N+1)/(df+1))+1, bigrams ×1.5); BM25 k1=1.2 b=0.75 normalised by query self-score; keyword Jaccard over top-20 TF-IDF terms; heading-token Jaccard.';

const BIGRAM_WEIGHT = 1.5;
const TOP_K = 20;

export function features(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const bg of bigrams(tokens)) tf.set(bg, (tf.get(bg) ?? 0) + BIGRAM_WEIGHT);
  return tf;
}

export class Corpus {
  readonly docs: Array<{ id: string; tf: Map<string, number>; length: number; headings: Set<string> }>;
  private readonly df = new Map<string, number>();
  readonly avgLength: number;

  constructor(docs: readonly SimilarityDoc[]) {
    this.docs = docs.map((d) => {
      const tf = features(d.text);
      let length = 0;
      for (const v of tf.values()) length += v;
      return { id: d.id, tf, length, headings: new Set(tokenize((d.headings ?? []).join(' '))) };
    });
    for (const d of this.docs) for (const term of d.tf.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1);
    this.avgLength = this.docs.length ? this.docs.reduce((s, d) => s + d.length, 0) / this.docs.length : 0;
  }

  get size(): number {
    return this.docs.length;
  }

  documentFrequency(term: string): number {
    return this.df.get(term) ?? 0;
  }

  idf(term: string): number {
    return Math.log((this.size + 1) / (this.documentFrequency(term) + 1)) + 1;
  }

  bm25Idf(term: string): number {
    const n = this.documentFrequency(term);
    return Math.log(1 + (this.size - n + 0.5) / (n + 0.5));
  }

  tfidf(tf: Map<string, number>): Map<string, number> {
    const v = new Map<string, number>();
    for (const [term, f] of tf) v.set(term, (1 + Math.log(f)) * this.idf(term));
    return v;
  }

  topTerms(tf: Map<string, number>, k = TOP_K): string[] {
    return [...this.tfidf(tf)]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, k)
      .map(([t]) => t);
  }

  bm25(queryTf: Map<string, number>, doc: { tf: Map<string, number>; length: number }, k1 = 1.2, b = 0.75): number {
    let score = 0;
    const norm = this.avgLength > 0 ? doc.length / this.avgLength : 1;
    for (const term of queryTf.keys()) {
      const f = doc.tf.get(term);
      if (!f) continue;
      score += this.bm25Idf(term) * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * norm)));
    }
    return score;
  }
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    const w = b.get(k);
    if (w !== undefined) dot += v * w;
  }
  for (const v of b.values()) nb += v * v;
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

const r = (n: number) => Math.round(n * 1000) / 1000;

/** Compares a query document against a corpus; results sorted by cosine desc, then id. */
export function compare(query: SimilarityDoc, corpusDocs: readonly SimilarityDoc[]): SimilarityResult[] {
  // The query participates in document frequencies so that idf is stable
  // regardless of whether the corpus shares its vocabulary.
  const corpus = new Corpus([...corpusDocs, query]);
  const q = corpus.docs[corpus.docs.length - 1]!;
  const qVec = corpus.tfidf(q.tf);
  const qTop = new Set(corpus.topTerms(q.tf));
  const selfScore = corpus.bm25(q.tf, q) || 1;
  const results: SimilarityResult[] = [];
  for (const doc of corpus.docs.slice(0, -1)) {
    const dVec = corpus.tfidf(doc.tf);
    const dTop = new Set(corpus.topTerms(doc.tf));
    const shared = unique([...q.tf.keys()].filter((t) => doc.tf.has(t)))
      .sort((a, b) => (qVec.get(b) ?? 0) + (dVec.get(b) ?? 0) - ((qVec.get(a) ?? 0) + (dVec.get(a) ?? 0)) || a.localeCompare(b))
      .slice(0, 12);
    const bm = corpus.bm25(q.tf, doc);
    results.push({
      id: doc.id,
      cosine: r(cosine(qVec, dVec)),
      bm25: r(bm),
      bm25Normalized: r(Math.min(1, bm / selfScore)),
      keywordJaccard: r(jaccard(qTop, dTop)),
      headingOverlap: r(jaccard(q.headings, doc.headings)),
      sharedTerms: shared,
    });
  }
  return results.sort((a, b) => b.cosine - a.cosine || a.id.localeCompare(b.id));
}

/**
 * Coarse overlap level with documented thresholds. We report levels plus the
 * raw numbers instead of a single "percent similar".
 *   high:     cosine ≥ 0.35 or keywordJaccard ≥ 0.30
 *   moderate: cosine ≥ 0.15 or keywordJaccard ≥ 0.12
 *   low:      otherwise
 */
export function overlapLevel(result: Pick<SimilarityResult, 'cosine' | 'keywordJaccard'>): 'high' | 'moderate' | 'low' {
  if (result.cosine >= 0.35 || result.keywordJaccard >= 0.3) return 'high';
  if (result.cosine >= 0.15 || result.keywordJaccard >= 0.12) return 'moderate';
  return 'low';
}
