import path from 'node:path';
import { appendFile, copyFile, readFile } from 'node:fs/promises';
import { createDefaultRegistry } from '../../platforms/registry.js';
import { loadConfig } from '../config/load.js';
import { itemsByPriority, parseAuthorInput, type AuthorInput } from '../editorial/author-input.js';
import { auditDraft, editorialAuditSchema, type EditorialAudit } from '../editorial/audit.js';
import { directionSchema } from '../editorial/direction.js';
import { patternTransferSchema } from '../editorial/pattern-transfer.js';
import { voicePlanSchema } from '../editorial/voice-plan.js';
import { fixedClock, type Clock } from '../shared/clock.js';
import { readText, writeJson } from '../shared/fs.js';
import { silentLogger, type Logger } from '../shared/logger.js';
import { mdList } from '../shared/markdown.js';
import { resolveWorkspace } from '../shared/workspace.js';
import type { AppContext } from '../workflow/context.js';
import { editorialAuditWorkflow, editorialPlanWorkflow, editorialValidateWorkflow, inputAddWorkflow, inputInitWorkflow, type ValidateResult } from '../workflow/editorial.js';
import { DEMO_NOW } from './run.js';
import { packageRoot } from './paths.js';

/**
 * Offline editorial-layer scenario on top of `runDemo`'s workspace:
 * author input → plan (engineering-story, Habr) → the decisions an agent would
 * record (fixtures/editorial/decisions.json) → validate → fixture draft →
 * audit (before and after incorporation records) → a negative variant.
 */

export interface EditorialDemoResult {
  storyFile: string;
  authorInput: AuthorInput;
  validationBefore: ValidateResult;
  validation: ValidateResult;
  auditBeforeMapping: EditorialAudit;
  audit: EditorialAudit;
  negativeAudit: EditorialAudit;
  output: string;
  summary: string[];
}

type Json = Record<string, unknown>;

/** Replaces "@<priority>:<n>" placeholders (in keys and values) with author-input item ids. */
function resolvePlaceholders<T>(value: T, input: AuthorInput): T {
  const by = itemsByPriority(input);
  const resolve = (s: string) =>
    s.replace(/^@([a-z]+):(\d+)$/, (m, prio: string, n: string) => {
      const item = (by as Record<string, Array<{ id: string }>>)[prio]?.[Number(n)];
      if (!item) throw new Error(`decisions.json: no author input item for ${m}`);
      return item.id;
    });
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return resolve(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Json).map(([k, x]) => [resolve(k), walk(x)]));
    return v;
  };
  return walk(value) as T;
}

async function editJson(file: string, edit: (data: Json) => void): Promise<void> {
  const data = JSON.parse(await readText(file)) as Json;
  edit(data);
  await writeJson(file, data);
}

