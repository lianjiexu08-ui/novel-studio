// Bind the verified review prefix to a host that shares one queued repository.
// Preparation reads a SQLite backup; it never opens a competing production transaction.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
const read=p=>JSON.parse(fs.readFileSync(p));
const hash=v=>createHash('sha256').update(JSON.stringify(v)??'undefined').digest('hex');
const fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const previous='data/audit-runtimes/design76-capacity-review',control='data/audit-runtimes/design76-advice-review';
assert.ok(!fs.existsSync(control),'Preserve an existing shared session');
const predecessorCheckpointPath=previous+'/result.json',state=read(predecessorCheckpointPath);
assert.equal(state.status,'stopped_after_failure');assert.equal(state.segment,11);
try{process.kill(state.pid,0);assert.fail('Predecessor remains live');}catch(e){assert.equal(e.code,'ESRCH');}
const predecessorVerificationPath='docs/audits/2026-10-18-design76-capacity-review-segment-11.json',verification=read(predecessorVerificationPath);
assert.equal(fileHash(predecessorCheckpointPath),verification.checkpointSha256);assert.equal(verification.workerAbsent,true);
const priorBaseline=read(previous+'/baseline.json');
assert.equal(fileHash('scripts/run-design76-capacity-review.mjs'),priorBaseline.runnerSha256);
assert.equal(fileHash(previous+'/inputs.json'),priorBaseline.inputsSha256);
const originalBinding=read('data/audit-runtimes/design76-citation-capacity-runtime-bound.json');
const bindingPath='data/audit-runtimes/design76-citation-unique-runtime-bound.json',binding=read(bindingPath);
assert.deepEqual(Object.keys(binding.sourceHashes).sort(),Object.keys(originalBinding.sourceHashes).sort());
const changes=Object.keys(binding.sourceHashes).filter(p=>binding.sourceHashes[p]!==originalBinding.sourceHashes[p]).sort();
assert.deepEqual(changes,['apps/api/test/review-annotations.test.ts','novel-service-core/src/design-review-annotations.ts','packages/contracts/src/design-review.ts','packages/persistence/test/review-annotations.test.ts','packages/planner/src/index.ts','packages/planner/test/design-review.test.ts']);
for(const current of [originalBinding,binding]){
  for(const[p,h]of Object.entries(current.sourceHashes))assert.equal(fileHash(`${current.runtimePath}/${p}`),h);
  for(const[p,h]of Object.entries(current.dependencyHashes))assert.equal(fileHash(p),h);
}
// Preserve exact prompt additions, durable dispatch logic and stage scheduling.
const oldRunner=fs.readFileSync('scripts/run-design76-capacity-review.mjs','utf8'),newRunner=fs.readFileSync('scripts/run-design76-advice-review.mjs','utf8');
const between=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a);return text.slice(a,b);};
const preservedSections=[['const suffix =','const guidanceHash'],['    const ledger=new UsageLedger','    const state='],['      while(!stop)','    } catch(error)']];
for(const[start,end]of preservedSections)assert.equal(between(newRunner,start,end),between(oldRunner,start,end));
const tests=fs.readFileSync('/tmp/novel-citation-unique-all-tests.log','utf8');assert.match(tests,/All TypeScript package and Node spike tests passed/);assert.ok(!/ℹ fail [1-9]/.test(tests));
const shadowPath='docs/audits/2026-10-18-design76-citation-unique-repair.json',shadow=read(shadowPath);assert.equal(shadow.verified,true);assert.equal(shadow.checkpointSha256,verification.checkpointSha256);assert.equal(shadow.bindingSha256,fileHash(bindingPath));assert.equal(shadow.productionWrites,0);assert.equal(shadow.originalModelCalls,1);
fs.mkdirSync(control);fs.mkdirSync(control+'/model-calls');
const copy=(from,to)=>fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);
copy(predecessorCheckpointPath,control+'/predecessor.json');copy(predecessorCheckpointPath,control+'/result.json');
copy(previous+'/inputs.json',control+'/inputs.json');
const prefixJournal={};
for(const name of fs.readdirSync(previous+'/model-calls').filter(n=>n.endsWith('.json')).sort()){
  copy(previous+'/model-calls/'+name,control+'/model-calls/'+name);prefixJournal[name]=fileHash(control+'/model-calls/'+name);
}
assert.equal(Object.keys(prefixJournal).filter(n=>n.endsWith('.started.json')).length,state.totalCalls);
const database=path.resolve(control,'baseline.db');
execFileSync('python3',['-c',"import sqlite3,sys; a=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()",path.resolve('data/novel-studio.db'),database]);
const {PrismaWorkRepository}=await import(binding.runtimePath+'/packages/persistence/src/prisma-repository.ts');
const client=new PrismaClient({datasources:{db:{url:'file:'+database}}}),repo=new PrismaWorkRepository(client);
let annotations;
try{
  const work=await repo.get(priorBaseline.workId);assert.ok(work);
  const protectedHash=hash({world:work.worldPack,bible:work.storyBible,plans:[...work.plans],activePlanId:work.activePlanId,designHistory:[...work.designHistory],versions:[...work.versions],events:[...work.events],manuscripts:[...work.manuscripts],candidates:[...work.candidates]});
  assert.equal(protectedHash,priorBaseline.protectedHash);
  for(const[id,h]of priorBaseline.oldRuns)assert.equal(hash(work.designReviewRuns.get(id)),h);
  for(const[id,h]of priorBaseline.oldReports)assert.equal(hash(work.designContentReviews.get(id)),h);
  for(const run of state.runs)assert.deepEqual(work.designReviewRuns.get(run.id),run);
  assert.equal(work.designReviewRuns.size,priorBaseline.oldRuns.length+state.runs.length);
  assert.equal(work.designContentReviews.size,priorBaseline.oldReports.length+state.reports.length);
  const applied=read('docs/audits/2026-10-18-design76-review-annotation-applied.json');assert.deepEqual(work.designReviewAnnotations.get(applied.note.id),applied.note);
  const notesProof=read('docs/audits/2026-10-18-design76-segment11-notes-applied.json');
  assert.equal(notesProof.verified,true);assert.equal(notesProof.baseCheckpointSha256,verification.checkpointSha256);
  for(const note of notesProof.notes)assert.deepEqual(work.designReviewAnnotations.get(note.id),note);
  for(const[id,h]of priorBaseline.annotations)assert.equal(hash(work.designReviewAnnotations.get(id)),h);
  const digests=Object.fromEntries(Object.keys(work).filter(k=>k!=='designReviewAnnotations').sort().map(k=>{const v=work[k];return[k,hash(v instanceof Map?[...v].map(([id,value])=>[id,hash(value)]):v)];}));
  assert.deepEqual(digests,notesProof.preservedWorkFieldDigests);
  annotations=[...work.designReviewAnnotations].map(([id,note])=>[id,hash(note)]);assert.equal(annotations.length,9);
}finally{await repo.disconnect();}
const plannerEpochs=[...priorBaseline.plannerEpochs,{afterCall:state.totalCalls,bindingPath,bindingSha256:fileHash(bindingPath)}];
const baseline={...priorBaseline,plannerEpochs,createdAt:new Date().toISOString(),runtimePath:binding.runtimePath,runtimeBindingSha256:fileHash(bindingPath),
  predecessorCallCount:state.totalCalls,predecessorRuntimeBindingPath:'data/audit-runtimes/design76-citation-capacity-runtime-bound.json',predecessorRuntimeBindingSha256:fileHash('data/audit-runtimes/design76-citation-capacity-runtime-bound.json'),shadowProofSha256:fileHash(shadowPath),
  runnerSha256:fileHash('scripts/run-design76-advice-review.mjs'),hostHelperSha256:fileHash('scripts/shared-review-host.mjs'),
  predecessorRunnerSha256:priorBaseline.runnerSha256,predecessorCheckpointPath,predecessorCheckpointSha256:fileHash(predecessorCheckpointPath),
  predecessorVerificationPath,predecessorVerificationSha256:fileHash(predecessorVerificationPath),
  originalRuntimeBindingSha256:fileHash('data/audit-runtimes/design76-citation-capacity-runtime-bound.json'),prefixJournal,annotations};
