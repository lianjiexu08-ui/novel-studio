import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ChapterWorkflow, InMemoryWorkRepository } from '../src/index.ts';
import { annotationFixture, annotationWriter } from './review-annotation-fixture.ts';
import { fixtureDesignReview } from './fixtures.ts';
import { designReviewInput, designReviewOverview } from '../../../novel-service-core/src/design-review.ts';
import { withDesignReviewAnnotations, validateDesignReviewAnnotationContext } from '../../../novel-service-core/src/design-review-annotation-context.ts';
import { createDesignReviewRun, designReviewStageInput, acceptDesignReviewStage, completeDesignReviewRun } from '../../../novel-service-core/src/design-review-run.ts';
import { prepareDesignReviewEvidence } from '../../planner/src/design-review-evidence.ts';

test('new assessments freeze matching notes; resume, failure retry and restart idempotence never absorb late notes', async () => {
  const repository = new InMemoryWorkRepository();
  const { workflow, workId, run: original, input } = await annotationFixture(repository);
  const before = await workflow.snapshot(workId);
  const note = await workflow.addDesignReviewAnnotation(workId, input);
  const created = await workflow.startDesignReview(workId, 'world');
  assert.deepEqual(created.input.annotationContext?.notes, [note]);
  assert.equal(created.input.inputHash, original.input.inputHash);
  assert.deepEqual((await workflow.snapshot(workId)).designReviewRuns.get(original.id), original);
  assert.equal(designReviewOverview(await workflow.snapshot(workId)).ready, false);
  assert.deepEqual((await workflow.snapshot(workId)).designContentReviews, before.designContentReviews);
  const requests: string[] = [];
  const retrying = new ChapterWorkflow(repository, annotationWriter, {
    generateWorldPack: async () => { throw Error('unused'); }, generateStoryBible: async () => { throw Error('unused'); },
    reviewDesignContent: async current => {
      requests.push(JSON.stringify(current));
      if (requests.length === 1) throw Error('temporary failure');
      return fixtureDesignReview(current);
    },
  });
  await assert.rejects(() => retrying.stepDesignReview(workId, created.id), /temporary failure/);
  const late = await workflow.addDesignReviewAnnotation(workId, { ...input, requestKey: 'later', explanation: '后来补充，旧任务不能吸收。' });
  const resumed = await workflow.startDesignReview(workId, 'world');
  assert.equal(resumed.id, created.id);
  assert.deepEqual(resumed.input, created.input);
  await retrying.stepDesignReview(workId, created.id);
  assert.equal(requests[0], requests[1]);
  const next = await workflow.startDesignReview(workId, 'world');
  assert.deepEqual(new Set(next.input.annotationContext?.notes.map(n => n.id)), new Set([note.id, late.id]));
  assert.notEqual(prepareDesignReviewEvidence(next.input).requestId, prepareDesignReviewEvidence(created.input).requestId);
  const restarted = await workflow.restartDesignReview(workId, next.id, next.input.inputHash);
  await workflow.addDesignReviewAnnotation(workId, { ...input, requestKey: 'after-restart', explanation: '新建之后的说明。' });
  assert.deepEqual(await workflow.restartDesignReview(workId, next.id, next.input.inputHash), restarted);
  assert.deepEqual((await workflow.snapshot(workId)).designReviewRuns.get(original.id), original);
});

test('notes from other areas or versions are excluded; forged provenance, scope, hash and oversize fail closed', async () => {
  const { workflow, workId, input } = await annotationFixture(new InMemoryWorkRepository());
  const note = await workflow.addDesignReviewAnnotation(workId, input);
  const work = await workflow.snapshot(workId), plain = designReviewInput(work, 'world');
  const power = designReviewInput(work, 'power');
  assert.equal(withDesignReviewAnnotations(work, power), power);
  const otherVersion = { ...plain, inputHash: 'f'.repeat(64) };
  assert.equal(withDesignReviewAnnotations(work, otherVersion), otherVersion);
  const contextual = withDesignReviewAnnotations(work, plain);
  for (const change of [
    (value: typeof note) => { value.claimQuote = '完全不存在的原评语'; },
    (value: typeof note) => { value.evidence[0].quote = '完全不存在的原文'; },
    (value: typeof note) => { value.expectedCheckHash = 'f'.repeat(64); },
    (value: typeof note) => { value.scope.planRevision += 1; },
  ]) {
    const forged = structuredClone(work); change(forged.designReviewAnnotations.get(note.id)!);
    assert.throws(() => withDesignReviewAnnotations(forged, plain));
  }
  contextual.annotationContext!.notes[0].explanation = '保存之后被篡改';
  assert.throws(() => createDesignReviewRun(contextual), /快照不匹配/);
  for (let i = 0; i < 6; i++) await workflow.addDesignReviewAnnotation(workId, { ...input, requestKey: `large-${i}`, explanation: '长'.repeat(8000) });
  const before = await workflow.snapshot(workId);
  await assert.rejects(() => workflow.startDesignReview(workId, 'world'), /超过单次评审容量/);
  assert.deepEqual(await workflow.snapshot(workId), before, 'failed creation rolls back without truncating notes or adding a run');
});

test('large annotated assessments retain all sources, bounded cross/synthesis requests and adverse findings', async () => {
  const { workflow, workId, input } = await annotationFixture(new InMemoryWorkRepository());
  await workflow.addDesignReviewAnnotation(workId, input);
  const work = await workflow.snapshot(workId);
  const request = withDesignReviewAnnotations(work, designReviewInput(work, 'world'));
  request.annotationContext!.notes[0].explanation = '核对意见'.repeat(1900);
  // Exercise a near-limit snapshot with valid, separately identified notes.
  const base = request.annotationContext!.notes[0];
  request.annotationContext!.notes = Array.from({ length: 4 }, (_, i) => ({ ...structuredClone(base), id: `note-${i}` }));
  request.annotationContext!.sha256 = createHash('sha256').update(JSON.stringify(request.annotationContext!.notes)).digest('hex');
  const noteSize = validateDesignReviewAnnotationContext(request, true);
  request.sources.push({ id: 'large/early', text: '原文'.repeat(70_000) }, { id: 'large/late', text: '后期'.repeat(70_000) });
  const run = createDesignReviewRun(request);
  for (const source of request.sources) assert.equal(run.units.filter(u => u.sourceId === source.id).map(u => source.text.slice(u.start, u.end)).join(''), source.text);
  assert.ok(run.stages.some(s => s.kind === 'cross'));
  assert.ok(run.stages.some(s => s.kind === 'synthesis'));
  for (const stage of run.stages) {
    const staged = designReviewStageInput(run, stage);
    assert.ok(JSON.stringify(staged.sources).length + noteSize <= 240_000);
    assert.deepEqual(staged.annotationContext, request.annotationContext);
    assert.ok(staged.stage!.reportBudget!.maxCharacters < 90_000);
    const result = fixtureDesignReview(staged);
    // A real design defect must remain adverse even when editorial notes exist.
    for (const check of result.checks) Object.assign(check, { verdict: 'revise', revisionAdvice: '保留原返修，核对说明不能解除。' });
    acceptDesignReviewStage(run, stage, result);
  }
  assert.ok(completeDesignReviewRun(run).result.checks.every(check => check.verdict === 'revise'));
});
