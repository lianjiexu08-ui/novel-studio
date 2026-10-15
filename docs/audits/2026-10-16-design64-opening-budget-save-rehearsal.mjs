import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const root=process.cwd(),binding=read('data/audit-runtimes/design64-runtime-bound.json'),baseline=read('data/audit-runtimes/design64-control/baseline.json');
const repair=read('docs/audits/2026-10-16-design64-opening-budget-checks.json'),input=read('data/audit-runtimes/design64-control/budget-rehearsal-inputs.json');
assert.notEqual(fs.realpathSync(input.databaseSnapshot),fs.realpathSync(root+'/data/novel-studio.db'));
assert.notEqual(fs.statSync(input.databaseSnapshot).ino,fs.statSync(root+'/data/novel-studio.db').ino);
assert.equal(fileHash(repair.candidatePath),repair.candidateSha256);
for(const[p,h] of Object.entries(binding.sourceHashes))assert.equal(fileHash(binding.root+'/'+p),h);
process.env.DATABASE_URL='file:'+input.databaseSnapshot;
const {PrismaWorkRepository}=await import(root+'/packages/persistence/src/prisma-repository.ts');
const {ChapterWorkflow}=await import(root+'/packages/application/src/index.ts');
const {chapterReviewRubricForPlan}=await import(root+'/novel-service-core/src/chapter-review.ts');
const {qualityAuditFor}=await import(root+'/novel-service-core/src/core.ts');
const {designReviewHash}=await import(binding.root+'/novel-service-core/src/design-review.ts');
const candidate=read(repair.candidatePath),repo=new PrismaWorkRepository();let saved,before,oldPlan,after;
const archive=w=>({world:w.worldPack,bible:w.storyBible,activePlanId:w.activePlanId,plans:[...w.plans],designHistory:[...w.designHistory],versions:[...w.versions],events:[...w.events],manuscripts:[...w.manuscripts],candidates:[...w.candidates],runs:[...w.designReviewRuns],reports:[...w.designContentReviews]});
try {
 const work=await repo.get(baseline.workId);assert.equal(designReviewHash(work,baseline.planId),baseline.inputHash);
 before=structuredClone(archive(work));oldPlan=work.plans.get(baseline.planId);
 const workflow=new ChapterWorkflow(repo,{generateChapter(){throw new Error('No prose in save rehearsal')}});
 saved=await workflow.saveDesignCandidate(work.id,{basePlanId:baseline.planId,expectedInputHash:baseline.inputHash,candidate,note:'隔离演练：追加13项第一卷诊断、晋阶、领药、疗程与交接验收，保留全部41项阻塞'});
 assert.equal(saved.plan.status,'proposed');
}finally{await repo.disconnect()}
const restarted=new PrismaWorkRepository();
try{after=await restarted.get(baseline.workId)}finally{await restarted.disconnect()}
const restored=after.plans.get(saved.plan.id);assert.deepEqual(restored.plan,candidate.plan);
const protectedAfter=archive(after);protectedAfter.plans=protectedAfter.plans.filter(([id])=>id!==restored.id);
assert.deepEqual(protectedAfter,before,'All original history and design documents must survive exactly');
assert.equal(after.plans.size,before.plans.length+1);assert.equal(restored.revision,65);
const previousCandidate=read(repair.sourcePath);
for(const chapter of previousCandidate.plan.chapters) {
 const beforeRubric=chapterReviewRubricForPlan(previousCandidate.plan,chapter.chapterNumber),afterRubric=chapterReviewRubricForPlan(restored.plan,chapter.chapterNumber);
 for(const[key,value] of Object.entries(beforeRubric))assert.equal(afterRubric[key],value,'Old requirements remain unchanged');
 if(!repair.chaptersChanged.includes(chapter.chapterNumber))assert.deepEqual(afterRubric,beforeRubric);
}
const audit=qualityAuditFor(after);assert.equal(audit.questions.filter(q=>q.blocking&&q.status!=='resolved').length,41);
for(const patch of repair.patches){
 const question=audit.questions.find(q=>q.source===patch.check.sourceQuestion.document&&q.questionId===patch.check.sourceQuestion.questionId);assert.ok(question);
 const linked=question.executionChecks.find(c=>c.planId===restored.id&&c.chapterNumber===patch.chapterNumber&&c.checkId===patch.check.id);
 assert.ok(linked);assert.equal(linked.requirement,patch.check.requirement);
 assert.notEqual(linked.executionEvidence.status,'verified','Old prose must not certify a new obligation');
 assert.ok(chapterReviewRubricForPlan(restored.plan,patch.chapterNumber)['execution/'+patch.check.id].includes(patch.check.requirement));
}
const proof={observedAt:new Date().toISOString(),kind:'isolated_opening_budget_save_rehearsal',candidatePath:repair.candidatePath,candidateSha256:repair.candidateSha256,
 databaseSnapshot:input.databaseSnapshot,runtimeCommit:'65d1a21',frozenReviewRuntimeCommit:binding.commit,sourceFilesVerified:Object.keys(binding.sourceHashes).length,
 sourcePlanId:baseline.planId,newPlanRevision:restored.revision,newPlanStatus:restored.status,worldRevision:after.worldPack.revision,bibleRevision:after.storyBible.revision,
 approvedPlanRevision:after.plans.get(after.activePlanId).revision,oldHistoryUnchanged:true,oldChapterRequirementsUnchanged:true,newRequirementsIncludedInReview:true,onlyTargetedChapterRubricsChanged:true,oldProseDoesNotCertifyNewRequirements:true,
 blockers:41,requirementsPreserved:27,requirementsAdded:13,totalRequirements:40,productionWrites:0,modelCalls:0,proseGenerated:false,formalAcceptance:false,verifierSha256:fileHash(process.argv[1])};
fs.writeFileSync('docs/audits/2026-10-16-design64-opening-budget-save-rehearsal.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(proof));
