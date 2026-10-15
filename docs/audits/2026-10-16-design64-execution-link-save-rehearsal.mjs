import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const root=process.cwd(),binding=read('data/audit-runtimes/design64-runtime-bound.json'),baseline=read('data/audit-runtimes/design64-control/baseline.json');
const repair=read('docs/audits/2026-10-16-design64-execution-link-repair.json'),input=read('data/audit-runtimes/design64-control/link-rehearsal-inputs.json');
assert.notEqual(fs.realpathSync(input.databaseSnapshot),fs.realpathSync(root+'/data/novel-studio.db'));
assert.notEqual(fs.statSync(input.databaseSnapshot).ino,fs.statSync(root+'/data/novel-studio.db').ino);
assert.equal(fileHash(repair.candidatePath),repair.candidateSha256);
for(const[p,h] of Object.entries(binding.sourceHashes))assert.equal(fileHash(binding.root+'/'+p),h);
process.env.DATABASE_URL='file:'+input.databaseSnapshot;
const {PrismaWorkRepository}=await import(binding.root+'/packages/persistence/src/prisma-repository.ts');
const {ChapterWorkflow}=await import(binding.root+'/packages/application/src/index.ts');
const {chapterReviewRubricForPlan}=await import(binding.root+'/novel-service-core/src/chapter-review.ts');
const {qualityAuditFor}=await import(root+'/novel-service-core/src/core.ts');
const {designReviewHash}=await import(binding.root+'/novel-service-core/src/design-review.ts');
const candidate=read(repair.candidatePath),repo=new PrismaWorkRepository();let saved,before,oldPlan,after;
const archive=w=>({world:w.worldPack,bible:w.storyBible,activePlanId:w.activePlanId,plans:[...w.plans],designHistory:[...w.designHistory],versions:[...w.versions],events:[...w.events],manuscripts:[...w.manuscripts],candidates:[...w.candidates],runs:[...w.designReviewRuns],reports:[...w.designContentReviews]});
try {
 const work=await repo.get(baseline.workId);assert.equal(designReviewHash(work,baseline.planId),baseline.inputHash);
 before=structuredClone(archive(work));oldPlan=work.plans.get(baseline.planId);
 const workflow=new ChapterWorkflow(repo,{generateChapter(){throw new Error('No prose in save rehearsal')}});
 saved=await workflow.saveDesignCandidate(work.id,{basePlanId:baseline.planId,expectedInputHash:baseline.inputHash,candidate,note:'隔离演练：保留章节要求，仅撤销七条语义范围不匹配的问题关联'});
 assert.equal(saved.plan.status,'proposed');
}finally{await repo.disconnect()}
const restarted=new PrismaWorkRepository();
try{after=await restarted.get(baseline.workId)}finally{await restarted.disconnect()}
const restored=after.plans.get(saved.plan.id);assert.deepEqual(restored.plan,candidate.plan);
const protectedAfter=archive(after);protectedAfter.plans=protectedAfter.plans.filter(([id])=>id!==restored.id);
assert.deepEqual(protectedAfter,before,'All original history and design documents must survive exactly');
assert.equal(after.plans.size,before.plans.length+1);assert.equal(restored.revision,65);
for(const chapter of oldPlan.plan.chapters)assert.deepEqual(chapterReviewRubricForPlan(restored.plan,chapter.chapterNumber),chapterReviewRubricForPlan(oldPlan.plan,chapter.chapterNumber),'Unlinking must not remove any chapter review requirement');
const audit=qualityAuditFor(after);assert.equal(audit.questions.filter(q=>q.blocking&&q.status!=='resolved').length,41);
for(const patch of repair.patches){const question=audit.questions.find(q=>q.source===patch.before.document&&q.questionId===patch.before.questionId);assert.ok(question);assert.ok(!question.executionChecks.some(c=>c.planId===restored.id&&c.chapterNumber===patch.chapterNumber&&c.checkId===patch.checkId));}
const proof={observedAt:new Date().toISOString(),kind:'isolated_question_link_save_rehearsal',candidatePath:repair.candidatePath,candidateSha256:repair.candidateSha256,
 databaseSnapshot:input.databaseSnapshot,runtimeCommit:binding.commit,sourceFilesVerified:Object.keys(binding.sourceHashes).length,
 sourcePlanId:baseline.planId,newPlanRevision:restored.revision,newPlanStatus:restored.status,worldRevision:after.worldPack.revision,bibleRevision:after.storyBible.revision,
 approvedPlanRevision:after.plans.get(after.activePlanId).revision,oldHistoryUnchanged:true,allChapterRubricsUnchanged:true,removedLinksAbsentFromAudit:true,
 blockers:41,requirementsPreserved:27,productionWrites:0,modelCalls:0,proseGenerated:false,formalAcceptance:false,verifierSha256:fileHash(process.argv[1])};
fs.writeFileSync('docs/audits/2026-10-16-design64-execution-link-save-rehearsal.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(proof));
