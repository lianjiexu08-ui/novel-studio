import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayDesignReviewPrefix } from '../../scripts/audit-design-reviews.mjs';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const binding = read('data/audit-runtimes/design64-runtime-bound.json');
const baseline = read('data/audit-runtimes/design64-control/baseline.json');
const checkpointPath = 'data/audit-runtimes/design64-control/power-arithmetic-checkpoint.json';
const checkpoint = read(checkpointPath), run = checkpoint.runs.find(r => r.input.area === 'power');
assert.equal(run.input.inputHash, baseline.inputHash);
assert.equal(checkpoint.runtimeCommit, binding.commit);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(binding.root + '/' + p), h);
const stages = await import(binding.root + '/novel-service-core/src/design-review-run.ts');
const { JsonDesignPlanner } = await import(binding.root + '/packages/planner/src/index.ts');
const replay = await replayDesignReviewPrefix(run, run.input, { ...stages, JsonDesignPlanner });
const stage = run.stages.find(s => s.id === 'cross-1-3');
const check = stage.result.checks.find(c => c.criterion === 'costs');
assert.equal(check.verdict, 'revise');
const source = run.input.sources.find(s => s.id === 'world/axioms/ax_11');
const axiom = JSON.parse(source.text);
const appliedPath = 'data/design-candidates/design64-receipt-exception-draft-v7.json';
assert.equal(fileHash(appliedPath), checkpoint.candidateFileSha256);
assert.deepEqual(axiom, read(appliedPath).worldPack.axioms.find(a => a.id === axiom.id));
const quoted = check.evidence.filter(e => e.quote.includes('447/365'));
assert.equal(quoted.length, 1);
const unit = run.units.find(u => u.id === quoted[0].sourceId);
assert.equal(unit.sourceId, source.id);
assert.ok(source.text.slice(unit.start, unit.end).includes(quoted[0].quote));
// Extract every numeric term from the actual frozen authored sentence.
const terms = axiom.content.match(/第(\d+)日诊断(\d+)元载，扣(\d+)\/(\d+)自然流逝、凝元(\d+)、玄府(\d+)，加历史两剂灵泉(\d+)/);
const closing = axiom.content.match(/玄府(\d+\.\d+)元载下界，起算第(\d+)日/);
assert.ok(terms && closing);
const [startingDay, startingLife, elapsed, denominator, firstDebit, secondDebit, income] = terms.slice(1).map(BigInt);
assert.equal(BigInt(closing[2]) - startingDay, elapsed);
const numerator = (startingLife - firstDebit - secondDebit + income) * denominator - elapsed;
const calculated = Number(numerator) / Number(denominator), declared = Number(closing[1]);
assert.ok(Math.abs(calculated - declared) < 0.5e-6);
assert.equal(numerator, 1013n); assert.equal(denominator, 365n);
const proof = { kind: 'manual_lifespan_arithmetic_dispute', observedAt: new Date().toISOString(), inputHash: run.input.inputHash,
  runId: run.id, stageId: stage.id, checkpointPath, checkpointSha256: fileHash(checkpointPath),
  runtimeCommit: binding.commit, sourceFilesVerified: Object.keys(binding.sourceHashes).length, replay,
  originalCheck: check, resultSha256: hash(stage.result), modelResponsesSha256: hash(stage.modelResponses),
  source: { id: source.id, sha256: hash(source), quote: terms[0], declaredQuote: closing[0],
    originalEvidence: quoted[0], sourceUnit: unit },
  terms: { startingDay: Number(startingDay), closingDay: Number(closing[2]), startingLife: Number(startingLife),
    naturalElapsedDays: Number(elapsed), daysPerLifeYear: Number(denominator),
    advancementDebits: [Number(firstDebit), Number(secondDebit)], completedCourseIncome: Number(income) },
  formula: '7 - 447/365 - 3 - 10 + 10 = 1013/365', exactRational: '1013/365', calculated, declared,
  roundedToSixDecimals: calculated.toFixed(6),
  assessment: '冻结原文起点、两笔晋阶支出、两剂收入与自然流逝相加确为2.775342（六位小数）。模型提出12.775342的结论与原式不符；不应据此修改正确余额。保留负面报告并在四领域最终核对时定向复评。',
  productionWrites: 0, modelCalls: 0, formalVerdictsOverridden: false, questionsResolved: 0, designApproved: false,
  limitation: '仅核实被质疑的起算公式与来源绑定，不证明疗程、收入来源、伤情、资格、高阶整条路径或实际正文已完成；不替代正式语义复评。' };
fs.writeFileSync('docs/audits/2026-10-16-design64-lifespan-dispute.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ exact: proof.exactRational, rounded: proof.roundedToSixDecimals, replayedStages: replay.completedStages, responses: replay.responsesReplayed, formalVerdictsOverridden: false }));
