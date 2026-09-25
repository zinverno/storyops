#!/usr/bin/env node
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { Command, Option } from 'commander';
import { createDefaultRegistry } from '../../platforms/registry.js';
import { COVERAGE_LABEL, coverageText } from '../author/coverage.js';
import { loadPublications } from '../author/store.js';
import { parseConfig, resolveConfigFile } from '../config/load.js';
import { runDemo } from '../demo/run.js';
import { packageRoot } from '../demo/paths.js';
import { dimensionSummary } from '../opportunity/render.js';
import { eventDate } from '../repo/events.js';
import { HttpCache } from '../research/cache.js';
import { loadProfileCatalog, renderProfile } from '../review/profiles.js';
import { latestReviewId, listFindings, setFindingStatus } from '../review/store.js';
import { findingStatusSchema } from '../review/types.js';
import { systemClock } from '../shared/clock.js';
import { StoryOpsError, errorMessage } from '../shared/errors.js';
import { createLogger, type Logger, type LogLevel } from '../shared/logger.js';
import { resolveWorkspace } from '../shared/workspace.js';
import { installSkills, resolveInstallTarget, type SkillAgent, type SkillScope } from '../skills/install.js';
import { validateSkillsDir } from '../skills/validate.js';
import { authorSync, coverageWorkflow, importPublication, overlapWorkflow, rebuildAuthorMemory } from '../workflow/author.js';
import { db, loadContext, saveDb, workspaceFor, type AppContext } from '../workflow/context.js';
import { dbBackupWorkflow, dbRebuildWorkflow, dbStatsWorkflow, dbStatusWorkflow, dbVacuumWorkflow } from '../workflow/db.js';
import { runDoctor } from '../workflow/doctor.js';
import { initWorkspace } from '../workflow/init.js';
import { migrateWorkspace, renderMigration } from '../workflow/migrate.js';
import { eventsWorkflow, inspectRepoWorkflow, repoTopicsWorkflow } from '../workflow/repo.js';
import { importDatasetWorkflow, listTopicsWorkflow, patternsWorkflow, researchHistoryWorkflow, researchPlatformWorkflow, saturationWorkflow, topicTrendWorkflow, trendsWorkflow } from '../workflow/research.js';
import { reviewWorkflow } from '../workflow/review.js';
import { screenshotCaptureWorkflow } from '../workflow/screenshots.js';
import { compareWorkflow, discoverWorkflow, showWorkflow } from '../workflow/topics.js';

export const VERSION = '0.3.0';

interface GlobalOptions {
  cwd?: string;
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFormat?: 'text' | 'json';
}

const invokedAs = path.basename(process.argv[1] ?? 'storyops').replace(/\.js$/, '');

const program = new Command();
program
  .name('storyops')
  .description(
    'StoryOps — research and review for technical authors.\n' +
      'Platform research, topic discovery, repository opportunity mining, author coverage and read-only article review.\n' +
      'StoryOps analyses. The human writes. It never drafts, rewrites or repurposes articles.',
  )
  .version(VERSION)
  .option('-C, --cwd <dir>', 'workspace root (default: current directory)')
  .option('-c, --config <file>', 'config file relative to the workspace root (default: storyops.config.json, else legacy editorial.config.json)')
  .option('-v, --verbose', 'debug logging')
  .option('-q, --quiet', 'only warnings and errors')
  .option('--json', 'print machine-readable JSON results on stdout')
  .addOption(new Option('--log-format <format>', 'log format on stderr').choices(['text', 'json']).default('text'))
  .showHelpAfterError();

function globals(): GlobalOptions {
  return program.opts<GlobalOptions>();
}

function logger(): Logger {
  const g = globals();
  const level: LogLevel = g.verbose ? 'debug' : g.quiet ? 'warn' : 'info';
  return createLogger({ level, format: g.logFormat ?? 'text' });
}

function root(): string {
  return path.resolve(globals().cwd ?? process.cwd());
}

async function ctx(): Promise<AppContext> {
  return loadContext({ root: root(), ...(globals().config ? { configFile: globals().config } : {}), logger: logger() });
}

/** Prints a result: JSON with --json, otherwise the human text. */
function out(json: unknown, text: string | string[]): void {
  if (globals().json) process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  else process.stdout.write(`${Array.isArray(text) ? text.join('\n') : text}\n`);
}

function deprecated(message: string): void {
  process.stderr.write(`DEPRECATED: ${message}\n`);
}

const rel = (p: string) => path.relative(process.cwd(), p) || p;
const list = (value: string) => value.split(',').map((s) => s.trim()).filter(Boolean);
const days = (value: string) => {
  const m = value.match(/^(\d+)\s*d?$/i);
  if (!m) throw new StoryOpsError('BAD_PERIOD', `Period must look like 30d or 30, got "${value}"`);
  return Number(m[1]);
};
const pct = (n: number) => `${Math.round(n * 100)}%`;

// ------------------------------------------------------------------ setup
program
  .command('init')
  .description('create storyops.config.json, the .storyops/ data directory and database, topics/ and reviews/')
  .option('--author <name>', 'author name')
  .option('--habr <profileUrl>', 'public Habr profile URL, e.g. https://habr.com/ru/users/<username>/')
  .option('--force', 'overwrite an existing config')
  .action(async (o: { author?: string; habr?: string; force?: boolean }) => {
    const result = await initWorkspace(root(), { ...(o.force ? { force: true } : {}), ...(o.author ? { authorName: o.author } : {}), ...(o.habr ? { habrProfile: o.habr } : {}) });
    out(result, [...result.created.map((f) => `created ${rel(f)}`), ...result.updated.map((f) => `updated ${rel(f)}`), ...result.skipped.map((f) => `kept existing ${rel(f)} (use --force to overwrite)`), '', 'Next: edit storyops.config.json (author, projects), then run `storyops doctor`.']);
  });

program
  .command('doctor')
  .description('check Node, config, database, git, directories, platforms, review profiles and bundled skills')
  .option('--browser', 'launch Chromium (only the optional screenshot utility needs it)')
  .action(async (o: { browser?: boolean }) => {
    const checks = await runDoctor({ root: root(), ...(globals().config ? { configFile: globals().config } : {}), ...(o.browser ? { launchBrowser: true } : {}) });
    const icon = { ok: '✓', warn: '!', fail: '✗' } as const;
    out(checks, checks.map((c) => `${icon[c.status]} ${c.name}: ${c.message}${c.hint ? `\n    → ${c.hint}` : ''}`));
    if (checks.some((c) => c.status === 'fail')) process.exitCode = 1;
  });

