import { splitSentences, wordCount } from '../shared/text.js';
import { STYLE_PROFILES, type StyleProfile } from './style-profiles.js';
import { StoryOpsError } from '../shared/errors.js';

export interface StyleFinding {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  excerpt?: string;
}

export interface StyleReport {
  profile: string;
  words: number;
  metrics: { emDashPer1000: number; notXButYPer1000: number; exclamationsPer1000: number; longSentenceShare: number; shortSentenceRuns: number };
  findings: StyleFinding[];
}

export function getStyleProfile(id: string): StyleProfile {
  const profile = STYLE_PROFILES[id];
  if (!profile) throw new StoryOpsError('STYLE_PROFILE', `Unknown style profile "${id}"`, { hint: `Available: ${Object.keys(STYLE_PROFILES).join(', ')}` });
  return profile;
}

const keepLines = (m: string) => m.replace(/[^\n]/g, '');

/** Blanks out frontmatter, HTML comments and code (keeping line breaks, so line numbers stay true). */
export function proseOf(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n/, keepLines)
    .replace(/<!--[\s\S]*?-->/g, keepLines)
    .replace(/```[\s\S]*?```/g, keepLines)
    .replace(/`[^`\n]*`/g, '');
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

export function checkStyle(markdown: string, profileId = 'ru-technical'): StyleReport {
  const profile = getStyleProfile(profileId);
  const text = proseOf(markdown);
  const words = Math.max(1, wordCount(text));
  const per1000 = (n: number) => Math.round((n * 1000 * 10) / words) / 10;
  const findings: StyleFinding[] = [];

  for (const rule of profile.rules) {
    const lead = rule.withinFirstChars ? text.length - text.trimStart().length : 0;
    const scope = rule.withinFirstChars ? text.slice(lead, lead + rule.withinFirstChars) : text;
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
    for (const m of scope.matchAll(new RegExp(rule.pattern.source, flags))) {
      const at = m.index ?? 0;
      const skipped = m[0].length - m[0].trimStart().length;
      findings.push({ rule: rule.id, severity: rule.severity, message: rule.message, line: lineOf(text, lead + at + skipped), excerpt: m[0].trim().slice(0, 80) });
      if (rule.withinFirstChars) break;
    }
  }

  const emDashes = (text.match(/—/g) ?? []).length;
  const notXButY = [...text.matchAll(/(?:^|[\s(])не\s+[^,.;:!?\n]{1,50},\s+а\s+/giu)].length;
  const exclamations = (text.match(/!(?!\[)/g) ?? []).length;
  const sentences = splitSentences(text.replace(/^#+\s.*$/gm, ''));
  const longShare = sentences.length ? sentences.filter((s) => wordCount(s) > profile.thresholds.longSentenceWords).length / sentences.length : 0;
  let runs = 0;
  let streak = 0;
  for (const s of sentences) {
    if (wordCount(s) <= 3) {
      streak += 1;
      if (streak === 3) runs += 1;
    } else streak = 0;
  }
  const metrics = {
    emDashPer1000: per1000(emDashes),
    notXButYPer1000: per1000(notXButY),
    exclamationsPer1000: per1000(exclamations),
    longSentenceShare: Math.round(longShare * 100) / 100,
    shortSentenceRuns: runs,
  };
  const t = profile.thresholds;
  if (words >= 150 && metrics.emDashPer1000 > t.emDashPer1000) findings.push({ rule: 'em-dash-density', severity: 'warning', message: `${emDashes} long em dashes (${metrics.emDashPer1000}/1000 words, threshold ${t.emDashPer1000}). Use commas, colons or separate sentences.` });
  if (notXButY >= 2 && metrics.notXButYPer1000 > t.notXButYPer1000) findings.push({ rule: 'not-x-but-y', severity: 'warning', message: `${notXButY} "не X, а Y" constructions (${metrics.notXButYPer1000}/1000 words). Repetition makes the text formulaic.` });
  if (exclamations >= 2 && metrics.exclamationsPer1000 > t.exclamationsPer1000) findings.push({ rule: 'exclamations', severity: 'info', message: `${exclamations} exclamation marks; technical text rarely needs them.` });
  if (sentences.length >= 10 && metrics.longSentenceShare > t.longSentenceShare) findings.push({ rule: 'long-sentences', severity: 'info', message: `${Math.round(longShare * 100)}% of sentences exceed ${t.longSentenceWords} words.` });
  if (runs > 0) findings.push({ rule: 'rhetorical-rhythm', severity: 'info', message: `${runs} run(s) of three or more very short sentences; this often reads as artificial rhetoric (triads).` });
  return { profile: profile.id, words, metrics, findings };
}
