// Exercise all four task creations on a copy of the real large database.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';import {PrismaWorkRepository} from '../packages/persistence/src/prisma-repository.ts';
import {ChapterWorkflow} from '../packages/application/src/index.ts';import {designReviewHash} from '../novel-service-core/src/design-review.ts';
const read=p=>JSON.parse(fs.readFileSync(p)),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const crash=read('docs/audits/2026-10-18-design76-worker-crash.json'),baseline=read('data/audit-runtimes/design76-review/baseline.json');
assert.equal(fileHash(crash.checkpointPath),crash.checkpointSha256);
try{process.kill(crash.pid,0);assert.fail('Old worker is live');}catch(e){assert.equal(e.code,'ESRCH');}
const root=fs.mkdtempSync(path.resolve('data/audit-runtimes/design76-history-rehearsal-')),db=path.join(root,'private.db');
execFileSync('python3',['-c',"import sqlite3,sys; a=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()",crash.databaseSnapshotPath,db]);
const prisma=new PrismaClient({datasources:{db:{url:'file:'+db}}}),repo=new PrismaWorkRepository(prisma),started=Date.now();
const protectedHash=w=>hash({world:w.worldPack,bible:w.storyBible,plans:[...w.plans],activePlanId:w.activePlanId,designHistory:[...w.designHistory],versions:[...w.versions],events:[...w.events],manuscripts:[...w.manuscripts],candidates:[...w.candidates]});
let proof;
try{
 const before=await repo.get(baseline.workId);assert.ok(before);assert.equal(protectedHash(before),crash.protectedHash);assert.equal(designReviewHash(before,baseline.planId),crash.inputHash);
 const oldRuns=[...before.designReviewRuns].map(([id,r])=>[id,hash(r)]),oldReports=[...before.designContentReviews].map(([id,r])=>[id,hash(r)]);
 const workflow=new ChapterWorkflow(repo,{generateChapter(){throw Error('No prose');}},{reviewDesignContent(){throw Error('No model calls in rehearsal');}});
 const created=[];
 for(const area of ['world','power','characters','story']){
  const previous=crash.unstartedRuns.find(r=>r.area===area),begin=Date.now();
  const run=previous?await workflow.restartDesignReview(baseline.workId,previous.id,crash.inputHash):await workflow.startDesignReview(baseline.workId,area,baseline.planId);
  assert.equal(run.input.inputHash,crash.inputHash);assert.equal(run.status,'ready');assert.ok(run.stages.every(s=>!s.result&&!s.attempts));
  assert.equal(run.restartedFromRunId,previous?.id);
  created.push({area,runId:run.id,restartedFromRunId:run.restartedFromRunId,elapsedMs:Date.now()-begin});
  console.log(JSON.stringify(created.at(-1)));
 }
 const after=await repo.get(baseline.workId);assert.ok(after);assert.equal(protectedHash(after),crash.protectedHash);
 for(const[id,h]of oldRuns)assert.equal(hash(after.designReviewRuns.get(id)),h);
 for(const[id,h]of oldReports)assert.equal(hash(after.designContentReviews.get(id)),h);
 assert.equal(after.designReviewRuns.size,oldRuns.length+4);assert.equal(after.designContentReviews.size,oldReports.length);
 proof={kind:'design76_private_large_history_recovery_rehearsal',createdAt:new Date().toISOString(),databasePath:db,verified:true,created,
  elapsedMs:Date.now()-started,maxRssKiB:process.resourceUsage().maxRSS,oldRunsPreserved:oldRuns.length,oldReportsPreserved:oldReports.length,protectedHash:crash.protectedHash,
  sourceHashes:Object.fromEntries(['packages/persistence/src/project-history.ts','packages/persistence/src/prisma-repository.ts'].map(p=>[p,fileHash(p)])),
  modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Proves bounded persistence and preservation through four real-size private task creations. No model step or full design acceptance is implied.'};
}finally{await repo.disconnect();await prisma.$disconnect();}
fs.writeFileSync('docs/audits/2026-10-18-design76-history-recovery-rehearsal.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,elapsedMs:proof.elapsedMs,maxRssKiB:proof.maxRssKiB,oldRunsPreserved:proof.oldRunsPreserved,productionWrites:0}));
