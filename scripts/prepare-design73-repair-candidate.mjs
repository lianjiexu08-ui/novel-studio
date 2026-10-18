// Prepare an unapplied design repair candidate from the current proposed bundle.
// This script reads production state, validates the detached candidate, and writes
// only review artifacts. It never saves a design revision.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaWorkRepository } from '../packages/persistence/src/prisma-repository.ts';
import { validateDesignCandidate } from '../packages/application/src/design-candidate.ts';
import { normalizePlan } from '../novel-service-core/src/planning.ts';

const workId = 'work_8b6c9133e13d404083ca33acc63f4f61';
const candidatePath = 'data/design-candidates/design73-repairs-v4.json';
const proofPath = 'docs/audits/2026-10-18-design73-repairs-v4-candidate.json';
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const clean = value => JSON.parse(JSON.stringify(value));

assert.ok(!fs.existsSync(candidatePath), 'Preserve an existing candidate and inspect it first');
assert.ok(!fs.existsSync(proofPath), 'Preserve an existing proof and inspect it first');

const prisma = new PrismaClient({ datasources: { db: { url: 'file:/Users/lianjie/Documents/ChatGPT/novel/data/novel-studio.db' } } });
const repo = new PrismaWorkRepository(prisma);
const work = await repo.get(workId);
assert.ok(work);
const planRevision = [...work.plans.values()].find(item => item.revision === 72);
assert.ok(planRevision && planRevision.id === 'plan_74b865455f7d453582f4959b9a2d3d17');
assert.equal(work.worldPack.revision, 37);
assert.equal(work.storyBible.revision, 69);

const worldPack = clean(work.worldPack);
const storyBible = clean(work.storyBible);
const plan = clean(planRevision.plan);
const chapter = n => plan.chapters.find(item => item.chapterNumber === n);
const bibleChapter = n => storyBible.chapterPlans.find(item => item.chapterNumber === n);
const milestone = id => plan.milestones.find(item => item.id === id);
for (const n of [29, 30, 31, 33, 48]) {
  assert.ok(chapter(n), `chapter ${n}`);
  assert.ok(bibleChapter(n), `bible chapter ${n}`);
}
for (const id of ['ms_v2_boundary', 'ms_v3_training', 'ms_v3_advancement', 'ms_v3_convoy']) assert.ok(milestone(id), id);

