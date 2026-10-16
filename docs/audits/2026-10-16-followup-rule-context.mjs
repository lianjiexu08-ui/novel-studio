// Offline verification only; never changes a saved run or invokes a model.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as current from '../../novel-service-core/src/design-review-run.ts';
const read = path => JSON.parse(fs.readFileSync(path));
const sha = value => createHash('sha256').update(value).digest('hex');
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
for (const [path, hash] of Object.entries(binding.sourceHashes)) assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), hash, path);
const frozen = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const priorPath = '/var/folders/tr/8vt224595gdfg6w6kh6tkpt00000gn/T/novel-stale-ancestry-validation-nwg39s3b';
const prior27 = await import(`${priorPath}/novel-service-core/src/design-review-run.ts`);
const snapshotPath = 'data/audit-runtimes/design68-review/power-completed.json';
const bytes = fs.readFileSync(snapshotPath), snapshot = JSON.parse(bytes);
const legacy = [];
for (const run of snapshot.runs.filter(run => ['world', 'power'].includes(run.input.area))) {
  let requests = 0;
  for (const stage of run.stages) {
    assert.deepEqual(current.designReviewStageInput(run, stage), frozen.designReviewStageInput(run, stage));
    requests++;
  }
  assert.deepEqual(current.completeDesignReviewRun(structuredClone(run)), frozen.completeDesignReviewRun(structuredClone(run)));
  legacy.push({ area: run.input.area, requests, completedReportUnchanged: true });
}
const power = snapshot.runs.find(run => run.input.area === 'power');
const prepare = (api, version) => {
  const run = api.createDesignReviewRun(power.input, power.createdAt, version);
  for (const stage of [...run.stages.filter(stage => stage.kind !== 'synthesis')])
    api.acceptDesignReviewStage(run, stage, structuredClone(power.stages.find(saved => saved.id === stage.id).result));
  return run;
};
const old27 = prepare(prior27, 27), unchanged27 = prepare(current, 27), new28 = prepare(current, 28);
let v27Requests = 0;
for (const stage of unchanged27.stages.filter(stage => stage.kind !== 'synthesis')) {
  assert.deepEqual(current.designReviewStageInput(unchanged27, stage), prior27.designReviewStageInput(old27, old27.stages.find(saved => saved.id === stage.id)));
  v27Requests++;
}
const id = 'followup-cross-2-3/costs';
const oldRequest = frozen.designReviewStageInput(power, power.stages.find(stage => stage.id === id));
const stage = new28.stages.find(stage => stage.id === id);
const request = current.designReviewStageInput(new28, stage);
const definitions = ['world/resources/res_09', 'world/artifacts/art_16'].map(id => {
  assert.ok(!oldRequest.stage.sourceMap.some(unit => unit.sourceId === id));
  const units = request.stage.sourceMap.filter(unit => unit.sourceId === id);
  const text = units.map(unit => request.sources.find(source => source.id === unit.id).text).join('');
  assert.equal(text, power.input.sources.find(source => source.id === id).text);
  return { id, sha256: sha(text), completeInNewRequest: true, absentInOldRequest: true };
});
const mandatory = new Set([
  ...power.stages.find(stage => stage.id === 'cross-2-3').result.checks.find(check => check.criterion === 'costs').awaitingSources,
  ...oldRequest.stage.coverage.pendingChecks.find(check => check.id === 'cross-2-3/costs').priorSourceIds,
]);
for (const id of mandatory) {
  const units = request.stage.sourceMap.filter(unit => unit.sourceId === id);
  assert.equal(units.map(unit => request.sources.find(source => source.id === unit.id).text).join(''), power.input.sources.find(source => source.id === id).text);
}
assert.ok(request.sources.some(source => source.id === 'review-question/cross-2-3/costs'));
assert.equal(stage.result, undefined);
assert.ok(JSON.stringify(request.sources).length <= 240000);
assert.ok(JSON.stringify(request.stage.coverage).length <= 40000);
assert.deepEqual(current.designReviewStageInput(JSON.parse(JSON.stringify(new28)), stage), request);
const proof = {
  kind: 'followup_explicit_rule_context', observedAt: new Date().toISOString(),
  snapshotPath, snapshotSha256: sha(bytes), frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  legacy, v27RequestsUnchanged: v27Requests, v27ImplementationPath: priorPath,
  reproduction: { stageId: id, oldMaterialLength: JSON.stringify(oldRequest.sources).length,
    newMaterialLength: JSON.stringify(request.sources).length, newMetadataLength: JSON.stringify(request.stage.coverage).length,
    mandatorySourcesComplete: mandatory.size, definitions, relatedContext: request.stage.coverage.relatedSourceContext,
    requestSha256: sha(JSON.stringify(request)), reloadRequestUnchanged: true },
  modelCalls: 0, productionWrites: 0, frozenRuntimeChanged: false, findingsResolved: 0,
  limitation: 'Material coverage only, not semantic acceptance. Optional rule context is one-hop and exact-name/ID based; aliases are not inferred. Over-capacity optional sets remain explicitly omitted. Existing v26 live run and negative results are unchanged.',
};
fs.writeFileSync('docs/audits/2026-10-16-followup-rule-context.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(proof));
