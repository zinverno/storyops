import path from 'node:path';
import { copyFile, readdir, readFile, rm } from 'node:fs/promises';
import { z } from 'zod';
import { createDefaultRegistry } from '../../platforms/registry.js';
import { parseConfig } from '../config/load.js';
import type { OpportunityCandidate, OpportunityReport } from '../opportunity/types.js';
import type { ReviewReport } from '../review/types.js';
import { HttpCache } from '../research/cache.js';
import type { RepoEvent } from '../repo/events.js';
import { fixedClock, type Clock } from '../shared/clock.js';
import { StoryOpsError } from '../shared/errors.js';
import { listFilesRecursive, pathExists, writeJson, writeText } from '../shared/fs.js';
import { sha256 } from '../shared/hash.js';
import { silentLogger, type Logger } from '../shared/logger.js';
import { mdList } from '../shared/markdown.js';
import type { TopicCoverage } from '../author/coverage.js';
import type { SaturationReport } from '../topics/saturation.js';
import type { TrendReport } from '../topics/trends.js';
import { authorSync, coverageWorkflow, importPublication } from '../workflow/author.js';
import { workspaceFor, type AppContext } from '../workflow/context.js';
import { inspectRepoWorkflow } from '../workflow/repo.js';
import { importDatasetWorkflow, researchPlatformWorkflow, topicTrendWorkflow } from '../workflow/research.js';
import { reviewWorkflow } from '../workflow/review.js';
import { compareWorkflow, discoverWorkflow, showWorkflow } from '../workflow/topics.js';
import { buildFixtureRepo } from './fixture-repo.js';
import { packageRoot } from './paths.js';

export const DEMO_NOW = '2026-09-24T12:00:00.000Z';

const manifestSchema = z.object({ authorProfile: z.string(), pages: z.record(z.string(), z.string()) });

/** The fictional human-written article, copied into the demo workspace (never generated). */
export const DEMO_ARTICLE = 'article.md';

export interface DemoResult {
  root: string;
  events: RepoEvent[];
  coverage: TopicCoverage[];
  opportunities: OpportunityReport;
  dossier: OpportunityCandidate;
  comparison: OpportunityCandidate[];
  aiSaturation: SaturationReport;
  aiTrend: TrendReport;
  review: ReviewReport;
  article: { file: string; hashBefore: string; hashAfter: string };
  /** Every file StoryOps wrote in the workspace, relative to it (fixture repository and HTTP cache excluded). */
  writtenFiles: string[];
  summaryFile: string;
  summary: DemoSummary;
}

export interface DemoSummary {
  repository: string[];
  authorArchive: string[];
  platform: string[];
  opportunities: string[];
  review: string[];
  guarantees: string[];
}

/** The demo only deletes an empty directory's contents or a previous demo run (marked by DEMO.md). */
async function prepareOutDir(root: string): Promise<void> {
  if (!pathExists(root)) return;
  const entries = await readdir(root);
  if (entries.length === 0) return;
  if (!entries.includes('DEMO.md')) {
    throw new StoryOpsError('DEMO_DIR_NOT_EMPTY', `${root} is not empty and is not a previous demo run`, { hint: 'Choose an empty or new directory for --out.' });
  }
  for (const entry of entries) await rm(path.join(root, entry), { recursive: true, force: true });
}

export const DEMO_CONFIG = {
  schemaVersion: 2,
  language: 'ru',
  author: { name: 'Demo Author', profiles: { habr: 'https://habr.com/ru/users/demo_author/' }, styleProfile: 'ru-technical' },
  projects: [
    {
      id: 'notegarden',
      name: 'Notegarden',
      path: './notegarden',
      aliases: ['notegarden'],
      glossary: [
        { term: 'аудит', aliases: ['audit'], related: ['architecture'] },
        { term: 'модель здоровья', aliases: ['health model', 'health'], related: ['architecture'] },
        { term: 'жизненный цикл находок', aliases: ['finding lifecycle', 'findings', 'lifecycle'], related: ['architecture'] },
        { term: 'анализ знаний', aliases: ['knowledge analysis', 'knowledge'], related: ['knowledge-management'] },
        { term: 'SQLite', aliases: ['storage'], related: ['databases'] },
        { term: 'квитанции сверки', id: 'reconciliation', aliases: ['reconciliation', 'reconciliation receipts', 'receipts', 'сверка'], related: ['databases', 'architecture'] },
      ],
    },
  ],
  research: { cacheTtlHours: 24, defaultPlatform: 'habr', requestDelayMs: 2000, concurrency: 2 },
  platforms: { habr: { enabled: true, periods: ['weekly'], hubs: [], maxArticlesPerPeriod: 30, fetchArticleBodies: true }, telegram: { enabled: true } },
  review: { profile: 'engineering-story' },
};

