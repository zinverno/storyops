import path from 'node:path';

/**
 * On-disk layout of a StoryOps workspace.
 *
 *   storyops.config.json
 *   .storyops/storyops.db     the intelligence database (commit it or back it up)
 *   .storyops/cache/          HTTP cache of public pages (never commit)
 *   .storyops/research/       dated research reports (md/json)
 *   .storyops/author/         author coverage, continuity map, profile
 *   .storyops/repos/<id>/     repository inspection and event reports
 *   .storyops/reports/        trend, saturation and pattern reports
 *   .storyops/backups/        automatic database backups before migrations
 *   topics/                   opportunity reports and topic dossiers
 *   reviews/                  read-only review reports
 *
 * There is no article/draft output directory: StoryOps does not write articles.
 */
export interface WorkspacePaths {
  root: string;
  configFile: string;
  dataDir: string;
  dbFile: string;
  cacheDir: string;
  researchDir: string;
  authorDir: string;
  authorProfileJson: string;
  authorProfileMd: string;
  publicationIndex: string;
  continuityJson: string;
  continuityMd: string;
  reposDir: string;
  reportsDir: string;
  backupsDir: string;
  reviewProfilesDir: string;
  topicsDir: string;
  reviewsDir: string;
  /** Legacy v2 directory (.editorial); read-only input for `storyops migrate`. */
  legacyDir: string;
}

export interface WorkspaceOptions {
  configFile?: string;
  dataDir?: string;
  topicsDir?: string;
  reviewsDir?: string;
  legacyDir?: string;
  dbFile?: string;
}

export function resolveWorkspace(root: string, options: WorkspaceOptions = {}): WorkspacePaths {
  const absRoot = path.resolve(root);
  const dataDir = path.resolve(absRoot, options.dataDir ?? '.storyops');
  const authorDir = path.join(dataDir, 'author');
  return {
    root: absRoot,
    configFile: path.resolve(absRoot, options.configFile ?? 'storyops.config.json'),
    dataDir,
    dbFile: path.resolve(absRoot, options.dbFile ?? path.join(dataDir, 'storyops.db')),
    cacheDir: path.join(dataDir, 'cache'),
    researchDir: path.join(dataDir, 'research'),
    authorDir,
    authorProfileJson: path.join(authorDir, 'author-profile.json'),
    authorProfileMd: path.join(authorDir, 'author-profile.md'),
    publicationIndex: path.join(authorDir, 'publication-index.json'),
    continuityJson: path.join(authorDir, 'continuity.json'),
    continuityMd: path.join(authorDir, 'continuity.md'),
    reposDir: path.join(dataDir, 'repos'),
    reportsDir: path.join(dataDir, 'reports'),
    backupsDir: path.join(dataDir, 'backups'),
    reviewProfilesDir: path.join(dataDir, 'review-profiles'),
    topicsDir: path.resolve(absRoot, options.topicsDir ?? 'topics'),
    reviewsDir: path.resolve(absRoot, options.reviewsDir ?? 'reviews'),
    legacyDir: path.resolve(absRoot, options.legacyDir ?? '.editorial'),
  };
}

export function repoDir(workspace: WorkspacePaths, repoId: string): string {
  return path.join(workspace.reposDir, repoId);
}

export function topicDir(workspace: WorkspacePaths, topicId: string): string {
  return path.join(workspace.topicsDir, topicId);
}
