// Inspect the already-saved isolated candidate; never resubmit it.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {PrismaWorkRepository} from '../../packages/persistence/src/prisma-repository.ts';
import {qualityAuditFor} from '../../novel-service-core/src/core.ts';
import {designReviewHash,designReviewOverview} from '../../novel-service-core/src/design-review.ts';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=x=>createHash('sha256').update(x).digest('hex');
const hash=x=>sha(JSON.stringify(x));
const fileHash=p=>sha(fs.readFileSync(p));
const clean=x=>JSON.parse(JSON.stringify(x));
const repair=read('docs/audits/2026-10-17-design70-entry-candidate.json');
const verified=read('docs/audits/2026-10-17-design70-story-complete.json');
const sourceSnapshot=fs.realpathSync(verified.databaseSnapshotPath);
assert.equal(fileHash(sourceSnapshot),verified.databaseSnapshotSha256);
assert.equal(fileHash(repair.candidatePath),repair.candidateSha256);
const dir=path.resolve('data/audit-runtimes/design70-entry-save-rehearsal');
const databasePath=path.join(dir,'isolated.db');
const beforePath=path.join(dir,'before-verification.db');
assert.ok(fs.existsSync(databasePath));
assert.ok(!fs.existsSync(beforePath));
const proofPath='docs/audits/2026-10-17-design70-entry-save-rehearsal.json';
assert.ok(!fs.existsSync(proofPath));
fs.copyFileSync(sourceSnapshot,beforePath,fs.constants.COPYFILE_EXCL);
for(const p of [beforePath,databasePath]){
 assert.notEqual(fs.realpathSync(p),fs.realpathSync('data/novel-studio.db'));
 assert.notEqual(fs.realpathSync(p),sourceSnapshot);
 assert.notDeepEqual([fs.statSync(p).dev,fs.statSync(p).ino],[fs.statSync(sourceSnapshot).dev,fs.statSync(sourceSnapshot).ino]);
}
const tracked=execFileSync('git',['ls-files','packages','novel-service-core'],{encoding:'utf8'}).trim().split('\n');
const sourceHashes=Object.fromEntries(tracked.filter(p=>p.endsWith('.ts')).map(p=>[p,fileHash(p)]));
const maps=['plans','designHistory','versions','events','manuscripts','candidates','designReviewRuns','designContentReviews'];
const excluded=new Set([...maps,'worldPack','storyBible','constraintRevision']);
const otherHash=w=>hash(Object.fromEntries(Object.entries(w).filter(([k])=>!excluded.has(k)).map(([k,v])=>[k,v instanceof Map?[...v]:v])));
async function load(p){
 const repo=new PrismaWorkRepository(new PrismaClient({datasources:{db:{url:`file:${p}`}}}));
 try{return await repo.get(repair.workId);}finally{await repo.disconnect();}
}
const before=await load(beforePath);
assert.ok(before);
assert.equal(designReviewHash(before,repair.basePlanId),repair.expectedInputHash);
assert.equal(before.plans.size,70);
const after=await load(databasePath);
assert.ok(after);
assert.equal(otherHash(after),otherHash(before));
for(const key of maps){
 for(const [id,value] of before[key]) assert.equal(hash(after[key].get(id)),hash(value),`${key}/${id}`);
 assert.equal(after[key].size,before[key].size+(key==='plans'||key==='designHistory'?1:0));
}
assert.equal(after.constraintRevision,before.constraintRevision+1);
assert.deepEqual(after.worldPack,before.worldPack,'Unchanged world content keeps its existing revision and snapshot');
const added=[...after.plans.values()].filter(p=>!before.plans.has(p.id));
assert.equal(added.length,1);
const plan=added[0], candidate=read(repair.candidatePath);
assert.equal(plan.revision,71);assert.equal(plan.status,'proposed');
assert.equal(plan.worldPackRevision,36);assert.equal(plan.storyBibleRevision,68);
assert.deepEqual(plan.plan,candidate.plan);
assert.deepEqual(after.storyBible,clean({...candidate.storyBible,revision:68,status:'proposed',lockedAt:undefined,worldPackId:after.worldPack.id,worldPackRevision:36}));
assert.equal(after.activePlanId,before.activePlanId);
assert.equal(after.plans.get(after.activePlanId).revision,10);
const inputHash=designReviewHash(after,plan.id);
assert.notEqual(inputHash,repair.expectedInputHash);
assert.equal(designReviewOverview(after,plan.id).ready,false);
const audit=qualityAuditFor(after);
const blockers=audit.questions.filter(q=>q.blocking&&q.status!=='resolved');
assert.equal(blockers.length,41);
const checks=plan.plan.chapters.flatMap(c=>c.executionChecks??[]);
assert.equal(checks.length,41);
assert.ok(checks.some(c=>c.id==='mo-public-message-location'));
const linked=audit.questions.flatMap(q=>q.executionChecks).filter(c=>c.planId===plan.id);
assert.equal(linked.length,33);
assert.ok(linked.every(c=>c.executionEvidence.status!=='verified'));
for(const [p,h] of Object.entries(sourceHashes))assert.equal(fileHash(p),h);
assert.equal(fileHash(sourceSnapshot),verified.databaseSnapshotSha256);
const firstAttemptPath='docs/audits/2026-10-17-design70-entry-save-rehearsal.mjs';
const proof={observedAt:new Date().toISOString(),kind:'design70_entry_isolated_save_reloaded',
 sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashes,
 sourceSnapshot,sourceSnapshotSha256:verified.databaseSnapshotSha256,databasePath,beforePath,
 candidatePath:repair.candidatePath,candidateSha256:repair.candidateSha256,
 basePlanId:repair.basePlanId,baseInputHash:repair.expectedInputHash,isolatedPlanId:plan.id,isolatedInputHash:inputHash,
 revisions:{world:36,bible:68,plan:71,approved:10},
 retainedMapCounts:Object.fromEntries(maps.map(k=>[k,before[k].size])),
 allExistingRecordsPreservedExactly:true,unrelatedFieldsUnchanged:true,unchangedWorldReused:true,
 reloadedCandidateMatchesExactly:true,staleReviewsCannotApproveCandidate:true,unresolvedBlockers:41,executionChecks:41,linkedRequirements:33,
 firstAttempt:{scriptPath:firstAttemptPath,scriptSha256:fileHash(firstAttemptPath),outcome:'Saved once; post-save assertion expected two added design snapshots but only one was correct because the world did not change.',actualDesignHistoryCount:after.designHistory.size,incorrectExpectedCount:before.designHistory.size+2},
 modelCalls:0,productionWrites:0,isolatedDesignSaves:1,additionalSavesByThisVerification:0,applied:false,formalAcceptance:false,
 limitation:'Verifies an isolated save from the previously verified story-complete snapshot. Later live world responses are outside that snapshot. Recheck then-current production history after the worker exits before any real save; no content acceptance is established.'};
fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({revisions:proof.revisions,retained:proof.retainedMapCounts,blockers:41,executionChecks:41,productionWrites:0,additionalSaves:0}));
