import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpCache } from '../src/research/cache.js';
import { HttpClient, MAX_REDIRECTS } from '../src/research/http.js';
import { fixedClock } from '../src/shared/clock.js';
import { memoryLogger } from '../src/shared/logger.js';
import { tempDir } from './helpers.js';

const clock = fixedClock('2026-09-24T12:00:00.000Z');

type Route = { status: number; body?: string; location?: string };

/** Fake origin(s): a map from absolute URL to response, recording every request and its init. */
function fakeWeb(routes: Record<string, Route>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const route = routes[url];
    if (!route) return new Response(url.endsWith('/robots.txt') ? '' : 'not found', { status: 404 });
    const headers: Record<string, string> = { 'content-type': 'text/html' };
    if (route.location) headers.location = route.location;
    return new Response(route.body ?? '', { status: route.status, headers });
  }) as typeof fetch;
  return { impl, calls, urls: () => calls.map((c) => c.url) };
}

describe('HttpClient redirects', () => {
  let tmp: Awaited<ReturnType<typeof tempDir>>;
  let sleeps: number[];
  beforeEach(async () => {
    tmp = await tempDir();
    sleeps = [];
  });
  afterEach(async () => tmp.cleanup());

  const client = (fetchImpl: typeof fetch, logger = memoryLogger(), cacheDir = tmp.dir) =>
    new HttpClient({
      cache: new HttpCache(cacheDir, 24),
      clock,
      logger,
      minDelayMs: 1000,
      concurrency: 1,
      timeoutMs: 1000,
      maxRetries: 0,
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

  it('leaves normal non-redirect requests unchanged (manual redirect mode, no credentials)', async () => {
    const web = fakeWeb({ 'https://a.test/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /' }, 'https://a.test/page': { status: 200, body: 'ok' } });
    const page = await client(web.impl).get('p', 'https://a.test/page');
    expect(page).toMatchObject({ url: 'https://a.test/page', status: 200, body: 'ok', fromCache: false });
    expect(page.finalUrl).toBeUndefined();
    expect(web.urls()).toEqual(['https://a.test/robots.txt', 'https://a.test/page']);
    for (const call of web.calls) {
      expect(call.init?.redirect).toBe('manual');
      expect(call.init?.credentials).toBe('omit');
      const headers = call.init?.headers as Record<string, string>;
      expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toEqual(expect.arrayContaining(['cookie']));
      expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    }
  });

  it('follows an allowed same-origin redirect, rate-limits the second hop and caches under the requested URL', async () => {
    const web = fakeWeb({
      'https://a.test/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /' },
      'https://a.test/old': { status: 301, location: '/new' },
      'https://a.test/new': { status: 200, body: 'moved content' },
    });
    const http = client(web.impl);
    const page = await http.get('p', 'https://a.test/old');
    expect(page).toMatchObject({ url: 'https://a.test/old', finalUrl: 'https://a.test/new', body: 'moved content' });
    expect(web.urls()).toEqual(['https://a.test/robots.txt', 'https://a.test/old', 'https://a.test/new']);
    // Three requests to one host: each after the first waits for the per-host delay.
    expect(sleeps.filter((ms) => ms > 900)).toHaveLength(2);
    const cached = await http.get('p', 'https://a.test/old');
    expect(cached.fromCache).toBe(true);
    expect(web.calls).toHaveLength(3);
    const listed = await new HttpCache(tmp.dir, 24).list('p');
    expect(listed.find((r) => r.url === 'https://a.test/old')?.finalUrl).toBe('https://a.test/new');
  });

  it('refuses a redirect into a robots-disallowed path without requesting it', async () => {
    const web = fakeWeb({
      'https://a.test/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /private' },
      'https://a.test/public': { status: 302, location: '/private/data' },
      'https://a.test/private/data': { status: 200, body: 'secret' },
    });
    await expect(client(web.impl).get('p', 'https://a.test/public')).rejects.toThrow(/robots\.txt disallows https:\/\/a\.test\/private\/data \(redirected from https:\/\/a\.test\/public\)/);
    expect(web.urls()).not.toContain('https://a.test/private/data');
  });

  it('applies the second origin\'s robots.txt and scheduling to a cross-origin redirect', async () => {
    const web = fakeWeb({
      'https://a.test/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /' },
      'https://a.test/go': { status: 307, location: 'https://b.test/landing' },
      'https://b.test/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /landing\nCrawl-delay: 3' },
      'https://b.test/landing': { status: 200, body: 'b' },
    });
    await expect(client(web.impl).get('p', 'https://a.test/go')).rejects.toThrow(/robots\.txt disallows https:\/\/b\.test\/landing/);
    expect(web.urls()).toEqual(['https://a.test/robots.txt', 'https://a.test/go', 'https://b.test/robots.txt']);

    const allowed = fakeWeb({
      'https://a.test/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /' },
      'https://a.test/go': { status: 307, location: 'https://b.test/landing' },
      'https://b.test/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /\nCrawl-delay: 3' },
      'https://b.test/landing': { status: 200, body: 'b' },
    });
    sleeps = [];
    // Fresh cache: the first client cached b.test's disallowing robots.txt.
    const page = await client(allowed.impl, memoryLogger(), `${tmp.dir}/second`).get('p', 'https://a.test/go');
    expect(page.finalUrl).toBe('https://b.test/landing');
    expect(allowed.urls()).toEqual(['https://a.test/robots.txt', 'https://a.test/go', 'https://b.test/robots.txt', 'https://b.test/landing']);
    // b.test's crawl-delay (3 s) governs the request to b.test after its robots.txt fetch.
    expect(sleeps.some((ms) => ms > 2900)).toBe(true);
  });

  it('fails clearly on redirect loops', async () => {
    const web = fakeWeb({
      'https://a.test/robots.txt': { status: 200, body: '' },
      'https://a.test/x': { status: 302, location: '/y' },
      'https://a.test/y': { status: 302, location: '/x' },
    });
    await expect(client(web.impl).get('p', 'https://a.test/x')).rejects.toThrow(/Redirect loop: https:\/\/a\.test\/x → https:\/\/a\.test\/y → https:\/\/a\.test\/x/);
  });

  it(`stops after ${MAX_REDIRECTS} redirects`, async () => {
    const routes: Record<string, Route> = { 'https://a.test/robots.txt': { status: 200, body: '' } };
    for (let i = 0; i < 10; i += 1) routes[`https://a.test/r${i}`] = { status: 301, location: `/r${i + 1}` };
    const web = fakeWeb(routes);
    await expect(client(web.impl).get('p', 'https://a.test/r0')).rejects.toThrow(/More than 5 redirects/);
    expect(web.urls().filter((u) => !u.endsWith('robots.txt'))).toHaveLength(MAX_REDIRECTS + 1);
  });

  it('rejects redirects to non-http schemes and sanitises URLs in errors and logs', async () => {
    const web = fakeWeb({
      'https://a.test/robots.txt': { status: 200, body: '' },
      'https://a.test/file': { status: 302, location: 'file:///etc/passwd' },
      'https://a.test/tok?token=abc123secret': { status: 302, location: '/next?session=xyz789secret' },
      'https://a.test/next?session=xyz789secret': { status: 200, body: 'ok' },
    });
    await expect(client(web.impl).get('p', 'https://a.test/file')).rejects.toThrow(/unsupported scheme file:/);
    const logger = memoryLogger();
    const http = new HttpClient({ cache: new HttpCache(tmp.dir, 24), clock, logger, minDelayMs: 0, concurrency: 1, timeoutMs: 1000, fetchImpl: web.impl, sleep: async () => undefined });
    await http.get('p', 'https://a.test/tok?token=abc123secret');
    const logged = JSON.stringify(logger.records);
    expect(logged).toContain('redirect 302');
    expect(logged).not.toContain('abc123secret');
    expect(logged).not.toContain('xyz789secret');
  });
});
