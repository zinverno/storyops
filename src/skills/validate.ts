import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { parseFrontmatter } from '../shared/frontmatter.js';
import { pathExists } from '../shared/fs.js';

/**
 * Validates skills against the Agent Skills specification
 * (https://agentskills.io/specification):
 * - SKILL.md with YAML frontmatter
 * - name: 1–64 chars, [a-z0-9-], no leading/trailing/consecutive hyphens, equals the directory name
 * - description: 1–1024 chars
 * - compatibility: ≤500 chars; metadata: string→string map; allowed-tools: string
 * - body recommended < 500 lines; file references one level deep and existing
 */
export const SPEC_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);

export interface SkillIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface SkillReport {
  dir: string;
  name?: string;
  issues: SkillIssue[];
}

export async function validateSkill(dir: string): Promise<SkillReport> {
  const issues: SkillIssue[] = [];
  const report: SkillReport = { dir, issues };
  const file = path.join(dir, 'SKILL.md');
  if (!pathExists(file)) {
    issues.push({ severity: 'error', message: 'SKILL.md is missing' });
    return report;
  }
  const source = await readFile(file, 'utf8');
  let doc;
  try {
    doc = parseFrontmatter(source);
  } catch (error) {
    issues.push({ severity: 'error', message: `frontmatter is not valid YAML: ${String(error)}` });
    return report;
  }
  if (!doc.hasFrontmatter) {
    issues.push({ severity: 'error', message: 'SKILL.md must start with YAML frontmatter (---)' });
    return report;
  }
  const fm = doc.data;
  const name = fm.name;
  if (typeof name !== 'string' || name.length === 0) issues.push({ severity: 'error', message: 'name is required' });
  else {
    report.name = name;
    if (name.length > 64) issues.push({ severity: 'error', message: 'name must be at most 64 characters' });
    if (!/^[a-z0-9-]+$/.test(name)) issues.push({ severity: 'error', message: 'name may only contain lowercase letters, digits and hyphens' });
    if (name.startsWith('-') || name.endsWith('-')) issues.push({ severity: 'error', message: 'name must not start or end with a hyphen' });
    if (name.includes('--')) issues.push({ severity: 'error', message: 'name must not contain consecutive hyphens' });
    if (name !== path.basename(dir)) issues.push({ severity: 'error', message: `name "${name}" must match the directory name "${path.basename(dir)}"` });
  }
  const description = fm.description;
  if (typeof description !== 'string' || description.trim().length === 0) issues.push({ severity: 'error', message: 'description is required' });
  else if (description.length > 1024) issues.push({ severity: 'error', message: `description is ${description.length} characters (max 1024)` });
  if (fm.compatibility !== undefined && (typeof fm.compatibility !== 'string' || fm.compatibility.length === 0 || fm.compatibility.length > 500)) {
    issues.push({ severity: 'error', message: 'compatibility must be a 1–500 character string' });
  }
  if (fm.metadata !== undefined) {
    const ok = fm.metadata && typeof fm.metadata === 'object' && !Array.isArray(fm.metadata) && Object.values(fm.metadata as Record<string, unknown>).every((v) => typeof v === 'string');
    if (!ok) issues.push({ severity: 'error', message: 'metadata must be a map of string keys to string values' });
  }
  if (fm['allowed-tools'] !== undefined && typeof fm['allowed-tools'] !== 'string') issues.push({ severity: 'error', message: 'allowed-tools must be a space-separated string' });
  for (const key of Object.keys(fm)) {
    if (!SPEC_FIELDS.has(key)) issues.push({ severity: 'warning', message: `frontmatter field "${key}" is not part of the Agent Skills spec (client-specific fields may be ignored elsewhere)` });
  }
  const lines = doc.body.split('\n').length;
  if (lines > 500) issues.push({ severity: 'warning', message: `SKILL.md body has ${lines} lines; the spec recommends under 500` });
  for (const match of doc.body.matchAll(/\]\(((?!https?:|#|mailto:)[^)\s]+)\)/g)) {
    const ref = match[1]!.split('#')[0]!;
    if (!ref) continue;
    if (ref.split('/').length > 2) issues.push({ severity: 'warning', message: `reference ${ref} is more than one level deep` });
    if (!pathExists(path.join(dir, ref))) issues.push({ severity: 'error', message: `referenced file ${ref} does not exist` });
  }
  return report;
}

export async function validateSkillsDir(root: string): Promise<SkillReport[]> {
  const entries = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(entries.map((e) => validateSkill(path.join(root, e.name))));
}
