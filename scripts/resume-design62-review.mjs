import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Run from the project root whose frozen binding and checkpoints are verified below.
const root = process.cwd();
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = v => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const runtime = read(root + '/data/audit-runtimes/design62-runtime-bound.json');
const baseline = read(root + '/data/audit-runtimes/design62-control/baseline.json');
const priorPath = root + '/data/audit-runtimes/design62-control/result.json';
const priorBytes = fs.readFileSync(priorPath, 'utf8');
const prior = JSON.parse(priorBytes);
const proof = read(root + '/docs/audits/2026-10-15-design62-quota-interruption.json');
const originalRunner = fs.readFileSync(root + '/data/audit-runtimes/design62-control/run.mjs', 'utf8');
assert.equal(hash(originalRunner), runtime.runnerSha256);
assert.equal(hash(priorBytes), proof.originalCheckpointSha256);
assert.equal(prior.status, 'completed_with_failures');
assert.equal(runtime.commit, prior.runtimeCommit);
assert.equal(runtime.rubricVersion, prior.rubricVersion);
assert.equal(runtime.scheduleVersion, prior.scheduleVersion);
assert.equal(runtime.candidateBinding.inputHash, proof.runs[0].inputHash);
for (const [p, h] of Object.entries(runtime.sourceHashes)) assert.equal(hash(fs.readFileSync(runtime.root + '/' + p, 'utf8')), h, p);
// Keep the exact dispatch suffix of the frozen original runner. This parses
// its quoted string without evaluating or executing any runner code.
const suffixLiteral = originalRunner.match(/const suffix='((?:\\.|[^'\\])*)';/)?.[1];
assert.ok(suffixLiteral);
const suffix = JSON.parse('"' + suffixLiteral.replace(/"/g, '\\"') + '"');
const execute = process.argv.includes('--execute');
const rehearsal = process.argv.includes('--rehearse-failure');
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
  const targets = prior.areas.map(a => ({ ...a, nextStageId: w.designReviewRuns.get(a.runId).stages.find(s => !s.result)?.id }));
  const remainingCalls = prior.maxCalls - prior.usage.calls; assert.ok(remainingCalls > 0);
  if (!execute && !rehearsal) {
    console.log(JSON.stringify({ status: 'preflight_passed', runtimeCommit: runtime.commit, priorCheckpointSha256: hash(priorBytes), targets, completedResultsPreserved: proof.runs.reduce((n, r) => n + r.completed, 0), remainingCalls, modelCalls: 0, databaseWrites: false }));
  } else {
    const out = root + '/data/audit-runtimes/design62-control/' + (rehearsal ? 'resume-rehearsal-result.json' : 'resume-1-result.json');
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
    const state = { status: 'running', startedAt: new Date().toISOString(), rehearsal, runtimeCommit: runtime.commit, priorCheckpointSha256: hash(priorBytes), scope: prior.scope, areas: prior.areas, priorUsage: prior.usage, maxCalls: prior.maxCalls, errors: [], stepsStarted: [], suffixSha256: hash(suffix) };
    fs.writeFileSync(out, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
    const queue = [...targets]; let stopped = false, checkpointQueue = Promise.resolve();
    const checkpoint = () => {
      const job = checkpointQueue.then(async () => {
        const current = await repo.get(workId); verify(current);
        state.protectedHistoryUnchanged = true;
        state.runs = prior.areas.map(a => current.designReviewRuns.get(a.runId));
        state.reports = state.runs.filter(r => r.reportId).map(r => current.designContentReviews.get(r.reportId));
        state.resumeUsage = ledger?.summary() ?? { calls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0, costKnown: false };
        state.totalCalls = prior.usage.calls + state.resumeUsage.calls;
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
    // A failed first request stops dispatch to other areas. A second worker
    // already inside a request may finish and save; it will start no next step.
    const workers = await Promise.allSettled(Array.from({ length: rehearsal ? 1 : 2 }, worker));
    for (const result of workers) if (result.status === 'rejected') throw result.reason;
    state.status = state.errors.length ? 'stopped_after_failure' : 'completed';
    state.finishedAt = new Date().toISOString(); await checkpoint(); await checkpointQueue;
    if (rehearsal) { assert.equal(state.stepsStarted.length, 1); assert.equal(state.resumeUsage.calls, 0); assert.equal(state.errors.length, 1); }
    console.log(JSON.stringify({ status: state.status, rehearsal, stepsStarted: state.stepsStarted.length, modelCalls: state.resumeUsage.calls, protectedHistoryUnchanged: state.protectedHistoryUnchanged }));
  }
} finally { await repo.disconnect(); }
