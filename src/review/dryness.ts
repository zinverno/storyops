import { splitSentences, wordCount } from '../shared/text.js';
import type { ParsedArticle } from './parse.js';

/**
 * Advisory signals that prose reads like documentation (README, release
 * notes, spec, generated summary). They are review observations, not truth:
 * there is deliberately no overall score.
 */

export interface DrynessFinding {
  rule: string;
  severity: 'warning' | 'info';
  message: string;
}

export interface DrynessReport {
  words: number;
  metrics: {
    paragraphs: number;
    headings: number;
    headingsPer1000: number;
    listItemShare: number;
    shortParagraphRunMax: number;
    definitionOpenings: number;
    firstPersonMentions: number;
    repeatedOpenings: string[];
  };
  findings: DrynessFinding[];
}

const FIRST_PERSON = /(?<![\p{L}\p{N}])(?:я|мне|меня|мной|мой|моя|моё|мое|мои|моего|моей|моих|моим|мы|нас|нам|нами|наш|наша|наше|наши|нашего|нашей|наших|i|i'm|i've|me|my|mine|we|us|our|ours)(?![\p{L}\p{N}])/giu;
const DEFINITION_OPENING = /^[\p{L}\p{N}`"«»_.\-/]+(?:\s+[\p{L}\p{N}`"«»_.\-/]+){0,3}\s+(?:—|-|–)\s+это(?![\p{L}\p{N}])|^[\p{L}\p{N}`"_.\-/]+(?:\s+[\p{L}\p{N}`"_.\-/]+){0,3}\s+is\s+an?\s/iu;

export function analyzeDryness(article: ParsedArticle): DrynessReport {
  const prose = article.blocks.filter((b) => b.kind === 'paragraph' || b.kind === 'quote');
  const lists = article.blocks.filter((b) => b.kind === 'list');
  // The document title (H1) is not sectioning.
  const headings = article.blocks.filter((b) => b.kind === 'heading' && b.level !== 1);
  const text = [...prose, ...lists].map((b) => b.text).join('\n\n');
  const words = Math.max(1, wordCount(text));
  const listItems = lists.reduce((n, b) => n + b.text.split('\n').filter((l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l)).length, 0);
  const listItemShare = listItems + prose.length > 0 ? Math.round((listItems / (listItems + prose.length)) * 100) / 100 : 0;
  const headingsPer1000 = Math.round((headings.length * 1000 * 10) / words) / 10;

  let run = 0;
  let maxRun = 0;
  for (const b of article.blocks) {
    if (b.kind === 'heading') continue;
    if (b.kind === 'paragraph' && wordCount(b.text) <= 20) {
      run += 1;
      maxRun = Math.max(maxRun, run);
    } else run = 0;
  }

  const definitionOpenings = prose.filter((b) => DEFINITION_OPENING.test(b.text.trim())).length;
  const firstPersonMentions = [...text.matchAll(FIRST_PERSON)].length;

  const sentences = prose.flatMap((b) => splitSentences(b.text));
  const openings = sentences.map((s) => s.trim().toLowerCase().split(/\s+/).slice(0, 2).join(' ').replace(/[^\p{L}\p{N} ]/gu, '')).filter((o) => o.split(' ').length === 2);
  const counts = new Map<string, number>();
  for (const o of openings) counts.set(o, (counts.get(o) ?? 0) + 1);
  const repeatedOpenings = [...counts].filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]).map(([o, n]) => `"${o}…" ×${n}`);
  let sameFirstWordRun = 0;
  let streak = 1;
  for (let i = 1; i < sentences.length; i += 1) {
    const a = sentences[i - 1]!.trim().split(/\s+/)[0]?.toLowerCase();
    const b = sentences[i]!.trim().split(/\s+/)[0]?.toLowerCase();
    streak = a && a === b ? streak + 1 : 1;
    if (streak === 3) sameFirstWordRun += 1;
  }

  const findings: DrynessFinding[] = [];
  const long = words >= 300;
  if (long && listItemShare > 0.35) findings.push({ rule: 'list-density', severity: 'warning', message: `${Math.round(listItemShare * 100)}% of text blocks are list items. Reasoning belongs in prose; lists read like documentation.` });
  if (long && headingsPer1000 > 10) findings.push({ rule: 'heading-density', severity: 'warning', message: `${headings.length} headings (${headingsPer1000}/1000 words). Very dense sectioning reads like a spec or README.` });
  if (maxRun >= 5) findings.push({ rule: 'short-paragraph-run', severity: 'warning', message: `${maxRun} very short paragraphs in a row. Choppy, repetitive paragraphs read like generated summaries.` });
  if (definitionOpenings >= 3) findings.push({ rule: 'definition-openings', severity: 'warning', message: `${definitionOpenings} paragraphs open with a definition ("X — это…"). Repeated definition-first openings read like a glossary.` });
  if (repeatedOpenings.length) findings.push({ rule: 'repeated-openings', severity: 'info', message: `Repeated sentence openings: ${repeatedOpenings.slice(0, 4).join(', ')}.` });
  if (sameFirstWordRun > 0) findings.push({ rule: 'same-first-word', severity: 'info', message: `${sameFirstWordRun} run(s) of three consecutive sentences starting with the same word.` });
  return {
    words,
    metrics: { paragraphs: article.paragraphCount, headings: headings.length, headingsPer1000, listItemShare, shortParagraphRunMax: maxRun, definitionOpenings, firstPersonMentions, repeatedOpenings },
    findings,
  };
}
