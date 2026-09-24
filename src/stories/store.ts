import path from 'node:path';
import { z } from 'zod';
import { readJson, readJsonIfExists, writeJson } from '../shared/fs.js';
import type { WorkspacePaths } from '../shared/workspace.js';
import { canonicalStorySchema, type CanonicalStory } from './schema.js';

const storiesIndexSchema = z.object({
  schemaVersion: z.literal(1),
  stories: z.array(z.object({ slug: z.string(), topic: z.string(), project: z.string(), path: z.string(), status: z.string(), updatedAt: z.string(), outputs: z.array(z.string()) })),
});

export async function loadStory(file: string): Promise<CanonicalStory> {
  return readJson(file, canonicalStorySchema);
}

/** Saves the story and updates `.editorial/stories/index.json` (a registry, not a second copy). */
export async function saveStory(workspace: WorkspacePaths, file: string, story: CanonicalStory): Promise<void> {
  await writeJson(file, canonicalStorySchema.parse(story));
  const index = (await readJsonIfExists(workspace.storiesIndex, storiesIndexSchema)) ?? { schemaVersion: 1 as const, stories: [] };
  const entry = {
    slug: story.slug,
    topic: story.topic,
    project: story.project,
    path: path.relative(workspace.root, file).split(path.sep).join('/'),
    status: story.status,
    updatedAt: story.updatedAt,
    outputs: story.outputs.map((o) => o.platform),
  };
  index.stories = [...index.stories.filter((s) => s.slug !== story.slug), entry].sort((a, b) => a.slug.localeCompare(b.slug));
  await writeJson(workspace.storiesIndex, index);
}
