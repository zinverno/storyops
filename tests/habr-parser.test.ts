import { describe, expect, it } from 'vitest';
import { parseArticleList, parseArticlePage } from '../platforms/habr/parser.js';
import { habrArticleId, hubSlugFromHref, parseCount, parseHabrDate, parseVotes } from '../platforms/habr/parse-values.js';
import { publicationFromArticle } from '../platforms/habr/research.js';
import { fixture } from './helpers.js';

const NOW = new Date('2026-09-24T12:00:00.000Z');

describe('Habr value parsers', () => {
  it('parses rounded and signed counts', () => {
    expect(parseCount('12K')).toEqual({ value: 12000, approximate: true });
    expect(parseCount('1.2K')).toEqual({ value: 1200, approximate: true });
    expect(parseCount('1,2K')).toEqual({ value: 1200, approximate: true });
    expect(parseCount('3.4M')).toEqual({ value: 3400000, approximate: true });
    expect(parseCount('12 345')).toEqual({ value: 12345, approximate: false });
    expect(parseCount('Комментарии 12')?.value).toBe(12);
    expect(parseCount('+52')?.value).toBe(52);
    expect(parseCount('–4')?.value).toBe(-4);
    expect(parseCount('−3')?.value).toBe(-3);
    expect(parseCount('')).toBeUndefined();
    expect(parseCount('нет')).toBeUndefined();
  });

  it('parses vote breakdowns', () => {
    expect(parseVotes('Всего голосов 58: ↑55 и ↓3')).toEqual({ total: 58, up: 55, down: 3 });
    expect(parseVotes(undefined)).toEqual({});
  });

  it('parses ISO, title and Russian display dates in Moscow time', () => {
    expect(parseHabrDate({ datetime: '2024-05-13T09:01:02.000Z' }, NOW)).toBe('2024-05-13T09:01:02.000Z');
    expect(parseHabrDate({ title: '2024-05-13, 12:01' }, NOW)).toBe('2024-05-13T09:01:00.000Z');
    expect(parseHabrDate({ text: '13 мая 2024 в 12:01' }, NOW)).toBe('2024-05-13T09:01:00.000Z');
    expect(parseHabrDate({ text: '3 фев в 12:00' }, NOW)).toBe('2026-02-03T09:00:00.000Z');
    expect(parseHabrDate({ text: 'вчера в 09:15' }, NOW)).toBe('2026-09-23T06:15:00.000Z');
    expect(parseHabrDate({ text: 'сегодня в 10:00' }, NOW)).toBe('2026-09-24T07:00:00.000Z');
    expect(parseHabrDate({ datetime: 'garbage', text: 'непонятно' }, NOW)).toBeUndefined();
  });

  it('extracts article ids and hub slugs', () => {
    expect(habrArticleId('https://habr.com/ru/articles/812345/')).toBe('812345');
    expect(habrArticleId('https://habr.com/ru/companies/acme/articles/812346/')).toBe('812346');
    expect(habrArticleId('https://habr.com/ru/post/100/')).toBe('100');
    expect(habrArticleId('https://habr.com/ru/users/x/')).toBeUndefined();
    expect(hubSlugFromHref('/ru/hubs/open_source/')).toBe('open_source');
  });
});

describe('Habr list parser', () => {
  it('parses the author article list and skips promo blocks', async () => {
    const page = parseArticleList(await fixture('habr/author-list.html'), 'https://habr.com/ru/users/demo_author/articles/', NOW);
    expect(page.items.map((i) => i.id)).toEqual(['900002', '900001']);
    const first = page.items[0]!;
    expect(first.url).toBe('https://habr.com/ru/articles/900002/');
    expect(first.title).toBe('Как устроен Notegarden: разовый аудит заметок изнутри');
    expect(first.author).toBe('demo_author');
    expect(first.publishedAt).toBe('2025-03-10T09:00:00.000Z');
    expect(first.hubs).toEqual(['open_source', 'typescript']);
    expect(first.hubNames).toContain('Open source');
    expect(first.metrics).toMatchObject({ rating: 31, votes: 35, votesUp: 33, votesDown: 2, views: 5800, viewsApproximate: true, bookmarks: 64, comments: 22 });
  });

  it('deduplicates repeated items and tolerates missing metrics', async () => {
    const page = parseArticleList(await fixture('habr/top-weekly.html'), 'https://habr.com/ru/articles/top/weekly/', NOW);
    const ids = page.items.map((i) => i.id);
    expect(ids.length).toBe(11);
    expect(new Set(ids).size).toBe(ids.length);
    const noBookmarks = page.items.find((i) => i.id === '910010')!;
    expect(noBookmarks.metrics.bookmarks).toBeUndefined();
    expect(noBookmarks.warnings).toContain('bookmarks missing');
    const noRating = page.items.find((i) => i.id === '910011')!;
    expect(noRating.metrics.rating).toBeUndefined();
    expect(noRating.metrics.views).toBe(3900);
  });

  it('degrades gracefully on malformed markup', async () => {
    const page = parseArticleList(await fixture('habr/malformed.html'), 'https://habr.com/ru/articles/top/daily/', NOW);
    expect(page.items.map((i) => i.id)).toEqual(['930001']);
    expect(page.items[0]!.warnings).toEqual(expect.arrayContaining(['publication date missing', 'rating missing', 'views missing']));
    const empty = parseArticleList('<html><body><p>nothing</p></body></html>', 'https://habr.com/x/', NOW);
    expect(empty.items).toEqual([]);
    expect(empty.warnings[0]).toMatch(/markup may have changed/);
  });
});

