#!/usr/bin/env python3
"""
Generates history.json: a scripted, fictional git history for the "notegarden"
fixture project. The demo and tests replay it with fixed author/committer
dates, so the resulting repository (and its commit hashes) is deterministic.

Run: python3 fixtures/projects/notegarden/generate.py
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
commits = []

def commit(date, message, write=None, delete=None, rename=None, tag=None):
    c = {"date": date, "message": message}
    if write: c["write"] = write
    if delete: c["delete"] = delete
    if rename: c["rename"] = rename
    if tag: c["tag"] = tag
    commits.append(c)

README_V1 = """# Notegarden

Notegarden audits an Obsidian vault: broken links, orphan notes, empty notes and one-off tags.

## Usage

```bash
npx notegarden audit ~/Notes --report notegarden-report.md
```

The audit entry point is `src/audit/runner.ts`.
"""

ARCH_V1 = """# Architecture

Notegarden runs a one-off audit: `src/audit/runner.ts` builds an index of the vault,
`src/audit/rules.ts` checks the index and returns findings, and `src/report/markdown.ts`
renders the report. Nothing is persisted between runs.
"""

ARCH_V2 = """# Architecture

Notegarden keeps a persistent health model of the vault. The analysis pipeline
(`src/analysis/pipeline.ts`) runs rules incrementally, findings have a lifecycle
(`src/findings/lifecycle.ts`), knowledge analysis (`src/knowledge/`) looks at the
structure of the note graph, and everything is stored in SQLite (`src/storage/`).

## Health model

`src/health/model.ts` aggregates open findings into a health score per folder.
Scores are recomputed only for folders whose notes changed.

## Finding lifecycle

A finding moves open → acknowledged → resolved. Acknowledged findings are not
reported again until the note changes.
"""

ADR3 = """# ADR-0003: Persistent health model

## Status

Accepted

## Context

The one-off audit re-ran every rule on every launch and kept no history. It could not
tell a new finding from one the user had already seen and deliberately left, and it
could not show whether the vault was getting better or worse over time.

## Decision

Replace the one-off audit with a persistent health model: findings are stored in SQLite
with a lifecycle (open, acknowledged, resolved), and a health score is recomputed
incrementally for changed folders.

## Consequences

- The report can show trends and hide acknowledged findings.
- SQLite adds a migration step (`src/storage/migrations/`).
- The store is single-process: running two analyses on the same vault at once is not supported.
"""

CHANGELOG = """# Changelog

## [0.2.0] - 2025-06-01

- Persistent health model with per-folder scores.
- Finding lifecycle: open, acknowledged, resolved.
- Knowledge analysis: orphan clusters and stale links.
- Reports are stored in SQLite instead of JSON files.
- Removed the one-off audit runner.

## [0.1.0] - 2025-01-28

