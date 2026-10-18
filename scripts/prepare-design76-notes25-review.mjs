// Rebase only the annotation baseline; retain the same planner epochs and raw calls.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {PrismaClient} from '@prisma/client';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)??'undefined').digest('hex');
const previous='data/audit-runtimes/design76-notes24-review',control='data/audit-runtimes/design76-notes25-review';
assert.ok(!fs.existsSync(control));
const checkpointPath=previous+'/result.json',state=read(checkpointPath),prior=read(previous+'/baseline.json');
const verificationPath='docs/audits/2026-10-18-design76-notes24-review-segment-25.json',verification=read(verificationPath);
assert.equal(state.segment,25);assert.equal(state.totalCalls,168);assert.equal(state.status,'stopped_after_stage_limit');assert.equal(sha(checkpointPath),verification.checkpointSha256);assert.equal(verification.workerAbsent,true);assert.equal(verification.unsettledCalls,0);
try{process.kill(state.pid,0);assert.fail('Formal worker live');}catch(e){assert.equal(e.code,'ESRCH');}
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
assert.equal(sha(bindingPath),prior.runtimeBindingSha256);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(`${binding.runtimePath}/${p}`),h);
for(const[p,h]of Object.entries(binding.dependencyHashes))assert.equal(sha(p),h);
assert.equal(sha('scripts/run-design76-notes24-review.mjs'),prior.runnerSha256);
assert.equal(sha(previous+'/inputs.json'),prior.inputsSha256);
const oldRunner=fs.readFileSync('scripts/run-design76-notes24-review.mjs','utf8'),newRunner=fs.readFileSync('scripts/run-design76-notes25-review.mjs','utf8');
assert.equal(newRunner,oldRunner.replaceAll('design76-notes24-review','design76-notes25-review').replaceAll('scripts/run-design76-notes23-review.mjs','scripts/run-design76-notes24-review.mjs'));
assert.deepEqual(prior.plannerEpochs.map(p=>p.afterCall),[0,37,39,62,71,76,82]);
const notesPath='docs/audits/2026-10-18-design76-segment25-notes-applied.json',notes=read(notesPath);
assert.equal(notes.verified,true);assert.equal(notes.baseCheckpointSha256,verification.checkpointSha256);assert.equal(notes.runtimeBindingSha256,sha(bindingPath));assert.equal(notes.annotationsAdded,2);assert.equal(notes.oldAnnotationsPreserved,30);assert.equal(notes.restartReadback,true);
fs.mkdirSync(control);fs.mkdirSync(control+'/model-calls');
const copy=(a,b)=>fs.copyFileSync(a,b,fs.constants.COPYFILE_EXCL);
copy(checkpointPath,control+'/predecessor.json');copy(checkpointPath,control+'/result.json');copy(previous+'/inputs.json',control+'/inputs.json');
const prefixJournal={};for(const name of fs.readdirSync(previous+'/model-calls').filter(n=>n.endsWith('.json')).sort()){copy(previous+'/model-calls/'+name,control+'/model-calls/'+name);prefixJournal[name]=sha(control+'/model-calls/'+name);}
assert.equal(Object.keys(prefixJournal).filter(n=>n.endsWith('.started.json')).length,state.totalCalls);
const database=path.resolve(control,'baseline.db');
execFileSync('python3',['-c',"import sqlite3,sys; a=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()",path.resolve('data/novel-studio.db'),database]);
const {PrismaWorkRepository}=await import(binding.runtimePath+'/packages/persistence/src/prisma-repository.ts');
const client=new PrismaClient({datasources:{db:{url:'file:'+database}}}),repo=new PrismaWorkRepository(client);let annotations;
try{
 const work=await repo.get(prior.workId);assert.ok(work);
 const digests=Object.fromEntries(Object.keys(work).filter(k=>k!=='designReviewAnnotations').sort().map(k=>{const v=work[k];return[k,hash(v instanceof Map?[...v].map(([id,value])=>[id,hash(value)]):v)];}));
 assert.deepEqual(digests,notes.preservedWorkFieldDigests);
 for(const[id,h]of prior.oldRuns)assert.equal(hash(work.designReviewRuns.get(id)),h);
 for(const[id,h]of prior.oldReports)assert.equal(hash(work.designContentReviews.get(id)),h);
 for(const run of state.runs)assert.deepEqual(work.designReviewRuns.get(run.id),run);
 assert.equal(work.designReviewRuns.size,prior.oldRuns.length+state.runs.length);assert.equal(work.designContentReviews.size,prior.oldReports.length+state.reports.length);
 for(const[id,h]of prior.annotations)assert.equal(hash(work.designReviewAnnotations.get(id)),h);
 for(const note of notes.notes)assert.deepEqual(work.designReviewAnnotations.get(note.id),note);
 annotations=[...work.designReviewAnnotations].map(([id,n])=>[id,hash(n)]);assert.equal(annotations.length,32);
}finally{await repo.disconnect();await client.$disconnect();}
const baseline={...prior,createdAt:new Date().toISOString(),predecessorCallCount:state.totalCalls,predecessorRuntimeBindingPath:bindingPath,predecessorRuntimeBindingSha256:sha(bindingPath),
 runnerSha256:sha('scripts/run-design76-notes25-review.mjs'),predecessorRunnerSha256:prior.runnerSha256,predecessorCheckpointPath:checkpointPath,predecessorCheckpointSha256:sha(checkpointPath),predecessorVerificationPath:verificationPath,predecessorVerificationSha256:sha(verificationPath),prefixJournal,annotations,notesProofSha256:sha(notesPath)};
fs.writeFileSync(control+'/baseline.json',JSON.stringify(baseline,null,2)+'\n',{flag:'wx'});
const proof={kind:'design76_notes25_review_preparation',verified:true,baselineSha256:sha(control+'/baseline.json'),predecessorCheckpointSha256:sha(checkpointPath),notesProofSha256:sha(notesPath),runtimeBindingSha256:sha(bindingPath),unchangedPlannerEpochs:true,unchangedSchedulingAndPrompt:true,prefixCalls:state.totalCalls,annotationsPreserved:32,databaseSnapshotPath:database,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Preparation only; independently replay the prefix before starting the next formal worker.'};
fs.writeFileSync('docs/audits/2026-10-18-design76-notes25-review-preflight.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({prepared:true,resumeSha256:sha(checkpointPath),prefixCalls:state.totalCalls,annotations:32,productionWrites:0}));
