import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { publicationTypeSchema, type PublicationType } from '../../platforms/schema.js';
import { authorProfileSchema, type AuthorProfile } from '../author/profile.js';
import { packageRoot } from '../demo/paths.js';
import { addAuthorInputItem, authorInputTemplate, parseAuthorInput, PRIORITY_TO_SECTION, type AuthorInput, type AuthorInputItem, type MaterialPriority } from '../editorial/author-input.js';
import { auditDraft, editorialAuditSchema, renderAudit, type EditorialAudit } from '../editorial/audit.js';
import type { EditorialIssue } from '../editorial/common.js';
import { buildDirection, directionSchema, renderDirection, validateDirection, type EditorialDirection } from '../editorial/direction.js';
import { buildPatternTransfer, patternTransferSchema, renderPatternTransfer, validatePatternTransfer, type PatternTransfer } from '../editorial/pattern-transfer.js';
import { authorVoiceRef, compareProvenance, storyContentHash, strategyRef, type Provenance } from '../editorial/provenance.js';
import { loadStyleCatalog, styleRef, type LoadedStyle, type StyleCatalog } from '../editorial/styles.js';
import { buildVoicePlan, renderVoicePlan, validateVoicePlan, voicePlanSchema, type VoicePlan } from '../editorial/voice-plan.js';
import { detectDrift } from '../evidence/collect.js';
import { evidenceMapSchema } from '../evidence/schema.js';
import { loadPublications } from '../publications/store.js';
import { findLatestSnapshot } from '../research/snapshot.js';
import { researchSnapshotSchema, type ResearchSnapshot } from '../research/types.js';
import { EditorialError, errorMessage } from '../shared/errors.js';
import { pathExists, readJson, readJsonIfExists, readText, toPosix, writeJson, writeText } from '../shared/fs.js';
import { hashText } from '../shared/hash.js';
import type { CanonicalStory } from '../stories/schema.js';
import { loadStory } from '../stories/store.js';
import { validateStory } from '../stories/validate.js';
import { loadContinuity } from './author.js';
import type { AppContext } from './context.js';
import { requireProject } from './project.js';

/**
 * Phase 2 editorial layer workflows. The CLI has no language model: these
 * functions collect inputs, validate schemas, prefill known facts, copy
 * research observations with provenance, leave explicit TODO decisions and
 * render scaffolds. The editorial-author skill makes the editorial decisions.
 */

export interface EditorialFiles {
  dir: string;
  direction: { json: string; md: string };
  patternTransfer: { json: string; md: string };
  voicePlan: { json: string; md: string };
  voiceSample: string;
  audit: { json: string; md: string };
}

export function editorialFilesIn(dir: string): EditorialFiles {
  return {
    dir,
    direction: { json: path.join(dir, 'direction.json'), md: path.join(dir, 'direction.md') },
    patternTransfer: { json: path.join(dir, 'pattern-transfer.json'), md: path.join(dir, 'pattern-transfer.md') },
    voicePlan: { json: path.join(dir, 'voice-plan.json'), md: path.join(dir, 'voice-plan.md') },
    voiceSample: path.join(dir, 'voice-sample.md'),
    audit: { json: path.join(dir, 'audit.json'), md: path.join(dir, 'audit.md') },
  };
}

/**
 * `editorial/` holds the plan of the first platform planned for an article.
 * Another platform gets `editorial/<platform>/`, so planning Telegram never
 * overwrites the Habr plan.
 */
export async function resolveEditorialDir(articleDir: string, platform: string): Promise<string> {
  const main = path.join(articleDir, 'editorial');
  const sub = path.join(main, platform);
  if (pathExists(path.join(sub, 'direction.json'))) return sub;
  const mainDirection = path.join(main, 'direction.json');
  if (!pathExists(mainDirection)) return main;
  try {
    const recorded = (JSON.parse(await readFile(mainDirection, 'utf8')) as { platform?: unknown }).platform;
    return recorded === platform ? main : sub;
  } catch {
    return main;
  }
}

export function authorInputPath(storyFile: string): string {
  return path.join(path.dirname(path.resolve(storyFile)), 'author-input.md');
}

export async function loadAuthorInput(storyFile: string, slug: string): Promise<AuthorInput | undefined> {
  const file = authorInputPath(storyFile);
  if (!pathExists(file)) return undefined;
  return parseAuthorInput(await readText(file), { expectedStory: slug, label: path.relative(process.cwd(), file) || file });
}

