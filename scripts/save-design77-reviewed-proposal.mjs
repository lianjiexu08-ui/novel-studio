// Save the reviewed local repairs as a proposal only. Rehearse first in a
// private SQLite copy, preserve every old record, then verify after restart.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaWorkRepository } from '../packages/persistence/src/prisma-repository.ts';
import { ChapterWorkflow } from '../packages/application/src/index.ts';
import { designReviewHash, designReviewOverview } from '../novel-service-core/src/design-review.ts';
import { validateDesignCandidate } from '../packages/application/src/design-candidate.ts';
import { qualityAuditFor } from '../novel-service-core/src/core.ts';
const mode = process.argv[2]; assert.ok(['--rehearse','--apply','--verify'].includes(mode));
const read = p => JSON.parse(fs.readFileSync(p));
const hash = value => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const clean = v => JSON.parse(JSON.stringify(v));
const candidatePath = 'data/design-candidates/design76-followup-controls-v7.json', candidate = read(candidatePath);
const review6Path = 'docs/audits/2026-10-18-design76-followup-v6-integrated-review.json', review6 = read(review6Path);
const review7Path = 'docs/audits/2026-10-18-design76-followup-v7-targeted-review.json', review7 = read(review7Path);
const correctionsPath = 'docs/audits/2026-10-18-design76-v6-independent-findings.json', corrections = read(correctionsPath);
assert.equal(sha(review6.statePath), review6.stateSha256); assert.equal(sha(review7.statePath), review7.stateSha256);
assert.equal(review7.candidateSha256, hash(candidate)); assert.equal(corrections.originalVerdictsPreserved, true);
assert.ok(review7.results.every(r => r.result.checks.every(c => c.verdict === 'pass')));
assert.ok(review6.results.find(r => r.area === 'characters').result.checks.every(c => c.verdict === 'pass'));
assert.equal(review6.results.find(r => r.area === 'story').result.checks.find(c => c.criterion === 'payoff').verdict, 'pass');
for (const review of [review6, review7]) { const state = read(review.statePath); try { process.kill(state.pid,0); assert.fail('Reviewer live'); } catch(e) { assert.equal(e.code,'ESRCH'); } }
const inputs = read('data/audit-runtimes/design76-notes30-review/inputs.json');
const workId = 'work_8b6c9133e13d404083ca33acc63f4f61', basePlanId = inputs.world.scope.planRevisionId, expectedInputHash = inputs.world.inputHash;
assert.equal(review7.baseInputHash, expectedInputHash);
const validation = validateDesignCandidate(candidate); assert.equal(validation.valid, true); assert.equal(validation.blockers.length,41);
const directory = path.resolve('data/audit-runtimes/design77-proposal-save');
fs.mkdirSync(directory, { recursive: true });
const rehearsalPath = 'docs/audits/2026-10-18-design77-proposal-rehearsal.json', appliedPath = 'docs/audits/2026-10-18-design77-proposal-applied.json';
const intentPath = path.join(directory, 'apply-intent.json');
const mutable = new Set(['worldPack','storyBible','plans','designHistory','constraintRevision']);
const signatures = work => Object.fromEntries(Object.entries(work).map(([key, value]) => [key, value instanceof Map
  ? Object.fromEntries([...value].map(([id, v]) => [id, hash(v)])) : hash(value)]));
