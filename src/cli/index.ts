#!/usr/bin/env node
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { Command, Option } from 'commander';
import { createDefaultRegistry } from '../../platforms/registry.js';
import { checkStyle } from '../author/style-check.js';
import { detectDrift } from '../evidence/collect.js';
import { evidenceMapSchema } from '../evidence/schema.js';
import { loadPublications } from '../publications/store.js';
import { HttpCache } from '../research/cache.js';
import { EditorialError, errorMessage } from '../shared/errors.js';
import { readJson } from '../shared/fs.js';
import { createLogger, type Logger, type LogLevel } from '../shared/logger.js';
import { resolveWorkspace } from '../shared/workspace.js';
import { installSkills, resolveInstallTarget, type SkillAgent, type SkillScope } from '../skills/install.js';
import { validateSkillsDir } from '../skills/validate.js';
import { loadStory } from '../stories/store.js';
import { validateStory } from '../stories/validate.js';
import { runDemo } from '../demo/run.js';
import { packageRoot } from '../demo/paths.js';
import { authorSync, importPublication, rebuildAuthorMemory } from '../workflow/author.js';
import { loadContext, type AppContext } from '../workflow/context.js';
import { runDoctor } from '../workflow/doctor.js';
import { initWorkspace } from '../workflow/init.js';
import { inspectProjectWorkflow, narrativeGapWorkflow, requireProject } from '../workflow/project.js';
import { collisionWorkflow, researchWorkflow } from '../workflow/research.js';
import { screenshotCaptureWorkflow, screenshotPlanWorkflow } from '../workflow/screenshots.js';
import { briefWorkflow, createWorkflow, evidenceWorkflow, repurposeWorkflow, storyCreateWorkflow } from '../workflow/story.js';

interface GlobalOptions {
  cwd?: string;
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFormat?: 'text' | 'json';
}

const program = new Command();
program
  .name('editorial-kit')
  .description(
    'Evidence-backed editorial toolkit: author memory, project research, continuity, narrative gap, platform research, canonical stories, evidence, screenshots and platform strategies.\nIt prepares and checks material; the author (or an AI agent using the bundled Agent Skills) writes the prose.',
  )
  .version('0.1.0')
  .option('-C, --cwd <dir>', 'workspace root (default: current directory)')
  .option('-c, --config <file>', 'config file relative to the workspace root', 'editorial.config.json')
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
  return loadContext({ root: root(), configFile: globals().config ?? 'editorial.config.json', logger: logger() });
}

/** Prints a result: JSON with --json, otherwise the human text. */
function out(json: unknown, text: string | string[]): void {
  if (globals().json) process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  else process.stdout.write(`${Array.isArray(text) ? text.join('\n') : text}\n`);
}

const rel = (p: string) => path.relative(process.cwd(), p) || p;
const list = (value: string) => value.split(',').map((s) => s.trim()).filter(Boolean);

// ------------------------------------------------------------------ setup
program
  .command('init')
  .description('create editorial.config.json, .editorial/ and articles/, and add recommended .gitignore entries')
  .option('--author <name>', 'author name')
  .option('--habr <profileUrl>', 'public Habr profile URL, e.g. https://habr.com/ru/users/<username>/')
  .option('--force', 'overwrite an existing config')
  .action(async (o: { author?: string; habr?: string; force?: boolean }) => {
    const result = await initWorkspace(root(), { ...(o.force ? { force: true } : {}), ...(o.author ? { authorName: o.author } : {}), ...(o.habr ? { habrProfile: o.habr } : {}) });
    out(result, [...result.created.map((f) => `created ${rel(f)}`), ...result.updated.map((f) => `updated ${rel(f)}`), ...result.skipped.map((f) => `kept existing ${rel(f)} (use --force to overwrite)`), '', 'Next: edit editorial.config.json (author, projects), then run `editorial-kit doctor`.']);
  });

program
  .command('doctor')
  .description('check Node, config, workspace, git, Playwright/browser, directories, platforms and bundled skills')
  .option('--browser', 'actually launch Chromium')
  .action(async (o: { browser?: boolean }) => {
    const checks = await runDoctor({ root: root(), configFile: globals().config ?? 'editorial.config.json', ...(o.browser ? { launchBrowser: true } : {}) });
    const icon = { ok: '✓', warn: '!', fail: '✗' } as const;
    out(checks, checks.map((c) => `${icon[c.status]} ${c.name}: ${c.message}${c.hint ? `\n    → ${c.hint}` : ''}`));
    if (checks.some((c) => c.status === 'fail')) process.exitCode = 1;
  });

