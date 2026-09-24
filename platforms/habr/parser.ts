import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { ContentBlock } from '../../src/research/blocks.js';
import type { PublicationMetrics } from '../../src/publications/schema.js';
import { HABR_SELECTORS } from './selectors.js';
import { habrArticleId, hubSlugFromHref, parseCount, parseHabrDate, parseVotes } from './parse-values.js';

type Root = cheerio.CheerioAPI;
type Selection = cheerio.Cheerio<AnyNode>;

export const HABR_ORIGIN = 'https://habr.com';

export interface HabrListItem {
  id: string;
  url: string;
  title: string;
  author?: string;
  publishedAt?: string;
  hubs: string[];
  hubNames: string[];
  metrics: PublicationMetrics;
  warnings: string[];
}

export interface HabrListPage {
  items: HabrListItem[];
  nextPageUrl?: string;
  warnings: string[];
}

export interface HabrArticlePage {
  id: string;
  url: string;
  title: string;
  author?: string;
  publishedAt?: string;
  hubs: string[];
  hubNames: string[];
  tags: string[];
  metrics: PublicationMetrics;
  blocks: ContentBlock[];
  warnings: string[];
}

function first($: Root, scope: Selection | undefined, selectors: readonly string[]): Selection | undefined {
  for (const selector of selectors) {
    const found = scope ? scope.find(selector) : $(selector);
    if (found.length > 0) return found.first();
  }
  return undefined;
}

function all($: Root, scope: Selection | undefined, selectors: readonly string[]): Selection | undefined {
  for (const selector of selectors) {
    const found = scope ? scope.find(selector) : $(selector);
    if (found.length > 0) return found;
  }
  return undefined;
}

function absolute(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function text(sel: Selection | undefined): string | undefined {
  const value = sel?.text().replace(/\s+/g, ' ').trim();
  return value ? value : undefined;
}

function readMetrics($: Root, scope: Selection | undefined, selectors: typeof HABR_SELECTORS.list | typeof HABR_SELECTORS.article, warnings: string[]): PublicationMetrics {
  const metrics: PublicationMetrics = {};
  const ratingEl = first($, scope, selectors.rating);
  const rating = parseCount(text(ratingEl));
  if (rating) metrics.rating = rating.value;
  else warnings.push('rating missing');
  const votes = parseVotes(ratingEl?.attr('title'));
  if (votes.total !== undefined) metrics.votes = votes.total;
  if (votes.up !== undefined) metrics.votesUp = votes.up;
  if (votes.down !== undefined) metrics.votesDown = votes.down;

  const views = parseCount(text(first($, scope, selectors.views)));
  if (views) {
    metrics.views = views.value;
    if (views.approximate) metrics.viewsApproximate = true;
  } else warnings.push('views missing');

  const bookmarks = parseCount(text(first($, scope, selectors.bookmarks)));
  if (bookmarks) metrics.bookmarks = bookmarks.value;
  else warnings.push('bookmarks missing');

  const commentsText = text(first($, scope, selectors.comments));
  const comments = parseCount(commentsText);
  if (comments) metrics.comments = comments.value;
  else if (commentsText && /коммент|comment/i.test(commentsText)) metrics.comments = 0;
  else warnings.push('comments missing');

  const reading = text(first($, scope, selectors.readingTime))?.match(/(\d+)/);
  if (reading) metrics.readingTimeMinutes = Number(reading[1]);
  return metrics;
}

function readHubs($: Root, links: Selection | undefined): { slugs: string[]; names: string[] } {
  const slugs: string[] = [];
  const names: string[] = [];
  links?.each((_i, el) => {
    const link = $(el);
    // Drop the "*" profile-hub marker and similar decorations.
    const name = link.find('span').first().text().trim() || link.text().replace(/\*/g, '').trim();
    const slug = hubSlugFromHref(link.attr('href'));
    if (slug && !slugs.includes(slug)) slugs.push(slug);
    if (name && !names.includes(name)) names.push(name);
  });
  return { slugs, names };
}

/** Parses a Habr article listing page (top lists, hub lists, author publication lists). */
export function parseArticleList(html: string, pageUrl: string, now: Date): HabrListPage {
  const $ = cheerio.load(html);
  const pageWarnings: string[] = [];
  const items: HabrListItem[] = [];
  const seen = new Set<string>();
  const nodes = all($, undefined, HABR_SELECTORS.list.item);
  if (!nodes) pageWarnings.push(`no article items found on ${pageUrl}; markup may have changed`);

  nodes?.each((_i, el) => {
    const scope = $(el);
    const warnings: string[] = [];
    const link = first($, scope, HABR_SELECTORS.list.titleLink);
    const href = link?.attr('href');
    const title = text(link);
    if (!href || !title) {
      // Ads, promo blocks and placeholders do not have a title link.
      return;
    }
    const url = absolute(href, pageUrl);
    const id = habrArticleId(url) ?? scope.attr('id');
    if (!id) {
      pageWarnings.push(`could not determine article id for ${url}`);
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    const time = first($, scope, HABR_SELECTORS.list.time);
    const publishedAt = parseHabrDate({ datetime: time?.attr('datetime'), title: time?.attr('title'), text: text(time) }, now);
    if (!publishedAt) warnings.push('publication date missing');
    const hubs = readHubs($, all($, scope, HABR_SELECTORS.list.hubLink));
    const metrics = readMetrics($, scope, HABR_SELECTORS.list, warnings);
    const item: HabrListItem = { id, url: canonicalArticleUrl(url), title, hubs: hubs.slugs, hubNames: hubs.names, metrics, warnings };
    const author = text(first($, scope, HABR_SELECTORS.list.author));
    if (author) item.author = author;
    if (publishedAt) item.publishedAt = publishedAt;
    items.push(item);
  });

  const page: HabrListPage = { items, warnings: pageWarnings };
  const next = first($, undefined, HABR_SELECTORS.list.nextPage)?.attr('href') ?? inferNextPage($, pageUrl);
  if (next) page.nextPageUrl = absolute(next, pageUrl);
  return page;
}

function inferNextPage($: Root, pageUrl: string): string | undefined {
  const current = Number(pageUrl.match(/\/page(\d+)\/?/)?.[1] ?? '1');
  let found: string | undefined;
  all($, undefined, HABR_SELECTORS.list.paginationLinks)?.each((_i, el) => {
    const href = $(el).attr('href');
    const n = Number(href?.match(/\/page(\d+)\/?/)?.[1]);
    if (n === current + 1) found = href;
  });
  return found;
}

export function canonicalArticleUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    return u.toString();
  } catch {
    return url;
  }
}

