// Complete the detached v3 correction after its semantic review found a missed
// character profile. Keep v3 and its mixed verdicts unchanged.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateDesignCandidate} from '../packages/application/src/design-candidate.ts';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const priorProofPath = 'docs/audits/2026-10-18-design76-followup-knowledge-v3.json';
const prior = read(priorProofPath), base = read(prior.candidatePath);
assert.equal(hash(base), prior.candidateSha256);
const reviewPath = 'docs/audits/2026-10-18-design76-followup-v3-review.json', review = read(reviewPath);
assert.equal(review.candidateSha256, prior.candidateSha256);
assert.equal(fileHash(review.statePath), review.stateSha256);
assert.equal(review.results.find(r => r.area === 'story').result.checks.find(c => c.criterion === 'causality').verdict, 'revise');
const candidate = structuredClone(base), profile = candidate.storyBible.characters.find(c => c.id === 'char_19');
assert.equal(profile.name, '严涛');
const before = profile.identity;
assert.equal(before, '第32章脚被箱夹住的普通押货者，无修行能力；姓名在第33章由船册和本人确认。');
profile.identity = '第32章脚被箱夹住的普通押货者，无修行能力。严涛为作者侧人物姓名；林辰第32章只亲见其私推并救人，第33章尚未确认其姓名身份，第34章与这名被救押货者当面对话并拒绝伪证，第35章取得侧门底册后才核对严涛工牌。不得把旁白称“严”当作林已完成核名，底册也不证明私挪全貌、货物去向或幕后；第38—39章仍须当面对质与实物核验。';
const restored = structuredClone(candidate);
restored.storyBible.characters.find(c => c.id === 'char_19').identity = before;
assert.deepEqual(restored, base);
const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true); assert.equal(validation.blockers.length, 41);
assert.deepEqual(validation.blockers, validateDesignCandidate(base).blockers);
const candidatePath = 'data/design-candidates/design76-followup-controls-v4.json';
const proofPath = 'docs/audits/2026-10-18-design76-followup-knowledge-v4.json';
const proof = {
  kind: 'design76_unapplied_identity_profile_candidate',
  previousCandidatePath: prior.candidatePath, previousCandidateSha256: hash(base),
  priorProofPath, priorProofSha256: fileHash(priorProofPath),
  reviewPath, reviewSha256: fileHash(reviewPath), candidatePath, candidateSha256: hash(candidate),
  inputsPath: prior.inputsPath, inputsSha256: prior.inputsSha256, expectedInputHash: prior.expectedInputHash,
  inheritedChanges: prior.changes,
  changes: [{sourceId: 'story/characters/char_19', field: 'identity', before, after: profile.identity}],
  validation, modelCalls: 0, productionWrites: 0, blockersClosed: 0, formalAcceptance: false,
  limitation: 'Only the missed character identity field changes from v3. The inherited six fields remain intact; the full local knowledge chain must be semantically reviewed again. v3 character passes do not certify v4 or override the v3 story revisions.',
};
if (process.argv.includes('--check')) {
  assert.deepEqual(read(candidatePath), candidate); assert.deepEqual(read(proofPath), proof);
} else {
  assert.ok(!fs.existsSync(candidatePath) && !fs.existsSync(proofPath));
  fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + '\n', {flag: 'wx'});
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', {flag: 'wx'});
}
console.log(JSON.stringify({candidatePath, newFieldsChanged: 1, inheritedFields: 6, valid: true, blockers: 41, productionWrites: 0}));
