import { normalizeGlossary, type GlossaryEntry } from '../config/schema.js';
import type { ContinuityMap } from '../continuity/schema.js';
import type { ProjectReport } from '../project/schema.js';
import type { Clock } from '../shared/clock.js';
import { tokenize, unique } from '../shared/text.js';
import { NARRATIVE_GAP_SCHEMA_VERSION, type GapKind, type NarrativeGapItem, type NarrativeGapReport } from './schema.js';

export const GAP_METHOD =
  'PROJECT HISTORY − PUBLICATION HISTORY. Boundary = date of the latest in-depth (non-brief) publication about the project; brief posts count as mentions. Candidates come from modules, ADR/architecture docs, commit categories, tags and changelog. Coverage compares candidate terms (module names, doc titles, glossary) with concepts in the continuity map. Strength counts independent evidence (tests, docs, ≥3 commits, ≥3 files, architecture relevance): strong ≥4, moderate ≥2. Ranking is by strength, not recency.';

export interface GapOptions {
  report: ProjectReport;
  continuity: ContinuityMap;
  /** Project glossary; aliases map code identifiers (e.g. "health") to publication vocabulary ("модель здоровья"). */
  glossary?: ReadonlyArray<string | GlossaryEntry>;
  clock: Clock;
}

/** Splits identifiers like "knowledge-analysis" or "findingLifecycle" into words. */
function identifierWords(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_./]+/g, ' ').toLowerCase();
}