export async function loadStyles(ctx: Pick<AppContext, 'workspace'>): Promise<StyleCatalog> {
  return loadStyleCatalog({ builtInDir: path.join(packageRoot(), 'styles'), workspaceDir: ctx.workspace.stylesDir });
}

// ------------------------------------------------------------ author input

export async function inputInitWorkflow(storyFile: string, options: { force?: boolean } = {}): Promise<{ file: string; created: boolean }> {
  const story = await loadStory(storyFile);
  const file = authorInputPath(storyFile);
  if (pathExists(file) && !options.force) return { file, created: false };
  await writeText(file, authorInputTemplate(story.slug));
  return { file, created: true };
}

export async function inputAddWorkflow(storyFile: string, priority: MaterialPriority, text: string): Promise<{ file: string; item: AuthorInputItem; input: AuthorInput }> {
  const story = await loadStory(storyFile);
  const { file } = await inputInitWorkflow(storyFile);
  const updated = addAuthorInputItem(await readText(file), PRIORITY_TO_SECTION[priority], text);
  const input = parseAuthorInput(updated, { expectedStory: story.slug });
  const section = PRIORITY_TO_SECTION[priority];
  const item = [...input.items].reverse().find((i) => i.section === section);
  if (!item) throw new EditorialError('AUTHOR_INPUT_ADD', 'The item was written but could not be parsed back; check author-input.md.');
  await writeText(file, updated);
  return { file, item, input };
}

// -------------------------------------------------------------- provenance

async function loadAuthorProfile(ctx: AppContext): Promise<AuthorProfile | undefined> {
  return readJsonIfExists(ctx.workspace.authorProfileJson, authorProfileSchema);
}

const rel = (ctx: AppContext, file: string) => toPosix(path.relative(ctx.workspace.root, file));

async function researchRef(ctx: AppContext, file: string | undefined): Promise<{ ref: Provenance['research']; snapshot?: ResearchSnapshot }> {
  if (!file || !pathExists(file)) return { ref: null };
  const text = await readText(file);
  const snapshot = researchSnapshotSchema.parse(JSON.parse(text));
  return { ref: { platform: snapshot.platform, collectedAt: snapshot.collectedAt, file: rel(ctx, file), hash: hashText(text), status: snapshot.status, sampleSize: snapshot.sampleSize }, snapshot };
}

async function currentProvenance(ctx: AppContext, args: { story: CanonicalStory; authorInput?: AuthorInput; style?: LoadedStyle; platform: string; researchFile?: string }): Promise<{ provenance: Provenance; snapshot?: ResearchSnapshot }> {
  const profile = await loadAuthorProfile(ctx);
  const { ref, snapshot } = await researchRef(ctx, args.researchFile);
  const provenance: Provenance = {
    story: { slug: args.story.slug, hash: storyContentHash(args.story) },
    authorInput: args.authorInput ? { hash: args.authorInput.sourceHash, items: args.authorInput.items.length } : null,
    authorProfile: authorVoiceRef(profile, ctx.config.author.styleProfile, ctx.config.language),
    style: args.style ? styleRef(args.style) : null,
    platformStrategy: strategyRef(ctx.registry.get(args.platform).strategy),
    research: ref,
  };
  return { provenance, ...(snapshot ? { snapshot } : {}) };
}

// -------------------------------------------------------------------- plan

async function loadArtifact<T>(file: string, schema: { parse(data: unknown): T }, label: string): Promise<T | undefined> {
  if (!pathExists(file)) return undefined;
  try {
    return schema.parse(JSON.parse(await readText(file)));
  } catch (error) {
    throw new EditorialError('EDITORIAL_ARTIFACT_INVALID', `${file} (${label}) is not a valid artifact: ${errorMessage(error).split('\n').slice(0, 4).join(' ')}`, { hint: 'Fix the JSON, or re-create the plan with `editorial-kit editorial plan --reset` (this discards editorial decisions).' });
  }
}

export interface EditorialPlan {
  direction?: EditorialDirection;
  patternTransfer?: PatternTransfer;
  voicePlan?: VoicePlan;
}

