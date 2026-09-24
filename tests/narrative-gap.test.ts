import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildContinuity } from '../src/continuity/build.js';
import { buildFixtureRepo } from '../src/demo/fixture-repo.js';
import { buildNarrativeGap } from '../src/narrative/gap.js';
import { renderNarrativeGap } from '../src/narrative/render.js';
import { inspectProject } from '../src/project/inspect.js';
import type { ProjectReport } from '../src/project/schema.js';
import { buildPublicationIndex } from '../src/publications/index-builder.js';
import { sortPublications } from '../src/publications/store.js';
import { silentLogger } from '../src/shared/logger.js';
import { clock, FIXTURES, fixtureConfig, fixturePublications, tempDir } from './helpers.js';

describe('project inspection and narrative gap (fixture repository)', () => {
  let tmp: Awaited<ReturnType<typeof tempDir>>;
  let report: ProjectReport;
  beforeAll(async () => {
    tmp = await tempDir();
    const repo = path.join(tmp.dir, 'notegarden');
    await buildFixtureRepo(path.join(FIXTURES, 'projects/notegarden/history.json'), repo);
    report = await inspectProject({ projectId: 'notegarden', name: 'Notegarden', root: repo, clock, logger: silentLogger });
  }, 60_000);
  afterAll(async () => tmp.cleanup());

  it('reads history, modules, docs and skips secret paths', () => {
    expect(report.isGitRepository).toBe(true);
    expect(report.commits).toHaveLength(15);
    expect(report.tags.map((t) => t.name)).toEqual(['v0.1.0', 'v0.2.0']);
    expect(report.skippedSecretPaths).toBe(1);
    expect(report.docs.map((d) => d.path)).not.toContain('config/credentials.json');
    const audit = report.modules.find((m) => m.path === 'src/audit')!;
    expect(audit.exists).toBe(false);
    expect(report.docs.find((d) => d.kind === 'adr')).toMatchObject({ status: 'Accepted', title: 'ADR-0003: Persistent health model' });
    expect(report.changelog[0]).toMatchObject({ version: '0.2.0', date: '2025-06-01' });
    expect(report.commits.find((c) => c.subject.startsWith('feat: migrate'))?.messageCategory).toBe('migration');
    // README still points at the removed audit runner: source wins over docs.
    expect(report.warnings.join('\n')).toMatch(/README\.md references `src\/audit\/runner\.ts`/);
  });

  it('reports the new subsystem and the migration as gaps, and covered topics as covered', async () => {
    const pubs = sortPublications(await fixturePublications());
    const continuity = buildContinuity(buildPublicationIndex(pubs, fixtureConfig.projects, clock), fixtureConfig, clock);
    const gap = buildNarrativeGap({ report, continuity, glossary: fixtureConfig.projects[0]!.glossary, clock });

    expect(gap.alreadyCovered.map((a) => a.label)).toEqual(expect.arrayContaining(['project origin / introduction', 'original architecture']));
    // Boundary is the last in-depth publication, not the brief Telegram note.
    expect(gap.boundary.lastPublicationId).toBe('habr:900002');
    const titles = gap.gaps.map((g) => g.title);
    expect(titles).toContain('New subsystem: src/knowledge');
    expect(titles).toContain('New subsystem: src/health');
    expect(gap.gaps.find((g) => g.kind === 'migration')?.coverage).toBe('not-covered');
    // Mentioned briefly on Telegram → still a gap, but marked as mentioned.
    expect(gap.gaps.find((g) => g.title === 'New subsystem: src/findings')?.coverage).toBe('mentioned');
    // The module readers already know about ("report") is not new.
    expect(titles.some((t) => t.includes('src/report'))).toBe(false);
    const arch = gap.gaps[0]!;
    expect(arch.kind).toBe('architecture-evolution');
    expect(arch.strength).toBe('strong');
    expect(renderNarrativeGap(gap)).toMatch(/## Strong narrative gap/);
  });

  it('treats everything as untold when nothing was published yet', async () => {
    const empty = buildContinuity(buildPublicationIndex([], fixtureConfig.projects, clock), fixtureConfig, clock);
    const gap = buildNarrativeGap({ report, continuity: empty, clock });
    expect(gap.boundary.publications).toBe(0);
    expect(gap.gaps.filter((g) => g.kind === 'new-subsystem').length).toBeGreaterThanOrEqual(5);
  });
});
