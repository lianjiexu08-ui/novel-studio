// Append a source-backed correction to a model explanation. The saved model
// answer, verdict, design and chapter state remain untouched.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Work} from '../novel-service-core/src/core.ts';
import {recordDesignReviewAnnotation, designReviewCheckHash} from '../novel-service-core/src/design-review-annotations.ts';
import {requestJson} from './design-review-step-client.mjs';
import {workId, planId} from './run-v78-formal-reviews.mjs';

const mode=process.argv[2];
assert.ok(['--prepare','--apply'].includes(mode)&&process.argv.length===3);
const root='data/audit-runtimes/design78-recovery/';
const inputPath='docs/audits/2026-10-25-design78-training-date-annotation.json';
const sourcePath=root+'power-followup-cross-1-2__tiers.json';
const runId='design_run_1050f783-7af7-4062-b5d2-bebd517cb730';
const stageId='followup-cross-1-2/tiers';
const base='http://127.0.0.1:8790';
const stageUrl=`${base}/works/${workId}/design/review-runs/${runId}/stages/${encodeURIComponent(stageId)}`;
const notesUrl=`${base}/works/${workId}/design/review-annotations`;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceId='plan/milestones/ms_v3_training';
function validateLocally(saved,input) {
  const units=saved.input.stage.sourceMap.filter(u=>u.sourceId===sourceId).sort((a,b)=>a.start-b.start);
  const sources=new Map(saved.input.sources.map(s=>[s.id,s.text]));
  let end=0,text='';
  for(const unit of units){assert.equal(unit.start,end);text+=sources.get(unit.id);end=unit.end;}
  assert.equal(end,saved.input.stage.coverage.sourceLengths[sourceId]);
  const work=new Work('Annotation validation only',workId);
  work.designReviewRuns.set(runId,{id:runId,input:{inputHash:saved.input.inputHash,scope:saved.input.scope,sources:[{id:sourceId,text}]},stages:[saved.stage]});
  const note=recordDesignReviewAnnotation(work,input,'2026-10-24T17:53:14.106Z');
  assert.deepEqual(recordDesignReviewAnnotation(work,input),note);
  assert.equal(work.designReviewAnnotations.size,1);
  return note;
}
if(mode==='--prepare') {
  const saved=JSON.parse(fs.readFileSync(sourcePath));
  const check=saved.stage.result.checks.find(c=>c.criterion==='tiers');
  const input={requestKey:'design78-segment12-training-failure-date',runId,stageId,criterion:'tiers',
    expectedInputHash:saved.input.inputHash,expectedCheckHash:designReviewCheckHash(check),
    claimField:'explanation',claimQuote:'351日第三枚失败报废、共实耗七枚',
    explanation:'此处把第三枚灵石的开封日与失败停训日合写为351日，日期表述不准确。原计划是351日开封第三枚并开始第二段训练，354日出现胸闷与回流、当日停练和检查，该枚报废且此周期不计有效；355—357日休息观察，复诊及358日行前再核通过后才重开。六个有效周期、一次失败和七枚总耗材的数量不因此改变。本说明校正评语中的失败日期，不修改原模型判定，不证明正文已执行，也不允许省略失败训练的四日、休息或复诊。',
    evidence:[{sourceId,quote:'351开第三枚，354出现胸闷与回流立即停练，当日白榆检查并停训，第三枚报废不退、该周期不计有效；355–357仅休息及遵医嘱观察，357复诊须胸闷消失、经脉无急性反应、轻度导引无回流才准358重开，不能因休满三日自动许可。'},
      {sourceId,quote:'351开始前顾当面讲第二段、林复述通过并经白榆行前复查后才开第三枚，354失败立即停训。'}]};
  validateLocally(saved,input);
  const payload={workId,planId,sourcePath,sourceStageSha256:hash(saved),input};
  if(fs.existsSync(inputPath))assert.deepEqual(JSON.parse(fs.readFileSync(inputPath)),payload);
  else fs.writeFileSync(inputPath,JSON.stringify(payload,null,2)+'\n',{flag:'wx'});
  console.log({prepared:inputPath,sourceAndClaimValidated:true,productionWrites:0});
} else {
  const proofPath=root+'segment-12-training-date-annotation-applied.json';
  assert.ok(!fs.existsSync(proofPath),'Preserve prior application receipt');
  // This journal identifies the bounded worker which must already be terminal.
  const journal=root+'continuation-1792864000082-86329.jsonl';
  const lines=fs.readFileSync(journal,'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(['stopped_after_stage_limit','stopped_for_content_revision'].includes(lines.at(-1).status));
  try{process.kill(86329,0);assert.fail('Formal worker is still live');}catch(error){assert.equal(error.code,'ESRCH');}
  const payload=JSON.parse(fs.readFileSync(inputPath));
  assert.equal(payload.workId,workId);assert.equal(payload.planId,planId);
  const overview=await requestJson(`${base}/works/${workId}/design/content-reviews?planId=${planId}&view=summary`);
  assert.equal(overview.status,200);assert.equal(overview.body.inputHash,payload.input.expectedInputHash);
  assert.ok(overview.body.runs.every(r=>r.status!=='running'&&!r.leaseExpiresAt),'Wait for all review leases');
  const before=await requestJson(stageUrl);assert.equal(before.status,200);
  assert.equal(hash(before.body),payload.sourceStageSha256);validateLocally(before.body,payload.input);
  const list=async()=>{const r=await requestJson(`${notesUrl}?runId=${encodeURIComponent(runId)}&stageId=${encodeURIComponent(stageId)}`);assert.equal(r.status,200);return r.body.annotations;};
  const previous=await list();let note=previous.find(n=>n.requestKey===payload.input.requestKey),writeAttempted=false;
  if(!note){
    writeAttempted=true;
    // An uncertain POST outcome is reconciled by the idempotency key below,
    // never followed by a blind second write.
    try {
      const r=await fetch(notesUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload.input),signal:AbortSignal.timeout(120000)});
      if(r.status!==201)throw Error(`Annotation HTTP ${r.status}`);
      note=(await r.json()).annotation;
    }catch(error){note=(await list()).find(n=>n.requestKey===payload.input.requestKey);if(!note)throw error;}
  }
  assert.deepEqual(Object.fromEntries(Object.keys(payload.input).map(k=>[k,note[k]])),payload.input);
  const afterNotes=await list();assert.deepEqual(afterNotes.find(n=>n.id===note.id),note);
  for(const old of previous)assert.deepEqual(afterNotes.find(n=>n.id===old.id),old);
  assert.equal(afterNotes.length,previous.length+(previous.some(n=>n.id===note.id)?0:1));
  const after=await requestJson(stageUrl);assert.equal(after.status,200);assert.deepEqual(after.body,before.body);
  const detail=await requestJson(`${notesUrl}/${encodeURIComponent(note.id)}`);assert.equal(detail.status,200);
  for(const evidence of note.evidence)assert.ok(detail.body.sources.find(s=>s.id===evidence.sourceId)?.text.includes(evidence.quote));
  const proof={observedAt:new Date().toISOString(),workId,planId,note,writeAttempted,stageUnchanged:true,
    sourceStageSha256:hash(after.body),existingStageNotesPreserved:previous.length,sourceReadbackVerified:true,
    modelCalls:0,verdictChanges:0,questionsResolved:0,formalAcceptance:false};
  fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
  console.log({annotationId:note.id,writeAttempted,stageUnchanged:true,sourceReadbackVerified:true});
}