export async function loadEditorialPlan(files: EditorialFiles): Promise<EditorialPlan> {
  const direction = await loadArtifact(files.direction.json, directionSchema, 'editorial direction');
  const patternTransfer = await loadArtifact(files.patternTransfer.json, patternTransferSchema, 'pattern transfer');
  const voicePlan = await loadArtifact(files.voicePlan.json, voicePlanSchema, 'voice plan');
  return { ...(direction ? { direction } : {}), ...(patternTransfer ? { patternTransfer } : {}), ...(voicePlan ? { voicePlan } : {}) };
}

async function writePlan(files: EditorialFiles, plan: Required<EditorialPlan>): Promise<void> {
  await writeJson(files.direction.json, plan.direction);
  await writeText(files.direction.md, renderDirection(plan.direction));
  await writeJson(files.patternTransfer.json, plan.patternTransfer);
  await writeText(files.patternTransfer.md, renderPatternTransfer(plan.patternTransfer));
  await writeJson(files.voicePlan.json, plan.voicePlan);
  await writeText(files.voicePlan.md, renderVoicePlan(plan.voicePlan));
}

async function resolvePublicationType(storyFile: string, story: CanonicalStory, platform: string, explicit: string | undefined, previous: string | undefined, fallback: PublicationType): Promise<PublicationType> {
  const parse = (t: string) => {
    const r = publicationTypeSchema.safeParse(t);
    if (!r.success) throw new EditorialError('PUBLICATION_TYPE', `Unknown publication type "${t}"`, { hint: `Known: ${publicationTypeSchema.options.join(', ')}` });
    return r.data;
  };
  if (explicit) return parse(explicit);
  if (previous) return parse(previous);
  const brief = path.join(path.dirname(storyFile), 'briefs', `${platform}.json`);
  if (pathExists(brief)) {
    const t = (JSON.parse(await readText(brief)) as { publicationType?: string }).publicationType;
    if (t && publicationTypeSchema.safeParse(t).success) return t as PublicationType;
  }
  const out = story.outputs.find((o) => o.platform === platform)?.publicationType;
  if (out && publicationTypeSchema.safeParse(out).success) return out as PublicationType;
  return fallback;
}

export interface PlanResult {
  files: EditorialFiles;
  plan: Required<EditorialPlan>;
  authorInputFile: string;
  authorInputCreated: boolean;
  refreshed: boolean;
  reviewRequired: string[];
}

