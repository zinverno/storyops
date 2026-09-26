import { describe, expect, it } from 'vitest';
import { buildCoverageMap, coverageText, publicationLevel } from '../src/author/coverage.js';
import { publicationSchema, type Publication } from '../src/publications/schema.js';
import type { StoredTopic } from '../src/topics/registry.js';

const NOW = new Date('2026-09-24T12:00:00.000Z');

function pub(id: string, title: string, text: string, options: { date?: string; depth?: 'brief' | 'standard' | 'deep'; headings?: string[] } = {}): Publication {
  return publicationSchema.parse({
    id: `habr:${id}`,
    platform: 'habr',
    title,
    text,
    publicationDate: options.date ?? '2026-03-01T09:00:00.000Z',
    depth: options.depth ?? 'deep',
    headings: (options.headings ?? []).map((h) => ({ level: 2, text: h })),
    source: { adapter: 'test', collectedAt: '2026-09-01T00:00:00.000Z' },
  });
}

const topics: StoredTopic[] = [
  { id: 'semantic-search', label: 'семантический поиск', aliases: ['semantic search'], origin: 'glossary', specificity: 'project', related: [] },
  { id: 'rag', label: 'RAG', aliases: ['rag'], origin: 'builtin', specificity: 'technology', related: [] },
  { id: 'recall', label: 'Recall', aliases: ['recall'], origin: 'glossary', specificity: 'project', related: [] },
  { id: 'finding-lifecycle', label: 'жизненный цикл находок', aliases: ['finding lifecycle'], origin: 'glossary', specificity: 'project', related: [] },
  { id: 'reconciliation', label: 'квитанции сверки', aliases: ['reconciliation'], origin: 'glossary', specificity: 'project', related: [] },
];

const archive = [
  pub('1', 'Семантический поиск по заметкам: как он устроен', `${'Семантический поиск строит эмбеддинги. '.repeat(6)}RAG используется для ответов.`, { headings: ['Семантический поиск изнутри'] }),
  pub('2', 'RAG поверх семантического поиска', `RAG добавляет контекст к ответу. Семантический поиск остаётся основой.`, { date: '2026-05-01T09:00:00.000Z', headings: ['Как устроен RAG'] }),
  pub('3', 'Короткая заметка про Recall', 'Recall появился в интерфейсе.', { depth: 'brief', date: '2026-06-01T09:00:00.000Z' }),
  pub('4', 'Старый обзор', 'Когда-то я описал жизненный цикл находок: finding lifecycle open → resolved. Жизненный цикл находок важен. И ещё раз жизненный цикл находок.', { date: '2024-01-10T09:00:00.000Z', depth: 'standard' }),
];

describe('author coverage map', () => {
  const map = buildCoverageMap(archive, topics, { now: NOW, outdatedAfterDays: 730, latestRepoChange: new Map([['rag', '2026-08-01T00:00:00.000Z']]) });
  const by = (id: string) => map.find((c) => c.topicId === id)!;

  it('distinguishes mentioned, covered and deeply covered', () => {
    expect(by('semantic-search').level).toBe('deeply-covered');
    expect(by('rag').level).toBe('explained');
    expect(by('recall').level).toBe('mentioned');
    expect(by('reconciliation').level).toBe('not-covered');
    expect(coverageText(by('semantic-search'))).toBe('deeply covered, revisited');
  });

  it('brief posts never count as more than a mention, whatever the counts', () => {
    expect(publicationLevel({ depth: 'brief', inTitle: true, inHeading: true, occurrences: 20 })).toBe('mentioned');
    expect(publicationLevel({ depth: 'deep', inTitle: false, inHeading: false, occurrences: 3 })).toBe('explained');
    expect(publicationLevel({ depth: 'deep', inTitle: true, inHeading: false, occurrences: 5 })).toBe('deeply-covered');
  });

  it('tracks revisits, last publication and platform', () => {
    expect(by('semantic-search').revisited).toBe(true);
    expect(by('semantic-search').publications.map((p) => p.publicationId)).toEqual(['habr:1', 'habr:2']);
    expect(by('recall')).toMatchObject({ lastCoveredAt: '2026-06-01T09:00:00.000Z', lastPlatform: 'habr' });
  });

  it('marks coverage outdated by repository changes or age', () => {
    expect(by('rag').outdated).toBe(true);
    expect(by('rag').outdatedReason).toMatch(/repository changes on this topic after the last publication \(2026-08-01 > 2026-05-01\)/);
    expect(by('finding-lifecycle').outdated).toBe(true);
    expect(by('finding-lifecycle').outdatedReason).toMatch(/last covered \d+ days ago \(threshold 730\)/);
    expect(by('semantic-search').outdated).toBe(false);
  });
});
