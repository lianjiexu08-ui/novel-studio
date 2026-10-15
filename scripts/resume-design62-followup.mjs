import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Run from the project root whose frozen binding and checkpoints are verified below.
const root = process.cwd();
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = v => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const runtime = read(root + '/data/audit-runtimes/design62-runtime-bound.json');
const baseline = read(root + '/data/audit-runtimes/design62-control/baseline.json');
const priorPath = root + '/data/audit-runtimes/design62-control/resume-2-result.json';
const priorBytes = fs.readFileSync(priorPath, 'utf8');
const prior = JSON.parse(priorBytes);
const originalRunner = fs.readFileSync(root + '/data/audit-runtimes/design62-control/run.mjs', 'utf8');
assert.equal(hash(originalRunner), runtime.runnerSha256);
assert.equal(hash(priorBytes), '0f859c7316719fc9d043484a650f5176ebbb21688472713fc34ad52676e820cd');
assert.equal(prior.status, 'stopped_after_failure');
assert.equal(runtime.commit, prior.runtimeCommit);
assert.equal(runtime.rubricVersion, read(root + '/data/audit-runtimes/design62-control/result.json').rubricVersion);
assert.equal(runtime.scheduleVersion, read(root + '/data/audit-runtimes/design62-control/result.json').scheduleVersion);
assert.ok(prior.runs.length === 4);
for (const [p, h] of Object.entries(runtime.sourceHashes)) assert.equal(hash(fs.readFileSync(runtime.root + '/' + p, 'utf8')), h, p);
// Keep the exact dispatch suffix of the frozen original runner. This parses
// its quoted string without evaluating or executing any runner code.
const suffixLiteral = originalRunner.match(/const suffix='((?:\\.|[^'\\])*)';/)?.[1];
assert.ok(suffixLiteral);
const suffix = JSON.parse('"' + suffixLiteral.replace(/"/g, '\\"') + '"');
const execute = process.argv.includes('--execute');
const rehearsal = process.argv.includes('--rehearse-failure');
const attemptArg = process.argv.find(arg => arg.startsWith('--attempt='));
const attempt = attemptArg ? Number(attemptArg.slice('--attempt='.length)) : 1;
assert.ok(Number.isSafeInteger(attempt) && attempt >= 1 && attempt <= 100);
// A zero-dispatch failure can be retried without rebinding the original model
// checkpoint. Any actual progress or model usage requires a new bound recovery.
const previousAttempts = [];
for (let n = 1; n < attempt; n++) {
  const path = root + `/data/audit-runtimes/design62-control/followup-${n}-result.json`;
  const bytes = fs.readFileSync(path, 'utf8');
  const saved = JSON.parse(bytes);
  assert.equal(saved.status, 'stopped_after_failure');
  assert.equal(saved.rehearsal, false);
  assert.equal(saved.runtimeCommit, runtime.commit);
  assert.equal(saved.priorCheckpointSha256, hash(priorBytes));
  assert.equal(saved.resumeUsage.calls, 0, 'Model usage requires a new recovery binding');
  assert.equal(saved.stepsStarted.length, 0, 'Dispatched work requires a new recovery binding');
  assert.equal(hash(saved.runs), hash(prior.runs), 'Persisted progress requires a new recovery binding');
  previousAttempts.push({ path, sha256: hash(bytes) });
}
assert.ok(!(execute && rehearsal));
if (execute) assert.equal(process.env.DATABASE_URL, 'file:' + root + '/data/novel-studio.db');
if (rehearsal) {
  assert.ok(process.env.DATABASE_URL?.startsWith('file:/'));
  const rehearsalDb = process.env.DATABASE_URL.slice(5);
  assert.notEqual(fs.realpathSync(rehearsalDb), fs.realpathSync(root + '/data/novel-studio.db'));
  assert.notEqual(fs.statSync(rehearsalDb).ino, fs.statSync(root + '/data/novel-studio.db').ino);
}
const { PrismaWorkRepository } = await import(runtime.root + '/packages/persistence/src/prisma-repository.ts');
const { ChapterWorkflow } = await import(runtime.root + '/packages/application/src/index.ts');
const { designReviewHash } = await import(runtime.root + '/novel-service-core/src/design-review.ts');
const repo = new PrismaWorkRepository();
const workId = prior.scope.workId;
const protectedHash = w => hash({ world: w.worldPack, bible: w.storyBible, plans: [...w.plans], versions: [...w.versions], events: [...w.events], manuscripts: [...w.manuscripts], candidates: [...w.candidates] });
function verify(w, exact = false) {
  assert.equal(protectedHash(w), baseline.protectedHash);
  for (const [id, h] of baseline.oldRuns) assert.equal(hash(w.designReviewRuns.get(id)), h);
  for (const [id, h] of baseline.oldReports) assert.equal(hash(w.designContentReviews.get(id)), h);
  for (const report of prior.reports) assert.equal(hash(w.designContentReviews.get(report.id)), hash(report));
  for (const old of prior.runs) {
    const run = w.designReviewRuns.get(old.id); assert.ok(run);
    assert.equal(hash(run.input), hash(old.input));
    assert.equal(designReviewHash(w, old.input.scope.planRevisionId), old.input.inputHash);
    assert.equal(run.scheduleVersion, old.scheduleVersion);
    if (exact) assert.equal(hash(run), hash(old), 'Resume checkpoint is stale; inspect newer persisted progress before executing');
    for (const oldStage of old.stages) {
      const current = run.stages.find(s => s.id === oldStage.id); assert.ok(current);
      if (oldStage.result) assert.equal(hash(current), hash(oldStage), 'Completed stage was changed');
      const failures = oldStage.failures ?? [];
      assert.equal(hash((current.failures ?? []).slice(0, failures.length)), hash(failures));
    }
  }
}
try {
  const w = await repo.get(workId); verify(w, true);
  assert.ok(![...w.designReviewRuns.values()].some(r => r.leaseToken && Date.parse(r.leaseExpiresAt ?? '') > Date.now()));
  // Complete the untouched areas before one further attempt at the rejected
  // power response. The frozen planner and its citation validator stay intact.
  const targets = ['characters', 'story', 'power'].map(area => prior.areas.find(a => a.area === area)).map(a => ({ ...a, nextStageId: w.designReviewRuns.get(a.runId).stages.find(s => !s.result)?.id }));
  const remainingCalls = prior.maxCalls - prior.totalCalls; assert.ok(remainingCalls > 0);
  if (!execute && !rehearsal) {
    console.log(JSON.stringify({ status: 'preflight_passed', runtimeCommit: runtime.commit, priorCheckpointSha256: hash(priorBytes), targets, completedResultsPreserved: prior.runs.reduce((n, r) => n + r.stages.filter(s => s.result).length, 0), remainingCalls, modelCalls: 0, databaseWrites: false }));
  } else {
    const out = root + '/data/audit-runtimes/design62-control/' + (rehearsal ? `followup-rehearsal-${attempt}-result.json` : `followup-${attempt}-result.json`);
    assert.ok(!fs.existsSync(out), 'Output exists; inspect this attempt instead of restarting');
    let reviewProvider, ledger, redact = message => String(message);
    if (execute) {
      const { UsageLedger, redactSecrets, ModelGateway, OpenAICompatibleAdapter } = await import(runtime.root + '/packages/model-gateway/src/index.ts');
      const { loadModelStore, activeChannel, connectionOf } = await import(runtime.root + '/apps/api/src/model-settings.ts');
      const { JsonDesignPlanner } = await import(runtime.root + '/packages/planner/src/index.ts');
      const settings = loadModelStore(root + '/data/model-settings.json');
      const conn = connectionOf(activeChannel(settings), settings.source);
      assert.equal(conn.planningModel, runtime.model); assert.equal(conn.timeoutMs, runtime.timeoutMs);
      assert.ok(settings.channels.every(c => !c.fallback));
      ledger = new UsageLedger(Infinity, undefined, { maxCalls: remainingCalls }); redact = redactSecrets;
      const gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, conn.timeoutMs, true)]]), ledger);
      const endpoint = conn.endpoint.replace(/\/$/, '').replace(/(?:\/v1)?$/, '/v1');
      reviewProvider = new JsonDesignPlanner({ complete: async req => (await gateway.complete({ role: req.role ?? 'reviewing', model: conn.planningModel, system: req.system + suffix, user: req.user, maxOutputTokens: req.maxOutputTokens, responseFormat: 'json', temperature: 0.2 }, 'openai-compatible', { endpoint, apiKey: conn.apiKey })).text });
    } else {
      reviewProvider = { reviewDesignContent: async () => { throw new Error('REHEARSAL: simulated provider quota failure; no network call'); } };
    }
    const workflow = new ChapterWorkflow(repo, { generateChapter: () => { throw new Error('Resume must not generate prose'); } }, reviewProvider);
    const state = { status: 'running', startedAt: new Date().toISOString(), rehearsal, attempt, previousAttempts, workers: 1, runtimeCommit: runtime.commit, priorCheckpointSha256: hash(priorBytes), scope: prior.scope, areas: prior.areas, priorUsage: prior.resumeUsage ?? prior.usage, priorTotalCalls: prior.totalCalls, maxCalls: prior.maxCalls, errors: [], stepsStarted: [], suffixSha256: hash(suffix) };
    fs.writeFileSync(out, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
    const queue = [...targets]; let stopped = false, checkpointQueue = Promise.resolve();
    const checkpoint = () => {
      const job = checkpointQueue.then(async () => {
        const current = await repo.get(workId); verify(current);
        state.protectedHistoryUnchanged = true;
        state.runs = prior.areas.map(a => current.designReviewRuns.get(a.runId));
        state.reports = state.runs.filter(r => r.reportId).map(r => current.designContentReviews.get(r.reportId));
        state.resumeUsage = ledger?.summary() ?? { calls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0, costKnown: false };
        state.totalCalls = prior.totalCalls + state.resumeUsage.calls;
        fs.writeFileSync(out + '.pending', JSON.stringify(state, null, 2) + '\n'); fs.renameSync(out + '.pending', out);
      });
      checkpointQueue = job.catch(() => {}); return job;
    };
    async function worker() {
      while (!stopped && queue.length) {
        const target = queue.shift();
        try {
          let run = (await repo.get(workId)).designReviewRuns.get(target.runId);
          while (!stopped && run.status !== 'completed') {
            const stage = run.stages.find(s => !s.result); assert.ok(stage);
            if (stopped) break;
            state.stepsStarted.push({ area: target.area, runId: run.id, stageId: stage.id, at: new Date().toISOString() });
            console.log(JSON.stringify(state.stepsStarted.at(-1)));
            run = await workflow.stepDesignReview(workId, run.id); await checkpoint();
          }
        } catch (error) {
          stopped = true; state.errors.push({ area: target.area, error: String(redact(error.message)) });
          await checkpoint();
        }
      }
    }
    // Prisma batches simultaneous findUnique reads. With this project's large
    // preserved review history, paired reads reproduce a Rust-to-NAPI string
    // conversion failure; sequential reads pass. Keep history and serialize.
    await worker();
    state.status = state.errors.length ? 'stopped_after_failure' : 'completed';
    state.finishedAt = new Date().toISOString(); await checkpoint(); await checkpointQueue;
    if (rehearsal) { assert.equal(state.stepsStarted.length, 1); assert.equal(state.resumeUsage.calls, 0); assert.equal(state.errors.length, 1); }
    console.log(JSON.stringify({ status: state.status, rehearsal, stepsStarted: state.stepsStarted.length, modelCalls: state.resumeUsage.calls, protectedHistoryUnchanged: state.protectedHistoryUnchanged }));
  }
} finally { await repo.disconnect(); }
