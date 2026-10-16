// Prepare a reviewable terminology-only candidate. No production mutations.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { worldTerminologyConflicts, resolveWorldResource } from '../../novel-service-core/src/world.ts';
import { validateDesignCandidate } from '../../packages/application/src/design-candidate.ts';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const control = 'data/audit-runtimes/design69-terminology-candidate';
assert.ok(!fs.existsSync(control), 'Do not overwrite candidate preparation');
const baseline = read('data/audit-runtimes/design69-review30/baseline.json');
const response = await fetch(`http://127.0.0.1:8787/works/${baseline.workId}/design/candidate`);
assert.equal(response.status, 200);
const source = await response.json();
assert.equal(source.basePlanId, baseline.planId); assert.equal(source.expectedInputHash, baseline.inputHash);
const checkpoint = read('data/audit-runtimes/design69-review30/result.json');
const run = checkpoint.runs[0], stage = run.stages.find(stage => stage.id === 'cross-2-4');
const finding = stage.result.checks.find(check => check.criterion === 'capacity');
assert.equal(finding.verdict, 'revise');
const conflicts = worldTerminologyConflicts(source.candidate.worldPack);
assert.deepEqual(conflicts.map(conflict => [conflict.kind, conflict.label]), [['resource', '诸天通宝'], ['resource', '万象金母']]);
const beforeValidation = validateDesignCandidate(source.candidate);
assert.equal(beforeValidation.valid, false);
assert.equal(beforeValidation.issues.length, 2);
assert.ok(beforeValidation.issues.every(issue => issue.message.includes('conflicting canonical names')));
const candidate = structuredClone(source.candidate);
const primary = candidate.worldPack.terminology.find(term => term.id === 'term_res_12');
const duplicate = candidate.worldPack.terminology.find(term => term.id === 'term_asset_03');
assert.equal(primary.canonical, '诸天通宝'); assert.equal(duplicate.canonical, '万象商币');
assert.equal(primary.kind, 'resource'); assert.equal(duplicate.kind, 'resource');
const removedDefinition = structuredClone(duplicate), beforePrimary = structuredClone(primary);
primary.aliases = [...new Set([...primary.aliases, duplicate.canonical, ...duplicate.aliases])].filter(name => name !== primary.canonical);
candidate.worldPack.terminology = candidate.worldPack.terminology.filter(term => term.id !== duplicate.id);
assert.ok(!JSON.stringify(candidate).includes(duplicate.id), 'Do not remove a term with retained references');
const allNames = [...new Set([primary.canonical, ...primary.aliases])];
const resolutions = allNames.map(name => {
  const before = resolveWorldResource(source.candidate.worldPack, name), after = resolveWorldResource(candidate.worldPack, name);
  assert.equal(before?.id, 'res_16'); assert.equal(after?.id, before.id);
  assert.deepEqual(after, before);
  return { name, resourceId: after.id };
});
assert.deepEqual(candidate.worldPack.resources, source.candidate.worldPack.resources);
assert.deepEqual({ ...candidate.worldPack, terminology: [] }, { ...source.candidate.worldPack, terminology: [] });
assert.deepEqual(candidate.storyBible, source.candidate.storyBible); assert.deepEqual(candidate.plan, source.candidate.plan);
const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true, JSON.stringify(validation.issues));
assert.deepEqual(validation.blockers, beforeValidation.blockers);
assert.equal(validation.blockers.length, 41);
assert.deepEqual(worldTerminologyConflicts(candidate.worldPack), []);
fs.mkdirSync(control);
const basePath = `${control}/base.json`, candidatePath = 'data/design-candidates/design69-terminology-v1.json';
fs.writeFileSync(basePath, JSON.stringify(source, null, 2), { flag: 'wx' });
fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2), { flag: 'wx' });
const proof = { observedAt: new Date().toISOString(), workId: baseline.workId, basePlanId: source.basePlanId,
  expectedInputHash: source.expectedInputHash, basePath, baseSha256: sha(fs.readFileSync(basePath)), candidatePath,
  candidateSha256: sha(fs.readFileSync(candidatePath)), originalFinding: { runId: run.id, stageId: stage.id, check: finding, sha256: hash(finding) },
  conflicts, changedDefinition: { before: beforePrimary, after: primary }, removedDefinition, resolutions,
  retainedResourceRulesIdentical: true, otherWorldFieldsIdentical: true, storyAndPlanIdentical: true,
  validation, blockersUnchanged: 41, modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'Candidate only. Resource resolution was already unique before the change; no double payment is alleged. Removed redundant definition remains in the saved baseline and production history. Full world review is still on the original input, not this candidate.' };
fs.writeFileSync('docs/audits/2026-10-17-design69-terminology-candidate.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidatePath, candidateSha256: proof.candidateSha256, conflicts: conflicts.length,
  valid: validation.valid, blockersUnchanged: validation.blockers.length, resolutions, productionWrites: 0 }));
