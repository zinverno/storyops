import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureRepo } from '../src/demo/fixture-repo.js';
import { collectEvidence, detectDrift } from '../src/evidence/collect.js';
import { parseRef } from '../src/evidence/refs.js';
import { renderEvidence } from '../src/evidence/render.js';
import { canonicalStorySchema, type CanonicalStory } from '../src/stories/schema.js';
import { clock, FIXTURES, fixturePublications, ROOT, tempDir } from './helpers.js';

describe('evidence references', () => {
  it('parses the reference syntax and rejects path escapes', () => {
    expect(parseRef('src/a.ts')).toEqual({ type: 'file', path: 'src/a.ts' });
    expect(parseRef('src/a.ts#L10-L20')).toEqual({ type: 'file', path: 'src/a.ts', lines: [10, 20] });
    expect(parseRef('src/a.ts#L7')).toEqual({ type: 'file', path: 'src/a.ts', lines: [7, 7] });
    expect(parseRef('commit:abc1234')).toEqual({ type: 'commit', rev: 'abc1234' });
    expect(parseRef('tag:v1.0.0')).toEqual({ type: 'tag', name: 'v1.0.0' });
    expect(parseRef('publication:habr:900002')).toEqual({ type: 'publication', id: 'habr:900002' });
    expect(parseRef('screenshot:01.png')).toEqual({ type: 'screenshot', file: '01.png' });
    expect(parseRef('https://github.com/o/r/pull/1')).toEqual({ type: 'url', url: 'https://github.com/o/r/pull/1' });
    expect(parseRef('../etc/passwd')).toBeUndefined();
    expect(parseRef('/etc/passwd')).toBeUndefined();
  });
});

describe('evidence collection against the fixture repository', () => {
  let tmp: Awaited<ReturnType<typeof tempDir>>;
  let repo: string;
  let base: CanonicalStory;
  beforeAll(async () => {
    tmp = await tempDir();
    repo = path.join(tmp.dir, 'notegarden');
    await buildFixtureRepo(path.join(FIXTURES, 'projects/notegarden/history.json'), repo);
    base = canonicalStorySchema.parse(JSON.parse(await readFile(path.join(ROOT, 'examples/canonical-story.example.json'), 'utf8')));
  }, 60_000);
  afterAll(async () => tmp.cleanup());

  const collect = async (claims: CanonicalStory['claims'], extra: Partial<CanonicalStory> = {}) =>
    collectEvidence({ story: { ...base, evidence: [], technicalDecisions: [], failedOrInsufficientApproaches: [], results: [], claims, ...extra }, storyFile: path.join(tmp.dir, 'articles/x/story.json'), projectRoot: repo, publications: await fixturePublications(), clock });

  it('maps claims to files, line ranges, directories, tags, commits and publications deterministically', async () => {
    const hash = execFileSync('git', ['rev-list', '-n', '1', 'v0.2.0'], { cwd: repo }).toString().trim().slice(0, 7);
    const claims: CanonicalStory['claims'] = [
      { id: 'states', text: 'Lifecycle has three states', classification: 'verified-fact', evidence: ['src/findings/lifecycle.ts#L1-L1', 'tests/findings/lifecycle.test.ts'] },
      { id: 'knowledge', text: 'Knowledge analysis module exists', classification: 'verified-fact', evidence: ['src/knowledge/'] },
      { id: 'release', text: 'Released as 0.2.0', classification: 'verified-fact', evidence: ['tag:v0.2.0', `commit:${hash}`] },
      { id: 'earlier', text: 'The earlier article described a one-off audit', classification: 'verified-fact', evidence: ['publication:habr:900002'] },
    ];
    const a = await collect(claims);
    const b = await collect(claims);
    expect(a.records.map((r) => [r.id, r.kind])).toEqual(b.records.map((r) => [r.id, r.kind]));
    expect(a.claims.every((c) => c.status === 'supported')).toBe(true);
    const byRef = Object.fromEntries(a.records.map((r) => [r.ref, r]));
    expect(byRef['src/findings/lifecycle.ts#L1-L1']).toMatchObject({ kind: 'source-file', locator: { path: 'src/findings/lifecycle.ts', lines: [1, 1] } });
    expect(byRef['src/findings/lifecycle.ts#L1-L1']!.excerpt).toBe("export type FindingState = 'open' | 'acknowledged' | 'resolved';");
    expect(byRef['tests/findings/lifecycle.test.ts']!.kind).toBe('test');
    expect(byRef['src/knowledge/']!.title).toMatch(/directory, 3 files/);
    expect(byRef['tag:v0.2.0']!.kind).toBe('tag');
    expect(byRef[`commit:${hash}`]).toMatchObject({ kind: 'commit', title: 'chore: release 0.2.0' });
    expect(byRef['publication:habr:900002']!.kind).toBe('publication');
    expect(renderEvidence(a)).toMatch(/### Claim: Lifecycle has three states/);
  });

  it('reports missing evidence, broken references and refuses secret paths', async () => {
    const map = await collect([
      { id: 'no-evidence', text: 'Findings move between open and resolved states', classification: 'verified-fact', evidence: [] },
      { id: 'broken', text: 'x', classification: 'verified-fact', evidence: ['src/nope.ts'] },
      { id: 'secret', text: 'y', classification: 'verified-fact', evidence: ['config/credentials.json'] },
      { id: 'plan', text: 'Trend chart', classification: 'future-plan', evidence: [] },
    ]);
    const status = Object.fromEntries(map.claims.map((c) => [c.claimId, c.status]));
    expect(status).toEqual({ 'no-evidence': 'missing-evidence', broken: 'broken-reference', secret: 'broken-reference', plan: 'not-required' });
    expect(map.issues.map((i) => i.message).join('\n')).toMatch(/secret-like path/);
    expect(JSON.stringify(map)).not.toContain('not-a-real-password');
    const suggestions = map.claims.find((c) => c.claimId === 'no-evidence')!.suggestions.map((s) => s.ref);
    expect(suggestions).toContain('src/findings/lifecycle.ts');
  });

  it('detects drift after the evidence changes', async () => {
    const map = await collect([{ id: 'model', text: 'Health model', classification: 'verified-fact', evidence: ['src/health/model.ts'] }]);
    expect(await detectDrift(map, repo)).toEqual([]);
    await writeFile(path.join(repo, 'src/health/model.ts'), '// changed\n');
    expect(await detectDrift(map, repo)).toEqual([{ ref: 'src/health/model.ts', reason: 'content changed since evidence was collected' }]);
  });
});
