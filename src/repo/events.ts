import path from 'node:path';
import { TEST_PATH } from '../git/classify.js';
import type { ProjectReport, ReportCommit } from '../project/schema.js';
import { shortHash } from '../shared/hash.js';

/**
 * Candidate engineering events extracted from a repository inspection
 * report. Each event says WHAT it was inferred from (`basis`) and how much
 * independent evidence backs it (`evidenceStrength`). Types inferred from a
 * commit message alone are hints: the report says so and never upgrades them
 * to certainty.
 */

export const EVENT_TYPES = [
  'new-subsystem',
  'removed-subsystem',
  'large-refactor',
  'migration',
  'bug-fix',
  'architecture-split',
  'state-model-change',
  'performance-work',
  'new-persistence-layer',
  'api-redesign',
  'testing-strategy-change',
  'security-fix',
  'new-integration',
  'feature-reversal',
  'failed-approach',
  'limitation-discovered',
  'architecture-decision',
  'release',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type EvidenceKind = 'commit' | 'file' | 'test' | 'doc' | 'adr' | 'tag' | 'changelog' | 'benchmark';
export type EvidenceStrength = 'strong' | 'moderate' | 'weak';
export type EventBasis = 'paths' | 'commit-message' | 'docs' | 'tags';

export interface EventEvidence {
  kind: EvidenceKind;
  ref: string;
  note?: string;
}

export interface RepoEvent {
  id: string;
  repositoryId: string;
  type: EventType;
  /** Other types the same change also suggests (e.g. a new module that is also a state-model change). */
  aspects: EventType[];
  dateStart: string;
  dateEnd: string;
  summary: string;
  subsystem?: string;
  files: string[];
  commits: string[];
  evidence: EventEvidence[];
  evidenceStrength: EvidenceStrength;
  strengthReason: string;
  basis: EventBasis;
  /** Words describing the event, used for topic mapping. */
  terms: string[];
  confidenceNote: string;
}

/** When an event happened for display and novelty: a new subsystem counts from its introduction, everything else from its end. */
export function eventDate(e: Pick<RepoEvent, 'type' | 'dateStart' | 'dateEnd'>): string {
  return e.type === 'new-subsystem' ? e.dateStart : e.dateEnd;
}

const KEYWORD_TYPES: Array<[EventType, RegExp]> = [
  ['security-fix', /secur|vulnerab|\bcve\b|xss|csrf|injection|уязвим|безопасн/i],
  ['state-model-change', /\bstate\b|lifecycle|state machine|status model|состояни|жизненн\p{L}* цикл|статус/iu],
  ['new-persistence-layer', /sqlite|postgres|mysql|database|\bstorage\b|persist|хранилищ|\bstore\b/i],
  ['architecture-split', /\bsplit\b|extract\p{L}* (?:into|to)|decouple|separate\p{L}* (?:into|from)|раздел|выдел/iu],
  ['api-redesign', /\bapi\b|interface|endpoint|contract|protocol/i],
  ['new-integration', /integrat|plugin|webhook|adapter|connector|интеграц/i],
  ['limitation-discovered', /limitation|known issue|workaround|ограничени|обход/i],
  ['testing-strategy-change', /test strategy|property-based|e2e|integration tests|snapshot tests|contract tests|тестовая стратеги/i],
];

/** Days a removed module must have lived to count as a removed subsystem rather than a quickly abandoned approach. */
export const FAILED_APPROACH_MAX_DAYS = 90;
const DAY = 86_400_000;

function identifierWords(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_./]+/g, ' ').toLowerCase().trim();
}

function subjectText(subject: string): string {
  return subject.replace(/^\w+(\([^)]*\))?!?:\s*/, '').trim();
}

function scopeOf(subject: string): string | undefined {
  return subject.match(/^\w+\(([^)]+)\)!?:/)?.[1];
}

function strength(signals: Array<[boolean, string]>, basis: EventBasis): { evidenceStrength: EvidenceStrength; strengthReason: string } {
  const present = signals.filter(([ok]) => ok).map(([, why]) => why);
  let level: EvidenceStrength = present.length >= 4 ? 'strong' : present.length >= 2 ? 'moderate' : 'weak';
  // A type read from a commit message is a hint; without code AND tests it stays weak.
  if (basis === 'commit-message' && !(present.includes('source changes') && present.some((p) => p.includes('test')))) level = 'weak';
  return { evidenceStrength: level, strengthReason: present.join(', ') || 'single weak signal' };
}