// 1. Close the physical route permit and port-payment ledger.
chapter(29).scenes.push(
  '大乾山路通行预登记：211日签约时，灵虚古境入口外营登记书吏韩叙把本批联名符牌、林辰凝元三重实测、四名承运人员和六箱封号预录入DGY-212-214申请；实际签发和两次验放留到第30章212日卯初以后，避免把未来手续写成第29章已经完成。',
);
chapter(30).scenes.push(
  '山路验放执行：边驿签发人顾衡不随车移动；白榆驿驻站验放吏邹廉在212日晚核对副联与林辰手中文牒的姓名、六箱封号、效期和车队人数，云梦北驿驻站验放吏沈度在213日晚再次盖验。任一不符只能停驿补件，不能凭护货合同或境界直接进港。',
);
chapter(31).scenes.push(
  '云梦港务费用账：第214日午前，万象商盟云梦天港验籍柜台按港务规章收取本航次验籍费两枚下品青灵石、受潮封签复验费半枚；程记承运账户由程砚预签授权，承运人当面从该账户实付验籍费，普通舱/船费四枚已在211日以林辰六枚基础劳务报酬中的四枚抵扣，受潮复验费半枚从余下二枚中扣除，副本分栏列出林辰最终可领一枚半。林辰不垫付、不把商盟引荐当作免检，拒付则不得登船。',
);
chapter(31).scenes.push('港务凭证账：万象商盟云梦天港验籍司书许衡在214日午前签发YT-214-6港务验籍单，覆盖林辰、李守成、赵达、宋槐四人、六箱药材和本航次船舱，凭证有效至216日晨卸货复核；港务放行旗号由许衡与当班领航员共同盖印，受潮封签复验由同一验籍单分栏登记。无YT-214-6或旗号未盖印不得登船，商盟引荐只附在申请栏，不替代港务许可。');
for (const [n, text] of [[29, '大乾山路文牒与验放责任已在本章执行账固定：韩叙代办、边驿主簿顾衡签发DGY-212-214，212日卯初至214日午前有效；文牒明确林辰、李守成、赵达、宋槐四人和六箱封号，白榆驿驻站验放吏邹廉、云梦北驿驻站验放吏沈度分别验副联，顾衡不随车跨站。工本与两次验放费一枚下品青灵石由程记承运账户预付并从承运服务费栏扣回。'], [30, '山路两处验放必须逐项核对四名人员、六箱封号、效期与车队人数；任一不符只能停驿补件，不能以商盟引荐、凝元境界或护货合同替代文牒。'], [31, '云梦港务验籍费两枚下品青灵石由程记承运账户按程砚预签授权现场实付；普通舱/船费四枚已在211日从林辰六枚基础劳务报酬抵扣，复验费半枚再从余款扣除，林最终可领一枚半，验籍、复验、船费分栏并由双方副本签认。']]) {
  bibleChapter(n).requiredEvents.push(text);
}
bibleChapter(29).requiredEvents.push('文牒预登记范围固定为林辰、车夫李守成、工役赵达与宋槐共四人；名单、人数和六箱封号先写入DGY-212-214申请联，实际原件签发、两站盖验与港务放行留到第30—31章，离队或增员须重办。');
bibleChapter(30).requiredEvents.push('顾衡只负责边驿签发，邹廉与沈度分别是白榆驿、云梦北驿的驻站验放吏，三人不在同一时段跨站瞬移或重复办理。');
chapter(31).scenes.push('普通舱结算账：本航次普通舱/船费定额四枚下品青灵石，211日签约时列入护货合同；基础护货劳务报酬六枚，先抵舱费四枚，受潮复验费半枚再从余款扣除，214日登船前承运人和林辰在合同副联签明“舱费已结、无现金欠款”，林辰最终可领一枚半，加急奖金一枚因第30章封签争执已明确不发。');
bibleChapter(31).requiredEvents.push('普通舱/船费四枚下品青灵石在211日合同中定额列出，以林辰六枚基础劳务报酬中的四枚抵扣；复验费半枚从余下二枚扣除，214日副联签认林辰最终可领一枚半，无免费舱位或未来收入预支。');
bibleChapter(31).requiredEvents.push('214日午前由云梦天港验籍司书许衡签发YT-214-6港务验籍单，覆盖四名承运人员、六箱药材和本航次船舱，许衡与当班领航员共同盖放行旗号，凭证有效至216日晨卸货复核；无单无旗不得登船。');

// 2. Make the Xuanfu advancement gate executable and ordered.
const realm03 = worldPack.realms.find(item => item.id === 'realm_03');
assert.ok(realm03);
const dahan = worldPack.factions.find(item => item.id === 'fac_02');
const merchants = worldPack.factions.find(item => item.id === 'fac_08');
assert.ok(dahan && merchants);
dahan.goals.push('大乾边驿只负责境内实体山路文牒的签发与验放，文牒按人员、货物、效期和车队逐项登记；边驿不授予商盟免检或跨境通行权。');
merchants.goals.push('万象商盟云梦天港柜台负责港务验籍、封签复验、泊位和船费结算；商盟引荐只证明承运关系，费用须由具名承运账户或合同劳务实际结清。');
realm03.prerequisites = [
  '辟建丹府：须完成tech_19《凝元分流入府诀》的三段分流训练，使用六枚下品青灵石作为六个十日训练周期的实际导引耗材；每一周期前后由医修复查经脉，训练中断或丹府回流即停，不得用预计寿储代替资源。',
  '丹府完成后须静置一日，由白榆确认丹府稳定、伤情可承受、元罡通路未反噬，再由顾峤复核可用元罡与普通器物承载；两项确认均完成后才可支付玄府十元载。'
];
assert.ok(!worldPack.techniques.some(item => item.id === 'tech_19'));
worldPack.techniques.push({
  id: 'tech_19', name: '凝元分流入府诀', kind: 'technique', tier: '玄阶',
  allowedRealmIds: ['realm_02'],
  effect: '将已稳定的凝元真元分成三路，沿经脉节点在体内构筑丹府雏形；只提供辟建丹府的训练路径，不产生玄府元罡、凌空虚渡或其他越境能力。',
  cost: '每个十日周期实际消耗一枚下品青灵石的导引灵气并占用每日一小时静修；六周期共六枚，耗材开封即扣，失败或中断不返。训练期间仍须饮食、睡眠和医修复查，不能把静修时长或灵石投入当作寿储收入。',
  limitations: [
    '须凝元三重且经医修确认经脉无急性伤，先完成第一段分流再进入第二、第三段；凝元低重、伤势恶化或定向失稳即停。',
    '每周期结束须记录三路真元的流向、余量和是否回流；出现胸闷、经脉灼痛、丹府塌缩或余量低于医嘱下限，立即停止并等待复诊。',
    '完成六周期只取得丹府稳定雏形的训练资格，不自动晋入玄府；须静置一日、白榆诊察和顾峤承载复核均通过，才可按realm_03支付十元载。',
    '本诀不能以赤霞斩铁剑、灵泉或旧有寿储替代六枚灵石和诊察，也不能在玄府之后倒推林辰此前已经掌握元罡。',
  ],
  counters: ['经脉回流与丹府塌缩', '医修判定伤情不允许继续分流'], status: 'proposed',
});
const training = milestone('ms_v3_training');
training.setup.push(
  '丹府训练执行卡：第316日肩伤复诊后只恢复低负荷吐纳；第331–340日完成周期1，第341–350日完成周期2，第351–354日进入周期3但第354日发生分流回流，周期3耗材报废、周期不计入有效六周期；第355–364日重做有效周期3，第365–374日周期4，第375–384日周期5，第385–394日周期6，六个有效周期各实耗一枚下品青灵石。第395–410日只做复诊、静置和丹府稳定观察，不再开始新的十日周期；完成前不安排玄府元罡或第83章晋阶。',
);
const advancement = milestone('ms_v3_advancement');
advancement.setup[0] = '第395–414日只做六周期后的静置、丹府稳定观察和普通木柄空载复测，不新增训练周期；第415日白榆当面确认丹府已稳定成形、经脉无回流、伤情可承受，顾峤随后复核林辰能够承载玄府元罡且普通木柄测试不反噬。只有这两项确认都记录为通过，才在同一日按realm_03实际支付十元载；支付先后为“六个有效周期完成→静置观察→白榆诊察→顾峤复核→十元载扣除”，任何一项失败都延期且不预支寿储。';

