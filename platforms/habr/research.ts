import { StoryOpsError, errorMessage } from '../../src/shared/errors.js';
import { blocksToPlainText, type ContentBlock } from '../../src/research/blocks.js';
import type { FetchedPage } from '../../src/research/http.js';
import type { FailureRecord, SourceRecord, TrendArticle } from '../../src/research/types.js';
import { structuralFeatures, titleFeatures } from '../../src/research/structure.js';
import { estimateDepth } from '../../src/publications/depth.js';
import { publicationSchema, type Publication } from '../../src/publications/schema.js';
import { wordCount } from '../../src/shared/text.js';
import type { CollectionResult, PlatformResearchAdapter, ResearchContext, TrendCollectionOptions, TrendWindow } from '../schema.js';
import { HABR_ORIGIN, parseArticleList, parseArticlePage, type HabrArticlePage, type HabrListItem } from './parser.js';

const PLATFORM = 'habr';
const MAX_LIST_PAGES = 10;
const PERIODS = new Set(['daily', 'weekly', 'monthly', 'yearly', 'alltime']);

/**
 * Public Habr URL patterns used by the adapter. They are plain public HTML
 * pages (no private/undocumented APIs). If Habr changes them, update here and
 * in tests/habr-urls.test.ts, which pins them.
 *
 * - Author articles: /<lang>/users/<username>/articles/ (pagination: …/articles/page2/).
 *   The older /<lang>/users/<username>/publications/articles/ route is no longer used.
 * - Top lists: /<lang>/articles/top/<period>/ and /<lang>/hubs/<hub>/articles/top/<period>/.
 * - Articles: /<lang>/articles/<id>/ (links are taken from list pages as-is).
 *
 * These routes were not verified against live habr.com from the environment
 * where they were written (network policy blocked the host).
 */
export const habrUrls = {
  userPublications: (username: string, lang = 'ru') => `${HABR_ORIGIN}/${lang}/users/${encodeURIComponent(username)}/articles/`,
  top: (period: string, lang = 'ru') => `${HABR_ORIGIN}/${lang}/articles/top/${period}/`,
  hubTop: (hub: string, period: string, lang = 'ru') => `${HABR_ORIGIN}/${lang}/hubs/${encodeURIComponent(hub)}/articles/top/${period}/`,
};

