import path from 'node:path';
import { copyFile, readFile } from 'node:fs/promises';
import type { PublicationType } from '../../platforms/schema.js';
import { publicationTypeSchema } from '../../platforms/schema.js';
import { buildBrief, type Brief } from '../briefs/build.js';
import { renderBrief } from '../briefs/render.js';
import { collectEvidence } from '../evidence/collect.js';
import { renderEvidence } from '../evidence/render.js';
import { evidenceMapSchema, type EvidenceMap } from '../evidence/schema.js';
import { defaultRenderer } from '../platforms/render.js';
import { loadPublications } from '../publications/store.js';
import { snapshotPaths } from '../research/snapshot.js';
import { EditorialError } from '../shared/errors.js';
import { parseFrontmatter } from '../shared/frontmatter.js';
import { ensureDir, pathExists, readJsonIfExists, writeJson, writeText } from '../shared/fs.js';
import { articlePaths, slugFromStoryPath } from '../shared/workspace.js';
import { createStorySkeleton } from '../stories/create.js';
import type { CanonicalStory } from '../stories/schema.js';
import { loadStory, saveStory } from '../stories/store.js';
import { mdList } from '../shared/markdown.js';
import { loadContinuity, requireContinuity } from './author.js';
import type { AppContext } from './context.js';
import { loadNarrativeGap, loadProjectReport, narrativeGapWorkflow, requireProject } from './project.js';
import { collisionWorkflow, latestSnapshots } from './research.js';

export async function storyCreateWorkflow(ctx: AppContext, options: { topic: string; projectId?: string; slug?: string; force?: boolean }): Promise<{ story: CanonicalStory; file: string }> {
  const project = requireProject(ctx, options.projectId);
  const continuity = await requireContinuity(ctx);
  const gap = (await loadNarrativeGap(ctx, project.id)) ?? (await narrativeGapWorkflow(ctx, project.id)).gap;
  const report = await loadProjectReport(ctx, project.id);
  const story = createStorySkeleton({
    topic: options.topic,
    projectId: project.id,
    language: ctx.config.language,
    continuity,
    gap,
    clock: ctx.clock,
    ...(options.slug ? { slug: options.slug } : {}),
    ...(report ? { report } : {}),
  });
  const paths = articlePaths(ctx.workspace, story.slug);
  if (pathExists(paths.story) && !options.force) {
    throw new EditorialError('STORY_EXISTS', `${paths.story} already exists`, { hint: 'Edit the existing story, choose another --slug, or pass --force to replace the skeleton.' });
  }
  await saveStory(ctx.workspace, paths.story, story);
  await writeAuthorResearch(ctx, story);
  const collisionOut = { json: path.join(paths.researchDir, 'collision.json'), md: path.join(paths.researchDir, 'collision.md') };
  await collisionWorkflow(ctx, options.topic, { projectId: project.id, output: collisionOut });
  ctx.logger.info(`Canonical story skeleton: ${paths.story} (pending: ${story.pending.join(', ')}).`);
  return { story, file: paths.story };
}

