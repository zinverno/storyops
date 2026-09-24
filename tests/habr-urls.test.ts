import { describe, expect, it } from 'vitest';
import { habrUrls, parseHabrProfileUrl } from '../platforms/habr/research.js';
import { parseArticleList } from '../platforms/habr/parser.js';

/**
 * Pins the public Habr URL contract used by the adapter. These routes could
 * not be verified against live habr.com from the build environment; if Habr
 * changes them, this test and platforms/habr/research.ts change together.
 */
describe('Habr URL contract', () => {
  it('uses the current author articles route, not the old /publications/articles/ route', () => {
    expect(habrUrls.userPublications('demo_author')).toBe('https://habr.com/ru/users/demo_author/articles/');
    expect(habrUrls.userPublications('demo_author', 'en')).toBe('https://habr.com/en/users/demo_author/articles/');
    expect(habrUrls.userPublications('demo_author')).not.toContain('/publications/');
  });

  it('keeps the top-list routes', () => {
    expect(habrUrls.top('weekly')).toBe('https://habr.com/ru/articles/top/weekly/');
    expect(habrUrls.hubTop('open_source', 'monthly')).toBe('https://habr.com/ru/hubs/open_source/articles/top/monthly/');
  });

  it('parses profile URLs, including links that already point at the articles tab', () => {
    expect(parseHabrProfileUrl('https://habr.com/ru/users/demo_author/')).toEqual({ lang: 'ru', username: 'demo_author' });
    expect(parseHabrProfileUrl('https://habr.com/en/users/demo_author/articles/')).toEqual({ lang: 'en', username: 'demo_author' });
    expect(() => parseHabrProfileUrl('https://habr.com/ru/articles/1/')).toThrow(/Not a Habr profile URL/);
  });

  it('follows author list pagination under the /articles/ route', () => {
    const html = '<div class="tm-pagination"><a class="tm-pagination__page" href="/ru/users/demo_author/articles/page2/">2</a></div>';
    const page = parseArticleList(html, 'https://habr.com/ru/users/demo_author/articles/', new Date('2026-09-24T12:00:00Z'));
    expect(page.nextPageUrl).toBe('https://habr.com/ru/users/demo_author/articles/page2/');
  });
});
