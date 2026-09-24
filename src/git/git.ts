import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EditorialError } from '../shared/errors.js';

const execFileAsync = promisify(execFile);

/**
 * Read-only git access. Only fixed subcommands with explicit arguments are
 * run (no shell), and nothing here writes to the repository.
 */
async function git(cwd: string, args: string[], maxBuffer = 64 * 1024 * 1024): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=off', '--no-pager', ...args], { cwd, maxBuffer, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } });
    return stdout;
  } catch (error) {
    throw new EditorialError('GIT_FAILED', `git ${args[0]} failed in ${cwd}`, { cause: error });
  }
}

export async function gitAvailable(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['--version']);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

export async function isGitRepository(dir: string): Promise<boolean> {
  try {
    return (await git(dir, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
  } catch {
    return false;
  }
}

export async function trackedFiles(dir: string): Promise<string[]> {
  const out = await git(dir, ['ls-files', '-z']);
  return out.split('\0').filter(Boolean).sort();
}

export interface CommitFile {
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U';
  path: string;
  previousPath?: string;
}

export interface Commit {
  hash: string;
  shortHash: string;
  date: string;
  subject: string;
  body: string;
  files: CommitFile[];
}

/** Git prints dates with the author's offset; normalise to UTC ISO so dates compare correctly everywhere. */
function toUtc(date: string): string {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date : d.toISOString();
}

const RS = '\x1e';
const US = '\x1f';

/** Commits in chronological order (oldest first). Author names/emails are deliberately not collected. */
export async function commitLog(dir: string, options: { maxCount?: number; since?: string } = {}): Promise<Commit[]> {
  const args = ['log', '--no-color', '--no-merges', `--max-count=${options.maxCount ?? 2000}`, '--date=iso-strict', `--pretty=format:${RS}%H${US}%h${US}%aI${US}%s${US}%b${US}`, '--name-status', '-M'];
  if (options.since) args.push(`--since=${options.since}`);
  let out: string;
  try {
    out = await git(dir, args);
  } catch {
    return []; // empty repository
  }
  const commits: Commit[] = [];
  for (const chunk of out.split(RS)) {
    if (!chunk.trim()) continue;
    const parts = chunk.split(US);
    const [hash, shortHash, date, subject, body] = parts;
    const fileLines = (parts[5] ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    const files: CommitFile[] = [];
    for (const line of fileLines) {
      const cols = line.split('\t');
      const code = cols[0]?.[0] as CommitFile['status'] | undefined;
      if (!code) continue;
      if ((code === 'R' || code === 'C') && cols.length >= 3) files.push({ status: code, path: cols[2]!, previousPath: cols[1]! });
      else if (cols[1]) files.push({ status: code, path: cols[1] });
    }
    commits.push({ hash: hash!, shortHash: shortHash!, date: toUtc(date!), subject: subject ?? '', body: (body ?? '').trim().slice(0, 2000), files });
  }
  return commits.reverse();
}

export interface Tag {
  name: string;
  date: string;
  commit: string;
}

export async function tags(dir: string): Promise<Tag[]> {
  let out: string;
  try {
    out = await git(dir, ['for-each-ref', '--sort=creatordate', `--format=%(refname:short)${US}%(creatordate:iso-strict)${US}%(objectname:short)`, 'refs/tags']);
  } catch {
    return [];
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, date, commit] = line.split(US);
      return { name: name!, date: toUtc(date!), commit: commit! };
    });
}

export async function headCommit(dir: string): Promise<string | undefined> {
  try {
    return (await git(dir, ['rev-parse', 'HEAD'])).trim();
  } catch {
    return undefined;
  }
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  date: string;
  subject: string;
  files: string[];
}

/** Metadata for a single commit-ish (read-only). Returns undefined if it does not resolve. */
export async function commitInfo(dir: string, rev: string): Promise<CommitInfo | undefined> {
  if (!/^[0-9a-f]{4,40}$/i.test(rev)) return undefined;
  try {
    const out = await git(dir, ['show', '--no-color', '--no-patch', '--date=iso-strict', `--format=%H${US}%h${US}%aI${US}%s`, rev]);
    const files = (await git(dir, ['show', '--no-color', '--pretty=format:', '--name-only', rev])).split('\n').filter(Boolean);
    const [hash, shortHash, date, subject] = out.trim().split(US);
    return { hash: hash!, shortHash: shortHash!, date: toUtc(date!), subject: subject ?? '', files };
  } catch {
    return undefined;
  }
}