/** articles/<slug>/research/author.md — what readers already know about this project. */
async function writeAuthorResearch(ctx: AppContext, story: CanonicalStory): Promise<void> {
  const continuity = await loadContinuity(ctx);
  const gap = await loadNarrativeGap(ctx, story.project);
  const paths = articlePaths(ctx.workspace, story.slug);
  const project = continuity?.projects.find((p) => p.id === story.project);
  const lines = [
    `# Author context — ${story.project}`,
    '',
    `Generated ${ctx.clock.now().toISOString()} from .editorial/continuity.json${gap ? ' and the narrative gap report' : ''}.`,
    '',
    '## Already covered',
    '',
    mdList(project?.coveredAspects.map((a) => `${a.label} — ${a.publication.title} (${a.publication.platform}, ${a.publication.date?.slice(0, 10) ?? 'undated'})`) ?? []),
    '',
    '## Concepts explained',
    '',
    mdList((continuity?.concepts ?? []).filter((c) => c.coverage === 'explained' && c.occurrences.some((o) => project?.publicationIds.includes(o.publicationId))).map((c) => c.label)),
    '',
    '## Open threads',
    '',
    mdList((continuity?.unfinishedThreads ?? []).filter((t) => project?.publicationIds.includes(t.publicationId)).map((t) => `${t.kind}: ${t.text}`)),
    '',
    '## Narrative gap',
    '',
    gap?.headline ? `**${gap.headline}**` : '_not computed_',
    '',
    mdList(gap?.gaps.filter((g) => g.strength !== 'weak').map((g) => `${g.title} (${g.strength}, ${g.coverage})`) ?? []),
    '',
  ];
  await writeText(path.join(paths.researchDir, 'author.md'), lines.join('\n'));
}

export async function evidenceWorkflow(ctx: AppContext, storyFile: string): Promise<{ map: EvidenceMap; files: { json: string; md: string } }> {
  const story = await loadStory(storyFile);
  const paths = articlePaths(ctx.workspace, slugFromStoryPath(storyFile));
  const project = requireProject(ctx, story.project);
  const publications = await loadPublications(ctx.workspace);
  const map = await collectEvidence({ story, storyFile, projectRoot: project.root, publications, screenshotsDir: paths.imagesOriginals, clock: ctx.clock });
  const files = { json: path.join(path.dirname(storyFile), 'evidence.json'), md: path.join(path.dirname(storyFile), 'evidence.md') };
  await writeJson(files.json, map);
  await writeText(files.md, renderEvidence(map));
  const errors = map.issues.filter((i) => i.severity === 'error').length;
  ctx.logger.info(`Evidence: ${map.records.length} record(s), ${map.claims.filter((c) => c.status === 'supported').length}/${map.claims.length} claims supported, ${errors} error(s).`);
  return { map, files };
}

function parseType(type: string | undefined): PublicationType | undefined {
  if (!type) return undefined;
  const parsed = publicationTypeSchema.safeParse(type);
  if (!parsed.success) throw new EditorialError('PUBLICATION_TYPE', `Unknown publication type "${type}"`, { hint: `Known: ${publicationTypeSchema.options.join(', ')}` });
  return parsed.data;
}

export async function briefWorkflow(ctx: AppContext, storyFile: string, platformId: string, options: { type?: string; primary?: boolean } = {}): Promise<{ brief: Brief; files: { md: string; json: string } }> {
  const story = await loadStory(storyFile);
  const module = ctx.registry.get(platformId);
  const type = parseType(options.type);
  if (type && !module.strategy.content.supportedPublicationTypes.includes(type)) {
    throw new EditorialError('PUBLICATION_TYPE', `${module.strategy.displayName} strategy does not support "${type}"`, { hint: `Supported: ${module.strategy.content.supportedPublicationTypes.join(', ')}` });
  }
  const dir = path.dirname(storyFile);
  const continuity = await loadContinuity(ctx);
  const gap = await loadNarrativeGap(ctx, story.project);
  const evidence = await readJsonIfExists(path.join(dir, 'evidence.json'), evidenceMapSchema);
  const snapshot = (await latestSnapshots(ctx, [platformId]))[0];
  const collisionFile = path.join(dir, 'research', 'collision.json');
  const collision = pathExists(collisionFile) ? JSON.parse(await readFile(collisionFile, 'utf8')) : undefined;
  const brief = buildBrief({
    story,
    strategy: module.strategy,
    clock: ctx.clock,
    ...(type ? { publicationType: type } : {}),
    ...(continuity ? { continuity } : {}),
    ...(gap ? { gap } : {}),
    ...(evidence ? { evidence } : {}),
    ...(collision ? { collision } : {}),
    ...(snapshot ? { snapshot: { snapshot: snapshot.snapshot, ageHours: snapshot.ageHours } } : {}),
  });
  const files = { md: path.join(dir, 'briefs', `${platformId}.md`), json: path.join(dir, 'briefs', `${platformId}.json`) };
  const md = renderBrief(brief);
  await writeText(files.md, md);
  await writeJson(files.json, brief);
  if (options.primary || !pathExists(path.join(dir, 'brief.md'))) {
    await writeText(path.join(dir, 'brief.md'), md);
    await writeJson(path.join(dir, 'brief.json'), brief);
  }
  // Copy the platform research snapshot next to the article for provenance.
  if (snapshot) {
    const src = snapshotPaths(ctx.workspace.researchDir, snapshot.snapshot.collectedAt.slice(0, 10), platformId).md;
    if (pathExists(src)) {
      await ensureDir(path.join(dir, 'research'));
      await copyFile(src, path.join(dir, 'research', `${platformId}.md`));
    }
  }
  if (!brief.readiness.readyForDrafting) ctx.logger.warn(`Brief for ${platformId}: NOT READY FOR DRAFTING (${brief.readiness.blockers.length} blocker(s)).`);
  return { brief, files };
}

