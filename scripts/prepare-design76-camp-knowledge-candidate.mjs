// Correct two stale knowledge-stage fields in an offline successor; never mutate the active review.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateDesignCandidate} from '../packages/application/src/design-candidate.ts';
const read=p=>JSON.parse(fs.readFileSync(p)),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const priorProofPath='docs/audits/2026-10-18-design76-followup-knowledge-v4.json',prior=read(priorProofPath),base=read(prior.candidatePath);
assert.equal(hash(base),prior.candidateSha256);
const findingPath='docs/audits/2026-10-18-design76-character-outpost-main-camp.json',finding=read(findingPath);
assert.equal(sha(finding.requestPath),finding.requestSha256);assert.equal(sha(finding.responsePath),finding.responseSha256);
const inputsPath='data/audit-runtimes/design76-notes25-review/inputs.json',inputs=read(inputsPath),sources=inputs.characters.sources;
assert.equal(inputs.characters.inputHash,prior.expectedInputHash);
const original=JSON.parse(sources.find(s=>s.id==='story/secrets/sec_02').text);
const evidence=[
 ['story/chapterPlans/chapter-plan-20','两人确认附近存在拦截采集者的前哨'],
 ['story/chapterPlans/chapter-plan-21','林辰与苏凌霜循残缺采集单找到前哨废料高台'],
 ['story/chapterPlans/chapter-plan-21','秦禾当面说明主营方向与已走路线，只答应有限带路、送信，不承诺陪战。'],
 ['story/chapterPlans/chapter-plan-21','秦已说明主营大致方向，尚未实核布局或辨清指挥者。'],
 ['story/chapterPlans/chapter-plan-22','秦禾按亲历路线带林辰、苏凌霜抵主营外围'],
 ['story/chapterPlans/chapter-plan-22','三人确认普通货台、囚笼与封存样箱确在此处，却没看清指挥者面貌。'],
].map(([sourceId,quote])=>{const source=sources.find(s=>s.id===sourceId);assert.ok(source.text.includes(quote));return{sourceId,quote,sourceSha256:hash(source)};});
const candidate=structuredClone(base),secret=candidate.storyBible.secrets.find(s=>s.id==='sec_02');
const before='秦禾亲历被扣，知道前哨方向；证词尚不能证明完整幕后指挥。';
const after='已循残缺采集单抵达前哨并救出秦禾；据秦当面说明得知主营大致方向与其已走路线，尚未实核主营布局、辨清指挥者或知道随后新设的封路岗；这份口述不能证明完整幕后指挥。';
const changes=['char_01','char_02'].map(characterId=>{
 const match=s=>s.characterId===characterId&&s.sinceChapter===21&&s.untilChapter===21;
 const stages=secret.knowledgeStages.filter(match);assert.equal(stages.length,1);
 assert.equal(stages[0].belief,before);assert.equal(original.knowledgeStages.find(match).belief,before);
 const stageBefore=structuredClone(stages[0]);stages[0].belief=after;
 return{sourceId:'story/secrets/sec_02',characterId,sinceChapter:21,untilChapter:21,field:'belief',before,after,stageBefore,stageAfter:structuredClone(stages[0])};
});
const restored=structuredClone(candidate);
for(const change of changes)restored.storyBible.secrets.find(s=>s.id==='sec_02').knowledgeStages.find(s=>s.characterId===change.characterId&&s.sinceChapter===21&&s.untilChapter===21).belief=before;
assert.deepEqual(restored,base,'Only the two specified belief fields may differ');
const validation=validateDesignCandidate(candidate);assert.equal(validation.valid,true);assert.equal(validation.blockers.length,41);assert.deepEqual(validation.blockers,validateDesignCandidate(base).blockers);
const candidatePath='data/design-candidates/design76-followup-controls-v5.json',proofPath='docs/audits/2026-10-18-design76-followup-knowledge-v5.json';
const proof={kind:'design76_unapplied_camp_knowledge_candidate',runnerSha256:sha(process.argv[1]),priorProofPath,priorProofSha256:sha(priorProofPath),previousCandidatePath:prior.candidatePath,previousCandidateSha256:hash(base),findingPath,findingSha256:sha(findingPath),inputsPath,inputsSha256:sha(inputsPath),expectedInputHash:inputs.characters.inputHash,candidatePath,candidateSha256:hash(candidate),evidence,changes,validation,modelCalls:0,productionWrites:0,blockersClosed:0,formalAcceptance:false,limitation:'Offline candidate only. All v4 changes remain intact, including artifact controls, message-dispatch, arrival/report and Yan identity corrections. This changes only two chapter-21 belief fields; certainty, triggers, later verification and all other design fields remain unchanged. Structural validation does not constitute model semantic review or approval; do not apply during the frozen review.'};
if(process.argv.includes('--check')){assert.deepEqual(read(candidatePath),candidate);assert.deepEqual(read(proofPath),proof);}
else{assert.ok(!fs.existsSync(candidatePath)&&!fs.existsSync(proofPath));fs.writeFileSync(candidatePath,JSON.stringify(candidate,null,2)+'\n',{flag:'wx'});fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({candidatePath,newFieldsChanged:2,valid:true,blockers:41,productionWrites:0}));
