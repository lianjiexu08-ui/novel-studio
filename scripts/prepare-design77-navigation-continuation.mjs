// Bind a fresh continuation baseline after the source-navigation rechecks.
// Preparation is read-only for production: it snapshots the database and
// records the four mutable review runs before the next bounded segment.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const read = file => JSON.parse(fs.readFileSync(file));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hash = value => createHash('sha256').update(JSON.stringify(value, (_, v) => v instanceof Map ? [...v] : v)).digest('hex');
const source = 'data/audit-runtimes/design77-navigation-execution/result.json';
const proofPath = 'docs/audits/2026-10-20-design77-navigation-rechecks-verified.json';
const bindingPath = 'data/audit-runtimes/design77-navigation-runtime-bound.json';
const control = 'data/audit-runtimes/design77-navigation-continuation';
assert.ok(!fs.existsSync(control), 'Never overwrite a prior continuation');
const state = read(source), proof = read(proofPath), binding = read(bindingPath);
assert.equal(state.status, 'completed');
assert.equal(state.runs.length, 4); assert.equal(state.notes.length, 3);
assert.equal(proof.verified, true); assert.equal(proof.newCalls, 3);
fs.mkdirSync(control, { recursive: true }); fs.mkdirSync(`${control}/predecessors`);
const save = (name, value) => fs.writeFileSync(`${control}/${name}`, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', flush: true });
const copy = (from, to) => fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
copy(source, `${control}/predecessors/navigation-rechecks-result.json`);
copy(proofPath, `${control}/predecessors/navigation-rechecks-verified.json`);
copy(bindingPath, `${control}/predecessors/runtime-bound.json`);
const inputs = Object.fromEntries(state.runs.map(run => [run.input.area, run.input]));
save('inputs.json', inputs);
const database = path.resolve(control, 'baseline.db');
execFileSync('python3', ['-c', "import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()", path.resolve('data/novel-studio.db'), database]);
const { PrismaClient } = createRequire(`${binding.runtimePath}/package.json`)('@prisma/client');
const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const client = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
const repo = new PrismaWorkRepository(client);
try {
  const work = await repo.get(state.workId); assert.ok(work);
  assert.equal(work.designReviewRuns.size, 103); assert.equal(work.designReviewAnnotations.size, 44); assert.equal(work.designContentReviews.size, 92);
  for (const run of state.runs) assert.deepEqual(work.designReviewRuns.get(run.id), run);
  for (const note of state.notes) assert.deepEqual(work.designReviewAnnotations.get(note.id), note);
  const mutableIds = new Set(state.runs.map(run => run.id));
  const protectedHash = hash(Object.fromEntries(Object.entries(work).filter(([key]) => !['designReviewRuns', 'designContentReviews', 'constraintRevision'].includes(key)).map(([key, value]) => [key, value instanceof Map ? [...value] : value])));
  const baseline = {
    workId: state.workId, planId: state.runs[0].input.scope.planRevisionId, inputHash: state.runs[0].input.inputHash,
    sourceCommit: binding.sourceCommit, runtimePath: binding.runtimePath, runtimeBindingSha256: sha(bindingPath),
    sourceProofSha256: sha(proofPath), predecessorResultSha256: sha(source), inputsSha256: sha(`${control}/inputs.json`),
    protectedHash, mutableRuns: [...mutableIds],
    oldRuns: [...work.designReviewRuns].filter(([id]) => !mutableIds.has(id)).map(([id, run]) => [id, hash(run)]),
    oldReports: [...work.designContentReviews].map(([id, report]) => [id, hash(report)]),
    oldAnnotations: [...work.designReviewAnnotations].map(([id, note]) => [id, hash(note)]),
    maxCalls: 4, previousCalls: 0, createdAt: new Date().toISOString(), databaseSnapshotPath: database,
    preservedRuns: 103, preservedReports: 92, preservedAnnotations: 44, modelCalls: 0, productionWrites: 0,
  };
  save('baseline.json', baseline);
  save('result.json', { status: 'prepared_continuation', pid: null, segment: 0, scope: { workId: state.workId, planId: baseline.planId },
    inputHash: baseline.inputHash, model: state.model, fallback: false, maxCalls: baseline.maxCalls, previousCalls: 0,
    totalCalls: 0, areas: state.runs.map(run => ({ area: run.input.area, runId: run.id })), runs: state.runs,
    reports: state.reports, sourceCommit: binding.sourceCommit, formalAcceptance: false, proseGenerated: false });
  save('preflight.json', { verified: true, sourceCommit: binding.sourceCommit, baselineSha256: sha(`${control}/baseline.json`),
    checkpointSha256: sha(`${control}/result.json`), inputHash: baseline.inputHash, protectedHash, mutableRuns: [...mutableIds],
    preservedRuns: 103, preservedReports: 92, preservedAnnotations: 44, modelCalls: 0, productionWrites: 0,
    formalAcceptance: false, proseGenerated: false, next: 'Run a bounded continuation segment with the current gpt-5.6-luna connection.' });
  console.log(JSON.stringify({ prepared: true, control, preservedRuns: 103, preservedReports: 92, preservedAnnotations: 44, maxCalls: 4 }));
} finally { await repo.disconnect(); await client.$disconnect(); }
