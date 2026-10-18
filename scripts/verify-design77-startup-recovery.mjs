import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const oldRoot = 'data/audit-runtimes/design77-review', newRoot = 'data/audit-runtimes/design77-shared-review';
const old = read(`${oldRoot}/baseline.json`), current = read(`${newRoot}/baseline.json`);
assert.equal(sha(`${oldRoot}/runner.mjs`), old.runnerSha256);
assert.equal(sha(`${newRoot}/runner.mjs`), current.runnerSha256);
assert.ok(!fs.existsSync(`${oldRoot}/result.json`));
assert.ok(!fs.existsSync(`${oldRoot}/model-calls`));
const failurePath = `${oldRoot}/startup-failure.log`, failure = fs.readFileSync(failurePath, 'utf8');
assert.match(failure, /P1008/);
assert.match(failure, /run-design77-review.mjs:39:16/);
for (const key of ['inputHash', 'protectedHash', 'constraintRevision', 'oldRuns', 'oldReports', 'oldAnnotations', 'runtimeBindingSha256', 'inputsSha256', 'guidanceHash', 'suffixSha256']) assert.deepEqual(current[key], old[key], key);
assert.deepEqual(read(`${newRoot}/inputs.json`), read(`${oldRoot}/inputs.json`));
const tests = fs.readFileSync('/tmp/novel-design77-shared-host-tests.log', 'utf8');
assert.match(tests, /pass 1/); assert.match(tests, /fail 0/);
fs.copyFileSync('/tmp/novel-design77-shared-host-tests.log', `${newRoot}/shared-host-tests.log`, fs.constants.COPYFILE_EXCL);
const result = { verified: true, failurePath, failureSha256: sha(failurePath), originalRunnerSha256: old.runnerSha256,
  recoveredRunnerSha256: current.runnerSha256, originalBaselineSha256: sha(`${oldRoot}/baseline.json`),
  recoveredBaselineSha256: sha(`${newRoot}/baseline.json`), hostHelperSha256: current.hostHelperSha256,
  sharedHostTestSha256: sha(`${newRoot}/shared-host-tests.log`), identicalInputsAndPromptAdditions: true,
  originalFailedBeforeFirstWorkRead: true, originalModelCalls: 0, originalReviewTasksCreated: 0,
  protectedStateAndOldReviewsUnchangedAtRecoveryPreparation: true,
  recovery: 'Use the existing per-client transaction queue through one shared repository for UI and review; no timeout extension or model retry.',
  formalAcceptance: false };
fs.writeFileSync('docs/audits/2026-10-18-design77-startup-recovery.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ verified: true, originalModelCalls: 0, inputsPreserved: true, sharedHostTestPassed: true }));
