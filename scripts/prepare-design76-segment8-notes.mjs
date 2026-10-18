// Assemble source-bound clarifications after terminal verification. No DB writes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {annotationSources, designReviewCheckHash} from '../novel-service-core/src/design-review-annotations.ts';
import {addDesignReviewAnnotationSchema} from '../packages/contracts/src/design-review.ts';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control = 'data/audit-runtimes/design76-citation-edits-review';
const verificationPath = 'docs/audits/2026-10-18-design76-citation-edits-review-segment-8.json';
const verification = read(verificationPath), checkpoint = read(`${control}/result.json`);
assert.equal(checkpoint.segment, 8); assert.equal(verification.workerAbsent, true);
assert.equal(fileHash(`${control}/result.json`), verification.checkpointSha256);
try { process.kill(checkpoint.pid, 0); assert.fail('Worker still live'); } catch (e) { assert.equal(e.code, 'ESRCH'); }
const proofInputs = [
  ['characters-cross14-annotation-input.json', '2026-10-18-design76-characters-cross14-identity.json'],
  ['story-cross15-annotation-input.json', '2026-10-18-design76-story-cross15-identity.json'],
  ['world-cross16-annotation-input.json', '2026-10-18-design76-world-cross16-arrival-drift.json'],
  ['power-cross24-annotation-input.json', '2026-10-18-design76-power-cross24-unread-advancement.json'],
];
const annotations = proofInputs.flatMap(([name]) => {
  const payload = read(`${control}/${name}`);
  assert.equal(payload.workId, checkpoint.scope.workId);
  return payload.annotations;
});
const omissionProofPath = 'docs/audits/2026-10-18-design76-characters-cross23-knowledge-omission.json';
const omission = read(omissionProofPath);
assert.equal(fileHash(omission.requestPath), omission.requestSha256);
assert.equal(fileHash(omission.responsePath), omission.responseSha256);
const run = checkpoint.runs.find(r => r.id === omission.runId);
const stage = run.stages.find(s => s.id === omission.stageId);
assert.equal(hash(stage), omission.observedAcceptedStageSha256);
const check = stage.result.checks.find(c => c.criterion === 'knowledge');
annotations.push(addDesignReviewAnnotationSchema.parse({
  requestKey: 'design76-characters-cross23-identity-omission', runId: run.id, stageId: stage.id,
  criterion: 'knowledge', expectedInputHash: run.input.inputHash, expectedCheckHash: designReviewCheckHash(check),
  claimQuote: '第33章侧门视角明确属于读者/独立角色，林辰只知道正式仓现状和六号箱去向不明。',
  explanation: '这一正确的局部描述未消除同次材料中的冲突。人物char_19仍写姓名在第33章由船册和本人确认，plan/chapters/33章末仍写林确认严身份，而圣经对应章明确尚不知道严涛身份。三段原文均已实际发送；本次知情项通过遗漏了相反指令，不能据此撤销故事cross-1-4的返修。离线v4已经连同关系和里程碑修正，但尚未应用正式设计。保留原回答与判定，本说明不自动改判、关闭阻塞或批准正文。',
  evidence: omission.evidence.map(({sourceId, quote}) => ({sourceId, quote})),
}));
assert.equal(annotations.length, 7);
assert.equal(new Set(annotations.map(a => `${a.runId}/${a.requestKey}`)).size, 7);
const work = {designReviewRuns: new Map(checkpoint.runs.map(r => [r.id, r]))};
const sourceDigests = annotations.map(input => {
  addDesignReviewAnnotationSchema.parse(input);
  const run = work.designReviewRuns.get(input.runId), stage = run.stages.find(s => s.id === input.stageId);
  const replay = verification.replays.find(r => r.runId === run.id).records.find(r => r.stageId === stage.id);
  assert.equal(hash(stage), replay.stageSha256);
  return {requestKey: input.requestKey, sources: annotationSources(work, input).map(s => ({id: s.id, sha256: hash(s)}))};
});
const outputPath = `${control}/segment8-annotations.json`;
const output = {workId: checkpoint.scope.workId, annotations};
const proofPath = 'docs/audits/2026-10-18-design76-segment8-annotation-inputs.json';
const proof = {kind: 'design76_segment8_clarification_inputs', verificationPath, verificationSha256: fileHash(verificationPath),
  checkpointSha256: verification.checkpointSha256, outputPath, outputSha256: hash(output), annotationCount: annotations.length,
  inputs: proofInputs.map(([payload, proof]) => ({payloadPath: `${control}/${payload}`, payloadSha256: fileHash(`${control}/${payload}`),
    proofPath: `docs/audits/${proof}`, proofSha256: fileHash(`docs/audits/${proof}`)})),
  omissionProofPath, omissionProofSha256: fileHash(omissionProofPath), sourceDigests,
  productionWrites: 0, modelCalls: 0, formalAcceptance: false,
  limitation: 'Source and original-check bindings verified. Rehearsal, atomic append, restart readback and actual UI visibility remain required. Original verdicts and blockers are unchanged.',
};
if (process.argv.includes('--check')) { assert.deepEqual(read(outputPath), output); assert.deepEqual(read(proofPath), proof); }
else {
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', {flag: 'wx'});
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', {flag: 'wx'});
}
console.log(JSON.stringify({prepared: true, annotations: annotations.length, productionWrites: 0}));
