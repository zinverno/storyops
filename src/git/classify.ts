import type { Commit } from './git.js';

export type CommitCategory = 'feature' | 'fix' | 'refactor' | 'performance' | 'migration' | 'removal' | 'docs' | 'test' | 'build' | 'chore' | 'revert' | 'other';

export interface ClassifiedCommit {
  hash: string;
  shortHash: string;
  date: string;
  subject: string;
  /** Category derived from the commit message. */
  messageCategory: CommitCategory;
  /** What the changed paths actually touch. */
  pathProfile: { source: number; tests: number; docs: number; config: number; added: number; deleted: number };
  /**
   * Set when the message and the changed files disagree (e.g. "feat:" that only
   * touches docs). Source evidence wins; the message is just a hint.
   */
  mismatch?: string;
  breaking: boolean;
}

const CONVENTIONAL = /^(feat|feature|fix|bugfix|refactor|perf|docs|test|tests|chore|build|ci|style|revert)(\([^)]*\))?(!)?:/i;
const MAP: Record<string, CommitCategory> = {
  feat: 'feature', feature: 'feature', fix: 'fix', bugfix: 'fix', refactor: 'refactor', perf: 'performance', docs: 'docs', test: 'test', tests: 'test',
  chore: 'chore', build: 'build', ci: 'build', style: 'chore', revert: 'revert',
};

const KEYWORDS: Array<[CommitCategory, RegExp]> = [
  ['migration', /migrat|миграц|перен[её]с|move (?:to|from)|переход на/i],
  ['removal', /\b(?:remove|delete|drop)\b|удал[ияе]|выпил/i],
  ['performance', /perf|optimi[sz]|speed ?up|faster|ускор|оптимиз/i],
  ['refactor', /refactor|restructur|rewrite|рефактор|переписа|реорганиз/i],
  ['fix', /\bfix|\bbug|исправ|почин/i],
  ['feature', /\badd|implement|introduc|support|добав|реализ|внедр/i],
  ['docs', /\bdocs?\b|readme|документац/i],
  ['test', /\btests?\b|тест/i],
];

export const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/i;
export const DOC_PATH = /(^|\/)(docs?|adr|adrs|decisions)\/|\.(md|mdx|rst|adoc|txt)$/i;
export const CONFIG_PATH = /(^|\/)(package(-lock)?\.json|tsconfig[^/]*\.json|pyproject\.toml|cargo\.toml|go\.mod|dockerfile|docker-compose[^/]*|\.github\/|\.gitlab-ci|makefile|[^/]*\.config\.[a-z]+|\.eslintrc[^/]*|eslint\.config\.[a-z]+)$/i;

export function pathKind(p: string): 'tests' | 'docs' | 'config' | 'source' {
  if (TEST_PATH.test(p)) return 'tests';
  if (DOC_PATH.test(p)) return 'docs';
  if (CONFIG_PATH.test(p)) return 'config';
  return 'source';
}

export function classifyCommit(commit: Commit): ClassifiedCommit {
  const conventional = commit.subject.match(CONVENTIONAL);
  let category: CommitCategory = 'other';
  if (conventional) category = MAP[conventional[1]!.toLowerCase()] ?? 'other';
  // Keyword hints refine generic conventional types (e.g. "feat: migrate storage").
  const keyword = KEYWORDS.find(([, re]) => re.test(commit.subject));
  if (keyword && (category === 'other' || category === 'feature' || category === 'chore') && ['migration', 'removal', 'performance', 'refactor'].includes(keyword[0])) category = keyword[0];
  else if (category === 'other' && keyword) category = keyword[0];

  const profile = { source: 0, tests: 0, docs: 0, config: 0, added: 0, deleted: 0 };
  for (const f of commit.files) {
    const kind = pathKind(f.path);
    profile[kind === 'tests' ? 'tests' : kind === 'docs' ? 'docs' : kind === 'config' ? 'config' : 'source'] += 1;
    if (f.status === 'A') profile.added += 1;
    if (f.status === 'D') profile.deleted += 1;
  }
  const result: ClassifiedCommit = {
    hash: commit.hash,
    shortHash: commit.shortHash,
    date: commit.date,
    subject: commit.subject,
    messageCategory: category,
    pathProfile: profile,
    breaking: Boolean(conventional?.[3]) || /BREAKING CHANGE/.test(commit.body),
  };
  const touchesCode = profile.source > 0;
  if ((category === 'feature' || category === 'refactor' || category === 'performance' || category === 'migration') && !touchesCode && commit.files.length > 0) {
    result.mismatch = `message says "${category}" but only ${profile.docs ? 'docs' : ''}${profile.tests ? ' tests' : ''}${profile.config ? ' config' : ''} changed`;
  }
  if (category === 'removal' && profile.deleted === 0 && commit.files.length > 0) result.mismatch = 'message says removal but no files were deleted';
  return result;
}
