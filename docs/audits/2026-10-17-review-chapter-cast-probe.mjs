// Bounded identity/navigation experiment. No production design or report writes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const fileHash = file => sha(fs.readFileSync(file));
const mode = process.argv[2];
assert.ok(['--prepare', '--execute', '--verify'].includes(mode));
const control = path.resolve('data/audit-runtimes/design69-chapter-cast-probe');
const manifestPath = path.join(control, 'manifest.json'), outputPath = path.join(control, 'result.json');
const formalBinding = read('data/audit-runtimes/design69-review30-runtime-bound.json');
const baseline = read('data/audit-runtimes/design69-review30/baseline.json');
async function protectedProduction(databasePath = path.resolve('data/novel-studio.db')) {
  const { PrismaWorkRepository } = await import(`${formalBinding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } });
  try {
    return await prisma.$transaction(async tx => {
      const work = await new PrismaWorkRepository(tx).get(baseline.workId);
      assert.ok(work);
      const protectedHash = hash({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], activePlanId: work.activePlanId,
        versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] });
      assert.equal(protectedHash, baseline.protectedHash);
      for (const [id, expected] of baseline.oldRuns) assert.equal(hash(work.designReviewRuns.get(id)), expected);
      for (const [id, expected] of baseline.oldReports) assert.equal(hash(work.designContentReviews.get(id)), expected);
      return { protectedHash, oldRunsUnchanged: baseline.oldRuns.length, oldReportsUnchanged: baseline.oldReports.length,
        approvedPlan: work.plans.get(work.activePlanId).revision };
    }, { maxWait: 30_000, timeout: 120_000 });
  } finally { await prisma.$disconnect(); }
}
if (mode === '--prepare') {
  assert.ok(!fs.existsSync(control), 'Preserve earlier attempts');
  const before = await protectedProduction();
  const oldProof = read('docs/audits/2026-10-17-design68-focused-review.json');
  const oldRequest = oldProof.requests.find(request => request.area === 'story');
  assert.equal(fileHash(oldRequest.inputPath), oldRequest.inputSha256);
  const oldInput = read(oldRequest.inputPath);
  const current = read('data/audit-runtimes/design69-preparation/inputs.json').story;
  assert.equal(current.inputHash, baseline.inputHash);
  const sources = oldInput.sources.map(source => {
    const actual = current.sources.find(item => item.id === source.id);
    assert.deepEqual(actual, source, 'The compared story material must remain identical');
    return actual;
  });
  const input = { ...current, rubric: oldInput.rubric, sources };
  fs.mkdirSync(control);
  const runtimePath = path.join(control, 'runtime'), sourceHashes = {};
  for (const name of Object.keys(formalBinding.sourceHashes)) {
    const target = path.join(runtimePath, name); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(name, target); sourceHashes[name] = fileHash(target);
  }
  fs.mkdirSync(path.join(runtimePath, 'node_modules'));
  for (const name of fs.readdirSync('node_modules')) {
    const source = fs.realpathSync(path.resolve('node_modules', name));
    const local = path.join(runtimePath, path.relative(process.cwd(), source));
    fs.symlinkSync(fs.existsSync(path.join(local, 'package.json')) ? local : source, path.join(runtimePath, 'node_modules', name));
  }
  const { createDesignReviewRun, designReviewStageInput } = await import(`${runtimePath}/novel-service-core/src/design-review-run.ts`);
  const run = createDesignReviewRun(input), prior = createDesignReviewRun(input, run.createdAt, 30);
  assert.equal(run.scheduleVersion, 31); assert.equal(run.stages.length, 1);
  const request = designReviewStageInput(run, run.stages[0]), priorRequest = designReviewStageInput(prior, prior.stages[0]);
  assert.equal(request.stage.coverage.mode, 'whole_input');
  const cast = request.stage.coverage.chapterCast; assert.ok(cast);
  const withoutCast = structuredClone(request); delete withoutCast.stage.coverage.chapterCast;
  assert.deepEqual(withoutCast, priorRequest, 'v31 differs from matching v30 staging only by cast navigation');
  for (const source of sources) {
    const units = request.stage.sourceMap.filter(unit => unit.sourceId === source.id);
    assert.equal(units.map(unit => request.sources.find(item => item.id === unit.id).text).join(''), source.text);
  }
  assert.ok(cast.chapters.find(chapter => chapter.sourceId === 'plan/chapters/37').characterIds.includes('char_21'));
  assert.ok(cast.chapters.find(chapter => chapter.sourceId === 'plan/chapters/44').characterIds.includes('char_16'));
  const inputPath = path.join(control, 'input.json');
  fs.writeFileSync(inputPath, JSON.stringify(request), { flag: 'wx' });
  const manifest = { preparedAt: new Date().toISOString(), inputPath, inputSha256: fileHash(inputPath), inputHash: current.inputHash,
    sourceCharacters: JSON.stringify(request.sources).length, runtimePath, sourceHashes, before,
    oldInputSha256: oldRequest.inputSha256, oldResultSha256: fileHash(oldProof.results.find(result => result.area === 'story').output),
    originalSourcesIdentical: true, v31VsMatchedV30OnlyCastAdded: true, maxCalls: 2,
    productionWrites: 0, formalAcceptance: false,
    limitation: 'Focused test of chapters33–50; not a formal story report. Previous observed focused request was unstaged, so comparison with its old response is not a single-variable experiment. No expected verdict or case-specific identity correction is added to the prompt.' };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ prepared: true, sourceCharacters: manifest.sourceCharacters, chaptersInIndex: cast.chapters.length, productionWrites: 0 }));
} else {
  const manifest = read(manifestPath);
  assert.equal(fileHash(manifest.inputPath), manifest.inputSha256);
  for (const [name, expected] of Object.entries(manifest.sourceHashes)) assert.equal(fileHash(`${manifest.runtimePath}/${name}`), expected);
  const { JsonDesignPlanner } = await import(`${manifest.runtimePath}/packages/planner/src/index.ts`);
  if (mode === '--execute') {
    assert.ok(!fs.existsSync(outputPath), 'Do not replace or blindly repeat an existing model attempt');
    const { loadModelStore, activeChannel, connectionOf } = await import(`${manifest.runtimePath}/apps/api/src/model-settings.ts`);
    const { UsageLedger, redactSecrets, ModelGateway, OpenAICompatibleAdapter } = await import(`${manifest.runtimePath}/packages/model-gateway/src/index.ts`);
    const settings = loadModelStore('data/model-settings.json'), connection = connectionOf(activeChannel(settings), settings.source);
    assert.equal(connection.planningModel, 'gpt-5.6-luna'); assert.ok(settings.channels.every(channel => !channel.fallback));
    const ledger = new UsageLedger(Infinity, undefined, { maxCalls: manifest.maxCalls });
    const gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, connection.timeoutMs, true)]]), ledger);
    const endpoint = connection.endpoint.replace(/\/$/, '').replace(/(?:\/v1)?$/, '/v1');
    const planner = new JsonDesignPlanner({ complete: async request => (await gateway.complete({
      role: request.role ?? 'reviewing', model: connection.planningModel, system: request.system,
      user: request.user, maxOutputTokens: request.maxOutputTokens, responseFormat: 'json', temperature: 0.2,
    }, 'openai-compatible', { endpoint, apiKey: connection.apiKey })).text });
    const state = { status: 'running', pid: process.pid, startedAt: new Date().toISOString(), inputSha256: manifest.inputSha256,
      model: connection.planningModel, fallback: false, maxCalls: manifest.maxCalls, productionWrites: 0, formalAcceptance: false };
    fs.writeFileSync(outputPath, JSON.stringify(state), { flag: 'wx' });
    try { state.result = await planner.reviewDesignContent(read(manifest.inputPath)); state.status = 'completed'; }
    catch (error) { state.status = 'failed'; state.failure = { error: String(redactSecrets(error.message)), modelResponses: error.modelResponses ?? [] }; process.exitCode = 1; }
    finally {
      state.finishedAt = new Date().toISOString(); state.usage = ledger.summary();
      fs.writeFileSync(`${outputPath}.pending`, JSON.stringify(state, null, 2)); fs.renameSync(`${outputPath}.pending`, outputPath);
      console.log(JSON.stringify({ status: state.status, calls: state.usage.calls,
        checks: state.result?.checks.map(({ criterion, verdict, explanation }) => ({ criterion, verdict, explanation })), error: state.failure?.error }));
    }
  } else {
    const state = read(outputPath); assert.equal(state.status, 'completed');
    assert.equal(state.inputSha256, manifest.inputSha256);
    let responsesReplayed = 0;
    const planner = new JsonDesignPlanner({ complete: async () => {
      assert.ok(responsesReplayed < state.result.modelResponses.length);
      return state.result.modelResponses[responsesReplayed++];
    } });
    const input = read(manifest.inputPath);
    assert.deepEqual(await planner.reviewDesignContent(input), state.result);
    for (const check of state.result.checks) for (const evidence of check.evidence) assert.ok(input.sources.find(source => source.id === evidence.sourceId)?.text.includes(evidence.quote));
    // The formal worker continues writing its own checkpoints. SQLite's backup
    // API gives a consistent snapshot without holding a long production read
    // transaction while Prisma reconstructs all preserved historical records.
    const snapshotDirectory = fs.mkdtempSync(path.join(control, 'verification-'));
    const snapshotPath = path.join(snapshotDirectory, 'production.db');
    const snapshotStartedAt = new Date().toISOString();
    execFileSync('python3', ['-c', `
import pathlib, sqlite3, sys
source = sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri() + '?mode=ro', uri=True, timeout=30)
target = sqlite3.connect(sys.argv[2])
try:
    source.backup(target, pages=1024, sleep=0.1)
finally:
    target.close()
    source.close()
`, path.resolve('data/novel-studio.db'), snapshotPath], { timeout: 60_000, stdio: 'pipe' });
    const snapshotCompletedAt = new Date().toISOString();
    const snapshotSha256 = fileHash(snapshotPath);
    const after = await protectedProduction(snapshotPath); assert.deepEqual(after, manifest.before);
    const productionRead = { method: 'SQLite online backup from read-only source; isolated transactional repository read',
      snapshotPath, snapshotSha256, snapshotStartedAt, snapshotCompletedAt,
      priorVerificationFailures: 'Two production read transactions timed out with P1008. Saved model result was replayed without resubmitting the model call.',
      scope: 'Protected canon and old runs/reports only; active formal world review may advance.' };
    const proof = { ...manifest, verifiedAt: new Date().toISOString(), resultPath: outputPath, resultSha256: fileHash(outputPath),
      modelCalls: state.usage.calls, responsesReplayed, verificationModelCalls: 0, after, productionRead,
      result: state.result, allQuotesInDeliveredSources: true, semanticReview: 'Requires independent reading of explanations and original passages; parser success is not semantic acceptance.' };
    fs.writeFileSync('docs/audits/2026-10-17-review-chapter-cast-probe.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ verified: true, modelCalls: state.usage.calls, responsesReplayed, after,
      checks: state.result.checks.map(({ criterion, verdict, explanation }) => ({ criterion, verdict, explanation })) }));
  }
}