export function parseHabrProfileUrl(profileUrl: string): { username: string; lang: string } {
  const m = profileUrl.match(/habr\.com\/(ru|en)\/users\/([^/?#]+)/i);
  if (!m) {
    throw new StoryOpsError('HABR_PROFILE_URL', `Not a Habr profile URL: ${profileUrl}`, { hint: 'Expected https://habr.com/ru/users/<username>/' });
  }
  return { lang: m[1]!.toLowerCase(), username: m[2]! };
}

function sourceOf(page: FetchedPage, window?: string): SourceRecord {
  const source: SourceRecord = { url: page.url, fetchedAt: page.fetchedAt, fromCache: page.fromCache };
  if (page.cacheAgeHours !== undefined) source.cacheAgeHours = Math.round(page.cacheAgeHours * 10) / 10;
  if (page.stale) source.stale = true;
  if (window) source.window = window;
  return source;
}

async function collectList(
  ctx: ResearchContext,
  startUrl: string,
  limit: number,
  window: string | undefined,
  sources: SourceRecord[],
  failures: FailureRecord[],
  warnings: string[],
): Promise<HabrListItem[]> {
  const items: HabrListItem[] = [];
  let url: string | undefined = startUrl;
  for (let page = 0; url && page < MAX_LIST_PAGES && items.length < limit; page += 1) {
    let fetched: FetchedPage;
    try {
      fetched = await ctx.http.get(PLATFORM, url);
    } catch (error) {
      failures.push({ url, stage: 'list', reason: errorMessage(error) });
      break;
    }
    sources.push(sourceOf(fetched, window));
    const parsed = parseArticleList(fetched.body, url, ctx.clock.now());
    warnings.push(...parsed.warnings);
    for (const item of parsed.items) if (!items.some((i) => i.id === item.id)) items.push(item);
    if (parsed.items.length === 0) break;
    url = parsed.nextPageUrl;
  }
  return items.slice(0, limit);
}

export function publicationFromArticle(article: HabrArticlePage, collectedAt: string, fromCache: boolean): Publication {
  const blocks = article.blocks;
  const text = blocksToPlainText(blocks);
  const headings = blocks.filter((b): b is Extract<ContentBlock, { type: 'heading' }> => b.type === 'heading').map((b) => ({ level: b.level, text: b.text }));
  const codeBlocks = blocks.filter((b): b is Extract<ContentBlock, { type: 'code' }> => b.type === 'code').map((b) => (b.language ? { language: b.language, lines: b.lines } : { lines: b.lines }));
  const firstHeading = blocks.findIndex((b) => b.type === 'heading');
  const lead = blocksToPlainText(firstHeading === -1 ? blocks.slice(0, 2) : blocks.slice(0, firstHeading)).slice(0, 600);
  const words = wordCount(text);
  return publicationSchema.parse({
    id: `${PLATFORM}:${article.id}`,
    platform: PLATFORM,
    title: article.title,
    url: article.url,
    publicationDate: article.publishedAt,
    author: article.author,
    text,
    lead: lead || undefined,
    headings,
    codeBlocks,
    tags: article.tags,
    hubs: article.hubs,
    topics: article.hubNames,
    metrics: article.metrics,
    media: blocks.flatMap((b): Publication['media'] => {
      if (b.type === 'image') return [{ type: 'image', src: b.src, ...(b.alt ? { alt: b.alt } : {}) }];
      if (b.type === 'embed') return [{ type: 'embed', src: b.src }];
      return [];
    }),
    depth: estimateDepth({ words, headings: headings.length, codeBlocks: codeBlocks.length }),
    wordCount: words,
    source: { adapter: 'habr-html', collectedAt, fromCache, warnings: article.warnings },
  });
}

function publicationFromListItem(item: HabrListItem, collectedAt: string, reason: string): Publication {
  return publicationSchema.parse({
    id: `${PLATFORM}:${item.id}`,
    platform: PLATFORM,
    title: item.title,
    url: item.url,
    publicationDate: item.publishedAt,
    author: item.author,
    hubs: item.hubs,
    topics: item.hubNames,
    metrics: item.metrics,
    source: { adapter: 'habr-html', collectedAt, warnings: [...item.warnings, `article body unavailable: ${reason}`] },
  });
}

export const habrResearch: PlatformResearchAdapter = {
  async collectAuthorHistory(profileUrl: string, ctx: ResearchContext, options: { maxArticles: number }): Promise<CollectionResult<Publication>> {
    const { username, lang } = parseHabrProfileUrl(profileUrl);
    const sources: SourceRecord[] = [];
    const failures: FailureRecord[] = [];
    const warnings: string[] = [];
    ctx.logger.info(`Collecting Habr publications for ${username}...`);
    const listItems = await collectList(ctx, habrUrls.userPublications(username, lang), options.maxArticles, undefined, sources, failures, warnings);
    ctx.logger.info(`Found ${listItems.length} publications on the profile page(s).`);

    const publications = await Promise.all(
      listItems.map(async (item) => {
        try {
          const page = await ctx.http.get(PLATFORM, item.url);
          sources.push(sourceOf(page));
          const article = parseArticlePage(page.body, item.url, ctx.clock.now());
          // List pages sometimes carry metrics the article page lacks and vice versa.
          article.metrics = { ...item.metrics, ...article.metrics };
          return publicationFromArticle(article, page.fetchedAt, page.fromCache);
        } catch (error) {
          failures.push({ url: item.url, stage: 'article', reason: errorMessage(error) });
          return publicationFromListItem(item, ctx.clock.now().toISOString(), errorMessage(error));
        }
      }),
    );
    const missingMetrics = publications.filter((p) => p.metrics.rating === undefined).length;
    if (missingMetrics > 0) ctx.logger.info(`${missingMetrics} publication(s) were missing rating information.`);
    return { items: publications, sources, failures, warnings };
  },

  async collectTrends(ctx: ResearchContext, options: TrendCollectionOptions): Promise<CollectionResult<TrendArticle> & { windows: TrendWindow[] }> {
    const periods = options.periods.filter((p) => PERIODS.has(p));
    const windows: TrendWindow[] = [];
    for (const period of periods) {
      if (options.hubs.length === 0) windows.push({ id: period, period, url: habrUrls.top(period) });
      for (const hub of options.hubs) windows.push({ id: `${period}:${hub}`, period, hub, url: habrUrls.hubTop(hub, period) });
    }
    const sources: SourceRecord[] = [];
    const failures: FailureRecord[] = [];
    const warnings: string[] = [];
    const byId = new Map<string, TrendArticle>();

    for (const window of windows) {
      ctx.logger.info(`Researching Habr ${window.hub ? `${window.hub} ` : ''}${window.period} sample...`);
      const items = await collectList(ctx, window.url, options.maxArticlesPerPeriod, window.id, sources, failures, warnings);
      ctx.logger.info(`Parsed ${items.length} articles from ${window.id}.`);
      for (const item of items) {
        const existing = byId.get(item.id);
        if (existing) {
          if (!existing.seenIn.includes(window.id)) existing.seenIn.push(window.id);
          // Keep the most complete metrics.
          existing.metrics = { ...item.metrics, ...existing.metrics };
          continue;
        }
        const article: TrendArticle = {
          id: `${PLATFORM}:${item.id}`,
          platform: PLATFORM,
          url: item.url,
          title: item.title,
          hubs: item.hubs,
          tags: [],
          metrics: item.metrics,
          seenIn: [window.id],
          titleFeatures: titleFeatures(item.title),
          warnings: item.warnings,
        };
        if (item.author) article.author = item.author;
        if (item.publishedAt) article.publishedAt = item.publishedAt;
        byId.set(item.id, article);
      }
    }

    if (options.fetchArticleBodies) {
      // Bodies whose abstract features are already stored are not downloaded again.
      const toFetch = [...byId.values()].filter((a) => !options.knownFeatures?.has(a.id));
      if (toFetch.length < byId.size) ctx.logger.info(`Skipping ${byId.size - toFetch.length} article bodies whose features are already stored.`);
      await Promise.all(
        toFetch.map(async (article) => {
          try {
            const page = await ctx.http.get(PLATFORM, article.url);
            sources.push(sourceOf(page, 'article'));
            const parsed = parseArticlePage(page.body, article.url, ctx.clock.now());
            // Only abstract features are kept; the body text is discarded here.
            article.structure = structuralFeatures(parsed.blocks);
            article.tags = parsed.tags;
            if (article.hubs.length === 0) article.hubs = parsed.hubs;
            article.metrics = { ...parsed.metrics, ...article.metrics };
          } catch (error) {
            failures.push({ url: article.url, stage: 'article', reason: errorMessage(error) });
          }
        }),
      );
    }
    return { items: [...byId.values()], sources, failures, warnings, windows };
  },
};