const CONFIDENCE: Record<EventBasis, string> = {
  paths: 'Derived from files added/removed in git history; the purpose of the change is not verified.',
  'commit-message': 'Event type inferred from the commit message; check the diff before relying on it.',
  docs: 'Derived from a document in the repository; the document may be out of date.',
  tags: 'A version tag marks a boundary only; its content is not inferred.',
};

export function extractEvents(report: ProjectReport): RepoEvent[] {
  const repo = report.projectId;
  const events: RepoEvent[] = [];
  const firstCommitDate = report.commits[0]?.date;
  const testsFor = (name: string) => report.tests.paths.filter((p) => p.includes(`/${name}/`) || path.posix.basename(p).startsWith(`${name}.`) || path.posix.basename(p).startsWith(`${name}-`));
  const docsFor = (name: string) => report.docs.filter((d) => `${d.title ?? ''} ${d.excerpt ?? ''} ${d.path}`.toLowerCase().includes(identifierWords(name)));
  /** Docs that are ABOUT the module (title or path), as opposed to docs that merely mention it. */
  const docsAbout = (name: string) => report.docs.filter((d) => `${d.title ?? ''} ${d.path}`.toLowerCase().includes(identifierWords(name)));
  const moduleCommits = (mod: string) => report.commits.filter((c) => c.modules.includes(mod));
  const claimed = new Map<string, RepoEvent>();
  const id = (type: string, key: string) => `${repo}:${type}:${shortHash(`${type}|${key}`, 10)}`;

  // 1. Subsystems introduced (paths).
  for (const m of report.modules) {
    if (!m.firstSeen) continue;
    const commits = moduleCommits(m.path);
    const intro = commits[0];
    if (!intro) continue;
    const initial = firstCommitDate !== undefined && Date.parse(m.firstSeen) - Date.parse(firstCommitDate) < DAY;
    const fileCount = m.exists ? m.files : intro.pathProfile.added;
    if (fileCount < 2 || initial) continue;
    const tests = testsFor(m.name);
    const docs = docsFor(m.name);
    const s = strength(
      [
        [true, 'source changes'],
        [tests.length > 0, `${tests.length} test file(s)`],
        [docs.length > 0, `${docs.length} doc(s)/ADR(s)`],
        [commits.length >= 2, `${commits.length} commits`],
        [fileCount >= 3, `${fileCount} files`],
      ],
      'paths',
    );
    const ev: RepoEvent = {
      id: id('new-subsystem', m.path),
      repositoryId: repo,
      type: 'new-subsystem',
      aspects: [],
      dateStart: m.firstSeen,
      dateEnd: m.lastChanged ?? m.firstSeen,
      summary: `${m.path} introduced (${subjectText(intro.subject)})`,
      subsystem: m.path,
      files: [m.path],
      commits: commits.slice(0, 8).map((c) => c.shortHash),
      evidence: [{ kind: 'file', ref: m.path }, ...tests.slice(0, 5).map((t) => ({ kind: 'test' as const, ref: t })), ...docs.slice(0, 3).map((d) => ({ kind: (d.kind === 'adr' ? 'adr' : 'doc') as EvidenceKind, ref: d.path })), ...commits.slice(0, 5).map((c) => ({ kind: 'commit' as const, ref: c.shortHash, note: c.subject }))],
      ...s,
      basis: 'paths',
      terms: [identifierWords(m.name), subjectText(intro.subject), ...(scopeOf(intro.subject) ? [scopeOf(intro.subject)!] : []), ...docsAbout(m.name).map((d) => d.title ?? '')].filter(Boolean),
      confidenceNote: CONFIDENCE.paths,
    };
    events.push(ev);
    claimed.set(intro.shortHash, ev);
  }

  // 2. Subsystems removed (paths). A short-lived module is recorded as a failed approach.
  for (const m of report.modules.filter((x) => !x.exists && x.deletedAt)) {
    const commits = moduleCommits(m.path);
    const removal = [...commits].reverse().find((c) => c.pathProfile.deleted > 0) ?? commits.at(-1);
    const lifetimeDays = m.firstSeen && m.deletedAt ? (Date.parse(m.deletedAt) - Date.parse(m.firstSeen)) / DAY : Infinity;
    const type: EventType = lifetimeDays <= FAILED_APPROACH_MAX_DAYS ? 'failed-approach' : 'removed-subsystem';
    const s = strength([[true, 'source changes'], [Boolean(removal?.breaking), 'marked breaking'], [commits.length >= 2, `${commits.length} commits`]], 'paths');
    const ev: RepoEvent = {
      id: id(type, m.path),
      repositoryId: repo,
      type,
      aspects: [],
      dateStart: m.deletedAt!,
      dateEnd: m.deletedAt!,
      summary: `${m.path} removed${removal ? ` (${subjectText(removal.subject)})` : ''}${type === 'failed-approach' ? `, ${Math.round(lifetimeDays)} days after it was introduced` : ''}`,
      subsystem: m.path,
      files: [m.path],
      commits: removal ? [removal.shortHash] : [],
      evidence: [{ kind: 'file', ref: m.path, note: 'no longer in the tree' }, ...(removal ? [{ kind: 'commit' as const, ref: removal.shortHash, note: removal.subject }] : [])],
      ...s,
      basis: 'paths',
      terms: [identifierWords(m.name), ...(removal ? [subjectText(removal.subject)] : [])],
      confidenceNote: CONFIDENCE.paths,
    };
    events.push(ev);
    if (removal) claimed.set(removal.shortHash, ev);
  }

  // 3. Commit-level events (message + paths). Fixes are grouped per subsystem.
  const fixGroups = new Map<string, ReportCommit[]>();
  for (const c of report.commits) {
    if (c.mismatch) continue;
    const text = `${c.subject}\n`;
    let type: EventType | undefined;
    if (c.messageCategory === 'revert') type = 'feature-reversal';
    else if (KEYWORD_TYPES[0]![1].test(text)) type = 'security-fix';
    else if (c.messageCategory === 'migration') type = 'migration';
    else if (c.messageCategory === 'performance') type = 'performance-work';
    else if (c.messageCategory === 'refactor') type = 'large-refactor';
    else if (c.messageCategory === 'fix') {
      const key = c.modules[0] ?? '(root)';
      fixGroups.set(key, [...(fixGroups.get(key) ?? []), c]);
      continue;
    } else if (c.messageCategory === 'feature' || c.breaking) {
      type = KEYWORD_TYPES.slice(1).find(([, re]) => re.test(text))?.[0];
      if (c.breaking && !type) type = 'api-redesign';
    }
    if (!type) continue;
    // Keyword-only types need corroborating paths.
    if (type === 'new-persistence-layer' && c.pathProfile.added === 0) continue;
    if (type === 'testing-strategy-change' && c.pathProfile.tests < 2) continue;
    const owner = claimed.get(c.shortHash);
    if (owner) {
      if (owner.type !== type && !owner.aspects.includes(type)) owner.aspects.push(type);
      continue;
    }
    events.push(commitEvent(repo, type, [c], id));
  }
  for (const [mod, list] of fixGroups) {
    const owner = list.length === 1 ? claimed.get(list[0]!.shortHash) : undefined;
    if (owner) {
      if (!owner.aspects.includes('bug-fix')) owner.aspects.push('bug-fix');
      continue;
    }
    events.push(commitEvent(repo, 'bug-fix', list, id, mod === '(root)' ? undefined : mod));
  }

  // 4. Architecture decisions and benchmarks (docs).
  for (const d of report.docs.filter((x) => x.kind === 'adr')) {
    const date = d.firstCommitDate ?? d.lastCommitDate;
    if (!date) continue;
    events.push({
      id: id('architecture-decision', d.path),
      repositoryId: repo,
      type: 'architecture-decision',
      aspects: [],
      dateStart: date,
      dateEnd: d.lastCommitDate ?? date,
      summary: `ADR: ${d.title ?? d.path}${d.status ? ` (${d.status})` : ''}`,
      files: [d.path],
      commits: [],
      evidence: [{ kind: 'adr', ref: d.path, ...(d.excerpt ? { note: d.excerpt.slice(0, 160) } : {}) }],
      evidenceStrength: 'moderate',
      strengthReason: 'architecture decision record',
      basis: 'docs',
      terms: [d.title ?? '', d.excerpt ?? ''].filter(Boolean),
      confidenceNote: CONFIDENCE.docs,
    });
  }
  const benchmarks = report.docs.filter((x) => x.kind === 'benchmark');
  for (const d of benchmarks) {
    const date = d.lastCommitDate ?? d.firstCommitDate;
    if (!date) continue;
    events.push({
      id: id('performance-work', d.path),
      repositoryId: repo,
      type: 'performance-work',
      aspects: [],
      dateStart: d.firstCommitDate ?? date,
      dateEnd: date,
      summary: `Benchmark material: ${d.title ?? d.path}`,
      files: [d.path],
      commits: [],
      evidence: [{ kind: 'benchmark', ref: d.path }],
      evidenceStrength: 'moderate',
      strengthReason: 'benchmark file in the repository',
      basis: 'docs',
      terms: [d.title ?? 'benchmark', 'performance'],
      confidenceNote: CONFIDENCE.docs,
    });
  }

  // 5. Releases (tags).
  for (const t of report.tags) {
    const cl = report.changelog.find((e) => t.name.replace(/^v/, '') === e.version);
    events.push({
      id: id('release', t.name),
      repositoryId: repo,
      type: 'release',
      aspects: [],
      dateStart: t.date,
      dateEnd: t.date,
      summary: `Release ${t.name}${cl?.items.length ? `: ${cl.items.slice(0, 3).join('; ')}` : ''}`,
      files: [],
      commits: [t.commit],
      evidence: [{ kind: 'tag', ref: t.name }, ...(cl ? [{ kind: 'changelog' as const, ref: `CHANGELOG ${cl.version}` }] : [])],
      evidenceStrength: 'weak',
      strengthReason: 'version boundary only',
      basis: 'tags',
      terms: cl?.items ?? [],
      confidenceNote: CONFIDENCE.tags,
    });
  }

  return sortEvents(events);
}

