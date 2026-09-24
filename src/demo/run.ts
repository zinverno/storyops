import path from 'node:path';
import { readdir, readFile, rm } from 'node:fs/promises';
import { z } from 'zod';
import { createDefaultRegistry } from '../../platforms/registry.js';
import { parseConfig } from '../config/load.js';
import type { CollisionReport } from '../collision/analyze.js';
import { HttpCache } from '../research/cache.js';
import type { ResearchSnapshot } from '../research/types.js';
import { fixedClock, type Clock } from '../shared/clock.js';
import { pathExists, writeJson, writeText } from '../shared/fs.js';
import { EditorialError } from '../shared/errors.js';
import { silentLogger, type Logger } from '../shared/logger.js';
import { mdList } from '../shared/markdown.js';
import { resolveWorkspace, articlePaths } from '../shared/workspace.js';
import { canonicalStorySchema } from '../stories/schema.js';
import { saveStory } from '../stories/store.js';
import type { Brief } from '../briefs/build.js';
import type { NarrativeGapReport } from '../narrative/schema.js';
import type { ContinuityMap } from '../continuity/schema.js';
import { authorSync, importPublication, rebuildAuthorMemory } from '../workflow/author.js';
import type { AppContext } from '../workflow/context.js';
import { narrativeGapWorkflow } from '../workflow/project.js';
import { collisionWorkflow, researchWorkflow } from '../workflow/research.js';
import { evidenceWorkflow, repurposeWorkflow, storyCreateWorkflow } from '../workflow/story.js';
import type { EvidenceMap } from '../evidence/schema.js';
import { buildFixtureRepo } from './fixture-repo.js';
import { packageRoot } from './paths.js';

export const DEMO_NOW = '2026-09-24T12:00:00.000Z';

const manifestSchema = z.object({ authorProfile: z.string(), pages: z.record(z.string(), z.string()) });

export interface DemoResult {
  root: string;
  continuity: ContinuityMap;
  gap: NarrativeGapReport;
  snapshot: ResearchSnapshot;
  genericCollision: CollisionReport;
  storyFile: string;
  evidence: EvidenceMap;
  briefs: Record<string, Brief>;
  outputs: Record<string, string>;
  summaryFile: string;
  summary: DemoSummary;
}

export interface DemoSummary {
  alreadyCovered: string[];
  narrativeGap: string[];
  topicCollision: string[];
  uniqueContribution: string[];
  trendObservations: string[];
  recommendedPackaging: string[];
}

/** The demo only ever deletes an empty directory's contents or a previous demo run (marked by DEMO.md). */
async function prepareOutDir(root: string): Promise<void> {
  if (!pathExists(root)) return;
  const entries = await readdir(root);
  if (entries.length === 0) return;
  if (!entries.includes('DEMO.md')) {
    throw new EditorialError('DEMO_DIR_NOT_EMPTY', `${root} is not empty and is not a previous demo run`, { hint: 'Choose an empty or new directory for --out.' });
  }
  for (const entry of entries) await rm(path.join(root, entry), { recursive: true, force: true });
}

/**
 * Offline, deterministic end-to-end scenario. Uses the real adapters and
 * workflows; network access is replaced by an HTTP cache seeded from
 * fixtures and `offline` mode, and time is fixed.
 */
