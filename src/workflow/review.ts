import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadPublications } from '../author/store.js';
import type { StoryDb } from '../db/database.js';
import { windowArticles, windowEnding, saturationFor } from '../platform/analytics.js';
import { parseAuthorInput } from '../review/author-input.js';
import type { PlatformContext } from '../review/checks/context.js';
import { loadProfileCatalog } from '../review/profiles.js';
import { renderReview } from '../review/render.js';
import { reviewArticle } from '../review/review.js';
import { loadDecisions, storeReview } from '../review/store.js';
import type { ReviewReport } from '../review/types.js';
import { StoryOpsError } from '../shared/errors.js';
import { pathExists, toPosix, writeJson, writeText } from '../shared/fs.js';
import { sha256 } from '../shared/hash.js';
import { slugify } from '../shared/text.js';
import { matchTopics } from '../topics/match.js';
import { compileStoredTopics, loadTopics } from '../topics/registry.js';
import { db, saveDb, type AppContext } from './context.js';
import { repoEvidence } from './repo.js';

/**
 * `storyops review <article.md>`: read-only review of a human-written
 * article. The article is read exactly once; reports go to
 * reviews/<article>-<date>/review.{json,md}. The workflow refuses any output
 * path that would touch the article, and verifies afterwards that the file
 * is byte-identical.
 */

export interface ReviewOptions {
  repo?: string;
  platform?: string;
  profile?: string;
  /** author-input.md; default: next to the article when it exists. */
  input?: string;
  out?: string;
  /** Compare with the author's archive (default true when the archive is not empty). */
  archive?: boolean;
  /** Do not store the review or read decisions from the database. */
  noDb?: boolean;
  /** Publication type for platform length context. */
  type?: string;
}

export interface ReviewResult {
  report: ReviewReport;
  files: { json: string; md: string };
  articleHashBefore: string;
  articleHashAfter: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function platformContext(ctx: AppContext, database: StoryDb, platform: string, markdown: string, type?: string): PlatformContext {
  const strategy = ctx.registry.get(platform).strategy;
  const w = windowEnding(ctx.clock.now(), ctx.config.analysis.windowDays * 3);
  const rows = database.all<{ word_count: number | null; heading_density: number | null; intro_words: number | null; code_blocks: number | null; conflict_first: number | null; article_id: string }>(
    `SELECT f.word_count, f.heading_density, f.intro_words, f.code_blocks, f.conflict_first, f.article_id FROM platform_article_features f JOIN platform_articles a ON a.id = f.article_id
      WHERE a.platform_id = ? AND f.has_body = 1 AND (a.published_at IS NULL OR a.published_at > ?)`,
    [platform, w.start],
  );
  const ranks = new Map(database.all<{ article_id: string; best: number }>(`SELECT ra.article_id, MIN(CAST(ra.momentum_rank AS REAL) / (SELECT COUNT(*) FROM research_run_articles x WHERE x.run_id = ra.run_id)) AS best FROM research_run_articles ra JOIN research_runs r ON r.id = ra.run_id WHERE r.platform_id = ? AND ra.momentum_rank IS NOT NULL GROUP BY ra.article_id`, [platform]).map((r) => [r.article_id, r.best]));
  const nums = (k: keyof (typeof rows)[number]) => rows.map((r) => r[k]).filter((v): v is number => typeof v === 'number');
  const top = rows.filter((r) => (ranks.get(r.article_id) ?? 1) <= 1 / 3);
  const rest = rows.filter((r) => (ranks.get(r.article_id) ?? 1) > 1 / 3);
  const share = (xs: typeof rows) => (xs.length >= 3 ? xs.filter((r) => r.conflict_first === 1).length / xs.length : null);
  const topics = loadTopics(database);
  const compiled = compileStoredTopics(topics);
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1] ?? '';
  const subheads = [...markdown.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1]!);
  const matched = matchTopics({ title: heading, headings: subheads }, compiled).map((m) => m.topicId);
  const window = windowEnding(ctx.clock.now(), ctx.config.analysis.windowDays);
  const current = windowArticles(database, platform, window);
  const pctx: PlatformContext = {
    strategy,
    ...(type ? { publicationType: type } : {}),
    topics: matched
      .map((id) => topics.find((t) => t.id === id)!)
      .map((t) => {
        const s = saturationFor(database, platform, t, window, ctx.config.analysis, { current, previous: [] });
        return { topicId: t.id, label: t.label, state: s.state, share: s.metrics.share, articleCount: s.metrics.articleCount, sampleSize: s.metrics.sampleSize };
      }),
  };
  pctx.titles = database.all<{ id: string; title: string; url: string }>('SELECT id, title, url FROM platform_articles WHERE platform_id = ?', [platform]);
  if (rows.length) pctx.sample = { n: rows.length, wordCount: median(nums('word_count')), headingDensity: median(nums('heading_density')), introWords: median(nums('intro_words')), codeBlocks: median(nums('code_blocks')), conflictFirstShare: share(rest), topConflictFirstShare: share(top) };
  return pctx;
}

