import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root=process.cwd(), read=p=>JSON.parse(fs.readFileSync(p));
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const binding=read('data/audit-runtimes/design64-runtime-bound.json');
const baseline=read('data/audit-runtimes/design64-control/baseline.json');
const applied=read('docs/audits/2026-10-16-design64-applied.json');
const inputs=read('data/audit-runtimes/design64-control/prefix-audit-inputs.json');
const checkpoint=read(inputs.checkpoint);
assert.equal(checkpoint.runtimeCommit,binding.commit);
assert.equal(checkpoint.scheduleVersion,25);
assert.equal(checkpoint.candidateFileSha256,applied.candidateFileSha256);
assert.equal(checkpoint.scope.planId,baseline.planId);
for(const [p,h] of Object.entries(binding.sourceHashes))assert.equal(fileHash(path.join(binding.root,p)),h,p);
assert.equal(fileHash('data/design-candidates/design64-receipt-exception-draft-v7.json'),applied.candidateFileSha256);
const production=path.join(root,'data/novel-studio.db');
assert.notEqual(fs.realpathSync(inputs.databaseSnapshot),fs.realpathSync(production));
assert.notEqual(fs.statSync(inputs.databaseSnapshot).ino,fs.statSync(production).ino);
process.env.DATABASE_URL='file:'+inputs.databaseSnapshot;
const {PrismaWorkRepository}=await import(binding.root+'/packages/persistence/src/prisma-repository.ts');
const repo=new PrismaWorkRepository();let work;
try { work=await repo.get(baseline.workId); } finally { await repo.disconnect(); }
assert.equal(hash({world:work.worldPack,bible:work.storyBible,plans:[...work.plans],versions:[...work.versions],events:[...work.events],manuscripts:[...work.manuscripts],candidates:[...work.candidates]}),baseline.protectedHash);
for(const [id,h] of baseline.oldRuns)assert.equal(hash(work.designReviewRuns.get(id)),h);
for(const [id,h] of baseline.oldReports)assert.equal(hash(work.designContentReviews.get(id)),h);
const {designReviewInput}=await import(binding.root+'/novel-service-core/src/design-review.ts');
const stages=await import(binding.root+'/novel-service-core/src/design-review-run.ts');
const {JsonDesignPlanner}=await import(binding.root+'/packages/planner/src/index.ts');
const runtime={...stages,JsonDesignPlanner};
const {replayDesignReviewPrefix}=await import(root+'/scripts/audit-design-reviews.mjs');
const records=[];
for(const run of checkpoint.runs) {
 const expected=designReviewInput(work,run.input.area,baseline.planId);
 assert.equal(expected.inputHash,baseline.inputHash);
 const stored=work.designReviewRuns.get(run.id);
 assert.ok(stored,'Checkpoint run missing from captured database');
 // A snapshot and checkpoint can straddle a commit. Only compare the captured
 // accepted prefix; never call a newer DB tail a missing or failed response.
 for(const stage of run.stages.filter(s=>s.result))assert.deepEqual(stored.stages.find(s=>s.id===stage.id),stage);
 const replay=await replayDesignReviewPrefix(run,expected,runtime);
 records.push({area:run.input.area,runId:run.id,...replay});
}
const proof={observedAt:new Date().toISOString(),status:'partial_response_integrity_verified_not_accepted',scope:checkpoint.scope,inputHash:baseline.inputHash,
 checkpointPath:inputs.checkpoint,checkpointSha256:fileHash(inputs.checkpoint),databaseSnapshot:inputs.databaseSnapshot,
 runtimeCommit:binding.commit,scheduleVersion:25,sourceFilesVerified:Object.keys(binding.sourceHashes).length,
 verifierSha256:fileHash(process.argv[1]),replayHelperSha256:fileHash('scripts/audit-design-reviews.mjs'),
 protectedHistoryUnchanged:true,preservedOldRuns:baseline.oldRuns.length,preservedOldReports:baseline.oldReports.length,
 records,modelCalls:0,productionDatabaseWrites:0,formalAcceptance:false,designApproved:false,proseGenerated:false,
 limitation:'Offline replay verifies saved response integrity and original-source binding, not semantic correctness, final design acceptance, question resolution or prose. Review continues on the frozen runtime.'};
const out='docs/audits/2026-10-16-design64-prefix-response-audit.json';
fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:proof.status,records:records.map(r=>({area:r.area,completed:r.completedStages,total:r.totalStages,responsesReplayed:r.responsesReplayed})),output:out}));
