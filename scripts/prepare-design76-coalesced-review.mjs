// Continue the same model review after the verified note-only append and an
// API-only runtime change. Historical prompts and raw journals stay intact.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v) ?? 'undefined').digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const previous = 'data/audit-runtimes/design76-citation-edits-review', control = 'data/audit-runtimes/design76-coalesced-review';
assert.ok(!fs.existsSync(control), 'Preserve an existing continuation');
const predecessorCheckpointPath = `${previous}/result.json`, state = read(predecessorCheckpointPath);
assert.equal(state.segment, 8); assert.equal(state.status, 'stopped_by_signal');
try { process.kill(state.pid, 0); assert.fail('Worker still live'); } catch (e) { assert.equal(e.code, 'ESRCH'); }
const predecessorVerificationPath = 'docs/audits/2026-10-18-design76-citation-edits-review-segment-8.json';
const verification = read(predecessorVerificationPath);
assert.equal(fileHash(predecessorCheckpointPath), verification.checkpointSha256);
assert.equal(verification.workerAbsent, true); assert.equal(verification.unsettledCalls, 0);
const priorBaseline = read(`${previous}/baseline.json`);
const notesPath = 'docs/audits/2026-10-18-design76-segment8-notes-applied.json', notes = read(notesPath);
assert.equal(notes.verified, true); assert.equal(notes.baseCheckpointSha256, verification.checkpointSha256);
assert.equal(notes.annotationsAdded, 7); assert.equal(notes.verdictChanges, 0); assert.equal(notes.productionWrites, 1);
const runtimeProofPath = 'docs/audits/2026-10-18-design76-coalesced-api-runtime-preparation.json', runtimeProof = read(runtimeProofPath);
const bindingPath = runtimeProof.nextBindingPath, binding = read(bindingPath);
assert.equal(fileHash(bindingPath), runtimeProof.nextBindingSha256);
assert.equal(notes.runtimeBindingSha256, fileHash(bindingPath));
for (const [p,h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(`${binding.runtimePath}/${p}`), h);
for (const [p,h] of Object.entries(binding.dependencyHashes)) assert.equal(fileHash(p), h);
// Byte-for-byte equivalence except fixed control/binding/predecessor locations.
for (const kind of ['run','verify']) {
  const original = fs.readFileSync(`scripts/${kind}-design76-citation-edits-review.mjs`, 'utf8');
  const expected = original.replaceAll('design76-citation-edits-review', 'design76-coalesced-review')
    .replaceAll('design76-citation-operations-runtime-bound.json', 'design76-coalesced-api-runtime-bound.json')
    .replaceAll('scripts/run-design76-citation-review.mjs', 'scripts/run-design76-citation-edits-review.mjs');
  assert.equal(fs.readFileSync(`scripts/${kind}-design76-coalesced-review.mjs`, 'utf8'), expected);
}
assert.equal(fileHash('scripts/run-design76-citation-edits-review.mjs'), priorBaseline.runnerSha256);
assert.equal(fileHash('scripts/shared-review-host.mjs'), priorBaseline.hostHelperSha256);
assert.equal(fileHash(`${previous}/inputs.json`), priorBaseline.inputsSha256);
fs.mkdirSync(control); fs.mkdirSync(`${control}/model-calls`);
const copy = (from,to) => fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);
copy(predecessorCheckpointPath,`${control}/predecessor.json`); copy(predecessorCheckpointPath,`${control}/result.json`);
copy(`${previous}/inputs.json`,`${control}/inputs.json`);
const prefixJournal = {};
for (const name of fs.readdirSync(`${previous}/model-calls`).filter(n=>n.endsWith('.json')).sort()) {
  copy(`${previous}/model-calls/${name}`,`${control}/model-calls/${name}`); prefixJournal[name] = fileHash(`${control}/model-calls/${name}`);
}
assert.equal(Object.keys(prefixJournal).filter(n=>n.endsWith('.started.json')).length,state.totalCalls);
const database = path.resolve(control,'baseline.db');
execFileSync('python3',['-c',"import sqlite3,sys; a=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()",path.resolve('data/novel-studio.db'),database]);
const {PrismaClient} = createRequire(`${binding.runtimePath}/package.json`)('@prisma/client');
const {PrismaWorkRepository} = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const client = new PrismaClient({datasources:{db:{url:'file:'+database}}}), repository = new PrismaWorkRepository(client);
let annotations;
try {
  const work = await repository.get(priorBaseline.workId); assert.ok(work);
  const digests = Object.fromEntries(Object.keys(work).filter(k=>k!=='designReviewAnnotations').sort().map(k=>{
    const value=work[k];return[k,hash(value instanceof Map?[...value].map(([id,v])=>[id,hash(v)]):value)];
  }));
  assert.deepEqual(digests, notes.preservedWorkFieldDigests);
  for (const [id,h] of priorBaseline.annotations) assert.equal(hash(work.designReviewAnnotations.get(id)), h);
  for (const note of notes.notes) assert.deepEqual(work.designReviewAnnotations.get(note.id), note);
  assert.equal(work.designReviewAnnotations.size,priorBaseline.annotations.length+7);
  for (const run of state.runs) assert.deepEqual(work.designReviewRuns.get(run.id),run);
  annotations=[...work.designReviewAnnotations].map(([id,n])=>[id,hash(n)]);
} finally { await repository.disconnect(); await client.$disconnect(); }
const baseline={...priorBaseline,createdAt:new Date().toISOString(),runtimePath:binding.runtimePath,runtimeBindingSha256:fileHash(bindingPath),
  runnerSha256:fileHash('scripts/run-design76-coalesced-review.mjs'),predecessorRunnerSha256:priorBaseline.runnerSha256,
  predecessorCheckpointPath,predecessorCheckpointSha256:fileHash(predecessorCheckpointPath),
  predecessorVerificationPath,predecessorVerificationSha256:fileHash(predecessorVerificationPath),
  predecessorCallCount:state.totalCalls,predecessorRuntimeBindingPath:runtimeProof.originalBindingPath,
  predecessorRuntimeBindingSha256:runtimeProof.originalBindingSha256,annotations,prefixJournal,
  annotationAppendPath:notesPath,annotationAppendSha256:fileHash(notesPath)};
fs.writeFileSync(`${control}/baseline.json`,JSON.stringify(baseline,null,2)+'\n',{flag:'wx'});
const proof={kind:'design76_coalesced_review_preflight',prepared:true,control,databaseSnapshotPath:database,
  baselineSha256:fileHash(`${control}/baseline.json`),predecessorCheckpointSha256:baseline.predecessorCheckpointSha256,
  predecessorVerificationSha256:baseline.predecessorVerificationSha256,runtimeProofPath,runtimeProofSha256:fileHash(runtimeProofPath),
  notesPath,notesSha256:fileHash(notesPath),annotationsPreserved:annotations.length,prefixCalls:state.totalCalls,
  runIds:state.runs.map(r=>r.id),unchangedReviewSchedulingPromptsAndValidation:true,plannerEpochs:baseline.plannerEpochs,
  modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Preflight replay, service startup and live UI verification remain required. Only API concurrent reads and independent annotations change; design and verdicts remain unchanged.'};
fs.writeFileSync('docs/audits/2026-10-18-design76-coalesced-review-preflight.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({prepared:true,prefixCalls:state.totalCalls,annotations:annotations.length,resumeSha256:baseline.predecessorCheckpointSha256}));
