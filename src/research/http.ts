import type { Clock } from '../shared/clock.js';
import { EditorialError, errorMessage } from '../shared/errors.js';
import type { Logger } from '../shared/logger.js';
import { sanitizeUrl } from '../shared/redact.js';
import type { HttpCache } from './cache.js';
import { isAllowed, parseRobots, type RobotsRules } from './robots.js';

export const USER_AGENT_TOKEN = 'editorial-kit';

export interface FetchedPage {
  url: string;
  status: number;
  body: string;
  fetchedAt: string;
  fromCache: boolean;
  /** Age of the cached copy in hours when fromCache is true. */
  cacheAgeHours?: number;
  /** True when a cached copy older than the TTL was served because the live request failed. */
  stale?: boolean;
  /** Why the live request failed when a stale copy was served. */
  liveError?: string;
  /** Final URL when the live request was redirected (the cache key stays `url`). */
  finalUrl?: string;
}

export interface HttpClientOptions {
  cache: HttpCache;
  clock: Clock;
  logger: Logger;
  minDelayMs: number;
  concurrency: number;
  timeoutMs: number;
  /** Bypass fresh cache entries (they are still used as a fallback on failure). */
  refresh?: boolean;
  /** Never touch the network; only cached responses are served. */
  offline?: boolean;
  userAgentContact?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  /** Sleep function (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
}

/** Maximum redirects followed for one request (each hop is robots-checked and rate-limited). */
export const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const CHALLENGE_MARKERS = [/captcha/i, /cf-chl/i, /challenge-platform/i, /ddos-guard/i, /are you a robot/i, /access denied/i];

/**
 * Polite HTTP client for public research:
 * - honours robots.txt (cannot be disabled), including for every redirect hop,
 * - per-host minimum delay + small global concurrency,
 * - caches every successful public response,
 * - never sends cookies or credentials,
 * - stops (instead of retrying around) on anti-bot challenges, 401/403 and paywalls,
 * - falls back to stale cache on failure and reports that it did.
 */
export class HttpClient {
  private readonly lastRequestAt = new Map<string, number>();
  private readonly robots = new Map<string, RobotsRules>();
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  readonly userAgent: string;

  constructor(private readonly options: HttpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const contact = options.userAgentContact ?? process.env.EDITORIAL_USER_AGENT_CONTACT;
    this.userAgent = `${USER_AGENT_TOKEN}/0.1 (+https://github.com/zinverno/storyops${contact ? `; ${contact}` : ''})`;
  }

  async get(platform: string, url: string): Promise<FetchedPage> {
    const now = this.options.clock.now();
    const cached = await this.options.cache.get(platform, url, now);
    if (cached && (cached.fresh || this.options.offline) && !(this.options.refresh && !this.options.offline)) {
      this.options.logger.debug(`cache hit ${sanitizeUrl(url)} (${cached.ageHours.toFixed(1)}h old)`);
      return {
        url,
        status: cached.entry.status,
        body: cached.entry.body,
        fetchedAt: cached.entry.fetchedAt,
        fromCache: true,
        cacheAgeHours: cached.ageHours,
        stale: !cached.fresh,
      };
    }
    if (this.options.offline) {
      throw new EditorialError('OFFLINE_CACHE_MISS', `Offline mode: no cached copy of ${sanitizeUrl(url)}`);
    }
    try {
      return await this.withSlot(() => this.fetchLive(platform, url));
    } catch (error) {
      if (cached) {
        const reason = errorMessage(error);
        this.options.logger.warn(`Live request failed (${reason}); using cached copy from ${cached.entry.fetchedAt} (${cached.ageHours.toFixed(1)}h old).`);
        return {
          url,
          status: cached.entry.status,
          body: cached.entry.body,
          fetchedAt: cached.entry.fetchedAt,
          fromCache: true,
          cacheAgeHours: cached.ageHours,
          stale: !cached.fresh,
          liveError: reason,
        };
      }
      throw error;
    }
  }

  private async withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.options.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }

