import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayDesignReviewPrefix } from '../../scripts/audit-design-reviews.mjs';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const binding = read('data/audit-runtimes/design64-runtime-bound.json');
const baseline = read('data/audit-runtimes/design64-control/baseline.json');
const checkpointPath = 'data/audit-runtimes/design64-control/advancement-date-checkpoint.json';
fs.copyFileSync('data/audit-runtimes/design64-control/result.json', checkpointPath, fs.constants.COPYFILE_EXCL);
const checkpoint = read(checkpointPath), run = checkpoint.runs.find(r => r.input.area === 'power');
assert.equal(run.input.inputHash, baseline.inputHash); assert.equal(checkpoint.runtimeCommit, binding.commit);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(binding.root + '/' + p), h);
const stages = await import(binding.root + '/novel-service-core/src/design-review-run.ts');
const { JsonDesignPlanner } = await import(binding.root + '/packages/planner/src/index.ts');
const replay = await replayDesignReviewPrefix(run, run.input, { ...stages, JsonDesignPlanner });
const stage = run.stages.find(s => s.id === 'cross-1-5'), check = stage.result.checks.find(c => c.criterion === 'costs');
assert.equal(check.verdict, 'revise');
const source = run.input.sources.find(s => s.id === 'plan/milestones/ms_v3_advancement');
const milestone = JSON.parse(source.text);
const appliedPath = 'data/design-candidates/design64-receipt-exception-draft-v7.json';
assert.equal(fileHash(appliedPath), checkpoint.candidateFileSha256);
assert.deepEqual(milestone, read(appliedPath).plan.milestones.find(m => m.id === milestone.id));
const evidence = check.evidence.find(e => e.quote.includes('2.915068')); assert.ok(evidence);
const unit = run.units.find(u => u.id === evidence.sourceId); assert.equal(unit.sourceId, source.id);
assert.ok(source.text.slice(unit.start, unit.end).includes(evidence.quote));
const formula = milestone.setup[0].match(/余(\d+)-\((\d+)-(\d+)\)\/(\d+)-(\d+)\+(\d+)-(\d+)=(\d+\.\d+)/);
assert.ok(formula);
const [start, day, startingDay, denominator, firstDebit, income, secondDebit] = formula.slice(1, 8).map(BigInt);
const numerator = (start - firstDebit + income - secondDebit) * denominator - (day - startingDay);
assert.equal(day, 415n); assert.equal(startingDay, 19n); assert.equal(numerator, 1064n);
const computed = Number(numerator) / Number(denominator), declared = Number(formula[8]);
assert.ok(Math.abs(computed - declared) < 0.5e-6);
const finalDay = 466n, finalNumerator = numerator - (finalDay - day);
assert.equal(finalNumerator, 1013n);
assert.equal((Number(finalNumerator) / Number(denominator)).toFixed(6), '2.775342');
assert.ok(check.explanation.includes('7-(466-19)/365-3+10-10=2.915068'));
assert.ok(!source.text.includes('7-(466-19)/365-3+10-10=2.915068'));
const proof = { kind: 'manual_advancement_date_misquotation_dispute', observedAt: new Date().toISOString(), inputHash: run.input.inputHash,
  runId: run.id, stageId: stage.id, checkpointPath, checkpointSha256: fileHash(checkpointPath), runtimeCommit: binding.commit,
  replay, originalCheck: check, resultSha256: hash(stage.result), modelResponsesSha256: hash(stage.modelResponses),
  source: { id: source.id, sha256: hash(source), field: 'setup[0]', quote: milestone.setup[0], originalEvidence: evidence, sourceUnit: unit },
  sourceFormula: formula[0], modelMisquotation: '7-(466-19)/365-3+10-10=2.915068',
  arithmetic: { day415: { exact: '1064/365', calculated: computed, rounded: computed.toFixed(6) },
    subsequentElapsedDays: 51, day466: { exact: '1013/365', calculated: Number(finalNumerator) / Number(denominator), rounded: '2.775342' } },
  assessment: '模型解释把原文415改述为466。415日晋阶后2.915068与466日2.775342相差51/365自然流逝，彼此相容。保留原负面，不按该误述改动日期或预算。',
  productionWrites: 0, modelCalls: 0, formalVerdictsOverridden: false, questionsResolved: 0, designApproved: false,
  limitation: '仅核实该负面意见引用的日期、公式与余额关系，不证明健康、资格、药程、战斗成本或正文已兑现。四领域结束后须定向复评。' };
fs.writeFileSync('docs/audits/2026-10-16-design64-advancement-date-dispute.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ sourceDay: Number(day), modelMisquotedDay: 466, day415: computed.toFixed(6), day466: '2.775342', replayedStages: replay.completedStages, responses: replay.responsesReplayed }));
