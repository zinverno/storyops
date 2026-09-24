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

const CHALLENGE_MARKERS = [/captcha/i, /cf-chl/i, /challenge-platform/i, /ddos-guard/i, /are you a robot/i, /access denied/i];

/**
 * Polite HTTP client for public research:
 * - honours robots.txt (cannot be disabled),
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
      await this.waitForHost(origin.host);
      const response = await this.request(robotsUrl);
      status = response.status;
      body = await response.text();
      await this.options.cache.set({ platform, url: robotsUrl, fetchedAt: this.options.clock.now().toISOString(), status, body });
    }
    if (status !== undefined && status >= 500) {
      throw new EditorialError('ROBOTS_UNAVAILABLE', `robots.txt for ${origin.host} returned ${status}; refusing to crawl.`);
    }
    if (status !== undefined && status >= 200 && status < 300 && body) rules = parseRobots(body, USER_AGENT_TOKEN);
    this.robots.set(key, rules);
    return rules;
  }

  private async request(url: string): Promise<Response> {
    return this.fetchImpl(url, {
      headers: { 'user-agent': this.userAgent, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5', 'accept-language': 'ru,en;q=0.8' },
      redirect: 'follow',
      credentials: 'omit',
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
  }

  private async fetchLive(platform: string, url: string): Promise<FetchedPage> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new EditorialError('UNSUPPORTED_URL', `Unsupported URL scheme: ${parsed.protocol}`);
    const rules = await this.robotsFor(parsed, platform);
    if (!isAllowed(rules, `${parsed.pathname}${parsed.search}`)) {
      throw new EditorialError('ROBOTS_DISALLOWED', `robots.txt disallows ${sanitizeUrl(url)} for automated clients; skipping.`);
    }
    const maxRetries = this.options.maxRetries ?? 2;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      await this.waitForHost(parsed.host, (rules.crawlDelaySeconds ?? 0) * 1000);
      this.options.logger.debug(`GET ${sanitizeUrl(url)}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
      let response: Response;
      try {
        response = await this.request(url);
      } catch (error) {
        lastError = new EditorialError('NETWORK_ERROR', `Request to ${sanitizeUrl(url)} failed: ${errorMessage(error)}`, { cause: error });
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      const body = await response.text();
      if (response.status === 401 || response.status === 402 || response.status === 403 || CHALLENGE_MARKERS.some((m) => m.test(body.slice(0, 5000)) && response.status >= 400)) {
        throw new EditorialError('ACCESS_RESTRICTED', `${sanitizeUrl(url)} returned ${response.status} (access restricted or anti-bot challenge). Not retrying.`);
      }
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after'));
        lastError = new EditorialError('HTTP_RETRYABLE', `${sanitizeUrl(url)} returned ${response.status}`);
        await this.sleep(Math.min(60_000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt));
        continue;
      }
      if (response.status >= 400) {
        throw new EditorialError('HTTP_ERROR', `${sanitizeUrl(url)} returned ${response.status}`);
      }
      const fetchedAt = this.options.clock.now().toISOString();
      const contentType = response.headers.get('content-type') ?? undefined;
      await this.options.cache.set({ platform, url, fetchedAt, status: response.status, body, ...(contentType ? { contentType } : {}) });
      return { url, status: response.status, body, fetchedAt, fromCache: false };
    }
    throw lastError instanceof Error ? lastError : new EditorialError('NETWORK_ERROR', `Request to ${sanitizeUrl(url)} failed`);
  }
}
