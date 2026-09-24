import { mdList } from '../shared/markdown.js';
import type { Brief } from './build.js';

export function renderBrief(b: Brief): string {
  const section = (title: string, body: string | string[]) => [`## ${title}`, '', Array.isArray(body) ? mdList(body) : body || '_—_', ''];
  return [
    `# Article brief — ${b.story} → ${b.platform}`,
    '',
    `Generated ${b.generatedAt} with strategy ${b.platform}@${b.strategyVersion}.`,
    '',
    b.readiness.readyForDrafting
      ? '> ✅ Ready for drafting: core facts and evidence are in place.'
      : `> ⛔ NOT READY FOR DRAFTING. Resolve first:\n${b.readiness.blockers.map((x) => `> - ${x}`).join('\n')}`,
    '',
    ...section('Working title', b.workingTitle),
    ...section('Platform', `${b.platform} (strategy ${b.strategyVersion})`),
    ...section('Publication type', b.publicationType),
    ...section('Core question', b.coreQuestion),
    ...section('Why this exists now', b.whyNow),
    ...section('Target reader', b.targetReader),
    ...section('Relation to previous publications', b.relationToPrevious),
    ...section('What has already been explained', b.alreadyExplained),
    ...section('What must not be re-explained', b.doNotReExplain.length ? b.doNotReExplain.map((c) => `${c} — link to the earlier publication instead`) : []),
    ...section('Narrative gap', b.narrativeGap),
    ...section('Unique contribution', b.uniqueContribution),
    ...section('Current platform context', [`status: ${b.platformContext.status}`, ...b.platformContext.lines]),
    ...section('Main technical conflict', b.mainTechnicalConflict),
    ...section('Important evidence', b.importantEvidence),
    ...section('Screenshots required', b.screenshotsRequired),
    ...section('Potential diagrams', b.potentialDiagrams),
    ...section('Expected structure', b.expectedStructure.map((s) => `**${s.id}** — ${s.purpose}`)),
    ...section('Known limitations', b.knownLimitations),
    ...section('Claims requiring verification', b.claimsRequiringVerification),
    ...section(
      'Platform-specific packaging notes',
      b.packaging.map((p) => `${p.advisory ? '(advisory) ' : ''}${p.text} — _source: ${p.source}; ${p.provenance}_`),
    ),
    ...section('Length target', b.lengthTarget),
    '_Priority: factual truth > author voice > narrative continuity > platform strategy > current trend patterns._',
    '',
  ].join('\n');
}
