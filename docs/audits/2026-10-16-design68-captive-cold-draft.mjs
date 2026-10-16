// Create an unapplied story proposal. This is authoring, not a recovered fact or
// a replacement for the formal review currently running against Plan68.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePath = 'data/design-candidates/design64-motivation-wording-draft-v11.json';
const sourceBytes = fs.readFileSync(sourcePath);
assert.equal(sha(sourceBytes), 'ec7d90cb870f6d35f9cfc9d1c95cc21169f97bf856940f8ef8bf2a70273c19be');
const baseline = JSON.parse(sourceBytes), candidate = structuredClone(baseline);
const milestone = candidate.plan.milestones.find(m => m.id === 'ms_v2_boundary');
const additions = [
  '获救前押运的新增作者提案，尚须整体验收：七名青玄籍矿工本次随原目标货船于285日晨从赤霄极焱天港出发，走loc_21既有五昼夜实体航线，290日晨到葬骨受监管泊区，原定291日转运。与程272日另船出发、277日到北境的行程分开，不写成同船追逐。本段从285装船至291开舱约六日连续在同一舱受扣，不把七人在更早时期的全部遭遇写成已经查清。极焱装船只走当班港务实核开放、无异常地火的普通货道，七人各佩船方当面配发并核余纹的art_16；离开赤霄日常热区、转入经实测温暖的舱内后，由值班船工摘封收回七符并逐张记余量，不把避火符当防寒符。',
  '该普通货舱靠现成隔风舱壁、固定隔火炉与通到舱外的烟道保温，没有法术结界；船方为把活劳力交付换取运费而维持最低食宿，并非善意释放。285出港前原船长与当班船工实查炉道通畅、舱内通风、两名原船工轮班和七日燃料、粗食饮水实际装载；从海路转寒前到291救援接管期间持续添料，夜班也不空岗。燃料分日领用，剩余仍是原船方库存，烧过的不再入账。七人留在同一实暖舱内，不在冷甲板轮换、不靠凡衣或不明境界耐寒；290泊港后仍用本船余料供暖，不能把靠港当成有免费岸上热源。近舱港卫开门时实际核热源、烟道和呼吸状况，在舱内逐人换穿救助干衣、扣新寒符，确认后才过板；船方已收回的避火符不抵救济寒符数。暖炉不能替代饮水、治疗伤口或证明七人无病，首检和292复查仍按原安排逐人进行。若此前炉道堵塞、燃料断供或人已出现重度失温，必须据实改变伤情和救助预算，不能继续套用正常路径的轻症结果。',
  '原船方的本航次小账独立于程的残片、林贺14000航款和港务救济240：285装船前原船长从本船此前实收的普通货运预付款余额160中，当面付极焱原登记门市七张art_16共42，逐张验实物与余纹至少覆盖本次港内作业；付本港燃料行七日普通炉料14、两名原船工七日轮班补工28、七人七日粗食饮水17，合101，现金余59仍属船方。燃料与食品实装、工钱由两人签收，报价仅指本船这次采购，非通用物价；船长保留原货运收款联和四项支出联，收款不得重复列成程或主角的新收入。七符本次交付已完成制成和验收，供能在符内，不再给佩戴者扣一枚灵石。供暖只保障实际封闭舱内，煤料、船工或食水任何一项未兑现就不能声称六日正常度过。',
  '监管与知情的新增提案：船方把七人列作随船劳役，对两港均隐瞒强迫扣留；本航次实际舱单、到港签注只能证明这艘船获准到指定受监管泊区，不能证明七人自愿或拘禁合法。290到港岗未逐人私下问询，并被外锁和船方代答遮蔽扣人事实，此为本案具体漏查，不能写成全港默认准许扣工。291行动前，原巡检港卫在外锁舱口听到“七个人被扣住”的求救，见外绑绳后回近处值岗当面报告；港务据此先按七人实备原定救助包，口头报数此时只是救助需求，待开舱才逐人核实。夜与原两名港卫到位控制侧巷，近舱港卫按既定开扣顺序接人，不先把呼救当作全链定罪。救援后逐人分开问询，将七人的亲历与船上原航簿、炉料领用、轮班和收支联交叉核对；林只亲见现场，未读到的航程或账目不自动成为他的知识。船方单据可伪造，七人口供也各有范围；不相符部分保留待查，不因此追认入境自愿或全链已经破案。相关原件由当地港务封存，林贺既有随行见证副本只记录本次救助与已核部分，不凭本草案新增全知货运证据。',
];
milestone.setup.splice(2, 0, ...additions);
milestone.cost += ' 获救前供给另由原船方普通货运预付款160承担本次101支出、余59；实物余料及已用符余纹另存，不挪救济240或林贺14000。此为新增待审作者提案，非从旧正文确认的账目。';

// Prove the draft has not expanded the novel or silently rewritten other parts.
const restored = structuredClone(candidate);
const restoredMilestone = restored.plan.milestones.find(m => m.id === milestone.id);
restoredMilestone.setup.splice(2, additions.length);
restoredMilestone.cost = baseline.plan.milestones.find(m => m.id === milestone.id).cost;
assert.deepEqual(restored, baseline);
assert.equal(candidate.plan.chapters.length, 50);
assert.equal(candidate.plan.targetChapterCount, 100);
assert.equal(candidate.plan.volumeCount, 3);
assert.equal(160 - 42 - 14 - 28 - 17, 59);
const candidatePath = 'data/design-candidates/design68-captive-cold-draft-v12.json';
const output = JSON.stringify(candidate, null, 2) + '\n';
const proof = {
  kind: 'unapplied_captive_cold_author_proposal', observedAt: new Date().toISOString(),
  baseInputHash: '3274d4710800ad02565040a341a05177b4bd7cab363e169219b562a4a0f62d01',
  sourcePath, sourceSha256: sha(sourceBytes), candidatePath, candidateSha256: sha(output),
  changedPaths: ['plan.milestones[ms_v2_boundary].setup', 'plan.milestones[ms_v2_boundary].cost'],
  proposedAdditions: additions, proposedCost: milestone.cost,
  preservedOtherFieldsExactly: true, detailedChapters: 50, macroChapters: 100, volumes: 3,
  modelCalls: 0, productionWrites: 0, questionsClosed: 0, formalAcceptance: false,
  remainingValidation: [
    'Await all four current formal reviews; combine further findings before applying a new candidate.',
    'Review the newly authored voyage, funding, seven-person protection, inspection failure and knowledge boundaries against all linked materials.',
    'Check request capacity after combining edits; this draft has not received a fresh model review.',
    'Only after the combined draft is validated, rehearse atomic persistence in an isolated database and re-review changed design inputs.',
  ],
};
fs.writeFileSync(candidatePath, output, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-captive-cold-draft.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidatePath, candidateSha256: proof.candidateSha256,
  changedPaths: proof.changedPaths, preservedOtherFieldsExactly: true, productionWrites: 0, formalAcceptance: false }));
