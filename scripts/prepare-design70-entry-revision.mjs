// Preserve the rejected first candidate, then rehearse the revised scene in isolation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {PrismaWorkRepository} from '../packages/persistence/src/prisma-repository.ts';
import {ChapterWorkflow} from '../packages/application/src/index.ts';
import {validateDesignCandidate} from '../packages/application/src/design-candidate.ts';
import {designReviewHash,designReviewOverview} from '../novel-service-core/src/design-review.ts';
import {qualityAuditFor} from '../novel-service-core/src/core.ts';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=x=>createHash('sha256').update(x).digest('hex');
const hash=x=>sha(JSON.stringify(x));
const fileHash=p=>sha(fs.readFileSync(p));
const repair=read('docs/audits/2026-10-17-design70-entry-candidate.json');
const rejectedPath='docs/audits/2026-10-17-design70-entry-content-review.json',rejected=read(rejectedPath);
assert.equal(fileHash(repair.candidatePath),repair.candidateSha256);
assert.equal(rejected.candidateSha256,repair.candidateSha256);
assert.deepEqual(rejected.result.checks.map(c=>[c.criterion,c.verdict]),[['causality','revise'],['timeline','pass'],['pacing','revise']]);
const original=read(repair.candidatePath),candidate=structuredClone(original);
const chapter=candidate.plan.chapters.find(c=>c.chapterNumber===14);
const bibleChapter=candidate.storyBible.chapterPlans.find(c=>c.chapterNumber===14);
const priorScene=chapter.scenes[5];assert.equal(bibleChapter.requiredEvents[5],priorScene);
const scene='青灵坊市收摊后的普通后街，一身便衣的墨幽屠等着沿外山公共道路徒步赶来的外围信使。信使认出墨，停到他面前，刚要喊“少主”，就被他抬手截住；墨接过对方递来的矿道失败纸报，贴近檐下翻看。巡查的脚步从街口逼近，他立即合上纸报，让信使退开等候；两人多耗了半个时辰，等巡查走过、附近摊贩收完货离开，才重新交接。墨没有在街上说出掳人目标。他在纸背写下索取下一期采集名单和泉液去向的短令，折回原状交还同一信使，低声只说“带回去，交给原来负责集结的人”，亲眼看着信使收妥离开。墨收起始终折着的未炼成万鬼幡图谱：矿道灭口既然失败，他决定把下一期采集者和泉液当作新的目标。此场完成的是墨接到失败消息、作出选择并交出待送的命令，未写远处手下已经收令或行动；便衣和躲开一次巡查只降低暴露风险，不构成免检或保证无人目击，林苏也未在场。';
chapter.scenes[5]=scene;bibleChapter.requiredEvents[5]=scene;
const oldSummary='收到矿道行动失败的实体回报，将灭口失手转为筹备下一期掳人夺泉的计划';
const newSummary='收到矿道行动失败的实体回报；他为避开巡查延误半个时辰，随后把索取采集名单和泉液去向的纸面短令折好交回同一信使带往原班集结者，将灭口失手转为下一期掳人夺泉的打算，尚未确认远处收令';
assert.ok(chapter.summary.includes(oldSummary));
chapter.summary=chapter.summary.replace(oldSummary,newSummary);bibleChapter.purpose=chapter.summary;
chapter.executionChecks.find(c=>c.id==='mo-public-message-location').requirement='墨在青灵坊市普通公共后街实际接到失败纸报，信使认出他但称呼被截住；巡查逼近使交接暂停并耗时半个时辰。墨不公开口述掳人命令，以折好的纸面短令交回同一信使，指定带给原班集结者；远处收令、执行和无人目击均不得预先写成事实。接报后才改变打算，不新增总坛准入、防护或法宝，图谱仍未炼成王器，林苏不因读者视角知情。';
assert.deepEqual(candidate.worldPack,original.worldPack);
assert.deepEqual(candidate.storyBible.characters,original.storyBible.characters);
assert.deepEqual(candidate.storyBible.relationships,original.storyBible.relationships);
assert.deepEqual(candidate.storyBible.unresolvedQuestions,original.storyBible.unresolvedQuestions);
assert.deepEqual(candidate.plan.openQuestions,original.plan.openQuestions);
const validation=validateDesignCandidate(candidate);assert.equal(validation.valid,true);assert.equal(validation.blockers.length,41);
const changes=[];
function diff(a,b,p=''){
 if(JSON.stringify(a)===JSON.stringify(b))return;
 if(a&&b&&typeof a==='object'&&typeof b==='object')for(const k of new Set([...Object.keys(a),...Object.keys(b)]))diff(a[k],b[k],`${p}/${k}`);
 else changes.push({path:p,before:a,after:b});
}
diff(original,candidate);assert.equal(changes.length,5);
const candidatePath='data/design-candidates/design70-entry-location-v2.json';
const candidateProofPath='docs/audits/2026-10-17-design70-entry-candidate-v2.json';
const directory=path.resolve('data/audit-runtimes/design70-entry-save-rehearsal-v2');
assert.ok(!fs.existsSync(candidatePath)&&!fs.existsSync(candidateProofPath)&&!fs.existsSync(directory));
const candidateBytes=JSON.stringify(candidate,null,2)+'\n';
fs.writeFileSync(candidatePath,candidateBytes,{flag:'wx'});
fs.writeFileSync(candidateProofPath,JSON.stringify({...repair,kind:'design70_entry_scene_revision',preparedAt:new Date().toISOString(),
 sourceCandidatePath:repair.candidatePath,sourceCandidateSha256:repair.candidateSha256,candidatePath,candidateSha256:sha(candidateBytes),
 rejectedReviewPath:rejectedPath,rejectedReviewSha256:fileHash(rejectedPath),changes,validation,formalAcceptance:false},null,2)+'\n',{flag:'wx'});
