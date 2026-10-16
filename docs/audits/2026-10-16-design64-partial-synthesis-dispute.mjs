import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayDesignReviewPrefix } from '../../scripts/audit-design-reviews.mjs';

const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const binding = read('data/audit-runtimes/design64-runtime-bound.json');
const baseline = read('data/audit-runtimes/design64-control/baseline.json');
const checkpointPath = 'data/audit-runtimes/design64-control/partial-synthesis-checkpoint.json';
fs.copyFileSync('data/audit-runtimes/design64-control/resume-3-result.json', checkpointPath, fs.constants.COPYFILE_EXCL);
const checkpoint = read(checkpointPath), run = checkpoint.runs.find(r => r.input.area === 'power');
assert.equal(run.input.inputHash, baseline.inputHash);
assert.equal(checkpoint.runtimeCommit, binding.commit);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(binding.root + '/' + p), h);
const stages = await import(binding.root + '/novel-service-core/src/design-review-run.ts');
const { JsonDesignPlanner } = await import(binding.root + '/packages/planner/src/index.ts');
const { prepareDesignReviewEvidence } = await import(binding.root + '/packages/planner/src/design-review-evidence.ts');
const replay = await replayDesignReviewPrefix(run, run.input, { ...stages, JsonDesignPlanner });
const stage = run.stages.find(s => s.id === 'synthesis-9');
const input = stages.designReviewStageInput(run, stage), prepared = prepareDesignReviewEvidence(input);
assert.equal(JSON.parse(stage.modelResponses.at(-1)).requestId, prepared.requestId);
assert.equal(input.stage.coverage.synthesis.scope, 'partial_reports');
assert.deepEqual(input.stage.coverage.synthesis.coveredStageIds, ['followup-batch-1/costs', 'followup-batch-1/counters']);
assert.equal(input.stage.coverage.synthesis.totalStages, 36);
assert.deepEqual([...new Set(input.stage.sourceMap.map(u => u.sourceId))], ['plan/overview']);
assert.deepEqual(stage.result.checks.map(c => [c.criterion, c.verdict]), [['costs', 'insufficient'], ['counters', 'insufficient']]);
assert.ok(stage.result.checks.every(c => c.explanation.includes('51—100章')));
const sourceRecords = [
  ['plan/milestones/ms_v3_advancement', [0, 1]],
  ['plan/milestones/ms_v3_convoy', [2, 3, 8, 9]],
].map(([id, indices]) => {
  const source = run.input.sources.find(s => s.id === id); assert.ok(source);
  const value = JSON.parse(source.text);
  assert.ok(!input.stage.sourceMap.some(u => u.sourceId === id));
  return { id, sha256: hash(source), directlyProvided: false,
    mentionedInProvidedReports: input.sources.filter(s => s.id.startsWith('review-result/')).some(s => s.text.includes(id)),
    excerpts: indices.map(index => { assert.equal(typeof value.setup[index], 'string'); return { field: 'setup', index, quote: value.setup[index] }; }) };
});
assert.ok(sourceRecords[0].excerpts[0].quote.includes('实际拟写支付10元载'));
assert.ok(sourceRecords[0].excerpts[1].quote.includes('420–424日'));
assert.ok(sourceRecords[1].excerpts[2].quote.includes('八→六→四→二'));
const frozenPrompt = fs.readFileSync(binding.root + '/packages/planner/src/index.ts', 'utf8');
const instruction = 'partial_reports表示中间汇总：按原rubric逐项核本子树报告及附带原文能支持的判断、关联和冲突；它不代表全领域已经汇总，不能仅因其余子树尚未合入，就要求本步证明全书全部伏笔、后半段全部路线或前五十章全部场景，并据此新增insufficient。';
assert.ok(frozenPrompt.includes(instruction));
const proof = {
  kind: 'manual_partial_synthesis_scope_dispute', observedAt: new Date().toISOString(),
  inputHash: run.input.inputHash, runId: run.id, stageId: stage.id, checkpointPath,
  checkpointSha256: fileHash(checkpointPath), runtimeCommit: binding.commit, replay,
  originalResult: stage.result, resultSha256: hash(stage.result), modelResponsesSha256: hash(stage.modelResponses),
  stageInputSha256: hash(input), requestId: prepared.requestId, synthesis: input.stage.coverage.synthesis,
  providedSourceIds: input.sources.map(s => s.id), sourceRecords, frozenPromptInstruction: instruction,
  assessment: '本节点只合并两个局部补读报告，却要求它独立证明全100章，再以未纳入后半本报告和逐章细纲判不足。输入已明确partial_reports；冻结后段里程碑也已有415日晋阶、416–424日训练，以及436日林顾分账和反制安排。仅本节点没读到这些原文不能证明全书未设计，也不应要求一次展开后50章逐场细纲。',
  action: '保留原不足意见和后续传播；最终核对须定向复评范围与所需后段原文，不自动改判通过，不删除真实缺陷或等待项。',
  productionWrites: 0, modelCalls: 0, formalVerdictsOverridden: false, questionsResolved: 0, designApproved: false,
  limitation: '原文摘录反驳后段没有任何具体安排的笼统断言，不证明全部后段收支和战斗可行；局部综合也不能靠前置通过票直接通过。全领域及后续细纲、正文仍各需验收。',
};
fs.writeFileSync('docs/audits/2026-10-16-design64-partial-synthesis-dispute.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ stageId: stage.id, scope: proof.synthesis, replayedStages: replay.completedStages, responses: replay.responsesReplayed, productionWrites: 0 }));
