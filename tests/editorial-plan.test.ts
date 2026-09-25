import { beforeAll, describe, expect, it } from 'vitest';
import { itemsByPriority, parseAuthorInput } from '../src/editorial/author-input.js';
import { buildDirection, validateDirection, type DirectionInput, type EditorialDirection } from '../src/editorial/direction.js';
import { buildPatternTransfer } from '../src/editorial/pattern-transfer.js';
import { compareProvenance, storyContentHash, strategyRef } from '../src/editorial/provenance.js';
import { loadStyleCatalog, type StyleCatalog } from '../src/editorial/styles.js';
import { buildVoicePlan, calibrationRule, validateVoicePlan, type VoicePlan } from '../src/editorial/voice-plan.js';
import { AUTHOR_INPUT, authorInput, exampleStory, habrStrategy, provenance, snapshot, STYLES_DIR } from './editorial-helpers.js';

const NOW = '2026-09-25T10:00:00.000Z';
let catalog: StyleCatalog;
beforeAll(async () => {
  catalog = await loadStyleCatalog({ builtInDir: STYLES_DIR });
});

function directionInput(overrides: Partial<DirectionInput> = {}): DirectionInput {
  return {
    story: exampleStory(),
    strategy: habrStrategy(),
    publicationType: 'architecture-deep-dive',
    style: catalog.get('engineering-story'),
    styleChosenBy: 'user',
    styleCandidates: catalog.suitableFor('architecture-deep-dive'),
    authorInput: authorInput(),
    authorVoice: { styleProfile: 'ru-technical', tone: '', voiceNotes: [] },
    voiceCandidates: [{ publicationId: 'habr:900002', title: 'Как устроен Notegarden', platform: 'habr' }],
    references: { story: 'story.json', evidence: 'evidence.md', brief: 'briefs/habr.md', authorInput: 'author-input.md', authorProfile: null, patternTransfer: 'editorial/pattern-transfer.md', voicePlan: 'editorial/voice-plan.md', research: '.editorial/research/2026-09-24/habr.json' },
    basedOn: provenance(),
    now: NOW,
    ...overrides,
  };
}

function filled(d: EditorialDirection): EditorialDirection {
  return {
    ...d,
    readerPromise: 'How an audit that forgot everything learned to remember findings.',
    coreAngle: 'The known architecture stopped fitting regular use.',
    primaryConflict: 'New and already-seen findings were indistinguishable.',
    notAbout: ['A feature list'],
    openingApproach: 'Open on the noisy report.',
    narrativeEmphasis: 'The finding lifecycle.',
    technicalDepth: 'High.',
    personalDepth: 'Moderate.',
    humorPolicy: 'One light joke from the author.',
    codePolicy: 'Two snippets.',
    visualPolicy: 'Lifecycle code as the visual.',
    visuals: d.visuals.map((v) => ({ ...v, section: 'lifecycle' })),
  };
}

const ids = new Set(['habr:900002']);