const terminal=read('docs/audits/2026-10-17-design70-review-result.json');
assert.equal(fileHash(terminal.databaseSnapshotPath),terminal.databaseSnapshotSha256);
fs.mkdirSync(directory);
const databasePath=path.join(directory,'isolated.db');fs.copyFileSync(terminal.databaseSnapshotPath,databasePath,fs.constants.COPYFILE_EXCL);
const maps=['plans','designHistory','versions','events','manuscripts','candidates','designReviewRuns','designContentReviews'];
const serialize=w=>Object.fromEntries(Object.entries(w).map(([k,v])=>[k,v instanceof Map?[...v]:v]));
const mutable=new Set(['storyBible','plans','designHistory','constraintRevision']);
const protectedHash=w=>hash(Object.fromEntries(Object.entries(serialize(w)).filter(([k])=>!mutable.has(k))));
const repo=new PrismaWorkRepository(new PrismaClient({datasources:{db:{url:`file:${databasePath}`}}}));
let before,saved;
try{
 before=await repo.get(repair.workId);assert.ok(before);assert.equal(designReviewHash(before,repair.basePlanId),repair.expectedInputHash);
 const workflow=new ChapterWorkflow(repo,{generateChapter(){throw new Error('No prose');}});
 saved=await workflow.saveDesignCandidate(repair.workId,{basePlanId:repair.basePlanId,expectedInputHash:repair.expectedInputHash,candidate,
  note:'隔离演练 v2：实体接报、避让巡查和纸面回令；原候选与返修意见保留，不批准。'});
}finally{await repo.disconnect();}
const restarted=new PrismaWorkRepository(new PrismaClient({datasources:{db:{url:`file:${databasePath}`}}}));
let after;try{after=await restarted.get(repair.workId);}finally{await restarted.disconnect();}
assert.equal(protectedHash(after),protectedHash(before));
for(const k of maps){for(const [id,v]of before[k])assert.equal(hash(after[k].get(id)),hash(v),`${k}/${id}`);
 assert.equal(after[k].size,before[k].size+(k==='plans'||k==='designHistory'?1:0));}
assert.equal(after.constraintRevision,before.constraintRevision+1);
const plan=after.plans.get(saved.plan.id);assert.equal(plan.revision,71);assert.equal(plan.status,'proposed');
assert.equal(plan.worldPackRevision,36);assert.equal(plan.storyBibleRevision,68);assert.deepEqual(plan.plan,candidate.plan);
assert.deepEqual(after.worldPack,before.worldPack);
assert.equal(after.plans.get(after.activePlanId).revision,10);assert.equal(designReviewOverview(after,plan.id).ready,false);
assert.equal(qualityAuditFor(after).questions.filter(q=>q.blocking&&q.status!=='resolved').length,41);
const tracked=execFileSync('git',['ls-files','packages','novel-service-core'],{encoding:'utf8'}).trim().split('\n');
const sourceHashes=Object.fromEntries(tracked.filter(p=>p.endsWith('.ts')).map(p=>[p,fileHash(p)]));
const proof={verifiedAt:new Date().toISOString(),candidatePath,candidateSha256:sha(candidateBytes),databasePath,
 sourceSnapshot:terminal.databaseSnapshotPath,sourceSnapshotSha256:terminal.databaseSnapshotSha256,sourceHashes,
 isolatedPlanId:plan.id,isolatedInputHash:designReviewHash(after,plan.id),revisions:{world:36,bible:68,plan:71,approved:10},
 retainedMapCounts:Object.fromEntries(maps.map(k=>[k,before[k].size])),allExistingRecordsPreservedExactly:true,
 productionWrites:0,modelCalls:0,formalAcceptance:false};
assert.equal(fileHash(terminal.databaseSnapshotPath),terminal.databaseSnapshotSha256);
fs.writeFileSync('docs/audits/2026-10-17-design70-entry-save-rehearsal-v2.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({candidatePath,changes:changes.length,isolatedRevision:plan.revision,retained:proof.retainedMapCounts,formalAcceptance:false}));