// ----------------------------------------------------------------- author
const author = program.command('author').description('author memory: publication history, index, profile');
author
  .command('sync')
  .description('collect public publications from configured author profiles (live adapters: habr), then rebuild index, continuity and profile')
  .option('-p, --platform <ids>', 'comma-separated platform ids', list)
  .option('--max <n>', 'maximum publications per platform', (v) => Number(v), 100)
  .option('--refresh', 'ignore fresh cache entries')
  .option('--offline', 'use cached pages only')
  .action(async (o: { platform?: string[]; max: number; refresh?: boolean; offline?: boolean }) => {
    const c = await ctx();
    const result = await authorSync(c, { maxArticles: o.max, ...(o.platform ? { platforms: o.platform } : {}), ...(o.refresh ? { refresh: true } : {}), ...(o.offline ? { offline: true } : {}) });
    const memory = await rebuildAuthorMemory(c);
    out({ ...result, indexed: memory.publications.length }, [
      `Collected ${result.collected} publication(s): ${Object.entries(result.byPlatform).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}.`,
      ...result.skipped.map((s) => `skipped ${s.platform}: ${s.reason}`),
      ...result.failures.map((f) => `failed ${f.stage}${f.url ? ` ${f.url}` : ''}: ${f.reason}`),
      `Indexed ${memory.publications.length} publication(s). See ${rel(c.workspace.continuityMd)} and ${rel(c.workspace.authorProfileMd)}.`,
    ]);
  });
author
  .command('import <file>')
  .description('import a publication from Markdown (+ optional YAML frontmatter: title, platform, date, url, tags, projects, depth)')
  .option('-p, --platform <id>', 'platform id (telegram, linkedin, medium, generic-blog, ...)')
  .option('--url <url>', 'public URL')
  .option('--date <iso>', 'publication date (ISO 8601)')
  .action(async (file: string, o: { platform?: string; url?: string; date?: string }) => {
    const c = await ctx();
    const { publication, file: stored } = await importPublication(c, path.resolve(file), o);
    await rebuildAuthorMemory(c);
    out(publication, `Imported "${publication.title}" (${publication.platform}, ${publication.depth}) → ${rel(stored)}`);
  });
author
  .command('profile')
  .description('rebuild the publication index, continuity map and author profile from stored publications')
  .action(async () => {
    const c = await ctx();
    const m = await rebuildAuthorMemory(c);
    out(m.profile, [`Author profile: ${rel(c.workspace.authorProfileMd)}`, `Publication index: ${rel(c.workspace.publicationIndex)}`, `Continuity: ${rel(c.workspace.continuityMd)}`]);
  });

program
  .command('publications')
  .description('list stored publications')
  .action(async () => {
    const c = await ctx();
    const pubs = await loadPublications(c.workspace);
    out(pubs.map((p) => ({ id: p.id, platform: p.platform, date: p.publicationDate, title: p.title, depth: p.depth })), pubs.map((p) => `${p.publicationDate?.slice(0, 10) ?? 'undated   '}  ${p.platform.padEnd(12)} ${p.depth?.padEnd(8) ?? '        '} ${p.title}`));
  });

program
  .command('continuity')
  .description('rebuild and show the cross-platform continuity map (.editorial/continuity.md)')
  .action(async () => {
    const c = await ctx();
    const { continuity } = await rebuildAuthorMemory(c);
    out(continuity, [
      `Continuity map: ${rel(c.workspace.continuityMd)}`,
      ...continuity.projects.map((p) => `- ${p.name}: ${p.publicationIds.length} publication(s); covered: ${p.coveredAspects.map((a) => a.label).join(', ') || '—'}`),
      `Unfinished threads: ${continuity.unfinishedThreads.length}`,
    ]);
  });

