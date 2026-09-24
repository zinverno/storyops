import { describe, expect, it } from 'vitest';
import { buildContinuity, explainedConcepts } from '../src/continuity/build.js';
import { renderContinuityMarkdown } from '../src/continuity/render.js';
import { buildPublicationIndex } from '../src/publications/index-builder.js';
import type { Publication } from '../src/publications/schema.js';
import { sortPublications, dedupePublications } from '../src/publications/store.js';
import { clock, fixtureConfig, fixturePublications } from './helpers.js';

async function build(extra: Publication[] = []) {
  const pubs = sortPublications([...(await fixturePublications()), ...extra]);
  const index = buildPublicationIndex(pubs, fixtureConfig.projects, clock);
  return { index, map: buildContinuity(index, fixtureConfig, clock) };
}

describe('publication index', () => {
  it('derives projects, roles, plans and questions deterministically', async () => {
    const { index } = await build();
    const byId = Object.fromEntries(index.entries.map((e) => [e.publicationId, e]));
    expect(byId['habr:900001']!.projects.values).toEqual(['notegarden']);
    expect(byId['habr:900001']!.roles).toContain('project-introduction');
    expect(byId['habr:900002']!.roles).toContain('architecture');
    expect(byId['habr:900001']!.futurePlans.values.join(' ')).toMatch(/В следующей статье/);
    expect(byId['habr:900002']!.openQuestions.values.join(' ')).toMatch(/Открытый вопрос/);
    expect(byId['telegram:2025-04-12-zhiznennyy-tsikl-nahodok-v-notegarden']!.depth).toBe('brief');
    // Same input → same output.
    const again = buildPublicationIndex(sortPublications(await fixturePublications()), fixtureConfig.projects, clock);
    expect(JSON.stringify(again)).toBe(JSON.stringify(index));
  });
});

describe('continuity map', () => {
  it('orders publications chronologically across platforms', async () => {
    const { map } = await build();
    expect(map.publications.map((p) => p.publicationId)).toEqual(['habr:900001', 'habr:900002', 'telegram:2025-04-12-zhiznennyy-tsikl-nahodok-v-notegarden']);
    const project = map.projects[0]!;
    expect(project.platforms).toEqual(['habr', 'telegram']);
    expect(project.coveredAspects.map((a) => a.aspect)).toEqual(expect.arrayContaining(['project-origin', 'architecture']));
  });

  it('knows which concepts were explained and which were only mentioned briefly', async () => {
    const { map } = await build();
    const concept = (key: string) => map.concepts.find((c) => c.key === key);
    expect(concept('аудит')?.coverage).toBe('explained');
    // Mentioned only in a brief Telegram post: not explained.
    expect(concept('жизненн цикл находок')?.coverage).toBe('mentioned');
    expect(concept('жизненн цикл находок')?.occurrences[0]).toMatchObject({ platform: 'telegram', depth: 'brief' });
    expect(explainedConcepts(map, 'notegarden').map((c) => c.key)).toContain('аудит');
  });

  it('tracks promises: addressed ones vs open threads', async () => {
    const { map } = await build();
    const intro = map.promises.find((p) => p.publication.publicationId === 'habr:900001');
    expect(intro?.status).toBe('possibly-addressed');
    expect(intro?.addressedBy).toBe('habr:900002');
    const open = map.unfinishedThreads.map((t) => t.text).join('\n');
    expect(open).toMatch(/Планирую сделать анализ постоянным/);
  });

  it('flags concepts explained repeatedly', async () => {
    const [first] = await fixturePublications();
    const repeat: Publication = { ...first!, id: 'generic-blog:repeat', platform: 'generic-blog', publicationDate: '2025-06-01T00:00:00.000Z', url: 'https://blog.example/repeat' };
    const { map } = await build([repeat]);
    expect(map.repeatedExplanations.length).toBeGreaterThan(0);
    expect(renderContinuityMarkdown(map)).toMatch(/Explained more than once/);
  });

  it('deduplicates the same publication collected twice', async () => {
    const [first] = await fixturePublications();
    const newer = { ...first!, source: { ...first!.source, collectedAt: '2026-09-25T00:00:00.000Z' } };
    expect(dedupePublications([first!, newer])).toHaveLength(1);
  });
});
