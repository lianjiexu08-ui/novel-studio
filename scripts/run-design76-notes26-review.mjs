// Continue the same Plan76 review with UI reads sharing its queued repository.
// Original runtime, completed segments and dispatched call records remain immutable.
import fs from 'node:fs';
import {startSharedReviewHost} from './shared-review-host.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { sourceNavigationGuidance } from './design-review-source-navigation.mjs';
import { createHash } from 'node:crypto';
const root = process.cwd();
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control = path.join(root, 'data/audit-runtimes/design76-notes26-review');
const binding = read(path.join(root, 'data/audit-runtimes/design76-fragment-index-runtime-bound.json'));
const applied = read(path.join(root, 'docs/audits/2026-10-18-design76-repairs-applied.json'));
const execute=process.argv.includes('--execute');
assert.ok(execute,'Use the separately verified shared-review preparation, then --execute');
assert.equal(process.env.DATABASE_URL, 'file:' + path.join(root, 'data/novel-studio.db'));
for (const [name, expected] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(path.join(binding.runtimePath, name)), expected, name);
const { maxDesignReviewAwaitingSources } = await import(binding.runtimePath + '/packages/contracts/src/index.ts');
assert.equal(maxDesignReviewAwaitingSources,96,'Use the tested expanded source-list contract');
const { PrismaWorkRepository } = await import(binding.runtimePath + '/packages/persistence/src/prisma-repository.ts');
const { ChapterWorkflow } = await import(binding.runtimePath + '/packages/application/src/index.ts');
const { designReviewHash } = await import(binding.runtimePath + '/novel-service-core/src/design-review.ts');
const workId = 'work_8b6c9133e13d404083ca33acc63f4f61', planId = applied.appliedPlanId;
const areas = ['world', 'power', 'characters', 'story'];
const protectedHash = w => hash({ world: w.worldPack, bible: w.storyBible, plans: [...w.plans], activePlanId: w.activePlanId,
  designHistory: [...w.designHistory], versions: [...w.versions], events: [...w.events], manuscripts: [...w.manuscripts], candidates: [...w.candidates] });