export async function reviewWorkflow(ctx: AppContext, articleFile: string, options: ReviewOptions = {}): Promise<ReviewResult> {
  const article = path.resolve(articleFile);
  if (!pathExists(article)) throw new StoryOpsError('ARTICLE_NOT_FOUND', `No such file: ${articleFile}`);
  const bytes = await readFile(article);
  const before = sha256(bytes);
  const markdown = bytes.toString('utf8');
  const now = ctx.clock.now().toISOString();
  const rel = path.relative(ctx.workspace.root, article);
  const articleKey = rel && !rel.startsWith('..') ? toPosix(rel) : toPosix(article);

  const catalog = await loadProfileCatalog({ workspaceDir: ctx.workspace.reviewProfilesDir });
  const profileId = options.profile ?? ctx.config.review.profile;
  const profile = profileId ? catalog.get(profileId).profile : undefined;

  const inputFile = options.input ? path.resolve(options.input) : path.join(path.dirname(article), 'author-input.md');
  const authorInput = pathExists(inputFile) && inputFile !== article ? { file: toPosix(path.relative(ctx.workspace.root, inputFile)), input: parseAuthorInput(await readFile(inputFile, 'utf8'), { label: inputFile }) } : undefined;
  if (options.input && !authorInput) throw new StoryOpsError('INPUT_NOT_FOUND', `No such author input file: ${options.input}`);

  const useDb = !options.noDb;
  const database = useDb || options.repo || options.platform ? await db(ctx) : undefined;
  const archive = database && options.archive !== false ? loadPublications(database) : [];
  const evidence = options.repo ? await repoEvidence(ctx, options.repo) : undefined;
  const lengthType = options.type ?? profile?.publicationTypes[0];
  const platform = options.platform && database ? platformContext(ctx, database, options.platform, markdown, lengthType) : undefined;

  const report = reviewArticle({
    markdown,
    articlePath: toPosix(article),
    articleKey,
    now,
    languageProfile: ctx.config.author.styleProfile,
    maxAlternativeChars: ctx.config.review.maxAlternativeChars,
    ...(profile ? { profile } : {}),
    ...(evidence ? { repoEvidence: evidence } : {}),
    ...(platform ? { platform } : {}),
    ...(archive.length ? { archive } : {}),
    ...(authorInput ? { authorInput } : {}),
    ...(database && useDb ? { decisions: loadDecisions(database, articleKey) } : {}),
  });

  const outDir = options.out ? path.resolve(options.out) : path.join(ctx.workspace.reviewsDir, `${slugify(path.basename(article, path.extname(article)), 50)}-${now.slice(0, 10)}`);
  const files = { json: path.join(outDir, 'review.json'), md: path.join(outDir, 'review.md') };
  for (const f of [files.json, files.md]) {
    if (path.resolve(f) === article) throw new StoryOpsError('REVIEW_WOULD_OVERWRITE', 'The review output path is the article itself; refusing.', { hint: 'Choose another --out directory.' });
  }
  await writeJson(files.json, report);
  await writeText(files.md, renderReview(report));
  if (database && useDb) {
    storeReview(database, report);
    await saveDb(ctx);
  }
  const after = sha256(await readFile(article));
  if (after !== before) throw new StoryOpsError('ARTICLE_CHANGED', `${articleFile} changed during the review (it was not written by StoryOps; another process edited it).`);
  return { report, files, articleHashBefore: before, articleHashAfter: after };
}
