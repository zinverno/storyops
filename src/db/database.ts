import path from 'node:path';
import { copyFile, readFile, rename, stat, writeFile } from 'node:fs/promises';
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { StoryOpsError } from '../shared/errors.js';
import { ensureDir, pathExists } from '../shared/fs.js';
import { applyMigrations, appliedMigrations, loadMigrations, planMigrations, type AppliedMigration, type Migration } from './migrate.js';

/**
 * The StoryOps intelligence database: one SQLite file (default
 * `.storyops/storyops.db`) that accumulates research runs, the author's
 * archive, repository events, topics and reviews over time.
 *
 * Engine: sql.js (SQLite compiled to WebAssembly). It needs no native build
 * and behaves identically on Node 20 and 22; the file is a regular SQLite
 * database that any sqlite3 tool can open. The database is loaded into memory
 * and written back atomically (temp file + rename) by `save()`. StoryOps is a
 * single-user CLI: run one writing command at a time per workspace.
 */

let sqlPromise: Promise<SqlJsStatic> | undefined;
function sqlJs(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs();
  return sqlPromise;
}

export type Param = string | number | null | undefined | boolean;
export type Row = Record<string, SqlValue>;

export interface OpenOptions {
  clock?: Clock;
  /** Directory for automatic pre-migration backups (default: <db dir>/backups). */
  backupDir?: string;
  /** Override the migration list (tests). */
  migrations?: readonly Migration[];
  /** Open an existing file without migrating it (inspection only; writes are refused). */
  readOnly?: boolean;
}

export interface OpenResult {
  db: StoryDb;
  created: boolean;
  applied: AppliedMigration[];
  backup?: string;
}

const toSql = (p: Param): SqlValue => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p);

export class StoryDb {
  private dirty = false;
  private inTx = false;

  constructor(
    private readonly raw: Database,
    readonly file: string | undefined,
    readonly readOnly = false,
  ) {
    raw.exec('PRAGMA foreign_keys = ON');
  }

  /** All rows of a query as plain objects. */
  all<T = Row>(sql: string, params: readonly Param[] = []): T[] {
    const stmt = this.raw.prepare(sql);
    try {
      stmt.bind(params.map(toSql));
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  get<T = Row>(sql: string, params: readonly Param[] = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  /** Value of the first column of the first row. */
  value<T extends SqlValue = SqlValue>(sql: string, params: readonly Param[] = []): T | undefined {
    const row = this.get<Row>(sql, params);
    return row ? (Object.values(row)[0] as T) : undefined;
  }

  run(sql: string, params: readonly Param[] = []): { changes: number; lastInsertRowid: number } {
    if (this.readOnly) throw new StoryOpsError('DB_READ_ONLY', 'This database was opened read-only.');
    this.raw.run(sql, params.map(toSql));
    this.dirty = true;
    return { changes: this.raw.getRowsModified(), lastInsertRowid: Number(this.value('SELECT last_insert_rowid()') ?? 0) };
  }

  exec(sql: string): void {
    if (this.readOnly) throw new StoryOpsError('DB_READ_ONLY', 'This database was opened read-only.');
    this.raw.exec(sql);
    this.dirty = true;
  }

  /** Runs `fn` in a transaction; any exception rolls everything back. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    if (this.inTx) return fn();
    this.raw.exec('BEGIN');
    this.inTx = true;
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      this.dirty = true;
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    } finally {
      this.inTx = false;
    }
  }

  get hasChanges(): boolean {
    return this.dirty;
  }

  migrations(): AppliedMigration[] {
    return appliedMigrations(this.raw);
  }

  version(): number {
    return this.migrations().at(-1)?.version ?? 0;
  }

  /** Serialised database bytes. sql.js resets pragmas on export, so foreign keys are re-enabled. */
  bytes(): Uint8Array {
    const data = this.raw.export();
    this.raw.exec('PRAGMA foreign_keys = ON');
    return data;
  }

  /** Atomically writes the database to its file (temp file + rename). */
  async save(): Promise<void> {
    if (!this.file) return;
    if (this.readOnly) throw new StoryOpsError('DB_READ_ONLY', 'This database was opened read-only.');
    await writeDbFile(this.file, this.bytes());
    this.dirty = false;
  }

  /** VACUUM rebuilds the file compactly. */
  vacuum(): void {
    this.raw.exec('VACUUM');
    this.dirty = true;
  }

  close(): void {
    this.raw.close();
  }

  /** Low-level handle for migration tooling. */
  get handle(): Database {
    return this.raw;
  }
}

async function writeDbFile(file: string, data: Uint8Array): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

/** In-memory database with the full schema (tests, dry runs). */
export async function openMemoryDatabase(options: Pick<OpenOptions, 'migrations' | 'clock'> = {}): Promise<StoryDb> {
  const SQL = await sqlJs();
  const raw = new SQL.Database();
  raw.exec('PRAGMA foreign_keys = ON');
  applyMigrations(raw, options.migrations ?? loadMigrations(), (options.clock ?? systemClock).now().toISOString());
  return new StoryDb(raw, undefined);
}

/**
 * Opens (or creates) the database file and applies pending migrations.
 * Before migrating an existing file, a copy is written to the backup
 * directory. If a migration fails, the file on disk is left untouched.
 */
export async function openDatabase(file: string, options: OpenOptions = {}): Promise<OpenResult> {
  const SQL = await sqlJs();
  const clock = options.clock ?? systemClock;
  const existed = pathExists(file);
  let raw: Database;
  try {
    raw = existed ? new SQL.Database(await readFile(file)) : new SQL.Database();
    raw.exec('PRAGMA foreign_keys = ON');
    // Touch the schema early so a non-SQLite file fails here with a clear message.
    raw.exec('SELECT count(*) FROM sqlite_master');
  } catch (error) {
    throw new StoryOpsError('DB_UNREADABLE', `${file} is not a readable SQLite database`, { cause: error, hint: 'Restore it from .storyops/backups/, or move it away and run `storyops db rebuild` / re-run research.' });
  }
  if (options.readOnly) {
    if (!existed) throw new StoryOpsError('DB_NOT_FOUND', `No database at ${file}`, { hint: 'Run any research/author/repo command, or `storyops db status`, to create it.' });
    return { db: new StoryDb(raw, file, true), created: false, applied: [] };
  }
  const migrations = options.migrations ?? loadMigrations();
  const { pending, current } = planMigrations(raw, migrations);
  let backup: string | undefined;
  if (existed && pending.length > 0 && current > 0) {
    const stamp = clock.now().toISOString().replace(/[:.]/g, '-');
    backup = path.join(options.backupDir ?? path.join(path.dirname(file), 'backups'), `storyops-v${current}-${stamp}.db`);
    await ensureDir(path.dirname(backup));
    await copyFile(file, backup);
  }
  let applied: AppliedMigration[];
  try {
    applied = applyMigrations(raw, migrations, clock.now().toISOString());
  } catch (error) {
    raw.close();
    throw error;
  }
  const db = new StoryDb(raw, file);
  if (!existed || applied.length > 0) await db.save();
  const result: OpenResult = { db, created: !existed, applied };
  if (backup) result.backup = backup;
  return result;
}

export async function databaseFileSize(file: string): Promise<number | undefined> {
  try {
    return (await stat(file)).size;
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------ JSON helpers

export function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function parseJson<T>(value: SqlValue | undefined, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const num = (v: SqlValue | undefined): number | undefined => (typeof v === 'number' ? v : undefined);
export const str = (v: SqlValue | undefined): string | undefined => (typeof v === 'string' ? v : undefined);
