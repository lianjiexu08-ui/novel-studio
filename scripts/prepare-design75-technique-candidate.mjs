// Detached repair of the acquisition gap independently confirmed on design74.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {validateDesignCandidate} from '../packages/application/src/design-candidate.ts';
import {normalizePlan} from '../novel-service-core/src/planning.ts';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const applied=JSON.parse(fs.readFileSync('docs/audits/2026-10-18-design74-repairs-applied.json'));
const reviewBase=JSON.parse(fs.readFileSync('data/audit-runtimes/design74-review/baseline.json'));
const prior=JSON.parse(fs.readFileSync(applied.candidatePath));assert.equal(hash(prior),applied.candidateSha256);assert.equal(reviewBase.planId,applied.appliedPlanId);
// Rebuild the exact server-stamped proposal already verified by --verify v1.
const base=structuredClone(prior);Object.assign(base.worldPack,{revision:39,status:'proposed'});Object.assign(base.storyBible,{revision:71,status:'proposed',worldPackRevision:39});
const candidate=structuredClone(base),tech=candidate.worldPack.techniques.find(t=>t.id==='tech_19'),training=candidate.plan.milestones.find(m=>m.id==='ms_v3_training');assert.ok(tech&&training);
tech.limitations.push('本诀原本由太清外门教习室保管，凝元三重只满足修行门槛，不自动取得文本或授业资格。教习室可在本期外门复训名额内，以事先明确且已验收的宗门劳务交换受限借阅和教习指导；须由获本期授权的教习实际借出凝元前置页、授课并收回原本。学员不得私传、把教材当个人财物或据此使用玄府战斗术；已有合法学习资格也不豁免逐周期医修复查。');
const i=training.setup.findIndex(s=>s.startsWith('训练资源执行账'));assert.ok(i>=0);
const from='验收合格每日两枚下品青灵石，330日按实际完成的十二日一次结清24枚。';
assert.equal(training.setup[i].split(from).length,2);
training.setup[i]=training.setup[i].replace(from,'验收合格每日现金两枚下品青灵石，330日按实际完成的十二日一次结清24枚。');
training.setup.push('同一份劳务约定还列一次本期tech_19受限借阅及六个有效周期的基础指导名额，须完成全部十二日且医修准许后才能兑现。现金24枚与课程是同一合同的两个报酬项，不把一份劳务再次换出第二笔钱；未完成只结已做天数现金，课程延期补足合格劳务后再核准。');
training.setup.push('法门来源与授课安排（作者侧前置，正文以争取复训和师徒授课场面呈现）：317日林向顾峤申请tech_19。太清外门教习室已将本期凝元三重学员的前置复训交顾负责，顾凭本期教习授权与修缮库当面确认上述劳务及课程约定，原本仍归教习室；这份授权只到本诀凝元前置，不授其他高阶法门。330日实际完成劳务验收、结清现金且白榆诊准后，顾从教习室取出登记原本，在本人值守的药舍授课位把凝元前置页借林阅读，当面讲第一段分流路径和必须停练的症状；林逐项复述，理解有误则继续教学、不开331周期。借阅只在顾在场时进行、当次课后原本收回，不赠原本、不向林另赠寿储或灵石。顾的授课是本期教习职责的实际工时，课程对价是已完成劳务，不另收挤占七枚耗材或食宿预算的未约定学费。');
training.setup.push('三段学习与有效周期对应：330日先学第一段，331–340与341–350两个有效周期依序练第一段；351开始前顾当面讲第二段、林复述通过并经白榆行前复查后才开第三枚，354失败立即停训。355–357不得自行看诀抢练；357复诊准许后，358行前顾重讲回流处置并确认林能复述，白榆再核才重开，358–367和368–377构成第二段两个有效周期。378开始前顾同样借页讲第三段，复述和医修许可都通过后才做378–387、388–397两个有效周期。354失去本次护运遴选机会，不抹掉此前已完成劳务所得的基础复训名额；借阅和训练仍因伤暂停，只有复诊通过才恢复。任一讲解、复述或复诊未完成均顺延，不能只因既定开练日到来就算学会；六周期掌握仍须实际训练，不以背会口诀自动成功。');
candidate.plan=normalizePlan(candidate.plan);
const validation=validateDesignCandidate(candidate);assert.equal(validation.valid,true,JSON.stringify(validation.issues));assert.deepEqual(validation.blockers,validateDesignCandidate(base).blockers);assert.equal(validation.blockers.length,41);
assert.deepEqual(candidate.storyBible,base.storyBible);assert.deepEqual(candidate.plan.chapters,base.plan.chapters);
const basePath='data/design-candidates/design75-baseline.json',candidatePath='data/design-candidates/design75-technique-v1.json',proofPath='docs/audits/2026-10-18-design75-technique-v1-candidate.json';
for(const p of[basePath,candidatePath,proofPath])assert.ok(!fs.existsSync(p));
fs.writeFileSync(basePath,JSON.stringify({basePlanId:applied.appliedPlanId,expectedInputHash:reviewBase.inputHash,candidate:base},null,2)+'\n',{flag:'wx'});
fs.writeFileSync(candidatePath,JSON.stringify(candidate,null,2)+'\n',{flag:'wx'});
const proof={createdAt:new Date().toISOString(),kind:'design75_unapplied_technique_acquisition_repair',workId:applied.workId,basePlanId:applied.appliedPlanId,basePlanRevision:74,expectedInputHash:reviewBase.inputHash,baselinePath:basePath,baseCandidateSha256:hash(base),candidatePath,candidateSha256:hash(candidate),confirmedFindingPath:'docs/audits/2026-10-18-design74-technique-access.json',changes:['tech_19归属、受限借阅与实际授课权限','同一劳务合同明确现金24枚和一次课程名额，保留3+14+7账','330日前实际验收、医修准许、借页授课及复述后开练','三段教学分别对应六个有效周期，失败暂停与复诊恢复，不自动掌握'],validation,productionWrites:0,formalAcceptance:false,proseGenerated:false,blockersClosed:0};
fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({candidatePath,valid:validation.valid,blockers:41,productionWrites:0}));
