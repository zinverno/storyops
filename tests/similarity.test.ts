import { describe, expect, it } from 'vitest';
import { compare, cosine, Corpus, features, jaccard, overlapLevel } from '../src/similarity/index.js';
import { slugify, stem, tokenize } from '../src/shared/text.js';

describe('text normalisation', () => {
  it('stems Russian and English word forms to the same key', () => {
    expect(stem('архитектура')).toBe(stem('архитектуры'));
    expect(stem('правила')).toBe(stem('правило'));
    expect(stem('findings')).toBe(stem('finding'));
    expect(tokenize('Ни для кого не секрет, что ИИ')).toEqual(['секрет', 'ии']);
  });

  it('transliterates slugs', () => {
    expect(slugify('Жизненный цикл находок')).toBe('zhiznennyy-tsikl-nahodok');
    expect(slugify('!!!')).toBe('untitled');
  });
});

describe('deterministic similarity', () => {
  it('cosine is 1 for identical and 0 for disjoint vectors', () => {
    const a = features('модель здоровья хранилища');
    expect(cosine(a, a)).toBeCloseTo(1, 10);
    expect(cosine(a, features('планировщик задач'))).toBe(0);
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('ranks the most similar document first with shared terms', () => {
    const docs = [
      { id: 'lifecycle', text: 'Жизненный цикл находок: open, acknowledged, resolved' },
      { id: 'build', text: 'Как мы ускорили сборку монорепозитория' },
      { id: 'audit', text: 'Разовый аудит заметок и правила аудита' },
    ];
    const res = compare({ id: 'q', text: 'жизненный цикл находок в хранилище' }, docs);
    expect(res[0]!.id).toBe('lifecycle');
    expect(res[0]!.sharedTerms).toContain('цикл находок');
    expect(overlapLevel(res[0]!)).toBe('high');
    expect(overlapLevel(res.find((r) => r.id === 'build')!)).toBe('low');
  });

  it('is stable across runs and input order for identical scores', () => {
    const docs = [
      { id: 'b', text: 'alpha beta' },
      { id: 'a', text: 'alpha beta' },
    ];
    const r1 = compare({ id: 'q', text: 'alpha' }, docs);
    const r2 = compare({ id: 'q', text: 'alpha' }, [...docs].reverse());
    expect(r1.map((r) => r.id)).toEqual(['a', 'b']);
    expect(r1).toEqual(r2);
  });

  it('computes smoothed idf and BM25 over a corpus', () => {
    const corpus = new Corpus([{ id: '1', text: 'кэш кэш запрос' }, { id: '2', text: 'запрос ответ' }]);
    expect(corpus.idf('кэш')).toBeGreaterThan(corpus.idf('запрос'));
    const q = features('кэш');
    expect(corpus.bm25(q, corpus.docs[0]!)).toBeGreaterThan(corpus.bm25(q, corpus.docs[1]!));
  });
});
