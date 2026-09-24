import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { classifyCommit, pathKind, TEST_PATH } from '../git/classify.js';
import { commitLog, headCommit, isGitRepository, tags as gitTags, trackedFiles } from '../git/git.js';
import type { Clock } from '../shared/clock.js';
import { listFilesRecursive, pathExists } from '../shared/fs.js';
import { sha256 } from '../shared/hash.js';
import type { Logger } from '../shared/logger.js';
import { isSecretPath, redactSecrets } from '../shared/redact.js';
import { truncate } from '../shared/text.js';
import { PROJECT_REPORT_SCHEMA_VERSION, type ProjectModule, type ProjectReport } from './schema.js';

const IGNORED_DIRS = /(^|\/)(node_modules|\.git|dist|build|out|coverage|vendor|\.venv|venv|__pycache__|target|\.next|\.cache|\.turbo|\.idea|\.vscode|\.editorial)\//;
const MAX_DOC_BYTES = 256 * 1024;
const SOURCE_ROOTS = ['src', 'lib', 'app', 'packages', 'internal', 'pkg', 'cmd', 'crates', 'modules'];

export interface InspectOptions {
  projectId: string;
  name: string;
  root: string;
  clock: Clock;
  logger: Logger;
  maxCommits?: number;
}

function docKind(p: string): ProjectReport['docs'][number]['kind'] | undefined {
  const base = path.posix.basename(p).toLowerCase();
  if (!/\.(md|mdx|rst|adoc|txt)$/i.test(base)) return undefined;
  if (/(^|\/)(adr|adrs|decisions)\//i.test(p) || /^(adr|\d{3,4})[-_]/.test(base)) return 'adr';
  if (base.startsWith('readme')) return 'readme';
  if (base.startsWith('architecture') || base.startsWith('design')) return 'architecture';
  if (base.startsWith('changelog') || base.startsWith('changes') || base.startsWith('history')) return 'changelog';
  if (base.startsWith('contributing')) return 'contributing';
  if (/bench/i.test(p)) return 'benchmark';
  if (/(^|\/)docs?\//i.test(p)) return 'doc';
  return undefined;
}

/** Module = second-level directory under a source root (src/health), or first-level otherwise. */
export function moduleOf(p: string): string | undefined {
  const parts = p.split('/');
  if (parts.length < 2) return undefined;
  if (SOURCE_ROOTS.includes(parts[0]!)) return parts.length >= 3 ? `${parts[0]}/${parts[1]}` : undefined;
  if (pathKind(p) !== 'source') return undefined;
  return parts[0];
}

function parseChangelog(content: string): ProjectReport['changelog'] {
  const entries: ProjectReport['changelog'] = [];
  let current: ProjectReport['changelog'][number] | undefined;
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^#{2,3}\s+\[?v?(\d+\.\d+(?:\.\d+)?[^\]\s]*|unreleased)\]?(?:.*?(\d{4}-\d{2}-\d{2}))?/i);
    if (heading) {
      current = { version: heading[1]!, items: [] };
      if (heading[2]) current.date = heading[2];
      entries.push(current);
      continue;
    }
    const item = line.match(/^\s*[-*]\s+(.+)/);
    if (item && current && current.items.length < 15) current.items.push(truncate(item[1]!.trim(), 200));
  }
  return entries;
}

function firstParagraph(markdown: string): { title?: string; excerpt?: string; status?: string } {
  const lines = markdown.split(/\r?\n/);
  const title = lines.find((l) => /^#\s+/.test(l))?.replace(/^#\s+/, '').trim();
  const statusLine = markdown.match(/^(?:#+\s*)?(?:status|статус)\s*[:\n]\s*\n?\s*([A-Za-zА-Яа-я -]+)/im);
  const paragraphs = markdown
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('#') && !/^(?:status|статус)\s*:/i.test(p) && p !== statusLine?.[1]?.trim());
  const result: { title?: string; excerpt?: string; status?: string } = {};
  if (title) result.title = title;
  if (paragraphs[0]) result.excerpt = truncate(redactSecrets(paragraphs[0].replace(/\s+/g, ' ')), 400);
  if (statusLine?.[1]) result.status = statusLine[1].trim();
  return result;
}

/**
 * Inspects a project repository read-only and produces a selective,
 * inspectable report (not a repository dump). Secret-like paths are skipped
 * and never read.
 */
export async function inspectProject(options: InspectOptions): Promise<ProjectReport> {
  const { root, logger } = options;
  if (!pathExists(root)) throw new Error(`Project path does not exist: ${root}`);
  const isRepo = await isGitRepository(root);
  const warnings: string[] = [];
  let files: string[];
  if (isRepo) files = await trackedFiles(root);
  else {
    warnings.push('Not a git repository: no history, commits or tags available; using a filesystem walk.');
    files = await listFilesRecursive(root, { ignore: (rel) => IGNORED_DIRS.test(rel.endsWith('/') ? rel : `${rel}`) || IGNORED_DIRS.test(`${rel}/`) });
  }
  const skippedSecretPaths = files.filter(isSecretPath).length;
  files = files.filter((f) => !isSecretPath(f) && !IGNORED_DIRS.test(f));
  logger.info(`Inspecting ${options.name}: ${files.length} files${skippedSecretPaths ? ` (${skippedSecretPaths} secret-like paths skipped)` : ''}.`);

  const commits = isRepo ? await commitLog(root, { maxCount: options.maxCommits ?? 2000 }) : [];
  const tagList = isRepo ? await gitTags(root) : [];
  if (isRepo && commits.length >= (options.maxCommits ?? 2000)) warnings.push(`History truncated to the latest ${options.maxCommits ?? 2000} commits.`);

  // Per-path first/last commit dates, and module membership over history.
  const firstSeen = new Map<string, string>();
  const lastChanged = new Map<string, string>();
  const deletedAt = new Map<string, string>();
  const moduleCommits = new Map<string, number>();
  const moduleFirst = new Map<string, string>();
  const moduleLast = new Map<string, string>();
  const reportCommits: ProjectReport['commits'] = [];
  for (const commit of commits) {
    const modulesTouched = new Set<string>();
    for (const f of commit.files) {
      if (isSecretPath(f.path)) continue;
      if (!firstSeen.has(f.path)) firstSeen.set(f.path, commit.date);
      lastChanged.set(f.path, commit.date);
      if (f.status === 'D') deletedAt.set(f.path, commit.date);
      else deletedAt.delete(f.path);
      if (f.previousPath) deletedAt.set(f.previousPath, commit.date);
      const mod = moduleOf(f.path);
      if (mod) modulesTouched.add(mod);
      const prevMod = f.previousPath ? moduleOf(f.previousPath) : undefined;
      if (prevMod) modulesTouched.add(prevMod);
    }
    for (const mod of modulesTouched) {
      moduleCommits.set(mod, (moduleCommits.get(mod) ?? 0) + 1);
      if (!moduleFirst.has(mod)) moduleFirst.set(mod, commit.date);
      moduleLast.set(mod, commit.date);
    }
    const classified = classifyCommit(commit);
    reportCommits.push({ ...classified, modules: [...modulesTouched].sort() });
  }

  // Modules: current ones plus ones that existed in history but are gone now.
  const current = new Map<string, string[]>();
  for (const f of files) {
    const mod = moduleOf(f);
    if (mod) current.set(mod, [...(current.get(mod) ?? []), f]);
  }
  const allModules = new Set([...current.keys(), ...moduleCommits.keys()]);
  const modules: ProjectModule[] = [...allModules].sort().map((mod) => {
    const modFiles = current.get(mod) ?? [];
    const name = mod.split('/').at(-1)!;
    const testFiles = files.filter((f) => TEST_PATH.test(f) && (f.includes(`/${name}/`) || path.posix.basename(f).startsWith(`${name}.`) || path.posix.basename(f).startsWith(`${name}-`))).length;
    const m: ProjectModule = { path: mod, name, files: modFiles.length, testFiles, commits: moduleCommits.get(mod) ?? 0, exists: modFiles.length > 0 };
    const first = moduleFirst.get(mod);
    const last = moduleLast.get(mod);
    if (first) m.firstSeen = first;
    if (last) m.lastChanged = last;
    if (!m.exists && last) m.deletedAt = last;
    return m;
  });

  // Docs
  const docs: ProjectReport['docs'] = [];
  let changelog: ProjectReport['changelog'] = [];
  for (const f of files) {
    const kind = docKind(f);
    if (!kind) continue;
    const abs = path.join(root, f);
    let content = '';
    try {
      if ((await stat(abs)).size > MAX_DOC_BYTES) {
        warnings.push(`${f} is larger than ${MAX_DOC_BYTES / 1024}KB; only its metadata was recorded.`);
      } else content = await readFile(abs, 'utf8');
    } catch {
      continue;
    }
    const info = firstParagraph(content);
    const doc: ProjectReport['docs'][number] = { path: f, kind, contentHash: sha256(content) };
    if (info.title) doc.title = info.title;
    if (info.excerpt) doc.excerpt = info.excerpt;
    if (kind === 'adr' && info.status) doc.status = info.status;
    const fs = firstSeen.get(f);
    const lc = lastChanged.get(f);
    if (fs) doc.firstCommitDate = fs;
    if (lc) doc.lastCommitDate = lc;
    docs.push(doc);
    if (kind === 'changelog' && changelog.length === 0) changelog = parseChangelog(content);
    // Stale path references: docs describing files that no longer exist.
    for (const ref of content.matchAll(/`((?:src|lib|app|packages)\/[\w./-]+)`/g)) {
      const target = ref[1]!.replace(/\/$/, '');
      if (!files.some((x) => x === target || x.startsWith(`${target}/`))) warnings.push(`${f} references \`${target}\`, which does not exist in the current tree (docs may be out of date).`);
    }
  }

  const languages = new Map<string, number>();
  const tree = new Map<string, number>();
  for (const f of files) {
    const ext = path.posix.extname(f).toLowerCase() || '(none)';
    languages.set(ext, (languages.get(ext) ?? 0) + 1);
    const top = f.includes('/') ? f.split('/')[0]! : '.';
    tree.set(top, (tree.get(top) ?? 0) + 1);
  }

  const manifests: ProjectReport['metadata']['manifests'] = [];
  for (const f of files.filter((x) => /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/.test(x) && x.split('/').length <= 2)) {
    try {
      const content = await readFile(path.join(root, f), 'utf8');
      const entry: ProjectReport['metadata']['manifests'][number] = { path: f };
      if (f.endsWith('package.json')) {
        const pkg = JSON.parse(content) as { name?: string; version?: string; description?: string };
        if (pkg.name) entry.name = pkg.name;
        if (pkg.version) entry.version = pkg.version;
        if (pkg.description) entry.description = truncate(pkg.description, 300);
      } else {
        const name = content.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] ?? content.match(/^module\s+(\S+)/m)?.[1];
        const version = content.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
        if (name) entry.name = name;
        if (version) entry.version = version;
      }
      manifests.push(entry);
    } catch {
      warnings.push(`Could not parse ${f}.`);
    }
  }

  const testPaths = files.filter((f) => TEST_PATH.test(f));
  const chronology: ProjectReport['chronology'] = [
    ...tagList.map((t) => ({ date: t.date, kind: 'tag', title: t.name, ref: `tag:${t.name}` })),
    ...modules.filter((m) => m.firstSeen).map((m) => ({ date: m.firstSeen!, kind: 'module-introduced', title: m.path, ref: m.path })),
    ...modules.filter((m) => m.deletedAt).map((m) => ({ date: m.deletedAt!, kind: 'module-removed', title: m.path, ref: m.path })),
    ...docs.filter((d) => d.kind === 'adr' && d.firstCommitDate).map((d) => ({ date: d.firstCommitDate!, kind: 'adr', title: d.title ?? d.path, ref: d.path })),
    ...reportCommits.filter((c) => ['migration', 'refactor', 'removal', 'performance'].includes(c.messageCategory) || c.breaking).map((c) => ({ date: c.date, kind: c.messageCategory, title: c.subject, ref: `commit:${c.shortHash}` })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));

  const report: ProjectReport = {
    schemaVersion: PROJECT_REPORT_SCHEMA_VERSION,
    projectId: options.projectId,
    name: options.name,
    root,
    inspectedAt: options.clock.now().toISOString(),
    isGitRepository: isRepo,
    metadata: { manifests },
    languages: [...languages].map(([extension, count]) => ({ extension, files: count })).sort((a, b) => b.files - a.files || a.extension.localeCompare(b.extension)),
    tree: [...tree].map(([p, count]) => ({ path: p, files: count })).sort((a, b) => a.path.localeCompare(b.path)),
    modules,
    docs,
    changelog,
    tests: { files: testPaths.length, paths: testPaths.slice(0, 200), note: 'Counts test FILES matched by path patterns, not individual test cases.' },
    config: files.filter((f) => pathKind(f) === 'config').slice(0, 100),
    tags: tagList,
    commits: reportCommits,
    chronology,
    warnings: [...new Set(warnings)],
    skippedSecretPaths,
  };
  const head = isRepo ? await headCommit(root) : undefined;
  if (head) report.head = head;
  return report;
}