- One-off audit with four rules and a markdown report.
"""

PKG = lambda v: json.dumps({"name": "notegarden", "version": v, "description": "Keeps an Obsidian vault healthy: finds broken links, orphan notes and structural problems.", "type": "module", "scripts": {"test": "node --test"}}, indent=2) + "\n"

commit("2025-01-10T10:00:00+03:00", "Initial commit: project skeleton", write={
    "README.md": README_V1, "package.json": PKG("0.0.1"),
    "src/index.ts": "export { runAudit } from './audit/runner.js';\n",
    "config/credentials.json": '{ "note": "fixture file to exercise secret-path skipping; not a real credential", "password": "not-a-real-password" }\n',
})
commit("2025-01-15T12:00:00+03:00", "feat: one-off audit of a notes vault", write={
    "src/audit/runner.ts": "import { rules } from './rules.js';\nimport { buildIndex } from './index-builder.js';\n\nexport async function runAudit(vault: string) {\n  const index = await buildIndex(vault);\n  return rules.flatMap((rule) => rule.check(index));\n}\n",
    "src/audit/index-builder.ts": "export async function buildIndex(vault: string) {\n  return { vault, notes: [] as Array<{ path: string; incoming: string[] }> };\n}\n",
    "src/audit/rules.ts": "export const rules = [\n  { id: 'orphan-note', check: (index: { notes: Array<{ path: string; incoming: string[] }> }) => index.notes.filter((n) => n.incoming.length === 0) },\n];\n",
    "src/report/markdown.ts": "export function renderReport(findings: unknown[]): string {\n  return `# Notegarden report\\n\\n${findings.length} findings\\n`;\n}\n",
})
commit("2025-01-20T12:00:00+03:00", "test: audit rules", write={
    "tests/audit/rules.test.ts": "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { rules } from '../../src/audit/rules.js';\n\ntest('orphan rule', () => {\n  assert.equal(rules[0].check({ notes: [{ path: 'a.md', incoming: [] }] }).length, 1);\n});\n",
})
commit("2025-01-25T12:00:00+03:00", "docs: architecture overview", write={"docs/ARCHITECTURE.md": ARCH_V1})
commit("2025-01-28T12:00:00+03:00", "chore: release 0.1.0", write={"package.json": PKG("0.1.0")}, tag="v0.1.0")

# --- publications on Habr: 2025-02-03 (introduction) and 2025-03-10 (architecture) ---

commit("2025-04-02T12:00:00+03:00", "feat: persistent health model for the vault", write={
    "src/health/model.ts": "export interface FolderHealth { folder: string; score: number; openFindings: number }\n\nexport function folderHealth(folder: string, openFindings: number, notes: number): FolderHealth {\n  const score = notes === 0 ? 100 : Math.max(0, Math.round(100 - (openFindings / notes) * 100));\n  return { folder, score, openFindings };\n}\n",
    "src/health/score.ts": "import { folderHealth } from './model.js';\n\nexport function recompute(changed: Array<{ folder: string; open: number; notes: number }>) {\n  return changed.map((c) => folderHealth(c.folder, c.open, c.notes));\n}\n",
    "tests/health/model.test.ts": "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { folderHealth } from '../../src/health/model.js';\n\ntest('score drops with open findings', () => {\n  assert.equal(folderHealth('inbox', 5, 10).score, 50);\n});\n",
})
commit("2025-04-10T12:00:00+03:00", "feat(findings): finding lifecycle (open -> acknowledged -> resolved)", write={
    "src/findings/lifecycle.ts": "export type FindingState = 'open' | 'acknowledged' | 'resolved';\n\nconst allowed: Record<FindingState, FindingState[]> = {\n  open: ['acknowledged', 'resolved'],\n  acknowledged: ['open', 'resolved'],\n  resolved: ['open'],\n};\n\nexport function transition(from: FindingState, to: FindingState): FindingState {\n  if (!allowed[from].includes(to)) throw new Error(`invalid transition ${from} -> ${to}`);\n  return to;\n}\n",
    "src/findings/store.ts": "import type { FindingState } from './lifecycle.js';\n\nexport interface StoredFinding { id: string; rule: string; note: string; state: FindingState; firstSeen: string }\n",
    "tests/findings/lifecycle.test.ts": "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { transition } from '../../src/findings/lifecycle.js';\n\ntest('acknowledged findings can be resolved', () => {\n  assert.equal(transition('acknowledged', 'resolved'), 'resolved');\n});\n\ntest('resolved cannot become acknowledged directly', () => {\n  assert.throws(() => transition('resolved', 'acknowledged'));\n});\n",
})
commit("2025-04-18T12:00:00+03:00", "refactor: turn one-off audit into incremental analysis pipeline", write={
    "src/analysis/pipeline.ts": "export interface Rule { id: string; check(index: unknown): unknown[] }\n\nexport function runIncremental(rules: Rule[], changedIndex: unknown) {\n  return rules.flatMap((rule) => rule.check(changedIndex));\n}\n",
    "src/index.ts": "export { runIncremental } from './analysis/pipeline.js';\nexport { runAudit } from './audit/runner.js';\n",
})
commit("2025-04-25T12:00:00+03:00", "feat(knowledge): knowledge analysis of the note graph", write={
    "src/knowledge/orphans.ts": "export function orphanClusters(edges: Array<[string, string]>, notes: string[]): string[][] {\n  const linked = new Set(edges.flat());\n  return notes.filter((n) => !linked.has(n)).map((n) => [n]);\n}\n",
    "src/knowledge/links.ts": "export function staleLinks(links: Array<{ from: string; to: string }>, existing: Set<string>) {\n  return links.filter((l) => !existing.has(l.to));\n}\n",
    "src/knowledge/graph.ts": "export type Edge = [from: string, to: string];\n",
    "tests/knowledge/orphans.test.ts": "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { orphanClusters } from '../../src/knowledge/orphans.js';\n\ntest('isolated note is an orphan cluster', () => {\n  assert.deepEqual(orphanClusters([], ['a.md']), [['a.md']]);\n});\n",
})
commit("2025-05-05T12:00:00+03:00", "feat: migrate reports from JSON files to SQLite store", write={
    "src/storage/sqlite.ts": "export interface Store { saveFindings(findings: unknown[]): void }\n\nexport function openStore(file: string): Store {\n  void file;\n  return { saveFindings: () => undefined };\n}\n",
    "src/storage/migrations/001-initial.sql": "CREATE TABLE findings (id TEXT PRIMARY KEY, rule TEXT NOT NULL, note TEXT NOT NULL, state TEXT NOT NULL, first_seen TEXT NOT NULL);\n",
    "tests/storage/migrations.test.ts": "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { readFileSync } from 'node:fs';\n\ntest('initial migration creates findings table', () => {\n  assert.match(readFileSync('src/storage/migrations/001-initial.sql', 'utf8'), /CREATE TABLE findings/);\n});\n",
})
commit("2025-05-12T12:00:00+03:00", "refactor!: remove one-off audit runner", delete=["src/audit/runner.ts", "src/audit/index-builder.ts", "tests/audit/rules.test.ts"], rename=[["src/audit/rules.ts", "src/analysis/rules.ts"]], write={
    "src/index.ts": "export { runIncremental } from './analysis/pipeline.js';\n",
})
commit("2025-05-20T12:00:00+03:00", "docs: ADR-0003 persistent health model", write={"docs/adr/0003-persistent-health-model.md": ADR3, "docs/ARCHITECTURE.md": ARCH_V2})
commit("2025-05-30T12:00:00+03:00", "docs: changelog for 0.2.0", write={"CHANGELOG.md": CHANGELOG})
commit("2025-06-01T12:00:00+03:00", "chore: release 0.2.0", write={"package.json": PKG("0.2.0")}, tag="v0.2.0")
commit("2025-06-10T12:00:00+03:00", "fix: stale link detection on renamed notes", write={
    "src/knowledge/links.ts": "export function staleLinks(links: Array<{ from: string; to: string }>, existing: Set<string>, renamed = new Map<string, string>()) {\n  return links.filter((l) => !existing.has(renamed.get(l.to) ?? l.to));\n}\n",
})

ADR4 = """# ADR-0004: Reconciliation receipts

