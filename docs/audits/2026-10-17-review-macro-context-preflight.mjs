import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createDesignReviewRun, designReviewStageInput } from '../../novel-service-core/src/design-review-run.ts';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const fileHash = file => sha(fs.readFileSync(file));
const binding = read('data/audit-runtimes/design69-runtime-bound.json');
const stopped = read('data/audit-runtimes/design69-review/result.json');
assert.equal(stopped.status, 'stopped_by_signal');
let alive = false; try { process.kill(stopped.pid, 0); alive = true; } catch (error) { assert.equal(error.code, 'ESRCH'); }
assert.equal(alive, false);
const formal = read('docs/audits/2026-10-17-design69-applied.json');
const response = await fetch(`http://127.0.0.1:8787/works/${stopped.scope.workId}/design/candidate`);
assert.equal(response.status, 200);
const live = await response.json();
assert.equal(live.basePlanId, formal.appliedPlanId); assert.equal(live.expectedInputHash, formal.inputHash);
const comparisons = [];
for (const version of [68, 69]) {
  const oldBinding = read(`data/audit-runtimes/design${version}-runtime-bound.json`);
  for (const [name, expected] of Object.entries(oldBinding.sourceHashes)) assert.equal(fileHash(`${oldBinding.runtimePath}/${name}`), expected);
  const frozen = await import(`${oldBinding.runtimePath}/novel-service-core/src/design-review-run.ts`);
  const saved = read(`data/audit-runtimes/design${version}-review/result.json`);
  for (const run of saved.runs) {
    const rows = run.stages.filter(stage => stage.result).map(stage => {
      const original = frozen.designReviewStageInput(run, stage);
      assert.deepEqual(designReviewStageInput(run, stage), original);
      return { stageId: stage.id, sha256: hash(original) };
    });
    comparisons.push({ planVersion: version, area: run.input.area, scheduleVersion: run.scheduleVersion, requests: rows.length, requestHashesSha256: hash(rows) });
  }
}
const control = path.resolve('data/audit-runtimes/design69-macro-context-probe');
assert.ok(!fs.existsSync(control), 'Preserve previous experiment');
fs.mkdirSync(control);
const runtimePath = path.join(control, 'runtime'), sourceHashes = {};
for (const name of Object.keys(binding.sourceHashes)) {
  const destination = path.join(runtimePath, name);
  fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(name, destination);
  sourceHashes[name] = fileHash(destination);
}
fs.mkdirSync(path.join(runtimePath, 'node_modules'));
for (const name of fs.readdirSync('node_modules')) {
  const source = fs.realpathSync(path.resolve('node_modules', name));
  const local = path.join(runtimePath, path.relative(process.cwd(), source));
  fs.symlinkSync(fs.existsSync(path.join(local, 'package.json')) ? local : source, path.join(runtimePath, 'node_modules', name));
}
const inputsPath = 'data/audit-runtimes/design69-preparation/inputs.json';
const inputs = read(inputsPath), areas = [];
let probeInput;
for (const [area, input] of Object.entries(inputs)) {
  assert.equal(input.inputHash, formal.inputHash);
  const run = createDesignReviewRun(input);
  assert.equal(run.scheduleVersion, 30);
  for (const source of input.sources) {
    const units = run.units.filter(unit => unit.sourceId === source.id);
    assert.equal(units.map(unit => source.text.slice(unit.start, unit.end)).join(''), source.text);
    assert.ok(units.every(unit => run.stages.some(stage => stage.kind === 'batch' && stage.unitIds.includes(unit.id))));
  }
  const requests = run.stages.filter(stage => stage.kind !== 'synthesis').map(stage => {
    const request = designReviewStageInput(run, stage);
    const size = JSON.stringify(request.sources).length;
    assert.ok(size <= 240000); assert.ok(JSON.stringify(request.stage.coverage).length <= 40000);
    assert.deepEqual(designReviewStageInput(JSON.parse(JSON.stringify(run)), stage), request);
    for (const unit of request.stage.sourceMap) {
      const source = input.sources.find(source => source.id === unit.sourceId);
      assert.equal(request.sources.find(source => source.id === unit.id).text, source.text.slice(unit.start, unit.end));
    }
    if (area === 'world') {
      assert.deepEqual(request.stage.coverage.macroPlanContext.incompleteSourceIds, []);
      for (const id of ['plan/milestones/ms_v2_voyage', 'plan/milestones/ms_v2_boundary', 'plan/milestones/ms_v3_return']) {
        assert.ok(request.stage.coverage.macroPlanContext.includedSourceIds.includes(id));
      }
      if (stage.id === 'batch-1') {
        assert.ok(request.stage.sourceMap.some(unit => unit.sourceId === 'world/locations/loc_21'));
        probeInput = request;
      }
    }
    return { stageId: stage.id, sourceCharacters: size, requestSha256: hash(request) };
  });
  areas.push({ area, batches: run.stages.filter(stage => stage.kind === 'batch').length, initialStages: run.stages.length, requests });
}
assert.ok(probeInput);
const inputPath = path.join(control, 'input.json');
fs.writeFileSync(inputPath, JSON.stringify(probeInput), { flag: 'wx' });
const runner = fs.readFileSync('scripts/run-design69-review.mjs', 'utf8');
const suffixLiteral = runner.split('\n').find(line => line.startsWith('const suffix = ')).slice('const suffix = '.length, -1);
// This is the already-authorized, hash-bound local runner's string literal,
// evaluated without filesystem/network globals; no model content is executed.
const suffix = runInNewContext(suffixLiteral, Object.create(null), { timeout: 50 });
assert.equal(typeof suffix, 'string');
assert.equal(hash(suffix), read('data/audit-runtimes/design69-review/baseline.json').suffixSha256);
const proof = { observedAt: new Date().toISOString(), inputHash: formal.inputHash,
  stoppedCheckpointSha256: fileHash('data/audit-runtimes/design69-review/result.json'), inputsPath, inputsSha256: fileHash(inputsPath),
  comparisons, legacyRequestsCompared: comparisons.reduce((sum, row) => sum + row.requests, 0), areas,
  inputPath, inputSha256: fileHash(inputPath), runtimePath, sourceHashes, suffix,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'Initial v30 raw requests only; dynamic follow-ups and synthesis remain unproven. Probe uses the actual newly scheduled world batch-1, not an unchanged old batch with a single addition. Old formal results remain intact.' };
fs.writeFileSync('docs/audits/2026-10-17-review-macro-context-preflight.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ legacyRequestsCompared: proof.legacyRequestsCompared, initialRequests: areas.reduce((sum, area) => sum + area.requests.length, 0), maxSourceCharacters: Math.max(...areas.flatMap(area => area.requests.map(request => request.sourceCharacters))), probeCharacters: JSON.stringify(probeInput.sources).length }));
