// Prepare a narrow correction; never save a design or advance formal review.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateDesignCandidate} from '../packages/application/src/design-candidate.ts';

const root='data/audit-runtimes/design78-recovery/';
const snapshotPath=root+'segment-12-current-design-snapshot.json';
const receipt=JSON.parse(fs.readFileSync('docs/audits/2026-10-25-design78-review-segment-12.json'));
const sha=path=>createHash('sha256').update(fs.readFileSync(path)).digest('hex');
assert.equal(sha(snapshotPath),receipt.artifacts[snapshotPath]);
const snapshot=JSON.parse(fs.readFileSync(snapshotPath));
const basePlan=snapshot.plans.find(p=>p.id===receipt.planId);
assert.equal(basePlan.revision,78);
const original={worldPack:snapshot.worldPack,storyBible:snapshot.storyBible,plan:basePlan.plan};
const candidate=structuredClone(original);
const targets=[
  ['storyBible','relationships',2,'stages',8,'cause'],
  ['storyBible','relationships',9,'stages',3,'cause'],
  ['storyBible','relationships',14,'stages',0,'cause'],
  ['storyBible','relationships',15,'stages',0,'cause'],
  ['storyBible','chapterPlans',25,'purpose'],
  ['storyBible','chapterPlans',25,'endHook'],
  ['storyBible','chapterPlans',25,'requiredEvents',1],
  ['plan','milestones',1,'setup',5],
  ['plan','milestones',4,'setup',8],
  ['plan','chapters',25,'summary'],
  ['plan','chapters',25,'endState'],
  ['plan','chapters',25,'storyTime'],
  ['plan','chapters',25,'scenes',1],
];
assert.equal(candidate.plan.chapters[25].chapterNumber,26);
assert.equal(candidate.storyBible.chapterPlans[25].chapterNumber,26);
assert.ok(candidate.plan.chapters[25].storyTime.includes('酉初19:00'));
assert.ok(candidate.plan.chapters[25].scenes[1].includes('16–18时走末段'));
assert.ok(candidate.plan.chapters[25].scenes[1].includes('19时褚接杜'));
assert.ok(candidate.plan.chapters[25].endState.includes('07–19日班与19–次日07夜班各12小时'));
const patches=targets.map(path=>{
  const parent=path.slice(0,-1).reduce((obj,key)=>obj[key],candidate),key=path.at(-1),before=parent[key];
  assert.ok(typeof before==='string'&&before.includes('酉初'));
  parent[key]=before.replaceAll('酉初','戌初');
  return {path,before,after:parent[key],replacements:before.split('酉初').length-1};
});
assert.equal(patches.reduce((n,p)=>n+p.replacements,0),19);
const restored=structuredClone(candidate);
for(const patch of patches)patch.path.slice(0,-1).reduce((obj,key)=>obj[key],restored)[patch.path.at(-1)]=patch.before;
assert.deepEqual(restored,original,'No changes outside the thirteen reviewed fields');
const beforeValidation=validateDesignCandidate(original),afterValidation=validateDesignCandidate(candidate);
assert.equal(beforeValidation.valid,false);
assert.equal(beforeValidation.issues.length,1);
assert.equal(beforeValidation.issues[0].code,'STORY_TIME_MISMATCH');
assert.equal(afterValidation.valid,true);
assert.deepEqual(afterValidation.blockers,beforeValidation.blockers);
const candidatePath='data/design-candidates/design78-handover-time-draft.json';
function saveOnce(path,value){const text=JSON.stringify(value,null,2)+'\n';if(fs.existsSync(path))assert.equal(fs.readFileSync(path,'utf8'),text);else fs.writeFileSync(path,text,{flag:'wx'});}
saveOnce(candidatePath,candidate);
const report={kind:'design78_handover_time_candidate',basePlanId:receipt.planId,baseInputHash:receipt.inputHash,
  snapshotPath,snapshotSha256:sha(snapshotPath),candidatePath,candidateSha256:sha(candidatePath),
  issue:'第26章以酉初对应19:00，与常用时辰及18:00抵达、19:00交班、07—19十二小时轮班的具体安排冲突。统一改为戌初，保留实际钟点和行动顺序。',
  patches,fieldsChanged:13,replacements:19,beforeValidation,afterValidation,
  unrelatedFieldsPreserved:true,modelCalls:0,productionWrites:0,applied:false,formalAcceptance:false,
  limitation:'A prepared correction, not an applied design revision. Keep the current frozen review intact and combine with other findings before saving a new proposal. Structural validation does not certify overall story quality.'};
saveOnce('docs/audits/2026-10-25-design78-handover-time-candidate.json',report);
console.log({fieldsChanged:13,replacements:19,candidateValid:afterValidation.valid,retainedBlockers:afterValidation.blockers.length,applied:false});
