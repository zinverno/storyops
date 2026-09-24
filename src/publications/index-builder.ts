import { normalizeGlossary, type GlossaryEntry, type ProjectConfig } from '../config/schema.js';
import { Corpus, features } from '../similarity/index.js';
import type { Clock } from '../shared/clock.js';
import { normalizeText, splitSentences, stem, tokenize, truncate, unique, wordCount } from '../shared/text.js';
import { estimateDepth } from './depth.js';
import {
  PUBLICATION_INDEX_SCHEMA_VERSION,
  type ConceptMention,
  type DerivedField,
  type PublicationIndex,
  type PublicationIndexEntry,
  type PublicationRole,
} from './index-schema.js';
import type { Publication } from './schema.js';

export const INDEX_METHOD =
  'Deterministic heuristics: project detection by name/alias/glossary match; roles by title/heading patterns; concepts from project glossary, section headings and top TF-IDF terms (explained = in a heading, or ≥3 occurrences in a non-brief publication); sentence extraction by lexical markers. Fields marked "unresolved" are left for agent or manual interpretation.';

const ROLE_PATTERNS: Array<[PublicationRole, RegExp]> = [
  ['project-introduction', /зачем (?:я|мы|нужен|нужна)|знакомств|представля|введение в|introduc|why i built|why we built|meet\b|что такое|как (?:я|мы) (?:написал|сделал|начал)|мой (?:проект|pet)|pet-проект|с чего (?:всё|все) началось/i],
  ['architecture', /архитектур|как устроен|устройство|под капотом|внутреннее устройство|architecture|internals|how .{1,40} works|design of/i],
  ['postmortem', /постмортем|postmortem|инцидент|что пошло не так|разбор (?:полёта|полета|аварии)/i],
  ['tutorial', /руководство|туториал|tutorial|пошагов|step[- ]by[- ]step|how to|гайд/i],
  ['release', /релиз|release|версия \d|\bv\d+\.\d+/i],
  ['update', /что нового|обновлени|новое в|update|changelog|прогресс|devlog|дневник разработки/i],
];

