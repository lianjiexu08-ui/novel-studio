// Append a source-backed editorial clarification; never rewrite model judgments.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash=v=>createHash('sha256').update(JSON.stringify(v,(_,x)=>x instanceof Map?[...x]:x)).digest('hex');
const parent='data/audit-runtimes/design77-navigation-continuation';
const state=read(`${parent}/result.json`), proofPath='docs/audits/2026-10-20-design77-navigation-continuation-segment-3.json', proof=read(proofPath);
assert.equal(sha(`${parent}/result.json`),proof.checkpointSha256);assert.equal(proof.verified,true);
try{process.kill(state.pid,0);assert.fail('Worker is live');}catch(e){assert.equal(e.code,'ESRCH');}
const bindingPath='data/audit-runtimes/design77-navigation-runtime-bound.json',binding=read(bindingPath);
assert.equal(sha(bindingPath),proof.runtimeBindingSha256);
for(const [file,digest]of Object.entries(binding.sourceHashes))assert.equal(sha(`${binding.runtimePath}/${file}`),digest);
for(const [file,digest]of Object.entries(binding.dependencyHashes))assert.equal(sha(file),digest);
const directory='data/audit-runtimes/design77-payoff-clarification';
assert.ok(!fs.existsSync(directory),'Inspect earlier receipt before retrying');fs.mkdirSync(directory);
const save=(name,v)=>fs.writeFileSync(`${directory}/${name}`,JSON.stringify(v,null,2)+'\n',{flag:'wx',flush:true});
fs.copyFileSync(process.argv[1],`${directory}/runner.mjs`,fs.constants.COPYFILE_EXCL);
const snapshot=name=>{
 const out=path.resolve(directory,name);
 execFileSync('python3',['-c',"import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()",path.resolve('data/novel-studio.db'),out]);return out;
};
const {PrismaClient}=createRequire(`${binding.runtimePath}/package.json`)('@prisma/client');
const {PrismaWorkRepository}=await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const {ChapterWorkflow}=await import(`${binding.runtimePath}/packages/application/src/index.ts`);
const {designReviewCheckHash}=await import(`${binding.runtimePath}/novel-service-core/src/design-review-annotations.ts`);
const readBackup=async p=>{const client=new PrismaClient({datasources:{db:{url:`file:${p}`}}}),r=new PrismaWorkRepository(client);try{return await r.get(state.scope.workId);}finally{await r.disconnect();await client.$disconnect();}};
const before=await readBackup(snapshot('before.db'));assert.ok(before);
const fields=w=>Object.fromEntries(Object.keys(w).sort().map(k=>[k,hash(w[k])]));
const beforeFields=fields(before);assert.equal(before.designReviewAnnotations.size,44);
for(const run of state.runs)assert.deepEqual(before.designReviewRuns.get(run.id),run);
assert.ok([...before.designReviewRuns.values()].every(r=>!r.leaseToken));
const run=state.runs.find(r=>r.input.area==='story'),stage=run.stages.find(s=>s.id==='cross-1-3');
const check=stage.result.checks.find(c=>c.criterion==='payoff');assert.equal(check.verdict,'pass');
const source=run.input.sources.find(s=>s.id==='story/promises/prom_03');assert.ok(source);
const original=JSON.parse(source.text);
const payload={requestKey:'design77-cross1-3-payoff-broken-wish',runId:run.id,stageId:stage.id,criterion:'payoff',
 expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),
 claimQuote:'九鼎全貌、返还已耗寿元等承诺明确留待后续，不存在重复兑现。',
 explanation:'原评语把九鼎全貌与“返还已耗寿元”并列为留待后续的承诺，容易被读作两者都可在后续兑现。prom_03 明确后者只是角色愿望，不是世界允许的能力；第79章被否定、第99章接受不可退回，处理应为 broken。需明确区分可兑现主线承诺与最终落空的愿望；另寻有限新寿源不等于返还。此记录只澄清评审表述，不改原 pass，不批准本批之外的剧情，也不新建返寿能力。',
 evidence:[{sourceId:source.id,quote:original.promise},{sourceId:source.id,quote:original.payoffCondition}]};
save('prepared.json',{payload,beforeFields,checkpointSha256:sha(`${parent}/result.json`),verificationSha256:sha(proofPath),runnerSha256:sha(process.argv[1]),modelCalls:0});
assert.equal(process.env.DATABASE_URL,'file:'+path.resolve('data/novel-studio.db'));
const repo=new PrismaWorkRepository();let note;
try{
 const live=await repo.get(state.scope.workId);assert.deepEqual(fields(live),beforeFields);
 const workflow=new ChapterWorkflow(repo,{generateChapter(){throw Error('No model calls permitted');}});
 note=await workflow.addDesignReviewAnnotation(state.scope.workId,payload);save('applied.json',{note,at:new Date().toISOString(),modelCalls:0});
}finally{await repo.disconnect();}
const after=await readBackup(snapshot('after.db'));assert.ok(after);
const afterFields=fields(after);
for(const [key,digest]of Object.entries(beforeFields))if(!['designReviewAnnotations','constraintRevision'].includes(key))assert.equal(afterFields[key],digest,key);
for(const [id,old]of before.designReviewAnnotations)assert.deepEqual(after.designReviewAnnotations.get(id),old);
assert.deepEqual(after.designReviewAnnotations.get(note.id),note);assert.equal(after.designReviewAnnotations.size,45);
const receipt={verified:true,note,checkpointSha256:sha(`${parent}/result.json`),verificationSha256:sha(proofPath),
 beforeFields,afterFields,oldAnnotationsPreserved:44,newAnnotations:1,runsPreserved:103,reportsPreserved:92,
 modelCalls:0,verdictChanges:0,formalAcceptance:false,proseGenerated:false,
 limitation:'Editorial clarification preserves the model verdict. Future synthesis must distinguish an impossible wish from a promise that can be fulfilled.'};
save('verified.json',receipt);
fs.writeFileSync('docs/audits/2026-10-20-design77-payoff-clarification.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,noteId:note.id,annotations:45,verdictChanges:0,modelCalls:0}));