export async function editorialPlanWorkflow(ctx: AppContext, storyFileArg: string, platform: string, options: { style?: string; type?: string; reset?: boolean } = {}): Promise<PlanResult> {
  const storyFile = path.resolve(storyFileArg);
  const story = await loadStory(storyFile);
  const module = ctx.registry.get(platform);
  const articleDir = path.dirname(storyFile);
  const init = await inputInitWorkflow(storyFile);
  const authorInput = (await loadAuthorInput(storyFile, story.slug))!;
  const files = editorialFilesIn(await resolveEditorialDir(articleDir, platform));
  const previous = options.reset ? {} : await loadEditorialPlan(files);
  if (previous.direction && previous.direction.platform !== platform) {
    throw new EditorialError('EDITORIAL_PLATFORM', `${files.direction.json} is the plan for ${previous.direction.platform}, not ${platform}`);
  }
  const catalog = await loadStyles(ctx);
  const configDefault = ctx.config.editorial?.defaultStyle;
  const styleId = options.style ?? previous.direction?.style.id ?? configDefault ?? undefined;
  const style = styleId ? catalog.get(styleId) : undefined;
  const chosenBy: 'user' | 'agent' | 'config-default' | undefined = options.style ? 'user' : previous.direction?.style.id ? previous.direction.style.chosenBy : configDefault ? 'config-default' : undefined;
  const publicationType = await resolvePublicationType(storyFile, story, platform, options.type, previous.direction?.publicationType, module.strategy.content.defaultPublicationType);
  // A short list, not the whole catalog: presets suited to this publication type (exact-name match first).
  const candidates = catalog
    .suitableFor(publicationType)
    .sort((a, b) => Number(b.preset.id === publicationType) - Number(a.preset.id === publicationType))
    .slice(0, 4);

  const latest = await findLatestSnapshot(ctx.workspace.researchDir, platform);
  const { provenance, snapshot } = await currentProvenance(ctx, { story, authorInput, ...(style ? { style } : {}), platform, ...(latest ? { researchFile: latest.file } : {}) });
  const review = (artifact: { basedOn: Provenance } | undefined, label: string) => (artifact ? compareProvenance(artifact.basedOn, provenance, label).map((d) => `${d.message} — review this plan, then clear reviewRequired.`) : []);
  const now = ctx.clock.now().toISOString();
  const relArticle = (p: string) => toPosix(path.relative(articleDir, p));

  const patternTransfer = buildPatternTransfer({
    story: story.slug,
    platform,
    now,
    basedOn: provenance,
    ...(snapshot && latest ? { snapshot: { snapshot, file: rel(ctx, latest.file) } } : {}),
    ...(previous.patternTransfer ? { previous: previous.patternTransfer } : {}),
    reviewRequired: review(previous.patternTransfer, 'pattern transfer'),
  });

  const profile = await loadAuthorProfile(ctx);
  const continuity = await loadContinuity(ctx);
  const projectPubs = new Set(continuity?.projects.find((p) => p.id === story.project)?.publicationIds ?? []);
  const publications = (await loadPublications(ctx.workspace)).filter((p) => projectPubs.has(p.id)).sort((a, b) => (b.publicationDate ?? '').localeCompare(a.publicationDate ?? ''));
  const briefFile = path.join(articleDir, 'briefs', `${platform}.md`);

  const direction = buildDirection({
    story,
    strategy: module.strategy,
    publicationType,
    ...(style ? { style } : {}),
    ...(chosenBy ? { styleChosenBy: chosenBy } : {}),
    styleCandidates: candidates,
    authorInput,
    authorVoice: { styleProfile: profile?.styleProfile ?? ctx.config.author.styleProfile, tone: profile?.manual.tone ?? '', voiceNotes: profile?.manual.voiceNotes ?? [] },
    voiceCandidates: publications.slice(0, 5).map((p) => ({ publicationId: p.id, title: p.title, platform: p.platform, ...(p.publicationDate ? { date: p.publicationDate.slice(0, 10) } : {}) })),
    references: {
      story: relArticle(storyFile),
      evidence: 'evidence.md',
      brief: pathExists(briefFile) ? relArticle(briefFile) : null,
      authorInput: relArticle(init.file),
      authorProfile: profile ? rel(ctx, ctx.workspace.authorProfileMd) : null,
      patternTransfer: relArticle(files.patternTransfer.md),
      voicePlan: relArticle(files.voicePlan.md),
      research: latest ? rel(ctx, latest.file) : null,
    },
    basedOn: provenance,
    now,
    ...(previous.direction ? { previous: previous.direction } : {}),
    reviewRequired: review(previous.direction, 'editorial direction'),
  });

  const voicePlan = buildVoicePlan({
    story,
    platform,
    style: style?.preset.id ?? null,
    authorInput,
    lengthRange: direction.lengthRange,
    basedOn: provenance,
    now,
    ...(previous.voicePlan ? { previous: previous.voicePlan } : {}),
    reviewRequired: review(previous.voicePlan, 'voice plan'),
    samplePath: relArticle(files.voiceSample),
  });

  const plan = { direction, patternTransfer, voicePlan };
  await writePlan(files, plan);
  const reviewRequired = [...new Set([...direction.reviewRequired, ...patternTransfer.reviewRequired, ...voicePlan.reviewRequired])];
  ctx.logger.info(`Editorial plan scaffold for ${platform}: ${files.dir} (style: ${direction.style.id ?? 'not selected'}).`);
  return { files, plan, authorInputFile: init.file, authorInputCreated: init.created, refreshed: Boolean(previous.direction || previous.voicePlan || previous.patternTransfer), reviewRequired };
}

// ---------------------------------------------------------------- validate

export interface ValidateResult {
  ready: boolean;
  files: EditorialFiles;
  issues: EditorialIssue[];
}

const TREND_EVIDENCE = /^(?:research|pattern|trend|observation|saturated):/i;

