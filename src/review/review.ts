import { checkStyle, getStyleProfile } from '../author/style-check.js';
import type { Publication } from '../publications/schema.js';
import { sha256, shortHash } from '../shared/hash.js';
import { normalizeText } from '../shared/text.js';
import type { AuthorInput } from './author-input.js';
import { archiveFindings, authorInputFindings, platformFitFindings, type PlatformContext } from './checks/context.js';
import { factualFindings, type RepoEvidence } from './checks/factual.js';
import { languageFindings } from './checks/language.js';
import { logicFindings } from './checks/logic.js';
import { repetitionFindings } from './checks/repetition.js';
import { structureFindings } from './checks/structure.js';
import { styleFindings } from './checks/style.js';
import { buildDocument } from './document.js';
import type { ReviewProfile } from './profiles.js';
import { REVIEW_NOTICE, REVIEW_SCHEMA_VERSION, reviewReportSchema, type PendingFinding, type Finding, type FindingStatus, type ReviewReport } from './types.js';

/**
 * Read-only article review. Input is the article TEXT (the caller reads the
 * file once); output is a report. Nothing here can write to the article.
 */

export interface ReviewInput {
  markdown: string;
  articlePath: string;
  /** Stable key of the article (workspace-relative path) for remembered decisions. */
  articleKey: string;
  now: string;
  languageProfile: string;
  profile?: ReviewProfile;
  repoEvidence?: RepoEvidence;
  platform?: PlatformContext;
  archive?: readonly Publication[];
  authorInput?: { file: string; input: AuthorInput };
  /** Earlier author decisions by fingerprint. */
  decisions?: ReadonlyMap<string, { status: FindingStatus; decidedAt: string }>;
  maxAlternativeChars: number;
}

export const EXCERPT_MAX = 160;

const SEVERITY_ORDER = { error: 0, warning: 1, suggestion: 2, info: 3 } as const;

/** A local alternative must stay local: one line, short, and not much longer than the excerpt it replaces. */
export function alternativeAllowed(alternative: string, excerpt: string | undefined, maxChars: number): boolean {
  if (!excerpt) return false;
  if (alternative.includes('\n')) return false;
  if (alternative.length > maxChars) return false;
  if (alternative.length > Math.max(60, excerpt.length * 2)) return false;
  return true;
}

export function fingerprintOf(f: PendingFinding): string {
  return shortHash(`${f.category}|${f.rule}|${normalizeText(f.excerpt ?? f.problem)}`, 16);
}

export function reviewArticle(input: ReviewInput): ReviewReport {
  const language = input.languageProfile.startsWith('en') ? 'en' : 'ru';
  const styleProfile = getStyleProfile(input.languageProfile);
  const doc = buildDocument(input.markdown);
  const pending: PendingFinding[] = [];
  pending.push(...languageFindings(doc, { language, longSentenceWords: styleProfile.thresholds.longSentenceWords }));
  pending.push(...styleFindings(doc, input.markdown, { styleProfile: input.languageProfile }));
  pending.push(...logicFindings(doc, { language }));
  const factual = factualFindings(doc, input.repoEvidence, { language });
  pending.push(...factual.findings);
  pending.push(...repetitionFindings(doc, { language }));
  pending.push(...structureFindings(doc, { language, ...(input.profile ? { profile: input.profile } : {}) }));
  if (input.platform) pending.push(...platformFitFindings(doc, input.markdown, input.platform, { language }));
  if (input.archive?.length) pending.push(...archiveFindings(doc, input.archive, { language }));
  if (input.authorInput) pending.push(...authorInputFindings(doc, input.authorInput.input, { language }));

  // Deduplicate (same rule on the same lines), bound excerpts and alternatives, assign ids and statuses.
  const seen = new Set<string>();
  let dropped = 0;
  let carried = 0;
  const unique = pending.filter((f) => {
    const key = `${f.rule}|${f.lines?.start ?? ''}|${f.lines?.end ?? ''}|${f.excerpt ?? f.problem}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => (a.lines?.start ?? Number.MAX_SAFE_INTEGER) - (b.lines?.start ?? Number.MAX_SAFE_INTEGER) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.rule.localeCompare(b.rule));
  const findings: Finding[] = unique.map((f, i) => {
    const { key: _key, ...rest } = f;
    const finding: Finding = { ...rest, id: `F${String(i + 1).padStart(3, '0')}`, fingerprint: fingerprintOf(f), status: 'open' };
    if (finding.excerpt && finding.excerpt.length > EXCERPT_MAX) finding.excerpt = `${finding.excerpt.slice(0, EXCERPT_MAX - 1)}…`;
    if (finding.alternative !== undefined && !alternativeAllowed(finding.alternative, finding.excerpt, input.maxAlternativeChars)) {
      delete finding.alternative;
      dropped += 1;
    }
    const decision = input.decisions?.get(finding.fingerprint);
    if (decision && decision.status !== 'open' && decision.status !== 'resolved') {
      finding.status = decision.status;
      finding.decidedAt = decision.decidedAt;
      carried += 1;
    }
    return finding;
  });

  const count = <K extends string>(key: (f: Finding) => K) => findings.reduce<Record<string, number>>((acc, f) => ({ ...acc, [key(f)]: (acc[key(f)] ?? 0) + 1 }), {});
  const style = checkStyle(input.markdown, input.languageProfile);
  const slug = input.articleKey.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase().slice(-40) || 'article';
  const articleHash = sha256(input.markdown);
  const report: ReviewReport = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    id: `${slug}-${input.now.slice(0, 10)}-${articleHash.slice(0, 6)}`,
    generatedAt: input.now,
    article: { path: input.articlePath, key: input.articleKey, sha256: articleHash, words: doc.words, lines: doc.lineCount },
    profile: input.profile?.id ?? null,
    languageProfile: input.languageProfile,
    context: {
      repository: input.repoEvidence?.repositoryId ?? null,
      platform: input.platform?.strategy.id ?? null,
      archivePublications: input.archive?.length ?? 0,
      authorInput: input.authorInput?.file ?? null,
    },
    summary: {
      total: findings.length,
      open: findings.filter((f) => f.status === 'open').length,
      byCategory: count((f) => f.category),
      bySeverity: count((f) => f.severity),
      carriedDecisions: carried,
      droppedAlternatives: dropped,
    },
    findings,
    claims: factual.claims,
    metrics: {
      words: doc.words,
      sentences: doc.sentences.length,
      paragraphs: doc.parsed.blocks.filter((b) => b.kind === 'paragraph').length,
      headings: doc.parsed.blocks.filter((b) => b.kind === 'heading').length,
      codeBlocks: doc.parsed.blocks.filter((b) => b.kind === 'code').length,
      emDashPer1000: style.metrics.emDashPer1000,
      notXButYPer1000: style.metrics.notXButYPer1000,
      longSentenceShare: style.metrics.longSentenceShare,
    },
    watchFor: input.profile?.watchFor ?? [],
    notice: REVIEW_NOTICE,
    limitations: [
      'Language checks are deterministic heuristics (dictionaries and patterns); they do not replace a proofreader and do not claim to solve grammar.',
      'Logic checks only surface lexically similar statements with opposite polarity or different guarantees; real logical review needs a human or the reviewing agent.',
      'Factual checks compare claims with repository material StoryOps can read (benchmarks, docs, history). They are not exhaustive and cannot verify facts outside the repository.',
      'Style findings describe observable patterns; they are not an "AI detector" and carry no probability.',
      'Platform context describes samples; it never overrides the author.',
    ],
  };
  return reviewReportSchema.parse(report);
}
