// Combine offline factual corrections with explicit low-tier artifact controls.
// This prepares a review candidate only; production and the live worker are untouched.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateDesignCandidate} from '../packages/application/src/design-candidate.ts';

const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const knowledgeProof = read('docs/audits/2026-10-18-design76-followup-knowledge-v1.json');
const base = read(knowledgeProof.candidatePath);
assert.equal(hash(base), knowledgeProof.candidateSha256);
const candidate = structuredClone(base);
const controls = {
  art_04: {
    cost: '每次展开前预付操控者本人健康稳定当境法力上限一成，并投入三枚完整下品青灵石，供本次起雾和至多一刻钟持续控雾；玄府记元罡，更高境仍只扣本人的唯一当境法力账。不足一刻钟收罩、展开失败或受扰均不退费，续用须停罩复测并按新一次完整付费。灵石供雾纹、当境法力经手柄供操控，两者不相互折算；本器不以神识外探或可用神识储备控制雾区。',
    limitations: [
      '至少玄府境、能稳定输出适格当境法力者，须先由已经掌握本器者指导认主、持柄导流、起雾、收雾及受控打断训练，经实测记录本人本境稳定控雾半径与时长，晋阶不自动继承熟练度。效用只取该实测半径与十丈总上限、实测时长与一刻钟总上限中各自较小者。没有训练记录、足额法力或三枚可用灵石不得展开。',
      '器身必须始终由本人以手握住实体手柄，通过已练成的接触导流维持固定的环身雾纹；开罩前选定不超过本人实测上限的半径，本次不临时扩张。烟障只以手持者为中心，不远投罩体、隔空指定雾区或分出独立雾团。雾会同样遮住持有者的肉眼，不授予雾中透视、敌我辨认或神识锁定；控雾靠接触柄上的已练导流，不靠看见雾外目标。',
      '持续握持和稳定导流均不可省略。手柄脱手、持有者昏迷、定向失稳、经脉疼痛、法力通路中断、器身受损或主动收罩即停止器生雾纹，器生紫雾随纹失效散去；现场普通烟火、此前已命中的伤害和物理遮挡不被消除，已付供能不返还。',
      '控雾的专注是实际注意力负担，不是另一份数值神识池；不得同时操作另一件需要持续定向的术式。受惊、受击或神魂伤使专注失稳时必须收罩。疲劳须实际休息至定向与握持复测稳定，伤损须经医修确认；等一刻钟或法力回满不自动恢复使用资格。更高境也不能以神识改称接触操控而绕过本器条件。',
      '大风狂飙、暴烈风系法术、持续火焰或大范围水压可吹散、焚散或冲散烟雾；神海境以上修士可凭神念穿透遮蔽，已被锁定者不能借烟罩自动脱离追踪。',
      '烟罩只遮蔽有限区域，不能跨越阵法边界、封锁空间或界门，也不能作为无伤撤退、免疫攻击或替代护体法器。',
      '反制：大风狂飙、暴烈风系法术、持续火焰或水系冲击驱散烟雾；神海境以上神念穿透，或以神魂、范围覆盖和预置阵法绕过视觉遮蔽；近身夺柄、打断握持或供能使其退场。',
    ],
  },
  art_06: {
    cost: '投放前核足本次三成本人健康稳定当境法力：起式先付二成，落环后开始十息以内持续控环前再付一成；玄府记元罡，更高境只扣本人的唯一当境法力账。须修持适格冰系或阴柔功法；控制中断仍扣已开始阶段费用，寒伤另记，不把恢复法力当经脉痊愈。操控依本境已练的可见定向与导流，不另设玄府神识账户，也不用高境神识省略本器可见条件。',
    limitations: [
      '至少玄府境且完成本境认主、可见落点定向、持续导流和主动停术训练者方可使用；须由已掌握本器者指导并经受控打断与经脉复测，记录本人本境稳定控环距离、冻结范围和时长。投放与控环距离取本人实测值与三十丈上限中较小者；环周作用范围取本人实测范围与三十丈上限中较小者，不能晋阶即取满上限。',
      '只能亲手向实际可见的浅水或湿地投放，落点须能让环体至少部分持续露出，且本人能肉眼辨认环体及本次作用边界。不能隔障投放、向不明深水盲掷或靠神识寻找已沉没的环。无适格法力不得发动；无足够可冻结水分最多出现短暂霜层，不保证完成冰封。',
      '起式后环体落定才可开始控环，持续导流至多十息；失去环体或必要边界的视线、目标定向错误、环被击飞或淹没、导流中断、操作者受扰失稳即停术，不能在同一次失控后重新锁定续上。已开始阶段费用不退；未开始的控环阶段不预支其效果。',
      '一次冻结维持至多一刻钟；停止控环或达到时限即不再主动追加冻结或经络寒滞。已经形成的普通冰层按实际温度融化或由实物破开，不能把停术当成瞬间清空冰障，也不能将残冰算作继续禁锢经络的法术。余冰可能滑倒或困住旁人，现场须实际处理。',
      '可见导流依赖清醒、稳定注意力，不是可回充的神识数值池；不兼行另一项持续定向术式。眩晕、受击失准、经脉寒痛即停。疲劳须休息并复测，寒伤和神魂伤另须医修确认；法力补足不替代复核。',
      '被冻结者仍可借护体、火法、破冰器具、腾空或外力救援脱困；对玄府境以上完整元罡只能造成表层寒滞，不能自动禁锢。',
      '在赤霄大陆火山地带威能减退六成，对火属性修士压制力不足；强行在高热区域连续催动会加重持有者经脉寒热冲突。',
      '反制：持续热源与火法融冰，破冰器具或腾空、外力牵引脱离冻区；遮挡落环或必要边界、击飞环体、打断施术者定向与导流，均可阻断主动控制。',
    ],
  },
  art_08: {
    cost: '须用太清一系的当境法力；玄府记元罡，更高境只扣本人唯一当境法力账。起式展开前先付健康稳定法力上限二成，开始十息以内控丝前另付一成，本次完整施用共三成；中断仍付已开始阶段成本，未开始控丝不取得其效果。收拂后至少一刻钟检查银丝与经脉并复测合格才能另起，不能按同一次续交一成无限延长。控制采用已训练的握柄导流与肉眼定向，不以神识账户作玄府隐含资格。',
    limitations: [
      '仅修有太清体系功法且至少玄府境、完成认主者可学习操控；非太清一系法力、旁人灌注或临时伪装均不能稳定催发。须经已掌握本器者指导本境展开、可见导丝、接触卸力和主动停丝，完成受控打断与经脉复测，记录本人本境实际可控范围与时长；晋阶不自动继承。',
      '银丝展开须一个呼吸，范围取本人本境实测稳定导丝距离与百丈总上限中较小者；单次全力卸力或困锁最多十息且不超过本人实测时长。操作者须持续握住实体拂柄，肉眼看清目标、导丝路径及实际接触部位，不能隔墙盲缠、凭神识补看或同时维持另一项定向控术。',
      '目标或必要导丝路径被遮挡、持柄脱手、注意力失稳、供能中断、银丝受创或目标脱离范围即停丝。停术后不再主动卸力、缠紧或追击；原有实体银丝按实际松弛、坠落与缠绕状态处理，必要时须当场解缠，已造成的勒伤和断裂不撤销。普通残丝不封禁境界，不凭失控继续发动困锁。',
      '握持与定向需要实际专注，不是可用神识数值池；受击、眩晕或神魂受创使定向不稳时停术。疲劳须休息至复测稳定，实际伤损须医修确认；冷却届满与法力补足均不自动恢复使用资格。',
      '卸力效果受来力方向、接触面积、银丝完整度与持续供能限制；面对同阶以上持续重击、重型法宝、神魂攻击、空间切割或多点围攻，只能部分缓冲或转移，不能保证持有者无伤。',
      '银丝遭剧烈腐蚀性魔血易受污损，无法抵御虚空裂隙利刃撕扯；污损、断裂后须净化修复，不能在战中无限再生。',
      '反制：腐蚀性魔血、烈焰或空间裂隙切断银丝；多方向持续重击与超出承载的攻势迫使过载；遮挡导丝路径、近身夺柄、冲击心神使定向失稳或位移脱离，均可打断控制。',
    ],
  },
};

