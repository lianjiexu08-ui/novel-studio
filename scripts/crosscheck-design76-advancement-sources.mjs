// Offline follow-up to call 54. Missing from one request does not mean missing
// from the design. This does not resolve the formal review's awaitingSources.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha = v => createHash('sha256').update(v).digest('hex');
const fileHash = p => sha(fs.readFileSync(p));
const control = 'data/audit-runtimes/design76-citation-edits-review';
const inputPath = `${control}/inputs.json`, inputs = read(inputPath);
const requestPath = `${control}/model-calls/00054.started.json`;
const responsePath = `${control}/model-calls/00054.response.json`;
const request = JSON.parse(read(requestPath).request.user);
const response = JSON.parse(read(responsePath).response.text);
assert.equal(request.requestId, response.requestId);
assert.equal(request.stage.kind, 'cross');
assert.ok(response.checks.every(c => c.verdict === 'insufficient'));
const candidatePath = 'data/design-candidates/design76-followup-controls-v4.json';
const candidate = read(candidatePath);
const ids = ['world/realms/realm_03', 'world/techniques/tech_19',
  'world/artifacts/art_03', 'world/resources/res_01',
  'story/characters/char_02', 'story/characters/char_04', 'story/characters/char_10',
  'plan/milestones/ms_v3_training', 'plan/milestones/ms_v3_advancement'];
const sources = ids.map(id => {
  const source = inputs.power.sources.find(s => s.id === id);
  assert.ok(source, id);
  const [area, collection, key] = id.split('/');
  const owner = area === 'world' ? candidate.worldPack : area === 'story' ? candidate.storyBible : candidate.plan;
  assert.deepEqual(JSON.parse(source.text), owner[collection].find(s => s.id === key), `${id}: candidate changed`);
  const sentRanges = request.sources.filter(s => s.origin?.sourceId === id).map(s => s.origin);
  assert.equal(sentRanges.length > 0, id === 'world/realms/realm_03', `${id}: actual request coverage changed`);
  return {id, sha256: sha(source.text), sentRanges, unchangedInV4: true};
});
const training = JSON.parse(inputs.power.sources.find(s => s.id === 'plan/milestones/ms_v3_training').text);
const advancement = JSON.parse(inputs.power.sources.find(s => s.id === 'plan/milestones/ms_v3_advancement').text);
const execution = training.setup.find(s => s.startsWith('丹府训练执行卡：'));
const account = training.setup.find(s => s.startsWith('训练资源执行账'));
assert.ok(execution && account);
const cycles = [[331,340],[341,350],[358,367],[368,377],[378,387],[388,397]];
for (const [start,end] of cycles) assert.ok(execution.includes(`${start}–${end}`));
const effectiveDays = cycles.reduce((sum,[start,end]) => sum + end - start + 1, 0);
assert.equal(effectiveDays, 60);
assert.ok(execution.includes('第三枚报废不退'));
assert.ok(execution.includes('357复诊须胸闷消失'));
assert.ok(execution.includes('398日完整静置一日'));
assert.ok(account.includes('实际完成的十二日一次结清24枚'));
assert.ok(account.includes('3枚偿付') && account.includes('14枚按药舍') && account.includes('剩余7枚'));
assert.ok(advancement.setup[0].includes('六个有效周期完成→静置观察→白榆诊察→顾峤复核→十元载扣除'));
const proof = {
  kind: 'independent_advancement_source_crosscheck', inputPath, inputsSha256: fileHash(inputPath),
  inputHash: inputs.power.inputHash, requestPath, requestSha256: fileHash(requestPath),
  responsePath, responseSha256: fileHash(responsePath), modelCall: 54,
  candidatePath, candidateSha256: fileHash(candidatePath), sources,
  originalVerdicts: response.checks.map(({criterion,verdict,awaitingSources}) => ({criterion,verdict,awaitingSources})),
  effectiveCycles: cycles.map(([start,end]) => ({start,end,days:end-start+1})), effectiveDays,
  failedCycle: {start:351,stop:354,days:4,stonesConsumed:1,effectiveCycles:0},
  equations: [
    {expression:'12 * 2', actual:12*2, expected:24, account:'实际完成十二日轻役的现金报酬，课程为同一合同另列报酬项'},
    {expression:'24 - 3 - 14', actual:24-3-14, expected:7, account:'偿付既有欠款并预付约定食宿复查后，独立训练库存'},
    {expression:'6 + 1', actual:6+1, expected:7, account:'六个有效周期加一次开封失败；失败耗材不退'},
  ],
  findings: [
    '实际第54次请求给了玄府准入规则，但没有发送两项训练/晋阶里程碑、tech_19、三位人物资格档、剑和灵石条目。待补读合理，不是这些来源在设计中不存在。',
    '冻结输入已有六个有效十日周期、354日失败停训、357日复诊与358日行前再核、398日静置及415日两项确认后付十元载的候选路径。',
    '现金与训练灵石的局部算式相符；异常诊疗、延期食宿、少做轻役或库存不足均须重新核费和顺延，不能保证按固定日期晋阶。',
    '上述来源在v4中逐项未改，不需要为了本次未读而重复增写同一设定。正式评审仍须实际补读并核验。',
  ],
  modelCalls:0, productionWrites:0, blockersClosed:0, formalAcceptance:false,
  limitations: '仅核对来源存在、v4未改及局部训练日期/耗材算术；不证明全部寿储余额、早章交锋、训练负荷、叙事效果或全书质量，也不替代正式补读和终止回放。',
};
for (const e of proof.equations) assert.equal(e.actual,e.expected);
const output = 'docs/audits/2026-10-18-design76-advancement-source-crosscheck.json';
if (process.argv.includes('--check')) assert.deepEqual(read(output), proof);
else fs.writeFileSync(output, JSON.stringify(proof,null,2)+'\n', {flag:'wx'});
console.log(JSON.stringify({output,sourceCount:sources.length,effectiveDays,productionWrites:0,formalAcceptance:false}));
