import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCoverageMap } from '../src/author/coverage.js';
import { parseConfig } from '../src/config/load.js';
import { openMemoryDatabase, type StoryDb } from '../src/db/database.js';
import { buildFixtureRepo } from '../src/demo/fixture-repo.js';
import { DEMO_CONFIG } from '../src/demo/run.js';
import { candidateForQuery, discoverOpportunities, DISCOVERY_METHOD, NOTICE, opportunityMatrix, type DiscoveryInput } from '../src/opportunity/discover.js';
import { renderDossier, renderOpportunityReport } from '../src/opportunity/render.js';
import { OPPORTUNITY_SCHEMA_VERSION, type OpportunityReport } from '../src/opportunity/types.js';
import { inspectProject } from '../src/project/inspect.js';
import { extractEvents, type RepoEvent } from '../src/repo/events.js';
import { ensureRepository, mapRepositoryTopics, recordSnapshot, repositoryTopicMap, storeEvents } from '../src/repo/store.js';
import { silentLogger } from '../src/shared/logger.js';
import { loadTopics, syncTopics, workspaceTopics } from '../src/topics/registry.js';
import { clock, FIXTURES, fixturePublications, tempDir } from './helpers.js';

/**
 * Fixture repository (fixtures/projects/notegarden): old architecture (src/audit,
 * later removed), new subsystems (health, findings, knowledge, storage,
 * reconciliation), a refactor (analysis pipeline) and bug fixes. The author's
 * archive (two Habr articles and a Telegram note) covers the old architecture.
 */
