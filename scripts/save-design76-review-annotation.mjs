// Rehearse against the verified private snapshot, then append one clarification
// through the frozen workflow only after the live formal segment has stopped.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
const read=p=>JSON.parse(fs.readFileSync(p));
const hash=v=>createHash('sha256').update(JSON.stringify(v)??'undefined').digest('hex');
const fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const rehearse=process.argv.includes('--rehearse'),apply=process.argv.includes('--apply');
assert.notEqual(rehearse,apply,'Choose --rehearse or --apply');
const preparedPath='docs/audits/2026-10-18-design76-review-annotation-inputs.json',prepared=read(preparedPath);
const payload=read(prepared.outputPath);assert.equal(hash(payload),prepared.outputSha256);assert.equal(payload.annotations.length,1);
const bindingPath='data/audit-runtimes/design76-recovery-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(fileHash(`${binding.runtimePath}/${p}`),h);
for(const[p,h]of Object.entries(binding.dependencyHashes))assert.equal(fileHash(p),h);
const {PrismaWorkRepository}=await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const {ChapterWorkflow}=await import(`${binding.runtimePath}/packages/application/src/index.ts`);
const {annotationSources}=await import(`${binding.runtimePath}/novel-service-core/src/design-review-annotations.ts`);
const rehearsalPath='docs/audits/2026-10-18-design76-review-annotation-rehearsal.json';
const outputPath=apply?'docs/audits/2026-10-18-design76-review-annotation-applied.json':rehearsalPath;
assert.ok(!fs.existsSync(outputPath),'Preserve existing completed evidence');
const control=fs.mkdtempSync(path.resolve('data/audit-runtimes',apply?'design76-note-apply-':'design76-note-rehearsal-'));
let database,verification;
if(rehearse){
  verification=read(prepared.verificationPath);
  assert.equal(fileHash(prepared.verificationPath),prepared.verificationSha256);
  database=path.join(control,'private.db');
  // SQLite backup reads the already-verified stopped snapshot, never the live DB.
  execFileSync('python3',['-c',"import sqlite3,sys; a=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()",verification.databaseSnapshotPath,database]);
}else{
  const checkpointPath='data/audit-runtimes/design76-recovery/result.json',checkpoint=read(checkpointPath);
  assert.ok(['stopped_after_stage_limit','stopped_after_failure','stopped_after_budget','completed'].includes(checkpoint.status));
  try{process.kill(checkpoint.pid,0);assert.fail('Formal worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
  verification=read(`docs/audits/2026-10-18-design76-recovery-segment-${checkpoint.segment}.json`);
  assert.equal(fileHash(checkpointPath),verification.checkpointSha256);assert.equal(verification.workerAbsent,true);
  const rehearsal=read(rehearsalPath);assert.equal(rehearsal.verified,true);
  assert.equal(rehearsal.runnerSha256,fileHash(process.argv[1]));
  assert.equal(rehearsal.preparedSha256,fileHash(preparedPath));
  assert.equal(rehearsal.runtimeBindingSha256,fileHash(bindingPath));
  database=path.resolve('data/novel-studio.db');
  execFileSync('python3',['-c',"import sqlite3,sys; a=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()",database,path.join(control,'before.db')]);
}

// Hash each map record independently so accumulated source histories are never
// stringified as a single huge value. Every other own Work field is protected.
function digests(work){
  return Object.fromEntries(Object.keys(work).filter(k=>k!=='designReviewAnnotations').sort().map(k=>{
    const value=work[k];
    return [k,hash(value instanceof Map?[...value].map(([id,item])=>[id,hash(item)]):value)];
  }));
}
const open=()=>{const client=new PrismaClient({datasources:{db:{url:'file:'+database}}});return {client,repo:new PrismaWorkRepository(client)};};
let {client,repo}=open(),beforeDigests,oldNotes,oldRuns,oldReports,note;
try{
  let before=await repo.get(payload.workId);assert.ok(before);
  for(const input of payload.annotations)annotationSources(before,input);
  beforeDigests=digests(before);oldNotes=[...before.designReviewAnnotations].map(([id,n])=>[id,hash(n)]);
  oldRuns=before.designReviewRuns.size;oldReports=before.designContentReviews.size;
  assert.ok(![...before.designReviewAnnotations.values()].some(n=>n.runId===payload.annotations[0].runId&&n.requestKey===payload.annotations[0].requestKey),'Inspect an existing note instead of repeating import');
  fs.writeFileSync(path.join(control,'intent.json'),JSON.stringify({database,workId:payload.workId,beforeDigests,oldNotes,request:payload.annotations[0]},null,2)+'\n',{flag:'wx'});
  before=undefined;
  const workflow=new ChapterWorkflow(repo,{generateChapter(){throw Error('Annotation import cannot generate prose');}});
  note=await workflow.addDesignReviewAnnotation(payload.workId,payload.annotations[0]);
  if(rehearse)assert.deepEqual(await workflow.addDesignReviewAnnotation(payload.workId,payload.annotations[0]),note,'Repeated request must return the same note');
}finally{await repo.disconnect();await client.$disconnect();}
({client,repo}=open());
let proof;
try{
  const after=await repo.get(payload.workId);assert.ok(after);
  assert.deepEqual(digests(after),beforeDigests,'A field outside annotations changed');
  for(const[id,h]of oldNotes)assert.equal(hash(after.designReviewAnnotations.get(id)),h);
  assert.equal(after.designReviewAnnotations.size,oldNotes.length+1);
  assert.deepEqual(after.designReviewAnnotations.get(note.id),note);
  assert.deepEqual(annotationSources(after,note),prepared.completeOriginalSources);
  proof={kind:apply?'design76_review_clarification_appended':'design76_private_review_clarification_rehearsal',createdAt:new Date().toISOString(),verified:true,
    database,control,runnerSha256:fileHash(process.argv[1]),preparedSha256:fileHash(preparedPath),runtimeBindingSha256:fileHash(bindingPath),
    sourceCommit:binding.sourceCommit,baseCheckpointSha256:verification.checkpointSha256,workId:payload.workId,note,
    preservedWorkFieldDigests:beforeDigests,oldRunsPreserved:oldRuns,oldReportsPreserved:oldReports,oldAnnotationsPreserved:oldNotes.length,
    annotationsAdded:1,restartReadback:true,idempotenceExercised:rehearse,modelCalls:0,productionWrites:apply?1:0,
    verdictChanges:0,questionsResolved:0,formalAcceptance:false,maxRssKiB:process.resourceUsage().maxRSS};
}finally{await repo.disconnect();await client.$disconnect();}
fs.writeFileSync(outputPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,rehearsal:rehearse,annotationId:note.id,oldRunsPreserved:oldRuns,oldReportsPreserved:oldReports,productionWrites:proof.productionWrites,maxRssKiB:proof.maxRssKiB}));
