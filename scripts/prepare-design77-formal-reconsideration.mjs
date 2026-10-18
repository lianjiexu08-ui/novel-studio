// Read-only compatibility proof and exact same-run formal-recheck preparation.
// Preserve every original journal/runtime; create fresh artifacts with wx only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDesignReviewRun, acceptDesignReviewStage, designReviewStageInput, queueDesignReviewReconsideration } from '../novel-service-core/src/design-review-run.ts';
import { JsonDesignPlanner } from '../packages/planner/src/index.ts';
const read = file => JSON.parse(fs.readFileSync(file));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const out = path.resolve('data/audit-runtimes/design77-formal-reconsideration');
assert.ok(!fs.existsSync(out), 'Preserve any earlier attempt; choose a new directory explicitly');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(process.argv[1], path.join(out, 'prepare.mjs'), fs.constants.COPYFILE_EXCL);
const save = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', flush: true });
try {
  const control = 'data/audit-runtimes/design77-notes-continuation';
  const state = read(`${control}/result.json`);
  assert.equal(state.segment, 2); assert.equal(state.status, 'stopped_after_stage_limit'); assert.equal(state.totalCalls, 21);
  try { process.kill(state.pid, 0); assert.fail('Original worker is still live'); } catch (error) { assert.equal(error.code, 'ESRCH'); }
  const notes = read('docs/audits/2026-10-18-design77-segment1-notes-applied.json').notes;
  const note = notes.find(note => note.requestKey === 'design77-power-batch3-sword-inspection'); assert.ok(note);
  const files = fs.readdirSync(`${control}/model-calls`).filter(file => file.endsWith('.started.json')).sort();
  const calls = files.map(file => ({ start: read(`${control}/model-calls/${file}`), response: read(`${control}/model-calls/${file.replace('.started.', '.response.')}`) }));
  const oldBinding = read('data/audit-runtimes/design77-runtime-bound.json');
  for (const [file, digest] of Object.entries(oldBinding.sourceHashes)) assert.equal(sha(`${oldBinding.runtimePath}/${file}`), digest);
  const old = await import(`${oldBinding.runtimePath}/novel-service-core/src/design-review-run.ts`);
  let replayCalls = 0, stages = 0;
  const replays = [];
  for (const run of state.runs) {
    const canonical = createDesignReviewRun(run.input, run.createdAt, run.scheduleVersion); canonical.id = run.id;
    for (const stage of run.stages.filter(stage => stage.result)) {
      const current = canonical.stages.find(item => item.id === stage.id);
      const input = designReviewStageInput(canonical, current);
      assert.deepEqual(input, old.designReviewStageInput(run, stage));
      const journal = calls.filter(call => call.start.step.runId === run.id && call.start.step.stageId === stage.id);
      let index = 0;
      const planner = new JsonDesignPlanner({ complete: async request => {
        const call = journal[index++]; assert.ok(call);
        assert.equal(request.user, call.start.request.user);
        assert.ok(call.start.request.system.startsWith(request.system));
        assert.equal(request.maxOutputTokens, call.start.request.maxOutputTokens);
        replayCalls++; return call.response.response.text;
      } });
      const { modelResponses, ...result } = await planner.reviewDesignContent(input);
      assert.deepEqual(result, stage.result); assert.deepEqual(modelResponses, stage.modelResponses); assert.equal(index, journal.length);
      acceptDesignReviewStage(canonical, current, result); stages++;
    }
    replays.push({ runId: run.id, area: run.input.area, completed: run.stages.filter(stage => stage.result).length });
  }
  assert.equal(replayCalls, 21); assert.equal(stages, 16);
  const priorRun = state.runs.find(run => run.id === note.runId); assert.ok(priorRun);
  const run = structuredClone(priorRun);
  const additionalSourceIds = ['world/techniques/tech_04', 'world/realms/realm_02', 'plan/chapters/18', 'plan/chapters/20', 'plan/chapters/21', 'story/chapterPlans/chapter-plan-20', ...run.input.sources.filter(source => source.id.startsWith('world/axioms/')).map(source => source.id)];
  const stage = queueDesignReviewReconsideration(run, note, additionalSourceIds);
  const input = designReviewStageInput(run, stage);
  for (const prior of priorRun.stages.filter(stage => stage.result)) {
    assert.deepEqual(run.stages.find(stage => stage.id === prior.id), prior);
    assert.deepEqual(designReviewStageInput(run, prior), old.designReviewStageInput(priorRun, prior));
  }
  assert.deepEqual(run.input, priorRun.input);
  assert.equal(stage.reconsiderationFor, 'batch-3/costs');
  save('prior-run.json', priorRun); save('queued-run.json', run); save('input.json', input);
  save('request.json', { annotationId: note.id, expectedInputHash: run.input.inputHash, additionalSourceIds });
  save('note.json', note);
  const proof = { verified: true, checkpointPath: `${control}/result.json`, checkpointSha256: sha(`${control}/result.json`),
    priorRunSha256: hash(priorRun), queuedRunSha256: hash(run), inputSha256: hash(input), stageId: stage.id, replays,
    replayedCalls: replayCalls, preservedStages: stages, originalInputUnchanged: true, originalRequestsUnchanged: true,
    sourceCharacters: JSON.stringify(input.sources).length, rawSourceCount: new Set(input.stage.sourceMap.map(unit => unit.sourceId)).size,
    pending: input.stage.coverage.pendingChecks, modelCalls: 0, productionWrites: 0, formalAcceptance: false };
  save('preflight.json', proof);
  fs.writeFileSync('docs/audits/2026-10-18-design77-formal-reconsideration-preflight.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx', flush: true });
  console.log(JSON.stringify({ verified: true, replayedCalls: replayCalls, preservedStages: stages, sourceCharacters: proof.sourceCharacters, rawSourceCount: proof.rawSourceCount, modelCalls: 0, productionWrites: 0 }));
} catch (error) {
  save('prepare-failure.json', { error: String(error), at: new Date().toISOString(), modelCalls: 0, productionWrites: 0 }); throw error;
}