program
  .command('migrate')
  .description('migrate a v2 (editorial-kit) workspace: config, publications, research snapshots, repository reports, style presets → review profiles. Never deletes anything.')
  .option('--dry-run', 'only list what would be migrated; create nothing')
  .action(async (o: { dryRun?: boolean }) => {
    const r = await migrateWorkspace(root(), { ...(o.dryRun ? { dryRun: true } : {}), logger: logger(), ...(globals().config ? { configFile: globals().config } : {}) });
    out(r, [renderMigration(r), ...(r.reportFile ? [`Report: ${rel(r.reportFile)}`] : [])]);
  });

// --------------------------------------------------------------- research
interface ResearchOptions {
  period?: string[];
  hub?: string[];
  max?: number;
  refresh?: boolean;
  offline?: boolean;
}

async function researchPlatformAction(platform: string, o: ResearchOptions): Promise<void> {
  const c = await ctx();
  const r = await researchPlatformWorkflow(c, platform, { ...(o.period ? { periods: o.period } : {}), ...(o.hub ? { hubs: o.hub } : {}), ...(o.max ? { maxArticlesPerPeriod: o.max } : {}), ...(o.refresh ? { refresh: true } : {}), ...(o.offline ? { offline: true } : {}) });
  const s = r.snapshot;
  out({ snapshot: { platform: s.platform, status: s.status, collectedAt: s.collectedAt, sampleSize: s.sampleSize, observations: s.observations.length }, run: r.run, files: r.files, fallback: r.fallback }, [
    `${s.platform}: status ${s.status}, ${s.sampleSize} articles, ${s.observations.length} observations, collected ${s.collectedAt}.`,
    ...(r.run ? [`Research run #${r.run.runId}: ${r.run.newArticles} new article(s), ${r.run.seenAgain} seen again (new metric observations), ${r.run.featuresWritten} feature set(s) stored, ${r.run.featuresUnchanged} unchanged.`] : []),
    ...(r.fallback ? [`LIVE RESEARCH FAILED (${r.fallback.reason}). Earlier snapshot ${rel(r.fallback.snapshotFile)} is ${r.fallback.ageHours}h old; nothing new was recorded.`] : []),
    ...(s.status === 'unsupported' ? ['Live research is unsupported for this platform. Import a dataset with `storyops research import <file.json>`.'] : []),
    ...(r.files ? [`Report: ${rel(r.files.md)}`] : []),
  ]);
}

const research = program
  .command('research')
  .description('platform research and author archive collection; history accumulates in the database')
  .option('-p, --platform <id>', '(deprecated form) same as `research platform <id>`')
  .option('--period <periods>', 'comma-separated: daily,weekly,monthly', list)
  .option('--hub <hubs>', 'comma-separated hub slugs', list)
  .option('--max <n>', 'max articles per window', (v) => Number(v))
  .option('--refresh', 'ignore fresh cache entries')
  .option('--offline', 'use cached pages only')
  .action(async (o: ResearchOptions & { platform?: string }) => {
    if (!o.platform) {
      research.help();
      return;
    }
    deprecated('`research -p <platform>` → use `storyops research platform <platform>`.');
    await researchPlatformAction(o.platform, o);
  });
research
  .command('platform <id>')
  .description('collect a dated research sample (live for Habr): metadata, metrics and abstract features only')
  .option('--period <periods>', 'comma-separated: daily,weekly,monthly', list)
  .option('--hub <hubs>', 'comma-separated hub slugs', list)
  .option('--max <n>', 'max articles per window', (v) => Number(v))
  .option('--refresh', 'ignore fresh cache entries (and re-read article bodies)')
  .option('--offline', 'use cached pages only')
  .action(researchPlatformAction);
research
  .command('author')
  .description('collect your public publications (live adapter: Habr) into the archive and rebuild coverage')
  .option('-p, --platform <ids>', 'comma-separated platform ids', list)
  .option('--max <n>', 'maximum publications per platform', (v) => Number(v), 100)
  .option('--refresh', 'ignore fresh cache entries')
  .option('--offline', 'use cached pages only')
  .action(async (o: AuthorSyncOptions) => authorSyncAction(o));
research
  .command('history')
  .description('list accumulated research runs')
  .option('-p, --platform <id>', 'platform id')
  .option('--limit <n>', 'number of runs', (v) => Number(v), 30)
  .action(async (o: { platform?: string; limit: number }) => {
    const c = await ctx();
    const r = await researchHistoryWorkflow(c, { ...(o.platform ? { platform: o.platform } : {}), limit: o.limit });
    out(r, [
      `${r.articles} article(s), ${r.metricObservations} metric observation(s), ${r.runs.length} run(s) shown.`,
      ...r.runs.map((x) => `#${String(x.id).padEnd(4)} ${x.collectedAt.slice(0, 16)}  ${x.platform.padEnd(8)} ${x.origin.padEnd(15)} ${String(x.sampleSize).padStart(4)} articles  ${x.label ?? [...x.periods, ...x.hubs].join(',')}`),
    ]);
  });
research
  .command('import <dataset>')
  .description('import a platform dataset (JSON: metadata, metrics and optional abstract features; no article bodies)')
  .action(async (file: string) => {
    const c = await ctx();
    const r = await importDatasetWorkflow(c, path.resolve(file));
    out(r.run, r.run.duplicate ? `Already imported as run #${r.run.runId}; nothing changed.` : `Imported ${r.snapshot.sampleSize} article(s) from ${r.snapshot.platform} as run #${r.run.runId} (${r.run.newArticles} new, ${r.run.seenAgain} seen again).`);
  });

// ---------------------------------------------------------- trends et al.
interface TopicTrendOptions {
  platform?: string;
  period?: number;
  window?: number;
  since?: number;
  basis?: 'research-runs' | 'publication-dates';
}

