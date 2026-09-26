import path from 'node:path';
import { json, type StoryDb } from '../db/database.js';
import { saturationFor, trendFor, windowEnding, patternReport } from '../platform/analytics.js';
import { listRuns } from '../platform/store.js';
import { buildCandidate, candidateForQuery, discoverOpportunities, DISCOVERY_METHOD, NOTICE, opportunityMatrix, type DiscoveryInput, type PlatformLookup } from '../opportunity/discover.js';
import { renderComparison, renderDossier, renderOpportunityReport, type Dossier } from '../opportunity/render.js';
import { OPPORTUNITY_SCHEMA_VERSION, type OpportunityCandidate, type OpportunityReport } from '../opportunity/types.js';
import { latestReport, repositoryTopicMap } from '../repo/store.js';
import { StoryOpsError } from '../shared/errors.js';
import { writeJson, writeText } from '../shared/fs.js';
import { slugify } from '../shared/text.js';
import { topicDir } from '../shared/workspace.js';
import { activityLevel } from '../topics/saturation.js';
import { loadTopics, resolveTopic } from '../topics/registry.js';
import { rebuildAuthorMemory } from './author.js';
import { db, saveDb, type AppContext } from './context.js';
import { ensureInspected } from './repo.js';

/**
 * Topic discovery workflows: opportunities across repository, archive and
 * platform; one topic's dossier (the last StoryOps artifact before the
 * author writes); side-by-side comparison without a winner.
 */

function platformLookup(ctx: AppContext, database: StoryDb, platform: string): PlatformLookup {
  const topics = loadTopics(database);
  const end = ctx.clock.now();
  const w = windowEnding(end, ctx.config.analysis.windowDays);
  const cache = new Map<string, ReturnType<PlatformLookup['theme']>>();
  return {
    id: platform,
    theme(topicId) {
      if (cache.has(topicId)) return cache.get(topicId);
      const topic = topics.find((t) => t.id === topicId);
      let result: ReturnType<PlatformLookup['theme']>;
      if (topic) {
        const s = saturationFor(database, platform, topic, w, ctx.config.analysis);
        if (s.metrics.sampleSize > 0) {
          const trend = trendFor(database, platform, topicId, ctx.config.analysis, { end });
          result = {
            topicId,
            label: topic.label,
            state: s.state,
            share: s.metrics.share,
            articleCount: s.metrics.articleCount,
            sampleSize: s.metrics.sampleSize,
            activity: activityLevel(s, ctx.config.analysis.saturation).level,
            trend: trend.direction,
            because: s.because,
            window: s.window,
            exampleArticles: s.exampleArticleIds.map((id) => ({ id, url: database.value<string>('SELECT url FROM platform_articles WHERE id = ?', [id]) ?? '' })),
          };
        }
      }
      cache.set(topicId, result);
      return result;
    },
  };
}

async function discoveryInput(ctx: AppContext, options: { repo?: string; platform?: string; since?: string }): Promise<DiscoveryInput> {
  const memory = await rebuildAuthorMemory(ctx);
  const database = await db(ctx);
  const topics = loadTopics(database);
  let repo: DiscoveryInput['repo'] = null;
  let repoTopics: DiscoveryInput['repoTopics'] = [];
  if (ctx.config.projects.length) {
    const { project } = await ensureInspected(ctx, options.repo);
    repo = { id: project.id, name: project.name };
    repoTopics = repositoryTopicMap(database, project.id, topics);
  }
  const input: DiscoveryInput = { repo, repoTopics, topics, coverage: memory.coverage, publications: memory.publications, now: ctx.clock.now() };
  if (options.since) input.since = options.since;
  if (options.platform) {
    ctx.registry.get(options.platform);
    input.platform = platformLookup(ctx, database, options.platform);
    input.patterns = patternReport(database, options.platform).items;
  }
  return input;
}

function persistCandidates(database: StoryDb, candidates: readonly OpportunityCandidate[], now: string, platform?: string): void {
  database.tx(() => {
    for (const c of candidates) {
      const topicExists = database.get('SELECT id FROM topics WHERE id = ?', [c.topic.id]);
      database.run(
        `INSERT INTO topic_candidates (id, topic_id, repository_id, label, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, last_seen_at = excluded.last_seen_at, topic_id = excluded.topic_id`,
        [c.id, topicExists ? c.topic.id : null, c.repository?.id ?? null, c.topic.label, now, now],
      );
      database.run('INSERT INTO topic_opportunities (candidate_id, generated_at, platform_id, dimensions, report) VALUES (?, ?, ?, ?, ?)', [c.id, now, platform ?? null, json(c.dimensions), json(c)]);
      database.run('DELETE FROM topic_overlap WHERE candidate_id = ?', [c.id]);
      for (const p of c.author.publications) database.run('INSERT OR REPLACE INTO topic_overlap (candidate_id, publication_id, level, coverage, shared_terms, computed_at) VALUES (?, ?, ?, ?, ?, ?)', [c.id, p.id, c.dimensions.authorOverlap.level, p.level ?? 'related', json([]), now]);
      for (const p of c.author.similar) {
        if (!c.author.publications.some((x) => x.id === p.id)) database.run('INSERT OR REPLACE INTO topic_overlap (candidate_id, publication_id, level, coverage, shared_terms, computed_at) VALUES (?, ?, ?, ?, ?, ?)', [c.id, p.id, 'lexical', 'related', json(p.sharedTerms ?? []), now]);
      }
    }
  });
}

