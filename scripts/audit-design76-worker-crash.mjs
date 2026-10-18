// Read-only reconciliation of the confirmed exit-134 worker. Never edits its
// checkpoint, old reviews, design, or database; preserves a SQLite snapshot.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';import {PrismaWorkRepository} from '../packages/persistence/src/prisma-repository.ts';
const read=p=>JSON.parse(fs.readFileSync(p)),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control='data/audit-runtimes/design76-review',checkpointPath=`${control}/result.json`,checkpointHash=fileHash(checkpointPath),state=read(checkpointPath),baseline=read(`${control}/baseline.json`);
assert.equal(state.status,'running');
try{process.kill(state.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const log='/tmp/novel-design76-review-segment0.log';assert.match(fs.readFileSync(log,'utf8'),/FATAL ERROR: Zone Allocation failed - process out of memory/);
assert.equal(fs.readdirSync(`${control}/model-calls`).length,0);assert.equal(state.totalCalls,0);
const snapshot=fs.mkdtempSync(path.resolve(control,'crash-audit-')),db=path.join(snapshot,'production.db');
execFileSync('python3',['-c',"import sqlite3,sys; a=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()",path.resolve('data/novel-studio.db'),db]);
const prisma=new PrismaClient({datasources:{db:{url:'file:'+db}}}),repo=new PrismaWorkRepository(prisma);
let proof;
try{
 const w=await repo.get(baseline.workId);assert.ok(w);
 assert.equal(hash({world:w.worldPack,bible:w.storyBible,plans:[...w.plans],activePlanId:w.activePlanId,designHistory:[...w.designHistory],versions:[...w.versions],events:[...w.events],manuscripts:[...w.manuscripts],candidates:[...w.candidates]}),baseline.protectedHash);
 for(const[id,h]of baseline.oldRuns)assert.equal(hash(w.designReviewRuns.get(id)),h);
 for(const[id,h]of baseline.oldReports)assert.equal(hash(w.designContentReviews.get(id)),h);
 const runs=[...w.designReviewRuns.values()].filter(r=>r.input.inputHash===baseline.inputHash);
 assert.equal(runs.length,3);assert.equal(w.designReviewRuns.size,baseline.oldRuns.length+3);assert.equal(w.designContentReviews.size,baseline.oldReports.length);
 for(const run of runs){assert.equal(run.status,'ready');assert.ok(!run.leaseToken&&!run.reportId);assert.ok(run.stages.every(s=>!s.result&&!s.modelResponses&&!s.attempts));assert.deepEqual(run,state.runs.find(r=>r.id===run.id));}
 assert.equal(fileHash(checkpointPath),checkpointHash);
 const preserved=`${control}/crashed-segment-0.json`;fs.copyFileSync(checkpointPath,preserved,fs.constants.COPYFILE_EXCL);
 fs.copyFileSync(log,path.join(snapshot,'worker.log'),fs.constants.COPYFILE_EXCL);
 proof={kind:'design76_worker_crash_verified',observedAt:new Date().toISOString(),status:'failed_before_model_calls',observedExitCode:134,pid:state.pid,workerAbsent:true,checkpointPath:preserved,checkpointSha256:checkpointHash,logSha256:fileHash(log),databaseSnapshotPath:db,
 inputHash:baseline.inputHash,oldRunsPreserved:baseline.oldRuns.length,oldReportsPreserved:baseline.oldReports.length,protectedHash:baseline.protectedHash,
 unstartedRuns:runs.map(r=>({id:r.id,area:r.input.area,sha256:hash(r)})),leases:0,modelCalls:0,unsettledCalls:0,productionWrites:0,formalAcceptance:false,
 nextAction:'Rehearse bounded history writes against this snapshot, then bind a new runtime and explicitly restart the three unstarted runs; retain all original records and the crashed checkpoint.'};
}finally{await repo.disconnect();await prisma.$disconnect();}
fs.writeFileSync('docs/audits/2026-10-18-design76-worker-crash.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,status:proof.status,oldRuns:proof.oldRunsPreserved,oldReports:proof.oldReportsPreserved,unstartedRuns:proof.unstartedRuns.length,modelCalls:0,productionWrites:0}));
