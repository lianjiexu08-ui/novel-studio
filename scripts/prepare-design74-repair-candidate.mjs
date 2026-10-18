// Detached design74 edits. This command never writes production state.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateDesignCandidate} from '../packages/application/src/design-candidate.ts';
import {normalizePlan} from '../novel-service-core/src/planning.ts';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const baselinePath = 'data/design-candidates/design74-baseline.json';
if (process.argv.includes('--export-baseline')) {
  assert.ok(!fs.existsSync(baselinePath), 'Preserve the existing editing baseline');
  const {PrismaClient} = await import('@prisma/client');
  const {PrismaWorkRepository} = await import('../packages/persistence/src/prisma-repository.ts');
  const {ChapterWorkflow} = await import('../packages/application/src/index.ts');
  const prisma = new PrismaClient({datasources:{db:{url:`file:${process.cwd()}/data/novel-studio.db`}}});
  const repository = new PrismaWorkRepository(prisma);
  try {
    const workflow = new ChapterWorkflow(repository, {generateChapter(){throw Error('No prose during design repair');}});
    const editing = await workflow.designCandidate('work_8b6c9133e13d404083ca33acc63f4f61');
    assert.equal(editing.candidate.worldPack.revision,38);
    assert.equal(editing.candidate.storyBible.revision,70);
    fs.writeFileSync(baselinePath,JSON.stringify(editing,null,2)+'\n',{flag:'wx'});
  } finally { await repository.disconnect(); await prisma.$disconnect(); }
}
const baseline = JSON.parse(fs.readFileSync(baselinePath));
const original = baseline.candidate;
assert.equal(original.worldPack.revision, 38);
assert.equal(original.storyBible.revision, 70);
const candidate = structuredClone(original);
const {worldPack: world, storyBible: bible, plan} = candidate;
const ch = n => plan.chapters.find(x => x.chapterNumber === n);
const bc = n => bible.chapterPlans.find(x => x.chapterNumber === n);
const ms = id => plan.milestones.find(x => x.id === id);
const changes = [];
function replace(obj, key, from, to) {
  assert.equal(typeof obj[key], 'string');
  assert.equal(obj[key].split(from).length, 2, `Expected exactly one occurrence: ${from}`);
  changes.push({from, to}); obj[key] = obj[key].replace(from, to);
}
function replaceItem(items, from, to) {
  const matches = items.map((s,i) => s.includes(from) ? i : -1).filter(i => i >= 0);
  assert.equal(matches.length, 1, from); replace(items, matches[0], from, to);
}
const permit = '出港单记载214日四人与六箱的离港申报，仅供本航次出港及目的港核对，效期至217日午前，覆盖正常216日暮靠泊与217日晨卸货；不授予目的港免检、内陆或界门通行权。216日暮须由目的港当班验籍员核当日旗号、借符效力、四人身份和实到箱数，217日晨再核卸货实数并接收归还借衣借符；正常实到五箱，其中四箱完好、一箱水损，第六箱缺失须登记待查，不能拿六箱申报证明六箱到货。迟至217日午前仍未核完则停在港方指定待验区，补办获准后方可继续卸货放行；到期不自动续签，也不延长借符效力';
replaceItem(ch(31).scenes, '凭证有效至216日晨卸货复核', permit);
replaceItem(bc(31).requiredEvents, '凭证有效至216日晨卸货复核', permit);
const realm = world.realms.find(x=>x.id==='realm_03');
replace(realm.prerequisites, 0, '使用六枚下品青灵石作为六个十日训练周期的实际导引耗材', '至少使用六枚下品青灵石完成六个有效十日周期；每个开封失败周期另损一枚，实际库存不足则延期');
const tech=world.techniques.find(x=>x.id==='tech_19');
replace(tech, 'cost', '六周期共六枚', '六个有效周期至少六枚，每个失败或中断的开封周期另耗一枚；本卷一次失败加六个有效周期实际共耗七枚');
const training=ms('ms_v3_training');
const oldCard=training.setup.find(s=>s.startsWith('丹府训练执行卡：'));
assert.ok(oldCard);
replaceItem(training.setup,oldCard,
'丹府训练执行卡：316日复诊仅许低负荷吐纳及无痛坐姿抄录，不许搬货和分流。330日白榆确认肩伤、经脉可承受后才准331日开周期1；331–340为有效1、341–350为有效2。351开第三枚，354出现胸闷与回流立即停练，当日白榆检查并停训，第三枚报废不退、该周期不计有效；355–357仅休息及遵医嘱观察，357复诊须胸闷消失、经脉无急性反应、轻度导引无回流才准358重开，不能因休满三日自动许可。358–367有效3、368–377有效4、378–387有效5、388–397有效6，分别开第四至七枚。每周期开始前和结束后都由白榆当面复查肩伤、经脉流向、余量及回流：330/340、341/350、351/354失败、357准复练后358行前再核/367、368/377、378/387、388/397；每次未通过立即停，不把上次许可无限沿用。六个有效周期60日，加失败4日，实耗七枚；398日完整静置一日，399–414日只做复诊、稳定观察和获准的空载复测。所有日期是正常复诊通过的候选路径，任何异常或耗材不足均顺延训练、415日拟晋阶及后续参战资格，不能追赶固定日期。');
training.setup.push('训练资源执行账（本次具体劳务约定，不是全境统一物价）：316日白榆只允许无痛坐姿抄录，林与修缮库当面约定318–329日十二日、每日两小时核对旧库存抄本，验收合格每日两枚下品青灵石，330日按实际完成的十二日一次结清24枚。此项为既有修缮技能的短期补账劳务，与矿务署拖欠工钱分开，付款来自修缮库既有当期劳务预算，不支用贺小满待归还的220旅资。330日实领后，3枚偿付316–329药舍普通食宿及常规复诊的既有约定欠款，14枚按药舍本次约定预付330–415普通食宿和上述常规复查，剩余7枚完整灵石验纯后单独入训练库存，不再交易或抵费。药舍约定不含新增药石、急伤处置和延期食宿；354回流如检查需额外药物或急救，先停训核实费用与新来源，不能挪已消耗灵石或免费治愈。轻役致痛即停，少做一天不发当天报酬，结算不足先清既有欠款并核后续食宿，耗材凑不足则不开周期。正常轻微回流经医修判断只需停练观察，才能沿上述七枚预算继续；不存在无条件康复。此账在作者侧校验，正文呈现接活、实领、一次失败与重启选择，不逐条展示行政账单。');
replace(ms('ms_v3_advancement').setup,0,'第395–414日只做六周期后的静置','第398–414日只做六周期后的静置');
replace(ch(42),'cost','沿用215日行动后保守余量五成','沿用第32章第215日风暴御物后的保守余量五成（本章试注实际在第239日，不把余额来源日期当作本次行动日期）');
const diagnostic='第239日低流量试注沿用独立器身诊断规则：凝元三重、剑已冷却、握持无痛且医修允许才开阀；固定半成真元开阀即扣，失败或提前停不退，不放风刃、不锁定目标、不触发剑诀施式冷却。后续完整剑诀仍另付二成并重新满足锁定、距离、专注与冷却条件。本次试注后四成半，经实际一小时温和吐纳复测仅回半成至五成，不新增第二次恢复。';
ch(42).scenes.push(diagnostic);bc(42).requiredEvents.push(diagnostic);
const team='职责区分：181–183日林苏是先行采集勘路队，按本批符牌行普通山路；褚衡、邵闻是186日才出发的后半期换班守卫，188日暮到外营接班，不是先行队护送者。顾峤与杜砺在183日固定入口交接守口岗位，顾不离入口陪林苏走三日山路，入境后也不随二人深入采集支路；顾在外营催队伍安顿发生于二人到达后。';
ch(19).scenes.push(team);bc(19).requiredEvents.push(team);
replace(ch(18),'summary','只承诺按期护送','只承诺按期赴外营接替守口');
const convoy=ms('ms_v3_convoy');
replaceItem(convoy.setup,'苏、梁九和救护队的切门、扶人、两趟货车转运均在停斗交械后用普通工具完成','前车由苏在短暂牵制中肉身拔普通插销开门、救护人员先扶出四人到侧道待接点；不切门、不施术托人。后车开门和梁九两趟货车转运仅在祁实际停斗交械后进行');
replaceItem(convoy.setup,'停斗触发条件是前车四人已下车、祁亲见程离场且原令被苏当面封存。第437章以后','停斗选择发生在前车四人已下车、祁亲见程离场、身份已被见证且现场发生门伤之后；此时原令仍在祁手中。祁权衡具名押报责任后下令停斗、交械，随后才亲交原令由苏当众封存，不能用尚未发生的封存倒推停斗。第437日以后');
candidate.plan=normalizePlan(plan);
const validation=validateDesignCandidate(candidate), prior=validateDesignCandidate(original);
assert.equal(validation.valid,true,JSON.stringify(validation.issues));
assert.deepEqual(validation.blockers,prior.blockers);assert.equal(validation.blockers.length,41);
for(const [key,field] of [['worldPack','unresolvedQuestions'],['storyBible','unresolvedQuestions'],['plan','openQuestions']]) assert.deepEqual(candidate[key][field],original[key][field]);
assert.equal(ch(28).endState,original.plan.chapters.find(x=>x.chapterNumber===28).endState);
assert.equal(ch(32).endState,original.plan.chapters.find(x=>x.chapterNumber===32).endState);
const candidatePath='data/design-candidates/design74-repairs-v1.json';
const proofPath='docs/audits/2026-10-18-design74-repairs-v1-candidate.json';
assert.ok(!fs.existsSync(candidatePath)&&!fs.existsSync(proofPath));
fs.writeFileSync(candidatePath,JSON.stringify(candidate,null,2)+'\n',{flag:'wx'});
const proof={kind:'design74_unapplied_candidate',createdAt:new Date().toISOString(),workId:'work_8b6c9133e13d404083ca33acc63f4f61',baselinePath,basePlanId:baseline.basePlanId,expectedInputHash:baseline.expectedInputHash,baseCandidateSha256:hash(original),candidatePath,candidateSha256:hash(candidate),changes,validation,productionWrites:0,formalAcceptance:false,proseGenerated:false,blockersClosed:0};
fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({candidatePath,proofPath,hash:proof.candidateSha256,valid:validation.valid,blockers:validation.blockers.length}));
