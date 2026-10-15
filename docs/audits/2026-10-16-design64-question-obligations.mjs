import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePath = 'data/design-candidates/design64-cost-wording-draft-v10.json';
const bytes = fs.readFileSync(sourcePath);
assert.equal(hash(bytes), '0ae66cd4c90a9d02de50cc5cbc9d8be518b111538822bdbe8a09f94edba8d5b9');
const candidate = JSON.parse(bytes);
// Explicit editorial mapping, not keyword classification and not a closure rule.
// Same-worded story/plan records remain distinct version-bound obligations.
const definitions = [
  [['world/audit-power-opening'], ['power', 'story'], [[1, 100]], '前百章不发动逆命真解；实际术式、境界与成本逐章相符。', true],
  [['world/audit-resource-definitions'], ['world', 'power'], [], 'res_15/res_16的品阶、材质、发行保存及势力引用先审规则；首次安排获取或使用前补齐本次来源与用途。', true],
  [['world/audit-travel-rules'], ['world', 'power', 'story'], [[54, 72]], '北航五日、返航六日、14000专项款、有限担保和寒防逐段兑现，不采用旧稿换舱或信物特权。', true],
  [['world/audit-tier-exceptions'], ['power', 'story'], [[1, 100], [101, 450]], '百章只至玄府并保留赵的境界；后续高阶资格与寿源须在安排前逐阶段设计，不由容量算例授予角色。', true],
  [['world/audit-resource-usage'], ['power', 'story'], [[1, 100]], '核对每笔实有收入、支出、疗程和配额；两剂只各入账一次，旧神海突破与燃寿不得混账。', true],
  [['world/audit-first-volume-foundation'], ['world', 'power', 'story'], [[1, 32]], '分区、寿储诊断和凝元三重规则先核设计，再核实际修习、达标、领药与完整疗程。', true],
  [['story/audit-volume-timeline'], ['world', 'story'], [[1, 100]], '32/66/100卷界、436日高潮、466日回访分别与行程和事件日期一致。', true],
  [['story/audit-artifact-continuity'], ['power', 'characters', 'story'], [[1, 100]], '区分第一片持有、第二片抵押赵府、第三片未得及角色知情，不继承旧合匙、宝鉴或锁销事实。', true],
  [['story/audit-ending-cost'], ['power', 'story'], [[13, 18], [27, 28], [81, 100]], '从19日下界7沿120日扣3、199/209日各加5、415日扣10和自然流逝核算至466日；伤情变化另核。', true],
  [['story/audit-relationship-stages'], ['characters', 'story'], [[1, 100]], '苏留宗、夜有限合作、贺航款、陆自认改签须以各自选择、付出和实到消息触发关系变化。', true],
  [['story/audit-knowledge-reveal-order'], ['characters', 'story'], [[1, 100]], '父案材料、报令、北境面报、异地抵押和95章撤押原令分别核来源与知情时点，不共享异地作者信息。', true],
  [['story/audit-opening-growth', 'plan/opening-growth-repair'], ['power', 'characters', 'story'], [[1, 50]], '实际动作、伤情、训练资格、晋阶和资源时序逐章成立；旧稿高阶成就不能作为新方案前置。', true],
  [['story/audit-opening-quality', 'plan/opening-quality-review'], ['world', 'power', 'characters', 'story'], [[1, 50]], '前50章整体冲突、因果、人物与节奏先审章纲，再逐章审核文学正文；局部33–35通过不代表整体。', true],
  [['story/audit-resource-growth-budget', 'plan/resource-growth-budget'], ['power', 'story'], [[1, 100]], '寿储、药程、航款和物品收入支出逐章落地；51–100仅有宏观预算时不认定已取得或已花费。', true],
  [['story/audit-first-volume-blueprint', 'plan/first-volume-blueprint'], ['world', 'power', 'characters', 'story'], [[1, 33]], '第一卷32章、188日交接及与第二卷首章的接续须完整复核，随后核对替换正文与旧稿差异。', true],
  [['story/audit-v1-outline-review', 'plan/v1-outline-review'], ['world', 'power', 'characters', 'story'], [[1, 50]], '保存已有交叉复审，但当前设计须四领域验收；章纲通过不可替代第一卷正文和事件兑现。', true],
  [['story/audit-v23-macro', 'plan/v23-macro'], ['world', 'power', 'characters', 'story'], [[33, 100]], '后两卷宏观整体验收后逐批展开51–100；六号箱和仓火重组不代表旧正文已被替换。', true],
  [['story/audit-guard-return-chain', 'plan/guard-return-chain'], ['world', 'power', 'characters', 'story'], [[18, 33]], '核对各岗人物、实际到达、交接、休息、伤情和返宗；旧专项通过只作为历史证据。', true],
  [['story/audit-first-warehouse-fire', 'plan/first-warehouse-fire'], ['characters', 'story'], [[36, 39], [40, 100]], '核对普通灯架、燃迹和现场分工；倾灯责任与携页者须有后续调查证据，无法查明则如实留下未查明边界，不虚称已破案。', true],
  [['story/audit-barge-inspection', 'plan/barge-inspection'], ['world', 'characters', 'story'], [[43, 53]], '五人实际撤离与去留选择、七人生计、船舶交检和陆自述签认/独立核验分别完成。', true],
  [['story/audit-second-warehouse-fire', 'plan/second-warehouse-fire'], ['characters', 'story'], [[48, 53]], '50章采用门口核实与陆停止协助，撤销的第二仓纵火不进入新正文；核对52消息来源、救助和食宿付款。', true],
  [['story/audit-first50-narrative', 'plan/first50-narrative'], ['characters', 'story'], [[1, 50]], '核对调查压缩、唐失败、报警追船与切索救援后的完整节奏；前置章纲复审不能替代新文学正文与历史一致性。', true],
  [['story/audit-message-arrivals', 'plan/message-arrivals'], ['world', 'characters', 'story'], [[51, 99]], '52–54第一报、73面报、80重整、87–88押报、90–95撤令、98–99败报问询各有实体送达与有限认知。', true],
  [['story/audit-review-capacity', 'plan/review-capacity'], ['world', 'power', 'characters', 'story'], [], '当前四领域全量原文、跨批、补读和综合均完成，所有未通过项有结论；保留失败与旧报告，不能靠截断、局部通过或代码实现关闭本项。', false],
  [['plan/baseline-content-review'], ['world', 'power', 'characters', 'story'], [[1, 100]], '当前版本四领域设计、后续逐章正文、事件与历史一致性分开验收；批准旧版10和局部报告不放行新设计。', true],
  [['plan/convoy-custody-causality'], ['power', 'characters', 'story'], [[89, 100]], '原令导致有限交械、顾牵制与祁自主交械有因果；不对无阴煞者施真光，不多扣寿元；救护至少31分钟及实物损坏、看押持续性落地。', true],
  [['plan/north-coast-exit-permit'], ['world', 'characters', 'story'], [[67, 80]], '300限程担保、303邮资、304登船、305交车、308换车、311返岗、318实收分开；异常查件必须有真实人手和资金，邮递失败不倒写离境失败。', true],
  [['plan/chapter25-claw-sequence'], ['power', 'story'], [[25, 25]], '顾三息起印与墨第二/第三息两次血爪付款对齐，真光只接触已经外放爪煞，顾先有既定训练资格，战后伤损和余额分账。', true],
];
const documents = { world: candidate.worldPack.unresolvedQuestions, story: candidate.storyBible.unresolvedQuestions, plan: candidate.plan.openQuestions };
const all = Object.entries(documents).flatMap(([document, questions]) => questions.filter(q => q.blocking && q.status !== 'resolved').map(question => ({ key: `${document}/${question.id}`, document, question })));
assert.equal(all.length, 41);
const seen = new Set();
const records = definitions.flatMap(([keys, areas, ranges, requirement, hasExecution]) => keys.map(key => {
  assert.ok(!seen.has(key), key); seen.add(key);
  const row = all.find(q => q.key === key); assert.ok(row, key);
  const links = candidate.plan.chapters.flatMap(chapter => (chapter.executionChecks ?? [])
    .filter(check => check.sourceQuestion?.document === row.document && check.sourceQuestion.questionId === row.question.id)
    .map(check => ({ chapterNumber: chapter.chapterNumber, checkId: check.id, requirement: check.requirement })));
  return { ...row, relatedRecordKeys: keys.filter(k => k !== key),
    sourceQuestionSha256: hash(JSON.stringify(row.question)),
    editorialRequirement: requirement, relevantReviewAreas: areas,
    relevantChapterRanges: ranges.map(([startChapter, endChapter]) => ({ startChapter, endChapter })),
    chapterRangesAreExhaustive: false,
    phases: [
      { phase: 'design', status: 'pending', requiredEvidence: '同一设计及计划输入的相关正式报告、全部原始负面与人工争议逐项核对；旧版本或局部通过不能替代。' },
      ...(hasExecution ? [
        { phase: 'chapter_planning', status: 'pending', requiredEvidence: '涉及尚未展开区间时先按窗口生成并复核章纲，明确可验证义务；不能凭宏观节点认定逐章完成。' },
        { phase: 'execution', status: 'pending', requiredEvidence: '本阶段实际采用的正文、候选、原评审输入与原文引证绑定一致；动作、代价、关系、知情及事件逐章核实。' },
        { phase: 'historical_reconciliation', status: 'pending', requiredEvidence: '旧正文/事件保留历史，新当前版本及状态重建一致；不能用旧稿证明新方案，也不能删除失败记录冒充修复。' },
      ] : []),
    ],
    currentlyLinkedExecutionChecks: links,
    linkedChecksAreExhaustive: false, automaticallyClosable: false,
  };
}));
assert.deepEqual([...seen].sort(), all.map(q => q.key).sort());
assert.equal(records.length, 41);
const proof = { kind: 'manual_question_obligations_inventory_not_a_gate_override', observedAt: new Date().toISOString(),
  sourcePath, sourceSha256: hash(bytes),
  productionInputHash: '32f6ca9f61bbb70b8b56a0a7908ca086a0ce1b6ff4554ff3bafdf7428f05465f',
  candidateApplied: false, editorialFamilies: definitions.length, records,
  counts: { records: records.length, withExecutionObligations: records.filter(r => r.phases.some(p => p.phase === 'execution')).length,
    withLinkedChecks: records.filter(r => r.currentlyLinkedExecutionChecks.length).length,
    withoutLinkedChecks: records.filter(r => !r.currentlyLinkedExecutionChecks.length).length },
  productionWrites: 0, modelCalls: 0, questionsResolved: 0, gateChanges: 0, designApproved: false, proseGenerated: false,
  limitation: '人工验收义务清单，不是完整证据索引、生产问卷迁移或正式结论。所列章区间帮助定位，未来来源和实际冲突仍需逐项补全；同名跨文档记录不得自动合并关闭。当前原门禁全部保留。' };
fs.writeFileSync('docs/audits/2026-10-16-design64-question-obligations.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ families: definitions.length, ...proof.counts, questionsResolved: 0, gateChanges: 0 }));