// ---------------------------------------------------------------- project
const project = program.command('project').description('read-only project/repository research');
project
  .command('inspect')
  .description('inspect the project repository (docs, ADRs, changelog, modules, tests, git history) into .editorial/projects/<id>/report.md')
  .option('-P, --project <id>', 'project id from the config')
  .option('--max-commits <n>', 'history limit', (v) => Number(v))
  .action(async (o: { project?: string; maxCommits?: number }) => {
    const c = await ctx();
    const { report, files } = await inspectProjectWorkflow(c, o.project, o.maxCommits ? { maxCommits: o.maxCommits } : {});
    out(report, [`${report.name}: ${report.modules.filter((m) => m.exists).length} modules, ${report.docs.length} docs, ${report.tests.files} test files, ${report.commits.length} commits, ${report.tags.length} tags.`, ...report.warnings.map((w) => `warning: ${w}`), `Report: ${rel(files.md)}`]);
  });

program
  .command('gap')
  .alias('narrative-gap')
  .description('narrative gap: what happened in the project that readers have not been told yet')
  .option('-P, --project <id>', 'project id from the config')
  .option('--no-reinspect', 'reuse the last project report instead of re-inspecting')
  .action(async (o: { project?: string; reinspect: boolean }) => {
    const c = await ctx();
    const { gap, files } = await narrativeGapWorkflow(c, o.project, { reinspect: o.reinspect });
    out(gap, [
      'Already covered:',
      ...gap.alreadyCovered.map((a) => `- ${a.label} (${a.platform}, ${a.date?.slice(0, 10) ?? 'undated'})`),
      '',
      'New in project:',
      ...gap.newInProject.map((n) => `- ${n}`),
      '',
      `Strong narrative gap: ${gap.headline ?? '—'}`,
      '',
      `Report: ${rel(files.md)}`,
    ]);
  });

// --------------------------------------------------------------- research
program
  .command('research')
  .description('platform trend research into a dated snapshot (.editorial/research/<date>/<platform>.md). Advisory only.')
  .requiredOption('-p, --platform <id>', 'platform id (live research: habr)')
  .option('--period <periods>', 'comma-separated: daily,weekly,monthly', list)
  .option('--hub <hubs>', 'comma-separated hub slugs', list)
  .option('--max <n>', 'max articles per window', (v) => Number(v))
  .option('--refresh', 'ignore fresh cache entries')
  .option('--offline', 'use cached pages only')
  .action(async (o: { platform: string; period?: string[]; hub?: string[]; max?: number; refresh?: boolean; offline?: boolean }) => {
    const c = await ctx();
    const r = await researchWorkflow(c, o.platform, { ...(o.period ? { periods: o.period } : {}), ...(o.hub ? { hubs: o.hub } : {}), ...(o.max ? { maxArticlesPerPeriod: o.max } : {}), ...(o.refresh ? { refresh: true } : {}), ...(o.offline ? { offline: true } : {}) });
    const s = r.snapshot;
    out(r, [
      `${s.platform}: status ${s.status}, ${s.sampleSize} articles, ${s.observations.length} observations, collected ${s.collectedAt}.`,
      ...(r.fallback ? [`LIVE RESEARCH FAILED (${r.fallback.reason}). Showing earlier snapshot ${rel(r.fallback.snapshotFile)}, ${r.fallback.ageHours}h old.`] : []),
      ...(s.status === 'unsupported' ? ['live research unsupported for this platform; the stable strategy still applies.'] : []),
      ...(r.files ? [`Snapshot: ${rel(r.files.md)}`] : []),
    ]);
  });

program
  .command('collision')
  .description('topic collision against your publications and the latest research snapshots (deterministic, no embeddings)')
  .requiredOption('-t, --topic <text>', 'proposed topic')
  .option('-P, --project <id>', 'project id (adds narrative-gap alternatives)')
  .option('--description <text>', 'longer description of the proposed angle')
  .action(async (o: { topic: string; project?: string; description?: string }) => {
    const c = await ctx();
    const r = await collisionWorkflow(c, o.topic, { ...(o.project ? { projectId: o.project } : {}), ...(o.description ? { description: o.description } : {}) });
    out(r, [
      ...r.summary,
      '',
      'Author overlap:',
      ...r.authorOverlap.slice(0, 3).map((m) => `- [${m.level}] ${m.title} (cosine ${m.cosine}, shared: ${m.sharedTerms.slice(0, 5).join(', ')})`),
      'Ecosystem overlap:',
      ...r.ecosystemOverlap.slice(0, 3).map((m) => `- [${m.level}] ${m.title} (cosine ${m.cosine})`),
      'Alternative angles:',
      ...r.alternativeAngles.map((a) => `- ${a.angle}`),
    ]);
  });

