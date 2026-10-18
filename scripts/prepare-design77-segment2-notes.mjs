// Exact-source corrections to two new review explanations; no verdict changes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const control = 'data/audit-runtimes/design77-notes-continuation';
const verificationPath = 'docs/audits/2026-10-18-design77-notes-continuation-segment-2.json';
const verification = read(verificationPath), checkpoint = read(`${control}/result.json`);
assert.equal(checkpoint.segment, 2); assert.equal(verification.workerAbsent, true);
assert.equal(sha(`${control}/result.json`), verification.checkpointSha256);
try { process.kill(checkpoint.pid, 0); assert.fail('Worker still live'); } catch (e) { assert.equal(e.code, 'ESRCH'); }
const bindingPath = 'data/audit-runtimes/design77-runtime-bound.json', binding = read(bindingPath);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(sha(`${binding.runtimePath}/${p}`), h);
const { annotationSources, designReviewCheckHash } = await import(`${binding.runtimePath}/novel-service-core/src/design-review-annotations.ts`);
const { addDesignReviewAnnotationSchema } = await import(`${binding.runtimePath}/packages/contracts/src/design-review.ts`);
const run = checkpoint.runs.find(run => run.input.area === 'story');
const stage = run.stages.find(stage => stage.id === 'batch-4');
const requestPath = `${control}/model-calls/00021.started.json`, responsePath = `${control}/model-calls/00021.response.json`;
const sent = JSON.parse(read(requestPath).request.user);
assert.deepEqual(stage.modelResponses, [read(responsePath).response.text]);
const drafts = [
  { requestKey: 'design77-story-batch4-one-hour', criterion: 'timeline',
    claimQuote: '四里轻装求援约一时辰',
    explanation: '原评语将“一小时”误写为“一时辰”。第24章已明确秦禾05:00亲见撤哨后出发，四里路约一小时，06:00面交；顾峤07:00交岗后出发，08:15到营外，再用半小时至08:45到位。这是不同人物的两段实体行程，不得把秦的单程改成两小时，也不能据评语重排原章纲。本说明只纠正评语的时间单位，保留原timeline/pass、原回答与引文，不据此宣称全书时序通过。',
    evidence: [
      { sourceId: 'plan/chapters/24', quote: '四里路约一小时，卯正06:00秦把更新图面交顾' },
      { sourceId: 'plan/chapters/24', quote: '辰初07:00与杜完成入口交岗后带二人出发' },
      { sourceId: 'plan/chapters/24', quote: '于08:15到营外，再用半小时避开装车区视线接近侧廊。辰末08:45顾到位' },
    ] },
  { requestKey: 'design77-story-batch4-daily-one-drop', criterion: 'growth',
    claimQuote: '每日三滴、静养、复诊',
    explanation: '原评语误将每剂共三滴写成每日三滴。第27章190—192日每日一滴、共三滴，193—199日静养，199日复诊有效才新增5元载，个人库存6→3；第28章200—202日每日一滴、203—209日静养，209日复诊有效才新增第二笔5元载，库存3→0。两剂共六滴，不是每天三滴，不能据评语三倍计量、补造药源或提前入账。原growth/pass及原答保留，本说明只澄清剂量转述，未改变设定或完成整体成长验收。',
    evidence: [
      { sourceId: 'plan/chapters/27', quote: '第190–192日每日炼化一滴，共三滴' },
      { sourceId: 'plan/chapters/27', quote: '林每日实际服一滴，193–199日静养' },
      { sourceId: 'plan/chapters/27', quote: '199日复诊确认本剂完整炼化有效，才登记寿储新增5元载、有效剂数由0到1，个人封存原液由6滴减至3滴' },
      { sourceId: 'plan/chapters/28', quote: '200–202日每日一滴、203–209日静养。209日复诊确认有效才登记新增5元载，有效剂数从1到2、原液库存从3到0' },
    ] },
];
const work = { designReviewRuns: new Map([[run.id, run]]) };
const sourcesSent = [];
const annotations = drafts.map(draft => {
  const check = stage.result.checks.find(check => check.criterion === draft.criterion);
  assert.equal(check.verdict, 'pass'); assert.ok(check.explanation.includes(draft.claimQuote));
  for (const item of draft.evidence) {
    const fragments = sent.sources.filter(source => source.origin?.sourceId === item.sourceId)
      .flatMap(source => source.fragments.filter(fragment => fragment.text.includes(item.quote)));
    assert.equal(fragments.length, 1, item.quote);
    sourcesSent.push({ criterion: draft.criterion, ...item, fragmentId: fragments[0].id });
  }
  const input = addDesignReviewAnnotationSchema.parse({ ...draft, runId: run.id, stageId: stage.id,
    expectedInputHash: run.input.inputHash, expectedCheckHash: designReviewCheckHash(check) });
  annotationSources(work, input); return input;
});
const replay = verification.replays.find(value => value.runId === run.id).records.find(record => record.stageId === stage.id);
assert.equal(hash(stage), replay.stageSha256);
const sourceDigests = annotations.map(input => ({ requestKey: input.requestKey,
  sources: annotationSources(work, input).map(source => ({ id: source.id, sha256: hash(source) })) }));
const outputPath = `${control}/segment2-annotations.json`, output = { workId: checkpoint.scope.workId, annotations };
const proof = { kind: 'design77_segment2_clarification_inputs', verified: true,
  verificationPath, verificationSha256: sha(verificationPath), checkpointSha256: verification.checkpointSha256,
  bindingPath, bindingSha256: sha(bindingPath), requestPath, requestSha256: sha(requestPath), responsePath, responseSha256: sha(responsePath),
  runId: run.id, stageId: stage.id, acceptedStageSha256: hash(stage), sourcesSent,
  outputPath, outputSha256: hash(output), annotationCount: annotations.length, sourceDigests,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'Source-verified drafts only; original pass judgments remain unchanged. Rehearsal and atomic append are separate.' };
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-18-design77-segment2-annotation-inputs.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ prepared: true, annotations: annotations.length, sourceQuotes: sourcesSent.length }));
