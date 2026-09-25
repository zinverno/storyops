import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createDefaultRegistry } from '../platforms/registry.js';
import { parseAuthorInput, type AuthorInput } from '../src/editorial/author-input.js';
import { authorVoiceRef, storyContentHash, strategyRef, type Provenance } from '../src/editorial/provenance.js';
import type { ResearchSnapshot } from '../src/research/types.js';
import { canonicalStorySchema, type CanonicalStory } from '../src/stories/schema.js';
import { ROOT } from './helpers.js';

export const STYLES_DIR = path.join(ROOT, 'styles');

export function exampleStory(): CanonicalStory {
  return canonicalStorySchema.parse(JSON.parse(readFileSync(path.join(ROOT, 'examples/canonical-story.example.json'), 'utf8')));
}

export const habrStrategy = () => createDefaultRegistry().get('habr').strategy;

export const AUTHOR_INPUT = `---
schemaVersion: 1
story: notegarden-health-model
---

# Author input

## VERBATIM

- "Finding перестал быть просто строкой в отчёте."

## MUST USE

- Объяснить конфликт: отчёт каждый раз строился с нуля.

## SHOULD USE

- Упомянуть, что старые правила переехали в конвейер.

## MAY USE

- Пошутить, что аудит страдал амнезией.

## DO NOT USE

- революционный
`;

export function authorInput(source = AUTHOR_INPUT): AuthorInput {
  return parseAuthorInput(source, { expectedStory: 'notegarden-health-model' });
}

/** A small research snapshot with one moderate observation, one weak one and a saturated angle. */
export function snapshot(): ResearchSnapshot {
  const article = (id: string, title: string) => ({ id, platform: 'habr', url: `https://habr.com/ru/articles/${id}/`, title, hubs: [], tags: [], metrics: {}, seenIn: ['weekly'], warnings: [] });
  return {
    schemaVersion: 1,
    platform: 'habr',
    collectedAt: '2026-09-24T12:00:00.000Z',
    status: 'cache',
    windows: [{ id: 'weekly', period: 'weekly', url: 'https://habr.com/ru/top/weekly/' }],
    filters: { hubs: [], periods: ['weekly'] },
    sampleSize: 3,
    sources: [],
    failures: [],
    articles: [article('habr:1', 'Как мы потеряли данные из-за гонки в очереди задач'), article('habr:2', 'Почему мой кэш врал три месяца подряд'), article('habr:3', 'Нейросеть пишет код за меня')],
    observations: [
      {
        id: 'body-conflict-early',
        statement: 'In the weekly sample, 2 of 2 higher-momentum articles describe a concrete technical problem within the first 150 words, vs 0 of 1 others.',
        metric: 'body-conflict-early',
        sample: { window: 'weekly', size: 3, groupSize: 2, comparisonSize: 1 },
        values: { topShare: 1, restShare: 0 },
        articleIds: ['habr:1', 'habr:2'],
        strength: 'moderate',
        limitations: ['Small sample (N=3); treat as anecdotal.'],
      },
      {
        id: 'median-title-length',
        statement: 'Median title length (characters): 48 among higher-momentum articles vs 30 among others.',
        metric: 'title-length',
        sample: { window: 'weekly', size: 3, groupSize: 2, comparisonSize: 1 },
        values: { topMedian: 48, restMedian: 30 },
        articleIds: ['habr:1', 'habr:2'],
        strength: 'weak',
        limitations: ['Medians describe the sample; they are not targets.'],
      },
    ],
    saturatedAngles: [{ term: 'ai-generic', label: 'AI / LLM / neural networks as the headline topic', share: 0.33, count: 1, sampleSize: 3, exampleArticleIds: ['habr:3'] }],
    limitations: [],
    momentumFormula: 'test',
  };
}

export function provenance(overrides: Partial<Provenance> = {}): Provenance {
  const story = exampleStory();
  const input = authorInput();
  return {
    story: { slug: story.slug, hash: storyContentHash(story) },
    authorInput: { hash: input.sourceHash, items: input.items.length },
    authorProfile: authorVoiceRef(undefined, 'ru-technical', 'ru'),
    style: { id: 'engineering-story', version: '1.0.0', hash: 'h' },
    platformStrategy: strategyRef(habrStrategy()),
    research: { platform: 'habr', collectedAt: '2026-09-24T12:00:00.000Z', file: '.editorial/research/2026-09-24/habr.json', hash: 'r', status: 'cache', sampleSize: 3 },
    ...overrides,
  };
}
