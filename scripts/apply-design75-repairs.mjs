// Rehearse and save reviewed design75 as a proposal, retaining all older records.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {PrismaWorkRepository} from '../packages/persistence/src/prisma-repository.ts';
import {ChapterWorkflow} from '../packages/application/src/index.ts';
import {JsonDesignPlanner} from '../packages/planner/src/index.ts';
import {validateDesignCandidate} from '../packages/application/src/design-candidate.ts';
import {designReviewHash} from '../novel-service-core/src/design-review.ts';
const mode=process.argv[2],version=process.argv[3]??'v1';
assert.ok(['--rehearse','--apply','--verify'].includes(mode));assert.match(version,/^v\d+$/);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p));
const proofPath=`docs/audits/2026-10-18-design75-technique-${version}-candidate.json`;
const proof=read(proofPath),candidate=read(proof.candidatePath),baseline=read(proof.baselinePath);
assert.equal(hash(candidate),proof.candidateSha256);assert.equal(hash(baseline.candidate),proof.baseCandidateSha256);
const validation=validateDesignCandidate(candidate);assert.equal(validation.valid,true);assert.equal(validation.blockers.length,41);
assert.deepEqual(validation.blockers,validateDesignCandidate(baseline.candidate).blockers);
const reviewControl=`data/audit-runtimes/design75-technique-${version}-review`,manifest=read(`${reviewControl}/manifest.json`);
assert.equal(manifest.candidateSha256,proof.candidateSha256);
const reviews={};
for(const area of ['world','power','story']){
 const inputPath=`${reviewControl}/${area}-input.json`,resultPath=`${reviewControl}/${area}-result.json`;
 const input=read(inputPath),state=read(resultPath);
 assert.equal(hash(input),manifest.inputs[area]);assert.equal(state.inputHash,input.inputHash);
 assert.equal(state.candidateSha256,proof.candidateSha256);assert.equal(state.status,'completed');
 assert.equal(state.model,'gpt-5.6-luna');assert.equal(state.fallback,false);
 assert.equal(state.productionWrites,0);assert.equal(state.formalAcceptance,false);
 let replayed=0;const planner=new JsonDesignPlanner({complete:async()=>{assert.ok(replayed<state.rawResponses.length);return state.rawResponses[replayed++];}});
 const replay=await planner.reviewDesignContent(input);
 assert.deepEqual(replay,state.result);assert.equal(replayed,state.rawResponses.length);
 assert.deepEqual(new Set(replay.checks.map(c=>c.criterion)),new Set(Object.keys(input.rubric)));
 assert.ok(replay.checks.every(c=>c.verdict==='pass'),`${area} requires repair`);
 reviews[area]={inputSha256:fileHash(inputPath),resultSha256:fileHash(resultPath),responses:replayed,checks:replay.checks.map(({criterion,verdict})=>({criterion,verdict}))};
}
const db=`${process.cwd()}/data/novel-studio.db`;
const control=`data/audit-runtimes/design75-apply-${version}`;
fs.mkdirSync(control,{recursive:true});
const appliedPath='docs/audits/2026-10-18-design75-repairs-applied.json';
const rehearsalPath=`docs/audits/2026-10-18-design75-repairs-${version}-rehearsal.json`;
const intentPath=`${control}/apply-intent.json`;
const immutableFields=['versions','events','manuscripts','candidates','designReviewRuns','designContentReviews'];
const signature=w=>({activePlanId:w.activePlanId,...Object.fromEntries(immutableFields.map(k=>[k,[...w[k]].map(([id,v])=>[id,hash(v)])]))});
const history=w=>({plans:[...w.plans].map(([id,v])=>[id,hash(v)]),designHistory:[...w.designHistory].map(([id,v])=>[id,hash(v)])});
const open=dbPath=>{const prisma=new PrismaClient({datasources:{db:{url:'file:'+dbPath}}});return {prisma,repo:new PrismaWorkRepository(prisma)}};
let dbPath=db;
if(mode==='--rehearse'){
 assert.ok(!fs.existsSync(rehearsalPath));
 dbPath=`${process.cwd()}/${control}/rehearsal.db`;assert.ok(!fs.existsSync(dbPath));
 execFileSync('python3',['-c',"import sqlite3,sys; src=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); dst=sqlite3.connect(sys.argv[2]); src.backup(dst); dst.close(); src.close()",db,dbPath]);
}
// A verified terminal segment is required before replacing its design baseline.
const review74Proof=read('docs/audits/2026-10-18-design74-review-segment-1.json');
assert.equal(fileHash(review74Proof.checkpointPath),review74Proof.checkpointSha256);
assert.equal(fileHash('data/audit-runtimes/design74-review/result.json'),review74Proof.checkpointSha256);
assert.equal(review74Proof.workerAbsent,true);assert.equal(review74Proof.unsettledCalls,0);
const worker=read(review74Proof.checkpointPath);
try{process.kill(worker.pid,0);assert.fail('Design74 worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const {prisma,repo}=open(dbPath);
try{
 const w=await repo.get(proof.workId);assert.ok(w);
 if(mode==='--verify'){
  const saved=read(appliedPath),intent=read(intentPath),plan=w.plans.get(saved.appliedPlanId);
  assert.equal(saved.candidateSha256,proof.candidateSha256);
  assert.deepEqual(signature(w),intent.protected);
  for(const [key,records] of Object.entries(intent.history)) for(const [id,h] of records)assert.equal(hash(w[key].get(id)),h);
  assert.equal(w.worldPack.revision,40);assert.equal(w.storyBible.revision,72);assert.equal(plan.revision,75);assert.equal(plan.status,'proposed');
  assert.equal(w.plans.get(w.activePlanId).revision,10);
  assert.deepEqual(plan.plan,candidate.plan);
  assert.deepEqual(w.worldPack,JSON.parse(JSON.stringify({...candidate.worldPack,revision:40,status:'proposed',lockedAt:undefined})));
  assert.deepEqual(w.storyBible,JSON.parse(JSON.stringify({...candidate.storyBible,revision:72,status:'proposed',lockedAt:undefined,worldPackId:w.worldPack.id,worldPackRevision:40})));
  console.log(JSON.stringify({verified:true,revisions:saved.revisions,blockers:41,formalAcceptance:false}));
 } else {
  assert.equal(designReviewHash(w,proof.basePlanId),proof.expectedInputHash);
  assert.equal(w.worldPack.revision,39);assert.equal(w.storyBible.revision,71);assert.equal(w.plans.get(proof.basePlanId).revision,74);
  assert.ok(![...w.designReviewRuns.values()].some(r=>r.leaseToken && Date.parse(r.leaseExpiresAt??'')>Date.now()));
  const protectedBefore=signature(w),historyBefore=history(w);
  if(mode==='--apply'){
   assert.ok(!fs.existsSync(appliedPath)&&!fs.existsSync(intentPath),'Existing application requires inspection and --verify');
   const rehearsal=read(rehearsalPath);assert.equal(rehearsal.candidateSha256,proof.candidateSha256);assert.deepEqual(rehearsal.reviews,reviews);assert.equal(rehearsal.verified,true);
   fs.writeFileSync(intentPath,JSON.stringify({createdAt:new Date().toISOString(),candidateSha256:proof.candidateSha256,expectedInputHash:proof.expectedInputHash,protected:protectedBefore,history:historyBefore},null,2)+'\n',{flag:'wx'});
  }
  const workflow=new ChapterWorkflow(repo,{generateChapter(){throw Error('No prose during design repair')}});
  const saved=await workflow.saveDesignCandidate(proof.workId,{basePlanId:proof.basePlanId,expectedInputHash:proof.expectedInputHash,candidate,note:'design75局部复审：补齐凝元分流入府诀的宗门保管、劳务换受限课程、本期教习授权及实际分段授课；保留七枚耗材、失败停训及全部旧阻塞，提案尚待四领域正式评审。'});
  const after=await repo.get(proof.workId);
  assert.deepEqual(signature(after),protectedBefore);
  for(const [key,records] of Object.entries(historyBefore))for(const [id,h]of records)assert.equal(hash(after[key].get(id)),h,`${key}/${id}`);
  assert.equal(after.plans.size,historyBefore.plans.length+1);assert.equal(after.designHistory.size,historyBefore.designHistory.length+2);
  assert.equal(saved.plan.revision,75);assert.equal(saved.plan.status,'proposed');assert.equal(after.worldPack.revision,40);assert.equal(after.storyBible.revision,72);
  assert.equal(saved.validation.blockers.length,41);assert.equal(saved.contentReview.ready,false);
  assert.equal(after.plans.get(after.activePlanId).revision,10);assert.deepEqual(saved.plan.plan,candidate.plan);
  const result={kind:mode==='--apply'?'design75_applied_as_proposal':'design75_private_sqlite_rehearsal',createdAt:new Date().toISOString(),workId:proof.workId,sourcePlanId:proof.basePlanId,appliedPlanId:saved.plan.id,candidatePath:proof.candidatePath,candidateSha256:proof.candidateSha256,expectedInputHash:proof.expectedInputHash,reviews,verified:true,revisions:{world:40,storyBible:72,plan:75,approvedPlan:10},historicalCounts:{plans:historyBefore.plans.length,designHistory:historyBefore.designHistory.length,runs:protectedBefore.designReviewRuns.length,reports:protectedBefore.designContentReviews.length},allHistoryAndProsePreserved:true,blockersRetained:41,blockersClosed:0,formalAcceptance:false,proseGenerated:false,productionDesignSaves:mode==='--apply'?1:0,nextRequiredAction:'Four-area formal review of design75; local pass does not approve prose.'};
  fs.writeFileSync(mode==='--apply'?appliedPath:rehearsalPath,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({mode,verified:true,revisions:result.revisions,productionDesignSaves:result.productionDesignSaves,formalAcceptance:false}));
 }
}finally{await repo.disconnect();await prisma.$disconnect();}
