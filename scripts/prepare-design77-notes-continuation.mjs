// Bind an append-only annotation change without changing any review input,
// schedule, prompt, accepted stage, report, or original baseline.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const read = p => JSON.parse(fs.readFileSync(p));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash = value => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
const previous = 'data/audit-runtimes/design77-shared-review';
const control = 'data/audit-runtimes/design77-notes-continuation';
const prior = read(`${previous}/baseline.json`);
const verificationPath = 'docs/audits/2026-10-18-design77-shared-review-segment-1.json';
const verification = read(verificationPath), state = read(`${previous}/result.json`);
const notesPath = 'docs/audits/2026-10-18-design77-segment1-notes-applied.json', notes = read(notesPath);
const bindingPath = 'data/audit-runtimes/design77-runtime-bound.json', binding = read(bindingPath);
assert.equal(sha(`${previous}/result.json`), verification.checkpointSha256);
assert.equal(state.status, 'stopped_after_stage_limit'); assert.equal(state.segment, 1);
assert.equal(verification.workerAbsent, true); assert.equal(verification.unsettledCalls, 0);
try { process.kill(state.pid, 0); assert.fail('Review worker still live'); } catch (e) { assert.equal(e.code, 'ESRCH'); }
assert.equal(notes.verified, true); assert.equal(notes.baseCheckpointSha256, verification.checkpointSha256);
assert.equal(notes.annotationsAdded, 2); assert.equal(notes.oldAnnotationsPreserved, 37);
assert.equal(notes.verdictChanges, 0); assert.equal(notes.runtimeBindingSha256, sha(bindingPath));
assert.equal(prior.runtimeBindingSha256, sha(bindingPath));
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(sha(`${binding.runtimePath}/${p}`), h);
for (const [p, h] of Object.entries(binding.dependencyHashes)) assert.equal(sha(p), h);
assert.equal(sha('scripts/run-design77-shared-review.mjs'), prior.runnerSha256);
assert.equal(sha(`${previous}/inputs.json`), prior.inputsSha256);

// The only runner changes are the destination and the count of saved live
// annotations. The original frozen inputs are still compared on every step.
const runner = fs.readFileSync('scripts/run-design77-shared-review.mjs', 'utf8')
  .replaceAll('design77-shared-review', 'design77-notes-continuation')
  .replace('assert.equal(work.designReviewAnnotations.size,37);', 'assert.equal(work.designReviewAnnotations.size,39);');