// 3. Define the low-flow trial as an independent diagnostic, with a fixed ledger.
chapter(48).scenes.push(
  '低流量试注规则：这是赤霞斩铁剑的独立器身诊断，不是乾元御风剑诀起式，不放风刃、不锁定目标、不进入剑诀的施式冷却；须先确认凝元三重、剑身已冷却、林辰握持无痛且医修允许。试注固定消耗本人当时健康稳定真元上限的半成，开阀即扣，失败、提前停或器身无响应均不退；试注成功也只记录器身能否稳定导流，下一次完整剑诀仍须另付二成并重新满足目标、距离、专注和冷却条件。试注后的半成余量写入本章执行账，不把它算成恢复或额外剑诀支出。',
);
for (const n of [48]) bibleChapter(n).requiredEvents.push('低流量试注是独立器身诊断：固定半成真元，开阀即扣，失败或提前停不退；不放风刃、不触发乾元御风剑诀冷却，完整剑诀仍须另付二成并重新满足锁定、专注与冷却条件。');
chapter(48).endState += ' 低流量试注的半成是独立器身诊断成本，不产生风刃、不触发乾元御风剑诀冷却；完整剑诀仍按二成法力和原有冷却规则另行验收。';

// 4. Add explicit execution cards for the two later counter windows.
milestone('ms_v2_boundary').setup.push(
  '第61–66章反制动作卡（逐场验收）：第64章林辰只对一丈内、肉眼直视、无灵纹粗麻绑门绳发一式乾元御风剑诀，目标后方两丈刃路由港卫清空；一次二成凝元真元，最多一道风刃，切中或失锁后立即停，剑热、伤情和余量均记录。船摆、舷板遮挡、有人进入刃路或港卫未完成退离即取消起式，已付不退；不得切浮台系泊、货物吊具或以风刃托人。夜凝霜只用普通脚步和实体剑守侧巷，近身打断依港卫人数与站位解决；林停术后由两名港卫逐人扶板，失败分支是改用既有小艇接送并让程先离泊，不能靠术式自动救出。',
);
milestone('ms_v2_boundary').setup.push('第61–66章其余反制边界：第61–63章仅是港卫封存、夜与林贺的普通步行和舱外观察，不安排第二次施术或近身对打；第65–66章仅是停术后的普通接人、验簿和交接，不追击程的小艇。若新增独立攻击场面，必须先补同样的目标、材质、距离、费用、打断和撤退卡，不能从本动作卡外推。');
milestone('ms_v3_convoy').setup.push(
  '第88–95章反制动作卡（逐场验收）：第436日林辰面对一名既有玄府押卫及普通短刀，先在车角外三息间隔内聚一息局部护罡，每次聚罡一成、受击一成，至多三次；每次有效距离只限车角至下一车角的可见短线，普通车架遮挡和退步是撤离条件，护罡不覆盖31分钟转运、不保证挡住第三次刺击。第三次被穿后肩伤即停，余二成封存；顾峤只对祁嵩开一次掌大局部护罡，聚一成、受击一成后停，不施真光、不施推劲。苏、梁九和救护队的切门、扶人、两趟货车转运均在停斗交械后用普通工具完成。对手重新聚罡、车门落锁、待接点失守或伤者无法行走时，立即退回原位并呼具名玄府接应；不得把属性克制、已付成本或车角遮挡写成必胜。',
);
milestone('ms_v3_convoy').setup.push('顾祁距离与材质卡：顾与祁在前车右侧普通车角相距三丈内、肉眼互见，车架只遮住腰以下；祁用无灵纹普通短铁刀从顾右肩外侧斜擦至左前臂，顾掌大护罡仅覆盖左前臂外侧一掌至肘前，先聚一息再承受刀背擦击，刀刃未穿过护罡，随即散罡。祁第二次试探改刺车角外沿，车角遮住刀尖或顾失去可见路径即双方退到下一车角，不追加护罡；停斗触发条件是前车四人已下车、祁亲见程离场且原令被苏当面封存。第437章以后只写包扎和交接，不另开追击。');