const PROBLEM = /проблем|не работал|ломал|сломал|падал|упал|тормозил|медленн|ошиб|баг|терял|утечк|не справля|не масштабир|столкнул|ограничени|не хватало|problem|broke|failed|\bbug|slow|didn't scale|limitation|bottleneck/i;
const RESULT = /в итоге|удалось|получилось|стало быстрее|ускорил|сократил|уменьшил|выросл|теперь (?:умеет|можно|работает)|результат|result|reduced|improved|faster|now (?:supports|works|can)/i;
const MEASUREMENT = /\d+(?:[.,]\d+)?\s?(?:ms|мс|сек|секунд|s\b|%|x\b|×|раз|mb|мб|gb|гб|rps|qps)/i;
const PLAN = /планирую|планируем|в следующ(?:ей|ий|ем) (?:стать|част|раз|верси|пост)|дальше (?:я |мы )?(?:хочу|планир|займусь|расскажу)|хочу добавить|собираюсь|расскажу (?:позже|отдельно|в следующ)|в планах|todo|roadmap|next step|in the next (?:post|article|part)|\bi plan\b|\bwe plan\b|will add|coming soon/i;
const OPEN_QUESTION = /открыт(?:ый|ым|ые) вопрос|пока не (?:знаю|решил|ясно|понятно)|не решено|остаётся вопрос|остается вопрос|open question|still unclear|not sure yet/i;
/** Structural headings that are not subject matter. */
const GENERIC_HEADING = /^(?:что дальше|дальше|итоги?|выводы?|заключение|введение|вступление|как запустить|установка|ссылки|благодарности|вместо заключения|p\.?s\.?|conclusion|summary|introduction|next steps|what'?s next|installation|references|links)\.?$/i;
const ARCHITECTURE = /состоит из|компонент|модул|слой|конвейер|pipeline|архитектур|хранилищ|consists of|component|module|layer|storage|движок|engine/i;

function field(values: string[], method: DerivedField['method'] = 'heuristic', note?: string): DerivedField {
  const f: DerivedField = { values: unique(values), method: values.length === 0 ? 'unresolved' : method };
  if (note) f.note = note;
  return f;
}

function sentencesMatching(sentences: readonly string[], pattern: RegExp, limit: number): string[] {
  return sentences.filter((s) => pattern.test(s)).slice(0, limit).map((s) => truncate(s, 280));
}

export function conceptKey(text: string): string {
  return tokenize(text).join(' ');
}

function countPhrase(haystackStems: readonly string[], phraseStems: readonly string[]): number {
  if (phraseStems.length === 0) return 0;
  let count = 0;
  for (let i = 0; i + phraseStems.length <= haystackStems.length; i += 1) {
    let ok = true;
    for (let j = 0; j < phraseStems.length; j += 1) {
      if (haystackStems[i + j] !== phraseStems[j]) {
        ok = false;
        break;
      }
    }
    if (ok) count += 1;
  }
  return count;
}

export function detectProjects(publication: Publication, projects: readonly ProjectConfig[]): string[] {
  const haystack = normalizeText(`${publication.title} ${publication.lead ?? ''} ${publication.text} ${publication.tags.join(' ')}`);
  const found = new Set(publication.projectReferences);
  for (const project of projects) {
    const names = [project.id, project.name, ...project.aliases].map((n) => normalizeText(n)).filter((n) => n.length >= 3);
    if (names.some((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'u').test(haystack))) found.add(project.id);
  }
  return [...found].sort();
}

export function detectRoles(publication: Publication): PublicationRole[] {
  const titleAndLead = `${publication.title}\n${publication.lead ?? ''}`;
  const headingText = publication.headings.map((h) => h.text);
  const roles = new Set<PublicationRole>();
  for (const [role, pattern] of ROLE_PATTERNS) {
    if (pattern.test(publication.title)) roles.add(role);
    else if (role === 'architecture' ? headingText.filter((h) => pattern.test(h)).length >= 1 && pattern.test(titleAndLead) : pattern.test(publication.lead ?? '')) roles.add(role);
  }
  if (headingText.filter((h) => ROLE_PATTERNS[1]![1].test(h)).length >= 2) roles.add('architecture');
  if (roles.size === 0) roles.add('other');
  return [...roles];
}

function extractConcepts(publication: Publication, glossary: readonly GlossaryEntry[], corpus: Corpus, depth: Publication['depth']): ConceptMention[] {
  const bodyStems = tokenize(publication.text);
  const headingStemSets = publication.headings.map((h) => tokenize(h.text));
  const mentions = new Map<string, ConceptMention>();
  const add = (concept: string, source: ConceptMention['source'], aliases: readonly string[] = []) => {
    const key = conceptKey(concept);
    if (!key) return;
    const phrases = [key, ...aliases.map(conceptKey).filter(Boolean)].map((k) => k.split(' '));
    let occurrences = 0;
    let inHeading = false;
    for (const phrase of phrases) {
      occurrences += countPhrase(bodyStems, phrase) + headingStemSets.reduce((sum, h) => sum + countPhrase(h, phrase), 0);
      inHeading ||= headingStemSets.some((h) => countPhrase(h, phrase) > 0);
    }
    if (occurrences === 0 && source !== 'heading') return;
    if (source === 'key-term' && occurrences < 2) return;
    const explained = inHeading || (occurrences >= 3 && depth !== 'brief');
    const existing = mentions.get(key);
    const mention: ConceptMention = { concept, key, depth: explained ? 'explained' : 'mentioned', occurrences: Math.max(occurrences, 1), inHeading, source };
    if (!existing || (existing.depth === 'mentioned' && mention.depth === 'explained')) mentions.set(key, existing ? { ...mention, source: existing.source } : mention);
  };
  for (const entry of glossary) add(entry.term, 'glossary', entry.aliases);
  for (const h of publication.headings) if (h.level <= 3 && wordCount(h.text) <= 8 && !GENERIC_HEADING.test(h.text.trim())) add(h.text, 'heading');
  const tf = features(`${publication.title} ${publication.text}`);
  for (const term of corpus.topTerms(tf, 8)) {
    if (term.includes(' ') || term.length >= 5) add(term, 'key-term');
  }
  return [...mentions.values()].sort((a, b) => Number(b.depth === 'explained') - Number(a.depth === 'explained') || b.occurrences - a.occurrences || a.key.localeCompare(b.key));
}

export function buildPublicationIndex(publications: readonly Publication[], projects: readonly ProjectConfig[], clock: Clock): PublicationIndex {
  const corpus = new Corpus(publications.map((p) => ({ id: p.id, text: `${p.title} ${p.text}` })));
  const glossary = projects.flatMap((p) => normalizeGlossary(p.glossary));
  const entries: PublicationIndexEntry[] = publications.map((pub) => {
    const words = pub.wordCount ?? wordCount(pub.text);
    const depth = pub.depth ?? estimateDepth({ words, headings: pub.headings.length, codeBlocks: pub.codeBlocks.length });
    const sentences = splitSentences(pub.text);
    const leadSentences = splitSentences(pub.lead ?? pub.text.slice(0, 800));
    const results = sentences.filter((s) => RESULT.test(s) || MEASUREMENT.test(s)).slice(0, 5).map((s) => truncate(s, 280));
    const questions = unique([...sentences.filter((s) => /\?\s*$/.test(s) && !leadSentences.includes(s)), ...sentencesMatching(sentences, OPEN_QUESTION, 5)]).slice(0, 5);
    const archHeadings = pub.headings.filter((h) => ARCHITECTURE.test(h.text)).map((h) => `section: ${h.text}`);
    const projectsFound = detectProjects(pub, projects);
    const entry: PublicationIndexEntry = {
      publicationId: pub.id,
      platform: pub.platform,
      title: pub.title,
      depth,
      wordCount: words,
      projects: field(projectsFound, 'heuristic', projectsFound.length === 0 ? 'No configured project name/alias found; set projectReferences manually if needed.' : undefined),
      roles: detectRoles(pub),
      mainSubject: field([pub.title], 'heuristic', 'Title used as subject; refine if the title is figurative.'),
      mainThesis: field(leadSentences.slice(0, 1).map((s) => truncate(s, 280)), 'heuristic', 'First lead sentence as a candidate thesis; confirm or replace.'),
      concepts: extractConcepts(pub, glossary, corpus, depth),
      architectureDescribed: field([...archHeadings, ...sentencesMatching(sentences, ARCHITECTURE, 4)]),
      problemsIntroduced: field(sentencesMatching(sentences, PROBLEM, 5)),
      resultsReported: field(results),
      futurePlans: field(sentencesMatching(sentences, PLAN, 8)),
      openQuestions: field(questions),
    };
    if (pub.url) entry.url = pub.url;
    if (pub.publicationDate) entry.date = pub.publicationDate;
    return entry;
  });
  return { schemaVersion: PUBLICATION_INDEX_SCHEMA_VERSION, generatedAt: clock.now().toISOString(), method: INDEX_METHOD, entries };
}

/** Stems a free-form phrase the same way concept keys are built. */
export function stemPhrase(text: string): string {
  return normalizeText(text).split(' ').map(stem).join(' ');
}
