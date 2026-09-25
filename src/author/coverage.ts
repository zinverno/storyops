import type { StoryDb } from '../db/database.js';
import type { Publication } from '../publications/schema.js';
import { compileTopics, occurrences, stems, type CompiledTopic } from '../topics/match.js';
import type { StoredTopic } from '../topics/registry.js';

/**
 * Author topic coverage map. For every topic and publication the analysis
 * records how the topic appears (title, headings, body occurrences) and
 * derives a level with documented rules:
 *
 *   deeply-covered  non-brief publication, topic in the title or a heading, ≥ 5 occurrences
 *   explained       non-brief publication and (title, heading or ≥ 3 occurrences)
 *   mentioned       any other occurrence (brief posts never count as more than mentioned)
 *
 * Per topic the highest level wins; `revisited` = explained or deeper in ≥ 2
 * publications; `outdated` = the last coverage predates repository changes
 * on the topic, or is older than `outdatedAfterDays`.
 */

export type CoverageLevel = 'not-covered' | 'mentioned' | 'explained' | 'deeply-covered';

export const COVERAGE_LABEL: Record<CoverageLevel, string> = {
  'not-covered': 'not covered',
  mentioned: 'briefly mentioned',
  explained: 'covered',
  'deeply-covered': 'deeply covered',
};

const ORDER: Record<CoverageLevel, number> = { 'not-covered': 0, mentioned: 1, explained: 2, 'deeply-covered': 3 };

export function maxLevel(a: CoverageLevel, b: CoverageLevel): CoverageLevel {
  return ORDER[a] >= ORDER[b] ? a : b;
}

export function levelRank(level: CoverageLevel): number {
  return ORDER[level];
}

export interface PublicationCoverage {
  publicationId: string;
  title: string;
  platform: string;
  date?: string;
  url?: string;
  depth: string;
  level: Exclude<CoverageLevel, 'not-covered'>;
  occurrences: number;
  inTitle: boolean;
  inHeading: boolean;
}

export interface TopicCoverage {
  topicId: string;
  label: string;
  specificity: string;
  level: CoverageLevel;
  publications: PublicationCoverage[];
  revisited: boolean;
  lastCoveredAt?: string;
  lastPlatform?: string;
  outdated: boolean;
  outdatedReason?: string;
  relatedProjects: string[];
}

export function publicationLevel(p: { depth: string; inTitle: boolean; inHeading: boolean; occurrences: number }): Exclude<CoverageLevel, 'not-covered'> {
  if (p.depth !== 'brief' && (p.inTitle || p.inHeading) && p.occurrences >= 5) return 'deeply-covered';
  if (p.depth !== 'brief' && (p.inTitle || p.inHeading || p.occurrences >= 3)) return 'explained';
  return 'mentioned';
}

/** Coverage of each topic in each publication (only non-zero rows). */
export function publicationCoverage(publications: readonly Publication[], topics: readonly CompiledTopic[]): Map<string, PublicationCoverage[]> {
  const out = new Map<string, PublicationCoverage[]>();
  for (const pub of publications) {
    const title = stems(pub.title);
    const headings = pub.headings.map((h) => stems(h.text));
    const body = stems(`${pub.lead ?? ''} ${pub.text}`);
    for (const topic of topics) {
      const t = occurrences(topic, title).count;
      const h = headings.reduce((s, x) => s + occurrences(topic, x).count, 0);
      const b = occurrences(topic, body).count;
      const total = t + h + b;
      if (total === 0) continue;
      const depth = pub.depth ?? 'standard';
      const row: PublicationCoverage = { publicationId: pub.id, title: pub.title, platform: pub.platform, depth, level: publicationLevel({ depth, inTitle: t > 0, inHeading: h > 0, occurrences: total }), occurrences: total, inTitle: t > 0, inHeading: h > 0 };
      if (pub.publicationDate) row.date = pub.publicationDate;
      if (pub.url) row.url = pub.url;
      out.set(topic.def.id, [...(out.get(topic.def.id) ?? []), row]);
    }
  }
  return out;
}

export interface CoverageOptions {
  now: Date;
  outdatedAfterDays: number;
  /** Latest repository event date per topic id (makes older coverage "outdated"). */
  latestRepoChange?: ReadonlyMap<string, string>;
  /** Project ids per topic id. */
  projectsByTopic?: ReadonlyMap<string, readonly string[]>;
}

export function buildCoverageMap(publications: readonly Publication[], topics: readonly StoredTopic[], options: CoverageOptions): TopicCoverage[] {
  const compiled = compileTopics(topics.map((t) => ({ id: t.id, label: t.label, aliases: t.aliases, specificity: t.specificity })));
  const perPub = publicationCoverage(publications, compiled);
  return topics.map((t) => {
    const pubs = (perPub.get(t.id) ?? []).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.publicationId.localeCompare(b.publicationId));
    const level = pubs.reduce<CoverageLevel>((l, p) => maxLevel(l, p.level), 'not-covered');
    const dated = pubs.filter((p) => p.date);
    const last = dated.at(-1);
    const cov: TopicCoverage = {
      topicId: t.id,
      label: t.label,
      specificity: t.specificity,
      level,
      publications: pubs,
      revisited: pubs.filter((p) => levelRank(p.level) >= ORDER.explained).length >= 2,
      outdated: false,
      relatedProjects: [...(options.projectsByTopic?.get(t.id) ?? [])],
    };
    if (last?.date) {
      cov.lastCoveredAt = last.date;
      cov.lastPlatform = last.platform;
      const repoChange = options.latestRepoChange?.get(t.id);
      const ageDays = (options.now.getTime() - Date.parse(last.date)) / 86_400_000;
      if (repoChange && Date.parse(repoChange) > Date.parse(last.date)) {
        cov.outdated = true;
        cov.outdatedReason = `repository changes on this topic after the last publication (${repoChange.slice(0, 10)} > ${last.date.slice(0, 10)})`;
      } else if (ageDays > options.outdatedAfterDays) {
        cov.outdated = true;
        cov.outdatedReason = `last covered ${Math.round(ageDays)} days ago (threshold ${options.outdatedAfterDays})`;
      }
    }
    return cov;
  });
}

/** Replaces the stored coverage rows for the author. */
export function storeCoverage(db: StoryDb, coverage: readonly TopicCoverage[], authorId = 'self'): void {
  db.tx(() => {
    db.run('DELETE FROM author_topic_coverage WHERE author_id = ?', [authorId]);
    for (const c of coverage) {
      for (const p of c.publications) {
        db.run('INSERT OR REPLACE INTO author_topic_coverage (author_id, topic_id, publication_id, level, occurrences, in_heading, in_title) VALUES (?, ?, ?, ?, ?, ?, ?)', [authorId, c.topicId, p.publicationId, p.level, p.occurrences, p.inHeading, p.inTitle]);
      }
    }
  });
}

/** Coverage label with flags, e.g. "deeply covered, revisited, possibly outdated". */
export function coverageText(c: Pick<TopicCoverage, 'level' | 'revisited' | 'outdated'>): string {
  return [COVERAGE_LABEL[c.level], c.revisited ? 'revisited' : '', c.outdated ? 'possibly outdated' : ''].filter(Boolean).join(', ');
}