async function topicTrendAction(topic: string, o: TopicTrendOptions): Promise<void> {
  const c = await ctx();
  const r = await topicTrendWorkflow(c, topic, { ...(o.platform ? { platform: o.platform } : {}), ...(o.period ? { days: o.period } : {}), ...(o.window ? { windowDays: o.window } : {}), ...(o.since ? { sinceDays: o.since } : {}), ...(o.basis ? { basis: o.basis } : {}) });
  const s = r.saturation;
  out(r, [
    `${r.topic.label} on ${s.platform}: saturation ${s.state} — ${s.because.join('; ')}.`,
    `Trend: ${r.trend.direction} (basis ${r.trend.basis}, ${r.trend.windowDays}-day buckets, ${r.trend.timeRange ? `${r.trend.timeRange.from.slice(0, 10)} → ${r.trend.timeRange.to.slice(0, 10)}` : 'no data'}, sample ${r.trend.sampleSize}).`,
    ...r.trend.because.map((b) => `  ${b}`),
    ...r.trend.buckets.map((b) => `  ${b.start.slice(0, 10)} → ${b.end.slice(0, 10)}  ${String(b.count).padStart(3)}/${String(b.sample).padEnd(4)} ${b.share === null ? '   —' : pct(b.share).padStart(4)}${b.usable ? '' : '  (too small)'}`),
    `Report: ${rel(r.files.md)}`,
  ]);
}

const trends = program
  .command('trends')
  .description('topic landscape of a platform: share, authors, saturation state, activity and trend direction per topic')
  .option('-p, --platform <id>', 'platform id (default: research.defaultPlatform)')
  .option('--period <days>', 'analysis window, e.g. 30d', days)
  .option('--limit <n>', 'rows', (v) => Number(v), 40)
  .action(async (o: { platform?: string; period?: number; limit: number }) => {
    const c = await ctx();
    const r = await trendsWorkflow(c, { ...(o.platform ? { platform: o.platform } : {}), ...(o.period ? { days: o.period } : {}), limit: o.limit });
    out(r, [
      `${r.platform}: ${r.window.start.slice(0, 10)} → ${r.window.end.slice(0, 10)} (${r.window.days} days), ${r.runs} research run(s) in history. Shares describe the sample, not topic quality.`,
      ...r.rows.map((x) => `${x.label.padEnd(36)} ${`${x.saturation.metrics.articleCount}/${x.saturation.metrics.sampleSize}`.padStart(7)} ${pct(x.saturation.metrics.share).padStart(4)}  ${x.saturation.state.padEnd(17)} activity ${x.activity.level.padEnd(7)} trend ${x.trend.direction}`),
      `Report: ${rel(r.files.md)}`,
    ]);
  });
trends
  .command('topic <topic>')
  .description('one topic: saturation dimensions and trend direction')
  .option('-p, --platform <id>', 'platform id')
  .option('--period <days>', 'analysis window, e.g. 30d', days)
  .option('--window <days>', 'trend bucket width, e.g. 7d', days)
  .action(topicTrendAction);
trends
  .command('history <topic>')
  .description('trend history of a topic across research runs (buckets, shares, comparison window)')
  .option('-p, --platform <id>', 'platform id')
  .option('--window <days>', 'bucket width, e.g. 7d', days)
  .option('--since <days>', 'look back this many days, e.g. 120d', days)
  .addOption(new Option('--basis <basis>', 'observation basis').choices(['research-runs', 'publication-dates']))
  .action(topicTrendAction);

program
  .command('saturation')
  .description('topic saturation with every dimension and the rule that assigned the state')
  .option('-p, --platform <id>', 'platform id')
  .option('-t, --topic <topic>', 'one topic (default: all topics in the window)')
  .option('--period <days>', 'analysis window, e.g. 30d', days)
  .action(async (o: { platform?: string; topic?: string; period?: number }) => {
    const c = await ctx();
    const r = await saturationWorkflow(c, { ...(o.platform ? { platform: o.platform } : {}), ...(o.topic ? { topic: o.topic } : {}), ...(o.period ? { days: o.period } : {}) });
    out(r, [...r.reports.map((s) => `${s.label}: ${s.state} — ${s.because.join('; ')}`), `Report: ${rel(r.files.md)}`]);
  });

program
  .command('patterns')
  .description('pattern report: structural/framing patterns observed in the research history (never applied automatically)')
  .option('-p, --platform <id>', 'platform id')
  .option('--runs <n>', 'research runs to include in the history', (v) => Number(v))
  .action(async (o: { platform?: string; runs?: number }) => {
    const c = await ctx();
    const r = await patternsWorkflow(c, { ...(o.platform ? { platform: o.platform } : {}), ...(o.runs ? { runs: o.runs } : {}) });
    out(r, [...r.items.map((p) => `${p.patternId} (${p.strength}, ${p.change}): ${p.observation}`), r.items.length ? 'Decision on every pattern: left to the author.' : 'No pattern observations yet.', `Report: ${rel(r.files.md)}`]);
  });

// ----------------------------------------------------------------- author
interface AuthorSyncOptions {
  platform?: string[];
  max: number;
  refresh?: boolean;
  offline?: boolean;
}

async function authorSyncAction(o: AuthorSyncOptions): Promise<void> {
  const c = await ctx();
  const result = await authorSync(c, { maxArticles: o.max, ...(o.platform ? { platforms: o.platform } : {}), ...(o.refresh ? { refresh: true } : {}), ...(o.offline ? { offline: true } : {}) });
  const memory = await rebuildAuthorMemory(c);
  out({ ...result, indexed: memory.publications.length }, [
    `Collected ${result.collected} publication(s): ${Object.entries(result.byPlatform).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'} (${result.added} new, ${result.updated} updated, ${result.unchanged} unchanged).`,
    ...result.skipped.map((s) => `skipped ${s.platform}: ${s.reason}`),
    ...result.failures.map((f) => `failed ${f.stage}${f.url ? ` ${f.url}` : ''}: ${f.reason}`),
    `Archive: ${memory.publications.length} publication(s). Coverage: \`storyops author coverage\`.`,
  ]);
}

const author = program.command('author').description('author intelligence: publication archive, coverage map, overlap');
author
  .command('sync')
  .description('collect your public publications from configured profiles (live adapter: Habr)')
  .option('-p, --platform <ids>', 'comma-separated platform ids', list)
  .option('--max <n>', 'maximum publications per platform', (v) => Number(v), 100)
  .option('--refresh', 'ignore fresh cache entries')
  .option('--offline', 'use cached pages only')
  .action(authorSyncAction);
