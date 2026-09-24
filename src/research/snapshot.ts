import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { pathExists, readJson, writeJson, writeText } from '../shared/fs.js';
import { mdList, mdTable } from '../shared/markdown.js';
import { researchSnapshotSchema, type ResearchSnapshot } from './types.js';

export function snapshotPaths(researchDir: string, date: string, platform: string): { json: string; md: string } {
  const dir = path.join(researchDir, date);
  return { json: path.join(dir, `${platform}.json`), md: path.join(dir, `${platform}.md`) };
}

export async function saveSnapshot(researchDir: string, snapshot: ResearchSnapshot): Promise<{ json: string; md: string }> {
  const p = snapshotPaths(researchDir, snapshot.collectedAt.slice(0, 10), snapshot.platform);
  await writeJson(p.json, researchSnapshotSchema.parse(snapshot));
  await writeText(p.md, renderSnapshotMarkdown(snapshot));
  return p;
}

/** Latest snapshot for a platform, searching dated folders newest first. */
export async function findLatestSnapshot(researchDir: string, platform: string): Promise<{ snapshot: ResearchSnapshot; file: string } | undefined> {
  if (!pathExists(researchDir)) return undefined;
  const dates = (await readdir(researchDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const date of dates) {
    const file = path.join(researchDir, date, `${platform}.json`);
    if (!pathExists(file)) continue;
    const snapshot = await readJson(file, researchSnapshotSchema);
    if (snapshot.status === 'unsupported' || snapshot.sampleSize === 0) continue;
    return { snapshot, file };
  }
  return undefined;
}

export function snapshotAgeHours(snapshot: ResearchSnapshot, now: Date): number {
  const reference = snapshot.oldestSourceAt ?? snapshot.collectedAt;
  return Math.round(((now.getTime() - Date.parse(reference)) / 3_600_000) * 10) / 10;
}

export function renderSnapshotMarkdown(s: ResearchSnapshot): string {
  const d = (iso?: string) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');
  const fromCache = s.sources.filter((x) => x.fromCache).length;
  const stale = s.sources.filter((x) => x.stale).length;
  const top = [...s.articles].filter((a) => a.momentum).sort((a, b) => (a.momentumRank ?? 999) - (b.momentumRank ?? 999)).slice(0, 15);
  const out = [
    `# ${s.platform} research snapshot — ${s.collectedAt.slice(0, 10)}`,
    '',
    `- Status: **${s.status}**`,
    `- Collected: ${s.collectedAt}${s.oldestSourceAt && s.oldestSourceAt !== s.collectedAt ? ` (oldest source fetched ${s.oldestSourceAt})` : ''}`,
    `- Windows: ${s.windows.map((w) => w.id).join(', ') || '—'}`,
    `- Filters: hubs = ${s.filters.hubs.join(', ') || 'all'}; periods = ${s.filters.periods.join(', ')}${s.filters.maxArticlesPerPeriod ? `; max ${s.filters.maxArticlesPerPeriod}/window` : ''}`,
    `- Sample size: ${s.sampleSize} unique articles (${s.articles.filter((a) => a.structure).length} with parsed structure)`,
    `- Sources: ${s.sources.length} (${fromCache} from cache${stale ? `, ${stale} STALE` : ''}), failures: ${s.failures.length}`,
    '',
    '> Trend research is advisory. It may shape packaging (title, opening, density, structure);',
    '> it must never choose the topic, distort the story, or imitate other authors.',
    '',
    '## Observations',
    '',
  ];
  if (s.observations.length === 0) out.push('_No observation passed the reporting threshold (|difference| ≥ 20 percentage points with enough articles)._', '');
  for (const o of s.observations) {
    out.push(`### ${o.id} (${o.strength})`, '', `Observation: ${o.statement}`, '', `Sample: ${o.sample.size} articles (${o.sample.groupSize ?? '?'} higher-momentum vs ${o.sample.comparisonSize ?? '?'} others).`, '');
    out.push(`Supporting articles: ${o.articleIds.slice(0, 6).join(', ') || '—'}`, '', 'Limitations:', mdList(o.limitations), '');
  }
  out.push('## Saturated angles', '', mdList(s.saturatedAngles.map((a) => `${a.label}: ${a.count}/${a.sampleSize} titles (${Math.round(a.share * 100)}%)`)), '');
  out.push(
    '## Articles by heuristic momentum (top 15)',
    '',
    mdTable(
      ['#', 'Title', 'Age (h)', 'Views', 'Rating', 'Bookmarks', 'Comments', 'Momentum', 'Lifetime rank', 'Missing'],
      top.map((a) => [a.momentumRank, `[${a.title}](${a.url})`, a.momentum?.ageHours, a.metrics.views, a.metrics.rating, a.metrics.bookmarks, a.metrics.comments, a.momentum?.score, a.lifetimeRank, a.momentum?.missing.join(', ') || '—']),
    ),
    '',
    `Momentum formula: ${s.momentumFormula}`,
    '',
    '## Limitations',
    '',
    mdList(s.limitations),
    '',
  );
  if (s.failures.length) out.push('## Failures', '', mdList(s.failures.map((f) => `${f.stage}: ${f.url ?? ''} — ${f.reason}`)), '');
  out.push('## Sources', '', mdList(s.sources.slice(0, 60).map((x) => `${x.url} — fetched ${d(x.fetchedAt)}${x.fromCache ? ` (cache${x.cacheAgeHours !== undefined ? `, ${x.cacheAgeHours}h old` : ''}${x.stale ? ', STALE' : ''})` : ''}`)), '');
  return out.join('\n');
}