export async function editorialValidateWorkflow(ctx: AppContext, storyFileArg: string, platform: string): Promise<ValidateResult> {
  const storyFile = path.resolve(storyFileArg);
  const story = await loadStory(storyFile);
  ctx.registry.get(platform);
  const articleDir = path.dirname(storyFile);
  const files = editorialFilesIn(await resolveEditorialDir(articleDir, platform));
  const issues: EditorialIssue[] = [];
  const err = (artifact: string, message: string) => issues.push({ severity: 'error', artifact, message });
  const warn = (artifact: string, message: string) => issues.push({ severity: 'warning', artifact, message });

  let authorInput: AuthorInput | undefined;
  try {
    authorInput = await loadAuthorInput(storyFile, story.slug);
  } catch (error) {
    err('author-input', errorMessage(error));
  }
  for (const i of authorInput?.issues ?? []) issues.push({ severity: i.severity, artifact: 'author-input', message: `${i.line ? `line ${i.line}: ` : ''}${i.message}` });

  const plan = await loadEditorialPlan(files);
  const { direction, patternTransfer, voicePlan } = plan;
  if (!direction) err('direction', `No editorial direction (${rel(ctx, files.direction.json)}). Run \`editorial-kit editorial plan --story ${rel(ctx, storyFile)} --platform ${platform}\`.`);
  if (!patternTransfer) err('pattern-transfer', `No pattern transfer (${rel(ctx, files.patternTransfer.json)}).`);
  if (!voicePlan) err('voice-plan', `No voice plan (${rel(ctx, files.voicePlan.json)}).`);
  for (const [name, a] of [['direction', direction], ['pattern-transfer', patternTransfer], ['voice-plan', voicePlan]] as const) {
    if (a && a.platform !== platform) err(name, `${name} was made for ${a.platform}, not ${platform}.`);
    if (a && a.story !== story.slug) err(name, `${name} belongs to story "${a.story}", not "${story.slug}".`);
  }

  const catalog = await loadStyles(ctx);
  for (const i of catalog.issues) (i.severity === 'error' ? err : warn)('styles', `${rel(ctx, i.file)}: ${i.message}`);
  const style = direction?.style.id && catalog.has(direction.style.id) ? catalog.get(direction.style.id) : undefined;
  const recordedResearch = patternTransfer?.basedOn.research?.file ?? direction?.basedOn.research?.file;
  const { provenance, snapshot } = await currentProvenance(ctx, { story, ...(authorInput ? { authorInput } : {}), ...(style ? { style } : {}), platform, ...(recordedResearch ? { researchFile: path.resolve(ctx.workspace.root, recordedResearch) } : {}) });

  // Drift: every recorded input is compared with its current state.
  for (const [name, label, a] of [['direction', 'editorial direction', direction], ['pattern-transfer', 'pattern transfer', patternTransfer], ['voice-plan', 'voice plan', voicePlan]] as const) {
    if (!a) continue;
    for (const d of compareProvenance(a.basedOn, provenance, label)) err(name, `${d.message}. Run \`editorial plan\` to refresh, then review.`);
    for (const r of a.reviewRequired) err(name, `Review required: ${r}`);
  }
  const latest = await findLatestSnapshot(ctx.workspace.researchDir, platform);
  if (latest && recordedResearch && rel(ctx, latest.file) !== recordedResearch) warn('pattern-transfer', `A newer research snapshot exists (${rel(ctx, latest.file)}); the plan uses ${recordedResearch}.`);
  if (latest && patternTransfer && !recordedResearch) warn('pattern-transfer', `A research snapshot exists (${rel(ctx, latest.file)}) but the plan was made without one.`);

  if (direction) {
    const publicationIds = new Set((await loadPublications(ctx.workspace)).map((p) => p.id));
    issues.push(...validateDirection(direction, { catalog, publicationIds }));
  }
  if (patternTransfer) {
    issues.push(...validatePatternTransfer(patternTransfer, { ...(authorInput ? { authorInput } : {}), ...(snapshot ? { snapshot } : {}) }));
    const used = patternTransfer.items.filter((i) => i.decision === 'apply' || i.decision === 'adapt');
    if (used.length && (!patternTransfer.basedOn.research || !provenance.research)) err('pattern-transfer', `${used.length} trend pattern(s) are applied, but their research snapshot provenance is missing.`);
  }
  const evidence = await readJsonIfExists(path.join(articleDir, 'evidence.json'), evidenceMapSchema);
  if (voicePlan) {
    const refs = new Set([...story.evidence, ...story.claims.flatMap((c) => c.evidence), ...(evidence?.records.map((r) => r.ref) ?? [])]);
    issues.push(...validateVoicePlan(voicePlan, { story, authorInput: authorInput ?? parseAuthorInput(''), ...(patternTransfer ? { patternTransfer } : {}), evidenceRefs: refs }));
  }

  // The canonical story and its evidence must still hold.
  for (const i of validateStory(story).issues.filter((x) => x.severity === 'error')) err('story', `[${i.field}] ${i.message}`);
  for (const c of story.claims) for (const e of c.evidence) if (TREND_EVIDENCE.test(e)) err('story', `Claim "${c.id}" cites "${e}" as evidence. Trend research is never evidence for a factual claim.`);
  if (!evidence) err('evidence', 'Evidence has not been collected (`editorial-kit evidence --story …`).');
  else {
    for (const i of evidence.issues.filter((x) => x.severity === 'error')) err('evidence', i.message);
    try {
      const drift = await detectDrift(evidence, requireProject(ctx, story.project).root);
      for (const d of drift) err('evidence', `evidence drift: ${d.ref} — ${d.reason}`);
    } catch (error) {
      warn('evidence', `Evidence drift not checked: ${errorMessage(error)}`);
    }
  }

  // Markdown files are views of the JSON; keep them in step with the agent's edits.
  if (direction && patternTransfer && voicePlan) await writePlan(files, { direction, patternTransfer, voicePlan });
  return { ready: !issues.some((i) => i.severity === 'error'), files, issues };
}

