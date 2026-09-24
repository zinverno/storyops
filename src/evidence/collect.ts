import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { commitInfo, isGitRepository, tags as gitTags, trackedFiles } from '../git/git.js';
import { pathKind } from '../git/classify.js';
import type { Publication } from '../publications/schema.js';
import type { CanonicalStory } from '../stories/schema.js';
import { compare } from '../similarity/index.js';
import type { Clock } from '../shared/clock.js';
import { listFilesRecursive, pathExists } from '../shared/fs.js';
import { sha256, shortHash } from '../shared/hash.js';
import { isSecretPath, redactSecrets } from '../shared/redact.js';
import { truncate } from '../shared/text.js';
import { parseRef } from './refs.js';
import { EVIDENCE_SCHEMA_VERSION, type EvidenceKind, type EvidenceMap, type EvidenceRecord } from './schema.js';

export interface CollectEvidenceInput {
  story: CanonicalStory;
  storyFile: string;
  projectRoot?: string;
  publications: readonly Publication[];
  /** Directory with canonical screenshots for this article. */
  screenshotsDir?: string;
  clock: Clock;
  /** Suggest candidate evidence for claims that have none (lexical search). */
  suggest?: boolean;
}

const MAX_EXCERPT_LINES = 12;
const MAX_FILE_BYTES = 512 * 1024;

