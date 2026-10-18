// Prepare an append-only clarification from a terminal-verified original step.
// No database access, model calls, verdict changes, or design edits.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {annotationSources, designReviewCheckHash} from '../novel-service-core/src/design-review-annotations.ts';
import {addDesignReviewAnnotationSchema} from '../packages/contracts/src/design-review.ts';

const read=p=>JSON.parse(fs.readFileSync(p));
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-recovery-segment-0.json';
const verification=read(verificationPath);
assert.equal(fileHash(verification.checkpointPath),verification.checkpointSha256);
const checkpoint=read(verification.checkpointPath);
const run=checkpoint.runs.find(r=>r.input.area==='world');assert.ok(run);
const stage=run.stages.find(s=>s.id==='batch-3');assert.ok(stage?.result);
const replay=verification.replays.find(r=>r.runId===run.id);
assert.equal(replay.records.find(s=>s.stageId===stage.id).stageSha256,hash(stage));
const check=stage.result.checks.find(c=>c.criterion==='history');assert.ok(check);
const originalSource=id=>{const source=run.input.sources.find(s=>s.id===id);assert.ok(source,id);return JSON.parse(source.text);};
const elder=originalSource('story/characters/char_16'),younger=originalSource('story/characters/char_21');
assert.equal(elder.name,'陆沉舟');assert.equal(younger.name,'陆沉川');
const milestone=originalSource('plan/milestones/ms_v2_fire');
const writtenStatement=milestone.setup.find(s=>s.startsWith('53拟主写陆在看护中自行书写改签自述'));
assert.ok(writtenStatement);
const note=addDesignReviewAnnotationSchema.parse({
  requestKey:'design76-world-batch3-lu-brothers',runId:run.id,stageId:stage.id,criterion:'history',
  expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),
  claimQuote:'赤霄五工脱控与陆沉川有限自述只提供待核线索',
  explanation:'此句未清楚区分陆氏兄弟的证据主体。陆沉舟（char_16）亲自参与改签，第53章拟由他在看护中自行署名写改签自述，林取得签认副本；弟弟陆沉川（char_21）只证明第220夜亲眼见兄收钱签字，不替条内内容背书。若本评语指第53章签认的改签自述，主体应为陆沉舟；若仅指弟弟陈述亲见事实，则应明确其见闻范围，不能将两者合并。保留原评语和本批history判定，本说明不修改人物身份、不把供述升级为已独立核实，也不关闭其他设计阻塞或批准正文。',
  evidence:[
    {sourceId:'story/characters/char_16',quote:'"name": "陆沉舟"'},
    {sourceId:'story/characters/char_16',quote:elder.identity},
    {sourceId:'story/characters/char_21',quote:'"name": "陆沉川"'},
    {sourceId:'story/characters/char_21',quote:younger.identity},
    {sourceId:'plan/milestones/ms_v2_fire',quote:writtenStatement},
  ],
});
const sources=annotationSources({designReviewRuns:new Map([[run.id,run]])},note);
const output={workId:checkpoint.scope.workId,annotations:[note]};
const outputPath='data/audit-runtimes/design76-recovery/review-annotation-inputs.json';
const proofPath='docs/audits/2026-10-18-design76-review-annotation-inputs.json';
const proof={kind:'design76_prepared_review_clarification',verificationPath,verificationSha256:fileHash(verificationPath),
  checkpointPath:verification.checkpointPath,checkpointSha256:verification.checkpointSha256,
  outputPath,outputSha256:hash(output),count:1,runId:run.id,stageId:stage.id,stageSha256:hash(stage),
  expectedInputHash:note.expectedInputHash,expectedCheckHash:note.expectedCheckHash,
  completeOriginalSources:sources,note,productionWrites:0,modelCalls:0,verdictChanges:0,questionsResolved:0,formalAcceptance:false,
  nextRequiredAction:'Wait for the current formal segment to stop and pass independent verification. Rehearse an annotation-only append in a database copy, then append through the matching workflow and verify unchanged reviews/designs. Confirm the existing UI can retrieve this note.'};
if(process.argv.includes('--check')){
  assert.deepEqual(read(outputPath),output);assert.deepEqual(read(proofPath),proof);
}else{
  assert.ok(!fs.existsSync(outputPath));assert.ok(!fs.existsSync(proofPath));
  fs.writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n',{flag:'wx'});
  fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({verified:true,preparedAnnotations:1,sourceCount:sources.length,productionWrites:0,modelCalls:0}));