const versions = w => ({ world: w.worldPack.revision, storyBible: w.storyBible.revision, plan: Math.max(...[...w.plans.values()].map(p => p.revision)), approvedPlan: w.plans.get(w.activePlanId).revision });
let database = path.resolve('data/novel-studio.db');
if (mode === '--rehearse') {
  assert.ok(!fs.existsSync(rehearsalPath));
  const copy = path.join(directory, 'private.db'); assert.ok(!fs.existsSync(copy));
  execFileSync('python3', ['-c', "import sqlite3,sys; a=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()", database, copy]);
  database = copy; fs.copyFileSync(process.argv[1], path.join(directory, 'runner.mjs'));
} else if (mode === '--apply') {
  assert.ok(!fs.existsSync(intentPath) && !fs.existsSync(appliedPath), 'Inspect prior intent/result; use --verify instead of repeating');
  assert.equal(read(rehearsalPath).verified, true); assert.equal(read(rehearsalPath).candidateSha256, hash(candidate));
  try { process.kill(77415,0); assert.fail('Stop the standalone API before the production transaction'); } catch(e) { assert.equal(e.code,'ESRCH'); }
}
const prisma = new PrismaClient({datasources:{db:{url:'file:'+database}}}), repository = new PrismaWorkRepository(prisma);
const writer = { generateChapter() { throw Error('No prose during proposal save'); } };
let saved, beforeSignatures, counts, constraint;
try {
  const before = await repository.get(workId); assert.ok(before);
  if (mode === '--verify') {
    const intent = read(intentPath); saved = read(appliedPath); beforeSignatures = intent.beforeSignatures; counts = intent.counts; constraint = intent.constraint;
    assert.equal(saved.candidateSha256, hash(candidate));
  } else {
    assert.equal(designReviewHash(before, basePlanId), expectedInputHash);
    assert.deepEqual(versions(before), {world:40,storyBible:72,plan:76,approvedPlan:10});
    assert.ok(![...before.designReviewRuns.values()].some(r => r.leaseToken));
    beforeSignatures = signatures(before); constraint = before.constraintRevision;
    counts = Object.fromEntries(Object.entries(before).filter(([,v])=>v instanceof Map).map(([key,v])=>[key,v.size]));
    if (mode === '--apply') fs.writeFileSync(intentPath, JSON.stringify({ candidateSha256:hash(candidate), expectedInputHash, beforeSignatures, counts, constraint },null,2)+'\n', {flag:'wx'});
    const workflow = new ChapterWorkflow(repository, writer);
    const result = await workflow.saveDesignCandidate(workId, {basePlanId,expectedInputHash,candidate,
      note:'保存已局部复核的法宝操控与复用、人物知情/消息时点、返乡访客准入修订为新待审提案。原判定、37条说明和41条待处理记录保留；未批准计划、未生成正文，仍需当前设计完整质量评审。'});
    saved = {appliedPlanId:result.plan.id};
    await assert.rejects(workflow.saveDesignCandidate(workId,{basePlanId,expectedInputHash,candidate}), /整体修订基线/);
  }
  await repository.disconnect();
  const after = await repository.get(workId), afterSignatures = signatures(after), plan = after.plans.get(saved.appliedPlanId);
  for (const [key,value] of Object.entries(beforeSignatures)) if (!mutable.has(key)) assert.deepEqual(afterSignatures[key], value, key);
  for (const key of Object.keys(counts)) {
    for (const [id,h] of Object.entries(beforeSignatures[key])) assert.equal(afterSignatures[key][id],h,`${key}/${id}`);
    assert.equal(after[key].size, counts[key] + (key === 'plans' ? 1 : key === 'designHistory' ? 2 : 0));
  }
  assert.equal(after.constraintRevision,constraint+1);
  assert.deepEqual(versions(after),{world:41,storyBible:73,plan:77,approvedPlan:10});
  assert.equal(plan.status,'proposed'); assert.deepEqual(plan.plan,candidate.plan);
  assert.deepEqual(after.worldPack, clean({...candidate.worldPack,revision:41,status:'proposed',lockedAt:undefined}));
  assert.deepEqual(after.storyBible, clean({...candidate.storyBible,revision:73,status:'proposed',lockedAt:undefined,worldPackRevision:41}));
  assert.equal(designReviewOverview(after,plan.id).ready,false);
  assert.equal(qualityAuditFor(after).questions.filter(q=>q.blocking&&q.status!=='resolved').length,41);
  assert.equal(plan.plan.chapters.length,50); assert.equal(plan.plan.targetChapterCount,100);
  const result = {verified:true,mode,workId,basePlanId,expectedInputHash,appliedPlanId:plan.id,newInputHash:designReviewHash(after,plan.id),
    candidatePath,candidateSha256:hash(candidate),review6Path,review6Sha256:sha(review6Path),review7Path,review7Sha256:sha(review7Path),correctionsPath,correctionsSha256:sha(correctionsPath),
    runnerSha256:sha(process.argv[1]),revisions:versions(after),beforeCounts:counts,allExistingRecordsPreserved:true,unrelatedFieldsPreserved:true,
    staleRetryRejected:true,restartReadback:true,blockersRetained:41,detailedChapters:50,macroChapters:100,approved:false,formalAcceptance:false,modelCalls:0,productionDesignSaves:mode==='--apply'?1:0};
  const output = mode==='--rehearse'?rehearsalPath:mode==='--apply'?appliedPath:'docs/audits/2026-10-18-design77-proposal-restart-verified.json';
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({verified:true,mode,revisions:result.revisions,appliedPlanId:plan.id,oldRuns:counts.designReviewRuns,oldReports:counts.designContentReviews,oldAnnotations:counts.designReviewAnnotations,productionDesignSaves:result.productionDesignSaves}));
} finally { await repository.disconnect(); }
