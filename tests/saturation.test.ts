import { describe, expect, it } from 'vitest';
import { saturationThresholdsSchema } from '../src/config/schema.js';
import { activityLevel, analyzeSaturation, headlineRepetition, type WindowArticle } from '../src/topics/saturation.js';

const thresholds = saturationThresholdsSchema.parse({});
const window = { start: '2026-08-25T00:00:00.000Z', end: '2026-09-24T00:00:00.000Z' };

let n = 0;
/** `count` articles on `topic` plus `rest` unrelated ones, each by a different author. */
function sample(count: number, rest: number, options: { topic?: string; titles?: string[]; author?: (i: number) => string; day?: string } = {}): WindowArticle[] {
  const topic = options.topic ?? 'ai-agents';
  const out: WindowArticle[] = [];
  for (let i = 0; i < count; i += 1) out.push({ id: `t${(n += 1)}`, title: options.titles?.[i % options.titles.length] ?? `Тема ${n}`, author: options.author?.(i) ?? `author-${n}`, publishedAt: options.day ?? '2026-09-10T10:00:00.000Z', topics: [topic], momentumPercentile: 0.5 });
  for (let i = 0; i < rest; i += 1) out.push({ id: `o${(n += 1)}`, title: `Другое ${n}`, author: `author-${n}`, publishedAt: options.day ?? '2026-09-10T10:00:00.000Z', topics: ['other'] });
  return out;
}

const analyze = (current: WindowArticle[], previous: WindowArticle[] = []) => analyzeSaturation({ platform: 'habr', topicId: 'ai-agents', label: 'AI agents', aliases: ['ai agent'], window, current, previous, thresholds });

describe('topic saturation', () => {
  it('insufficient data: a tiny window gets no other state', () => {
    const r = analyze(sample(5, 5));
    expect(r.state).toBe('insufficient-data');
    expect(r.because[0]).toMatch(/only 10 article\(s\) in the 30-day window \(minimum 15\)/);
  });

  it('sparse: one article in a normal sample', () => {
    const r = analyze(sample(1, 59), sample(1, 59, { day: '2026-08-10T10:00:00.000Z' }));
    expect(r.state).toBe('sparse');
    expect(r.metrics).toMatchObject({ articleCount: 1, sampleSize: 60 });
  });

  it('emerging: a small but fast-growing share', () => {
    const r = analyze(sample(4, 56), sample(2, 58, { day: '2026-08-10T10:00:00.000Z' }));
    expect(r.state).toBe('emerging');
    expect(r.metrics.growth).toBe(1);
    expect(r.because.join(' ')).toMatch(/\+100% articles vs the previous 30-day window \(2 → 4\)/);
  });

  it('active: a steady share above the active threshold', () => {
    const r = analyze(sample(5, 55), sample(5, 55, { day: '2026-08-10T10:00:00.000Z' }));
    expect(r.state).toBe('active');
    expect(r.metrics.growth).toBe(0);
  });

  it('crowded: share ≥ 15%', () => {
    const r = analyze(sample(12, 48));
    expect(r.state).toBe('crowded');
    expect(r.because[0]).toBe('12 of 60 articles (20%) in the window');
  });

  it('highly saturated: share ≥ 30%, with every dimension exposed', () => {
    const titles = ['ИИ-агенты в CI: автоматизация ревью', 'ИИ-агенты в CI: автоматизация тестов', 'ИИ-агенты в CI: автоматизация релизов'];
    const r = analyze(sample(20, 30, { titles, author: (i) => (i < 10 ? 'prolific' : `writer-${i}`) }), sample(10, 40, { day: '2026-08-10T10:00:00.000Z' }));
    expect(r.state).toBe('highly-saturated');
    expect(r.metrics).toMatchObject({ articleCount: 20, sampleSize: 50, share: 0.4, previousCount: 10, growth: 1, authorCount: 11, topAuthorShare: 0.5 });
    expect(r.metrics.headlineRepetition).toBeGreaterThanOrEqual(0.2);
    expect(r.metrics.averageAgeDays).toBe(13.6);
    expect(r.metrics.momentum).toMatchObject({ scored: 20, medianPercentile: 0.5, inTopThird: 0 });
    expect(r.because).toEqual(expect.arrayContaining(['20 of 50 articles (40%) in the window', '11 distinct author(s)']));
    expect(r.rules.find((x) => x.matched)?.state).toBe('highly-saturated');
    expect(r.limitations.join(' ')).toMatch(/says nothing about the quality/);
  });

  it('thresholds come from configuration, not from topic-specific code', () => {
    const strict = saturationThresholdsSchema.parse({ highlySaturatedShare: 0.5, crowdedShare: 0.45 });
    const r = analyzeSaturation({ platform: 'habr', topicId: 'ai-agents', label: 'AI agents', window, current: sample(20, 30), previous: [], thresholds: strict });
    expect(r.state).toBe('active');
  });

  it('activity level follows the state, so the two never disagree', () => {
    expect(activityLevel(analyze(sample(1, 59)), thresholds).level).toBe('low');
    expect(activityLevel(analyze(sample(5, 55), sample(5, 55)), thresholds).level).toBe('medium');
    expect(activityLevel(analyze(sample(20, 30)), thresholds).level).toBe('high');
    expect(activityLevel(analyze(sample(2, 3)), thresholds).level).toBe('unknown');
  });

  it('headline repetition ignores the topic words themselves', () => {
    expect(headlineRepetition(['ИИ в тестировании', 'ИИ в логистике', 'ИИ в медицине'], ['ИИ'])).toBe(0);
    expect(headlineRepetition(['Кэш в Go: ошибки', 'Кэш в Go: ошибки и выводы'], [])).toBeGreaterThan(0.5);
  });
});
