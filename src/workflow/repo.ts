import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { findProject, resolveProjectPath } from '../config/load.js';
import type { ProjectConfig } from '../config/schema.js';
import { inspectProject } from '../project/inspect.js';
import { renderProjectReport } from '../project/render.js';
import type { ProjectReport } from '../project/schema.js';
import { EVENT_TYPES, eventDate, extractEvents, type RepoEvent } from '../repo/events.js';
import { ensureRepository, latestReport, loadEvents, mapRepositoryTopics, recordSnapshot, repositoryTopicMap, storeEvents, type RepoTopicSummary } from '../repo/store.js';
import type { RepoEvidence } from '../review/checks/factual.js';
import { StoryOpsError } from '../shared/errors.js';
import { writeJson, writeText } from '../shared/fs.js';
import { mdList, mdTable } from '../shared/markdown.js';
import { isSecretPath } from '../shared/redact.js';
import { repoDir } from '../shared/workspace.js';
import { loadTopics, workspaceTopics } from '../topics/registry.js';
import { db, saveDb, type AppContext } from './context.js';

export function requireProject(ctx: AppContext, id?: string): ProjectConfig & { root: string } {
  const project = findProject(ctx.config, id);
  if (!project) {
    throw new StoryOpsError('PROJECT_UNKNOWN', id ? `Unknown repository "${id}"` : 'Several repositories are configured; choose one with --repo', {
      hint: `Configured repositories (config "projects"): ${ctx.config.projects.map((p) => p.id).join(', ') || '(none — add one under "projects" in storyops.config.json)'}`,
    });
  }
  const root = resolveProjectPath(ctx.workspace.root, project);
  if (!root) throw new StoryOpsError('PROJECT_PATH', `Repository "${project.id}" has no "path" configured`);
  return { ...project, root };
}

export interface InspectResult {
  report: ProjectReport;
  events: RepoEvent[];
  topics: RepoTopicSummary[];
  unchanged: boolean;
  added: number;
  files: { report: string; events: { json: string; md: string }; topics: { json: string; md: string } };
}

/** Inspects the repository read-only, stores a snapshot, extracts events and maps them to topics. */
export async function inspectRepoWorkflow(ctx: AppContext, repoId?: string, options: { maxCommits?: number } = {}): Promise<InspectResult> {
  const project = requireProject(ctx, repoId);
  const report = await inspectProject({ projectId: project.id, name: project.name, root: project.root, clock: ctx.clock, logger: ctx.logger, ...(options.maxCommits ? { maxCommits: options.maxCommits } : {}) });
  const database = await db(ctx);
  const now = ctx.clock.now().toISOString();
  ensureRepository(database, { id: project.id, name: project.name, path: project.path ?? project.root }, now);
  const snapshot = recordSnapshot(database, report);
  const events = extractEvents(report);
  const stored = storeEvents(database, events, snapshot.snapshotId, now);
  mapRepositoryTopics(database, project.id, events, workspaceTopics(ctx.config), now);
  const topics = repositoryTopicMap(database, project.id, loadTopics(database));
  const dir = repoDir(ctx.workspace, project.id);
  const files = {
    report: path.join(dir, 'report.md'),
    events: { json: path.join(dir, 'events.json'), md: path.join(dir, 'events.md') },
    topics: { json: path.join(dir, 'topics.json'), md: path.join(dir, 'topics.md') },
  };
  await writeJson(path.join(dir, 'report.json'), report);
  await writeText(files.report, renderProjectReport(report));
  await writeJson(files.events.json, events);
  await writeText(files.events.md, renderEvents(project.name, events));
  await writeJson(files.topics.json, topics);
  await writeText(files.topics.md, renderRepoTopics(project.name, topics));
  await saveDb(ctx);
  return { report, events, topics, unchanged: snapshot.unchanged, added: stored.added, files };
}

/** Latest stored report, or a fresh inspection when none exists. */
export async function ensureInspected(ctx: AppContext, repoId?: string): Promise<{ project: ProjectConfig & { root: string }; report: ProjectReport }> {
  const project = requireProject(ctx, repoId);
  const database = await db(ctx);
  const existing = latestReport(database, project.id);
  if (existing) return { project, report: existing };
  return { project, report: (await inspectRepoWorkflow(ctx, project.id)).report };
}

export async function eventsWorkflow(ctx: AppContext, repoId?: string, options: { since?: string; types?: string[] } = {}): Promise<{ repo: string; events: RepoEvent[] }> {
  const { project } = await ensureInspected(ctx, repoId);
  for (const t of options.types ?? []) if (!(EVENT_TYPES as readonly string[]).includes(t)) throw new StoryOpsError('EVENT_TYPE', `Unknown event type "${t}"`, { hint: `Types: ${EVENT_TYPES.join(', ')}` });
  return { repo: project.id, events: loadEvents(await db(ctx), project.id, options) };
}

export async function repoTopicsWorkflow(ctx: AppContext, repoId?: string): Promise<{ repo: string; topics: RepoTopicSummary[] }> {
  const { project } = await ensureInspected(ctx, repoId);
  const database = await db(ctx);
  return { repo: project.id, topics: repositoryTopicMap(database, project.id, loadTopics(database)) };
}

const MAX_EVIDENCE_BYTES = 256 * 1024;

/**
 * Repository material factual review can compare claims with: modules,
 * events, and the text of benchmark files, changelog and docs. Secret-like
 * paths are never read.
 */
export async function repoEvidence(ctx: AppContext, repoId?: string): Promise<RepoEvidence> {
  const { project, report } = await ensureInspected(ctx, repoId);
  const docs: RepoEvidence['docs'] = [];
  for (const d of report.docs.filter((x) => ['benchmark', 'changelog', 'doc', 'architecture', 'readme', 'adr'].includes(x.kind))) {
    if (isSecretPath(d.path)) continue;
    const abs = path.join(project.root, d.path);
    try {
      if ((await stat(abs)).size > MAX_EVIDENCE_BYTES) continue;
      docs.push({ path: d.path, kind: d.kind, text: await readFile(abs, 'utf8') });
    } catch {
      // file vanished since inspection; skip
    }
  }
  return { repositoryId: project.id, modules: report.modules.map((m) => ({ path: m.path, name: m.name, exists: m.exists })), events: loadEvents(await db(ctx), project.id), docs };
}

export function renderEvents(name: string, events: readonly RepoEvent[]): string {
  return [
    `# Repository events — ${name}`,
    '',
    '> Candidate engineering events inferred from history, paths and docs. `basis` says what each was inferred from; types read from commit messages are hints.',
    '',
    mdTable(['Date', 'Type', 'Summary', 'Subsystem', 'Evidence', 'Basis'], events.map((e) => [eventDate(e).slice(0, 10), `${e.type}${e.aspects.length ? ` (+${e.aspects.join(', ')})` : ''}`, e.summary, e.subsystem ?? '—', `${e.evidenceStrength}: ${e.strengthReason}`, e.basis])),
    '',
  ].join('\n');
}

export function renderRepoTopics(name: string, topics: readonly RepoTopicSummary[]): string {
  return [
    `# Repository topic map — ${name}`,
    '',
    mdTable(['Topic', 'Origin', 'Events', 'Types', 'First', 'Last'], topics.map((t) => [t.label, t.origin, t.events.length, t.types.join(', '), t.firstEventAt.slice(0, 10), t.lastEventAt.slice(0, 10)])),
    '',
    ...topics.flatMap((t) => [`## ${t.label}`, '', mdList(t.events.map((e) => `${eventDate(e).slice(0, 10)} ${e.type}: ${e.summary}`)), '']),
  ].join('\n');
}