export function sortEvents<T extends Pick<RepoEvent, 'type' | 'dateStart' | 'dateEnd' | 'id'>>(events: T[]): T[] {
  return events.sort((a, b) => eventDate(a).localeCompare(eventDate(b)) || a.id.localeCompare(b.id));
}

function commitEvent(repo: string, type: EventType, commits: ReportCommit[], id: (type: string, key: string) => string, subsystem?: string): RepoEvent {
  const first = commits[0]!;
  const last = commits.at(-1)!;
  const modules = [...new Set(commits.flatMap((c) => c.modules))];
  const sub = subsystem ?? modules[0];
  const tests = commits.reduce((s, c) => s + c.pathProfile.tests, 0);
  const source = commits.reduce((s, c) => s + c.pathProfile.source, 0);
  const docs = commits.reduce((s, c) => s + c.pathProfile.docs, 0);
  const s = strength(
    [
      [source > 0, 'source changes'],
      [tests > 0, `${tests} test file change(s)`],
      [docs > 0, `${docs} doc change(s)`],
      [commits.length >= 2, `${commits.length} commits`],
      [commits.some((c) => c.breaking), 'marked breaking'],
    ],
    'commit-message',
  );
  const ev: RepoEvent = {
    id: id(type, commits.map((c) => c.shortHash).join(',')),
    repositoryId: repo,
    type,
    aspects: [],
    dateStart: first.date,
    dateEnd: last.date,
    summary: commits.length === 1 ? subjectText(first.subject) : `${commits.length} ${type} commits${sub ? ` in ${sub}` : ''}: ${commits.slice(0, 3).map((c) => subjectText(c.subject)).join('; ')}`,
    files: modules,
    commits: commits.map((c) => c.shortHash),
    evidence: commits.slice(0, 8).map((c) => ({ kind: 'commit' as const, ref: c.shortHash, note: c.subject })),
    ...s,
    basis: 'commit-message',
    terms: [...commits.map((c) => subjectText(c.subject)), ...commits.map((c) => scopeOf(c.subject) ?? ''), ...modules.map((m) => identifierWords(path.posix.basename(m)))].filter(Boolean),
    confidenceNote: CONFIDENCE['commit-message'],
  };
  if (sub) ev.subsystem = sub;
  return ev;
}

/** Test files referenced by an event (for display). */
export function eventTests(ev: RepoEvent): string[] {
  return ev.evidence.filter((e) => e.kind === 'test' || (e.kind === 'file' && TEST_PATH.test(e.ref))).map((e) => e.ref);
}
