import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Offline evidence capture only. Never changes a review verdict or the work.
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const binding = read('data/audit-runtimes/design64-runtime-bound.json');
const baseline = read('data/audit-runtimes/design64-control/baseline.json');
const inputs = read('data/audit-runtimes/design64-control/geography-audit-inputs.json');
const checkpoint = read(inputs.checkpoint);
assert.equal(checkpoint.runtimeCommit, binding.commit);
assert.equal(checkpoint.scheduleVersion, 25);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(path.join(binding.root, p)), h, p);
const production = path.resolve('data/novel-studio.db');
assert.notEqual(fs.realpathSync(inputs.databaseSnapshot), fs.realpathSync(production));
assert.notEqual(fs.statSync(inputs.databaseSnapshot).ino, fs.statSync(production).ino);
process.env.DATABASE_URL = 'file:' + inputs.databaseSnapshot;
const { PrismaWorkRepository } = await import(binding.root + '/packages/persistence/src/prisma-repository.ts');
const repo = new PrismaWorkRepository();
let work;
try { work = await repo.get(baseline.workId); } finally { await repo.disconnect(); }
assert.equal(hash({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] }), baseline.protectedHash);
for (const [id, h] of baseline.oldRuns) assert.equal(hash(work.designReviewRuns.get(id)), h);
for (const [id, h] of baseline.oldReports) assert.equal(hash(work.designContentReviews.get(id)), h);
const { designReviewInput } = await import(binding.root + '/novel-service-core/src/design-review.ts');
const stages = await import(binding.root + '/novel-service-core/src/design-review-run.ts');
const { JsonDesignPlanner } = await import(binding.root + '/packages/planner/src/index.ts');
const { prepareDesignReviewEvidence } = await import(binding.root + '/packages/planner/src/design-review-evidence.ts');
const { replayDesignReviewPrefix } = await import(path.resolve('scripts/audit-design-reviews.mjs'));
const run = checkpoint.runs.find(r => r.input.area === 'world');
const expected = designReviewInput(work, 'world', baseline.planId);
assert.equal(expected.inputHash, baseline.inputHash);
const stored = work.designReviewRuns.get(run.id);
for (const stage of run.stages.filter(s => s.result)) assert.deepEqual(stored.stages.find(s => s.id === stage.id), stage);
const replay = await replayDesignReviewPrefix(run, expected, { ...stages, JsonDesignPlanner });
const source = id => { const s = run.input.sources.find(s => s.id === id); assert.ok(s, id); return s; };
function quote(sourceId, field, index) {
  const s = source(sourceId), value = JSON.parse(s.text);
  const text = index === undefined ? value[field] : value[field][index];
  assert.equal(typeof text, 'string');
  // JSON-encoded text offsets match the exact input, not a reserialized source.
  const encoded = JSON.stringify(text), start = s.text.indexOf(encoded);
  assert.ok(start >= 0); assert.equal(s.text.indexOf(encoded, start + 1), -1);
  return { sourceId, sourceSha256: hash(s), field, ...(index === undefined ? {} : { index }),
    start, end: start + encoded.length, encoding: 'JSON string, UTF-16 offsets, exclusive end', quote: text };
}
const macroIds = ['ms_v2_voyage', 'ms_v2_boundary', 'ms_v3_return'].map(id => 'plan/milestones/' + id);
const findings = run.stages.filter(s => s.result?.checks.some(c => c.criterion === 'geography' && c.verdict === 'revise')).map(stage => {
  const input = stages.designReviewStageInput(run, stage), prepared = prepareDesignReviewEvidence(input);
  const response = JSON.parse(stage.modelResponses.at(-1));
  assert.equal(response.requestId, prepared.requestId);
  return { stageId: stage.id, kind: stage.kind, children: stage.children, resultSha256: hash(stage.result),
    modelResponsesSha256: hash(stage.modelResponses), requestId: prepared.requestId, stageInputSha256: hash(input),
    synthesis: input.stage.coverage.synthesis,
    directlyProvidedSourceIds: [...new Set(input.stage.sourceMap.map(u => u.sourceId))],
    macroCoverage: macroIds.map(id => ({ sourceId: id, inCompleteInput: true,
      directlyProvided: input.stage.sourceMap.some(u => u.sourceId === id),
      mentionedInReportText: input.sources.filter(s => s.id.startsWith('review-result/')).some(s => s.text.includes(id)) })),
    checks: stage.result.checks.filter(c => c.criterion === 'geography').map(c => ({
      criterion: c.criterion, verdict: c.verdict, explanation: c.explanation, revisionAdvice: c.revisionAdvice,
      evidenceSha256: hash(c.evidence), evidenceCount: c.evidence.length })) };
});
assert.ok(findings.some(f => f.stageId === 'followup-cross-1-3/geography'));
const initialSynthesis = findings.find(f => f.stageId === 'synthesis-1');
assert.equal(initialSynthesis.synthesis.scope, 'partial_reports');
assert.ok(initialSynthesis.macroCoverage.every(c => !c.directlyProvided && !c.mentionedInReportText));
const disputes = [
  { id: 'different-travel-parties', originatingStage: 'followup-cross-1-3/geography',
    assessment: '原文明确区分林辰、苏凌霜181–183日先行与褚衡、邵闻186–188日换班行程。负面报告将二者视为同一段入境，所引日期本身不足以证明矛盾。此项仅反驳该同队前提，不证明18–29全部时间线通过。',
    action: '保留原负面结论，待最终核对及定向复评；不按此建议统一两队日期或改写整条时间线。',
    evidence: [18, 19, 20, 26].map(n => quote('plan/chapters/' + n, 'summary')) },
  { id: 'unread-macro-is-not-absent', originatingStage: 'synthesis-1',
    assessment: '初始负面结论产生于仅包含batch-1、batch-2的局部综合，三个被要求补写的里程碑既未直接提供，也未在所附报告文本中提及；冻结输入却已经包含对应航程、资金、供暖、担保与异常分支。此项反驳“一概未设计”，不代替这些设计的完整质量与执行验收。',
    action: '保留原负面结论及后续传播链；最终复评须同读下列原文，逐项核对仍有无真实缺口，不能依据目录存在就改判通过。',
    evidence: [
      ...[0, 1, 2, 7, 9, 10, 11, 12, 13, 14].map(i => quote(macroIds[0], 'setup', i)),
      quote(macroIds[1], 'setup', 0),
      ...[0, 1, 2, 6, 7, 8, 13, 14].map(i => quote(macroIds[2], 'setup', i)),
      quote(macroIds[2], 'outcome'),
    ] },
];
const proof = { kind: 'manual_disputed_findings_original_source_reconciliation', observedAt: new Date().toISOString(),
  inputHash: baseline.inputHash, planId: baseline.planId, runId: run.id, runtimeCommit: binding.commit,
  checkpointPath: inputs.checkpoint, checkpointSha256: fileHash(inputs.checkpoint), databaseSnapshot: inputs.databaseSnapshot,
  sourceFilesVerified: Object.keys(binding.sourceHashes).length, verifierSha256: fileHash(process.argv[1]),
  replay, findings, disputes, protectedHistoryUnchanged: true, preservedOldRuns: baseline.oldRuns.length,
  preservedOldReports: baseline.oldReports.length, modelCalls: 0, productionDatabaseWrites: 0,
  formalVerdictsOverridden: false, questionsResolved: 0, designApproved: false, proseGenerated: false,
  limitation: '保存响应回放验证来源和响应完整性；人工核对仅标出两项争议，不撤销正式返修、不通过整套设计、不证明旧正文已实现。四领域结束后必须纳入最终核对。' };
const output = 'docs/audits/2026-10-16-design64-geography-disputes.json';
fs.writeFileSync(output, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, completedStages: replay.completedStages, responsesReplayed: replay.responsesReplayed,
  findings: findings.length, disputes: disputes.length, protectedHistoryUnchanged: true }));