describe('Habr article parser', () => {
  it('parses metadata, tags, hubs and body blocks', async () => {
    const a = parseArticlePage(await fixture('habr/article-900002.html'), 'https://habr.com/ru/articles/900002/', NOW);
    expect(a.id).toBe('900002');
    expect(a.title).toBe('Как устроен Notegarden: разовый аудит заметок изнутри');
    expect(a.publishedAt).toBe('2025-03-10T09:00:00.000Z');
    expect(a.tags).toEqual(['obsidian', 'архитектура', 'typescript']);
    expect(a.hubs).toEqual(['open_source', 'typescript']);
    expect(a.metrics.rating).toBe(31);
    const headings = a.blocks.filter((b) => b.type === 'heading').map((b) => (b as { text: string }).text);
    expect(headings).toEqual(['Архитектура аудита', 'Правила', 'Отчёт', 'Почему аудит разовый', 'Что дальше']);
    const code = a.blocks.filter((b) => b.type === 'code');
    expect(code).toHaveLength(2);
    expect(code[0]).toMatchObject({ language: 'typescript', lines: 4 });
    const para = a.blocks.find((b) => b.type === 'paragraph' && b.text.includes('src/audit/runner.ts'));
    expect(para && para.type === 'paragraph' ? para.text : '').toContain('`src/audit/runner.ts`');
  });

  it('extracts images and lists as content blocks', async () => {
    const a = parseArticlePage(await fixture('habr/article-910001.html'), 'https://habr.com/ru/articles/910001/', NOW);
    const img = a.blocks.find((b) => b.type === 'image');
    expect(img).toMatchObject({ type: 'image', src: 'https://habrastorage.org/fixture/scheduler-diagram.png', alt: 'Схема обработки событий', caption: 'Схема до и после исправления' });
    const b = parseArticlePage(await fixture('habr/article-900001.html'), 'https://habr.com/ru/articles/900001/', NOW);
    expect(b.blocks.some((x) => x.type === 'list' && x.items.length === 4)).toBe(true);
  });

  it('tolerates an article without metrics, hubs and tags', async () => {
    const a = parseArticlePage(await fixture('habr/article-920001-minimal.html'), 'https://habr.com/ru/articles/920001/', NOW);
    expect(a.title).toBe('Статья без метрик');
    expect(a.metrics.rating).toBeUndefined();
    expect(a.metrics.views).toBeUndefined();
    expect(a.warnings).toEqual(expect.arrayContaining(['rating missing', 'views missing', 'hubs missing', 'tags missing']));
  });

  it('throws a clear error when no title can be found', () => {
    expect(() => parseArticlePage('<html><body></body></html>', 'https://habr.com/ru/articles/1/', NOW)).toThrow(/no recognisable title/);
  });

  it('converts an article into a platform-neutral publication without code in the text', async () => {
    const a = parseArticlePage(await fixture('habr/article-900002.html'), 'https://habr.com/ru/articles/900002/', NOW);
    const pub = publicationFromArticle(a, NOW.toISOString(), false);
    expect(pub.id).toBe('habr:900002');
    expect(pub.headings.map((h) => h.text)).toContain('Правила');
    expect(pub.codeBlocks).toHaveLength(2);
    expect(pub.text).not.toContain('buildIndex(vault)');
    expect(pub.depth).toBe('standard');
    expect(pub.metrics.bookmarks).toBe(64);
  });
});
