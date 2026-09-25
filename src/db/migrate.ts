import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Database } from 'sql.js';
import { StoryOpsError, errorMessage } from '../shared/errors.js';
import { pathExists } from '../shared/fs.js';
import { sha256 } from '../shared/hash.js';

/**
 * Explicit, versioned schema migrations. The schema is never recreated
 * implicitly: every change is a numbered SQL file in src/db/migrations/,
 * applied once, in order, each inside its own transaction, and recorded in
 * `schema_migrations` with a checksum. A migration file that changed after it
 * was applied is an error, not something to paper over.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
  appliedAt: string;
}

const FILE = /^(\d{3})-([a-z0-9-]+)\.sql$/;

/** Finds src/db/migrations from source (tests) or from dist/ (the SQL files ship in the package). */
export function migrationsDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    for (const candidate of [path.join(dir, 'migrations'), path.join(dir, 'src', 'db', 'migrations')]) {
      if (pathExists(path.join(candidate, '001-platform-research.sql'))) return candidate;
    }
    dir = path.dirname(dir);
  }
  throw new StoryOpsError('DB_MIGRATIONS_MISSING', 'Cannot locate src/db/migrations (the SQL migration files).');
}

export function loadMigrations(dir = migrationsDir()): Migration[] {
  const migrations = readdirSync(dir)
    .filter((f) => FILE.test(f))
    .sort()
    .map((file) => {
      const [, version, name] = file.match(FILE)!;
      const sql = readFileSync(path.join(dir, file), 'utf8').replace(/\r\n?/g, '\n');
      return { version: Number(version), name: name!, sql, checksum: sha256(sql) };
    });
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new StoryOpsError('DB_MIGRATIONS_GAP', `Migration versions must be contiguous from 001; found ${String(m.version).padStart(3, '0')} at position ${i + 1}.`);
  });
  return migrations;
}

const BOOKKEEPING = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

export function appliedMigrations(db: Database): AppliedMigration[] {
  db.exec(BOOKKEEPING);
  const result = db.exec('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version');
  return (result[0]?.values ?? []).map(([version, name, checksum, appliedAt]) => ({ version: Number(version), name: String(name), checksum: String(checksum), appliedAt: String(appliedAt) }));
}

export function schemaVersion(db: Database): number {
  return appliedMigrations(db).at(-1)?.version ?? 0;
}

/** What would happen on open: pending migrations, and fatal inconsistencies. */
export function planMigrations(db: Database, migrations: readonly Migration[]): { current: number; pending: Migration[] } {
  const applied = appliedMigrations(db);
  const known = new Map(migrations.map((m) => [m.version, m]));
  for (const a of applied) {
    const m = known.get(a.version);
    if (!m) {
      throw new StoryOpsError('DB_TOO_NEW', `The database has migration ${a.version} (${a.name}), which this StoryOps version does not know (the database was written by a newer StoryOps).`, {
        hint: 'The database was written by a newer StoryOps. Upgrade StoryOps; do not downgrade a database.',
      });
    }
    if (m.checksum !== a.checksum) {
      throw new StoryOpsError('DB_MIGRATION_CHANGED', `Migration ${String(a.version).padStart(3, '0')}-${a.name} changed after it was applied (checksum mismatch).`, {
        hint: 'Applied migrations are immutable. Add a new migration instead of editing an old one.',
      });
    }
  }
  const current = applied.at(-1)?.version ?? 0;
  return { current, pending: migrations.filter((m) => m.version > current) };
}

/**
 * Applies pending migrations, each in its own transaction. On failure the
 * failing migration is rolled back, earlier ones in this call stay applied in
 * memory, and the error names the migration. The caller decides whether to
 * persist (it does not persist after a failure).
 */
export function applyMigrations(db: Database, migrations: readonly Migration[], now: string): AppliedMigration[] {
  const { pending } = planMigrations(db, migrations);
  const applied: AppliedMigration[] = [];
  for (const m of pending) {
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)', [m.version, m.name, m.checksum, now]);
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // the transaction may already be gone; the database is discarded by the caller
      }
      throw new StoryOpsError('DB_MIGRATION_FAILED', `Migration ${String(m.version).padStart(3, '0')}-${m.name} failed and was rolled back: ${errorMessage(error)}`, {
        cause: error,
        hint: 'The database file was not modified. Restore from .storyops/backups/ if needed.',
      });
    }
    applied.push({ version: m.version, name: m.name, checksum: m.checksum, appliedAt: now });
  }
  return applied;
}