// ------------------------------------------------------------------- audit

export async function editorialAuditWorkflow(ctx: AppContext, storyFileArg: string, platform: string, outputArg?: string): Promise<{ audit: EditorialAudit; files: EditorialFiles; output: string }> {
  const storyFile = path.resolve(storyFileArg);
  const story = await loadStory(storyFile);
  ctx.registry.get(platform);
  const articleDir = path.dirname(storyFile);
  const output = path.resolve(outputArg ?? path.join(articleDir, 'outputs', `${platform}.md`));
  if (!pathExists(output)) throw new EditorialError('OUTPUT_MISSING', `${output} does not exist`, { hint: 'Draft the output first (or pass --output <file>).' });
  const files = editorialFilesIn(await resolveEditorialDir(articleDir, platform));
  const authorInput = await loadAuthorInput(storyFile, story.slug);
  const plan = await loadEditorialPlan(files);
  const catalog = await loadStyles(ctx);
  const styleId = plan.direction?.style.id;
  const style = styleId && catalog.has(styleId) ? catalog.get(styleId).preset : undefined;
  const recorded = plan.patternTransfer?.basedOn.research?.file;
  const snapshotFile = recorded ? path.resolve(ctx.workspace.root, recorded) : (await findLatestSnapshot(ctx.workspace.researchDir, platform))?.file;
  const snapshot = snapshotFile && pathExists(snapshotFile) ? await readJson(snapshotFile, researchSnapshotSchema) : undefined;
  let previous: EditorialAudit | undefined;
  if (pathExists(files.audit.json)) {
    try {
      previous = editorialAuditSchema.parse(JSON.parse(await readText(files.audit.json)));
    } catch (error) {
      throw new EditorialError('EDITORIAL_ARTIFACT_INVALID', `${files.audit.json} is not a valid audit: ${errorMessage(error).split('\n')[0]}`, { hint: 'Fix the incorporation records, or delete audit.json to start over.' });
    }
  }
  const profile = await loadAuthorProfile(ctx);
  const draftMarkdown = await readText(output);
  const audit = auditDraft({
    draftMarkdown,
    output: toPosix(path.relative(articleDir, output)),
    story: story.slug,
    platform,
    styleProfile: profile?.styleProfile ?? ctx.config.author.styleProfile,
    now: ctx.clock.now().toISOString(),
    ...(authorInput ? { authorInput } : {}),
    ...(plan.direction ? { direction: plan.direction } : {}),
    ...(plan.patternTransfer ? { patternTransfer: plan.patternTransfer } : {}),
    ...(plan.voicePlan ? { voicePlan: plan.voicePlan } : {}),
    ...(style ? { style } : {}),
    ...(snapshot ? { snapshot } : {}),
    ...(previous ? { previous } : {}),
  });
  await writeJson(files.audit.json, audit);
  await writeText(files.audit.md, renderAudit(audit, draftMarkdown));
  return { audit, files, output };
}

/** Used by `repurpose`: is there an editorial plan for this platform? */
export async function editorialStatus(storyFile: string, platform: string): Promise<{ planned: boolean; dir: string }> {
  const articleDir = path.dirname(path.resolve(storyFile));
  const dir = await resolveEditorialDir(articleDir, platform);
  return { planned: pathExists(path.join(dir, 'direction.json')) && pathExists(path.join(dir, 'voice-plan.json')), dir };
}
