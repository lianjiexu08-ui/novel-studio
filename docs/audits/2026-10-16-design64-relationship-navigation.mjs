import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { designReviewStageInput, createDesignReviewRun } from '../../novel-service-core/src/design-review-run.ts';
import { JsonDesignPlanner } from '../../packages/planner/src/index.ts';

const read = p => JSON.parse(fs.readFileSync(p));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const checkpointPath = 'data/audit-runtimes/design64-control/power-completed-checkpoint.json';
const checkpoint = read(checkpointPath), binding = read('data/audit-runtimes/design64-runtime-bound.json');
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(binding.root + '/' + p), h);
const frozen = await import(binding.root + '/novel-service-core/src/design-review-run.ts');
const frozenPlanner = await import(binding.root + '/packages/planner/src/index.ts');
const verified = [];
for (const run of checkpoint.runs) {
  assert.equal(run.scheduleVersion, 25);
  const records = [];
  for (const stage of run.stages.filter(s => s.result)) {
    const old = frozen.designReviewStageInput(run, stage), current = designReviewStageInput(run, stage);
    assert.deepEqual(current, old);
    records.push({ stageId: stage.id, inputSha256: hash(old) });
  }
  const first = run.stages[0], input = designReviewStageInput(run, first);
  async function request(Planner) {
    const calls = []; let cursor = 0;
    await new Planner({ complete: async call => {
      calls.push(call);
      assert.ok(cursor < first.modelResponses.length);
      return first.modelResponses[cursor++];
    } }).reviewDesignContent(input);
    return calls[0];
  }
  assert.deepEqual(await request(JsonDesignPlanner), await request(frozenPlanner.JsonDesignPlanner));
  verified.push({ area: run.input.area, runId: run.id, stages: records, firstPromptUnchanged: true });
}
const characters = checkpoint.runs.find(r => r.input.area === 'characters');
const newer = createDesignReviewRun(characters.input, characters.createdAt, 26);
const staged = designReviewStageInput(newer, newer.stages[0]);
const relationships = staged.stage.coverage.sourceRelationships;
const expected = characters.input.sources.filter(s => s.id.startsWith('story/relationships/'));
assert.equal(expected.length, 22);
assert.equal(Object.keys(relationships).length, expected.length);
for (const source of expected) {
  const raw = JSON.parse(source.text), mapped = relationships[source.id];
  assert.equal(mapped.fromCharacterId, raw.fromCharacterId);
  assert.equal(mapped.toCharacterId, raw.toCharacterId);
  assert.equal(mapped.kind, raw.kind);
  for (const [idKey, nameKey] of [['fromCharacterId', 'fromName'], ['toCharacterId', 'toName']]) {
    const profile = characters.input.sources.map(s => ({ ...s, value: JSON.parse(s.text) }))
      .find(s => s.id.startsWith('story/characters/') && s.value.id === raw[idKey]);
    assert.ok(profile); assert.equal(mapped[nameKey], profile.value.name);
  }
}
const proof = { observedAt: new Date().toISOString(), checkpointPath, checkpointSha256: fileHash(checkpointPath),
  frozenCommit: binding.commit, frozenFilesVerified: Object.keys(binding.sourceHashes).length,
  verified, mappedRelationships: relationships, newScheduleVersion: newer.scheduleVersion,
  modelCalls: 0, productionWrites: 0, currentRuntimeChanged: false, designApproved: false,
  limitation: '核验旧输入和每领域首步提示词未变、新目录忠实于原档；不证明模型会选对补读范围，不改变当前正式评审或任何内容结论。' };
fs.writeFileSync('docs/audits/2026-10-16-design64-relationship-navigation.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ oldStagesUnchanged: verified.reduce((n, r) => n + r.stages.length, 0),
  oldFirstPromptsUnchanged: verified.length, relationships: expected.length, modelCalls: 0, productionWrites: 0 }));
