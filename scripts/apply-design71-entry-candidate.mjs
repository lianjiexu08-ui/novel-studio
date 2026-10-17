// Save the independently reviewed location repair as a new, unapproved proposal.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {PrismaWorkRepository} from '../packages/persistence/src/prisma-repository.ts';
import {validateDesignCandidate} from '../packages/application/src/design-candidate.ts';
import {designReviewHash,designReviewOverview} from '../novel-service-core/src/design-review.ts';
import {qualityAuditFor} from '../novel-service-core/src/core.ts';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=x=>createHash('sha256').update(x).digest('hex');
const hash=x=>sha(JSON.stringify(x));
const fileHash=p=>sha(fs.readFileSync(p));
const clean=x=>JSON.parse(JSON.stringify(x));
const mode=process.argv[2];assert.ok(['--prepare','--apply','--verify'].includes(mode));
const repair=read('docs/audits/2026-10-17-design70-entry-candidate-v2.json');
const reviewPath='docs/audits/2026-10-17-design70-entry-content-review-v2.json';
const review=read(reviewPath);
const terminalPath='docs/audits/2026-10-17-design70-review-result.json';
const terminal=read(terminalPath),checkpoint=read(terminal.checkpointPath);
assert.equal(terminal.status,'completed');assert.equal(fileHash(terminal.checkpointPath),terminal.checkpointSha256);
try{process.kill(checkpoint.pid,0);assert.fail('Formal worker still live');}catch(error){assert.equal(error.code,'ESRCH');}
assert.equal(fileHash(repair.candidatePath),repair.candidateSha256);
assert.equal(review.candidateSha256,repair.candidateSha256);
assert.equal(fileHash(review.outputPath),review.outputSha256);
assert.equal(fileHash(terminalPath),review.terminalProofSha256);
assert.deepEqual(review.result.checks.map(c=>[c.criterion,c.verdict]),[['causality','pass'],['timeline','pass'],['pacing','pass']]);
const rehearsal=read('docs/audits/2026-10-17-design70-entry-save-rehearsal-v2.json');
assert.equal(rehearsal.candidateSha256,repair.candidateSha256);
for(const [p,h] of Object.entries(rehearsal.sourceHashes))assert.equal(fileHash(p),h,p);
const candidate=read(repair.candidatePath),validation=validateDesignCandidate(candidate);
assert.equal(validation.valid,true);assert.equal(validation.blockers.length,41);
const control=path.resolve('data/audit-runtimes/design71-entry-application');
const manifestPath=path.join(control,'manifest.json');
const proofPath='docs/audits/2026-10-17-design71-applied.json';
const maps=['plans','designHistory','versions','events','manuscripts','candidates','designReviewRuns','designContentReviews'];
const serialize=w=>Object.fromEntries(Object.entries(w).map(([k,v])=>[k,v instanceof Map?[...v]:v]));
const mutable=new Set(['storyBible','plans','designHistory','constraintRevision']);
const protectedHash=w=>hash(Object.fromEntries(Object.entries(serialize(w)).filter(([k])=>!mutable.has(k))));
function backup(destination){
 assert.ok(!fs.existsSync(destination),'Preserve previous snapshot');
 execFileSync('python3',['-c','import sqlite3,sys,pathlib\ns=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True,timeout=30)\nt=sqlite3.connect(sys.argv[2])\ns.backup(t,pages=1000,sleep=0.05)\nt.close()\ns.close()',path.resolve('data/novel-studio.db'),destination],{timeout:120000});
}
async function load(p){
 const repo=new PrismaWorkRepository(new PrismaClient({datasources:{db:{url:`file:${p}`}}}));
 try{return await repo.get(repair.workId);}finally{await repo.disconnect();}
}
function checkBase(w){
 assert.ok(w);assert.equal(designReviewHash(w,repair.basePlanId),repair.expectedInputHash);
 assert.equal(w.plans.size,70);assert.equal(w.plans.get(w.activePlanId).revision,10);
 assert.ok(![...w.designReviewRuns.values()].some(r=>r.leaseToken&&Date.parse(r.leaseExpiresAt??'')>Date.now()));
 for(const r of checkpoint.runs)assert.deepEqual(w.designReviewRuns.get(r.id),r);
 for(const r of checkpoint.reports)assert.deepEqual(w.designContentReviews.get(r.id),r);
 assert.equal(hash({world:w.worldPack,bible:w.storyBible,plans:[...w.plans],activePlanId:w.activePlanId,
  versions:[...w.versions],events:[...w.events],manuscripts:[...w.manuscripts],candidates:[...w.candidates]}),terminal.preserved.protectedHash);
}
if(mode==='--prepare'){
 assert.ok(!fs.existsSync(control),'Preserve earlier preparation');fs.mkdirSync(control);
 const beforePath=path.join(control,'before.db');backup(beforePath);
 const before=await load(beforePath);checkBase(before);
 const manifest={preparedAt:new Date().toISOString(),beforePath,beforeSha256:fileHash(beforePath),
  scriptSha256:fileHash(process.argv[1]),candidateSha256:repair.candidateSha256,reviewSha256:fileHash(reviewPath),
  terminalSha256:fileHash(terminalPath),baselineHash:hash(serialize(before)),protectedHash:protectedHash(before),
  maps:Object.fromEntries(maps.map(k=>[k,[...before[k]].map(([id,v])=>[id,hash(v)])]))};
 fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({prepared:true,retained:Object.fromEntries(maps.map(k=>[k,before[k].size])),productionWrites:0}));
}else{
 const manifest=read(manifestPath);
 assert.equal(fileHash(process.argv[1]),manifest.scriptSha256);
 assert.equal(fileHash(manifest.beforePath),manifest.beforeSha256);
 assert.equal(fileHash(reviewPath),manifest.reviewSha256);assert.equal(fileHash(terminalPath),manifest.terminalSha256);
 assert.equal(repair.candidateSha256,manifest.candidateSha256);
 if(mode==='--apply'){
  const attemptPath=path.join(control,'attempt.json');assert.ok(!fs.existsSync(attemptPath),'Existing save attempt: inspect and verify, never resubmit');
  const freshPath=path.join(control,'pre-save.db');backup(freshPath);
  const fresh=await load(freshPath);checkBase(fresh);assert.equal(hash(serialize(fresh)),manifest.baselineHash);
  fs.writeFileSync(attemptPath,JSON.stringify({startedAt:new Date().toISOString(),candidateSha256:repair.candidateSha256}),{flag:'wx'});
  const response=await fetch(`http://127.0.0.1:8787/works/${repair.workId}/design/candidate`,{method:'PUT',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({basePlanId:repair.basePlanId,expectedInputHash:repair.expectedInputHash,candidate,
    note:'依据提案70总坛准入不足与局部内容复核，将墨幽屠开篇驻地和第14章接报同步到青灵坊市公共后街；保留原地点门槛和全部历史，仅保存新提案，不批准写作或关闭问题。'})});
  const body=await response.text();fs.writeFileSync(path.join(control,'save-response.json'),JSON.stringify({status:response.status,body}),{flag:'wx'});
  assert.equal(response.status,201,body.slice(0,300));
 }
 const afterPath=path.join(fs.mkdtempSync(path.join(control,'verification-')),'after.db');backup(afterPath);
 const after=await load(afterPath),before=await load(manifest.beforePath);assert.ok(after);
 assert.equal(protectedHash(after),manifest.protectedHash);
 for(const k of maps){for(const [id,h]of manifest.maps[k])assert.equal(hash(after[k].get(id)),h,`${k}/${id}`);
  assert.equal(after[k].size,manifest.maps[k].length+(k==='plans'||k==='designHistory'?1:0));}
 assert.equal(after.constraintRevision,before.constraintRevision+1);
 const added=[...after.plans.values()].filter(p=>!before.plans.has(p.id));assert.equal(added.length,1);
 const plan=added[0];assert.equal(plan.revision,71);assert.equal(plan.status,'proposed');assert.deepEqual(plan.plan,candidate.plan);
 assert.deepEqual(after.worldPack,before.worldPack);assert.equal(plan.worldPackRevision,36);assert.equal(plan.storyBibleRevision,68);
 assert.deepEqual(after.storyBible,clean({...candidate.storyBible,revision:68,status:'proposed',lockedAt:undefined,worldPackId:after.worldPack.id,worldPackRevision:36}));
 const audit=qualityAuditFor(after),blockers=audit.questions.filter(q=>q.blocking&&q.status!=='resolved').length;
 assert.equal(blockers,41);assert.equal(plan.plan.chapters.flatMap(c=>c.executionChecks??[]).length,41);
 assert.equal(designReviewOverview(after,plan.id).ready,false);
 const inputHash=designReviewHash(after,plan.id);assert.notEqual(inputHash,repair.expectedInputHash);
 const proof={observedAt:new Date().toISOString(),workId:repair.workId,manifestPath,candidatePath:repair.candidatePath,candidateSha256:repair.candidateSha256,
  sourcePlanId:repair.basePlanId,sourceInputHash:repair.expectedInputHash,appliedPlanId:plan.id,inputHash,
  revisions:{world:36,bible:68,plan:71,approvedPlan:after.plans.get(after.activePlanId).revision},
  oldCounts:Object.fromEntries(maps.map(k=>[k,manifest.maps[k].length])),savedContentMatchesCandidate:true,oldRecordsPreserved:true,
  unrelatedFieldsUnchanged:true,blockers,executionChecks:41,modelCalls:0,productionDesignSaves:1,formalAcceptance:false,proseGenerated:false};
 if(fs.existsSync(proofPath)){const prior=read(proofPath);assert.deepEqual({...proof,observedAt:prior.observedAt},prior);}
 else fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(proof));
}
