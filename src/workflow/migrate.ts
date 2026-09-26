import path from 'node:path';
import { appendFile, copyFile, readdir, readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { savePublications } from '../author/store.js';
import { DEFAULT_CONFIG_FILE, LEGACY_CONFIG_FILE, parseConfig } from '../config/load.js';
import { loadPublicationFiles } from '../publications/store.js';
import { projectReportSchema } from '../project/schema.js';
import { extractEvents } from '../repo/events.js';
import { ensureRepository, mapRepositoryTopics, recordSnapshot, storeEvents } from '../repo/store.js';
import { researchSnapshotSchema } from '../research/types.js';
import { presetToReviewProfile } from '../review/profiles.js';
import { StoryOpsError, errorMessage } from '../shared/errors.js';
import { ensureDir, pathExists, writeJson, writeText } from '../shared/fs.js';
import { sha256 } from '../shared/hash.js';
import { createLogger, type Logger } from '../shared/logger.js';
import { mdList } from '../shared/markdown.js';
import { workspaceTopics } from '../topics/registry.js';
import { db, loadContext, saveDb, type AppContext } from './context.js';
import { ingestSnapshot } from './research.js';
import type { Clock } from '../shared/clock.js';

/**
 * `storyops migrate`: converts a v2 (editorial-kit) workspace into a v3
 * StoryOps workspace. It only ADDS: storyops.config.json, .storyops/ and the
 * database. It never deletes or rewrites user files: editorial.config.json,
 * .editorial/ and articles/ (including old generated drafts) stay as they are.
 * Old drafts are not imported as publications; only publications recorded in
 * .editorial/publications/ are. Re-running is safe (imports are idempotent).
 */

export interface MigrationReport {
  dryRun: boolean;
  config: { created: boolean; file: string; removedFields: string[] };
  publications: { found: number; added: number; updated: number; unchanged: number };
  snapshots: Array<{ file: string; runId?: number; duplicate?: boolean; skipped?: string }>;
  repositories: Array<{ id: string; events: number; skipped?: string }>;
  reviewProfiles: Array<{ from: string; to?: string; skipped?: string }>;
  authorProfile: 'copied' | 'kept-existing' | 'none';
  untouched: string[];
  notImported: string[];
  reportFile?: string;
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

/** v2 config JSON → v3 config JSON (generation-only fields dropped, listed in the report). */
export function migrateConfigData(raw: Record<string, unknown>): { data: Record<string, unknown>; removed: string[] } {
  const data = structuredClone(raw);
  const removed: string[] = [];
  data.schemaVersion = 2;
  if ('editorial' in data) {
    const style = (data.editorial as { defaultStyle?: string } | undefined)?.defaultStyle;
    delete data.editorial;
    removed.push('editorial');
    if (style) data.review = { ...((data.review as object | undefined) ?? {}), profile: style };
  }
  if ('screenshots' in data) {
    delete data.screenshots;
    removed.push('screenshots');
  }
  const paths = data.paths as Record<string, unknown> | undefined;
  if (paths) {
    if ('articlesDir' in paths) {
      delete paths.articlesDir;
      removed.push('paths.articlesDir');
    }
  }
  return { data, removed };
}

export async function migrateWorkspace(root: string, options: { dryRun?: boolean; clock?: Clock; logger?: Logger; configFile?: string } = {}): Promise<MigrationReport> {
  const logger = options.logger ?? createLogger();
  const newConfig = path.resolve(root, options.configFile ?? DEFAULT_CONFIG_FILE);
  const legacyConfig = path.resolve(root, LEGACY_CONFIG_FILE);
  const report: MigrationReport = { dryRun: Boolean(options.dryRun), config: { created: false, file: newConfig, removedFields: [] }, publications: { found: 0, added: 0, updated: 0, unchanged: 0 }, snapshots: [], repositories: [], reviewProfiles: [], authorProfile: 'none', untouched: [], notImported: [] };

  if (!pathExists(newConfig)) {
    if (!pathExists(legacyConfig)) throw new StoryOpsError('MIGRATE_NOTHING', `Neither ${DEFAULT_CONFIG_FILE} nor ${LEGACY_CONFIG_FILE} exists in ${root}.`, { hint: 'Run `storyops init` for a new workspace.' });
    const { data, removed } = migrateConfigData(JSON.parse(await readFile(legacyConfig, 'utf8')) as Record<string, unknown>);
    parseConfig(data, `${LEGACY_CONFIG_FILE} (migrated)`);
    report.config = { created: true, file: newConfig, removedFields: removed };
    if (!options.dryRun) await writeJson(newConfig, data);
  }
  if (options.dryRun) {
    // A dry run only lists what would be read; it creates no file and no database.
    const legacy = path.resolve(root, '.editorial');
    report.publications.found = (await loadPublicationFiles(path.join(legacy, 'publications'))).length;
    for (const date of (await listDir(path.join(legacy, 'research'))).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
      for (const file of (await listDir(path.join(legacy, 'research', date))).filter((f) => f.endsWith('.json'))) report.snapshots.push({ file: path.join('.editorial', 'research', date, file), skipped: 'dry run' });
    }
    for (const id of await listDir(path.join(legacy, 'projects'))) if (pathExists(path.join(legacy, 'projects', id, 'report.json'))) report.repositories.push({ id, events: 0, skipped: 'dry run' });
    for (const file of (await listDir(path.join(legacy, 'styles'))).filter((f) => /\.(ya?ml|json)$/i.test(f))) report.reviewProfiles.push({ from: path.join('.editorial', 'styles', file), skipped: 'dry run' });
    for (const p of [LEGACY_CONFIG_FILE, '.editorial', 'articles']) if (pathExists(path.join(root, p))) report.untouched.push(p);
    return report;
  }

  const ctx: AppContext = await loadContext({ root, configFile: path.basename(newConfig), logger, ...(options.clock ? { clock: options.clock } : {}) });
  const legacy = ctx.workspace.legacyDir;
  const database = await db(ctx);
  const now = ctx.clock.now().toISOString();

  // Publications (the author's archive).
  const pubs = await loadPublicationFiles(path.join(legacy, 'publications'));
  report.publications.found = pubs.length;
  if (pubs.length) Object.assign(report.publications, savePublications(database, pubs));

  // Research snapshots → research runs (idempotent by file fingerprint).
  const researchDir = path.join(legacy, 'research');
  for (const date of (await listDir(researchDir)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    for (const file of (await listDir(path.join(researchDir, date))).filter((f) => f.endsWith('.json'))) {
      const abs = path.join(researchDir, date, file);
      const rel = path.relative(root, abs);
      try {
        const raw = await readFile(abs, 'utf8');
        const parsed = researchSnapshotSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
          report.snapshots.push({ file: rel, skipped: 'not a research snapshot' });
          continue;
        }
        if (parsed.data.sampleSize === 0) {
          report.snapshots.push({ file: rel, skipped: `status ${parsed.data.status}, no articles` });
          continue;
        }
        const run = ingestSnapshot(database, ctx, parsed.data, 'legacy-snapshot', { label: rel, fingerprint: sha256(raw.replace(/\r\n?/g, '\n')) });
        report.snapshots.push({ file: rel, runId: run.runId, duplicate: run.duplicate });
      } catch (error) {
        report.snapshots.push({ file: rel, skipped: errorMessage(error) });
      }
    }
  }

  // Repository reports → snapshots + events.
  const projectsDir = path.join(legacy, 'projects');
  for (const id of await listDir(projectsDir)) {
    const file = path.join(projectsDir, id, 'report.json');
    if (!pathExists(file)) continue;
    const parsed = projectReportSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
    if (!parsed.success) {
      report.repositories.push({ id, events: 0, skipped: 'report.json did not validate' });
      continue;
    }
    const project = ctx.config.projects.find((p) => p.id === id);
    ensureRepository(database, { id, name: project?.name ?? parsed.data.name, path: project?.path ?? parsed.data.root }, now);
    const snap = recordSnapshot(database, parsed.data);
    const events = extractEvents(parsed.data);
    storeEvents(database, events, snap.snapshotId, now);
    mapRepositoryTopics(database, id, events, workspaceTopics(ctx.config), now);
    report.repositories.push({ id, events: events.length });
  }

  // Workspace style presets → review profiles.
  const stylesDir = path.join(legacy, 'styles');
  for (const file of (await listDir(stylesDir)).filter((f) => /\.(ya?ml|json)$/i.test(f))) {
    const from = path.relative(root, path.join(stylesDir, file));
    try {
      const raw = await readFile(path.join(stylesDir, file), 'utf8');
      const preset = (/\.json$/i.test(file) ? JSON.parse(raw) : YAML.parse(raw)) as Record<string, unknown>;
      const profile = presetToReviewProfile(preset);
      const to = path.join(ctx.workspace.reviewProfilesDir, `${profile.id}.yaml`);
      if (pathExists(to)) report.reviewProfiles.push({ from, skipped: `${path.relative(root, to)} already exists` });
      else {
        if (!options.dryRun) await writeText(to, `# Migrated from ${from} by \`storyops migrate\`.\n${YAML.stringify(profile)}`);
        report.reviewProfiles.push({ from, to: path.relative(root, to) });
      }
    } catch (error) {
      report.reviewProfiles.push({ from, skipped: errorMessage(error) });
    }
  }

  // Author profile (keeps the manual notes).
  const oldProfile = path.join(legacy, 'author-profile.json');
  if (pathExists(oldProfile)) {
    if (pathExists(ctx.workspace.authorProfileJson)) report.authorProfile = 'kept-existing';
    else {
      if (!options.dryRun) {
        await ensureDir(ctx.workspace.authorDir);
        await copyFile(oldProfile, ctx.workspace.authorProfileJson);
      }
      report.authorProfile = 'copied';
    }
  }

  // What stays untouched.
  for (const p of [LEGACY_CONFIG_FILE, path.relative(root, legacy)]) if (pathExists(path.join(root, p))) report.untouched.push(p);
  const articlesDir = path.join(root, 'articles');
  if (pathExists(articlesDir)) {
    report.untouched.push('articles/');
    for (const slug of await listDir(articlesDir)) {
      const outputs = path.join(articlesDir, slug, 'outputs');
      for (const f of await listDir(outputs)) report.notImported.push(`articles/${slug}/outputs/${f} (v2 draft; user file, kept, not treated as a publication)`);
      if (pathExists(path.join(articlesDir, slug, 'research', 'collision.json'))) report.untouched.push(`articles/${slug}/research/collision.json (topic collision data; still readable)`);
    }
  }

  if (!options.dryRun) {
    await saveDb(ctx);
    const gitignore = path.join(root, '.gitignore');
    const wanted = ['.storyops/cache/', '.storyops/backups/'];
    const existing = pathExists(gitignore) ? (await readFile(gitignore, 'utf8')).split(/\r?\n/).map((l) => l.trim()) : [];
    const missing = wanted.filter((w) => !existing.includes(w));
    if (missing.length) await appendFile(gitignore, `\n# storyops\n${missing.join('\n')}\n`);
    report.reportFile = path.join(ctx.workspace.dataDir, 'migration-report.md');
    await writeText(report.reportFile, renderMigration(report));
  }
  database.close();
  ctx.database = undefined;
  return report;
}

export function renderMigration(r: MigrationReport): string {
  return [
    `# StoryOps migration report${r.dryRun ? ' (dry run)' : ''}`,
    '',
    `- Config: ${r.config.created ? `created ${path.basename(r.config.file)}` : 'already present'}${r.config.removedFields.length ? ` (dropped generation-only fields: ${r.config.removedFields.join(', ')})` : ''}`,
    `- Publications: ${r.publications.found} found; ${r.publications.added} added, ${r.publications.updated} updated, ${r.publications.unchanged} unchanged`,
    `- Research snapshots: ${r.snapshots.filter((s) => s.runId && !s.duplicate).length} imported as runs, ${r.snapshots.filter((s) => s.duplicate).length} already imported, ${r.snapshots.filter((s) => s.skipped).length} skipped`,
    `- Repository reports: ${r.repositories.map((x) => `${x.id} (${x.skipped ?? `${x.events} events`})`).join(', ') || 'none'}`,
    `- Review profiles from style presets: ${r.reviewProfiles.map((x) => `${x.from} → ${x.to ?? `skipped (${x.skipped})`}`).join('; ') || 'none'}`,
    `- Author profile: ${r.authorProfile}`,
    '',
    '## Left untouched (never deleted)',
    '',
    mdList(r.untouched),
    '',
    '## Not imported',
    '',
    mdList(r.notImported, '_nothing_'),
    '',
    'Old generated drafts are user files. They are kept as they are and are not treated as published history. To record one as published, import it explicitly: `storyops author import <file> -p <platform> --date <iso> --url <url>`.',
    '',
  ].join('\n');
}