export function buildNarrativeGap(options: GapOptions): NarrativeGapReport {
  const { report, continuity, clock } = options;
  const project = continuity.projects.find((p) => p.id === report.projectId);
  const projectPubIds = new Set(project?.publicationIds ?? []);
  const projectPubs = continuity.publications.filter((p) => projectPubIds.has(p.publicationId));
  // Boundary = the last publication that covered the project in depth. Brief
  // posts (e.g. a Telegram note) count as mentions, not as full coverage.
  const deepPubs = projectPubs.filter((p) => p.depth !== 'brief');
  const boundaryPub = (deepPubs.length ? deepPubs : projectPubs).at(-1);
  const boundary = boundaryPub?.date;
  const after = (date?: string) => !boundary || (date !== undefined && Date.parse(date) > Date.parse(boundary));

  // Vocabulary of what readers were already told about this project.
  const covered = new Map<string, { coverage: 'mentioned' | 'explained'; pubs: Set<string> }>();
  for (const concept of continuity.concepts) {
    const occ = concept.occurrences.filter((o) => projectPubIds.has(o.publicationId));
    if (occ.length === 0) continue;
    const coverage = occ.some((o) => o.treatment === 'explained' && o.depth !== 'brief') ? 'explained' : 'mentioned';
    for (const stem of concept.key.split(' ')) {
      const prev = covered.get(stem);
      const pubs = new Set([...(prev?.pubs ?? []), ...occ.map((o) => o.publicationId)]);
      covered.set(stem, { coverage: prev?.coverage === 'explained' || coverage === 'explained' ? 'explained' : 'mentioned', pubs });
    }
  }
  for (const row of continuity.architectureDescribed.filter((r) => projectPubIds.has(r.publication.publicationId))) {
    for (const stem of tokenize(row.items.join(' '))) {
      const prev = covered.get(stem);
      covered.set(stem, { coverage: prev?.coverage ?? 'mentioned', pubs: new Set([...(prev?.pubs ?? []), row.publication.publicationId]) });
    }
  }

  const glossary = normalizeGlossary(options.glossary ?? []);
  /**
   * Candidate terms → stems, with glossary aliases replaced by the canonical
   * term's stems (e.g. "health" → "модел здоровь"), so code identifiers can
   * be compared with the vocabulary of the publications.
   */
  const candidateStems = (terms: string[]): string[] => {
    const stems = new Set(tokenize(terms.join(' ')).filter((s) => s.length >= 3));
    for (const entry of glossary) {
      for (const alias of [entry.term, ...entry.aliases]) {
        const aliasStems = tokenize(alias);
        if (aliasStems.length && aliasStems.every((s) => stems.has(s))) {
          for (const s of aliasStems) stems.delete(s);
          for (const s of tokenize(entry.term)) stems.add(s);
          break;
        }
      }
    }
    return [...stems];
  };

  const coverageOf = (terms: string[]): { coverage: NarrativeGapItem['coverage']; pubs: string[] } => coverageOfStems(candidateStems(terms));

  function coverageOfStems(stems: string[]): { coverage: NarrativeGapItem['coverage']; pubs: string[] } {
    if (stems.length === 0) return { coverage: 'not-covered', pubs: [] };
    const hits = stems.map((s) => covered.get(s)).filter((x): x is NonNullable<typeof x> => Boolean(x));
    const share = hits.length / stems.length;
    const pubs = unique(hits.flatMap((h) => [...h.pubs]));
    if (share >= 0.6 && hits.some((h) => h.coverage === 'explained')) return { coverage: 'explained', pubs };
    if (share >= 0.5) return { coverage: 'mentioned', pubs };
    return { coverage: 'not-covered', pubs };
  }

  const commitsAfter = report.commits.filter((c) => after(c.date));
  const gaps: NarrativeGapItem[] = [];
  const coveredCandidates: NarrativeGapReport['coveredCandidates'] = [];

  const strength = (s: NarrativeGapItem['signals'], architectural: boolean): Pick<NarrativeGapItem, 'strength' | 'strengthReason'> => {
    const reasons: string[] = [];
    if (s.testFiles > 0) reasons.push(`${s.testFiles} test file(s)`);
    if (s.docs > 0) reasons.push(`${s.docs} doc(s)/ADR(s)`);
    if (s.commits >= 3) reasons.push(`${s.commits} commits`);
    if (s.files >= 3) reasons.push(`${s.files} files`);
    if (architectural) reasons.push('architectural change');
    const points = reasons.length;
    return { strength: points >= 4 ? 'strong' : points >= 2 ? 'moderate' : 'weak', strengthReason: reasons.join(', ') || 'single weak signal' };
  };

  const push = (kind: GapKind, id: string, title: string, description: string, terms: string[], signals: NarrativeGapItem['signals'], evidence: string[], since: string | undefined, architectural: boolean) => {
    const cov = coverageOf(terms);
    if (cov.coverage !== 'not-covered' && kind !== 'architecture-evolution') {
      coveredCandidates.push({ title, coverage: cov.coverage, publicationIds: cov.pubs });
      if (cov.coverage === 'explained') return;
    }
    const gap: NarrativeGapItem = { id, kind, title, description, coverage: cov.coverage, ...strength(signals, architectural), signals, evidence: unique(evidence).slice(0, 12), terms: unique(terms) };
    if (since) gap.since = since;
    gaps.push(gap);
  };

  const docsMentioning = (name: string) => report.docs.filter((d) => `${d.title ?? ''} ${d.excerpt ?? ''} ${d.path}`.toLowerCase().includes(name.toLowerCase().replace(/-/g, ' ')) || d.path.toLowerCase().includes(name.toLowerCase()));

  // 1. New subsystems (modules introduced after the boundary, or never told).
  const newModules = report.modules.filter((m) => m.exists && after(m.firstSeen));
  for (const m of newModules) {
    const docs = docsMentioning(m.name);
    const moduleCommits = commitsAfter.filter((c) => c.modules.includes(m.path));
    push(
      'new-subsystem',
      `subsystem-${m.path.replace(/[^a-z0-9]+/gi, '-')}`,
      `New subsystem: ${m.path}`,
      `${m.path} appeared ${boundary ? 'after the last publication' : 'in the project'} (${m.files} files, ${m.testFiles} test files).`,
      [identifierWords(m.name), ...docs.map((d) => d.title ?? '')].filter(Boolean),
      { commits: moduleCommits.length, files: m.files, testFiles: m.testFiles, docs: docs.length },
      [m.path, ...docs.map((d) => d.path), ...moduleCommits.slice(0, 5).map((c) => `commit:${c.shortHash}`)],
      m.firstSeen,
      false,
    );
  }

  // 2. Removed approaches (modules deleted after the boundary).
  const removed = report.modules.filter((m) => !m.exists && m.deletedAt && after(m.deletedAt));
  for (const m of removed) {
    const cov = coverageOf([identifierWords(m.name)]);
    const removalCommits = commitsAfter.filter((c) => c.modules.includes(m.path) && c.pathProfile.deleted > 0);
    gaps.push({
      id: `removed-${m.path.replace(/[^a-z0-9]+/gi, '-')}`,
      kind: 'removed-approach',
      title: `Removed approach: ${m.path}`,
      description: `${m.path} was deleted${cov.coverage !== 'not-covered' ? ' — and earlier publications described it, so readers have an outdated picture' : ''}.`,
      since: m.deletedAt,
      coverage: cov.coverage,
      ...strength({ commits: removalCommits.length, files: 0, testFiles: 0, docs: 0 }, cov.coverage !== 'not-covered'),
      signals: { commits: removalCommits.length, files: 0, testFiles: 0, docs: 0 },
      evidence: removalCommits.slice(0, 5).map((c) => `commit:${c.shortHash}`),
      terms: [identifierWords(m.name)],
    });
  }

  // 3. Architecture evolution: ADRs/architecture docs changed after the boundary,
  //    especially combined with removed/replaced modules readers already know.
  const archDocs = report.docs.filter((d) => (d.kind === 'adr' || d.kind === 'architecture') && after(d.lastCommitDate ?? d.firstCommitDate));
  const knownRemoved = removed.filter((m) => coverageOf([identifierWords(m.name)]).coverage !== 'not-covered');
  if (archDocs.length > 0 || knownRemoved.length > 0) {
    const newNames = newModules.map((m) => m.name);
    const oldNames = knownRemoved.map((m) => m.name);
    const archCommits = commitsAfter.filter((c) => c.messageCategory === 'refactor' || c.messageCategory === 'migration' || c.breaking || c.modules.some((mod) => newModules.some((m) => m.path === mod)));
    const title = oldNames.length && newNames.length ? `Architecture evolved: ${oldNames.join(', ')} → ${newNames.join(', ')}` : `Architecture evolved (${archDocs.map((d) => d.title ?? d.path).join('; ')})`;
    const signals = { commits: archCommits.length, files: newModules.reduce((s, m) => s + m.files, 0), testFiles: newModules.reduce((s, m) => s + m.testFiles, 0), docs: archDocs.length };
    const gap: NarrativeGapItem = {
      id: 'architecture-evolution',
      kind: 'architecture-evolution',
      title,
      description: `The architecture readers know (${project?.coveredAspects.filter((a) => a.aspect.startsWith('architecture')).map((a) => `"${a.publication.title}"`).join(', ') || 'none published'}) is no longer current. Evidence: ${archDocs.length} architecture doc(s)/ADR(s) changed after the last publication${knownRemoved.length ? `; previously described parts removed: ${oldNames.join(', ')}` : ''}.`,
      coverage: 'not-covered',
      ...strength(signals, true),
      signals,
      evidence: unique([...archDocs.map((d) => d.path), ...newModules.map((m) => m.path), ...archCommits.slice(0, 6).map((c) => `commit:${c.shortHash}`)]),
      terms: unique([...archDocs.map((d) => d.title ?? ''), ...newNames.map(identifierWords)].filter(Boolean)),
    };
    if (archDocs[0]?.lastCommitDate) gap.since = archDocs[0].lastCommitDate;
    gaps.push(gap);
  }

  // 4. Commit-category driven gaps.
  const byCategory = (cat: string) => commitsAfter.filter((c) => c.messageCategory === cat && !c.mismatch);
  const categoryGap = (cat: string, kind: GapKind, label: string, architectural: boolean) => {
    const list = byCategory(cat);
    if (list.length === 0) return;
    const files = unique(list.flatMap((c) => c.modules));
    push(
      kind,
      `${kind}`,
      `${label}: ${list.slice(0, 3).map((c) => c.subject).join('; ')}${list.length > 3 ? '…' : ''}`,
      `${list.length} ${cat} commit(s) since ${boundary ? boundary.slice(0, 10) : 'the start'} touching ${files.join(', ') || 'various files'}.`,
      list.map((c) => c.subject.replace(/^\w+(\([^)]*\))?!?:\s*/, '')),
      { commits: list.length, files: list.reduce((s, c) => s + c.pathProfile.source, 0), testFiles: list.reduce((s, c) => s + c.pathProfile.tests, 0), docs: list.reduce((s, c) => s + c.pathProfile.docs, 0) },
      list.slice(0, 8).map((c) => `commit:${c.shortHash}`),
      list[0]?.date,
      architectural,
    );
  };
  categoryGap('migration', 'migration', 'Migration', true);
  categoryGap('refactor', 'major-refactor', 'Refactoring', true);
  categoryGap('performance', 'performance-work', 'Performance work', false);
  if (byCategory('fix').length >= 3) categoryGap('fix', 'bug-fixing', 'Bug fixing', false);

  // 5. Releases and new evidence.
  const newTags = report.tags.filter((t) => after(t.date));
  if (newTags.length) {
    gaps.push({
      id: 'release',
      kind: 'release',
      title: `Release(s) since last publication: ${newTags.map((t) => t.name).join(', ')}`,
      description: `${newTags.length} tag(s) after ${boundary?.slice(0, 10) ?? 'start'}.`,
      since: newTags[0]!.date,
      coverage: 'not-covered',
      strength: 'weak',
      strengthReason: 'version boundary only; the content of the release decides the story',
      signals: { commits: 0, files: 0, testFiles: 0, docs: 0 },
      evidence: newTags.map((t) => `tag:${t.name}`),
      terms: newTags.map((t) => t.name),
    });
  }
  const benchDocs = report.docs.filter((d) => d.kind === 'benchmark' && after(d.lastCommitDate));
  if (benchDocs.length) {
    gaps.push({
      id: 'new-evidence-benchmarks',
      kind: 'new-evidence',
      title: 'New benchmark material',
      description: `${benchDocs.length} benchmark file(s) changed after the last publication. Verify numbers directly from these files.`,
      coverage: 'not-covered',
      strength: 'moderate',
      strengthReason: 'benchmark files present',
      signals: { commits: 0, files: benchDocs.length, testFiles: 0, docs: benchDocs.length },
      evidence: benchDocs.map((d) => d.path),
      terms: ['benchmark'],
    });
  }

  // 6. Untold history: modules that existed before the boundary but were never mentioned.
  if (boundary) {
    for (const m of report.modules.filter((x) => x.exists && x.firstSeen && Date.parse(x.firstSeen) <= Date.parse(boundary) && x.files >= 3)) {
      if (coverageOf([identifierWords(m.name)]).coverage === 'not-covered') {
        gaps.push({
          id: `untold-${m.path.replace(/[^a-z0-9]+/gi, '-')}`,
          kind: 'untold-history',
          title: `Never discussed: ${m.path}`,
          description: `${m.path} existed before the last publication but no publication mentions it.`,
          since: m.firstSeen,
          coverage: 'not-covered',
          strength: 'weak',
          strengthReason: 'older, never-mentioned module',
          signals: { commits: m.commits, files: m.files, testFiles: m.testFiles, docs: 0 },
          evidence: [m.path],
          terms: [identifierWords(m.name)],
        });
      }
    }
  }

  const order = { strong: 0, moderate: 1, weak: 2 };
  gaps.sort((a, b) => order[a.strength] - order[b.strength] || Number(b.kind === 'architecture-evolution') - Number(a.kind === 'architecture-evolution') || b.evidence.length - a.evidence.length || a.id.localeCompare(b.id));

  const alreadyCovered = (project?.coveredAspects ?? []).map((a) => {
    const row: NarrativeGapReport['alreadyCovered'][number] = { label: a.label, publicationId: a.publication.publicationId, platform: a.publication.platform };
    if (a.publication.date) row.date = a.publication.date;
    return row;
  });

  const architecture = gaps.find((g) => g.kind === 'architecture-evolution');
  const subsystems = gaps.filter((g) => g.kind === 'new-subsystem');
  let headline: string | undefined;
  if (architecture && subsystems.length) headline = `${architecture.title}; new subsystem(s) not yet discussed: ${subsystems.map((s) => s.title.replace('New subsystem: ', '')).join(', ')}`;
  else if (gaps[0]) headline = gaps[0].title;

  const result: NarrativeGapReport = {
    schemaVersion: NARRATIVE_GAP_SCHEMA_VERSION,
    projectId: report.projectId,
    generatedAt: clock.now().toISOString(),
    method: GAP_METHOD,
    boundary: { publications: projectPubIds.size },
    alreadyCovered,
    newInProject: gaps.filter((g) => g.kind !== 'untold-history' && g.kind !== 'release').map((g) => g.title),
    gaps,
    coveredCandidates,
    notes: [
      'The newest change is not automatically the best topic; weigh strength, evidence and what readers already know.',
      'Commit messages are hints. Check the referenced source and tests before building a story on a gap.',
    ],
  };
  if (boundary) result.boundary.lastPublicationAt = boundary;
  if (boundaryPub) result.boundary.lastPublicationId = boundaryPub.publicationId;
  const briefAfter = projectPubs.filter((p) => p.depth === 'brief' && boundary && p.date && Date.parse(p.date) > Date.parse(boundary));
  if (briefAfter.length) result.notes.push(`Brief publication(s) after the boundary count only as mentions: ${briefAfter.map((p) => `${p.title} (${p.platform})`).join(', ')}.`);
  if (headline) result.headline = headline;
  return result;
}