interface JsonLdArticle {
  headline?: string;
  datePublished?: string;
  author?: { name?: string } | Array<{ name?: string }>;
  keywords?: string | string[];
}

function readJsonLd($: Root): JsonLdArticle | undefined {
  let result: JsonLdArticle | undefined;
  all($, undefined, HABR_SELECTORS.article.jsonLd)?.each((_i, el) => {
    if (result) return;
    try {
      const data = JSON.parse($(el).text()) as unknown;
      const candidates = Array.isArray(data) ? data : [data];
      for (const c of candidates) {
        if (c && typeof c === 'object' && 'headline' in c) {
          result = c as JsonLdArticle;
          return;
        }
      }
    } catch {
      // malformed JSON-LD is ignored; HTML fields are the primary source
    }
  });
  return result;
}

/** Parses a single Habr article page into metadata + platform-neutral content blocks. */
export function parseArticlePage(html: string, pageUrl: string, now: Date): HabrArticlePage {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const jsonLd = readJsonLd($);
  const title = text(first($, undefined, HABR_SELECTORS.article.title)) ?? jsonLd?.headline;
  if (!title) throw new Error(`Habr article page ${pageUrl} has no recognisable title; markup may have changed`);
  const id = habrArticleId(pageUrl);
  if (!id) throw new Error(`Cannot determine Habr article id from ${pageUrl}`);

  const time = first($, undefined, HABR_SELECTORS.article.time);
  const publishedAt =
    parseHabrDate({ datetime: time?.attr('datetime'), title: time?.attr('title'), text: text(time) }, now) ??
    (jsonLd?.datePublished ? parseHabrDate({ datetime: jsonLd.datePublished }, now) : undefined);
  if (!publishedAt) warnings.push('publication date missing');

  const jsonAuthor = Array.isArray(jsonLd?.author) ? jsonLd?.author[0]?.name : jsonLd?.author?.name;
  const author = text(first($, undefined, HABR_SELECTORS.article.author)) ?? jsonAuthor;

  let hubs = { slugs: [] as string[], names: [] as string[] };
  const tags: string[] = [];
  all($, undefined, HABR_SELECTORS.article.metaList)?.each((_i, el) => {
    const list = $(el);
    const heading = text(first($, list, HABR_SELECTORS.article.metaListTitle))?.toLowerCase() ?? '';
    const links = list.find(HABR_SELECTORS.article.metaListLink[0]);
    if (/хаб|hub/.test(heading)) hubs = readHubs($, links);
    else if (/тег|tag|ключев/.test(heading)) {
      links.each((_j, a) => {
        const tag = $(a).text().trim();
        if (tag && !tags.includes(tag)) tags.push(tag);
      });
    }
  });
  if (tags.length === 0 && jsonLd?.keywords) {
    const kw = Array.isArray(jsonLd.keywords) ? jsonLd.keywords : jsonLd.keywords.split(',');
    for (const k of kw.map((s) => s.trim()).filter(Boolean)) if (!tags.includes(k)) tags.push(k);
  }
  if (hubs.slugs.length === 0) warnings.push('hubs missing');
  if (tags.length === 0) warnings.push('tags missing');

  const metrics = readMetrics($, undefined, HABR_SELECTORS.article, warnings);
  const body = first($, undefined, HABR_SELECTORS.article.body);
  const blocks = body ? extractBlocks($, body, pageUrl) : [];
  if (!body) warnings.push('article body missing');

  const page: HabrArticlePage = { id, url: canonicalArticleUrl(pageUrl), title, hubs: hubs.slugs, hubNames: hubs.names, tags, metrics, blocks, warnings };
  if (author) page.author = author;
  if (publishedAt) page.publishedAt = publishedAt;
  return page;
}