// ---------------------------------------------------------------- stories
const story = program.command('story').description('canonical story (platform-independent source of truth)');
story
  .command('create')
  .description('create a canonical story skeleton in articles/<slug>/story.json from continuity + narrative gap')
  .requiredOption('-t, --topic <text>', 'story topic')
  .option('-P, --project <id>', 'project id')
  .option('--slug <slug>', 'article slug')
  .option('--force', 'replace an existing story file')
  .action(async (o: { topic: string; project?: string; slug?: string; force?: boolean }) => {
    const c = await ctx();
    const r = await storyCreateWorkflow(c, { topic: o.topic, ...(o.project ? { projectId: o.project } : {}), ...(o.slug ? { slug: o.slug } : {}), ...(o.force ? { force: true } : {}) });
    out(r.story, [`Story skeleton: ${rel(r.file)}`, `Pending fields (write them from evidence): ${r.story.pending.join(', ')}`]);
  });
story
  .command('validate <storyFile>')
  .description('evidence-first gate: is the story ready for drafting?')
  .action(async (file: string) => {
    const s = await loadStory(path.resolve(file));
    const v = validateStory(s);
    out(v, [v.readyForDrafting ? 'Ready for drafting.' : 'NOT ready for drafting.', ...v.issues.map((i) => `${i.severity}: [${i.field}] ${i.message}`)]);
    if (!v.readyForDrafting) process.exitCode = 1;
  });

const evidence = program.command('evidence').description('evidence for the story claims (default subcommand: collect)');
evidence
  .command('collect', { isDefault: true })
  .description('collect evidence for the story claims into articles/<slug>/evidence.md')
  .requiredOption('-s, --story <file>', 'path to story.json')
  .action(async (o: { story: string }) => {
    const c = await ctx();
    const { map, files } = await evidenceWorkflow(c, path.resolve(o.story));
    out(map, [`Evidence: ${rel(files.md)}`, ...map.claims.map((cl) => `- [${cl.status}] ${cl.text}`), ...map.issues.map((i) => `${i.severity}: ${i.message}`)]);
    if (map.issues.some((i) => i.severity === 'error')) process.exitCode = 1;
  });
evidence
  .command('verify')
  .description('detect drift: evidence files that changed or disappeared since collection')
  .requiredOption('-s, --story <file>', 'path to story.json')
  .action(async (o: { story: string }) => {
    const c = await ctx();
    const s = await loadStory(path.resolve(o.story));
    const map = await readJson(path.join(path.dirname(path.resolve(o.story)), 'evidence.json'), evidenceMapSchema);
    const drift = await detectDrift(map, requireProject(c, s.project).root);
    out(drift, drift.length ? drift.map((d) => `drift: ${d.ref} — ${d.reason}`) : 'No drift: all file evidence matches the recorded content.');
    if (drift.length) process.exitCode = 1;
  });

program
  .command('brief')
  .description('build the article brief for a platform (articles/<slug>/briefs/<platform>.md)')
  .requiredOption('-s, --story <file>', 'path to story.json')
  .requiredOption('-p, --platform <id>', 'platform id')
  .option('--type <publicationType>', 'publication type, e.g. architecture-deep-dive, short-project-update')
  .action(async (o: { story: string; platform: string; type?: string }) => {
    const c = await ctx();
    const { brief, files } = await briefWorkflow(c, path.resolve(o.story), o.platform, o.type ? { type: o.type } : {});
    out(brief, [`Brief: ${rel(files.md)}`, brief.readiness.readyForDrafting ? 'Ready for drafting.' : `NOT ready for drafting:\n${brief.readiness.blockers.map((b) => `- ${b}`).join('\n')}`]);
  });

program
  .command('repurpose <storyFile>')
  .description('re-read the canonical story and apply another platform strategy (never summarises another output)')
  .requiredOption('-p, --platform <id>', 'target platform id')
  .option('--type <publicationType>', 'publication type')
  .option('--force', 'replace an existing non-scaffold output')
  .action(async (file: string, o: { platform: string; type?: string; force?: boolean }) => {
    const c = await ctx();
    const r = await repurposeWorkflow(c, path.resolve(file), o.platform, { ...(o.type ? { type: o.type } : {}), ...(o.force ? { force: true } : {}) });
    out({ output: r.output, brief: r.brief }, [`Draft workspace: ${rel(r.output)}`, `Brief: ${rel(path.join(path.dirname(path.resolve(file)), 'briefs', `${o.platform}.md`))}`, r.brief.readiness.readyForDrafting ? 'Ready for drafting.' : 'NOT ready for drafting (see brief).']);
  });

