// Build a bounded review request from the reloaded isolated design. No model call.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = file => JSON.parse(fs.readFileSync(file));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));
const candidateProofPath = 'docs/audits/2026-10-17-design71-world-candidate.json';
const rehearsalPath = 'docs/audits/2026-10-17-design71-world-save-rehearsal.json';
const candidate = read(candidateProofPath), rehearsal = read(rehearsalPath);
assert.equal(fileHash(candidate.candidatePath), candidate.candidateSha256);
assert.equal(rehearsal.candidateSha256, candidate.candidateSha256);
assert.equal(rehearsal.candidateProofSha256, fileHash(candidateProofPath));
assert.equal(fileHash(rehearsal.worldInputPath), rehearsal.worldInputSha256);
const full = read(rehearsal.worldInputPath);
assert.equal(full.inputHash, rehearsal.isolatedInputHash);
const include = source => {
  const id = source.id;
  if (['author', 'world/overview', 'story/overview', 'plan/overview'].includes(id)) return true;
  if (['world/locations/', 'world/axioms/', 'world/realms/', 'story/characters/', 'story/volumes/', 'plan/volumes/'].some(prefix => id.startsWith(prefix))) return true;
  if (['world/artifacts/art_16', 'world/artifacts/art_21', 'world/factions/fac_12'].includes(id)) return true;
  if (id.startsWith('plan/milestones/')) return ['ms_growth_v1_crossing', 'ms_v2_voyage', 'ms_v2_boundary', 'ms_v3_return', 'ms_v3_payoff'].includes(id.split('/').at(-1));
  if (id.startsWith('plan/chapters/')) return [30, 31, 32, 33].includes(Number(id.split('/').at(-1)));
  if (id.startsWith('story/relationships/')) {
    const relation = JSON.parse(source.text);
    return [relation.fromCharacterId, relation.toCharacterId].includes('char_05');
  }
  if (id.startsWith('story/arcs/')) return JSON.parse(source.text).characterIds?.includes('char_05') || id.endsWith('/arc_02');
  return false;
};
const history = candidate.findings.map(finding => ({ id: `review-history/${finding.stageId}`,
  text: '以下是原提案71的历史模型意见，包含可能错误的定位或判断；不是新增世界事实，也不证明新候选通过。须与本次实际提供的候选原文独立对照。\n'
    + JSON.stringify({ stageId: finding.stageId, result: finding.result,
      actuallyReadSourceIds: finding.originalSourceIds }, null, 2) }));
const input = { ...full, area: 'story', rubric: {
  causality: '仅复核本次两项局部修订：北境七名矿工的港内救助候查规则、地点与交接，及南渡货索宏观动作。核对loc_02、loc_25、ms_v2_boundary是否真正界定从开舱到暖房的身份、地点、责任和期限，还是以改规则之名免除既有入境要求。新增规则与暖房位置都是待审作者提案，不能冒充旧文已证明；检查与已知担保、防寒、船班、配载、人员任务、照护及经费是否相容。身份自报、舱单、获救和付款不能自动证明入境已获准。允许按明确规则候查，不要求先确认犯罪或先取得全文正文才可评设计。指出具体冲突或必要缺口，不因条目齐全通过。',
  timeline: '对照完整第30—33章、跨海规则和南渡节点，独立核定货索与箱角的实际承力者、动作章号、对象、时长、费用及失箱后果。历史补读原先只读31章、没读32章；本次必须读两章后判断宏观与细纲是否相容，不能继承先前返修也不能因作者说已修就自动通过。另核七人在291日获救至300日候查的交接顺序、夜的既有担保及301日返程是否区分；未核身份、未来经费与后续返乡不能提前当作事实。',
  pacing: '检查局部设计是否仍支撑人物选择和后果：林先救人而失去盯箱或追程机会，夜守撤离通道并承担耽误，港务救济不抹去伤情、追查与返乡困难。评估候查新增规则是否方便得失去可信冲突，是否暗中扩大角色权限、消除成本或将救人改为无条件全胜。它是作者设计约束，不要求正文逐条宣读行政清单；指出需要通过人物行动呈现的关键节点。本项不验收全书节奏或未生成正文文笔，也不要求展开51—100全部细纲。',
}, sources: [...full.sources.filter(include), ...history] };
const required = ['world/locations/loc_02', 'world/locations/loc_25', 'world/axioms/ax_08',
  'world/artifacts/art_16', 'world/artifacts/art_21', 'story/characters/char_05',
  'plan/chapters/30', 'plan/chapters/31', 'plan/chapters/32', 'plan/chapters/33',
  'plan/milestones/ms_growth_v1_crossing', 'plan/milestones/ms_v2_voyage',
  'plan/milestones/ms_v2_boundary', 'plan/milestones/ms_v3_return'];
for (const id of required) {
  const selected = input.sources.find(s => s.id === id); assert.ok(selected, id);
  assert.deepEqual(selected, full.sources.find(s => s.id === id));
}
const sourceCharacters = JSON.stringify(input.sources).length;
assert.ok(sourceCharacters <= 240000, 'Keep complete sources; do not truncate to fit');
const bindingPath = 'data/audit-runtimes/design71-runtime-bound.json', binding = read(bindingPath);
for (const [file, expected] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(`${binding.runtimePath}/${file}`), expected, file);
const directory = path.resolve('data/audit-runtimes/design71-world-content-review');
const proofPath = 'docs/audits/2026-10-17-design71-world-content-request.json';
assert.ok(!fs.existsSync(directory) && !fs.existsSync(proofPath), 'Preserve previous requests');
fs.mkdirSync(directory);
const inputPath = path.join(directory, 'input.json');
fs.writeFileSync(inputPath, JSON.stringify(input, null, 2) + '\n', { flag: 'wx' });
const proof = { preparedAt: new Date().toISOString(), candidateProofPath, candidateProofSha256: fileHash(candidateProofPath),
  candidatePath: candidate.candidatePath, candidateSha256: candidate.candidateSha256,
  rehearsalPath, rehearsalSha256: fileHash(rehearsalPath), inputPath, inputSha256: fileHash(inputPath),
  fullInputPath: rehearsal.worldInputPath, fullInputSha256: rehearsal.worldInputSha256,
  inputHash: input.inputHash, isolatedPlanId: rehearsal.isolatedPlanId, rubric: input.rubric,
  runtimeBindingPath: bindingPath, runtimeBindingSha256: fileHash(bindingPath), runtimePath: binding.runtimePath,
  requiredSourceIds: required, sourceCharacters,
  selectedSources: input.sources.map(s => ({ id: s.id, sha256: hash(s.text), characters: s.text.length })),
  omittedSourceIds: full.sources.filter(s => !include(s)).map(s => s.id), historySourceIds: history.map(s => s.id),
  originalWorkerCheckpoint: 'data/audit-runtimes/design71-review/result.json',
  requiredTerminalProof: 'docs/audits/2026-10-17-design71-review-result.json',
  modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  executionCondition: 'Only after the original worker has exited and its full terminal proof has been verified. Use the current gpt-5.6-luna connection without fallback, preserve responses and use a bounded two-call local review. Do not save this local result as a formal complete design report.',
  limitation: 'Prepared scoped request only. It cannot resolve production findings, establish historical facts, approve writing or replace full world, power, character and story review.' };
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ selectedSources: input.sources.length, omittedSources: proof.omittedSourceIds.length,
  sourceCharacters, modelCalls: 0, productionWrites: 0, formalAcceptance: false }));