assert.equal(fs.readFileSync('scripts/run-design77-notes-continuation.mjs', 'utf8'), runner);
assert.ok(!fs.existsSync(control), 'Never overwrite a prior continuation');
fs.mkdirSync(control); fs.mkdirSync(`${control}/model-calls`);
const copy = (a, b) => fs.copyFileSync(a, b, fs.constants.COPYFILE_EXCL);
copy(`${previous}/result.json`, `${control}/predecessor.json`);
copy(`${previous}/result.json`, `${control}/result.json`);
copy(`${previous}/inputs.json`, `${control}/inputs.json`);
copy('scripts/run-design77-notes-continuation.mjs', `${control}/runner.mjs`);
const prefixJournal = {};
for (const entry of verification.journal) {
  const name = String(entry.callNumber).padStart(5, '0');
  for (const suffix of ['started', 'response']) {
    const file = `${name}.${suffix}.json`;
    const expected = suffix === 'started' ? entry.startSha256 : entry.outcomeSha256;
    assert.equal(sha(`${previous}/model-calls/${file}`), expected);
    copy(`${previous}/model-calls/${file}`, `${control}/model-calls/${file}`);
    prefixJournal[file] = sha(`${control}/model-calls/${file}`);
  }
}
assert.equal(Object.keys(prefixJournal).length, state.totalCalls * 2);
const database = path.resolve(control, 'baseline.db');
execFileSync('python3', ['-c', "import sqlite3,sys; a=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()", path.resolve('data/novel-studio.db'), database]);
const { PrismaClient } = createRequire(`${binding.runtimePath}/package.json`)('@prisma/client');
const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const client = new PrismaClient({ datasources: { db: { url: `file:${database}` } } }), repo = new PrismaWorkRepository(client);
let protectedHash, annotations;
try {
  const work = await repo.get(prior.workId); assert.ok(work);
  const digests = Object.fromEntries(Object.keys(work).filter(k => k !== 'designReviewAnnotations').sort().map(k => {
    const v = work[k]; return [k, hash(v instanceof Map ? [...v].map(([id, value]) => [id, hash(value)]) : v)];
  }));
  assert.deepEqual(digests, notes.preservedWorkFieldDigests);
  for (const [id, h] of prior.oldRuns) assert.equal(hash(work.designReviewRuns.get(id)), h);
  for (const [id, h] of prior.oldReports) assert.equal(hash(work.designContentReviews.get(id)), h);
  for (const run of state.runs) assert.deepEqual(work.designReviewRuns.get(run.id), run);
  assert.equal(work.designReviewRuns.size, prior.oldRuns.length + state.runs.length);
  assert.equal(work.designContentReviews.size, prior.oldReports.length + state.reports.length);
  for (const [id, h] of prior.oldAnnotations) assert.equal(hash(work.designReviewAnnotations.get(id)), h);
  for (const note of notes.notes) assert.deepEqual(work.designReviewAnnotations.get(note.id), note);
  annotations = [...work.designReviewAnnotations].map(([id, note]) => [id, hash(note)]);
  assert.equal(annotations.length, 39);
  protectedHash = hash(Object.fromEntries(Object.entries(work).filter(([key]) => !['designReviewRuns', 'designContentReviews', 'constraintRevision'].includes(key)).map(([key, value]) => [key, value instanceof Map ? [...value] : value])));
  // Independently reconstruct the old protected metadata by removing exactly
  // the approved appended notes, without writing that projection anywhere.
  const originalNotes = work.designReviewAnnotations;
  work.designReviewAnnotations = new Map([...originalNotes].filter(([id]) => !notes.notes.some(note => note.id === id)));
  const originalHash = hash(Object.fromEntries(Object.entries(work).filter(([key]) => !['designReviewRuns', 'designContentReviews', 'constraintRevision'].includes(key)).map(([key, value]) => [key, value instanceof Map ? [...value] : value])));
  assert.equal(originalHash, prior.protectedHash);
} finally { await repo.disconnect(); await client.$disconnect(); }
const baseline = { ...prior, createdAt: new Date().toISOString(), protectedHash, oldAnnotations: annotations,
  runnerSha256: sha('scripts/run-design77-notes-continuation.mjs'),
  predecessorBaselinePath: `${previous}/baseline.json`, predecessorBaselineSha256: sha(`${previous}/baseline.json`),
  predecessorCheckpointPath: `${previous}/result.json`, predecessorCheckpointSha256: sha(`${previous}/result.json`),
  predecessorVerificationPath: verificationPath, predecessorVerificationSha256: sha(verificationPath),
  notesProofPath: notesPath, notesProofSha256: sha(notesPath), prefixJournal };
fs.writeFileSync(`${control}/baseline.json`, JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx' });
const proof = { verified: true, control, baselineSha256: sha(`${control}/baseline.json`),
  predecessorBaselineSha256: baseline.predecessorBaselineSha256, predecessorCheckpointSha256: baseline.predecessorCheckpointSha256,
  notesProofSha256: baseline.notesProofSha256, protectedHashBeforeNotes: prior.protectedHash, protectedHashAfterNotes: protectedHash,
  originalInputsUnchanged: true, originalRunsUnchanged: true, originalSchedulingAndPromptsUnchanged: true,
  prefixCalls: state.totalCalls, preservedAnnotations: annotations.length, databaseSnapshotPath: database,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'Continuation binding only. Later annotations remain outside original model inputs; no revise finding is resolved.' };
fs.writeFileSync('docs/audits/2026-10-18-design77-notes-continuation-preflight.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ prepared: true, prefixCalls: state.totalCalls, annotations: annotations.length, resumeSha256: baseline.predecessorCheckpointSha256 }));
