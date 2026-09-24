import { z } from 'zod';

export const PROJECT_REPORT_SCHEMA_VERSION = 1;

const docSchema = z.object({
  path: z.string(),
  kind: z.enum(['readme', 'architecture', 'adr', 'changelog', 'doc', 'benchmark', 'contributing']),
  title: z.string().optional(),
  excerpt: z.string().optional(),
  /** ADR status line when present (Accepted, Superseded...). */
  status: z.string().optional(),
  firstCommitDate: z.string().optional(),
  lastCommitDate: z.string().optional(),
  contentHash: z.string(),
});

const moduleSchema = z.object({
  path: z.string(),
  name: z.string(),
  files: z.number().int(),
  testFiles: z.number().int(),
  firstSeen: z.string().optional(),
  lastChanged: z.string().optional(),
  commits: z.number().int(),
  exists: z.boolean(),
  deletedAt: z.string().optional(),
});
export type ProjectModule = z.infer<typeof moduleSchema>;

const commitSchema = z.object({
  hash: z.string(),
  shortHash: z.string(),
  date: z.string(),
  subject: z.string(),
  messageCategory: z.string(),
  pathProfile: z.object({ source: z.number(), tests: z.number(), docs: z.number(), config: z.number(), added: z.number(), deleted: z.number() }),
  mismatch: z.string().optional(),
  breaking: z.boolean(),
  modules: z.array(z.string()),
});
export type ReportCommit = z.infer<typeof commitSchema>;

export const projectReportSchema = z.object({
  schemaVersion: z.literal(PROJECT_REPORT_SCHEMA_VERSION),
  projectId: z.string(),
  name: z.string(),
  root: z.string(),
  inspectedAt: z.string(),
  head: z.string().optional(),
  isGitRepository: z.boolean(),
  metadata: z.object({
    manifests: z.array(z.object({ path: z.string(), name: z.string().optional(), version: z.string().optional(), description: z.string().optional() })),
  }),
  languages: z.array(z.object({ extension: z.string(), files: z.number().int() })),
  tree: z.array(z.object({ path: z.string(), files: z.number().int() })),
  modules: z.array(moduleSchema),
  docs: z.array(docSchema),
  changelog: z.array(z.object({ version: z.string(), date: z.string().optional(), items: z.array(z.string()) })),
  tests: z.object({ files: z.number().int(), paths: z.array(z.string()), note: z.string() }),
  config: z.array(z.string()),
  tags: z.array(z.object({ name: z.string(), date: z.string(), commit: z.string() })),
  commits: z.array(commitSchema),
  chronology: z.array(z.object({ date: z.string(), kind: z.string(), title: z.string(), ref: z.string() })),
  warnings: z.array(z.string()),
  skippedSecretPaths: z.number().int(),
});
export type ProjectReport = z.infer<typeof projectReportSchema>;