// 5. Remove the chapter-33 knowledge leak and preserve the actual later sources.
bibleChapter(33).endHook = '217日晚，林只确认正式仓四箱完好、一箱水损、程记未完成接货签认，六号箱去向未知；他尚不知道严涛身份、常钧搬箱或陆沉川接走重箱，也没有从侧门独立视角获得这些信息。第34章由常钧当面说明暂存与抬箱，第35章取得侧门册后才逐步核对去向。苏在外门见旧夜班交接并去看顾伤，林在第41章收到实体来信前不知道她返宗结果。';
chapter(33).scenes.push('知识边界修复：本章侧门视角只属于读者与独立角色，不能回写林辰的endHook或当晚认知；林辰只能把程记未签收、正式仓现状和六号箱未知写入自己的交班记录。');
bibleChapter(33).requiredEvents.push('知识边界修复：本章侧门视角只属于读者与独立角色，不能回写林辰的endHook或当晚认知；林辰只能把程记未签收、正式仓现状和六号箱未知写入自己的交班记录。');

const normalizedPlan = normalizePlan(plan);
const candidate = { worldPack, storyBible, plan: normalizedPlan };
const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true, JSON.stringify(validation.issues, null, 2));
assert.equal(validation.formalAcceptance, false);
const inputHash = hash({ workId, basePlanId: planRevision.id, candidateHash: hash(candidate) });
const proof = {
  kind: 'design73_repairs_unapplied', createdAt: new Date().toISOString(), workId,
  basePlanId: planRevision.id, basePlanRevision: planRevision.revision,
  currentRevisions: { world: work.worldPack.revision, storyBible: work.storyBible.revision, plan: planRevision.revision },
  candidatePath, candidateSha256: hash(candidate), inputHash,
  changes: [
    '第29—31章补齐大乾山路文牒签发/验放、有效期、具名付款账户与云梦港务验籍/复验费用分栏账。',
    '新增tech_17凝元分流入府诀，明确六周期灵石耗材、训练失败、静置、白榆诊察、顾峤复核和十元载支付顺序。',
    '第48章将低流量试注定义为独立器身诊断，固定半成成本和与剑诀冷却的关系。',
    '为第61—66、88—95章加入逐场对象、材质、距离、可见路径、费用、打断、伤后余量和撤退动作卡。',
    '删除第33章林辰未获实体来源的严涛/程砚知情表述，并固定第34、35章的实际来源。',
  ],
  validation: { valid: validation.valid, warnings: validation.warnings, blockers: validation.blockers },
  formalAcceptance: false, proseGenerated: false, productionWrites: 0,
  limitation: '候选尚未写入生产，也未关闭历史 blocker；须经局部模型复审和新的四领域评审。',
};
fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidatePath, proofPath, candidateSha256: proof.candidateSha256,
  validation: { valid: validation.valid, blockers: validation.blockers.length }, formalAcceptance: false, productionWrites: 0 }));
await repo.disconnect();
await prisma.$disconnect();
