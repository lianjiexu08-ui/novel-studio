// Isolated regression/UI fixture. No production DB access or model connection.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { JsonWorkRepository } from '../packages/persistence/src/json-repository.ts';
import { annotationFixture, annotationWriter } from '../packages/application/test/review-annotation-fixture.ts';
import { fixtureDesignReview } from '../packages/application/test/fixtures.ts';
import * as current from '../novel-service-core/src/design-review-run.ts';
import { JsonDesignPlanner } from '../packages/planner/src/index.ts';
import { prepareDesignReviewEvidence } from '../packages/planner/src/design-review-evidence.ts';
import { createApiServer } from '../apps/api/src/server.ts';

const root = path.resolve('data/audit-runtimes/annotation-context-verification-v2');
const proofPath = path.resolve('docs/audits/2026-10-18-annotation-context-verification.json');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
if (process.argv.includes('--serve')) {
  const proof = JSON.parse(fs.readFileSync(proofPath));
  assert.equal(process.env.API_CORS_ORIGIN, 'http://127.0.0.1:5181');
  const { app } = createApiServer({ repository: new JsonWorkRepository(path.join(root, 'fixture.json')), provider: annotationWriter, allowBatchRuns: false });
  await app.listen({ host: '127.0.0.1', port: 8788 });
  console.log(JSON.stringify({ fixtureOnly: true, workId: proof.workId, port: 8788, pid: process.pid }));
  process.once('SIGTERM', async () => { await app.close(); process.exit(0); });
} else {
  assert.ok(!fs.existsSync(root), 'Preserve previous verification artifacts');
  fs.mkdirSync(root, { recursive: true });
  fs.copyFileSync(process.argv[1], path.join(root, 'verifier.mjs'));
  const baseline = 'c59c1f7f9a0c0ef5124b4824dfbbb0ba122b1e22';
  const baselineRoot = path.join(root, 'baseline');
  fs.mkdirSync(baselineRoot);
  const archive = execFileSync('git', ['archive', '--format=tar', baseline, 'novel-service-core', 'packages'], { maxBuffer: 30_000_000 });
  fs.writeFileSync(path.join(root, 'baseline.tar'), archive);
  execFileSync('tar', ['-xf', '-', '-C', baselineRoot], { input: archive });
  fs.symlinkSync(path.resolve('node_modules'), path.join(baselineRoot, 'node_modules'));
  const prior = await import(pathToFileURL(path.join(baselineRoot, 'novel-service-core/src/design-review-run.ts')).href);
  const { JsonDesignPlanner: PriorPlanner } = await import(pathToFileURL(path.join(baselineRoot, 'packages/planner/src/index.ts')).href);
  const repository = new JsonWorkRepository(path.join(root, 'fixture.json'));
  const { workflow, workId, run: original, input: annotation } = await annotationFixture(repository);
  const comparisons = [];
  for (const large of [false, true]) {
    const input = structuredClone(original.input);
    if (large) input.sources.push({ id: 'extra/source', text: '完整保留的原始材料。'.repeat(26_000) });
    const oldRun = prior.createDesignReviewRun(input), newRun = current.createDesignReviewRun(input);
    assert.deepEqual(newRun.units, oldRun.units);
    assert.deepEqual(newRun.stages, oldRun.stages);
    const requests = [];
    for (let index = 0; index < oldRun.stages.length; index++) {
      const oldInput = prior.designReviewStageInput(oldRun, oldRun.stages[index]);
      const newInput = current.designReviewStageInput(newRun, newRun.stages[index]);
      assert.deepEqual(newInput, oldInput);
      const sent = [];
      for (const [Planner, value] of [[PriorPlanner, oldInput], [JsonDesignPlanner, newInput]]) {
        const evidence = prepareDesignReviewEvidence(value), result = fixtureDesignReview(value);
        await new Planner({ complete: async request => {
          sent.push(request);
          return JSON.stringify({ ...result, requestId: evidence.requestId, checks: result.checks.map(check => ({ ...check,
            evidence: check.evidence.map(item => ({ fragmentId: evidence.sources.find(s => s.id === item.sourceId).fragments[0].id })),
          })) });
        } }).reviewDesignContent(value);
      }
      assert.deepEqual(sent[1], sent[0], 'Unannotated requests must remain byte-identical');
      requests.push({ stage: newRun.stages[index].id, requestSha256: digest(sent[1]) });
      prior.acceptDesignReviewStage(oldRun, oldRun.stages[index], fixtureDesignReview(oldInput));
      current.acceptDesignReviewStage(newRun, newRun.stages[index], fixtureDesignReview(newInput));
    }
    assert.deepEqual(current.completeDesignReviewRun(newRun), prior.completeDesignReviewRun(oldRun));
    comparisons.push({ large, stages: oldRun.stages.length, requests });
  }
  const note = await workflow.addDesignReviewAnnotation(workId, annotation);
  let run = await workflow.startDesignReview(workId, 'world');
  run = await workflow.stepDesignReview(workId, run.id);
  await workflow.addDesignReviewAnnotation(workId, { ...annotation, runId: run.id, requestKey: 'later-visible-only',
    explanation: '这条核对说明在本次评审完成后才添加，不在本次模型材料里。' });
  const { app } = createApiServer({ repository, provider: annotationWriter, allowBatchRuns: false });
  try {
    const response = await app.inject({ method: 'GET', url: `/works/${workId}/design/review-runs/${run.id}/stages/${run.stages[0].id}` });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().input.annotationContext.notes, [note]);
    assert.equal(digest((await repository.get(workId)).designReviewRuns.get(original.id)), digest(original));
  } finally { await app.close(); }
  const proof = { verified: true, baseline, comparisons, workId, originalRunId: original.id, frozenRunId: run.id,
    frozenNoteCount: 1, lateNoteExcluded: true, originalRunUnchanged: true, modelCalls: 0, productionWrites: 0,
    uiUrl: `http://127.0.0.1:5181/#/works/${workId}/design`, formalAcceptance: false };
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...proof, comparisons: comparisons.map(({ large, stages }) => ({ large, stages })) }));
}
