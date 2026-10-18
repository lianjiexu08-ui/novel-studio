// Restore the unavailable local API from a separately tested backend with queued reads.
// Preserve the original formal review runtime. Does not edit frozen files, migrate SQLite or start models.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p));
const fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const root=process.cwd();
const prepare=process.argv.includes('--prepare'),execute=process.argv.includes('--execute');
assert.notEqual(prepare,execute,'Choose --prepare or --execute');
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(fileHash(`${binding.runtimePath}/${p}`),h);
for(const[p,h]of Object.entries(binding.dependencyHashes))assert.equal(fileHash(p),h);
const uiRoot=path.resolve('data/audit-ui/design76-review/dist-v5');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]).sort();}
const uiFiles=Object.fromEntries(files(uiRoot).map(p=>[path.relative(uiRoot,p),fileHash(p)]));
assert.ok(uiFiles['index.html']);
const {loadModelStore,activeChannel,connectionOf}=await import(`${binding.runtimePath}/apps/api/src/model-settings.ts`);
const settingsPath=path.join(root,'data/model-settings.json'),settingsHash=fileHash(settingsPath);
const store=loadModelStore(settingsPath),connection=connectionOf(activeChannel(store),store.source);
assert.equal(connection.planningModel,'gpt-5.6-luna');assert.equal(connection.writingModel,'gpt-5.6-luna');
assert.ok(store.channels.every(c=>!c.fallback));
// Bind startup to the latest independently verified clarified-review terminal.
// Preparation alone never authorizes startup while that worker is active.
const proofPath='docs/audits/2026-10-18-design76-clarified-api-preflight.json';
const proof={kind:'design76_ui_api_restore_preflight',runtimeBindingSha256:fileHash(bindingPath),sourceCommit:binding.sourceCommit,
  runnerSha256:fileHash(process.argv[1]),uiRoot,uiFiles,backendPort:8787,frontendPort:5180,corsOrigin:'http://127.0.0.1:5180',
  model:'gpt-5.6-luna',fallback:false,batchWritingEnabled:false,modelCalls:0,productionWrites:0,formalAcceptance:false,
  limitation:'Prepared artifact bindings only. Service startup and real HTTP/browser verification remain required.'};
if(prepare){
  fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({prepared:true,sourceCommit:binding.sourceCommit,uiFiles:Object.keys(uiFiles).length,modelCalls:0,productionWrites:0}));
}else{
  assert.deepEqual(read(proofPath),proof);
  assert.equal(process.env.DATABASE_URL,'file:'+path.join(root,'data/novel-studio.db'));
  assert.equal(process.env.API_CORS_ORIGIN,proof.corsOrigin);
  assert.equal(process.env.NOVEL_ENABLE_BATCH_RUNS,'false');
  const checkpointPath='data/audit-runtimes/design76-clarified-review/result.json',checkpoint=read(checkpointPath);
  assert.ok(['stopped_after_stage_limit','stopped_after_failure','stopped_after_budget','stopped_by_signal','completed'].includes(checkpoint.status));
  try{process.kill(checkpoint.pid,0);assert.fail('Formal worker is live');}catch(e){assert.equal(e.code,'ESRCH');}
  const verification=read(`docs/audits/2026-10-18-design76-clarified-review-segment-${checkpoint.segment}.json`);
  assert.equal(fileHash(checkpointPath),verification.checkpointSha256);assert.equal(verification.workerAbsent,true);
  assert.equal(verification.annotationsPreserved,12);assert.equal(verification.unsettledCalls,0);
  assert.equal(verification.sourceCommit,binding.sourceCommit);
  const {createApiServer}=await import(`${binding.runtimePath}/apps/api/src/server.ts`);
  const {app,repository}=createApiServer({manageModelSettings:true,modelSettingsPath:settingsPath,writeProcessEnvironment:false,allowBatchRuns:false});
  assert.equal(fileHash(settingsPath),settingsHash);
  await app.listen({port:8787,host:'127.0.0.1'});
  const state={pid:process.pid,startedAt:new Date().toISOString(),runtimeRoot:binding.runtimePath,sourceCommit:binding.sourceCommit,
    preflightSha256:fileHash(proofPath),settingsUnchangedAtStartup:true,backendPort:8787,corsOrigin:proof.corsOrigin,batchWritingEnabled:false};
  fs.writeFileSync(`data/audit-runtimes/design76-api-start-${process.pid}.json`,JSON.stringify(state,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(state));
  process.once('SIGTERM',async()=>{await app.close();await repository.disconnect?.();process.exit(0);});
}