author
  .command('import <file>')
  .description('import one of YOUR published pieces from Markdown (+ frontmatter: title, platform, date, url, tags, projects, depth). Unpublished drafts are not publications.')
  .option('-p, --platform <id>', 'platform id (telegram, linkedin, medium, generic-blog, ...)')
  .option('--url <url>', 'public URL')
  .option('--date <iso>', 'publication date (ISO 8601)')
  .action(async (file: string, o: { platform?: string; url?: string; date?: string }) => {
    const c = await ctx();
    const { publication, added } = await importPublication(c, path.resolve(file), o);
    await rebuildAuthorMemory(c);
    out(publication, `${added ? 'Imported' : 'Updated'} "${publication.title}" (${publication.platform}, ${publication.depth}).`);
  });
author
  .command('coverage')
  .description('coverage map: which topics you mentioned, covered, covered deeply, revisited, or covered long ago')
  .option('--all', 'include built-in topics you never wrote about')
  .action(async (o: { all?: boolean }) => {
    const c = await ctx();
    const r = await coverageWorkflow(c, o.all ? { all: true } : {});
    out(r, ['Topic                                Coverage', '-'.repeat(60), ...r.rows.map((x) => `${x.label.padEnd(36)} ${coverageText(x)}`), '', `${r.publications} publication(s). Report: ${rel(r.files.md)}`]);
  });
author
  .command('topics')
  .description('topics you have written about (coverage level per topic)')
  .action(async () => {
    const c = await ctx();
    const r = await coverageWorkflow(c);
    const covered = r.rows.filter((x) => x.level !== 'not-covered');
    out(covered, covered.map((x) => `${x.label.padEnd(36)} ${COVERAGE_LABEL[x.level].padEnd(18)} ${x.publications.length} publication(s), last ${x.lastCoveredAt?.slice(0, 10) ?? '—'}`));
  });
author
  .command('overlap <topic>')
  .description('duplicate-topic detection: what of this topic is already in your archive, and what is new')
  .option('--repo <id>', 'repository id')
  .action(async (topic: string, o: { repo?: string }) => {
    const c = await ctx();
    const r = await overlapWorkflow(c, topic, o.repo ? { projectId: o.repo } : {});
    const x = r.candidate;
    out(r, [
      `Overlap: ${x.dimensions.authorOverlap.level} (${x.dimensions.authorOverlap.reason})`,
      '',
      'Already covered:',
      ...(x.author.alreadyCovered.length ? x.author.alreadyCovered.map((a) => `- ${a}`) : ['- nothing on this topic']),
      ...(x.author.similar.length ? ['', 'Similar publications:', ...x.author.similar.map((s) => `- "${s.title}" (cosine ${s.cosine}; ${s.sharedTerms?.slice(0, 5).join(', ')})`)] : []),
      '',
      'New material (repository):',
      ...(x.author.genuinelyNew.length ? x.author.genuinelyNew.map((a) => `- ${a}`) : ['- none found']),
      '',
      `Interpretation: ${r.interpretation}`,
    ]);
  });
author
  .command('profile')
  .description('rebuild the publication index, continuity map, author profile and coverage from the archive')
  .action(async () => {
    const c = await ctx();
    const m = await rebuildAuthorMemory(c);
    out(m.profile, [`Author profile: ${rel(c.workspace.authorProfileMd)}`, `Continuity: ${rel(c.workspace.continuityMd)}`, `${m.publications.length} publication(s).`]);
  });
author
  .command('publications')
  .description('list the archive')
  .action(async () => {
    const c = await ctx();
    const pubs = loadPublications(await db(c));
    await saveDb(c);
    out(pubs.map((p) => ({ id: p.id, platform: p.platform, date: p.publicationDate, title: p.title, depth: p.depth })), pubs.map((p) => `${p.publicationDate?.slice(0, 10) ?? 'undated   '}  ${p.platform.padEnd(12)} ${p.depth?.padEnd(8) ?? '        '} ${p.title}`));
  });

// ------------------------------------------------------------------- repo
async function repoInspectAction(o: { repo?: string; maxCommits?: number }): Promise<void> {
  const c = await ctx();
  const r = await inspectRepoWorkflow(c, o.repo, o.maxCommits ? { maxCommits: o.maxCommits } : {});
  out({ repo: r.report.projectId, events: r.events.length, topics: r.topics.length, unchanged: r.unchanged, files: r.files }, [
    `${r.report.name}: ${r.report.commits.length} commits, ${r.report.tags.length} tags, ${r.report.modules.filter((m) => m.exists).length} modules, ${r.report.tests.files} test files.`,
    `${r.events.length} event(s) (${r.added} new), ${r.topics.length} topic(s).${r.unchanged ? ' Repository unchanged since the last snapshot.' : ''}`,
    ...r.report.warnings.slice(0, 5).map((w) => `warning: ${w}`),
    `Events: ${rel(r.files.events.md)}  Topics: ${rel(r.files.topics.md)}`,
  ]);
}

const repo = program.command('repo').description('repository intelligence (read-only): events and topic map');
repo
  .command('inspect')
  .description('inspect a configured repository (history, docs, ADRs, tests) and extract engineering events and topics')
  .option('--repo <id>', 'repository id (config "projects")')
  .option('--max-commits <n>', 'history limit', (v) => Number(v))
  .action(repoInspectAction);
repo
  .command('events')
  .description('list candidate engineering events with evidence strength and what they were inferred from')
  .option('--repo <id>', 'repository id')
  .option('--since <date>', 'only events ending on/after this date (YYYY-MM-DD)')
  .option('--type <types>', 'comma-separated event types', list)
  .action(async (o: { repo?: string; since?: string; type?: string[] }) => {
    const c = await ctx();
    const r = await eventsWorkflow(c, o.repo, { ...(o.since ? { since: o.since } : {}), ...(o.type ? { types: o.type } : {}) });
    await saveDb(c);
    out(r, r.events.map((e) => `${eventDate(e).slice(0, 10)}  ${e.type.padEnd(22)} ${e.evidenceStrength.padEnd(8)} ${e.basis.padEnd(14)} ${e.summary}`));
  });
