// Verify the first saved real-model step while other areas continue. This is a
// bounded observation, not a terminal/full-history or whole-design acceptance.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {replayDesignReviewRecord} from './audit-design-reviews.mjs';
import {sourceNavigationGuidance} from './design-review-source-navigation.mjs';
const read=p=>JSON.parse(fs.readFileSync(p)),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const root='data/audit-runtimes/design76-recovery',stateText=fs.readFileSync(`${root}/result.json`,'utf8'),state=JSON.parse(stateText),baseline=read(`${root}/baseline.json`),binding=read('data/audit-runtimes/design76-recovery-runtime-bound.json');
const run=state.runs.find(r=>r.input.area==='world');assert.ok(run);assert.equal(run.stages.filter(s=>s.result).length,1);assert.ok(!run.leaseToken);
const stage=run.stages[0];assert.ok(stage.result);assert.equal(stage.id,'batch-1');
assert.equal(fileHash('scripts/run-design76-recovery.mjs'),baseline.runnerSha256);
for(const [p,h]of Object.entries(binding.sourceHashes))assert.equal(fileHash(`${binding.runtimePath}/${p}`),h);
const inputs=read(`${root}/inputs.json`);assert.equal(fileHash(`${root}/inputs.json`),baseline.inputsSha256);assert.deepEqual(run.input,inputs.world);
const journal=fs.readdirSync(`${root}/model-calls`).filter(n=>n.endsWith('.started.json')).sort().map(n=>({name:n,start:read(`${root}/model-calls/${n}`)})).filter(c=>c.start.step.runId===run.id&&c.start.step.stageId===stage.id).map(c=>({...c,response:read(`${root}/model-calls/${c.name.replace('.started.json','.response.json')}`)}));
assert.deepEqual(journal.map(c=>c.response.response.text),stage.modelResponses);
const runtime=await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`),{JsonDesignPlanner}=await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
let calls=0;
class CheckingPlanner extends JsonDesignPlanner {
 constructor(client){super({complete:async req=>{
  const saved=journal[calls++].start.request;assert.equal(saved.user,req.user);assert.equal(saved.maxOutputTokens,req.maxOutputTokens);assert.equal(saved.role,req.role??'reviewing');
  assert.ok(saved.system.startsWith(req.system));assert.ok(saved.system.endsWith(sourceNavigationGuidance));
  assert.equal(hash(saved.system.slice(req.system.length,-sourceNavigationGuidance.length)),baseline.suffixSha256);return client.complete(req);
 }});}
}
const replay=await replayDesignReviewRecord(run,inputs.world,undefined,{...runtime,JsonDesignPlanner:CheckingPlanner});assert.equal(calls,journal.length);
const observation=fs.mkdtempSync(path.resolve(root,'first-step-verified-')),databaseRunPath=path.join(observation,'database-run.json');
fs.writeFileSync(path.join(observation,'checkpoint.json'),stateText,{flag:'wx'});
execFileSync('python3',['-c',"import sqlite3,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True,timeout=45); r=c.execute(\"SELECT j.value FROM Project p,json_each(p.designReviewRuns) j WHERE p.id=? AND json_extract(j.value,'$.id')=?\",(sys.argv[2],sys.argv[3])).fetchall(); assert len(r)==1; open(sys.argv[4],'w').write(r[0][0]); c.close()",path.resolve('data/novel-studio.db'),baseline.workId,run.id,databaseRunPath]);
assert.deepEqual(read(databaseRunPath),run);
const proof={kind:'design76_recovery_first_real_step_verified',observedAt:new Date().toISOString(),runId:run.id,restartedFromRunId:run.restartedFromRunId,stageId:stage.id,
 scope:run.input.scope,checkpointPath:path.join(observation,'checkpoint.json'),checkpointSha256:fileHash(path.join(observation,'checkpoint.json')),databaseRunPath,databaseRunSha256:hash(run),
 sourceCommit:binding.sourceCommit,runnerSha256:baseline.runnerSha256,model:state.model,fallback:state.fallback,replay,responsesReplayed:calls,modelCalls:0,productionWrites:0,formalAcceptance:false,
 limitation:'Verifies only the saved first world step against the actual request, raw response and a read-only database row. Other steps and full historical protection still require terminal verification.'};
fs.writeFileSync('docs/audits/2026-10-18-design76-recovery-first-step.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,completedStages:replay.completedStages,responsesReplayed:calls,databaseReadback:true,formalAcceptance:false}));
