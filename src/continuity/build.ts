import type { EditorialConfig } from '../config/schema.js';
import type { PublicationIndex, PublicationIndexEntry } from '../publications/index-schema.js';
import type { Clock } from '../shared/clock.js';
import { tokenize, unique } from '../shared/text.js';
import { CONTINUITY_SCHEMA_VERSION, type ContinuityMap, type PublicationRef } from './schema.js';

export const CONTINUITY_METHOD =
  'Built from the publication index in chronological order. Coverage "explained" requires an explanation in a standard/deep publication; brief posts count as mentions. Promises/open questions are "possibly-addressed" when a later publication shares ≥50% of their content stems (lexical check, verify manually).';

function ref(e: PublicationIndexEntry): PublicationRef {
  const r: PublicationRef = { publicationId: e.publicationId, platform: e.platform, title: e.title, depth: e.depth };
  if (e.date) r.date = e.date;
  return r;
}

function chronological(entries: readonly PublicationIndexEntry[]): PublicationIndexEntry[] {
  return [...entries].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.publicationId.localeCompare(b.publicationId));
}

function laterAddresses(text: string, since: string | undefined, entries: readonly PublicationIndexEntry[], selfId: string): string | undefined {
  const stems = new Set(tokenize(text).filter((t) => t.length >= 4));
  if (stems.size === 0) return undefined;
  for (const e of entries) {
    if (e.publicationId === selfId) continue;
    if (since && e.date && e.date <= since) continue;
    const vocabulary = new Set(tokenize(`${e.title} ${e.concepts.map((c) => c.concept).join(' ')} ${e.architectureDescribed.values.join(' ')}`));
    let hit = 0;
    for (const s of stems) if (vocabulary.has(s)) hit += 1;
    if (hit / stems.size >= 0.5) return e.publicationId;
  }
  return undefined;
}

export function buildContinuity(index: PublicationIndex, config: Pick<EditorialConfig, 'author' | 'projects'>, clock: Clock): ContinuityMap {
  const entries = chronological(index.entries);

  const projects = config.projects.map((project) => {
    const pubs = entries.filter((e) => e.projects.values.includes(project.id));
    const covered: ContinuityMap['projects'][number]['coveredAspects'] = [];
    const first = pubs[0];
    if (first) covered.push({ aspect: 'project-origin', label: 'project origin / introduction', publication: ref(pubs.find((p) => p.roles.includes('project-introduction')) ?? first) });
    const arch = pubs.filter((p) => p.roles.includes('architecture'));
    arch.forEach((p, i) => covered.push({ aspect: i === 0 ? 'architecture' : `architecture-${i + 1}`, label: i === 0 ? 'original architecture' : `architecture revision ${i + 1}`, publication: ref(p) }));
    for (const p of pubs) {
      for (const role of p.roles) {
        if (role === 'postmortem' || role === 'release' || role === 'update' || role === 'tutorial') covered.push({ aspect: role, label: role, publication: ref(p) });
      }
    }
    const entry: ContinuityMap['projects'][number] = {
      id: project.id,
      name: project.name,
      publicationIds: pubs.map((p) => p.publicationId),
      platforms: unique(pubs.map((p) => p.platform)).sort(),
      coveredAspects: covered,
    };
    if (first?.date) entry.firstPublishedAt = first.date;
    const last = pubs.at(-1);
    if (last?.date) entry.lastPublishedAt = last.date;
    return entry;
  });

  const conceptMap = new Map<string, ContinuityMap['concepts'][number]>();
  for (const e of entries) {
    for (const c of e.concepts) {
      const existing = conceptMap.get(c.key) ?? { key: c.key, label: c.concept, coverage: 'mentioned' as const, occurrences: [] };
      existing.occurrences.push({ ...ref(e), treatment: c.depth });
      if (c.depth === 'explained' && e.depth !== 'brief') existing.coverage = 'explained';
      if (c.source === 'glossary') existing.label = c.concept;
      conceptMap.set(c.key, existing);
    }
  }
  const concepts = [...conceptMap.values()].sort((a, b) => Number(b.coverage === 'explained') - Number(a.coverage === 'explained') || b.occurrences.length - a.occurrences.length || a.key.localeCompare(b.key));

  const themes = concepts
    .filter((c) => c.occurrences.length >= 2)
    .map((c) => ({ key: c.key, label: c.label, publicationIds: unique(c.occurrences.map((o) => o.publicationId)), platforms: unique(c.occurrences.map((o) => o.platform)).sort() }));

  const repeatedExplanations = concepts
    .map((c) => ({ c, explainedIn: c.occurrences.filter((o) => o.treatment === 'explained' && o.depth !== 'brief') }))
    .filter(({ explainedIn }) => explainedIn.length >= 2)
    .map(({ c, explainedIn }) => ({ key: c.key, label: c.label, publicationIds: explainedIn.map((o) => o.publicationId) }));

  const perPub = (pick: (e: PublicationIndexEntry) => string[]) =>
    entries.map((e) => ({ publication: ref(e), items: pick(e) })).filter((x) => x.items.length > 0);

  const promises = entries.flatMap((e) =>
    e.futurePlans.values.map((text) => {
      const addressedBy = laterAddresses(text, e.date, entries, e.publicationId);
      return addressedBy ? { publication: ref(e), text, status: 'possibly-addressed' as const, addressedBy } : { publication: ref(e), text, status: 'open' as const };
    }),
  );
  const openQuestions = entries.flatMap((e) =>
    e.openQuestions.values.map((text) => {
      const addressedBy = laterAddresses(text, e.date, entries, e.publicationId);
      return addressedBy ? { publication: ref(e), text, status: 'possibly-addressed' as const, addressedBy } : { publication: ref(e), text, status: 'open' as const };
    }),
  );
  const unfinishedThreads = [
    ...promises.filter((p) => p.status === 'open').map((p) => ({ kind: 'promise' as const, text: p.text, publicationId: p.publication.publicationId, since: p.publication.date })),
    ...openQuestions.filter((q) => q.status === 'open').map((q) => ({ kind: 'open-question' as const, text: q.text, publicationId: q.publication.publicationId, since: q.publication.date })),
  ];

  return {
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    generatedAt: clock.now().toISOString(),
    author: config.author.name,
    method: CONTINUITY_METHOD,
    publications: entries.map((e) => ({ ...ref(e), ...(e.url ? { url: e.url } : {}), roles: e.roles, projects: e.projects.values })),
    projects,
    themes,
    concepts,
    repeatedExplanations,
    architectureDescribed: perPub((e) => e.architectureDescribed.values),
    problemsIntroduced: perPub((e) => e.problemsIntroduced.values),
    claimsMade: perPub((e) => e.resultsReported.values.filter((v) => /\d/.test(v))),
    resultsReported: perPub((e) => e.resultsReported.values),
    promises,
    openQuestions,
    unfinishedThreads,
  };
}

/** Explained concepts for a project (or all projects) — used by briefs as "do not re-explain". */
export function explainedConcepts(map: ContinuityMap, projectId?: string): ContinuityMap['concepts'] {
  const ids = projectId ? new Set(map.projects.find((p) => p.id === projectId)?.publicationIds ?? []) : undefined;
  return map.concepts.filter((c) => c.coverage === 'explained' && (!ids || c.occurrences.some((o) => ids.has(o.publicationId))));
}