repo
  .command('topics')
  .description('repository topic map (events grouped by topic)')
  .option('--repo <id>', 'repository id')
  .action(async (o: { repo?: string }) => {
    const c = await ctx();
    const r = await repoTopicsWorkflow(c, o.repo);
    await saveDb(c);
    out(r, r.topics.map((t) => `${t.label.padEnd(32)} ${String(t.events.length).padStart(3)} event(s)  ${t.types.join(', ')}  (last ${t.lastEventAt.slice(0, 10)})`));
  });

// ----------------------------------------------------------------- topics
const topics = program.command('topics').description('topic discovery: opportunities, dossiers, comparisons (no ranking; you choose)');
topics
  .command('discover')
  .description('opportunity report: repository novelty × author coverage × platform landscape (topics/opportunities.{md,json})')
  .option('--repo <id>', 'repository id')
  .option('-p, --platform <id>', 'platform id for activity/saturation/trend')
  .option('--since <date>', 'only repository events since this date (YYYY-MM-DD)')
  .option('--limit <n>', 'maximum candidates (alphabetical)', (v) => Number(v))
  .action(async (o: { repo?: string; platform?: string; since?: string; limit?: number }) => {
    const c = await ctx();
    const r = await discoverWorkflow(c, { ...(o.repo ? { repo: o.repo } : {}), ...(o.platform ? { platform: o.platform } : {}), ...(o.since ? { since: o.since } : {}), ...(o.limit ? { limit: o.limit } : {}) });
    out(r.report, [
      `${r.report.candidates.length} candidate(s), alphabetical. No ranking: every dimension is shown separately.`,
      ...r.report.candidates.map((x) => `- ${x.topic.label} (\`${x.id}\`): ${dimensionSummary(x)} → ${x.quadrant}`),
      '',
      ...Object.entries(r.report.matrix).filter(([, v]) => v.length).map(([q, v]) => `${q}: ${v.join(', ')}`),
      '',
      `Report: ${rel(r.files.md)}  (details: \`storyops topics show <id>\`)`,
    ]);
  });
topics
  .command('show <id>')
  .description('topic dossier (topics/<id>/dossier.{md,json}): evidence, coverage, platform context, risks, questions')
  .option('--repo <id>', 'repository id')
  .option('-p, --platform <id>', 'platform id')
  .action(async (id: string, o: { repo?: string; platform?: string }) => {
    const c = await ctx();
    const r = await showWorkflow(c, id, { ...(o.repo ? { repo: o.repo } : {}), ...(o.platform ? { platform: o.platform } : {}) });
    const x = r.dossier.candidate;
    const d = x.dimensions;
    out(r.dossier, [
      `Topic: ${x.topic.label}`,
      '',
      `Repository novelty: ${d.repositoryNovelty.level} — ${d.repositoryNovelty.reason}`,
      `Author overlap: ${d.authorOverlap.level} — ${d.authorOverlap.reason}`,
      `Platform activity: ${d.platformActivity.level} — ${d.platformActivity.reason}`,
      `Saturation: ${d.saturation.state}`,
      `Trend: ${d.trendDirection.direction}`,
      `Evidence strength: ${d.evidenceStrength.level}`,
      '',
      'Evidence:',
      ...(x.repository?.events ?? []).slice(0, 10).map((e) => `- ${e.date.slice(0, 10)} ${e.type}: ${e.summary}`),
      '',
      'Already covered:',
      ...(x.author.alreadyCovered.length ? x.author.alreadyCovered.map((a) => `- ${a}`) : ['- nothing']),
      '',
      'Questions:',
      ...x.questions.map((q) => `- ${q}`),
      '',
      `Dossier: ${rel(r.files.md)}`,
    ]);
  });
topics
  .command('compare <topics...>')
  .description('compare topics side by side, dimension by dimension (no winner)')
  .option('--repo <id>', 'repository id')
  .option('-p, --platform <id>', 'platform id')
  .action(async (queries: string[], o: { repo?: string; platform?: string }) => {
    const c = await ctx();
    const r = await compareWorkflow(c, queries, { ...(o.repo ? { repo: o.repo } : {}), ...(o.platform ? { platform: o.platform } : {}) });
    out(r, [...r.candidates.map((x) => `${(x.query ?? x.topic.label).padEnd(40)} ${dimensionSummary(x)} (${x.quadrant})`), '', `No winner is chosen. Report: ${rel(r.files.md)}`]);
  });
topics
  .command('list')
  .description('known topics (built-in taxonomy, config topics, project glossary, repository modules)')
  .action(async () => {
    const c = await ctx();
    const t = await listTopicsWorkflow(c);
    await saveDb(c);
    out(t, t.map((x) => `${x.id.padEnd(28)} ${x.origin.padEnd(9)} ${x.specificity.padEnd(11)} ${x.label}`));
  });

// ----------------------------------------------------------------- review
/** Review works outside a workspace too (defaults, no database). */
async function reviewCtx(): Promise<{ ctx: AppContext; workspace: boolean }> {
  try {
    return { ctx: await ctx(), workspace: true };
  } catch (error) {
    if (!(error instanceof StoryOpsError) || error.code !== 'CONFIG_NOT_FOUND') throw error;
    const config = parseConfig({ author: { name: 'author' } });
    return { ctx: { workspace: workspaceFor(root(), config, resolveConfigFile(root()).file), config, configWarnings: [], registry: createDefaultRegistry(), clock: systemClock, logger: logger() }, workspace: false };
  }
}

