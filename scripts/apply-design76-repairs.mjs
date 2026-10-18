// Rehearse and save reviewed design76 as a proposal, retaining all older records.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {PrismaWorkRepository} from '../packages/persistence/src/prisma-repository.ts';
import {ChapterWorkflow} from '../packages/application/src/index.ts';
import {validateDesignCandidate} from '../packages/application/src/design-candidate.ts';
import {designReviewHash} from '../novel-service-core/src/design-review.ts';
const mode=process.argv[2],version=process.argv[3]??'v1';
assert.ok(['--rehearse','--apply','--verify'].includes(mode));assert.match(version,/^v\d+$/);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p));
const proofPath=`docs/audits/2026-10-18-design76-identity-${version}-candidate.json`;
const proof=read(proofPath),candidate=read(proof.candidatePath),baseline=read(proof.baselinePath);
assert.equal(hash(candidate),proof.candidateSha256);assert.equal(hash(baseline.candidate),proof.baseCandidateSha256);
const validation=validateDesignCandidate(candidate);assert.equal(validation.valid,true);assert.equal(validation.blockers.length,41);
assert.deepEqual(validation.blockers,validateDesignCandidate(baseline.candidate).blockers);
// A mechanical identity correction is checked against the character profile.
assert.equal(proof.exactSingleReplacement,true);
assert.equal(candidate.storyBible.characters.find(c=>c.id==='char_15').name,'贺青梧');
assert.equal(JSON.stringify(candidate),JSON.stringify(baseline.candidate).replace(proof.correction.from,proof.correction.to));
const reviews={manualIdentityCorrection:{findingPath:proof.findingPath,correction:proof.correction,exactSingleReplacement:true}};
const db=`${process.cwd()}/data/novel-studio.db`;
const control=`data/audit-runtimes/design76-apply-${version}`;
fs.mkdirSync(control,{recursive:true});
const appliedPath='docs/audits/2026-10-18-design76-repairs-applied.json';
const rehearsalPath=`docs/audits/2026-10-18-design76-repairs-${version}-rehearsal.json`;
const intentPath=`${control}/apply-intent.json`;
const immutableFields=['versions','events','manuscripts','candidates','designReviewRuns','designContentReviews'];
const signature=w=>({activePlanId:w.activePlanId,...Object.fromEntries(immutableFields.map(k=>[k,[...w[k]].map(([id,v])=>[id,hash(v)])]))});
const history=w=>({plans:[...w.plans].map(([id,v])=>[id,hash(v)]),designHistory:[...w.designHistory].map(([id,v])=>[id,hash(v)])});
const open=dbPath=>{const prisma=new PrismaClient({datasources:{db:{url:'file:'+dbPath}}});return {prisma,repo:new PrismaWorkRepository(prisma)}};
let dbPath=db;
if(mode==='--rehearse'){
 assert.ok(!fs.existsSync(rehearsalPath));
 dbPath=fs.mkdtempSync(`${process.cwd()}/${control}/rehearsal-`)+'/rehearsal.db';
 execFileSync('python3',['-c',"import sqlite3,sys; src=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); dst=sqlite3.connect(sys.argv[2]); src.backup(dst); dst.close(); src.close()",db,dbPath]);
}
// A verified terminal segment is required before replacing its design baseline.
const review75Proof=read('docs/audits/2026-10-18-design75-review-segment-0.json');
assert.equal(fileHash(review75Proof.checkpointPath),review75Proof.checkpointSha256);
assert.equal(fileHash('data/audit-runtimes/design75-review/result.json'),review75Proof.checkpointSha256);
assert.equal(review75Proof.workerAbsent,true);assert.equal(review75Proof.unsettledCalls,0);
const worker=read(review75Proof.checkpointPath);
try{process.kill(worker.pid,0);assert.fail('Design75 worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const {prisma,repo}=open(dbPath);
try{
 const w=await repo.get(proof.workId);assert.ok(w);
 if(mode==='--verify'){
  const saved=read(appliedPath),intent=read(intentPath),plan=w.plans.get(saved.appliedPlanId);
  assert.equal(saved.candidateSha256,proof.candidateSha256);
  assert.deepEqual(signature(w),intent.protected);
  for(const [key,records] of Object.entries(intent.history)) for(const [id,h] of records)assert.equal(hash(w[key].get(id)),h);
  assert.equal(w.worldPack.revision,40);assert.equal(w.storyBible.revision,72);assert.equal(plan.revision,76);assert.equal(plan.status,'proposed');
  assert.equal(w.plans.get(w.activePlanId).revision,10);
  assert.deepEqual(plan.plan,candidate.plan);
  assert.deepEqual(w.worldPack,JSON.parse(JSON.stringify({...candidate.worldPack,revision:40,status:'proposed',lockedAt:undefined})));
  assert.deepEqual(w.storyBible,JSON.parse(JSON.stringify({...candidate.storyBible,revision:72,status:'proposed',lockedAt:undefined,worldPackId:w.worldPack.id,worldPackRevision:40})));
  console.log(JSON.stringify({verified:true,revisions:saved.revisions,blockers:41,formalAcceptance:false}));
 } else {
  assert.equal(designReviewHash(w,proof.basePlanId),proof.expectedInputHash);
  assert.equal(w.worldPack.revision,40);assert.equal(w.storyBible.revision,72);assert.equal(w.plans.get(proof.basePlanId).revision,75);
  assert.ok(![...w.designReviewRuns.values()].some(r=>r.leaseToken && Date.parse(r.leaseExpiresAt??'')>Date.now()));
  const protectedBefore=signature(w),historyBefore=history(w);
  if(mode==='--apply'){
   assert.ok(!fs.existsSync(appliedPath)&&!fs.existsSync(intentPath),'Existing application requires inspection and --verify');
   const rehearsal=read(rehearsalPath);assert.equal(rehearsal.candidateSha256,proof.candidateSha256);assert.deepEqual(rehearsal.reviews,reviews);assert.equal(rehearsal.verified,true);
   fs.writeFileSync(intentPath,JSON.stringify({createdAt:new Date().toISOString(),candidateSha256:proof.candidateSha256,expectedInputHash:proof.expectedInputHash,protected:protectedBefore,history:historyBefore},null,2)+'\n',{flag:'wx'});
  }
  const workflow=new ChapterWorkflow(repo,{generateChapter(){throw Error('No prose during design repair')}});
  const saved=await workflow.saveDesignCandidate(proof.workId,{basePlanId:proof.basePlanId,expectedInputHash:proof.expectedInputHash,candidate,note:'design76人物名校正：第三卷训练资源账中的贺小满改为人物表char_15贺青梧；仅改这一处名称，保留全部旧阻塞与评审，尚待新运行时四领域正式评审。'});
  const after=await repo.get(proof.workId);
  assert.deepEqual(signature(after),protectedBefore);
  for(const [key,records] of Object.entries(historyBefore))for(const [id,h]of records)assert.equal(hash(after[key].get(id)),h,`${key}/${id}`);
  assert.equal(after.plans.size,historyBefore.plans.length+1);assert.equal(after.designHistory.size,historyBefore.designHistory.length);
  assert.equal(saved.plan.revision,76);assert.equal(saved.plan.status,'proposed');assert.equal(after.worldPack.revision,40);assert.equal(after.storyBible.revision,72);
  assert.equal(saved.validation.blockers.length,41);assert.equal(saved.contentReview.ready,false);
  assert.equal(after.plans.get(after.activePlanId).revision,10);assert.deepEqual(saved.plan.plan,candidate.plan);
  const result={kind:mode==='--apply'?'design76_applied_as_proposal':'design76_private_sqlite_rehearsal',createdAt:new Date().toISOString(),workId:proof.workId,sourcePlanId:proof.basePlanId,appliedPlanId:saved.plan.id,candidatePath:proof.candidatePath,candidateSha256:proof.candidateSha256,expectedInputHash:proof.expectedInputHash,reviews,verified:true,revisions:{world:40,storyBible:72,plan:76,approvedPlan:10},historicalCounts:{plans:historyBefore.plans.length,designHistory:historyBefore.designHistory.length,runs:protectedBefore.designReviewRuns.length,reports:protectedBefore.designContentReviews.length},allHistoryAndProsePreserved:true,blockersRetained:41,blockersClosed:0,formalAcceptance:false,proseGenerated:false,productionDesignSaves:mode==='--apply'?1:0,nextRequiredAction:'Four-area formal review of design76; local pass does not approve prose.'};
  fs.writeFileSync(mode==='--apply'?appliedPath:rehearsalPath,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({mode,verified:true,revisions:result.revisions,productionDesignSaves:result.productionDesignSaves,formalAcceptance:false}));
 }
}finally{await repo.disconnect();await prisma.$disconnect();}