## Status

Accepted

## Context

After a restart, the analysis rebuilt findings from the vault and matched them to stored
findings by rule and note path. A finding the user had resolved could come back as open
when the note was renamed in between, because nothing recorded what the last analysis
had actually seen.

## Decision

Every analysis run writes a reconciliation receipt: which notes it saw, with content
hashes, and which stored findings it confirmed, resolved or left untouched. On the next
run, stored findings are reconciled against the last receipt before new findings are
added.

## Consequences

- Resolved findings survive restarts and renames.
- Freshness is only checked when an analysis runs; between runs a finding can be stale.
- Receipts add one table (`src/storage/migrations/002-receipts.sql`).
"""

# --- after a long pause: reconciliation (2026) ---
commit("2026-08-05T12:00:00+03:00", "feat(reconciliation): reconciliation receipts for persisted findings", write={
    "src/reconciliation/receipts.ts": "export interface Receipt { runId: string; seen: Record<string, string>; confirmed: string[]; resolved: string[] }\n\nexport function receiptFor(runId: string, seen: Map<string, string>): Receipt {\n  return { runId, seen: Object.fromEntries(seen), confirmed: [], resolved: [] };\n}\n",
    "src/reconciliation/reconcile.ts": "import type { Receipt } from './receipts.js';\n\nexport function reconcile(stored: Array<{ id: string; note: string; state: string }>, last: Receipt | undefined) {\n  if (!last) return stored;\n  return stored.map((f) => (f.state === 'resolved' && !(f.note in last.seen) ? f : f));\n}\n",
    "src/storage/migrations/002-receipts.sql": "CREATE TABLE receipts (run_id TEXT PRIMARY KEY, seen TEXT NOT NULL, created_at TEXT NOT NULL);\n",
    "tests/reconciliation/receipts.test.ts": "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { receiptFor } from '../../src/reconciliation/receipts.js';\n\ntest('receipt records seen notes', () => {\n  assert.deepEqual(Object.keys(receiptFor('r1', new Map([['a.md', 'h1']])).seen), ['a.md']);\n});\n",
})
commit("2026-08-07T12:00:00+03:00", "docs: ADR-0004 reconciliation receipts", write={"docs/adr/0004-reconciliation-receipts.md": ADR4})
commit("2026-08-12T12:00:00+03:00", "fix(reconciliation): resolved findings reappeared as open after a restart", write={
    "src/reconciliation/reconcile.ts": "import type { Receipt } from './receipts.js';\n\nexport function reconcile(stored: Array<{ id: string; note: string; state: string }>, last: Receipt | undefined, renamed = new Map<string, string>()) {\n  if (!last) return stored;\n  return stored.map((f) => ({ ...f, note: renamed.get(f.note) ?? f.note }));\n}\n",
    "tests/reconciliation/restart.test.ts": "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { reconcile } from '../../src/reconciliation/reconcile.js';\n\ntest('resolved finding stays resolved after a rename and a restart', () => {\n  const out = reconcile([{ id: 'f1', note: 'old.md', state: 'resolved' }], { runId: 'r1', seen: { 'old.md': 'h' }, confirmed: [], resolved: ['f1'] }, new Map([['old.md', 'new.md']]));\n  assert.equal(out[0]!.state, 'resolved');\n});\n",
})

with open(os.path.join(HERE, 'history.json'), 'w', encoding='utf-8') as f:
    json.dump({"comment": "Fictional scripted history for the notegarden fixture project. Replayed by src/demo/fixture-repo.ts.", "author": {"name": "Fixture Author", "email": "fixture@example.invalid"}, "commits": commits}, f, ensure_ascii=False, indent=2)
    f.write('\n')
print('ok', len(commits))