program
  .command('review <article>')
  .description('READ-ONLY review of an article YOU wrote: language, style patterns, logic, factual claims, repetition, structure, clarity, platform fit, archive overlap. Never modifies the article.')
  .option('--repo <id>', 'compare factual claims with this repository')
  .option('-p, --platform <id>', 'add platform context (never overrides your choices)')
  .option('--profile <id>', 'review profile (see `storyops profiles list`)')
  .option('--type <publicationType>', 'publication type for platform length context')
  .option('--input <file>', 'author-input.md with MUST USE / VERBATIM / DO NOT USE notes (default: next to the article)')
  .option('--out <dir>', 'report directory (default: reviews/<article>-<date>/)')
  .option('--no-archive', 'do not compare with your previous publications')
  .option('--no-db', 'do not store the review or read earlier decisions')
  .action(async (file: string, o: { repo?: string; platform?: string; profile?: string; type?: string; input?: string; out?: string; archive: boolean; db: boolean }) => {
    const { ctx: c, workspace } = await reviewCtx();
    const r = await reviewWorkflow(c, file, { ...(o.repo ? { repo: o.repo } : {}), ...(o.platform ? { platform: o.platform } : {}), ...(o.profile ? { profile: o.profile } : {}), ...(o.type ? { type: o.type } : {}), ...(o.input ? { input: o.input } : {}), ...(o.out ? { out: o.out } : {}), archive: o.archive && workspace, noDb: !o.db || !workspace });
    const s = r.report.summary;
    out({ report: r.report, files: r.files, articleUnchanged: r.articleHashBefore === r.articleHashAfter }, [
      `${s.total} finding(s): ${Object.entries(s.byCategory).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`,
      ...r.report.findings.filter((f) => f.status === 'open').slice(0, 25).map((f) => `${f.id} ${f.lines ? `L${f.lines.start}`.padEnd(6) : '      '} ${f.category.padEnd(12)} ${f.severity.padEnd(10)} ${f.problem}`),
      ...(s.open > 25 ? [`… ${s.open - 25} more in the report.`] : []),
      '',
      `Article unchanged (sha256 ${r.articleHashAfter.slice(0, 12)}…). Report: ${rel(r.files.md)}`,
    ]);
  });

const findings = program.command('findings').description('review findings: list them and record your decisions (open, accepted, dismissed, resolved)');
findings
  .command('list')
  .option('--review <id>', 'review id (default: the latest review)')
  .action(async (o: { review?: string }) => {
    const c = await ctx();
    const database = await db(c);
    const id = o.review ?? latestReviewId(database);
    if (!id) throw new StoryOpsError('NO_REVIEW', 'No stored review yet.', { hint: 'Run `storyops review <article.md>` in the workspace.' });
    const rows = listFindings(database, id);
    out({ review: id, findings: rows }, [`Review ${id}`, ...rows.map((f) => `${f.id} ${f.lines.padEnd(10)} ${f.category.padEnd(12)} ${f.severity.padEnd(10)} ${f.status.padEnd(9)} ${f.problem}`)]);
  });
findings
  .command('set <finding> <status>')
  .description('record a decision; dismissed/accepted findings keep that status in later reviews of the same article')
  .option('--review <id>', 'review id (default: the latest review)')
  .option('--note <text>', 'why')
  .action(async (finding: string, status: string, o: { review?: string; note?: string }) => {
    const parsed = findingStatusSchema.safeParse(status);
    if (!parsed.success) throw new StoryOpsError('BAD_STATUS', `Status must be one of: ${findingStatusSchema.options.join(', ')}`);
    const c = await ctx();
    const database = await db(c);
    const id = o.review ?? latestReviewId(database);
    if (!id) throw new StoryOpsError('NO_REVIEW', 'No stored review yet.');
    const r = setFindingStatus(database, id, finding.toUpperCase(), parsed.data, c.clock.now().toISOString(), o.note);
    await saveDb(c);
    out({ review: id, finding, status: parsed.data, ...r }, `${finding} in ${id}: ${parsed.data}. Remembered for ${r.articleKey}.`);
  });

// --------------------------------------------------------------------- db
const dbCmd = program.command('db').description('the intelligence database (.storyops/storyops.db)');
dbCmd
  .command('status')
  .description('file, size, schema version and pending migrations (does not migrate)')
  .action(async () => {
    const c = await ctx();
    const s = await dbStatusWorkflow(c);
    out(s, [
      `${rel(s.file)}: ${s.exists ? `${s.bytes ?? '?'} bytes, schema v${s.version} of v${s.latest}` : 'not created yet'}`,
      ...s.applied.map((a) => `  applied ${String(a.version).padStart(3, '0')}-${a.name} at ${a.appliedAt}`),
      ...(s.pending.length ? [`  pending: ${s.pending.join(', ')} (applied automatically by the next command; a backup is written first)`] : []),
      'Backups: `storyops db backup`, or copy the file while no StoryOps command is running.',
    ]);
  });
dbCmd
  .command('stats')
  .description('row counts per table')
  .action(async () => {
    const c = await ctx();
    const s = await dbStatsWorkflow(c);
    out(s, Object.entries(s).map(([k, v]) => `${k.padEnd(28)} ${v}`));
  });
dbCmd
  .command('vacuum')
  .description('compact the database file')
  .action(async () => {
    const c = await ctx();
    const r = await dbVacuumWorkflow(c);
    out(r, `Vacuumed: ${r.before ?? '?'} → ${r.after ?? '?'} bytes.`);
  });
dbCmd
  .command('rebuild')
  .description('recompute derived tables (topic links, trend snapshots, coverage, repository topics) from stored base data')
  .action(async () => {
    const c = await ctx();
    const r = await dbRebuildWorkflow(c);
    out(r, `Rebuilt: ${r.articleTopicLinks} article-topic links, ${r.trendSnapshots} trend snapshot(s), ${r.coverageRows} coverage rows, ${r.repositoryTopicLinks} repository-topic links.`);
  });
dbCmd
  .command('backup [file]')
  .description('copy the database file (default: .storyops/backups/storyops-<time>.db)')
  .action(async (file?: string) => {
    const c = await ctx();
    const dest = await dbBackupWorkflow(c, file);
    out({ backup: dest }, `Backup: ${rel(dest)}`);
  });

// ------------------------------------------------------ platforms/profiles
const platforms = program.command('platforms').description('platform strategies (analysis context and review fit)');
platforms
  .command('list')
  .description('registered platforms and what is available for each')
  .action(() => {
    const rows = createDefaultRegistry().list().map((m) => ({ id: m.strategy.id, name: m.strategy.displayName, strategy: m.strategy.version, liveResearch: m.strategy.research.liveResearch, authorHistory: m.strategy.research.authorHistory, import: m.strategy.research.importSupported }));
    out(rows, rows.map((r) => `${r.id.padEnd(13)} strategy ${r.strategy}  live research: ${r.liveResearch.padEnd(14)} author history: ${r.authorHistory.padEnd(14)} import: ${r.import ? 'yes' : 'no'}`));
  });
platforms
  .command('show <id>')
  .description('print a platform strategy')
  .action((id: string) => {
    const s = createDefaultRegistry().get(id).strategy;
    out(s, JSON.stringify(s, null, 2));
  });

async function workspaceOrDefault() {
  try {
    return (await ctx()).workspace;
  } catch {
    return resolveWorkspace(root());
  }
}

