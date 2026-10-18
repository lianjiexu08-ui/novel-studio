// Rehearse and atomically append two independent clarifications. Never change
// model verdicts or design fields, and never run beside the formal worker.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v) ?? 'undefined').digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const rehearse = process.argv.includes('--rehearse'), apply = process.argv.includes('--apply');
assert.notEqual(rehearse, apply, 'Choose --rehearse or --apply');
const preparedPath = 'docs/audits/2026-10-18-design76-segment22-annotation-inputs.json', prepared = read(preparedPath);
const payload = read(prepared.outputPath); assert.equal(hash(payload), prepared.outputSha256);
assert.equal(payload.annotations.length, 2);
const verification = read(prepared.verificationPath);
assert.equal(fileHash(prepared.verificationPath), prepared.verificationSha256);
const checkpointPath = 'data/audit-runtimes/design76-notes21-review/result.json', checkpoint = read(checkpointPath);
assert.equal(fileHash(checkpointPath), verification.checkpointSha256);
assert.equal(verification.workerAbsent, true); assert.equal(checkpoint.segment, 22);
try { process.kill(checkpoint.pid, 0); assert.fail('Formal worker still live'); } catch (e) { assert.equal(e.code, 'ESRCH'); }
const bindingPath = 'data/audit-runtimes/design76-fragment-index-runtime-bound.json', binding = read(bindingPath);
for (const [p,h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(`${binding.runtimePath}/${p}`), h);
for (const [p,h] of Object.entries(binding.dependencyHashes)) assert.equal(fileHash(p), h);
const {PrismaClient} = createRequire(`${binding.runtimePath}/package.json`)('@prisma/client');
const {PrismaWorkRepository} = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const {annotationSources, recordDesignReviewAnnotation} = await import(`${binding.runtimePath}/novel-service-core/src/design-review-annotations.ts`);
const rehearsalPath = 'docs/audits/2026-10-18-design76-segment22-notes-rehearsal.json';
const outputPath = apply ? 'docs/audits/2026-10-18-design76-segment22-notes-applied.json' : rehearsalPath;
assert.ok(!fs.existsSync(outputPath), 'Preserve completed evidence');
const control = fs.mkdtempSync(path.resolve('data/audit-runtimes', apply ? 'design76-notes22-apply-' : 'design76-notes22-rehearsal-'));
const backup = (source, target) => execFileSync('python3', ['-c', "import sqlite3,sys; a=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()", source, target]);
const snapshotSha256 = fileHash(verification.databaseSnapshotPath);
let database;
if (rehearse) { database = path.join(control, 'private.db'); backup(verification.databaseSnapshotPath, database); }
else {
  const rehearsal = read(rehearsalPath); assert.equal(rehearsal.verified, true);
  assert.equal(rehearsal.runnerSha256, fileHash(process.argv[1]));
  assert.equal(rehearsal.preparedSha256, fileHash(preparedPath));
  assert.equal(rehearsal.runtimeBindingSha256, fileHash(bindingPath));
  database = path.resolve('data/novel-studio.db'); backup(database, path.join(control, 'before.db'));
}
const digests = work => Object.fromEntries(Object.keys(work).filter(k => k !== 'designReviewAnnotations').sort().map(k => {
  const v = work[k]; return [k, hash(v instanceof Map ? [...v].map(([id, value]) => [id, hash(value)]) : v)];
}));
const open = () => { const client = new PrismaClient({datasources: {db: {url: 'file:' + database}}}); return {client, repository: new PrismaWorkRepository(client)}; };
let {client, repository} = open(), beforeDigests, oldNotes, oldRuns, oldReports, notes;
try {
  let before = await repository.get(payload.workId); assert.ok(before);
  for (const run of checkpoint.runs) assert.equal(hash(before.designReviewRuns.get(run.id)), hash(run));
  beforeDigests = digests(before); oldNotes = [...before.designReviewAnnotations].map(([id, n]) => [id, hash(n)]);
  oldRuns = before.designReviewRuns.size; oldReports = before.designContentReviews.size;
  assert.deepEqual(oldNotes, read('data/audit-runtimes/design76-notes21-review/baseline.json').annotations);
  if (apply) assert.deepEqual(beforeDigests, read(rehearsalPath).preservedWorkFieldDigests, 'Production baseline changed since rehearsal');
  for (const input of payload.annotations) {
    annotationSources(before, input);
    assert.ok(![...before.designReviewAnnotations.values()].some(n => n.runId === input.runId && n.requestKey === input.requestKey), 'Inspect partial or repeated import');
  }
  fs.writeFileSync(path.join(control, 'intent.json'), JSON.stringify({database, workId: payload.workId, beforeDigests, oldNotes, annotations: payload.annotations}, null, 2) + '\n', {flag: 'wx'});
  before = undefined;
  if (rehearse) {
    const invalid = [...structuredClone(payload.annotations), {...structuredClone(payload.annotations.at(-1)), requestKey: 'invalid-rollback-probe', expectedCheckHash: '0'.repeat(64)}];
    await assert.rejects(repository.transaction(payload.workId, ({work}) => invalid.map(input => recordDesignReviewAnnotation(work, input))), /原判定/);
    let rolledBack = await repository.get(payload.workId);
    assert.deepEqual(digests(rolledBack), beforeDigests);
    assert.deepEqual([...rolledBack.designReviewAnnotations].map(([id,n]) => [id,hash(n)]), oldNotes);
    rolledBack = undefined;
  }
  notes = await repository.transaction(payload.workId, ({work}) => payload.annotations.map(input => recordDesignReviewAnnotation(work, input)));
  if (rehearse) assert.deepEqual(await repository.transaction(payload.workId, ({work}) => payload.annotations.map(input => recordDesignReviewAnnotation(work, input))), notes);
} finally { await repository.disconnect(); await client.$disconnect(); }
({client, repository} = open());
let proof;
try {
  const after = await repository.get(payload.workId); assert.ok(after);
  assert.deepEqual(digests(after), beforeDigests, 'A field outside annotations changed');
  for (const [id,h] of oldNotes) assert.equal(hash(after.designReviewAnnotations.get(id)), h);
  assert.equal(after.designReviewAnnotations.size, oldNotes.length + notes.length);
  for (const note of notes) {
    assert.deepEqual(after.designReviewAnnotations.get(note.id), note);
    const actual = annotationSources(after, note).map(s => ({id: s.id, sha256: hash(s)}));
    assert.deepEqual(actual, prepared.sourceDigests.find(s => s.requestKey === note.requestKey).sources);
  }
  proof = {kind: apply ? 'design76_segment22_notes_appended' : 'design76_segment22_notes_private_rehearsal', verified: true,
    createdAt: new Date().toISOString(), runnerSha256: fileHash(process.argv[1]), preparedSha256: fileHash(preparedPath),
    runtimeBindingSha256: fileHash(bindingPath), baseCheckpointSha256: verification.checkpointSha256,
    database, control, workId: payload.workId, notes, preservedWorkFieldDigests: beforeDigests,
    oldRunsPreserved: oldRuns, oldReportsPreserved: oldReports, oldAnnotationsPreserved: oldNotes.length,
    annotationsAdded: notes.length, restartReadback: true, rollbackExercised: rehearse, idempotenceExercised: rehearse,
    modelCalls: 0, productionWrites: apply ? 1 : 0, verdictChanges: 0, questionsResolved: 0, formalAcceptance: false};
} finally { await repository.disconnect(); await client.$disconnect(); }
assert.equal(fileHash(verification.databaseSnapshotPath), snapshotSha256);
fs.writeFileSync(outputPath, JSON.stringify(proof, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({verified: true, rehearsal: rehearse, annotations: notes.length, oldRuns, oldReports, productionWrites: proof.productionWrites}));