export async function runEditorialDemo(root: string, options: { logger?: Logger; clock?: Clock } = {}): Promise<EditorialDemoResult> {
  const pkg = packageRoot();
  const clock = options.clock ?? fixedClock(DEMO_NOW);
  const workspace = resolveWorkspace(root);
  const ctx: AppContext = { workspace, config: await loadConfig(workspace.configFile), registry: createDefaultRegistry(), clock, logger: options.logger ?? silentLogger };
  const storyFile = path.join(workspace.articlesDir, 'notegarden-health-model', 'story.json');
  const fixtures = path.join(pkg, 'fixtures', 'editorial');

  // 1. Author input: the template, then the author's raw material, then one item added from the CLI.
  const { file: inputFile } = await inputInitWorkflow(storyFile);
  await copyFile(path.join(fixtures, 'author-input.md'), inputFile);
  await inputAddWorkflow(storyFile, 'may', 'Можно пошутить, что у аудита была профессиональная амнезия: каждый запуск он знакомился с хранилищем заново.');
  const authorInput = parseAuthorInput(await readText(inputFile), { expectedStory: 'notegarden-health-model' });

  // 2. Deterministic scaffolds.
  const { files } = await editorialPlanWorkflow(ctx, storyFile, 'habr', { style: 'engineering-story' });
  const validationBefore = await editorialValidateWorkflow(ctx, storyFile, 'habr');

  // 3. The editorial decisions an agent following editorial-author would record.
  const decisions = resolvePlaceholders(JSON.parse(await readFile(path.join(fixtures, 'decisions.json'), 'utf8')) as Json, authorInput);
  const pt = decisions.patternTransfer as { default: Json; items: Record<string, Json> };
  await editJson(files.patternTransfer.json, (data) => {
    for (const item of data.items as Json[]) {
      const d = pt.items[item.id as string];
      if (d) Object.assign(item, d);
      else if (item.decision === 'pending') Object.assign(item, pt.default);
    }
    patternTransferSchema.parse(data);
  });
  const dir = decisions.direction as Json & { visuals: Record<string, string>; authorVoiceReferences: Json[] };
  await editJson(files.direction.json, (data) => {
    const { visuals, authorVoiceReferences, ...fields } = dir;
    Object.assign(data, fields);
    for (const v of data.visuals as Json[]) v.section = visuals[v.visualId as string] ?? v.section;
    (data.authorVoiceReferences as Json).selected = authorVoiceReferences;
    directionSchema.parse(data);
  });
  const vp = decisions.voicePlan as Json & { authorMaterial: Record<string, Json>; openQuestions: Record<string, string>; limitations: Record<string, Json>; calibration: Json };
  await editJson(files.voicePlan.json, (data) => {
    const { authorMaterial, openQuestions, limitations, calibration, ...fields } = vp;
    Object.assign(data, fields);
    for (const m of data.authorMaterial as Json[]) Object.assign(m, authorMaterial[m.itemId as string] ?? {});
    for (const q of data.openQuestions as Json[]) q.answer = openQuestions[q.itemId as string] ?? q.answer;
    for (const l of data.limitations as Json[]) Object.assign(l, limitations[l.text as string] ?? {});
    Object.assign(data.calibration as Json, calibration);
    voicePlanSchema.parse(data);
  });
  const validation = await editorialValidateWorkflow(ctx, storyFile, 'habr');

  // 4. Draft (fixture prose), then audit: first without incorporation records, then with them.
  const output = path.join(path.dirname(storyFile), 'outputs', 'habr.md');
  await copyFile(path.join(fixtures, 'habr-draft.md'), output);
  const { audit: auditBeforeMapping } = await editorialAuditWorkflow(ctx, storyFile, 'habr', output);
  const mapping = decisions.audit as { material: Record<string, Json>; patterns: Record<string, Json> };
  await editJson(files.audit.json, (data) => {
    for (const m of data.material as Json[]) Object.assign(m, mapping.material[m.itemId as string] ?? {});
    for (const p of data.patterns as Json[]) Object.assign(p, mapping.patterns[p.patternId as string] ?? {});
    editorialAuditSchema.parse(data);
  });
  const { audit } = await editorialAuditWorkflow(ctx, storyFile, 'habr', output);

  // 5. Negative variant (in memory): forbidden wording inserted, VERBATIM phrase reworded.
  const draft = await readText(output);
  const bad = draft.replace('Главное изменение случилось с самой находкой.', 'Главное, революционный шаг случился с самой находкой.').replace('Finding перестал быть просто строкой в отчёте.', 'Finding больше не просто строка в отчёте.');
  const negativeAudit = auditDraft({ draftMarkdown: bad, output: 'outputs/habr.negative.md', story: 'notegarden-health-model', platform: 'habr', authorInput, styleProfile: 'ru-technical', now: clock.now().toISOString(), previous: audit });

  const s = audit.summary;
  const summary = [
    `Author input: ${authorInput.items.length} item(s) (${Object.entries(itemsByPriority(authorInput)).filter(([, v]) => v.length).map(([k, v]) => `${k} ${v.length}`).join(', ')}).`,
    `Plan before editorial decisions: ${validationBefore.ready ? 'ready' : `not ready (${validationBefore.issues.filter((i) => i.severity === 'error').length} error(s))`}; after: ${validation.ready ? 'ready for drafting' : 'NOT ready'}.`,
    `Style: engineering-story. Pattern transfer: ${auditBeforeMapping.patterns.map((p) => `${p.patternId} (${p.decision})`).join(', ')}.`,
    `Audit without incorporation records: ${auditBeforeMapping.summary.errors} error(s) (MUST unmapped: ${auditBeforeMapping.summary.must.unmapped}).`,
    `Audit with records: VERBATIM ${s.verbatim.incorporated}/${s.verbatim.total}, MUST ${s.must.incorporated}/${s.must.total}, SHOULD ${s.should.incorporated}/${s.should.total} (${s.should.omitted} omitted with reason), MAY ${s.may.used} used, DO NOT USE violations ${s.avoid.violations}, patterns ${s.patterns.incorporated}/${s.patterns.expected} mapped; ${s.errors} error(s).`,
    `Negative variant: ${negativeAudit.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' | ')}`,
  ];
  await appendFile(path.join(root, 'DEMO.md'), ['', '## Editorial layer (Phase 2)', '', mdList(summary), '', `Artifacts: ${path.relative(root, path.dirname(storyFile))}/author-input.md, editorial/, outputs/habr.md (fixture draft).`, ''].join('\n'));
  return { storyFile, authorInput, validationBefore, validation, auditBeforeMapping, audit, negativeAudit, output, summary };
}