async function profileCatalog() {
  return loadProfileCatalog({ workspaceDir: (await workspaceOrDefault()).reviewProfilesDir });
}

const profiles = program.command('profiles').description('review profiles (what a reviewer expects from an engineering story, postmortem, tutorial…)');
profiles
  .command('list')
  .action(async () => {
    const catalog = await profileCatalog();
    out({ profiles: catalog.list().map((p) => ({ id: p.profile.id, version: p.profile.version, source: p.source })), issues: catalog.issues }, [...catalog.list().map((p) => `${p.profile.id.padEnd(24)} ${p.profile.version.padEnd(8)} ${p.source.padEnd(9)} ${p.profile.displayName}`), ...catalog.issues.map((i) => `${i.severity}: ${rel(i.file)}: ${i.message}`)]);
    if (catalog.issues.some((i) => i.severity === 'error')) process.exitCode = 1;
  });
profiles
  .command('show <id>')
  .action(async (id: string) => {
    const p = (await profileCatalog()).get(id);
    out(p, renderProfile(p));
  });
profiles
  .command('validate')
  .action(async () => {
    const catalog = await profileCatalog();
    out({ valid: catalog.ids(), issues: catalog.issues }, [`${catalog.ids().length} valid profile(s): ${catalog.ids().join(', ')}`, ...catalog.issues.map((i) => `${i.severity}: ${rel(i.file)}: ${i.message}`)]);
    if (catalog.issues.some((i) => i.severity === 'error')) process.exitCode = 1;
  });

// ------------------------------------------------------------------ misc
const cache = program.command('cache').description('inspect or clear the research HTTP cache');
cache
  .command('list')
  .option('-p, --platform <id>')
  .action(async (o: { platform?: string }) => {
    const rows = await new HttpCache((await workspaceOrDefault()).cacheDir, 0).list(o.platform);
    out(rows, rows.length ? rows.map((r) => `${r.fetchedAt}  ${r.platform.padEnd(8)} ${r.status}  ${r.url}`) : 'cache is empty');
  });
cache
  .command('clear')
  .option('-p, --platform <id>')
  .action(async (o: { platform?: string }) => {
    await new HttpCache((await workspaceOrDefault()).cacheDir, 0).clear(o.platform);
    out({ cleared: o.platform ?? 'all' }, `Cleared ${o.platform ?? 'all'} cache entries.`);
  });

const skills = program.command('skills').description('bundled Agent Skills (storyops-research, storyops-opportunity, storyops-review, product-screenshots)');
skills
  .command('validate [dir]')
  .description('validate skills against the Agent Skills specification')
  .action(async (dir?: string) => {
    const target = dir ? path.resolve(dir) : path.join(packageRoot(), 'skills');
    const reports = await validateSkillsDir(target);
    out(reports, reports.map((r) => `${r.issues.some((i) => i.severity === 'error') ? '✗' : '✓'} ${r.name ?? path.basename(r.dir)}${r.issues.map((i) => `\n    ${i.severity}: ${i.message}`).join('')}`));
    if (reports.some((r) => r.issues.some((i) => i.severity === 'error'))) process.exitCode = 1;
  });
skills
  .command('install')
  .description(
    'copy (or link) the bundled skills into a skills directory. Explicit destination required; nothing is installed implicitly.\n' +
      'Destinations: claude project → <cwd>/.claude/skills, claude user → ~/.claude/skills,\n' +
      'codex project → <cwd>/.agents/skills, codex user → ~/.agents/skills.\n' +
      'Legacy Codex skill-installer location: pass --target "$CODEX_HOME/skills" (default ~/.codex/skills) explicitly.',
  )
  .addOption(new Option('--agent <agent>', 'use the documented location for this client').choices(['claude', 'codex']))
  .addOption(new Option('--scope <scope>', 'project (current workspace) or user (home directory)').choices(['project', 'user']).default('project'))
  .option('--target <dir>', 'explicit target directory (overrides --agent/--scope), e.g. "$CODEX_HOME/skills"')
  .option('--link', 'symlink instead of copying (keeps skills in sync with this checkout)')
  .option('--force', 'replace existing skills with the same name')
  .action(async (o: { agent?: SkillAgent; scope: SkillScope; target?: string; link?: boolean; force?: boolean }) => {
    const target = resolveInstallTarget({ projectRoot: root(), scope: o.scope, ...(o.agent ? { agent: o.agent } : {}), ...(o.target ? { target: o.target } : {}) });
    const r = await installSkills(path.join(packageRoot(), 'skills'), target, { ...(o.link ? { link: true } : {}), ...(o.force ? { force: true } : {}) });
    out(r, [`Target: ${r.target}`, ...r.installed.map((s) => `installed ${s}`), ...r.skipped.map((s) => `skipped ${s.skill}: ${s.reason}`)]);
  });

const shots = program.command('screenshots').description('optional utility: capture product screenshots from a plan you wrote (Playwright)');
shots
  .command('capture')
  .description('capture screenshots from a plan into images/originals/ (never overwrites originals without --replace)')
  .requiredOption('--plan <file>', 'screenshot plan JSON (see examples/screenshot-plan.example.json)')
  .option('--out <dir>', 'images directory')
  .option('--replace', 'archive existing originals to originals/.history/ and recapture')
  .option('--only <names>', 'comma-separated step names', list)
  .action(async (o: { plan: string; out?: string; replace?: boolean; only?: string[] }) => {
    const c = await ctx();
    const r = await screenshotCaptureWorkflow(c, path.resolve(o.plan), { ...(o.out ? { out: o.out } : {}), ...(o.replace ? { replace: true } : {}), ...(o.only ? { only: o.only } : {}) });
    out(r, [
      ...r.captured.map((x) => `captured ${x.step} → ${rel(x.file)}`),
      ...r.skipped.map((x) => `skipped ${x.step}: ${x.reason}`),
      ...r.failed.map((x) => `FAILED ${x.step}: ${x.reason}`),
      ...(r.captured.length ? ['', 'Visual review REQUIRED: the privacy scan reads DOM text and form values only, not pixels.', 'Look at every image, then set "visualReview": "passed" in images/manifest.json.'] : []),
    ]);
    if (r.failed.length) process.exitCode = 1;
  });