program
  .command('create')
  .description('story skeleton + evidence + brief + draft workspace for the first platform')
  .requiredOption('-t, --topic <text>', 'topic')
  .requiredOption('-p, --platform <id>', 'first platform')
  .option('-P, --project <id>', 'project id')
  .option('--slug <slug>', 'article slug')
  .option('--type <publicationType>', 'publication type')
  .option('--force', 'replace an existing story skeleton')
  .action(async (o: { topic: string; platform: string; project?: string; slug?: string; type?: string; force?: boolean }) => {
    const c = await ctx();
    const r = await createWorkflow(c, { topic: o.topic, platform: o.platform, ...(o.project ? { projectId: o.project } : {}), ...(o.slug ? { slug: o.slug } : {}), ...(o.type ? { type: o.type } : {}), ...(o.force ? { force: true } : {}) });
    out(r, [`Story: ${rel(r.storyFile)}`, `Draft workspace: ${rel(r.output)}`, r.brief.readiness.readyForDrafting ? 'Ready for drafting.' : `NOT ready for drafting yet — complete the story from evidence:\n${r.brief.readiness.blockers.map((b) => `- ${b}`).join('\n')}`]);
  });

// ------------------------------------------------------------ screenshots
const shots = program.command('screenshots').description('screenshot planning and Playwright capture');
shots
  .command('plan')
  .description('derive a screenshot plan (with narrative purpose per shot) from the story')
  .requiredOption('-s, --story <file>', 'path to story.json')
  .option('--base-url <url>', 'application base URL', 'http://localhost:3000')
  .action(async (o: { story: string; baseUrl: string }) => {
    const c = await ctx();
    const { plan, files } = await screenshotPlanWorkflow(c, path.resolve(o.story), o.baseUrl);
    out(plan, [`Plan: ${rel(files.json)} (${plan.steps.length} step(s)); fill in paths and ready selectors, then run \`editorial-kit screenshots capture --plan ${rel(files.json)}\`.`]);
  });
shots
  .command('capture')
  .description('capture screenshots from a plan into images/originals/ (never overwrites originals without --replace)')
  .requiredOption('--plan <file>', 'screenshot plan JSON')
  .option('--out <dir>', 'images directory (default: next to the plan inside an article, else config screenshots.outputDir)')
  .option('--replace', 'archive existing originals to originals/.history/ and recapture')
  .option('--only <names>', 'comma-separated step names', list)
  .action(async (o: { plan: string; out?: string; replace?: boolean; only?: string[] }) => {
    const c = await ctx();
    const r = await screenshotCaptureWorkflow(c, path.resolve(o.plan), { ...(o.out ? { out: o.out } : {}), ...(o.replace ? { replace: true } : {}), ...(o.only ? { only: o.only } : {}) });
    out(r, [
      ...r.captured.map((x) => `captured ${x.step} → ${rel(x.file)}`),
      ...r.skipped.map((x) => `skipped ${x.step}: ${x.reason}`),
      ...r.failed.map((x) => `FAILED ${x.step}: ${x.reason}`),
      ...(r.captured.length
        ? ['', 'Visual review REQUIRED: the privacy scan reads DOM text and form values only, not pixels (images, canvas, video, CSS backgrounds, iframes).', 'Look at every image, then set "visualReview": "passed" in images/manifest.json.']
        : []),
    ]);
    if (r.failed.length) process.exitCode = 1;
  });

// ---------------------------------------------------------------- misc
const platforms = program.command('platforms').description('platform strategies');
platforms
  .command('list')
  .description('list registered platforms and what is implemented for each')
  .action(() => {
    const registry = createDefaultRegistry();
    const rows = registry.list().map((m) => ({ id: m.strategy.id, name: m.strategy.displayName, strategy: m.strategy.version, liveResearch: m.strategy.research.liveResearch, authorHistory: m.strategy.research.authorHistory, renderer: m.renderer ? 'custom' : 'default' }));
    out(rows, rows.map((r) => `${r.id.padEnd(13)} strategy ${r.strategy}  live research: ${r.liveResearch.padEnd(14)} author history: ${r.authorHistory.padEnd(14)} renderer: ${r.renderer}`));
  });
