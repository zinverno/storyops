import path from 'node:path';
import { findProject, resolveProjectPath } from '../config/load.js';
import type { ProjectConfig } from '../config/schema.js';
import { buildNarrativeGap } from '../narrative/gap.js';
import { renderNarrativeGap } from '../narrative/render.js';
import { narrativeGapReportSchema, type NarrativeGapReport } from '../narrative/schema.js';
import { inspectProject } from '../project/inspect.js';
import { renderProjectReport } from '../project/render.js';
import { projectReportSchema, type ProjectReport } from '../project/schema.js';
import { EditorialError } from '../shared/errors.js';
import { readJsonIfExists, writeJson, writeText } from '../shared/fs.js';
import { requireContinuity } from './author.js';
import { projectDir, type AppContext } from './context.js';

export function requireProject(ctx: AppContext, id?: string): ProjectConfig & { root: string } {
  const project = findProject(ctx.config, id);
  if (!project) {
    throw new EditorialError('PROJECT_UNKNOWN', id ? `Unknown project "${id}"` : 'Several projects are configured; choose one with --project', {
      hint: `Configured projects: ${ctx.config.projects.map((p) => p.id).join(', ') || '(none — add one under "projects" in editorial.config.json)'}`,
    });
  }
  const root = resolveProjectPath(ctx.workspace.root, project);
  if (!root) throw new EditorialError('PROJECT_PATH', `Project "${project.id}" has no "path" configured`);
  return { ...project, root };
}

export async function inspectProjectWorkflow(ctx: AppContext, projectId?: string, options: { maxCommits?: number } = {}): Promise<{ report: ProjectReport; files: { json: string; md: string } }> {
  const project = requireProject(ctx, projectId);
  const report = await inspectProject({ projectId: project.id, name: project.name, root: project.root, clock: ctx.clock, logger: ctx.logger, ...(options.maxCommits ? { maxCommits: options.maxCommits } : {}) });
  const dir = projectDir(ctx, project.id);
  const files = { json: path.join(dir, 'report.json'), md: path.join(dir, 'report.md') };
  await writeJson(files.json, report);
  await writeText(files.md, renderProjectReport(report));
  return { report, files };
}

export async function loadProjectReport(ctx: AppContext, projectId: string): Promise<ProjectReport | undefined> {
  return readJsonIfExists(path.join(projectDir(ctx, projectId), 'report.json'), projectReportSchema);
}

export async function narrativeGapWorkflow(ctx: AppContext, projectId?: string, options: { reinspect?: boolean } = {}): Promise<{ gap: NarrativeGapReport; files: { json: string; md: string } }> {
  const project = requireProject(ctx, projectId);
  const report = options.reinspect === false ? ((await loadProjectReport(ctx, project.id)) ?? (await inspectProjectWorkflow(ctx, project.id)).report) : (await inspectProjectWorkflow(ctx, project.id)).report;
  const continuity = await requireContinuity(ctx);
  const gap = buildNarrativeGap({ report, continuity, glossary: project.glossary, clock: ctx.clock });
  const dir = projectDir(ctx, project.id);
  const files = { json: path.join(dir, 'narrative-gap.json'), md: path.join(dir, 'narrative-gap.md') };
  await writeJson(files.json, gap);
  await writeText(files.md, renderNarrativeGap(gap));
  return { gap, files };
}

export async function loadNarrativeGap(ctx: AppContext, projectId: string): Promise<NarrativeGapReport | undefined> {
  return readJsonIfExists(path.join(projectDir(ctx, projectId), 'narrative-gap.json'), narrativeGapReportSchema);
}