const corrections = [];
for (const [id, patch] of Object.entries(controls)) {
  const artifact = candidate.worldPack.artifacts.find(a => a.id === id);
  assert.ok(artifact);
  const before = structuredClone(artifact);
  Object.assign(artifact, patch);
  // Preserve identity, tier, advertised effect and proposal status.
  const restored = {...artifact, cost: before.cost, limitations: before.limitations};
  assert.deepEqual(restored, before);
  corrections.push({id, name: artifact.name, beforeSha256: hash(before), afterSha256: hash(artifact), before: {cost: before.cost, limitations: before.limitations}, after: patch});
}
const restored = structuredClone(candidate);
restored.worldPack.artifacts = structuredClone(base.worldPack.artifacts);
assert.deepEqual(restored, base);
const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true);
assert.equal(validation.blockers.length, 41);
assert.deepEqual(validation.blockers, validateDesignCandidate(base).blockers);
const candidatePath = 'data/design-candidates/design76-followup-controls-v1.json';
const proofPath = 'docs/audits/2026-10-18-design76-followup-controls-v1.json';
assert.ok(!fs.existsSync(candidatePath));
assert.ok(!fs.existsSync(proofPath));
fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + '\n', {flag:'wx'});
const proof = {
  kind: 'design76_unapplied_control_followup_draft', createdAt: new Date().toISOString(),
  workId: knowledgeProof.workId, basePlanId: knowledgeProof.basePlanId,
  expectedInputHash: knowledgeProof.expectedInputHash, inputsSha256: knowledgeProof.inputsSha256,
  previousCandidatePath: knowledgeProof.candidatePath, previousCandidateSha256: hash(base),
  candidatePath, candidateSha256: hash(candidate), corrections,
  inheritedKnowledgeCorrections: knowledgeProof.corrections, validation,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false, blockersClosed: 0,
  limitation: 'Schema-valid offline draft, not a semantic pass. Preserve the live review inputs; consolidate remaining findings and review these control mechanisms before applying.',
};
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', {flag:'wx'});
console.log(JSON.stringify({candidatePath, valid:true, correctedArtifacts:corrections.map(c=>c.id), blockers:41, productionWrites:0}));