const repo = new PrismaWorkRepository();
const suffix = '\n响应requestId必须逐字使用当前请求中的值，不复用旧编号；证据只引本次sources。请精确区分不同人物、账户、日期、局部综合与全局验收。只依据本步骤实际材料作判断；材料不足应说明缺失来源，不能为了通过而省略冲突。解释与引文保持必要长度，不复制整章，不隐去仍未解决的问题。涉及同姓、近名或亲属角色时，逐章按已读人物原文、关系端点和出场编号核对，解释使用完整姓名及编号，不把不同章节的同一简称串成同一人的经历；无法确定时明说无法确定。保留原文的时间、数量与费用单位，尤其不可把时辰直接写成小时；必须换算时写出依据与公式。提交前逐句检查解释中的主语、章号、日期、单位是否与所引原文一致。';
const guidanceHash = hash(sourceNavigationGuidance);
const stepLimitArg = process.argv.find(a => a.startsWith('--stage-limit='));
const stepLimit = stepLimitArg ? Number(stepLimitArg.slice('--stage-limit='.length)) : Infinity;
assert.ok(stepLimit === Infinity || Number.isSafeInteger(stepLimit) && stepLimit > 0);
const baselinePath = path.join(control, 'baseline.json');
const outputPath = path.join(control, 'result.json');
let host;
let liveStatus={status:'starting',workId,planId};
try {
  const baseline=read(baselinePath);
  assert.equal(fileHash(process.argv[1]),baseline.runnerSha256);
  assert.equal(fileHash('scripts/shared-review-host.mjs'),baseline.hostHelperSha256);
  const prior=read(outputPath);
  assert.ok(['stopped_after_stage_limit','stopped_after_failure','stopped_after_budget','stopped_by_signal'].includes(prior.status));
  try{process.kill(prior.pid,0);assert.fail('Prior worker remains live');}catch(e){assert.equal(e.code,'ESRCH');}
  assert.equal(process.env.API_CORS_ORIGIN,'http://127.0.0.1:5180');
  const {createApiServer}=await import(binding.runtimePath+'/apps/api/src/server.ts');
  host=await startSharedReviewHost({createApiServer,repository:repo,modelSettingsPath:path.join(root,'data/model-settings.json'),port:8787,status:()=>liveStatus,
    onResponse:event=>fs.appendFileSync(path.join(control,'http.jsonl'),JSON.stringify({at:new Date().toISOString(),...event})+'\n')});
  console.log(JSON.stringify({apiReady:true,pid:process.pid,port:8787,readOnly:true}));
  const work = await repo.get(workId);
  assert.ok(work);
  const currentInputHash = designReviewHash(work, planId);
  assert.ok(currentInputHash);
  assert.equal(work.worldPack.revision, 40);
  assert.equal(work.storyBible.revision, 72);
  assert.equal(work.plans.get(planId).revision, 76);
  assert.equal(work.plans.get(planId).plan.chapters.length, 50);
  assert.equal(work.plans.get(work.activePlanId).revision, 10);
  {
    const baseline = read(baselinePath);
    assert.equal(fileHash(baseline.predecessorVerificationPath),baseline.predecessorVerificationSha256);
    assert.equal(fileHash(baseline.predecessorCheckpointPath),baseline.predecessorCheckpointSha256);
    assert.equal(fileHash('scripts/run-design76-notes25-review.mjs'),baseline.predecessorRunnerSha256);
    assert.equal(fileHash('scripts/shared-review-host.mjs'),baseline.hostHelperSha256);
    assert.equal(fileHash(process.argv[1]), baseline.runnerSha256, 'Runner changed; do not mix review semantics');
    assert.equal(hash(suffix), baseline.suffixSha256);
    assert.equal(guidanceHash, baseline.guidanceHash);
    for (const [name, expected] of Object.entries(binding.dependencyHashes)) assert.equal(fileHash(name), expected, name);
    assert.equal(fileHash(path.join(root,'data/audit-runtimes/design76-fragment-index-runtime-bound.json')), baseline.runtimeBindingSha256);
    const verify = w => {
      assert.equal(protectedHash(w), baseline.protectedHash, 'Design, prose or plan history changed');
      for (const [id,h] of baseline.oldRuns) assert.equal(hash(w.designReviewRuns.get(id)),h,'Old review run changed');
      for (const [id,h] of baseline.oldReports) assert.equal(hash(w.designContentReviews.get(id)),h,'Old report changed');
      assert.deepEqual([...w.designReviewAnnotations].map(([id,note])=>[id,hash(note)]),baseline.annotations,'Independent clarifications changed');
    };
    verify(work);
    const resumeHash = process.argv.find(a=>a.startsWith('--resume-sha256='))?.slice('--resume-sha256='.length);
    let prior, segment = 0;
    if (resumeHash) {
      assert.equal(fileHash(outputPath),resumeHash,'Checkpoint changed; inspect the current worker');
      prior = read(outputPath);
      let alive=false; try { process.kill(prior.pid,0);alive=true; } catch(e) { if(e.code!=='ESRCH') throw e; }
      assert.equal(alive,false,'Prior worker is live; wait rather than resubmit');
      assert.ok(['stopped_after_failure','stopped_after_budget','stopped_by_signal','stopped_after_stage_limit'].includes(prior.status));
      for(const old of prior.runs) assert.equal(hash(work.designReviewRuns.get(old.id)),hash(old),'Persisted run differs from checkpoint');
      segment=prior.segment+1;
      fs.copyFileSync(outputPath,path.join(control,`segment-${prior.segment}.json`),fs.constants.COPYFILE_EXCL);
    } else assert.ok(!fs.existsSync(outputPath),'Existing checkpoint: inspect it and resume explicitly');
    assert.ok(![...work.designReviewRuns.values()].some(r=>r.leaseToken && Date.parse(r.leaseExpiresAt??'')>Date.now()),'A review lease is live');
    const { loadModelStore,activeChannel,connectionOf } = await import(binding.runtimePath+'/apps/api/src/model-settings.ts');
    const { UsageLedger,redactSecrets,ModelGateway,OpenAICompatibleAdapter } = await import(binding.runtimePath+'/packages/model-gateway/src/index.ts');
    const { JsonDesignPlanner } = await import(binding.runtimePath+'/packages/planner/src/index.ts');
    const settingsPath=path.join(root,'data/model-settings.json');
    const store=loadModelStore(settingsPath),conn=connectionOf(activeChannel(store),store.source);
    assert.equal(conn.planningModel,'gpt-5.6-luna');assert.equal(conn.writingModel,'gpt-5.6-luna');
    assert.equal(conn.timeoutMs,600000);assert.ok(store.channels.every(c=>!c.fallback));
    const journalDirectory=path.join(control,'model-calls');fs.mkdirSync(journalDirectory,{recursive:true});
    const started=fs.readdirSync(journalDirectory).filter(n=>n.endsWith('.started.json')).sort();
    const unsettled=started.filter(n=>!fs.existsSync(path.join(journalDirectory,n.replace('.started.json','.response.json'))) && !fs.existsSync(path.join(journalDirectory,n.replace('.started.json','.failure.json'))));
    assert.equal(unsettled.length,0,'A dispatched call has no durable response/failure. Inspect it before resuming; do not silently retry.');
    const previousCalls=started.length, remainingCalls=baseline.maxCalls-previousCalls;
    assert.equal(previousCalls,prior?.totalCalls??0,'Durable call journal differs from checkpoint; reconcile explicitly');
    assert.ok(remainingCalls>0,'Review call budget exhausted; inspect findings before extending');
    const ledger=new UsageLedger(Infinity,undefined,{maxCalls:remainingCalls});
    const gateway=new ModelGateway(new Map([['openai-compatible',new OpenAICompatibleAdapter(fetch,conn.timeoutMs,true)]]),ledger);
    const endpoint=conn.endpoint.replace(/\/$/,'').replace(/(?:\/v1)?$/,'/v1');
    let dispatched=0;
    const durableWrite=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',flush:true});
    const planner=new JsonDesignPlanner({complete:async req=>{
      const callNumber=previousCalls+(++dispatched),name=String(callNumber).padStart(5,'0');
      const request={role:req.role??'reviewing',model:conn.planningModel,system:req.system+suffix+sourceNavigationGuidance,user:req.user,maxOutputTokens:req.maxOutputTokens,responseFormat:'json',temperature:0.2};
      durableWrite(path.join(journalDirectory,name+'.started.json'),{callNumber,step:state.activeStep,startedAt:new Date().toISOString(),request});
      let response;
      try { response=await gateway.complete(request,'openai-compatible',{endpoint,apiKey:conn.apiKey}); }
      catch(error) {
        durableWrite(path.join(journalDirectory,name+'.failure.json'),{callNumber,finishedAt:new Date().toISOString(),error:String(redactSecrets(error.message)),usage:ledger.summary()});
        throw error;
      }
      // Save raw text and usage before parsing, validation, or any database save.
      durableWrite(path.join(journalDirectory,name+'.response.json'),{callNumber,finishedAt:new Date().toISOString(),response,usage:ledger.summary()});
      return response.text;
    }});
    const workflow=new ChapterWorkflow(repo,{generateChapter(){throw new Error('Design review cannot write prose');}},planner);
    const state={status:'running',pid:process.pid,segment,startedAt:new Date().toISOString(),scope:{workId,planId,world:40,bible:72,plan:76},
      inputHash:currentInputHash,runtimeRoot:binding.runtimePath,runnerSha256:baseline.runnerSha256,scheduleVersion:34,rubricVersion:17,
      model:conn.planningModel,fallback:false,concurrency:1,maxCalls:baseline.maxCalls,previousCalls,totalCalls:previousCalls,
      settingsSha256:fileHash(settingsPath),priorCheckpointSha256:resumeHash,areas:prior?.areas??[],errors:[],stepsStarted:[],usage:{calls:0},runs:[],reports:[]};
    assert.ok(prior,'This runner only resumes the verified predecessor');
    state.hostHelperSha256=baseline.hostHelperSha256;
    state.predecessorRunnerSha256=baseline.predecessorRunnerSha256;
    state.sharedApiPort=8787;
    let stop=false, completedThisSegment=0;
    const requestStop=()=>{stop=true;};process.once('SIGTERM',requestStop);process.once('SIGINT',requestStop);
    async function checkpoint() {
      const w=await repo.get(workId);verify(w);
      state.runs=state.areas.map(a=>w.designReviewRuns.get(a.runId));
      state.reports=state.runs.filter(r=>r.reportId).map(r=>w.designContentReviews.get(r.reportId));
      state.usage=ledger.summary();state.totalCalls=previousCalls+dispatched;state.completedThisSegment=completedThisSegment;
      state.protectedHistoryUnchanged=true;state.updatedAt=new Date().toISOString();
      liveStatus={status:state.status,workId,planId,segment:state.segment,activeStep:state.activeStep,completedThisSegment,totalCalls:state.totalCalls,progress:state.runs.map(r=>({area:r.input.area,completed:r.stages.filter(s=>s.result).length,total:r.stages.length}))};
      fs.writeFileSync(outputPath+'.pending',JSON.stringify(state,null,2)+'\n');fs.renameSync(outputPath+'.pending',outputPath);
    }
    try {
      // Visit each area once per round so early defects in characters and plot
      // surface before spending every call on a complete world synthesis tree.
      // Stage order within each run and all acceptance requirements stay intact.
      for(const area of areas) {
        const existing=state.areas.find(a=>a.area===area);
        assert.ok(existing,'Continue the four original review runs; never create replacement runs');
      }
      while(!stop) {
        let pending=false;
        for(const area of areas) {
          if(stop) break;
          const existing=state.areas.find(a=>a.area===area);
          let run=(await repo.get(workId)).designReviewRuns.get(existing.runId);
          assert.equal(run.input.inputHash,baseline.inputHash);assert.equal(run.scheduleVersion,34);
          if(run.status==='completed') continue;
          pending=true;
          if(ledger.summary().calls>=remainingCalls) {state.status='stopped_after_budget';stop=true;break;}
          const stage=run.stages.find(s=>!s.result);assert.ok(stage);
          state.activeStep={area,runId:run.id,stageId:stage.id,startedAt:new Date().toISOString()};
          state.stepsStarted.push(state.activeStep);await checkpoint();console.log(JSON.stringify({starting:state.activeStep}));
          run=await workflow.stepDesignReview(workId,run.id);completedThisSegment++;await checkpoint();
          console.log(JSON.stringify({area,finished:stage.id,completed:run.stages.filter(s=>s.result).length,total:run.stages.length,calls:state.totalCalls}));
          if(completedThisSegment>=stepLimit){state.status='stopped_after_stage_limit';stop=true;break;}
        }
        if(!pending) break;
      }
      if(state.status==='running') state.status=stop?'stopped_by_signal':'completed';
    } catch(error) {
      state.status='stopped_after_failure';state.errors.push({step:state.activeStep,error:String(redactSecrets(error.message))});
      process.exitCode=1;
    } finally {
      state.finishedAt=new Date().toISOString();await checkpoint();
      process.removeListener('SIGTERM',requestStop);process.removeListener('SIGINT',requestStop);
      console.log(JSON.stringify({status:state.status,usage:state.usage,totalCalls:state.totalCalls,errors:state.errors}));
    }
  }
} finally { await host?.close(); await repo.disconnect(); }