  private async waitForHost(host: string, extraDelayMs = 0): Promise<void> {
    const delay = Math.max(this.options.minDelayMs, extraDelayMs);
    const last = this.lastRequestAt.get(host);
    const nowMs = Date.now();
    // Reserve the slot before sleeping so concurrent callers queue up behind us.
    const scheduled = last === undefined ? nowMs : Math.max(nowMs, last + delay);
    this.lastRequestAt.set(host, scheduled);
    if (scheduled > nowMs) await this.sleep(scheduled - nowMs);
  }

  private async robotsFor(origin: URL, platform: string): Promise<RobotsRules> {
    const key = origin.origin;
    const known = this.robots.get(key);
    if (known) return known;
    const robotsUrl = `${origin.origin}/robots.txt`;
    let rules: RobotsRules = { allow: [], disallow: [] };
    const cached = await this.options.cache.get(platform, robotsUrl, this.options.clock.now());
    let body: string | undefined;
    let status: number | undefined;
    if (cached?.fresh) {
      body = cached.entry.body;
      status = cached.entry.status;
    } else {
      const response = await this.fetchRobots(robotsUrl);
      status = response.status;
      body = response.body;
      await this.options.cache.set({ platform, url: robotsUrl, fetchedAt: this.options.clock.now().toISOString(), status, body, ...(response.finalUrl !== robotsUrl ? { finalUrl: response.finalUrl } : {}) });
    }
    if (status !== undefined && status >= 500) {
      throw new EditorialError('ROBOTS_UNAVAILABLE', `robots.txt for ${origin.host} returned ${status}; refusing to crawl.`);
    }
    if (status !== undefined && status >= 200 && status < 300 && body) rules = parseRobots(body, USER_AGENT_TOKEN);
    this.robots.set(key, rules);
    return rules;
  }

