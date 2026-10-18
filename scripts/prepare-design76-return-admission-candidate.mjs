// Address the verified return-visit omission in an offline successor only.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateDesignCandidate} from '../packages/application/src/design-candidate.ts';
const read=p=>JSON.parse(fs.readFileSync(p)),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const priorProofPath='docs/audits/2026-10-18-design76-followup-knowledge-v5.json',prior=read(priorProofPath),base=read(prior.candidatePath);
assert.equal(hash(base),prior.candidateSha256);
const verificationPath='docs/audits/2026-10-18-design76-notes26-review-segment-27.json',verification=read(verificationPath),state=read(verification.checkpointPath);
assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);assert.equal(verification.workerAbsent,true);assert.equal(state.segment,27);
try{process.kill(state.pid,0);assert.fail('Worker remains live');}catch(e){assert.equal(e.code,'ESRCH');}
const run=state.runs.find(r=>r.input.area==='world'),stage=run.stages.find(s=>s.id==='followup-cross-3-7/geography');
const check=stage.result.checks.find(c=>c.criterion==='geography');assert.equal(check.verdict,'revise');assert.ok(!check.resolves?.length);
const requestPath='data/audit-runtimes/design76-notes26-review/model-calls/00183.started.json',responsePath='data/audit-runtimes/design76-notes26-review/model-calls/00184.response.json';
const request=JSON.parse(read(requestPath).request.user);assert.ok(stage.modelResponses.includes(read(responsePath).response.text));
const evidence=[
 ['world/locations/loc_29','访客、矿工须有对应药役、管事或执事登记陪同'],
 ['world/locations/loc_29','公开目录、陪同调档、封袋和内册是不同权限'],
 ['plan/milestones/ms_v3_return','第311–314日才沿大乾普通驿路返外山'],
 ['plan/milestones/ms_v3_return','315日两人当面交换材料'],
 ['plan/milestones/ms_v3_return','结余220由贺另袋封存，待实际返赤霄交回商盟'],
].map(([sourceId,quote])=>{
 const source=run.input.sources.find(s=>s.id===sourceId);assert.ok(source.text.includes(quote));
 const fragments=request.sources.filter(s=>s.origin?.sourceId===sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(quote)).map(f=>f.id));assert.ok(fragments.length);
 return {sourceId,quote,sourceSha256:hash(source),fragments};
});
const physician=base.storyBible.characters.find(c=>c.id==='char_09');assert.equal(physician.name,'白榆');assert.equal(physician.locationId,'loc_29');assert.ok(physician.goal.includes('药役职位'));
const candidate=structuredClone(base),milestone=candidate.plan.milestones.find(m=>m.id==='ms_v3_return');
const setupIndex=milestone.setup.length;
const addition='返乡交证的外门准入安排（新增待审提案，并入315日既有会面，不新增手续章节）：林辰与贺青梧先在太清外门院loc_29入口候验。白榆以本院药役身份当面核对贺的来访凭证及交证事由，在外门访客簿具名登记贺的入院时点、陪同人和仅到药舍外间交证对账的范围；林另按在籍记名弟子名册核验，不用自己的身份替贺放行。登记获准后白实际陪贺到药舍外间，林苏在此完成原定材料交接，贺只见证本人参与的运输、救助与780杂费核对，余220仍由贺封存。结束后白陪贺返回同一入口、登记离院；不授予贺档房调阅、内册、内门、住宿或医疗资格，也不把这次来访当作林316日复诊。白未到场、身份不符或来访未获登记时，贺留在入口候验，不跟林擅入；交证和结算等实际陪同获准后再进行，延期则重排贺后续离程，不虚记315已完成。陪同不另产生灵石收入、不动封存220，也不替代随后合法货船工作的行程及支付。';
milestone.setup.push(addition);
const restored=structuredClone(candidate);restored.plan.milestones.find(m=>m.id==='ms_v3_return').setup.splice(setupIndex,1);assert.deepEqual(restored,base,'Only one return-scene setup entry may be added');
const validation=validateDesignCandidate(candidate);assert.equal(validation.valid,true);assert.equal(validation.blockers.length,41);assert.deepEqual(validation.blockers,validateDesignCandidate(base).blockers);
const candidatePath='data/design-candidates/design76-followup-controls-v6.json',proofPath='docs/audits/2026-10-18-design76-followup-admission-v6.json';
const proof={kind:'design76_unapplied_return_admission_candidate',runnerSha256:sha(process.argv[1]),priorProofPath,priorProofSha256:sha(priorProofPath),previousCandidatePath:prior.candidatePath,previousCandidateSha256:hash(base),verificationPath,verificationSha256:sha(verificationPath),checkpointSha256:verification.checkpointSha256,requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),acceptedStageSha256:hash(stage),originalCheck:check,expectedInputHash:run.input.inputHash,candidatePath,candidateSha256:hash(candidate),evidence,existingPhysician:{id:physician.id,sourceSha256:hash(physician),identity:physician.identity,goal:physician.goal},changes:[{sourceId:'plan/milestones/ms_v3_return',field:'setup',operation:'append',index:setupIndex,before:null,after:addition}],validation,modelCalls:0,productionWrites:0,blockersClosed:0,formalAcceptance:false,limitation:'Offline author proposal only, not a recovered fact. Existing sources establish visitor rules and Bai Yu as a local physician with a medicine-worker post; the proposed day-315 escort, visitor registration and meeting location are new author arrangements requiring semantic review. All v5 edits remain intact. Structural validation does not close the model finding or authorize production.'};
if(process.argv.includes('--check')){assert.deepEqual(read(candidatePath),candidate);assert.deepEqual(read(proofPath),proof);}
else{assert.ok(!fs.existsSync(candidatePath)&&!fs.existsSync(proofPath));fs.writeFileSync(candidatePath,JSON.stringify(candidate,null,2)+'\n',{flag:'wx'});fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({candidatePath,addedSetupEntries:1,valid:true,blockers:41,productionWrites:0}));