function fileKind(p: string): EvidenceKind {
  const base = path.posix.basename(p).toLowerCase();
  if (/(^|\/)(adr|adrs|decisions)\//i.test(p)) return 'adr';
  if (base.startsWith('changelog')) return 'changelog';
  if (/bench/i.test(p)) return 'benchmark';
  if (/^(package\.json|pyproject\.toml|cargo\.toml|go\.mod)$/.test(base)) return 'package-metadata';
  const kind = pathKind(p);
  if (kind === 'tests') return 'test';
  if (kind === 'docs') return 'doc';
  if (kind === 'config') return 'config';
  return 'source-file';
}

/** Every evidence ref used anywhere in the story, in a stable order. */
export function storyRefs(story: CanonicalStory): string[] {
  const refs = [
    ...story.evidence,
    ...story.claims.flatMap((c) => c.evidence),
    ...story.technicalDecisions.flatMap((d) => d.evidence),
    ...story.failedOrInsufficientApproaches.flatMap((a) => a.evidence),
    ...story.measurements.flatMap((m) => m.evidence),
    ...story.results.flatMap((r) => r.evidence),
  ];
  return [...new Set(refs.map((r) => r.trim()).filter(Boolean))];
}

async function resolveRef(ref: string, input: CollectEvidenceInput, ctx: { isRepo: boolean; tagList: Awaited<ReturnType<typeof gitTags>> }): Promise<EvidenceRecord | { error: string }> {
  const parsed = parseRef(ref);
  const collectedAt = input.clock.now().toISOString();
  const base = { schemaVersion: EVIDENCE_SCHEMA_VERSION, id: `ev-${shortHash(ref, 10)}`, ref, collectedAt } as const;
  if (!parsed) return { error: `unrecognised or unsafe reference "${ref}"` };
  const root = input.projectRoot;
  switch (parsed.type) {
    case 'url':
      return { ...base, kind: /\/pull\/\d+/.test(parsed.url) ? 'pull-request' : /\/releases\//.test(parsed.url) ? 'release' : 'doc', title: parsed.url, locator: { url: parsed.url }, excerpt: 'External URL — recorded, not fetched or verified.' };
    case 'publication': {
      const pub = input.publications.find((p) => p.id === parsed.id);
      if (!pub) return { error: `publication ${parsed.id} is not in the publication index` };
      const rec: EvidenceRecord = { ...base, kind: 'publication', title: pub.title, locator: pub.url ? { url: pub.url } : {}, excerpt: truncate(pub.lead ?? pub.text, 300), contentHash: sha256(pub.text) };
      if (pub.publicationDate) rec.date = pub.publicationDate;
      return rec;
    }
    case 'screenshot': {
      if (!input.screenshotsDir) return { error: 'no screenshots directory for this article' };
      const file = path.join(input.screenshotsDir, parsed.file);
      if (path.relative(input.screenshotsDir, file).startsWith('..') || !pathExists(file)) return { error: `screenshot ${parsed.file} not found in ${input.screenshotsDir}` };
      return { ...base, kind: 'screenshot', title: parsed.file, locator: { path: path.relative(path.dirname(input.storyFile), file).split(path.sep).join('/') }, contentHash: sha256(await readFile(file)) };
    }
    case 'commit': {
      if (!root || !ctx.isRepo) return { error: 'commit references need a git project root' };
      const info = await commitInfo(root, parsed.rev);
      if (!info) return { error: `commit ${parsed.rev} not found` };
      return { ...base, kind: 'commit', title: info.subject, locator: { commit: info.hash }, excerpt: truncate(`files: ${info.files.filter((f) => !isSecretPath(f)).slice(0, 10).join(', ')}`, 400), date: info.date };
    }
    case 'tag': {
      const tag = ctx.tagList.find((t) => t.name === parsed.name);
      if (!tag) return { error: `tag ${parsed.name} not found` };
      return { ...base, kind: 'tag', title: tag.name, locator: { tag: tag.name, commit: tag.commit }, date: tag.date };
    }
    case 'file': {
      if (!root) return { error: 'file references need a project root' };
      if (isSecretPath(parsed.path)) return { error: `${parsed.path} is a secret-like path and is never used as evidence` };
      const abs = path.resolve(root, parsed.path);
      if (path.relative(root, abs).startsWith('..')) return { error: `${parsed.path} escapes the project root` };
      if (!pathExists(abs)) return { error: `${parsed.path} does not exist in the project` };
      const st = await stat(abs);
      if (st.isDirectory()) {
        const files = (await listFilesRecursive(abs, { maxFiles: 2000 })).filter((f) => !isSecretPath(f));
        return { ...base, kind: fileKind(`${parsed.path.replace(/\/$/, '')}/x`), title: `${parsed.path} (directory, ${files.length} files)`, locator: { path: parsed.path }, excerpt: truncate(files.slice(0, 15).join(', '), 500) };
      }
      if (st.size > MAX_FILE_BYTES) return { ...base, kind: fileKind(parsed.path), title: parsed.path, locator: { path: parsed.path }, excerpt: `(file larger than ${MAX_FILE_BYTES / 1024}KB; not excerpted)` };
      const content = await readFile(abs, 'utf8');
      const lines = content.split(/\r?\n/);
      let excerptLines: string[];
      const rec: EvidenceRecord = { ...base, kind: fileKind(parsed.path), title: parsed.path, locator: { path: parsed.path }, contentHash: sha256(content) };
      if (parsed.lines) {
        const [s, e] = parsed.lines;
        if (s > lines.length) return { error: `${parsed.path} has only ${lines.length} lines (requested L${s})` };
        excerptLines = lines.slice(s - 1, Math.min(e, s - 1 + MAX_EXCERPT_LINES));
        rec.locator.lines = [s, Math.min(e, lines.length)];
        rec.contentHash = sha256(lines.slice(s - 1, e).join('\n'));
      } else excerptLines = lines.slice(0, MAX_EXCERPT_LINES);
      rec.excerpt = redactSecrets(excerptLines.join('\n'));
      return rec;
    }
  }
}

async function suggestionCorpus(root: string | undefined, isRepo: boolean): Promise<Array<{ id: string; text: string }>> {
  if (!root) return [];
  const files = (isRepo ? await trackedFiles(root) : await listFilesRecursive(root, { maxFiles: 3000 }))
    .filter((f) => !isSecretPath(f) && /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|rb|php|cs|swift|md|mdx|json|ya?ml|toml)$/i.test(f) && !/(^|\/)(node_modules|dist|vendor)\//.test(f) && !/lock\.json$/.test(f))
    .slice(0, 2000);
  const docs: Array<{ id: string; text: string }> = [];
  for (const f of files) {
    try {
      const abs = path.join(root, f);
      if ((await stat(abs)).size > 128 * 1024) continue;
      const content = await readFile(abs, 'utf8');
      docs.push({ id: f, text: `${f.replace(/[/._-]+/g, ' ')} ${f.replace(/[/._-]+/g, ' ')} ${content.slice(0, 20_000)}` });
    } catch {
      // unreadable file: skip
    }
  }
  return docs;
}

export async function collectEvidence(input: CollectEvidenceInput): Promise<EvidenceMap> {
  const root = input.projectRoot;
  const isRepo = root ? await isGitRepository(root) : false;
  const tagList = root && isRepo ? await gitTags(root) : [];
  const records = new Map<string, EvidenceRecord>();
  const errors = new Map<string, string>();
  for (const ref of storyRefs(input.story)) {
    const result = await resolveRef(ref, input, { isRepo, tagList });
    if ('error' in result) errors.set(ref, result.error);
    else records.set(ref, result);
  }

  const needsSuggestions = input.suggest !== false && input.story.claims.some((c) => c.evidence.length === 0 && c.classification === 'verified-fact');
  const corpus = needsSuggestions ? await suggestionCorpus(root, isRepo) : [];

  const issues: EvidenceMap['issues'] = [];
  const claims: EvidenceMap['claims'] = input.story.claims.map((claim) => {
    const evidenceIds = claim.evidence.map((r) => records.get(r.trim())?.id).filter((x): x is string => Boolean(x));
    const unresolvedRefs = claim.evidence.filter((r) => errors.has(r.trim()));
    const requiresEvidence = claim.classification === 'verified-fact';
    let suggestions: EvidenceMap['claims'][number]['suggestions'] = [];
    if (requiresEvidence && claim.evidence.length === 0 && corpus.length > 0) {
      suggestions = compare({ id: 'claim', text: claim.text }, corpus)
        .filter((r) => r.bm25Normalized > 0.1)
        .slice(0, 3)
        .map((r) => ({ ref: r.id, title: r.id, score: r.cosine }));
    }
    let status: EvidenceMap['claims'][number]['status'];
    if (unresolvedRefs.length > 0) status = 'broken-reference';
    else if (evidenceIds.length > 0) status = 'supported';
    else if (requiresEvidence) status = 'missing-evidence';
    else status = 'not-required';
    if (status === 'missing-evidence') issues.push({ severity: 'error', message: `Verified fact without evidence: "${claim.text}"`, claimId: claim.id });
    if (status === 'broken-reference') for (const r of unresolvedRefs) issues.push({ severity: 'error', message: `${r}: ${errors.get(r.trim())}`, claimId: claim.id });
    if (claim.classification === 'unverified') issues.push({ severity: 'warning', message: `Unverified statement: "${claim.text}"`, claimId: claim.id });
    return { claimId: claim.id, text: claim.text, classification: claim.classification, evidenceIds, unresolvedRefs, suggestions, status };
  });
  for (const [ref, error] of errors) {
    if (!input.story.claims.some((c) => c.evidence.map((e) => e.trim()).includes(ref))) issues.push({ severity: 'error', message: `${ref}: ${error}` });
  }
  const map: EvidenceMap = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    story: input.story.slug,
    collectedAt: input.clock.now().toISOString(),
    records: [...records.values()],
    claims,
    issues,
  };
  if (root) map.projectRoot = root;
  return map;
}

/** Re-checks recorded content hashes against the current project state. */
export async function detectDrift(map: EvidenceMap, projectRoot: string): Promise<Array<{ ref: string; reason: string }>> {
  const drift: Array<{ ref: string; reason: string }> = [];
  for (const rec of map.records) {
    if (!rec.locator.path || !rec.contentHash || rec.kind === 'screenshot' || rec.kind === 'publication') continue;
    const abs = path.resolve(projectRoot, rec.locator.path);
    if (!pathExists(abs)) {
      drift.push({ ref: rec.ref, reason: 'file no longer exists' });
      continue;
    }
    if ((await stat(abs)).isDirectory()) continue;
    const content = await readFile(abs, 'utf8');
    const hash = rec.locator.lines ? sha256(content.split(/\r?\n/).slice(rec.locator.lines[0] - 1, rec.locator.lines[1]).join('\n')) : sha256(content);
    if (hash !== rec.contentHash) drift.push({ ref: rec.ref, reason: 'content changed since evidence was collected' });
  }
  return drift;
}
