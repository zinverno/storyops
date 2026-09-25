import type { RepoEvent } from '../../repo/events.js';
import { excerptOf, type ReviewDocument } from '../document.js';
import type { Claim, PendingFinding, EvidenceStatus } from '../types.js';

/**
 * Factual review: extracts factual-looking claims and compares them with the
 * repository evidence StoryOps has (benchmarks/docs text, repository events,
 * current modules). This is not exhaustive fact checking; claims about the
 * world outside the repository always need human confirmation.
 */

export interface RepoEvidence {
  repositoryId: string;
  modules: Array<{ path: string; name: string; exists: boolean }>;
  events: RepoEvent[];
  /** Text of benchmark files, changelog and docs (secret-like paths already excluded). */
  docs: Array<{ path: string; kind: string; text: string }>;
}

const NUMBER_UNIT = /(\d+(?:[.,]\d+)?)\s?(%|процент\p{L}*|раз(?:а)?(?![\p{L}])|x(?![\p{L}])|×|мс|ms(?![\p{L}])|сек\p{L}*|секунд\p{L}*|s(?![\p{L}])|минут\p{L}*|min(?![\p{L}])|мб|mb|гб|gb|rps|qps)/iu;
const IMPROVEMENT = /ускор\p{L}*|быстрее|сократ\p{L}*|уменьш\p{L}*|сниз\p{L}*|улучш\p{L}*|вырос\p{L}*|увелич\p{L}*|повыс\p{L}*|faster|reduc\p{L}*|improv\p{L}*|speed(?:s|ed)? up|decreas\p{L}*|increas\p{L}*/iu;
const INTENSIFIER = /значительно|существенно|заметно|кардинально|в разы|на порядок|многократно|радикально|significantly|dramatically|drastically|massively|orders? of magnitude/iu;
const PERF_SUBJECT = /время|скорост|производительн|задержк|памят|latency|throughput|performance|time|memory|speed|анализ\p{L}*|сборк|запуск|отклик/iu;
const ADOPTION = /(?:тысяч\p{L}*|сотн\p{L}*|миллион\p{L}*|многие|все больше|все чаще) (?:пользовател\p{L}*|компани\p{L}*|разработчик\p{L}*|команд\p{L}*)|в продакшене у|используют в продакшене|(?:thousands|hundreds|millions) of (?:users|companies|developers)|used in production by/iu;
const TESTING = /(?:100|\d{2,3})\s?%\s?(?:покрыт\p{L}*|coverage)|все тесты проход\p{L}*|all tests pass|\d+\s+тест(?:ов|а)?(?![\p{L}])|\d+\s+tests(?![\p{L}])/iu;
const REMOVED = /(?:удалил\p{L}*|убрал\p{L}*|выпилил\p{L}*|удалён\p{L}*|удален\p{L}*|removed|deleted|dropped)\s+(?:модул\p{L}*\s+|подсистем\p{L}*\s+|the\s+)?[`«"]?([\p{L}\p{N}_/-]{3,})/iu;
const ADDED = /(?:добавил\p{L}*|появил\p{L}*|написал\p{L}*|added|introduced|implemented)\s+(?:модул\p{L}*\s+|подсистем\p{L}*\s+|the\s+|a\s+)?[`«"]?([\p{L}\p{N}_/-]{3,})/iu;

const SEVERITY: Record<EvidenceStatus, PendingFinding['severity'] | null> = {
  supported: null,
  'partially-supported': 'suggestion',
  unsupported: 'warning',
  contradicted: 'error',
  'needs-human-confirmation': 'info',
};

function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(',', '.'));
}

export function extractClaims(doc: ReviewDocument): Array<Pick<Claim, 'line' | 'text' | 'kind'>> {
  const claims: Array<Pick<Claim, 'line' | 'text' | 'kind'>> = [];
  for (const s of doc.sentences) {
    const t = s.text;
    if (ADOPTION.test(t)) claims.push({ line: s.line, text: t, kind: 'adoption' });
    else if (TESTING.test(t)) claims.push({ line: s.line, text: t, kind: 'testing' });
    else if (IMPROVEMENT.test(t) && (NUMBER_UNIT.test(t) || INTENSIFIER.test(t)) && PERF_SUBJECT.test(t)) claims.push({ line: s.line, text: t, kind: 'performance' });
    else if (NUMBER_UNIT.test(t) && (IMPROVEMENT.test(t) || INTENSIFIER.test(t))) claims.push({ line: s.line, text: t, kind: 'quantitative' });
    else if (REMOVED.test(t) || ADDED.test(t)) claims.push({ line: s.line, text: t, kind: 'repository' });
  }
  return claims;
}