fs.writeFileSync(control+'/baseline.json',JSON.stringify(baseline,null,2)+'\n',{flag:'wx'});
const proof={kind:'design76_advice_review_preflight',verified:true,createdAt:baseline.createdAt,control,databaseSnapshotPath:database,
  predecessorCheckpointSha256:baseline.predecessorCheckpointSha256,predecessorVerificationSha256:baseline.predecessorVerificationSha256,
  baselineSha256:fileHash(control+'/baseline.json'),runnerSha256:baseline.runnerSha256,hostHelperSha256:baseline.hostHelperSha256,
  runtimeBindingSha256:baseline.runtimeBindingSha256,changedRuntimeFiles:changes,unchangedSchedulingAndPromptSuffix:true,changedRepairPrompt:true,plannerEpochs,shadowProofSha256:fileHash(shadowPath),
  prefixCalls:state.totalCalls,runIds:state.runs.map(r=>r.id),annotationsPreserved:annotations.length,modelCalls:0,productionWrites:0,formalAcceptance:false,
  limitation:'Fresh frozen runtime supports advice annotations and clarifies one repair per criterion. The new baseline includes nine independent annotations. The detached repair and full tests passed; production continuation and complete content acceptance remain unproven.'};
fs.writeFileSync('docs/audits/2026-10-18-design76-advice-review-preflight.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({prepared:true,resumeSha256:baseline.predecessorCheckpointSha256,prefixCalls:state.totalCalls,modelCalls:0,productionWrites:0}));
