// Follow up the first cross-batch finding without replacing any reviewed input.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateDesignCandidate} from '../packages/application/src/design-candidate.ts';
const read=p=>JSON.parse(fs.readFileSync(p));
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const previousProof=read('docs/audits/2026-10-18-design76-followup-controls-v1.json');
const base=read(previousProof.candidatePath);assert.equal(hash(base),previousProof.candidateSha256);
const candidate=structuredClone(base),artifact=candidate.worldPack.artifacts.find(a=>a.id==='art_04');assert.ok(artifact);
const before=structuredClone(artifact.limitations);
assert.equal(before.filter(s=>s.includes('神海境以上')).length,2);
artifact.limitations=before.map(s=>s.startsWith('大风狂飙')
  ? '大风狂飙、暴烈风系法术、持续火焰或大范围水压可吹散、焚散或冲散烟雾。烟罩遮蔽肉眼，不因此自动屏蔽其他探知；神海及以上也不得仅凭境界或神念能力方向宣称穿透。若拟用神念探穿，须先有已定义且本人已掌握的具体探知术式，按其实际对象、范围、费用、持续与打断条件判定能否识别烟内目标；没有相应规则与使用证据，就不能把穿透写为成功。已有合法追踪是否失效仍服从该追踪的原规则，烟罩不自动使其失效或永久维持。'
  : s.startsWith('反制：')
    ? '反制：大风、暴烈风系法术、持续火焰或水系冲击可驱散烟雾；近身夺柄、打断握持或供能使其退场。范围覆盖、预置阵法或非肉眼探知只有在对应具体手段已定义、已取得且实际发动条件与费用成立时才可用于反制；不得凭神海境界、神念或神魂字样自动取得穿透与锁定。'
    : s);
const restored=structuredClone(candidate);restored.worldPack.artifacts.find(a=>a.id==='art_04').limitations=before;assert.deepEqual(restored,base);
const validation=validateDesignCandidate(candidate);assert.equal(validation.valid,true);
assert.equal(validation.blockers.length,41);assert.deepEqual(validation.blockers,validateDesignCandidate(base).blockers);
const candidatePath='data/design-candidates/design76-followup-controls-v2.json';
const proofPath='docs/audits/2026-10-18-design76-followup-counters-v2.json';
const proof={kind:'design76_unapplied_counter_followup_draft',createdAt:new Date().toISOString(),
  previousCandidatePath:previousProof.candidatePath,previousCandidateSha256:hash(base),candidatePath,candidateSha256:hash(candidate),
  finding:{runId:'design_run_77e97b37-cbf2-40be-ab17-2de79839c297',stageId:'cross-1-2',criterion:'tiers',verdict:'revise'},
  correction:{id:artifact.id,before,after:artifact.limitations},validation,modelCalls:0,productionWrites:0,blockersClosed:0,formalAcceptance:false,
  limitation:'The v1 focused review missed automatic spirit-sight penetration. This revised draft has only structural validation and requires semantic review before application.'};
fs.writeFileSync(candidatePath,JSON.stringify(candidate,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({candidatePath,valid:true,blockers:41,productionWrites:0,semanticReview:'pending'}));