function moduleMatch(evidence: RepoEvidence, word: string) {
  const w = word.toLowerCase().replace(/^src\//, '');
  return evidence.modules.find((m) => m.name.toLowerCase() === w || m.path.toLowerCase() === w || m.path.toLowerCase().endsWith(`/${w}`));
}

export function checkClaim(claim: Pick<Claim, 'line' | 'text' | 'kind'>, evidence: RepoEvidence | undefined): Claim {
  const base = { ...claim, text: excerptOf(claim.text, 200) };
  if (claim.kind === 'adoption') return { ...base, status: 'needs-human-confirmation', refs: [], note: 'Usage and adoption are not visible in a repository; confirm from your own data.' };
  if (claim.kind === 'testing') return { ...base, status: 'needs-human-confirmation', refs: [], note: 'StoryOps counts test files, not test cases or coverage; confirm with the test runner output.' };
  if (!evidence) return { ...base, status: 'needs-human-confirmation', refs: [], note: 'No repository linked (--repo); the claim could not be compared with evidence.' };

  if (claim.kind === 'repository') {
    const removed = claim.text.match(REMOVED);
    if (removed) {
      const mod = moduleMatch(evidence, removed[1]!);
      if (mod?.exists) return { ...base, status: 'contradicted', refs: [mod.path], note: `The text says it was removed, but ${mod.path} exists in the current tree.` };
      const ev = evidence.events.find((e) => (e.type === 'removed-subsystem' || e.type === 'failed-approach') && mod && e.subsystem === mod.path);
      if (ev) return { ...base, status: 'supported', refs: [ev.id, ...ev.commits.slice(0, 2).map((c) => `commit:${c}`)], note: ev.summary };
      return { ...base, status: 'needs-human-confirmation', refs: [], note: 'No matching module in the repository history.' };
    }
    const added = claim.text.match(ADDED);
    const mod = added ? moduleMatch(evidence, added[1]!) : undefined;
    if (mod) return { ...base, status: mod.exists ? 'supported' : 'partially-supported', refs: [mod.path], note: mod.exists ? `${mod.path} exists.` : `${mod.path} existed but has since been removed.` };
    return { ...base, status: 'needs-human-confirmation', refs: [], note: 'No matching module found; the claim may refer to something outside the repository.' };
  }

  // Performance / quantitative claims: look for the same number in benchmark/doc material,
  // then for performance work in the history.
  const numbers = numbersIn(claim.text);
  const measured = evidence.docs.filter((d) => numbers.some((n) => new RegExp(`(?<![\\d.])${n.replace('.', '[.,]')}(?![\\d])`).test(d.text)) && (d.kind === 'benchmark' || PERF_SUBJECT.test(d.text)));
  if (numbers.length && measured.length) return { ...base, status: 'supported', refs: measured.map((d) => d.path).slice(0, 3), note: `The number appears in ${measured.map((d) => d.path).join(', ')}; check that it measures the same thing.` };
  const benchmarks = evidence.docs.filter((d) => d.kind === 'benchmark');
  const perfEvents = evidence.events.filter((e) => e.type === 'performance-work' || e.aspects.includes('performance-work'));
  if (benchmarks.length || perfEvents.length) {
    return { ...base, status: 'partially-supported', refs: [...benchmarks.map((d) => d.path), ...perfEvents.map((e) => e.id)].slice(0, 4), note: `Performance material exists (${[...benchmarks.map((d) => d.path), ...perfEvents.map((e) => e.summary)].slice(0, 2).join('; ')}), but ${numbers.length ? 'this number' : 'this quantitative implication'} was not found in it.` };
  }
  return { ...base, status: 'unsupported', refs: [], note: 'No benchmark, measurement or performance-related change found in the repository.' };
}

export function factualFindings(doc: ReviewDocument, evidence: RepoEvidence | undefined, options: { language: 'ru' | 'en' }): { claims: Claim[]; findings: PendingFinding[] } {
  const ru = options.language === 'ru';
  // Repository claims that name no known module ("добавил жизненный цикл") are not claims StoryOps can check.
  const claims = extractClaims(doc)
    .map((c) => checkClaim(c, evidence))
    .filter((c) => !(c.kind === 'repository' && c.refs.length === 0));
  const findings: PendingFinding[] = [];
  for (const c of claims) {
    const severity = SEVERITY[c.status];
    if (!severity) continue;
    const suggestion =
      c.status === 'unsupported'
        ? ru ? 'Убрать количественное утверждение или привести измерения (как мерили, на каких данных).' : 'Remove the quantitative implication or provide measurements.'
        : c.status === 'contradicted'
          ? ru ? 'Сверить утверждение с текущим состоянием репозитория.' : 'Reconcile the statement with the current repository.'
          : c.status === 'partially-supported'
            ? ru ? 'Сослаться на конкретное измерение или смягчить формулировку.' : 'Point to the specific measurement or soften the wording.'
            : ru ? 'Подтвердить по своим данным; StoryOps не может это проверить.' : 'Confirm from your own data; StoryOps cannot verify it.';
    findings.push({
      category: 'factual',
      rule: `claim-${c.kind}`,
      severity,
      lines: { start: c.line, end: c.line },
      excerpt: excerptOf(c.text, 160),
      problem: ru ? `Утверждение: evidence status — ${c.status}.` : `Claim: evidence status ${c.status}.`,
      why: c.note,
      suggestion,
      evidence: { status: c.status, refs: c.refs, note: c.note },
    });
  }
  return { claims, findings };
}
