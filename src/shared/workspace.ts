import path from 'node:path';

/**
 * Resolves the on-disk layout of an editorial workspace.
 *
 *   .editorial/            durable author memory + volatile research state
 *   articles/<slug>/       one canonical story and all of its outputs
 */
export interface WorkspacePaths {
  root: string;
  configFile: string;
  editorialDir: string;
  authorProfileJson: string;
  authorProfileMd: string;
  publicationsDir: string;
  publicationIndex: string;
  continuityJson: string;
  continuityMd: string;
  researchDir: string;
  cacheDir: string;
  storiesIndex: string;
  projectsDir: string;
  articlesDir: string;
}

export function resolveWorkspace(root: string, options: { configFile?: string; editorialDir?: string; articlesDir?: string } = {}): WorkspacePaths {
  const absRoot = path.resolve(root);
  const editorialDir = path.resolve(absRoot, options.editorialDir ?? '.editorial');
  const articlesDir = path.resolve(absRoot, options.articlesDir ?? 'articles');
  return {
    root: absRoot,
    configFile: path.resolve(absRoot, options.configFile ?? 'editorial.config.json'),
    editorialDir,
    authorProfileJson: path.join(editorialDir, 'author-profile.json'),
    authorProfileMd: path.join(editorialDir, 'author-profile.md'),
    publicationsDir: path.join(editorialDir, 'publications'),
    publicationIndex: path.join(editorialDir, 'publications', 'index.json'),
    continuityJson: path.join(editorialDir, 'continuity.json'),
    continuityMd: path.join(editorialDir, 'continuity.md'),
    researchDir: path.join(editorialDir, 'research'),
    cacheDir: path.join(editorialDir, 'cache'),
    storiesIndex: path.join(editorialDir, 'stories', 'index.json'),
    projectsDir: path.join(editorialDir, 'projects'),
    articlesDir,
  };
}

export interface ArticlePaths {
  dir: string;
  story: string;
  briefMd: string;
  briefJson: string;
  evidenceMd: string;
  evidenceJson: string;
  researchDir: string;
  imagesOriginals: string;
  imagesOutputs: string;
  imageManifest: string;
  screenshotPlan: string;
  screenshotPlanMd: string;
  outputsDir: string;
  output(platformId: string): string;
  imageOutputs(platformId: string): string;
}

export function articlePaths(workspace: WorkspacePaths, slug: string): ArticlePaths {
  const dir = path.join(workspace.articlesDir, slug);
  return {
    dir,
    story: path.join(dir, 'story.json'),
    briefMd: path.join(dir, 'brief.md'),
    briefJson: path.join(dir, 'brief.json'),
    evidenceMd: path.join(dir, 'evidence.md'),
    evidenceJson: path.join(dir, 'evidence.json'),
    researchDir: path.join(dir, 'research'),
    imagesOriginals: path.join(dir, 'images', 'originals'),
    imagesOutputs: path.join(dir, 'images', 'outputs'),
    imageManifest: path.join(dir, 'images', 'manifest.json'),
    screenshotPlan: path.join(dir, 'screenshot-plan.json'),
    screenshotPlanMd: path.join(dir, 'screenshot-plan.md'),
    outputsDir: path.join(dir, 'outputs'),
    output: (platformId) => path.join(dir, 'outputs', `${platformId}.md`),
    imageOutputs: (platformId) => path.join(dir, 'images', 'outputs', platformId),
  };
}

/** Derives the article slug from a story file path (articles/<slug>/story.json). */
export function slugFromStoryPath(storyPath: string): string {
  return path.basename(path.dirname(path.resolve(storyPath)));
}
