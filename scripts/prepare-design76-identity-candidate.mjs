// Correct one independently confirmed misspelling; no plot or resource changes.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {validateDesignCandidate} from '../packages/application/src/design-candidate.ts';
const read=p=>JSON.parse(fs.readFileSync(p)),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const applied=read('docs/audits/2026-10-18-design75-repairs-applied.json'),review=read('data/audit-runtimes/design75-review/baseline.json');
const findingPath='docs/audits/2026-10-18-design75-identity-finding.json',finding=read(findingPath);
const prior=read(applied.candidatePath);assert.equal(hash(prior),applied.candidateSha256);assert.equal(review.planId,applied.appliedPlanId);
const base=structuredClone(prior);Object.assign(base.worldPack,{revision:40,status:'proposed'});Object.assign(base.storyBible,{revision:72,status:'proposed',worldPackRevision:40});
const candidate=structuredClone(base),training=candidate.plan.milestones.find(m=>m.id==='ms_v3_training');
const {from,to}=finding.proposedReplacement;
assert.equal(candidate.storyBible.characters.find(c=>c.id==='char_15').name,'贺青梧');
assert.equal(candidate.storyBible.characters.find(c=>c.id==='char_25').name,'卢小满');
assert.equal(JSON.stringify(base).split('贺小满').length,2);
const index=training.setup.findIndex(s=>s.includes(from));assert.ok(index>=0);
training.setup[index]=training.setup[index].replace(from,to);
assert.equal(JSON.stringify(candidate),JSON.stringify(base).replace(from,to));
const validation=validateDesignCandidate(candidate);assert.equal(validation.valid,true);assert.equal(validation.blockers.length,41);
assert.deepEqual(validation.blockers,validateDesignCandidate(base).blockers);
const baselinePath='data/design-candidates/design76-baseline.json',candidatePath='data/design-candidates/design76-identity-v1.json';
fs.writeFileSync(baselinePath,JSON.stringify({basePlanId:applied.appliedPlanId,expectedInputHash:review.inputHash,candidate:base},null,2)+'\n',{flag:'wx'});
fs.writeFileSync(candidatePath,JSON.stringify(candidate,null,2)+'\n',{flag:'wx'});
const proof={kind:'design76_unapplied_identity_correction',createdAt:new Date().toISOString(),workId:applied.workId,basePlanId:applied.appliedPlanId,expectedInputHash:review.inputHash,baselinePath,baseCandidateSha256:hash(base),candidatePath,candidateSha256:hash(candidate),findingPath,
 correction:{sourceId:'plan/milestones/ms_v3_training',field:`setup[${index}]`,from,to,characterId:'char_15'},validation,exactSingleReplacement:true,modelCalls:0,productionWrites:0,formalAcceptance:false,blockersClosed:0};
fs.writeFileSync('docs/audits/2026-10-18-design76-identity-v1-candidate.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({candidatePath,valid:true,blockers:41,exactSingleReplacement:true}));