describe('repository intelligence and topic opportunities', () => {
  let cleanup: () => Promise<void>;
  let db: StoryDb;
  let events: RepoEvent[];
  let input: DiscoveryInput;

  beforeAll(async () => {
    const tmp = await tempDir('storyops-repo-');
    cleanup = tmp.cleanup;
    const repo = path.join(tmp.dir, 'notegarden');
    await buildFixtureRepo(path.join(FIXTURES, 'projects/notegarden/history.json'), repo);
    const config = parseConfig(DEMO_CONFIG);
    db = await openMemoryDatabase({ clock });
    const now = clock.now().toISOString();
    syncTopics(db, workspaceTopics(config), now);
    const report = await inspectProject({ projectId: 'notegarden', name: 'Notegarden', root: repo, clock, logger: silentLogger });
    events = extractEvents(report);
    ensureRepository(db, { id: 'notegarden', name: 'Notegarden', path: repo }, now);
    storeEvents(db, events, recordSnapshot(db, report).snapshotId, now);
    mapRepositoryTopics(db, 'notegarden', events, workspaceTopics(config), now);
    const topics = loadTopics(db);
    const repoTopics = repositoryTopicMap(db, 'notegarden', topics);
    const publications = await fixturePublications();
    const latest = new Map(repoTopics.map((rt) => [rt.topicId, rt.lastEventAt]));
    const coverage = buildCoverageMap(publications, topics, { now: clock.now(), outdatedAfterDays: 730, latestRepoChange: latest });
    input = { repo: { id: 'notegarden', name: 'Notegarden' }, repoTopics, topics, coverage, publications, now: clock.now() };
  }, 60_000);
  afterAll(async () => cleanup?.());

  it('extracts engineering events with type, dates, files, commits, evidence and strength', () => {
    const byType = (type: string, sub?: string) => events.filter((e) => e.type === type && (!sub || e.subsystem === sub));
    expect(byType('new-subsystem', 'src/reconciliation')).toHaveLength(1);
    expect(byType('new-subsystem', 'src/reconciliation')[0]).toMatchObject({ evidenceStrength: 'strong', basis: 'paths' });
    expect(byType('removed-subsystem', 'src/audit')).toHaveLength(1);
    expect(byType('bug-fix', 'src/reconciliation')[0]).toMatchObject({ basis: 'commit-message', summary: 'resolved findings reappeared as open after a restart' });
    expect(byType('bug-fix', 'src/knowledge')[0]!.evidenceStrength).toBe('weak'); // message only: never upgraded
    expect(events.find((e) => e.subsystem === 'src/analysis')?.aspects).toContain('large-refactor');
    expect(events.find((e) => e.subsystem === 'src/findings')?.aspects).toContain('state-model-change');
    expect(byType('architecture-decision').map((e) => e.summary)).toEqual(expect.arrayContaining([expect.stringMatching(/ADR-0004/)]));
    for (const e of events) {
      expect(e.id).toMatch(/^notegarden:/);
      expect(e.confidenceNote.length).toBeGreaterThan(10);
      expect(e.evidence.some((x) => /credentials/.test(x.ref))).toBe(false); // secret-like paths are never evidence
    }
  });

  it('maps events to the project glossary topics', () => {
    const map = repositoryTopicMap(db, 'notegarden', loadTopics(db));
    const reconciliation = map.find((t) => t.topicId === 'reconciliation')!;
    expect(reconciliation.types).toEqual(expect.arrayContaining(['new-subsystem', 'bug-fix', 'architecture-decision']));
    expect(map.find((t) => t.topicId === 'audit')?.types).toContain('removed-subsystem');
  });

  it('new subsystems and the bug fix are novel; the old architecture overlaps the archive', () => {
    const candidates = discoverOpportunities(input);
    const by = (id: string) => candidates.find((c) => c.id === id)!;
    const reconciliation = by('reconciliation');
    expect(reconciliation.dimensions.repositoryNovelty.level).toBe('high');
    expect(reconciliation.dimensions.authorOverlap.level).toBe('none');
    expect(reconciliation.repository!.events.map((e) => e.type)).toEqual(expect.arrayContaining(['new-subsystem', 'bug-fix']));
    expect(reconciliation.whyTechnicallyInteresting.join(' ')).toMatch(/concrete failure and its fix/);
    expect(by('health-model').dimensions.repositoryNovelty.level).toBe('high');
    const audit = by('audit');
    expect(audit.dimensions.authorOverlap.level).toBe('high');
    expect(audit.author.alreadyCovered.join('\n')).toMatch(/Как устроен Notegarden: разовый аудит заметок изнутри/);
    expect(audit.author.coverageText).toMatch(/possibly outdated/);
  });

  it('keeps every dimension separate, lists candidates alphabetically and never ranks', () => {
    const candidates = discoverOpportunities(input);
    const labels = candidates.map((c) => c.topic.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    for (const c of candidates) {
      expect(Object.keys(c.dimensions).sort()).toEqual(['authorOverlap', 'evidenceStrength', 'platformActivity', 'recency', 'repositoryNovelty', 'saturation', 'technicalSpecificity', 'trendDirection']);
      expect(c).not.toHaveProperty('score');
      expect(c).not.toHaveProperty('rank');
      expect(c.dimensions.platformActivity.level).toBe('unknown'); // no platform in this input
    }
    const report: OpportunityReport = { schemaVersion: OPPORTUNITY_SCHEMA_VERSION, generatedAt: clock.now().toISOString(), repository: { id: 'notegarden', name: 'Notegarden' }, platform: null, author: { publications: 3 }, method: DISCOVERY_METHOD, notice: NOTICE, matrix: opportunityMatrix(candidates), candidates, limitations: [] };
    const md = renderOpportunityReport(report);
    expect(md).toMatch(/No ranking|does not choose topics/);
    expect(md).not.toMatch(/best topic|you should write|#1\b|recommended topic/i);
  });

  it('opportunity reports carry evidence, overlap, platform context and unknowns, but no article prose', () => {
    const c = discoverOpportunities(input).find((x) => x.id === 'reconciliation')!;
    expect(c.repository!.events.every((e) => e.evidence.length > 0)).toBe(true);
    expect(c.author.coverageText).toBe('not covered');
    expect(c.unknowns.join(' ')).toMatch(/No benchmark or measurement files/);
    expect(c.questions.join(' ')).toMatch(/discovered: in daily use, by a user, or only through tests/);
    expect(c.possibleDirections.every((d) => d.startsWith('Possible direction (for the author to decide):'))).toBe(true);
    const md = renderDossier({ schemaVersion: 1, generatedAt: clock.now().toISOString(), candidate: c, notice: 'no narrative plan' });
    // A dossier lists facts and questions. It contains no article body: no paragraphs of prose, no title suggestion.
    expect(md).not.toMatch(/^# (?!Topic dossier)/m);
    expect(md).not.toMatch(/suggested title|draft|introduction:/i);
  });

  it('free-text candidates: a generic AI angle has no repository novelty', () => {
    const generic = candidateForQuery(input, 'generic AI plugin');
    expect(generic.topic.specificity).toBe('generic');
    expect(generic.dimensions.repositoryNovelty.level).toBe('low');
    expect(generic.dimensions.technicalSpecificity.level).toBe('low');
    const known = candidateForQuery(input, 'reconciliation receipts');
    expect(known.topic.id).toBe('reconciliation');
  });
});