describe('editorial direction', () => {
  it('records style, platform, publication type, author input and research references', () => {
    const d = buildDirection(directionInput());
    expect(d.platform).toBe('habr');
    expect(d.publicationType).toBe('architecture-deep-dive');
    expect(d.style).toMatchObject({ id: 'engineering-story', version: '1.0.0', status: 'selected', chosenBy: 'user' });
    expect(d.basedOn.authorInput?.hash).toBe(authorInput().sourceHash);
    expect(d.basedOn.story.hash).toBe(storyContentHash(exampleStory()));
    expect(d.basedOn.platformStrategy).toEqual(strategyRef(habrStrategy()));
    expect(d.basedOn.research?.file).toBe('.editorial/research/2026-09-24/habr.json');
    expect(d.references.authorInput).toBe('author-input.md');
    expect(d.lengthRange).toMatchObject({ min: 1500, max: 5000, unit: 'words' });
    expect(d.material.mustAppear.map((m) => m.priority)).toEqual(['verbatim', 'must']);
    expect(d.material.mustNotAppear.map((m) => m.text)).toEqual(['революционный']);
  });

  it('unresolved required fields block validation; a filled direction passes', () => {
    const scaffold = buildDirection(directionInput());
    const messages = validateDirection(scaffold, { catalog, publicationIds: ids }).filter((i) => i.severity === 'error').map((i) => i.message);
    expect(messages[0]).toMatch(/^Unresolved fields: readerPromise, coreAngle, primaryConflict/);
    expect(messages).toContain('State at least one thing this article is NOT about (notAbout).');
    expect(validateDirection(filled(scaffold), { catalog, publicationIds: ids }).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('without a style it proposes a short list and blocks validation', () => {
    const d = buildDirection(directionInput({ style: undefined, styleChosenBy: undefined, styleCandidates: catalog.suitableFor('postmortem').slice(0, 4) }));
    expect(d.style.status).toBe('pending');
    expect(d.style.candidates.length).toBeGreaterThan(0);
    expect(d.style.candidates.length).toBeLessThanOrEqual(4);
    expect(validateDirection(filled(d), { catalog, publicationIds: ids }).map((i) => i.message).join('\n')).toMatch(/No article style selected/);
  });

  it('an agent-chosen style needs a recorded rationale', () => {
    const d = filled(buildDirection(directionInput({ styleChosenBy: 'agent' })));
    expect(validateDirection(d, { catalog, publicationIds: ids }).map((i) => i.message)).toContain('The style was chosen by the agent but no rationale is recorded (style.rationale).');
  });

  it('voice references must be the author\'s own publications', () => {
    const d = filled(buildDirection(directionInput()));
    d.authorVoiceReferences.selected = [{ publicationId: 'habr:someone-else', use: 'rhythm', reusable: false }];
    expect(validateDirection(d, { catalog, publicationIds: ids }).some((i) => /Only the author's own writing/.test(i.message))).toBe(true);
  });

  it('surfaces conflicts between author material and the style instead of resolving them', () => {
    const input = parseAuthorInput(`${AUTHOR_INPUT}\n## MUST USE\n\n- Шутка про поле с двумя работами обязательна.\n`);
    const d = buildDirection(directionInput({ authorInput: input, style: catalog.get('postmortem') }));
    const conflict = d.conflicts.find((c) => c.kind === 'author-material-vs-style');
    expect(conflict?.description).toMatch(/uses no humor/);
    expect(validateDirection(filled(d), { catalog, publicationIds: ids }).some((i) => /Unresolved conflict/.test(i.message))).toBe(true);
  });

  it('keeps editorial decisions when refreshed', () => {
    const first = filled(buildDirection(directionInput()));
    const again = buildDirection(directionInput({ previous: first }));
    expect(again.readerPromise).toBe(first.readerPromise);
    expect(again.generatedAt).toBe(first.generatedAt);
  });

  it('platform strategy version changes are detectable', () => {
    const recorded = provenance();
    const bumped = provenance({ platformStrategy: { ...recorded.platformStrategy, version: '1.1.0', hash: 'new' } });
    expect(compareProvenance(recorded, bumped, 'editorial direction')[0]!.message).toBe('platform strategy habr changed version 1.0.0 → 1.1.0 since editorial direction was created');
    const style = provenance({ style: { id: 'dev-diary', version: '1.0.0', hash: 'x' } });
    expect(compareProvenance(recorded, style, 'voice plan')[0]!.message).toBe('article style changed from "engineering-story" to "dev-diary" since voice plan was created');
  });
});

describe('voice plan', () => {
  const story = exampleStory();
  const input = authorInput();
  const by = itemsByPriority(input);
  const pt = (() => {
    const p = buildPatternTransfer({ story: story.slug, platform: 'habr', now: NOW, basedOn: provenance(), snapshot: { snapshot: snapshot(), file: 'r.json' } });
    p.items = p.items.map((i) => (i.id === 'body-conflict-early' ? { ...i, decision: 'apply', rationale: 'r', placement: ['opening'], consequence: 'c' } : i.decision === 'pending' ? { ...i, decision: 'skip', rationale: 'r' } : i));
    return p;
  })();
  const scaffold = () => buildVoicePlan({ story, platform: 'habr', style: 'engineering-story', authorInput: input, lengthRange: { max: 5000, unit: 'words' }, basedOn: provenance(), now: NOW, samplePath: 'editorial/voice-sample.md' });
  const complete = (): VoicePlan => ({
    ...scaffold(),
    readerExperience: 'The moment a forgetful tool starts to remember.',
    conflictPlacement: 'First paragraph.',
    narrativeMovement: [
      { id: 'hook', summary: 'The noisy report.', purpose: 'Hook.', mode: 'scene', pace: 'brisk', claimIds: [], evidenceRefs: [], authorItemIds: [by.must[0]!.id], patternIds: ['body-conflict-early'], visualIds: [] },
      { id: 'lifecycle', summary: 'The finding gets a lifecycle.', purpose: 'Central episode.', mode: 'scene', pace: 'slow', claimIds: ['lifecycle-states'], evidenceRefs: [], authorItemIds: [by.verbatim[0]!.id], patternIds: [], visualIds: ['finding-lifecycle'] },
    ],
    documentationRisks: [{ beatId: 'lifecycle', risk: 'inventory', mitigation: 'tell it as a consequence' }],
    authorMaterial: scaffold().authorMaterial.map((m) => (m.priority === 'verbatim' ? { ...m, status: 'planned', beatId: 'lifecycle' } : m.priority === 'must' ? { ...m, status: 'planned', beatId: 'hook' } : m.priority === 'should' ? { ...m, status: 'omitted', reason: 'not in the story yet' } : m)),
    limitations: scaffold().limitations.map((l) => ({ ...l, beatId: 'lifecycle' })),
  });

  it('prefills author material, limitations and the calibration rule', () => {
    const vp = scaffold();
    expect(vp.authorMaterial.map((m) => [m.priority, m.status])).toEqual([
      ['verbatim', 'pending'],
      ['must', 'pending'],
      ['should', 'pending'],
      ['may', 'optional'],
    ]);
    expect(vp.limitations.map((l) => l.text)).toEqual(story.limitations);
    expect(vp.calibration).toMatchObject({ required: true, status: 'pending', sample: 'editorial/voice-sample.md' });
    expect(calibrationRule({ max: 600, unit: 'words' }).required).toBe(false);
    expect(calibrationRule({ max: 4096, unit: 'characters' }).required).toBe(false);
  });

  it('unresolved plan blocks validation; a complete plan passes', () => {
    const errors = validateVoicePlan(scaffold(), { story, authorInput: input, patternTransfer: pt }).filter((i) => i.severity === 'error').map((i) => i.message);
    expect(errors).toContain('readerExperience is unresolved.');
    expect(errors).toContain('narrativeMovement is empty: plan the beats before drafting.');
    expect(errors.some((e) => /VERBATIM item .* is not placed yet/.test(e))).toBe(true);
    expect(validateVoicePlan(complete(), { story, authorInput: input, patternTransfer: pt }).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('trend patterns can never become factual claims', () => {
    const vp = complete();
    vp.narrativeMovement[0]!.claimIds = ['body-conflict-early'];
    vp.narrativeMovement[1]!.claimIds = ['invented-benchmark'];
    const errors = validateVoicePlan(vp, { story, authorInput: input, patternTransfer: pt }).map((i) => i.message);
    expect(errors).toContain('Beat "hook" lists trend pattern "body-conflict-early" as a claim. Trend patterns shape packaging; they can never become factual claims (use patternIds).');
    expect(errors).toContain('Beat "lifecycle" references claim "invented-benchmark", which is not in the canonical story. Facts enter the article only through story.json claims.');
  });

  it('a skipped pattern cannot shape a beat; an applied one should', () => {
    const vp = complete();
    vp.narrativeMovement[1]!.patternIds = ['median-title-length'];
    expect(validateVoicePlan(vp, { story, authorInput: input, patternTransfer: pt }).map((i) => i.message)).toContain('Beat "lifecycle" uses pattern "median-title-length", whose decision is "skip".');
    const unused = complete();
    unused.narrativeMovement[0]!.patternIds = [];
    expect(validateVoicePlan(unused, { story, authorInput: input, patternTransfer: pt }).some((i) => i.severity === 'warning' && /applied but no beat uses it/.test(i.message))).toBe(true);
  });

  it('MUST material cannot be dropped silently and VERBATIM cannot be dropped at all', () => {
    const vp = complete();
    vp.authorMaterial = vp.authorMaterial.map((m) => (m.priority === 'must' || m.priority === 'verbatim' ? { ...m, status: 'omitted', reason: '', beatId: '' } : m));
    const errors = validateVoicePlan(vp, { story, authorInput: input, patternTransfer: pt }).filter((i) => i.severity === 'error').map((i) => i.message);
    expect(errors.some((e) => /MUST item .* is omitted without a reason/.test(e))).toBe(true);
    expect(errors.some((e) => /a VERBATIM phrase cannot be omitted/.test(e))).toBe(true);
  });

  it('a changed author input shows up as stale items on refresh', () => {
    const edited = parseAuthorInput(AUTHOR_INPUT.replace('Объяснить конфликт', 'Объяснить главный конфликт'), { expectedStory: story.slug });
    const refreshed = buildVoicePlan({ story, platform: 'habr', style: 'engineering-story', authorInput: edited, lengthRange: { max: 5000, unit: 'words' }, basedOn: provenance(), now: NOW, previous: complete(), samplePath: 's' });
    const must = refreshed.authorMaterial.find((m) => m.priority === 'must')!;
    expect(must.status).toBe('pending');
    expect(validateVoicePlan(refreshed, { story, authorInput: edited, patternTransfer: pt }).some((i) => /references author input item .* no longer exists/.test(i.message))).toBe(true);
  });
});

describe('editorial direction refresh', () => {
  it('a new publication type resets the length range and asks for review', async () => {
    const catalog = await loadStyleCatalog({ builtInDir: STYLES_DIR });
    const base: DirectionInput = {
      story: exampleStory(), strategy: habrStrategy(), publicationType: 'architecture-deep-dive', style: catalog.get('engineering-story'), styleChosenBy: 'user', styleCandidates: [], authorInput: authorInput(),
      authorVoice: { styleProfile: 'ru-technical', tone: '', voiceNotes: [] }, voiceCandidates: [],
      references: { story: 's', evidence: 'e', brief: null, authorInput: 'a', authorProfile: null, patternTransfer: 'p', voicePlan: 'v', research: null }, basedOn: provenance(), now: NOW,
    };
    const first = buildDirection(base);
    const changed = buildDirection({ ...base, publicationType: 'product-update', previous: first });
    expect(changed.lengthRange).toMatchObject({ min: 500, max: 1500 });
    expect(changed.reviewRequired[0]).toMatch(/publication type changed from "architecture-deep-dive" to "product-update"/);
  });
});
