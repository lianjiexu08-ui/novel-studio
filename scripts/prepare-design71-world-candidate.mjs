// Offline author proposal. The live v71 review and its findings remain immutable.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateDesignCandidate } from '../packages/application/src/design-candidate.ts';

const read = p => JSON.parse(fs.readFileSync(p));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const appliedPath = 'docs/audits/2026-10-17-design71-applied.json', applied = read(appliedPath);
const candidateBytes = fs.readFileSync(applied.candidatePath);
assert.equal(hash(candidateBytes), applied.candidateSha256);
const original = JSON.parse(candidateBytes), candidate = structuredClone(original);
const root = 'data/audit-runtimes/design71-review', baseline = read(`${root}/baseline.json`);
const inputBytes = fs.readFileSync(`${root}/inputs.json`);
assert.equal(hash(inputBytes), baseline.inputsSha256);
assert.equal(applied.inputHash, baseline.inputHash);
const inputs = JSON.parse(inputBytes), sources = inputs.world.sources;
const checkpointBytes = fs.readFileSync(`${root}/result.json`), checkpoint = JSON.parse(checkpointBytes);
assert.equal(checkpoint.inputHash, baseline.inputHash);
const run = checkpoint.runs.find(r => r.input.area === 'world');
const bindingBytes = fs.readFileSync('data/audit-runtimes/design71-runtime-bound.json');
assert.equal(hash(bindingBytes), baseline.runtimeBindingSha256);
const binding = JSON.parse(bindingBytes);
for (const [file, expected] of Object.entries(binding.sourceHashes)) assert.equal(hash(fs.readFileSync(`${binding.runtimePath}/${file}`)), expected, file);
const { designReviewStageInput } = await import(pathToFileURL(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`));
const findingIds = ['cross-3-5', 'cross-2-4', 'followup-cross-2-4/geography'];
const findings = findingIds.map(id => {
  const stage = run.stages.find(s => s.id === id); assert.ok(stage?.result, id);
  const input = designReviewStageInput(run, stage);
  return { stageId: id, result: stage.result, modelResponses: stage.modelResponses,
    inputSha256: hash(JSON.stringify(input)), originalSourceIds: [...new Set(input.stage.sourceMap.map(u => u.sourceId))] };
});
assert.equal(findings[0].result.checks.find(c => c.criterion === 'geography').verdict, 'revise');
assert.equal(findings[2].result.checks[0].verdict, 'revise');
assert.ok(findings[2].originalSourceIds.includes('plan/chapters/31'));
assert.ok(!findings[2].originalSourceIds.includes('plan/chapters/32'));

const continent = candidate.worldPack.locations.find(l => l.id === 'loc_02');
const port = candidate.worldPack.locations.find(l => l.id === 'loc_25');
const crossing = candidate.plan.milestones.find(m => m.id === 'ms_growth_v1_crossing');
const rescue = candidate.plan.milestones.find(m => m.id === 'ms_v2_boundary');
for (const [id, value] of [['world/locations/loc_02', continent], ['world/locations/loc_25', port],
  ['plan/milestones/ms_growth_v1_crossing', crossing], ['plan/milestones/ms_v2_boundary', rescue]]) {
  assert.deepEqual(value, JSON.parse(sources.find(s => s.id === id).text), id);
}

// Explicit new law, not an interpretation of the old text or retroactive admission.
continent.entryConditions.push('新增待审的港内救助候查规则：在受监管泊区发现受困或被扣人员时，港务可先登记为获救待核人员，安排港卫陪同移至同一泊区监管界内的救济候查暖房；此路径只延续码头候查，不授予沿岸入境或自由离港资格。港务验籍岗具名接案，负责逐人核对身份材料、去向及到离记录；救济所当班负责人签收人员并承担住食、照护和实际交接责任，不能代签入境。自报姓名、船方舱单、付过救济费均不等于身份已核实；不符处逐项保留。待核人员不是因获救而成为罪犯，也不能交回被指控扣人的船方。需离开监管区时，仍须取得引渡令或由实际到场的巡界使验明身份后另行具名担保，明确地点、期限与责任。候查安置须逐案确定期限、已落实的床位照护与经费，期满须复核并实际办理续接或合法离境，不能自动释放、默认为无限安置或倒填此前入境许可。');
port.entryConditions.push('新增待审的救济所位置限定：本港原救济所用于接收船上获救人员的候查暖房及其既有靠泊点，位于受监管泊区的同一界内。船舱、救助浮台、靠泊点与该暖房之间的本案救助转运由港务登记并由港卫实际交接，不经过对外开放的内陆街区；仍按loc_02逐人核身份、核防寒与安置责任。此位置安排不把普通港区全部变为候查区，也不授予林贺或获救者新的活动权限。');

const previous = crossing.setup[2];
assert.ok(previous.includes('固定货索、阻止药箱砸人'));
const chapter32 = candidate.plan.chapters.find(c => c.chapterNumber === 32);
assert.ok(chapter32.scenes.some(s => s.includes('半斤索头') && s.includes('普通船桩受力')));
crossing.setup[2] = '第32章第215日凌晨的风暴中，护船者承担外敌；林辰只把两丈内尚未绷紧、未系重箱的半斤索头御动一息交给水手，预付半成真元后停术，由水手系索、普通船桩承力、制动并搬回药箱。他再让水手用随舱撬杠抬稳压脚箱角、卸去楔上载荷，才从一丈内另付半成御动八两松楔一息；水手抽人、落箱，林不以御物固定受载货索或托箱。救下试图私藏货物的押货者使他错过盯住六号箱的窗口。第31章只是验货登船；本节点按第32章既有动作明确实际承力者，不改变两次支出、失箱与奖金后果，不斩神海海兽或获得免费升级。';

rescue.setup.push('新增待审的七人身份与交接安排：291日行动前，港务原验籍岗经办在本案救助登记上签名，接下七名获救待核人员的身份核对与监管去向责任，核定使用泊区内原救济所候查暖房至300日。原所方当班负责人在已有七床、70枚十日住食供暖及28枚首轮诊护安排上签收候查照护；不发入境许可。开舱后港卫先按实际救出顺序登记，逐人与自报姓名、原工籍线索及船方舱单对应；无法立即核实的栏记待核，不因口供一致就追认自愿上船或真实籍贯。七人在原定衣符、短板和保温救助舟条件下，由原陪护港卫随实际批次交到同一监管泊区内的候查暖房，验籍岗与所方在交接单分别签明身份状态、人数、伤情和去向；从开舱至接收始终走本案候查救助路径，不借夜285日给林贺的查货担保入境。身份与案情分开核对：原航簿、各人口述和实物不相符处继续待查，先照护不等于已查清全链。正常拟定路径至300日仍有原籍材料待核，七人留所候查；300日港务逐人复核身份进展、健康、本人意愿及后续床位经费，再实际办理续接或取得合法离境条件。夜准备返驻地不带走这份港务责任；七人未取得引渡令或独立具名担保时，不得随林贺离港。70不覆盖301日后，期满不自动遣返或交回扣人船方。');
assert.ok(rescue.outcome.includes('夜为矿工安排港口原有救济所'));
rescue.outcome = rescue.outcome.replace('夜为矿工安排港口原有救济所', '夜协助港务将七人交入同一受监管泊区内原救济所候查暖房，由港务接案、所方签收照护；至300日仍为获救待核人员，未取得自由离港资格');

assert.deepEqual(candidate.storyBible, original.storyBible);
assert.deepEqual(candidate.plan.chapters, original.plan.chapters);
assert.deepEqual(candidate.plan.openQuestions, original.plan.openQuestions);
assert.deepEqual(candidate.worldPack.unresolvedQuestions, original.worldPack.unresolvedQuestions);
const changes = [];
function diff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[key], b[key], `${path}/${key}`);
  } else changes.push({ path, before: a, after: b });
}
diff(original, candidate);
assert.equal(changes.length, 5);
const allowed = new Set([
  `/worldPack/locations/${candidate.worldPack.locations.indexOf(continent)}/entryConditions/${continent.entryConditions.length - 1}`,
  `/worldPack/locations/${candidate.worldPack.locations.indexOf(port)}/entryConditions/${port.entryConditions.length - 1}`,
  `/plan/milestones/${candidate.plan.milestones.indexOf(crossing)}/setup/2`,
  `/plan/milestones/${candidate.plan.milestones.indexOf(rescue)}/setup/${rescue.setup.length - 1}`,
  `/plan/milestones/${candidate.plan.milestones.indexOf(rescue)}/outcome`,
]);
assert.ok(changes.every(c => allowed.has(c.path)));
const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true, JSON.stringify(validation)); assert.equal(validation.blockers.length, 41);
assert.equal(candidate.plan.chapters.length, 50); assert.equal(candidate.plan.targetChapterCount, 100);
assert.equal(candidate.plan.chapters.flatMap(c => c.executionChecks ?? []).length, 41);
const candidatePath = 'data/design-candidates/design71-world-clarifications-v1.json';
const proofPath = 'docs/audits/2026-10-17-design71-world-candidate.json';
const snapshotPath = `${root}/world-candidate-prefix.json`;
for (const file of [candidatePath, proofPath, snapshotPath]) assert.ok(!fs.existsSync(file), `Preserve ${file}`);
const bytes = JSON.stringify(candidate, null, 2) + '\n';
const sourceIds = ['world/locations/loc_02', 'world/locations/loc_25', 'world/axioms/ax_08',
  'story/characters/char_05', 'plan/chapters/31', 'plan/chapters/32',
  'plan/milestones/ms_growth_v1_crossing', 'plan/milestones/ms_v2_boundary'];
const proof = { kind: 'design71_world_offline_candidate', preparedAt: new Date().toISOString(), workId: applied.workId,
  basePlanId: applied.appliedPlanId, expectedInputHash: applied.inputHash,
  sourceCandidatePath: applied.candidatePath, sourceCandidateSha256: applied.candidateSha256,
  candidatePath, candidateSha256: hash(bytes), snapshotPath, snapshotSha256: hash(checkpointBytes),
  findings, originalSources: sourceIds.map(id => { const source = sources.find(s => s.id === id); assert.ok(source, id); return source; }),
  changes, validation, retainedBlockingQuestions: 41, executionChecks: 41,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitations: ['The custody path and shelter location are explicit new author proposals, not facts established by the prior design or prose.',
    'The cargo review read chapter31, not chapter32. Its negative finding stays intact; this proposal aligns the macro wording with the existing chapter32 action and does not approve either.',
    'This candidate has only structural validation. The new rule, responsibility, timing, scope, staffing and post-day300 obligations need content review.',
    'Wait for the original full worker to exit and verify its result before any local model review, isolated save rehearsal or production application. All other findings remain open.'] };
fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
fs.writeFileSync(candidatePath, bytes, { flag: 'wx' });
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidatePath, changes: changes.length, valid: validation.valid,
  blockers: validation.blockers.length, modelCalls: 0, productionWrites: 0, formalAcceptance: false }));