  /**
   * One HTTP request. Redirects are never followed automatically: each hop is
   * handled by the caller so it passes robots.txt and per-host scheduling.
   * No cookies, credentials or Authorization headers are ever sent.
   */
  private async request(url: string): Promise<Response> {
    return this.fetchImpl(url, {
      headers: { 'user-agent': this.userAgent, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5', 'accept-language': 'ru,en;q=0.8' },
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
  }

  /** Resolves a redirect Location against the current URL and validates it. */
  private redirectTarget(response: Response, current: string, chain: readonly string[]): string {
    const location = response.headers.get('location');
    if (!location) throw new EditorialError('REDIRECT_INVALID', `${sanitizeUrl(current)} returned ${response.status} without a Location header`);
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new EditorialError('REDIRECT_INVALID', `${sanitizeUrl(current)} redirected to an invalid URL`);
    }
    next.hash = '';
    if (next.protocol !== 'https:' && next.protocol !== 'http:') throw new EditorialError('REDIRECT_INVALID', `${sanitizeUrl(current)} redirected to unsupported scheme ${next.protocol}`);
    const target = next.toString();
    if (chain.includes(target)) throw new EditorialError('REDIRECT_LOOP', `Redirect loop: ${[...chain, target].map(sanitizeUrl).join(' → ')}`);
    if (chain.length > MAX_REDIRECTS) throw new EditorialError('TOO_MANY_REDIRECTS', `More than ${MAX_REDIRECTS} redirects starting at ${sanitizeUrl(chain[0]!)}`);
    return target;
  }

  /**
   * robots.txt itself may redirect (e.g. http → https). Each hop is scheduled
   * per host; after more than MAX_REDIRECTS hops robots.txt is treated as
   * unavailable, as RFC 9309 allows.
   */
  private async fetchRobots(robotsUrl: string): Promise<{ status: number; body: string; finalUrl: string }> {
    const chain = [robotsUrl];
    let current = robotsUrl;
    for (;;) {
      await this.waitForHost(new URL(current).host);
      const response = await this.request(current);
      if (!REDIRECT_STATUSES.has(response.status)) return { status: response.status, body: await response.text(), finalUrl: current };
      await response.body?.cancel().catch(() => undefined);
      try {
        current = this.redirectTarget(response, current, chain);
      } catch (error) {
        this.options.logger.warn(`robots.txt at ${sanitizeUrl(robotsUrl)}: ${errorMessage(error)}; treating it as unavailable.`);
        return { status: 404, body: '', finalUrl: current };
      }
      chain.push(current);
    }
  }

  /**
   * Fetches a URL, following at most MAX_REDIRECTS redirects manually. Every
   * hop (including the first) is checked for scheme, checked against the
   * target origin's robots.txt, and scheduled with that host's delay and
   * crawl-delay before it is requested.
   *
   * Caching: the entry is stored under the ORIGINALLY REQUESTED URL (so
   * repeated requests hit the cache); the final URL after redirects is
   * recorded in the entry as `finalUrl` for inspection.
   */
  private async fetchLive(platform: string, url: string): Promise<FetchedPage> {
    const chain = [url];
    let current = url;
    for (;;) {
      const parsed = new URL(current);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new EditorialError('UNSUPPORTED_URL', `Unsupported URL scheme: ${parsed.protocol}`);
      const rules = await this.robotsFor(parsed, platform);
      if (!isAllowed(rules, `${parsed.pathname}${parsed.search}`)) {
        const via = chain.length > 1 ? ` (redirected from ${sanitizeUrl(url)})` : '';
        throw new EditorialError('ROBOTS_DISALLOWED', `robots.txt disallows ${sanitizeUrl(current)}${via} for automated clients; skipping.`);
      }
      const { response, body } = await this.requestWithRetries(current, parsed.host, rules);
      if (REDIRECT_STATUSES.has(response.status)) {
        current = this.redirectTarget(response, current, chain);
        chain.push(current);
        this.options.logger.debug(`redirect ${response.status} → ${sanitizeUrl(current)}`);
        continue;
      }
      if (response.status === 401 || response.status === 402 || response.status === 403 || (response.status >= 400 && CHALLENGE_MARKERS.some((m) => m.test(body.slice(0, 5000))))) {
        throw new EditorialError('ACCESS_RESTRICTED', `${sanitizeUrl(current)} returned ${response.status} (access restricted or anti-bot challenge). Not retrying.`);
      }
      if (response.status >= 400) throw new EditorialError('HTTP_ERROR', `${sanitizeUrl(current)} returned ${response.status}`);
      const fetchedAt = this.options.clock.now().toISOString();
      const contentType = response.headers.get('content-type') ?? undefined;
      await this.options.cache.set({ platform, url, fetchedAt, status: response.status, body, ...(contentType ? { contentType } : {}), ...(current !== url ? { finalUrl: current } : {}) });
      const page: FetchedPage = { url, status: response.status, body, fetchedAt, fromCache: false };
      if (current !== url) page.finalUrl = current;
      return page;
    }
  }

  /** One hop with retries for network errors, 429 and 5xx. Redirect bodies are discarded. */
  private async requestWithRetries(url: string, host: string, rules: RobotsRules): Promise<{ response: Response; body: string }> {
    const maxRetries = this.options.maxRetries ?? 2;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      await this.waitForHost(host, (rules.crawlDelaySeconds ?? 0) * 1000);
      this.options.logger.debug(`GET ${sanitizeUrl(url)}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
      let response: Response;
      try {
        response = await this.request(url);
      } catch (error) {
        lastError = new EditorialError('NETWORK_ERROR', `Request to ${sanitizeUrl(url)} failed: ${errorMessage(error)}`, { cause: error });
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        return { response, body: '' };
      }
      const body = await response.text();
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after'));
        lastError = new EditorialError('HTTP_RETRYABLE', `${sanitizeUrl(url)} returned ${response.status}`);
        await this.sleep(Math.min(60_000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt));
        continue;
      }
      return { response, body };
    }
    throw lastError instanceof Error ? lastError : new EditorialError('NETWORK_ERROR', `Request to ${sanitizeUrl(url)} failed`);
  }
}
