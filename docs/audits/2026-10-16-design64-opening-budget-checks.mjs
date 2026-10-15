import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateDesignCandidate } from '../../packages/application/src/design-candidate.ts';
import { chapterReviewRubricForPlan } from '../../novel-service-core/src/chapter-review.ts';
const hash = value => createHash('sha256').update(value).digest('hex');
const sourcePath = 'data/design-candidates/design64-execution-links-draft-v8.json';
const bytes = fs.readFileSync(sourcePath);
assert.equal(hash(bytes), 'a6ccd3bf890dbe065fa37ca3077de5d17ab1b235648cfaac3a429ee4897b19de');
const source = JSON.parse(bytes), candidate = structuredClone(source);
// Deliberate chapter-specific obligations, not automatic classifications or closures.
const additions = [
  [13, 'diagnosis-is-not-income', '第19日经白榆连续诊察才得至少7元载的条件性保守下界，留至少1元载安全余量；此后扣自然流逝，伤变复评。诊断不是寿储收入或预知死期，林仍淬体、未燃寿、未突破，旧稿燃寿与新账不得混算。', 'story', 'audit-ending-cost', '第19日可支配下界至少7元载、须扣自然流逝、至少留1元载、伤变即复评'],
  [13, 'injury-and-livelihood-choice', '林因夹板和胸腹、左臂旧伤不能负重、握笔或修习真元；选择坐席口述矿路、由韩叙誊写按页换基础粮药，并实际放弃本期内门选拔。劳务不增加寿储或古境资格，梁九保有先处理家人生计的选择。', 'story', 'audit-opening-growth', '林辰放弃本期内门选拔和立即追档的冲动，接受分阶段复评，选择坐席口述矿路、由韩叙誊写的劳务方式换取基本粮药。'],
  [18, 'advancement-paid-once', '第120日先复诊确认无新增耗损，以第19日下界7扣101/365得约6.7233元载；林主动完成凝元晋阶只付一次3元载，余额约3.7233且留安全余量，再复诊才练习。至180日同账扣161/365约余3.5589，不赠寿、不重复扣晋阶费，也不使用未领灵泉的未来收入。', 'story', 'audit-ending-cost', '凝元支付3元载，至第180日保守下界为7−3−161/365≈3.5589，仍保留至少1元载'],
  [18, 'trained-skill-and-equipment-limit', '132日顾按候补授业借授凝元导刃章并领用仅承载凝元真元的剑；林失控打坏木架须停练赔款，176日复测只证明两丈内可见目标导刃和主动停式。一式二成、御物另扣，停剑散热且余额不足延期；不能因读到功法就掌握玄府式、百丈感知或高阶法宝使用。', 'world', 'audit-tier-exceptions', '两丈是这次实际训练达到的范围，不把功法百丈上限当作本人已具备百丈感知或熟练度。'],
  [18, 'measured-recovery-before-departure', '176日终段训练后真元按零起算；177—179日实际领取并吃用劳务已结饭食、饮水，温和灵气中各连续静息八小时，复测只增3、3、4成。180日御物先扣半成，晚间用餐与两小时静息后仅补半成，余额10成；不得重复花早期已抵粮灵石，条件被打断则复测延期，181—183普通行路不另虚记恢复。', 'story', 'audit-opening-growth', '180日御物后10−0.5=9.5，晚间实测补回0.5后为10'],
  [26, 'arrival-and-two-post-handover', '188日10:45伤者队沿已核四里路线用75分钟到12:00，顾持续近身看墨、不兼抬车，亲交休足的乔后才疗伤，杜仍守入口。褚邵白昼补眠并实际暮抵，19时分别接入口与墨岗；189日07时由休足的杜乔接回，顾不充夜班后备，当班乔不离墨去核物，缺员或超额反抗须暂停呼援。', 'story', 'audit-guard-return-chain', '12:00抵外营面交乔，杜仍守入口。顾随后交白榆止血固定肩伤并休息，不先去核物。'],
  [26, 'spring-provenance-and-finite-share', '189日追回四支各三滴须与182日原采封人亲历、原联、入口对照页及管号封签相合，验真与白榆验毒验煞分开。12滴接回原批，9滴洁净、3滴污染记损失；只分本期未指名个人可分额，不占公共、应急、他人或未来份额，追回不另生配额，墨口供不能单独证明来源。', 'world', 'audit-resource-usage', '追回不另开12滴配额。'],
  [26, 'share-before-ownership', '林主动将原三剂申请减为两剂，让告急者先签领3滴，顾苏撤回申请；配额台按诊察和余量批准林6滴封存。救援功劳与申请都不等于所有权，林189日有效剂数仍零、寿储尚无收入；另一伤者走常规治疗，不能拿灵泉治伤或预花拟用两剂的10元载。', 'world', 'audit-resource-usage', '林主动撤去一剂申请，同意告急者先领3滴，不索回报。'],
  [27, 'first-course-completion-and-inventory', '第一支个人获配管按190—192日每日一滴实际服用，193—199日静养，另一支仍封存；199日复诊确认完整药程有效后才新增5元载，有效剂数0到1、原液6到3。林因腿伤继续常规换药并放弃195日商队，不能提前入账、重叠下一剂或把服泉当伤愈、晋阶。', 'world', 'audit-resource-usage', '199日复诊确认本剂完整炼化有效，才登记寿储新增5元载、有效剂数由0到1，个人封存原液由6滴减至3滴'],
  [27, 'first-course-lifespan-ledger', '199日沿第19日诊断起点核算7−3+5−180/365≈8.506849元载，180天已含188至199日，不能另扣或从25章重置。顾的0.25元载与林真元另账；新增伤损须复评重算下界，药程有效不能抵销伤损。', 'story', 'audit-ending-cost', '199−19=180天已包括188至199日的11天，不从第25章重新起算，也不再重复扣这11天。'],
  [28, 'second-course-completion-no-third-dose', '第二支获配管按200—202日每日一滴，203—209日静养；209日复诊确认有效才新增第二笔5元载，有效剂数1到2、原液3到0，不领新剂。告急者的3滴不计入林的用药；累计10元载不等于本章再增10，延寿不治腿伤或补真元。', 'world', 'audit-resource-usage', '209日复诊确认有效才登记新增5元载，有效剂数从1到2、原液库存从3到0'],
  [28, 'second-course-lifespan-ledger', '209日下界沿原账为7−3+10−190/365≈13.479452元载，也等于199日未四舍五入余额减10/365再加5；自然流逝、晋阶支出、两剂收入各记一次。伤变仍须复评，不能把预算当无条件存活保证或把库存归零后的泉水继续使用。', 'story', 'audit-ending-cost', '等于199日第一剂后的未四舍五入余额再扣10/365并加第二剂5元载'],
  [28, 'limited-return-to-duty', '203日顾复诊只准每日最多2小时入口轻值，须与杜当面交接，到时杜接回；乔邵看押班不依赖顾。墨用收货人别名换松押被乔拒绝，原话留证不当已核事实，不能将短班扩大成整夜、恢复擒敌能力或给林私下探视特权。', 'story', 'audit-guard-return-chain', '乔邵的看押轮班不依赖顾复岗；需全力擒敌的任务仍不许顾承担。'],
];
const questions = { world: source.worldPack.unresolvedQuestions, story: source.storyBible.unresolvedQuestions, plan: source.plan.openQuestions };
const patches = additions.map(([chapterNumber, id, requirement, document, questionId, quote]) => {
  const ci = candidate.plan.chapters.findIndex(c => c.chapterNumber === chapterNumber), chapter = candidate.plan.chapters[ci];
  assert.ok(chapter); assert.ok(!chapter.executionChecks?.some(c => c.id === id));
  assert.ok(JSON.stringify(source.plan.chapters[ci]).includes(quote), `Source quotation missing: ${id}`);
  assert.ok(source.storyBible.chapterPlans.some(c => c.chapterNumber === chapterNumber));
  const question = questions[document].find(q => q.id === questionId); assert.ok(question);
  const check = { id, requirement, sourceQuestion: { document, questionId } };
  chapter.executionChecks = [...(chapter.executionChecks ?? []), check];
  return { op: 'append_execution_check', path: `/plan/chapters/${ci}/executionChecks`, chapterNumber, check,
    basis: { sourceId: `plan/chapters/${chapter.id}`, quote }, question: structuredClone(question),
    coverage: '此章具体执行义务；不覆盖该问题其余章节、设计复核或历史替换义务。' };
});
const restored = structuredClone(candidate);
for (const patch of patches) {
  const chapter = restored.plan.chapters.find(c => c.chapterNumber === patch.chapterNumber);
  chapter.executionChecks = chapter.executionChecks.filter(c => c.id !== patch.check.id);
  if (!chapter.executionChecks.length && !source.plan.chapters.find(c => c.chapterNumber === chapter.chapterNumber).executionChecks) delete chapter.executionChecks;
}
assert.deepEqual(restored, source, 'Only declared acceptance requirements may be appended');
for (const chapter of source.plan.chapters) {
  const oldRubric = chapterReviewRubricForPlan(source.plan, chapter.chapterNumber);
  const newRubric = chapterReviewRubricForPlan(candidate.plan, chapter.chapterNumber);
  for (const [key, value] of Object.entries(oldRubric)) assert.equal(newRubric[key], value);
}
for (const patch of patches) assert.ok(chapterReviewRubricForPlan(candidate.plan, patch.chapterNumber)[`execution/${patch.check.id}`]?.includes(patch.check.requirement));
const validation = validateDesignCandidate(candidate); assert.equal(validation.valid, true, JSON.stringify(validation.issues)); assert.equal(validation.blockers.length, 41);
const checks = candidate.plan.chapters.flatMap(c => c.executionChecks ?? []); assert.equal(checks.length, 40);
const candidatePath = 'data/design-candidates/design64-opening-budget-checks-draft-v9.json';
const output = JSON.stringify(candidate, null, 2) + '\n'; fs.writeFileSync(candidatePath, output, { flag: 'wx' });
const proof = {kind:'proposed_opening_budget_acceptance_requirements',observedAt:new Date().toISOString(),sourcePath,sourceSha256:hash(bytes),
 sourceInputHash:'32f6ca9f61bbb70b8b56a0a7908ca086a0ce1b6ff4554ff3bafdf7428f05465f',candidatePath,candidateSha256:hash(output),patches,validation,
 oldRequirementsPreserved:27,newRequirements:13,totalRequirements:40,chaptersChanged:[13,18,26,27,28],
 worldAndBibleUnchanged:true,storyTextUnchanged:true,questionsUnchanged:true,productionWrites:0,modelCalls:0,formalAcceptance:false,applied:false,
 limitation:'Explicit first-volume execution criteria, not semantic acceptance or exhaustive question coverage. Keep all 41 blockers until design findings and remaining execution/history obligations are individually reconciled. Never require the prose to recite a ledger; evidence may be natural action, consequences and chapter review citations.'};
fs.writeFileSync('docs/audits/2026-10-16-design64-opening-budget-checks.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({candidatePath,sha256:proof.candidateSha256,added:13,total:40,blockers:41,applied:false}));
