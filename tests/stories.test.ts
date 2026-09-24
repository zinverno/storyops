import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildContinuity } from '../src/continuity/build.js';
import { buildPublicationIndex } from '../src/publications/index-builder.js';
import { sortPublications } from '../src/publications/store.js';
import { createStorySkeleton } from '../src/stories/create.js';
import { canonicalStorySchema, type CanonicalStory } from '../src/stories/schema.js';
import { validateStory } from '../src/stories/validate.js';
import { clock, fixtureConfig, fixturePublications, ROOT } from './helpers.js';

async function example(): Promise<CanonicalStory> {
  return canonicalStorySchema.parse(JSON.parse(await readFile(path.join(ROOT, 'examples/canonical-story.example.json'), 'utf8')));
}

describe('canonical story', () => {
  it('the example story is valid and ready for drafting', async () => {
    const v = validateStory(await example());
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(v.readyForDrafting).toBe(true);
  });

  it('blocks drafting when facts lack evidence or plans read as done', async () => {
    const s = await example();
    s.claims.push({ id: 'fake', text: 'Used by 1000 teams', classification: 'verified-fact', evidence: [] });
    s.claims.push({ id: 'plan', text: 'Trend chart is implemented', classification: 'future-plan', evidence: [] });
    s.measurements.push({ what: 'speedup', value: '10', unit: 'x', evidence: [] });
    s.results.push({ text: 'Faster', evidence: [] });
    const v = validateStory(s);
    expect(v.readyForDrafting).toBe(false);
    const messages = v.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('\n');
    expect(messages).toMatch(/verified-fact but has no evidence/);
    expect(messages).toMatch(/worded as if it were implemented/);
    expect(messages).toMatch(/Measurement "speedup: 10" has no evidence/);
    expect(messages).toMatch(/Result "Faster" has no evidence/);
  });

  it('creates a skeleton that continues the last in-depth publication and invents nothing', async () => {
    const pubs = sortPublications(await fixturePublications());
    const continuity = buildContinuity(buildPublicationIndex(pubs, fixtureConfig.projects, clock), fixtureConfig, clock);
    const s = createStorySkeleton({ topic: 'Модель здоровья хранилища', projectId: 'notegarden', continuity, clock });
    expect(s.status).toBe('skeleton');
    expect(s.relationToPreviousPublications.find((r) => r.relation === 'continues')?.publicationId).toBe('habr:900002');
    expect(s.problem).toBe('');
    expect(s.measurements).toEqual([]);
    expect(s.results).toEqual([]);
    expect(s.pending).toEqual(expect.arrayContaining(['problem', 'solution', 'results']));
    expect(validateStory(s).readyForDrafting).toBe(false);
  });
});