/**
 * Offline, deterministic intelligence demo. Uses the real adapters and
 * workflows; network access is replaced by an HTTP cache seeded from
 * fixtures and `offline` mode; time is fixed. StoryOps writes reports only:
 * the one article in the workspace is a fictional HUMAN-written fixture that
 * the demo copies in, and the review proves it stays byte-identical.
 */
export async function runDemo(outDir: string, options: { logger?: Logger; clock?: Clock } = {}): Promise<DemoResult> {
  const pkg = packageRoot();
  const root = path.resolve(outDir);
  const clock = options.clock ?? fixedClock(DEMO_NOW);
  const logger = options.logger ?? silentLogger;
  await prepareOutDir(root);

  // 1. Fixture repository with real git history (old architecture, new subsystems, refactor, a bug fix).
  await buildFixtureRepo(path.join(pkg, 'fixtures/projects/notegarden/history.json'), path.join(root, 'notegarden'));

  // 2. Workspace configuration.
  await writeJson(path.join(root, 'storyops.config.json'), DEMO_CONFIG);
  const config = parseConfig(DEMO_CONFIG);
  const ctx: AppContext = { workspace: workspaceFor(root, config, path.join(root, 'storyops.config.json')), config, configWarnings: [], registry: createDefaultRegistry(), clock, logger };

  // 3. Seed the HTTP cache from fixtures (as if these public pages had just been fetched).
  const manifest = manifestSchema.parse(JSON.parse(await readFile(path.join(pkg, 'fixtures/habr/manifest.json'), 'utf8')));
  const cache = new HttpCache(ctx.workspace.cacheDir, config.research.cacheTtlHours);
  for (const [url, file] of Object.entries(manifest.pages)) {
    await cache.set({ platform: 'habr', url, fetchedAt: clock.now().toISOString(), status: 200, contentType: 'text/html', body: await readFile(path.join(pkg, 'fixtures/habr', file), 'utf8') });
  }

  // 4. Platform history: three imported weekly datasets, then this week's sample through the real Habr adapter (offline).
  for (const file of ['habr-weekly-2026-09-03.json', 'habr-weekly-2026-09-10.json', 'habr-weekly-2026-09-17.json']) await importDatasetWorkflow(ctx, path.join(pkg, 'fixtures/platform', file));
  await researchPlatformWorkflow(ctx, 'habr', { offline: true });

  // 5. Author archive: Habr through the real adapter (offline) + a manually imported Telegram post.
  await authorSync(ctx, { offline: true });
  await importPublication(ctx, path.join(pkg, 'fixtures/author/telegram-2025-04-12-lifecycle.md'));

  // 6. Repository intelligence, then coverage (which uses repository changes to mark outdated coverage).
  const inspected = await inspectRepoWorkflow(ctx, 'notegarden');
  const { rows: coverage } = await coverageWorkflow(ctx);

  // 7. Topic intelligence.
  const { saturation: aiSaturation, trend: aiTrend } = await topicTrendWorkflow(ctx, 'ai-generic', { platform: 'habr' });
  const { report: opportunities } = await discoverWorkflow(ctx, { repo: 'notegarden', platform: 'habr' });
  const { dossier } = await showWorkflow(ctx, 'reconciliation', { repo: 'notegarden', platform: 'habr' });
  const { candidates: comparison } = await compareWorkflow(ctx, ['квитанции сверки', 'Как ИИ помогает развивать мой pet-проект'], { repo: 'notegarden', platform: 'habr' });

  // 8. The HUMAN writes the article. Here: a fictional fixture, copied in unchanged.
  const article = path.join(root, DEMO_ARTICLE);
  await copyFile(path.join(pkg, 'fixtures/review/article.md'), article);
  await copyFile(path.join(pkg, 'fixtures/review/author-input.md'), path.join(root, 'author-input.md'));
  const hashBefore = sha256(await readFile(article));

  // 9. Read-only review.
  const reviewed = await reviewWorkflow(ctx, article, { repo: 'notegarden', platform: 'habr' });
  const hashAfter = sha256(await readFile(article));
  ctx.database?.close();

  const writtenFiles = (await listFilesRecursive(root, { ignore: (rel) => rel.startsWith('notegarden/') || rel.startsWith('.storyops/cache/') })).filter((f) => f !== DEMO_ARTICLE && f !== 'author-input.md');

  const byId = (id: string) => opportunities.candidates.find((c) => c.id === id);
  const reconciliation = byId('reconciliation');
  const audit = byId('audit');
  const generic = comparison[1]!;
  const f = reviewed.report.findings;
  const summary: DemoSummary = {
    repository: [
      `${inspected.events.length} events extracted; new subsystem src/reconciliation (${inspected.events.find((e) => e.subsystem === 'src/reconciliation' && e.type === 'new-subsystem')?.evidenceStrength ?? '—'} evidence); bug fix "${inspected.events.find((e) => e.type === 'bug-fix' && e.subsystem === 'src/reconciliation')?.summary ?? '—'}".`,
      'Old architecture: src/audit, introduced 2025-01 and removed 2025-05.',
    ],
    authorArchive: coverage.filter((c) => c.level !== 'not-covered' || c.specificity === 'project').map((c) => `${c.label}: ${c.level}${c.outdated ? ' (possibly outdated)' : ''}`),
    platform: [
      `AI / LLM (general framing): ${aiSaturation.state} (${aiSaturation.because[0]}); trend ${aiTrend.direction} (${aiTrend.because[0]}).`,
      ...(reconciliation?.platform?.primary ? [`Related theme of reconciliation, ${reconciliation.platform.primary.label}: ${reconciliation.platform.primary.state}, activity ${reconciliation.platform.primary.activity}.`] : []),
    ],
    opportunities: [
      ...(reconciliation ? [`Reconciliation receipts: repository novelty ${reconciliation.dimensions.repositoryNovelty.level}, author overlap ${reconciliation.dimensions.authorOverlap.level}, platform activity ${reconciliation.dimensions.platformActivity.level} → ${reconciliation.quadrant}.`] : []),
      ...(audit ? [`One-off audit (old architecture): author overlap ${audit.dimensions.authorOverlap.level} (${audit.author.coverageText}).`] : []),
      `"${generic.query}": saturation ${generic.dimensions.saturation.state}, repository novelty ${generic.dimensions.repositoryNovelty.level} → ${generic.quadrant}.`,
      'No ranking and no winner: the author chooses.',
    ],
    review: [
      `Unsupported performance claim: ${f.filter((x) => x.evidence?.status === 'unsupported').map((x) => `L${x.lines?.start}`).join(', ') || 'not found'}.`,
      `Duplicated paragraph: ${f.filter((x) => x.rule === 'near-duplicate-paragraphs').map((x) => `L${x.lines?.start} ≈ L${x.related?.lines?.start}`).join(', ') || 'not found'}.`,
      `Awkward phrase: ${f.filter((x) => x.rule === 'bureaucratic-enable').map((x) => `L${x.lines?.start} «${x.excerpt}» → possible local alternative «${x.alternative ?? '—'}»`).join(', ') || 'not found'}.`,
      `${reviewed.report.summary.total} finding(s) in total; report ${path.relative(root, reviewed.files.md)}.`,
    ],
    guarantees: [
      `article.md unchanged: sha256 before ${hashBefore.slice(0, 12)}… = after ${hashAfter.slice(0, 12)}….`,
      `No article or draft was generated. StoryOps wrote ${writtenFiles.length} file(s): reports, dossiers and the database.`,
    ],
  };
  const summaryFile = path.join(root, 'DEMO.md');
  await writeText(
    summaryFile,
    [
      '# StoryOps offline intelligence demo',
      '',
      `Fixed clock: ${clock.now().toISOString()}. All data is fictional fixture data. StoryOps analyses; the human writes.`,
      '',
      '## Repository',
      '',
      mdList(summary.repository),
      '',
      '## Author archive (coverage)',
      '',
      mdList(summary.authorArchive),
      '',
      '## Platform (Habr fixture history: 3 imported weeks + 1 offline adapter run)',
      '',
      mdList(summary.platform),
      '',
      '## Opportunities',
      '',
      mdList(summary.opportunities),
      '',
      '## Review of the human-written fixture article',
      '',
      mdList(summary.review),
      '',
      '## Guarantees',
      '',
      mdList(summary.guarantees),
      '',
    ].join('\n'),
  );
  return { root, events: inspected.events, coverage, opportunities, dossier: dossier.candidate, comparison, aiSaturation, aiTrend, review: reviewed.report, article: { file: article, hashBefore, hashAfter }, writtenFiles, summaryFile, summary };
}