function inlineText($: Root, el: Selection): string {
  const clone = el.clone();
  clone.find('code').each((_i, c) => {
    const code = $(c);
    code.replaceWith(`\`${code.text()}\``);
  });
  clone.find('br').replaceWith('\n');
  return clone.text().replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*/g, '\n').trim();
}

/** Converts Habr's article body HTML into platform-neutral blocks. */
export function extractBlocks($: Root, body: Selection, pageUrl: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const visit = (node: AnyNode) => {
    if (node.type !== 'tag') return;
    const el = node as Element;
    const $el = $(el);
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const t = inlineText($, $el);
      if (t) blocks.push({ type: 'heading', level: Number(tag.slice(1)), text: t });
      return;
    }
    if (tag === 'pre') {
      const code = $el.find('code').first();
      const source = (code.length ? code : $el).text();
      const language = (code.attr('class') ?? $el.attr('class') ?? '').split(/\s+/).map((c) => c.replace(/^language-/, '')).find((c) => c && c !== 'hljs');
      const block: ContentBlock = { type: 'code', lines: source.replace(/\n+$/, '').split('\n').length };
      if (language) block.language = language;
      blocks.push(block);
      return;
    }
    if (tag === 'img') {
      const src = $el.attr('data-src') ?? $el.attr('src');
      if (src) {
        const image: ContentBlock = { type: 'image', src: absolute(src, pageUrl) };
        const alt = $el.attr('alt');
        if (alt) image.alt = alt;
        blocks.push(image);
      }
      return;
    }
    if (tag === 'figure') {
      const img = $el.find('img').first();
      const src = img.attr('data-src') ?? img.attr('src');
      if (src) {
        const image: ContentBlock = { type: 'image', src: absolute(src, pageUrl) };
        const alt = img.attr('alt');
        const caption = $el.find('figcaption').text().trim();
        if (alt) image.alt = alt;
        if (caption) image.caption = caption;
        blocks.push(image);
      } else $el.children().each((_i, child) => visit(child));
      return;
    }
    if (tag === 'iframe') {
      const src = $el.attr('src');
      if (src) blocks.push({ type: 'embed', src: absolute(src, pageUrl) });
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      const items = $el.children('li').map((_i, li) => inlineText($, $(li))).get().filter(Boolean);
      if (items.length) blocks.push({ type: 'list', items });
      return;
    }
    if (tag === 'blockquote') {
      const t = inlineText($, $el);
      if (t) blocks.push({ type: 'quote', text: t });
      return;
    }
    if (tag === 'p') {
      $el.find('img').each((_i, img) => visit(img));
      const t = inlineText($, $el);
      if (t) blocks.push({ type: 'paragraph', text: t });
      return;
    }
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
    const hasBlockChildren = $el.children('p,h1,h2,h3,h4,h5,h6,pre,ul,ol,blockquote,figure,div,img,iframe,table').length > 0;
    if (hasBlockChildren) {
      $el.contents().each((_i, child) => {
        if (child.type === 'text') {
          const t = $(child).text().trim();
          if (t) blocks.push({ type: 'paragraph', text: t });
        } else visit(child);
      });
    } else {
      const t = inlineText($, $el);
      if (t) blocks.push({ type: 'paragraph', text: t });
    }
  };
  body.contents().each((_i, child) => {
    if (child.type === 'text') {
      const t = $(child).text().trim();
      if (t) blocks.push({ type: 'paragraph', text: t });
    } else visit(child);
  });
  return blocks;
}
