import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { habrPlatform } from '../platforms/habr/index.js';
import { HttpCache } from '../src/research/cache.js';
import { HttpClient } from '../src/research/http.js';
import { isAllowed, parseRobots } from '../src/research/robots.js';
import { fixedClock } from '../src/shared/clock.js';
import { silentLogger } from '../src/shared/logger.js';
import { FIXTURES, tempDir } from './helpers.js';

const clock = fixedClock('2026-09-24T12:00:00.000Z');

async function fixtureFetch(robots = 'User-agent: *\nDisallow: /search\n') {
  const manifest = JSON.parse(await readFile(path.join(FIXTURES, 'habr/manifest.json'), 'utf8')) as { pages: Record<string, string> };
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (url.endsWith('/robots.txt')) return new Response(robots, { status: 200 });
    const file = manifest.pages[url];
    if (!file) return new Response('not found', { status: 404 });
    return new Response(await readFile(path.join(FIXTURES, 'habr', file), 'utf8'), { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  return { impl, calls };
}

describe('robots.txt', () => {
  it('applies longest-match precedence, wildcards and agent groups', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*.json$\n\nUser-agent: other\nDisallow: /', 'editorial-kit');
    expect(isAllowed(rules, '/private/x')).toBe(false);
    expect(isAllowed(rules, '/private/public/x')).toBe(true);
    expect(isAllowed(rules, '/data.json')).toBe(false);
    expect(isAllowed(rules, '/data.json?x=1')).toBe(true);
    expect(isAllowed(rules, '/articles/')).toBe(true);
    const specific = parseRobots('User-agent: editorial-kit\nDisallow: /\nCrawl-delay: 5\n\nUser-agent: *\nAllow: /', 'editorial-kit/0.1');
    expect(isAllowed(specific, '/anything')).toBe(false);
    expect(specific.crawlDelaySeconds).toBe(5);
  });
});

describe('HttpClient', () => {
  let tmp: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => {
    tmp = await tempDir();
  });
  afterEach(async () => tmp.cleanup());

  const client = (fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) =>
    new HttpClient({ cache: new HttpCache(tmp.dir, 24), clock, logger: silentLogger, minDelayMs: 0, concurrency: 2, timeoutMs: 1000, fetchImpl, sleep: async () => undefined, ...extra });

  it('caches responses and does not refetch fresh entries', async () => {
    const { impl, calls } = await fixtureFetch();
    const http = client(impl);
    const first = await http.get('habr', 'https://habr.com/ru/articles/top/weekly/');
    expect(first.fromCache).toBe(false);
    const second = await http.get('habr', 'https://habr.com/ru/articles/top/weekly/');
    expect(second.fromCache).toBe(true);
    expect(calls.filter((c) => c.endsWith('/top/weekly/'))).toHaveLength(1);
    const refreshed = await client(impl, { refresh: true }).get('habr', 'https://habr.com/ru/articles/top/weekly/');
    expect(refreshed.fromCache).toBe(false);
  });

  it('refuses URLs disallowed by robots.txt', async () => {
    const { impl } = await fixtureFetch('User-agent: *\nDisallow: /ru/articles/top/\n');
    await expect(client(impl).get('habr', 'https://habr.com/ru/articles/top/weekly/')).rejects.toThrow(/robots\.txt disallows/);
  });

  it('does not retry around access restrictions', async () => {
    let calls = 0;
    const impl = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      calls += 1;
      return new Response('<html>captcha</html>', { status: 403 });
    }) as typeof fetch;
    await expect(client(impl).get('habr', 'https://habr.com/ru/articles/1/')).rejects.toThrow(/access restricted/);
    expect(calls).toBe(1);
  });

  it('falls back to a stale cached copy and reports it', async () => {
    const cache = new HttpCache(tmp.dir, 24);
    await cache.set({ platform: 'habr', url: 'https://habr.com/ru/articles/top/weekly/', fetchedAt: '2026-09-20T12:00:00.000Z', status: 200, body: 'old' });
    const failing = (async () => {
      throw new Error('ECONNRESET');
    }) as typeof fetch;
    const page = await client(failing).get('habr', 'https://habr.com/ru/articles/top/weekly/');
    expect(page).toMatchObject({ fromCache: true, stale: true, body: 'old' });
    expect(page.cacheAgeHours).toBe(96);
    expect(page.liveError).toMatch(/robots|ECONNRESET|failed/i);
  });

  it('never touches the network in offline mode', async () => {
    const impl = vi.fn() as unknown as typeof fetch;
    await expect(client(impl, { offline: true }).get('habr', 'https://habr.com/ru/articles/1/')).rejects.toThrow(/Offline mode/);
    expect(impl).not.toHaveBeenCalled();
  });
});

describe('Habr research adapter (fixtures via injected fetch)', () => {
  let tmp: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => {
    tmp = await tempDir();
  });
  afterEach(async () => tmp.cleanup());

  it('collects author history with article bodies', async () => {
    const { impl } = await fixtureFetch();
    const http = new HttpClient({ cache: new HttpCache(tmp.dir, 24), clock, logger: silentLogger, minDelayMs: 0, concurrency: 2, timeoutMs: 1000, fetchImpl: impl });
    const result = await habrPlatform.research!.collectAuthorHistory!('https://habr.com/ru/users/demo_author/', { http, logger: silentLogger, clock, config: { enabled: true } }, { maxArticles: 10 });
    expect(result.items.map((p) => p.id).sort()).toEqual(['habr:900001', 'habr:900002']);
    expect(result.failures).toEqual([]);
    expect(result.items.every((p) => p.text.length > 200)).toBe(true);
  });

  it('collects a trend window, deduplicates and extracts only abstract structure', async () => {
    const { impl } = await fixtureFetch();
    const http = new HttpClient({ cache: new HttpCache(tmp.dir, 24), clock, logger: silentLogger, minDelayMs: 0, concurrency: 2, timeoutMs: 1000, fetchImpl: impl });
    const result = await habrPlatform.research!.collectTrends!({ http, logger: silentLogger, clock, config: { enabled: true } }, { periods: ['weekly'], hubs: [], maxArticlesPerPeriod: 30, fetchArticleBodies: true });
    expect(result.windows).toEqual([{ id: 'weekly', period: 'weekly', url: 'https://habr.com/ru/articles/top/weekly/' }]);
    expect(result.items).toHaveLength(11);
    const a = result.items.find((x) => x.id === 'habr:910001')!;
    expect(a.structure?.codeBlocks).toBe(1);
    expect(a.structure?.wordsBeforeConflict).toBe(0);
    expect(JSON.stringify(a)).not.toContain('Три недели подряд');
  });

  it('rejects non-Habr profile URLs', async () => {
    const { impl } = await fixtureFetch();
    const http = new HttpClient({ cache: new HttpCache(tmp.dir, 24), clock, logger: silentLogger, minDelayMs: 0, concurrency: 2, timeoutMs: 1000, fetchImpl: impl });
    await expect(habrPlatform.research!.collectAuthorHistory!('https://example.com/u/x', { http, logger: silentLogger, clock, config: { enabled: true } }, { maxArticles: 1 })).rejects.toThrow(/Not a Habr profile URL/);
  });
});