export async function runDemo(outDir: string, options: { logger?: Logger; clock?: Clock } = {}): Promise<DemoResult> {
  const pkg = packageRoot();
  const root = path.resolve(outDir);
  const clock = options.clock ?? fixedClock(DEMO_NOW);
  const logger = options.logger ?? silentLogger;

  await prepareOutDir(root);

  // 1. Fixture project repository with real git history.
  await buildFixtureRepo(path.join(pkg, 'fixtures/projects/notegarden/history.json'), path.join(root, 'notegarden'));

  // 2. Workspace configuration.
  const manifest = manifestSchema.parse(JSON.parse(await readFile(path.join(pkg, 'fixtures/habr/manifest.json'), 'utf8')));
  const rawConfig = {
    schemaVersion: 1,
    language: 'ru',
    author: { name: 'Demo Author', profiles: { habr: manifest.authorProfile }, styleProfile: 'ru-technical' },
    projects: [
      {
        id: 'notegarden',
        name: 'Notegarden',
        path: './notegarden',
        aliases: ['notegarden'],
        glossary: [
          { term: 'аудит', aliases: ['audit'] },
          { term: 'правила', aliases: ['rules'] },
          { term: 'отчёт', aliases: ['report'] },
          { term: 'модель здоровья', aliases: ['health model', 'health'] },
          { term: 'жизненный цикл находок', aliases: ['finding lifecycle', 'findings', 'lifecycle'] },
          { term: 'анализ знаний', aliases: ['knowledge analysis', 'knowledge'] },
          { term: 'SQLite', aliases: ['storage'] },
        ],
      },
    ],
    research: { cacheTtlHours: 24, defaultPlatform: 'habr', requestDelayMs: 2000, concurrency: 2 },
    platforms: {
      habr: { enabled: true, periods: ['weekly'], hubs: [], maxArticlesPerPeriod: 30, fetchArticleBodies: true },
      medium: { enabled: true },
      linkedin: { enabled: true },
      telegram: { enabled: true },
    },
  };
  await writeJson(path.join(root, 'editorial.config.json'), rawConfig);
  const config = parseConfig(rawConfig);
  const workspace = resolveWorkspace(root);
  const ctx: AppContext = { workspace, config, registry: createDefaultRegistry(), clock, logger };

  // 3. Seed the HTTP cache from fixtures (as if these pages had been fetched just now).
  const cache = new HttpCache(workspace.cacheDir, config.research.cacheTtlHours);
  for (const [url, file] of Object.entries(manifest.pages)) {
    await cache.set({ platform: 'habr', url, fetchedAt: clock.now().toISOString(), status: 200, contentType: 'text/html', body: await readFile(path.join(pkg, 'fixtures/habr', file), 'utf8') });
  }

  // 4. Author memory: Habr history through the real adapter (offline), plus a manually imported Telegram post.
  await authorSync(ctx, { offline: true });
  await importPublication(ctx, path.join(pkg, 'fixtures/author/telegram-2025-04-12-lifecycle.md'));
  const { continuity } = await rebuildAuthorMemory(ctx);

  // 5. Project research + narrative gap.
  const { gap } = await narrativeGapWorkflow(ctx, 'notegarden');

  // 6. Platform research (offline, cached fixture pages).
  const { snapshot } = await researchWorkflow(ctx, 'habr', { offline: true });

  // 7. Topic collision for a generic angle.
  const genericCollision = await collisionWorkflow(ctx, 'Как ИИ помогает развивать мой pet-проект Notegarden', { projectId: 'notegarden' });

  // 8. Canonical story: skeleton from the workflow, then the narrative fields an
  //    author/agent would write from evidence (examples/canonical-story.example.json).
  const { story: skeleton } = await storyCreateWorkflow(ctx, { topic: 'Notegarden: от разового аудита к постоянной модели здоровья', projectId: 'notegarden', slug: 'notegarden-health-model' });
  const authored = canonicalStorySchema.parse(JSON.parse(await readFile(path.join(pkg, 'examples/canonical-story.example.json'), 'utf8')));
  const story = { ...authored, createdAt: skeleton.createdAt, updatedAt: clock.now().toISOString(), relationToPreviousPublications: skeleton.relationToPreviousPublications, provenance: [...skeleton.provenance, 'narrative fields: examples/canonical-story.example.json'] };
  const paths = articlePaths(workspace, story.slug);
  await saveStory(workspace, paths.story, story);

  // 9. Evidence, then platform outputs derived independently from the same story.
  const { map: evidence } = await evidenceWorkflow(ctx, paths.story);
  const briefs: Record<string, Brief> = {};
  const outputs: Record<string, string> = {};
  for (const [platform, type, primary] of [['habr', 'architecture-deep-dive', true], ['telegram', 'short-project-update', false], ['linkedin', 'engineering-story', false], ['medium', 'engineering-story', false]] as const) {
    const res = await repurposeWorkflow(ctx, paths.story, platform, { type, primary });
    briefs[platform] = res.brief;
    outputs[platform] = res.output;
  }

  // 10. Human-readable summary of the scenario.
  const project = continuity.projects.find((p) => p.id === 'notegarden');
  const habr = briefs.habr!;
  const summary: DemoSummary = {
    alreadyCovered: project?.coveredAspects.filter((a) => a.aspect === 'project-origin' || a.aspect === 'architecture').map((a) => `${a.label} (${a.publication.title})`) ?? [],
    narrativeGap: [gap.headline ?? '', ...gap.gaps.filter((g) => g.kind === 'new-subsystem').map((g) => `${g.title} — ${g.coverage}`)].filter(Boolean),
    topicCollision: genericCollision.summary,
    uniqueContribution: habr.uniqueContribution,
    trendObservations: snapshot.observations.filter((o) => o.id === 'title-conflict' || o.id === 'body-conflict-early').map((o) => o.statement),
    recommendedPackaging: habr.packaging.map((p) => `${p.advisory ? '(advisory) ' : ''}${p.text} [${p.source}]`),
  };
  const summaryFile = path.join(root, 'DEMO.md');
  await writeText(
    summaryFile,
    [
      '# editorial-kit offline demo',
      '',
      `Fixed clock: ${clock.now().toISOString()}. All data is fictional fixture data.`,
      '',
      '## Already covered',
      '',
      mdList(summary.alreadyCovered),
      '',
      '## Narrative gap',
      '',
      mdList(summary.narrativeGap),
      '',
      '## Topic collision ("Как ИИ помогает развивать мой pet-проект Notegarden")',
      '',
      mdList(summary.topicCollision),
      '',
      '## Unique contribution',
      '',
      mdList(summary.uniqueContribution),
      '',
      '## Trend observations (Habr weekly fixture sample)',
      '',
      mdList(summary.trendObservations),
      '',
      '## Recommended packaging (Habr)',
      '',
      mdList(summary.recommendedPackaging),
      '',
      '## Outputs derived from one canonical story',
      '',
      mdList(Object.entries(outputs).map(([p, f]) => `${p}: ${path.relative(root, f)}`)),
      '',
    ].join('\n'),
  );
  return { root, continuity, gap, snapshot, genericCollision, storyFile: paths.story, evidence, briefs, outputs, summaryFile, summary };
}
