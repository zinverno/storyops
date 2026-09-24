import { describe, expect, it } from 'vitest';
import { computeMomentum } from '../src/research/momentum.js';
import { extractObservations, saturatedAngles, splitByMomentum } from '../src/research/patterns.js';
import { analyseArticles } from '../src/research/runner.js';
import { structuralFeatures, titleFeatures } from '../src/research/structure.js';
import type { TrendArticle } from '../src/research/types.js';

const NOW = new Date('2026-09-24T12:00:00.000Z');

function article(id: string, title: string, hoursAgo: number, metrics: TrendArticle['metrics'], conflictEarly = false): TrendArticle {
  return {
    id,
    platform: 'habr',
    url: `https://habr.com/ru/articles/${id}/`,
    title,
    publishedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
    hubs: [],
    tags: [],
    metrics,
    seenIn: ['weekly'],
    warnings: [],
    titleFeatures: titleFeatures(title),
    structure: structuralFeatures(
      conflictEarly
        ? [{ type: 'paragraph', text: 'Сервис падал каждую ночь, и мы не понимали почему.' }, { type: 'code', lines: 3 }]
        : [{ type: 'paragraph', text: 'Сегодня поговорим о разных интересных вещах вокруг разработки.' }, { type: 'heading', level: 2, text: 'Заключение' }],
    ),
  };
}

describe('heuristic momentum', () => {
  it('normalises by age: a fresh article can outrank an old one with more views', () => {
    const fresh = computeMomentum({ views: 5000, rating: 30, bookmarks: 40, comments: 10 }, '2026-09-24T00:00:00.000Z', NOW)!;
    const old = computeMomentum({ views: 50000, rating: 60, bookmarks: 300, comments: 80 }, '2025-09-24T00:00:00.000Z', NOW)!;
    expect(fresh.score).toBeGreaterThan(old.score);
    expect(fresh.ageHours).toBe(12);
  });

  it('excludes missing metrics instead of treating them as zero', () => {
    const full = computeMomentum({ views: 1000, rating: 10, bookmarks: 10, comments: 10 }, '2026-09-23T12:00:00.000Z', NOW)!;
    const partial = computeMomentum({ views: 1000 }, '2026-09-23T12:00:00.000Z', NOW)!;
    expect(partial.missing).toEqual(['rating', 'bookmarks', 'comments']);
    expect(partial.coverage).toBe(0.4);
    expect(full.coverage).toBe(1);
    expect(partial.score).toBeGreaterThan(0);
    expect(computeMomentum({}, '2026-09-23T12:00:00.000Z', NOW)).toMatchObject({ score: 0, coverage: 0 });
    expect(computeMomentum({ views: 1 }, undefined, NOW)).toBeUndefined();
  });

  it('is stable: fixed inputs give fixed scores', () => {
    const m = computeMomentum({ views: 18000, rating: 64, bookmarks: 140, comments: 58 }, '2026-09-22T09:00:00.000Z', NOW)!;
    expect(m).toEqual({
      // log10(1+18000/51)=2.5489, log10(1+64/2.125)=1.4930, log10(1+140/2.125)=1.8253, log10(1+58/2.125)=1.4517
      score: 1.9756,
      ageHours: 51,
      components: { viewVelocity: 2.5489, ratingVelocity: 1.493, bookmarkVelocity: 1.8253, commentVelocity: 1.4517 },
      missing: [],
      coverage: 1,
    });
  });

  it('separates recent momentum from lifetime popularity', () => {
    const arts = [article('old', 'Старая популярная статья', 24 * 300, { views: 90000, rating: 80, bookmarks: 500, comments: 90 }), article('new', 'Свежая статья', 10, { views: 6000, rating: 40, bookmarks: 50, comments: 20 })];
    analyseArticles(arts, NOW);
    expect(arts.find((a) => a.id === 'old')!.lifetimeRank).toBe(1);
    expect(arts.find((a) => a.id === 'new')!.momentumRank).toBe(1);
  });
});

describe('pattern extraction', () => {
  const sample = () => {
    const arts = [
      article('1', 'Почему наш кэш падал по ночам', 20, { views: 9000, rating: 40, bookmarks: 60, comments: 30 }, true),
      article('2', 'Утечка памяти, которую мы не видели', 30, { views: 8000, rating: 35, bookmarks: 50, comments: 20 }, true),
      article('3', 'Как мы потеряли события и нашли баг', 25, { views: 7000, rating: 30, bookmarks: 45, comments: 25 }, true),
      article('4', 'ИИ и будущее разработки', 150, { views: 5000, rating: 2, bookmarks: 5, comments: 10 }),
      article('5', 'Нейросети в работе программиста', 140, { views: 4000, rating: 1, bookmarks: 4, comments: 8 }),
      article('6', 'ИИ-ассистенты: обзор', 160, { views: 3000, rating: 3, bookmarks: 6, comments: 3 }),
      article('7', 'Подборка инструментов', 130, { views: 2000, rating: 1, bookmarks: 3, comments: 2 }),
    ];
    analyseArticles(arts, NOW);
    return arts;
  };

  it('reports observations with sample sizes and limitations, never recommendations', () => {
    const arts = sample();
    expect(splitByMomentum(arts).top.map((a) => a.id).sort()).toEqual(['1', '2', '3']);
    const obs = extractObservations(arts, 'weekly');
    const early = obs.find((o) => o.id === 'body-conflict-early')!;
    expect(early.values).toMatchObject({ topHits: 3, topSize: 3, restHits: 0, restSize: 4 });
    expect(early.statement).toMatch(/^In the weekly sample, 3 of 3 higher-momentum articles/);
    expect(early.limitations.join(' ')).toMatch(/Small sample/);
    for (const o of obs) expect(o.statement).not.toMatch(/\b(should|must|always)\b/i);
  });

  it('does not report observations for tiny samples', () => {
    expect(extractObservations(sample().slice(0, 3), 'weekly')).toEqual([]);
  });

  it('detects saturated angles, including the generic AI angle', () => {
    const angles = saturatedAngles(sample());
    expect(angles[0]).toMatchObject({ term: 'ai-generic', count: 3, sampleSize: 7 });
  });
});
