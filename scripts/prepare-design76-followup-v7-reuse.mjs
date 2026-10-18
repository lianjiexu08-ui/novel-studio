// Explicit author proposal addressing the v6 review's repeated-use ambiguity.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateDesignCandidate } from '../packages/application/src/design-candidate.ts';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const parentPath = 'data/design-candidates/design76-followup-controls-v6.json', parent = read(parentPath);
assert.equal(hash(parent), read('docs/audits/2026-10-18-design76-followup-admission-v6.json').candidateSha256);
const control = 'data/audit-runtimes/design76-followup-v6-integrated';
const record = read(`${control}/result.json`).areas.find(r => r.area === 'power');
assert.equal(record.status, 'completed');
assert.equal(record.result.checks.find(c => c.criterion === 'counters').verdict, 'revise');
const responsePath = `${control}/model-calls/00001.response.json`;
assert.equal(read(responsePath).response.text, record.rawResponses[0]);
const candidate = structuredClone(parent);
const additions = {
  art_04: '再次使用：无论主动收罩、到时停罩或受扰失控，器生雾纹完全停止后，须在无攻击干扰且站位稳定处连续完成至少十息的停用检查：核看器身、实体手柄和灵石槽无裂损、灼伤或松脱；空手柄握持无颤抖，能正确辨认自身朝向与身边同伴，确认经脉无疼痛且足付下一次当境法力，另备三枚完整青灵石。这是不开雾、不施术的检查，不获得探知、防护或法力恢复；被打断须重新连续计满十息。正常检查全部合格即可按新一次重新付费起雾，没有免费续罩。因疲劳或受惊失稳者须先实际休息至检查稳定；受击后疼痛、定向异常或疑有神魂伤者先停用并经医修确认，器身损坏先实际修复，十息届满不能免除这些条件。失控的一次不能重新接续；即使仍在同一场交战，也只有失控原因已经排除、获得完整无干扰检查窗口且满足上述条件，才能另起新一次。敌方仍持续冲击、握持或导流失稳时禁止再开，不能把连续重开当作永不散去的烟障。',
  art_06: '再次使用：主动停术、十息控环结束或任一失控后，先让本次主动导流彻底停止；至少连续一刻钟不再催环，处于能稳定静息和检查的环境，遭攻击或中断休息则重新计时。复用前须已实际回收环体，检查环面、认主纹和持握部位无裂损、结冰卡滞；确认双手无寒痛或麻木、经脉无痛、定向清醒，并重新肉眼确认下一次真实浅水落点、环体可露出条件及必要作用边界，同时核足新的三成当境法力。检查本身不投环、不冻结、不探知；回收须走实际可达路径或使用另已定义且能支付的手段，不因等待结束自动回手。疲劳须实际消退，寒伤、受击疑伤或神魂伤须先经医修确认，损坏先修复；一刻钟届满或法力补足不单独恢复资格。失控后禁止重新锁定接续旧次，即使同一交战中仍有机会，也须实际排除遮挡、深水或干扰等失控原因，完成回收、完整间隔和检查后，才可另起新一次并重新支付；无法满足时本场停用。旧次残冰仍按原物理规则处理，不随复用清空，也不能在检查期间算作主动经络禁锢。',
};
const changes = Object.entries(additions).map(([id, text]) => {
  const item = candidate.worldPack.artifacts.find(a => a.id === id), index = item.limitations.length;
  item.limitations.push(text);
  return { sourceId: `world/artifacts/${id}`, field: `limitations/${index}`, before: null, after: text };
});
const restored = structuredClone(candidate);
for (const id of Object.keys(additions)) restored.worldPack.artifacts.find(a => a.id === id).limitations.pop();
assert.deepEqual(restored, parent);
const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true);
assert.deepEqual(validation.blockers, validateDesignCandidate(parent).blockers);
const candidatePath = 'data/design-candidates/design76-followup-controls-v7.json';
const proofPath = 'docs/audits/2026-10-18-design76-followup-reuse-v7.json';
const proof = { kind: 'design76_unapplied_reuse_conditions', parentPath, parentSha256: hash(parent), candidatePath, candidateSha256: hash(candidate),
  runnerSha256: sha(process.argv[1]), reviewInputPath: `${control}/power-input.json`, reviewInputSha256: sha(`${control}/power-input.json`),
  responsePath, responseSha256: sha(responsePath), originalChecks: record.result.checks, changes, validation,
  modelCalls: 0, productionWrites: 0, blockersClosed: 0, formalAcceptance: false,
  limitation: 'New author limits, not recovered historical facts or universal artifact cooldown rules. Only two appended limitations change from v6; local semantic re-review is required.' };
assert.ok(!fs.existsSync(candidatePath) && !fs.existsSync(proofPath));
fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidatePath, appendedLimitations: 2, blockers: validation.blockers.length, productionWrites: 0 }));
