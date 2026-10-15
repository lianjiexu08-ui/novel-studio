import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { auditReviewRecoveryChain } from './audit-review-recovery-chain.mjs';

const bytes = value => JSON.stringify(value) + '\n';
const hash = value => createHash('sha256').update(bytes(value)).digest('hex');
function fixture() {
  const original = {
    status: 'completed_with_failures', protectedHistoryUnchanged: true,
    runtimeCommit: 'frozen', rubricVersion: 16, scheduleVersion: 23, scope: { plan: 63 },
    areas: [{ area: 'world', runId: 'world-run' }], maxCalls: 400, usage: { calls: 3 },
    runs: [{ id: 'world-run', status: 'failed', scheduleVersion: 23, input: { area: 'world', inputHash: 'source' }, stages: [
      { id: 'one', result: { verdict: 'revise' } },
      { id: 'two', failures: [{ response: 'malformed original response' }] },
      { id: 'three' },
    ] }], reports: [],
  };
  const first = structuredClone(original);
  Object.assign(first, { status: 'stopped_after_failure', priorCheckpointSha256: hash(original), priorUsage: { calls: 3 }, resumeUsage: { calls: 2 }, totalCalls: 5 });
  delete first.usage;
  first.runs[0].stages[1].result = { verdict: 'pass' };
  first.runs[0].stages[2].failures = [{ response: 'second interrupted response' }];
  const second = structuredClone(first);
  Object.assign(second, { status: 'completed', priorCheckpointSha256: hash(first), priorUsage: { calls: 5 }, resumeUsage: { calls: 1 }, totalCalls: 6 });
  Object.assign(second.runs[0], { status: 'completed', reportId: 'report' });
  second.runs[0].stages[2].result = { verdict: 'pass' };
  second.reports.push({ id: 'report', verdict: 'revise' });
  return [original, first, second];
}

test('validates every recovery edge without changing records or granting acceptance', () => {
  const chain = fixture(), before = bytes(chain);
  const proof = auditReviewRecoveryChain(chain.map(bytes));
  assert.deepEqual(proof.checkpoints.map(r => r.calls), [3, 5, 6]);
  assert.deepEqual(proof.checkpoints.map(r => r.completedStages), [1, 2, 3]);
  assert.equal(proof.designApproved, false);
  assert.equal(bytes(chain), before);
});

for (const [name, corrupt, error] of [
  ['omitted middle checkpoint', c => c.splice(1, 1), /Missing or modified/],
  ['modified earlier checkpoint bytes', c => { c[1].extra = 'changed'; }, /Missing or modified/],
  ['replaced input', c => { c[2].runs[0].input.inputHash = 'other'; }, /review input/],
  ['removed recovery-completed result', c => { delete c[2].runs[0].stages[1].result; }, /Completed stage/],
  ['rewritten adverse result', c => { c[2].runs[0].stages[0].result.verdict = 'pass'; }, /Completed stage/],
  ['lost recovery failure', c => { c[2].runs[0].stages[2].failures = []; }, /failure history/],
  ['reordered failed responses', c => { c[2].runs[0].stages[2].failures.unshift({ response: 'new' }); }, /failure history/],
  ['reset usage', c => { c[2].priorUsage.calls = 0; }, /earlier usage/],
  ['wrong total usage', c => { c[2].totalCalls++; }, /cumulative usage/],
  ['duplicate stage', c => { c[2].runs[0].stages.push(c[2].runs[0].stages[0]); }, /duplicate/],
  ['nonterminal recovery parent', c => { c[1].status = 'running'; c[2].priorCheckpointSha256 = hash(c[1]); }, /nonterminal/],
]) {
  test(`rejects ${name}`, () => {
    const chain = fixture(); corrupt(chain);
    assert.throws(() => auditReviewRecoveryChain(chain.map(bytes)), error);
  });
}

test('does not treat a live final prefix as completed acceptance', () => {
  const chain = fixture(); chain[2].status = 'running';
  const proof = auditReviewRecoveryChain(chain.map(bytes));
  assert.equal(proof.checkpoints.at(-1).status, 'running');
  assert.equal(proof.designApproved, false);
});

test('preserves reports completed by an earlier recovery', () => {
  const chain = fixture(), last = structuredClone(chain[2]);
  Object.assign(last, { priorCheckpointSha256: hash(chain[2]), priorUsage: { calls: 6 }, resumeUsage: { calls: 0 } });
  last.reports[0].verdict = 'pass';
  assert.throws(() => auditReviewRecoveryChain([...chain, last].map(bytes)), /existing report/);
});