shots
  .command('plan')
  .description('(removed) plans were derived from canonical stories, which StoryOps no longer creates')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(() => tombstone('screenshots plan', 'Write the plan yourself (examples/screenshot-plan.example.json) and run `storyops screenshots capture --plan <file>`.'));

program
  .command('demo')
  .description('offline intelligence demo: fixture platform history + author archive + repository → opportunities → human-written fixture article → review. No article is generated.')
  .option('--out <dir>', 'output directory (must be empty or a previous demo run)', 'storyops-demo')
  .action(async (o: { out: string }) => {
    const r = await runDemo(path.resolve(o.out), { logger: logger() });
    out(r.summary, [await readFile(r.summaryFile, 'utf8'), `Workspace: ${rel(r.root)}`]);
  });

// ------------------------------------------------- v2 aliases (deprecated)
program
  .command('project', { hidden: true })
  .description('(deprecated) use `storyops repo`')
  .command('inspect')
  .option('-P, --project <id>', 'project id')
  .option('--max-commits <n>', 'history limit', (v) => Number(v))
  .action(async (o: { project?: string; maxCommits?: number }) => {
    deprecated('`project inspect` → use `storyops repo inspect`.');
    await repoInspectAction({ ...(o.project ? { repo: o.project } : {}), ...(o.maxCommits ? { maxCommits: o.maxCommits } : {}) });
  });
program
  .command('gap', { hidden: true })
  .alias('narrative-gap')
  .description('(deprecated) use `storyops topics discover`')
  .option('-P, --project <id>', 'project id')
  .option('--no-reinspect', 'ignored')
  .action(async (o: { project?: string }) => {
    deprecated('`gap` (narrative gap) → use `storyops topics discover`; the narrative gap became repository novelty vs. author coverage.');
    const c = await ctx();
    const r = await discoverWorkflow(c, o.project ? { repo: o.project } : {});
    out(r.report, [...r.report.candidates.map((x) => `- ${x.topic.label}: ${dimensionSummary(x)}`), `Report: ${rel(r.files.md)}`]);
  });
program
  .command('collision', { hidden: true })
  .description('(deprecated) use `storyops author overlap` / `storyops topics compare`')
  .requiredOption('-t, --topic <text>', 'proposed topic')
  .option('-P, --project <id>', 'project id')
  .option('--description <text>', 'ignored')
  .action(async (o: { topic: string; project?: string }) => {
    deprecated('`collision` → use `storyops author overlap "<topic>"` or `storyops topics compare`.');
    const c = await ctx();
    const r = await overlapWorkflow(c, o.topic, o.project ? { projectId: o.project } : {});
    out(r, [`Overlap: ${r.candidate.dimensions.authorOverlap.level} — ${r.candidate.dimensions.authorOverlap.reason}`, `Interpretation: ${r.interpretation}`]);
  });
program
  .command('continuity', { hidden: true })
  .description('(deprecated) use `storyops author coverage`')
  .action(async () => {
    deprecated('`continuity` → use `storyops author coverage` (the continuity map is still written to .storyops/author/continuity.md).');
    const c = await ctx();
    const m = await rebuildAuthorMemory(c);
    out(m.continuity, `Continuity map: ${rel(c.workspace.continuityMd)} (${m.publications.length} publication(s)).`);
  });
program
  .command('publications', { hidden: true })
  .description('(deprecated) use `storyops author publications`')
  .action(async () => {
    deprecated('`publications` → use `storyops author publications`.');
    const c = await ctx();
    const pubs = loadPublications(await db(c));
    out(pubs.map((p) => ({ id: p.id, title: p.title })), pubs.map((p) => `${p.publicationDate?.slice(0, 10) ?? 'undated'}  ${p.platform}  ${p.title}`));
  });
program
  .command('style', { hidden: true })
  .description('(deprecated) use `storyops review`')
  .argument('<file>')
  .allowUnknownOption()
  .action(async (file: string) => {
    deprecated('`style` → use `storyops review <file>` (language and style findings are part of the review).');
    const { ctx: c } = await reviewCtx();
    const r = await reviewWorkflow(c, file, { noDb: true, archive: false });
    out(r.report, [`${r.report.summary.total} finding(s). Report: ${rel(r.files.md)}`]);
  });
program
  .command('styles', { hidden: true })
  .description('(deprecated) use `storyops profiles`')
  .allowUnknownOption()
  .allowExcessArguments()
  .argument('[args...]')
  .action(async () => {
    deprecated('`styles` (style presets) → use `storyops profiles`; presets became review profiles.');
    const catalog = await profileCatalog();
    out(catalog.ids(), catalog.ids());
  });

// ------------------------------------------ removed generation commands
function tombstone(command: string, instead: string): never {
  process.stderr.write(`\`${command}\` is deprecated and was removed: StoryOps no longer generates publication drafts.\n${instead}\n`);
  process.exit(2);
}

const REMOVED: Array<[string, string]> = [
  ['repurpose', 'StoryOps analyses; you write. Review your own text with `storyops review <article.md> --platform <id>`.'],
  ['create', 'Start from `storyops topics discover` and `storyops topics show <id>`; then write the article yourself.'],
  ['story', 'Canonical stories were drafting sources. Use `storyops topics show <id>` for a topic dossier (evidence, coverage, questions).'],
  ['brief', 'Briefs planned generated drafts. Use `storyops topics show <id>` (dossier) instead.'],
  ['evidence', 'Use `storyops review <article.md> --repo <id>` to check your claims against repository evidence.'],
  ['editorial', 'Editorial plans, voice plans and pattern transfer were removed. Use `storyops patterns` (pattern report) and `storyops review`.'],
  ['input', 'Write author-input.md yourself; `storyops review` reads it (MUST USE / VERBATIM / DO NOT USE checks).'],
];
for (const [name, instead] of REMOVED) {
  program
    .command(name, { hidden: true })
    .allowUnknownOption()
    .allowExcessArguments()
    .argument('[args...]')
    .action(() => tombstone(name, instead));
}

if (invokedAs === 'editorial-kit') deprecated('the `editorial-kit` executable is deprecated; use `storyops`.');

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof StoryOpsError) {
    process.stderr.write(`error: ${error.message}\n${error.hint ? `hint: ${error.hint}\n` : ''}`);
  } else {
    process.stderr.write(`error: ${errorMessage(error)}\n`);
    if (globals().verbose && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
  }
  process.exitCode = 1;
});
