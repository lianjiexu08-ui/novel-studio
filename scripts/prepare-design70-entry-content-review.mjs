// Prepare bounded content review from the reloaded isolated candidate. No model or production writes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaWorkRepository} from '../packages/persistence/src/prisma-repository.ts';
import {designReviewHash,designReviewInput} from '../novel-service-core/src/design-review.ts';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=x=>createHash('sha256').update(x).digest('hex');
const fileHash=p=>sha(fs.readFileSync(p));
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--v2'));
const suffix=process.argv[2]==='--v2'?'-v2':'';
const repair=read(`docs/audits/2026-10-17-design70-entry-candidate${suffix}.json`);
const saved=read(`docs/audits/2026-10-17-design70-entry-save-rehearsal${suffix}.json`);
assert.equal(fileHash(repair.candidatePath),saved.candidateSha256);
assert.equal(saved.candidateSha256,repair.candidateSha256);
const directory=path.resolve(`data/audit-runtimes/design70-entry-content-review${suffix}`);
assert.ok(!fs.existsSync(directory),'Keep previous prepared review');
assert.notEqual(fs.realpathSync(saved.databasePath),fs.realpathSync('data/novel-studio.db'));
const repo=new PrismaWorkRepository(new PrismaClient({datasources:{db:{url:`file:${saved.databasePath}`}}}));
let work;
try{work=await repo.get(repair.workId);}finally{await repo.disconnect();}
assert.ok(work);
assert.equal(designReviewHash(work,saved.isolatedPlanId),saved.isolatedInputHash);
const full=designReviewInput(work,'world',saved.isolatedPlanId);
const candidate=read(repair.candidatePath);
const characterIds=new Set(['char_01','char_02','char_04','char_08','char_09','char_10']);
const include=source=>{
 const id=source.id;
 if(['author','world/overview','story/overview','plan/overview','story/chapterPlans/chapter-plan-14','story/relationships/rel_03'].includes(id))return true;
 if(id.startsWith('world/locations/')||id.startsWith('world/axioms/')||id.startsWith('world/realms/'))return true;
 if(['world/factions/fac_01','world/factions/fac_02','world/factions/fac_03'].includes(id))return true;
 if(id.startsWith('story/characters/'))return characterIds.has(id.split('/').at(-1));
 if(id.startsWith('story/arcBeats/'))return JSON.parse(source.text).characterId==='char_04';
 if(id.startsWith('plan/volumes/'))return JSON.parse(source.text).startChapter<=32;
 if(id.startsWith('plan/milestones/'))return JSON.parse(source.text).startChapter<=32;
 if(id.startsWith('plan/chapters/'))return Number(id.split('/').at(-1))<=26;
 return false;
};
const input={...full,area:'story',rubric:{
 causality:'这是未应用的第14章位置修订局部复核，不是全书验收。核对墨幽屠开篇位置、人物宗门身份、青灵坊市普通后街接报、第14章圣经及计划是否相容，是否真正避免原总坛及上级死渊的未证准入条件，或仅用“普通”字样偷换门槛。检查公共坊市接报的行为、隐蔽性和地方巡查限制，勿替设定补血契、血税、法宝、前史或通行特权。保持其已学技能与现时驻地的区别，不因未叙述入坛就编造一次违规进入。',
 timeline:'仅核对这次位置修订相关的消息与后续衔接：墨在青灵坊市等待信使沿外山公共道路徒步到场，收到失败纸报后才改令，是否与1—26章已写时空、人物关系阶段、读者先知及林苏23章核名一致；有没有把作者设定、原初位置或独立视角偷换为主角已知。指出具体冲突或必要缺项，不能凭未给远期细纲要求补写全书。',
 pacing:'检查第14章反派接报与主角拒绝删图两线的因果和阅读作用，以及改到公共坊市是否产生不可信或纯为过关的场景。区分作者约束与需要在正文呈现的动作；如果场景仍像规则清单而缺少人物行动，应明确指出。不得通过虚构装备、入坛前史、免费能力或改写已经确定的关系阶段来补救。此项只评设计支撑力，不宣称正文文笔已通过。',
},sources:full.sources.filter(include)};
assert.ok(input.sources.length);
assert.ok(JSON.stringify(input.sources).length<=240000);
const required=['story/characters/char_04','story/chapterPlans/chapter-plan-14','plan/chapters/14','world/locations/loc_09','world/locations/loc_10','world/locations/loc_30','story/relationships/rel_03'];
for(const id of required){
 const selected=input.sources.find(s=>s.id===id),original=full.sources.find(s=>s.id===id);
 assert.ok(selected,id);assert.deepEqual(selected,original);
}
for(let n=1;n<=26;n++)assert.ok(input.sources.some(s=>s.id===`plan/chapters/${n}`));
assert.deepEqual(JSON.parse(input.sources.find(s=>s.id==='story/characters/char_04').text),candidate.storyBible.characters.find(c=>c.id==='char_04'));
assert.deepEqual(JSON.parse(input.sources.find(s=>s.id==='plan/chapters/14').text),candidate.plan.chapters.find(c=>c.chapterNumber===14));
const bindingPath='data/audit-runtimes/design70-runtime-bound.json',binding=read(bindingPath);
for(const [p,h] of Object.entries(binding.sourceHashes))assert.equal(fileHash(`${binding.runtimePath}/${p}`),h);
fs.mkdirSync(directory);
const inputPath=path.join(directory,'input.json'),fullInputPath=path.join(directory,'full-world-input.json');
fs.writeFileSync(inputPath,JSON.stringify(input,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(fullInputPath,JSON.stringify(full,null,2)+'\n',{flag:'wx'});
const proof={kind:'design70_entry_focused_content_request',preparedAt:new Date().toISOString(),
 candidatePath:repair.candidatePath,candidateSha256:repair.candidateSha256,
 isolatedPlanId:saved.isolatedPlanId,inputHash:input.inputHash,sourceDatabase:saved.databasePath,
 inputPath,inputSha256:fileHash(inputPath),fullInputPath,fullInputSha256:fileHash(fullInputPath),
 runtimePath:binding.runtimePath,runtimeBindingPath:bindingPath,runtimeBindingSha256:fileHash(bindingPath),
 sourceCharacters:JSON.stringify(input.sources).length,requiredSourceIds:required,
 selectedSources:input.sources.map(s=>({id:s.id,sha256:sha(s.text),characters:s.text.length})),
 omittedSourceIds:full.sources.filter(s=>!include(s)).map(s=>s.id),rubric:input.rubric,
 modelCalls:0,productionWrites:0,formalAcceptance:false,
 executionCondition:'Wait for original design70 worker to exit and verify its final records before calling the current gpt-5.6-luna connection without fallback. Save raw responses; a focused pass cannot replace complete design acceptance.',
 limitation:'Prepared request only; the model has not reviewed this candidate. Complete selected sources do not mean complete world or book coverage.'};
const proofPath=`docs/audits/2026-10-17-design70-entry-content-request${suffix}.json`;
assert.ok(!fs.existsSync(proofPath));
fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({sourceCharacters:proof.sourceCharacters,selectedSources:input.sources.length,omittedSources:proof.omittedSourceIds.length,inputSha256:proof.inputSha256,modelCalls:0,formalAcceptance:false}));