export interface DiscoverResult {
  report: OpportunityReport;
  files: { json: string; md: string };
}

export async function discoverWorkflow(ctx: AppContext, options: { repo?: string; platform?: string; since?: string; limit?: number } = {}): Promise<DiscoverResult> {
  if (ctx.config.projects.length === 0) throw new StoryOpsError('NO_REPOSITORY', 'No repository configured.', { hint: 'Add your project under "projects" in storyops.config.json (id, name, path, glossary).' });
  const input = await discoveryInput(ctx, options);
  const database = await db(ctx);
  const candidates = discoverOpportunities(input, options.limit ? { limit: options.limit } : {});
  const now = ctx.clock.now().toISOString();
  const report = latestReport(database, input.repo!.id);
  const runs = options.platform ? listRuns(database, { platform: options.platform, limit: 1000 }) : [];
  const opportunityReport: OpportunityReport = {
    schemaVersion: OPPORTUNITY_SCHEMA_VERSION,
    generatedAt: now,
    repository: { id: input.repo!.id, name: input.repo!.name, ...(report?.inspectedAt ? { inspectedAt: report.inspectedAt } : {}), ...(report?.head ? { head: report.head } : {}) },
    platform: options.platform ? { id: options.platform, runs: runs.length, ...(runs[0] ? { latestRunAt: runs[0].collectedAt } : {}), windowDays: ctx.config.analysis.windowDays } : null,
    author: { publications: input.publications.length },
    method: DISCOVERY_METHOD,
    notice: NOTICE,
    matrix: opportunityMatrix(candidates),
    candidates,
    limitations: [
      'Repository events are inferred from history, paths and docs; motivation and user impact are not visible.',
      'Coverage and overlap are lexical (glossary, aliases, TF-IDF); paraphrased coverage can be missed.',
      'Platform activity comes from research samples, which are biased toward top lists.',
      'StoryOps does not recommend a topic. It shows dimensions; the author chooses.',
    ],
  };
  persistCandidates(database, candidates, now, options.platform);
  const files = { json: path.join(ctx.workspace.topicsDir, 'opportunities.json'), md: path.join(ctx.workspace.topicsDir, 'opportunities.md') };
  await writeJson(files.json, opportunityReport);
  await writeText(files.md, renderOpportunityReport(opportunityReport));
  await saveDb(ctx);
  return { report: opportunityReport, files };
}

/** The topic dossier: everything StoryOps knows about one candidate, before the author starts writing. */
export async function showWorkflow(ctx: AppContext, idOrQuery: string, options: { repo?: string; platform?: string } = {}): Promise<{ dossier: Dossier; files: { json: string; md: string } }> {
  const platform = options.platform ?? (ctx.registry.has(ctx.config.research.defaultPlatform) ? ctx.config.research.defaultPlatform : undefined);
  const input = await discoveryInput(ctx, { ...options, ...(platform ? { platform } : {}) });
  const id = resolveTopic(input.topics, idOrQuery) ?? idOrQuery;
  const topic = input.topics.find((t) => t.id === id);
  const candidate = topic ? buildCandidate(input, topic, input.repoTopics.find((rt) => rt.topicId === topic.id)) : candidateForQuery(input, idOrQuery);
  const dossier: Dossier = { schemaVersion: 1, generatedAt: ctx.clock.now().toISOString(), candidate, notice: 'This dossier collects evidence and questions. It contains no narrative plan, outline or text: the author writes the article.' };
  const dir = topicDir(ctx.workspace, slugify(candidate.id, 60));
  const files = { json: path.join(dir, 'dossier.json'), md: path.join(dir, 'dossier.md') };
  await writeJson(files.json, dossier);
  await writeText(files.md, renderDossier(dossier));
  persistCandidates(await db(ctx), [candidate], dossier.generatedAt, platform);
  await saveDb(ctx);
  return { dossier, files };
}

export async function compareWorkflow(ctx: AppContext, queries: readonly string[], options: { repo?: string; platform?: string } = {}): Promise<{ candidates: OpportunityCandidate[]; files: { json: string; md: string } }> {
  if (queries.length < 2) throw new StoryOpsError('COMPARE_ARGS', 'Give at least two topics to compare.');
  const platform = options.platform ?? (ctx.registry.has(ctx.config.research.defaultPlatform) ? ctx.config.research.defaultPlatform : undefined);
  const input = await discoveryInput(ctx, { ...options, ...(platform ? { platform } : {}) });
  const candidates = queries.map((q) => candidateForQuery(input, q));
  const files = { json: path.join(ctx.workspace.topicsDir, 'comparison.json'), md: path.join(ctx.workspace.topicsDir, 'comparison.md') };
  await writeJson(files.json, { generatedAt: ctx.clock.now().toISOString(), notice: 'No winner is chosen.', candidates });
  await writeText(files.md, renderComparison(candidates));
  await saveDb(ctx);
  return { candidates, files };
}