platforms
  .command('show <id>')
  .description('print a platform strategy')
  .action((id: string) => {
    const s = createDefaultRegistry().get(id).strategy;
    out(s, JSON.stringify(s, null, 2));
  });

program
  .command('style')
  .description('style review against the author style profile (reports; never rewrites)')
  .argument('<file>', 'Markdown file')
  .option('--profile <id>', 'style profile (ru-technical, en-technical)', 'ru-technical')
  .action(async (file: string, o: { profile: string }) => {
    const report = checkStyle(await readFile(path.resolve(file), 'utf8'), o.profile);
    out(report, [`${report.words} words; em dashes ${report.metrics.emDashPer1000}/1000; "не X, а Y" ${report.metrics.notXButYPer1000}/1000`, ...report.findings.map((f) => `${f.severity}: [${f.rule}]${f.line ? ` line ${f.line}` : ''} ${f.message}${f.excerpt ? ` («${f.excerpt}»)` : ''}`)]);
    if (report.findings.some((f) => f.severity === 'error')) process.exitCode = 1;
  });

const cache = program.command('cache').description('inspect or clear the research HTTP cache');
cache
  .command('list')
  .option('-p, --platform <id>')
  .action(async (o: { platform?: string }) => {
    const ws = resolveWorkspace(root());
    const rows = await new HttpCache(ws.cacheDir, 0).list(o.platform);
    out(rows, rows.length ? rows.map((r) => `${r.fetchedAt}  ${r.platform.padEnd(8)} ${r.status}  ${r.url}`) : 'cache is empty');
  });
cache
  .command('clear')
  .option('-p, --platform <id>')
  .action(async (o: { platform?: string }) => {
    const ws = resolveWorkspace(root());
    await new HttpCache(ws.cacheDir, 0).clear(o.platform);
    out({ cleared: o.platform ?? 'all' }, `Cleared ${o.platform ?? 'all'} cache entries.`);
  });

const skills = program.command('skills').description('bundled Agent Skills');
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
      'codex project → <cwd>/.agents/skills, codex user → $CODEX_HOME/skills (default ~/.codex/skills).',
  )
  .addOption(new Option('--agent <agent>', 'use the documented location for this client').choices(['claude', 'codex']))
  .addOption(new Option('--scope <scope>', 'project (current workspace) or user (home / $CODEX_HOME)').choices(['project', 'user']).default('project'))
  .option('--target <dir>', 'explicit target directory (overrides --agent/--scope)')
  .option('--link', 'symlink instead of copying (keeps skills in sync with this checkout)')
  .option('--force', 'replace existing skills with the same name')
  .action(async (o: { agent?: SkillAgent; scope: SkillScope; target?: string; link?: boolean; force?: boolean }) => {
    const target = resolveInstallTarget({ projectRoot: root(), scope: o.scope, ...(o.agent ? { agent: o.agent } : {}), ...(o.target ? { target: o.target } : {}) });
    const r = await installSkills(path.join(packageRoot(), 'skills'), target, { ...(o.link ? { link: true } : {}), ...(o.force ? { force: true } : {}) });
    out(r, [`Target: ${r.target}`, ...r.installed.map((s) => `installed ${s}`), ...r.skipped.map((s) => `skipped ${s.skill}: ${s.reason}`)]);
  });

program
  .command('demo')
  .description('run the offline, deterministic fixture scenario end to end (no network, fixed clock)')
  .option('--out <dir>', 'output directory (must be empty or a previous demo run)', 'editorial-demo')
  .action(async (o: { out: string }) => {
    const r = await runDemo(path.resolve(o.out), { logger: logger() });
    out(r.summary, [await readFile(r.summaryFile, 'utf8'), `Workspace: ${rel(r.root)}`]);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof EditorialError) {
    process.stderr.write(`error: ${error.message}\n${error.hint ? `hint: ${error.hint}\n` : ''}`);
  } else {
    process.stderr.write(`error: ${errorMessage(error)}\n`);
    if (globals().verbose && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
  }
  process.exitCode = 1;
});
