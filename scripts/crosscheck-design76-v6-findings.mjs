// Bind independent checks to the exact detached requests and current design.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control = 'data/audit-runtimes/design76-followup-v6-integrated';
const proof = read('docs/audits/2026-10-18-design76-followup-v6-integrated-review.json');
assert.equal(sha(proof.statePath), proof.stateSha256);
const state = read(proof.statePath), candidate = read(proof.candidatePath);
const current = read('data/design-candidates/design76-identity-v1.json');
const formal = read('data/audit-runtimes/design76-notes30-review/inputs.json');
const request = n => JSON.parse(read(`${control}/model-calls/${String(n).padStart(5, '0')}.started.json`).request.user);
const world = request(3), story = request(4);
const evidence = [];
function quote(body, sourceId, text) {
  const source = body.sources.find(s => s.id === sourceId); assert.ok(source, sourceId);
  const fragments = source.fragments.filter(f => f.text.includes(text));
  assert.ok(fragments.length, text);
  evidence.push({ sourceId, quote: text, fragmentIds: fragments.map(f => f.id), requestId: body.requestId });
}
quote(world, 'plan/milestones/ms_v3_return', '275护寒符36、保温衣8');
quote(world, 'plan/milestones/ms_v3_return', '此前实际车费、医药、食宿、供暖与查验625');
quote(world, 'plan/milestones/ms_v3_return', '当场付24后累计724、余276');
quote(world, 'plan/milestones/ms_v3_return', '再实付56，累计780、余220');
quote(story, 'story/characters/char_09', '愿冒失去药役职位的风险保住病人');
quote(world, 'world/locations/loc_29', '访客、矿工须有对应药役、管事或执事登记陪同');
assert.ok(!world.sources.some(s => s.id === 'plan/milestones/ms_v3_convoy'));
assert.ok(!story.sources.some(s => s.id === 'world/locations/loc_29'));
assert.equal(12 + 1 + 18 + 36 + 8 + 625, 700);
assert.equal(700 + 24 + 56, 780);
assert.equal(14000 - 10000 - 3000 - 780, 220);
const convoy = candidate.plan.milestones.find(m => m.id === 'ms_v3_convoy');
assert.ok(convoy.setup.some(s => s.includes('程携旧货签清册随骑使，二日435到外山押运仓核货签')));
assert.ok(convoy.setup.some(s => s.includes('程318已抵押原物，410才本地重整')));
const actualChanged = [];
for (const key of ['worldPack', 'storyBible', 'plan']) for (const [field, rows] of Object.entries(candidate[key])) {
  if (!Array.isArray(rows) || !rows.every(r => r && typeof r === 'object' && r.id)) continue;
  for (const row of rows) {
    const previous = current[key][field].find(r => r.id === row.id);
    if (hash(row) === hash(previous)) continue;
    const id = `${{worldPack:'world',storyBible:'story',plan:'plan'}[key]}/${field}/${key === 'plan' && field === 'chapters' ? row.chapterNumber : row.id}`;
    const original = Object.values(formal).flatMap(i => i.sources).find(s => s.id === id);
    assert.ok(original, id); assert.deepEqual(JSON.parse(original.text), previous);
    const areas = ['power','characters','world','story'].filter(area => read(`${control}/${area}-input.json`).sources.some(s => s.id === id && s.text === JSON.stringify(row, null, 2)));
    assert.ok(areas.length, id);
    actualChanged.push({ sourceId: id, beforeSha256: hash(previous), afterSha256: hash(row), reviewedIn: areas });
  }
}
assert.equal(actualChanged.length, 12);
assert.deepEqual(proof.changedSourceIds.filter(id => !actualChanged.some(s => s.sourceId === id)), ['plan/milestones/ms_v3_training']);
assert.notEqual(world.scope.planRevisionId, formal.world.scope.planRevisionId);
const output = {
  verified: true, originalReviewPath: 'docs/audits/2026-10-18-design76-followup-v6-integrated-review.json', originalReviewSha256: sha('docs/audits/2026-10-18-design76-followup-v6-integrated-review.json'),
  originalVerdictsPreserved: true, evidence,
  accounting: { taxBefore: [12,1,18,36,8,625], sum: 700, portTax: 24, laterTravel: 56, total: 780, sealedBalance: 220, finding: 'Original review omitted the explicitly supplied clothing cost of 8; do not change 625 to 633.' },
  travel: { omittedFromWorldRequest: 'plan/milestones/ms_v3_convoy', sourceSha256: hash(convoy), finding: '435 arrival at the outer-mountain warehouse is already planned. 436–438 return to the capital must not be repaired by inventing another sea trip. Earlier 291–318 travel remains subject to separate coverage review.' },
  physician: { rolePresentInRequest: true, visitorRuleMissingFromStoryRequest: true, finding: 'The goal field names the medicine-worker post; the causal review must also read loc_29 before judging its visitor authority.' },
  provenanceCorrection: { originalDeclaredScope: world.scope, actualCurrentScope: formal.world.scope,
    explanation: 'The v6 runner used the archived plan75 comparison wrapper while labeling revision76. Candidate text itself is v6 and all 12 actual changes were supplied intact. One already-applied training-name correction was redundantly presented as a change. This detached review cannot stand as a formal current-plan assessment or production-save baseline. v7 targeted requests use the actual current scope.',
    actualChanged, extraHistoricalComparison: 'plan/milestones/ms_v3_training', correctCurrentInputHash: formal.world.inputHash },
  modelCalls: 0, productionWrites: 0, blockersClosed: 0, formalAcceptance: false,
};
const outputPath = 'docs/audits/2026-10-18-design76-v6-independent-findings.json';
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ verified: true, quotedClaims: evidence.length, actualChangedDocuments: actualChanged.length, productionWrites: 0 }));