/**
 * Repurpose = re-read the canonical story + apply the target platform
 * strategy. It never reads another platform's output.
 */
export async function repurposeWorkflow(ctx: AppContext, storyFile: string, platformId: string, options: { type?: string; force?: boolean; primary?: boolean } = {}): Promise<{ output: string; brief: Brief }> {
  const { brief } = await briefWorkflow(ctx, storyFile, platformId, options);
  const story = await loadStory(storyFile);
  const module = ctx.registry.get(platformId);
  const type = parseType(options.type) ?? brief.publicationType;
  const paths = articlePaths(ctx.workspace, slugFromStoryPath(storyFile));
  const out = path.join(path.dirname(storyFile), 'outputs', `${platformId}.md`);
  if (pathExists(out)) {
    const existing = parseFrontmatter(await readFile(out, 'utf8'));
    if (existing.data.status !== 'scaffold' && !options.force) {
      throw new EditorialError('OUTPUT_EXISTS', `${out} contains a draft (status: ${String(existing.data.status ?? 'unknown')}); refusing to overwrite it.`, { hint: 'Pass --force to replace it with a fresh scaffold.' });
    }
  }
  const renderer = module.renderer ?? defaultRenderer;
  await writeText(out, renderer.render({ story, strategy: module.strategy, publicationType: type, storyPath: storyFile }));
  await ensureDir(paths.imageOutputs(platformId));
  const now = ctx.clock.now().toISOString();
  const rel = path.relative(path.dirname(storyFile), out).split(path.sep).join('/');
  story.outputs = [...story.outputs.filter((o) => o.platform !== platformId), { platform: platformId, path: rel, publicationType: type, createdAt: now }];
  await saveStory(ctx.workspace, storyFile, story);
  ctx.logger.info(`${module.strategy.displayName} draft workspace: ${out}`);
  return { output: out, brief };
}

/** `create`: story skeleton + evidence + brief + output scaffold for the first platform. */
export async function createWorkflow(ctx: AppContext, options: { topic: string; platform: string; projectId?: string; slug?: string; type?: string; force?: boolean }): Promise<{ storyFile: string; output: string; brief: Brief }> {
  ctx.registry.get(options.platform);
  const { file } = await storyCreateWorkflow(ctx, { topic: options.topic, ...(options.projectId ? { projectId: options.projectId } : {}), ...(options.slug ? { slug: options.slug } : {}), ...(options.force ? { force: true } : {}) });
  await evidenceWorkflow(ctx, file);
  const { output, brief } = await repurposeWorkflow(ctx, file, options.platform, { primary: true, ...(options.type ? { type: options.type } : {}) });
  return { storyFile: file, output, brief };
}
