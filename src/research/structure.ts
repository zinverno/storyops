import { rawTokens, wordCount } from '../shared/text.js';
import { blockWords, type ContentBlock } from './blocks.js';
import type { StructuralFeatures, TitleFeatures } from './types.js';

/**
 * Abstract, non-reproducible features of a title/article. Nothing here keeps
 * wording from the source: only booleans and counts.
 */

const CONFLICT = /почему|проблем|ошиб|баг|терял|потер|упёрл|уперл|слома|сломал|упал|падал|не работа|боль|разбор|инцидент|утечк|тормоз|медленн|не справ|не взлет|не взлёт|провал|ловушк|подвох|why|broke|broken|\bbug|fail|problem|outage|incident|slow|leak|pitfall|mistake|\bvs\.?\b|против/i;
const POSTMORTEM = /постмортем|postmortem|post-mortem|инцидент|разбор (?:полёта|полета|инцидента|аварии|падения)|что пошло не так|what went wrong|outage|авари/i;
const BEFORE_AFTER = /до и после|было и стало|переход(?:им|ил|или|ят)? (?:с|на) |мигр|migrat|переписал|переписыва|rewrote|rewrite|→|->|\bс \S+ на \S+/i;
const HOW_TO = /^(?:как|how)\b|how to|how we|как мы|руководство|гайд|\bguide\b|tutorial|пошагов/i;
const FIRST_PERSON = new Set(['я', 'мы', 'мой', 'моя', 'моё', 'мое', 'мои', 'наш', 'наша', 'наше', 'наши', 'нам', 'меня', 'нас', 'i', 'we', 'my', 'our', 'us']);
const AI_TOKENS = /^(?:ии|ai|llm|llms|gpt|chatgpt|gpt-\d.*|нейросет\p{L}*|нейронк\p{L}*|нейронн\p{L}*|claude|copilot|gemini|агент\p{L}*|genai|ml)$/u;

export function titleFeatures(title: string): TitleFeatures {
  // Split hyphenated compounds too ("ИИ-ассистенты" → "ии", "ассистенты").
  const tokens = rawTokens(title).flatMap((t) => [t, ...(t.includes('-') ? t.split('-') : [])]);
  return {
    chars: [...title].length,
    words: wordCount(title),
    isQuestion: /\?\s*$/.test(title.trim()),
    hasNumber: /\d/.test(title),
    firstPerson: tokens.some((t) => FIRST_PERSON.has(t)),
    conflictFraming: CONFLICT.test(title),
    postmortemFraming: POSTMORTEM.test(title),
    beforeAfterFraming: BEFORE_AFTER.test(title),
    howToFraming: HOW_TO.test(title.trim()),
    hasSubtitleSeparator: /[:—–]|\s-\s|\.\s\S/.test(title),
    aiTopic: tokens.some((t) => AI_TOKENS.test(t)) || /искусственн\p{L}* интеллект|artificial intelligence/iu.test(title),
  };
}

const MEASUREMENT = /\d+(?:[.,]\d+)?\s?(?:ms|мс|µs|мкс|сек|секунд\p{L}*|s\b|%|x\b|×|раз\p{L}*|mb|мб|gb|гб|kb|кб|rps|qps|ops|p9\d|строк\p{L}*|lines)/iu;
const CONFLICT_SENTENCE = /проблем|не работал|ломал|сломал|падал|упал|тормозил|медленн|ошиб|баг|терял|потер|начал[аи]? (?:ждать|падать|тормозить|терять)|утечк|не справля|не масштабир|оказалось|столкнул|перестал|ограничени|упёрл|уперл|problem|broke|failed|\bbug|slow|couldn't|could not|didn't scale|ran into|limitation|bottleneck/iu;
const DIAGRAM = /diagram|схем|архитектур|architecture|flow|mermaid|sequence|plantuml|c4/i;
const SUMMARY_HEADING = /итог|вывод|заключ|conclusion|summary|резюме|takeaway/i;
const NEXT_HEADING = /дальше|план|next|roadmap|будущ|future/i;
const POSTMORTEM_HEADING = /хронолог|timeline|причин|root cause|что пошло не так|lessons|урок|инцидент|impact|последстви/i;
const BEFORE_HEADING = /^(?:до\b|было|старая|старый|прежн|before|old\b|legacy)|как было/i;
const AFTER_HEADING = /^(?:после|стало|новая|новый|after|new\b)|как стало/i;

export function structuralFeatures(blocks: readonly ContentBlock[]): StructuralFeatures {
  let words = 0;
  let introWords = 0;
  let seenHeading = false;
  let codeLines = 0;
  let codeBlocks = 0;
  let images = 0;
  let diagramHints = 0;
  let hasMeasurements = false;
  let wordsBeforeTechnical: number | undefined;
  let wordsBeforeConflict: number | undefined;
  const headings: string[] = [];
  let lastParagraph = '';

  for (const block of blocks) {
    const w = blockWords(block);
    if (block.type === 'heading') {
      if (block.level <= 3) headings.push(block.text);
      seenHeading = true;
    }
    if (block.type === 'code') {
      codeBlocks += 1;
      codeLines += block.lines;
      if (/mermaid|plantuml/i.test(block.language ?? '')) diagramHints += 1;
      wordsBeforeTechnical ??= words;
    }
    if (block.type === 'image') {
      images += 1;
      if (DIAGRAM.test(`${block.alt ?? ''} ${block.caption ?? ''} ${block.src}`)) diagramHints += 1;
    }
    if (block.type === 'paragraph' || block.type === 'list' || block.type === 'quote') {
      const text = block.type === 'list' ? block.items.join(' ') : block.text;
      if (MEASUREMENT.test(text)) {
        hasMeasurements = true;
        wordsBeforeTechnical ??= words;
      }
      if (/`[^`]+`/.test(text)) wordsBeforeTechnical ??= words;
      if (wordsBeforeConflict === undefined && CONFLICT_SENTENCE.test(text)) wordsBeforeConflict = words;
      if (block.type === 'paragraph') lastParagraph = block.text;
    }
    if (!seenHeading) introWords += w;
    words += w;
  }

  const lastHeading = headings.at(-1) ?? '';
  let conclusionKind: StructuralFeatures['conclusionKind'] = 'none';
  if (NEXT_HEADING.test(lastHeading)) conclusionKind = 'next-steps';
  else if (SUMMARY_HEADING.test(lastHeading)) conclusionKind = 'summary';
  else if (/\?\s*$/.test(lastParagraph)) conclusionKind = 'questions';

  const proseLines = Math.max(1, Math.round(words / 12));
  return {
    wordCount: words,
    introWords,
    sectionCount: headings.length,
    codeBlocks,
    codeDensity: round(codeLines / (codeLines + proseLines), 3),
    images,
    imagesPer1000Words: round(words > 0 ? (images * 1000) / words : 0, 2),
    diagramHints,
    hasMeasurements,
    wordsBeforeFirstTechnicalDetail: wordsBeforeTechnical,
    wordsBeforeConflict,
    conclusionKind,
    postmortemStructure: headings.some((h) => POSTMORTEM_HEADING.test(h)),
    beforeAfterStructure: headings.some((h) => BEFORE_HEADING.test(h.trim())) && headings.some((h) => AFTER_HEADING.test(h.trim())),
  };
}

export function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
