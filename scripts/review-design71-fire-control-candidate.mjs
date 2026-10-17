// Scoped content review of an unapplied candidate. No formal-report or work writes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const mode = process.argv[2];
assert.ok(['--check', '--execute', '--verify'].includes(mode) && process.argv.length === 3);
const read = file => JSON.parse(fs.readFileSync(file));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));
const requestProofPath = 'docs/audits/2026-10-17-design71-fire-control-request.json';
const preparerPath = 'scripts/prepare-design71-fire-control-review.mjs';
const runnerPath = 'scripts/review-design71-fire-control-candidate.mjs';
// Reconstruct from frozen sources and candidate before any model settings are loaded.
execFileSync(process.execPath, ['--experimental-strip-types', preparerPath, '--check'], { stdio: 'pipe' });
const prepared = read(requestProofPath);
const input = read(prepared.inputPath);
assert.equal(fileHash(prepared.inputPath), prepared.inputSha256);
assert.equal(fileHash(prepared.candidatePath), prepared.candidateSha256);
assert.equal(input.inputHash, prepared.inputHash);
assert.notEqual(input.inputHash, prepared.basedOnInputHash);
const binding = read(prepared.runtimeBindingPath);
const checkpoint = read(prepared.originalWorkerCheckpoint);
assert.equal(checkpoint.inputHash, prepared.basedOnInputHash);
let workerLive = false;
try { process.kill(checkpoint.pid, 0); workerLive = true; }
catch (error) { assert.equal(error.code, 'ESRCH'); }
const terminalProofExists = fs.existsSync(prepared.requiredTerminalProof);
const ready = !workerLive && checkpoint.status === 'completed' && terminalProofExists;
if (ready) {
  const terminal = read(prepared.requiredTerminalProof);
  assert.equal(terminal.status, 'completed');
  assert.equal(terminal.workerAbsent, true);
  assert.equal(fileHash(terminal.checkpointPath), terminal.checkpointSha256);
  assert.equal(fileHash(prepared.originalWorkerCheckpoint), terminal.checkpointSha256);
  assert.deepEqual(terminal.replays.map(record => record.area).sort(), ['characters', 'power', 'story', 'world']);
  assert.ok(terminal.replays.every(record => record.reportVerification === 'verified'
    && record.completedStages === record.totalStages));
}
if (mode === '--check') {
  console.log(JSON.stringify({ ready, workerLive, originalReviewStatus: checkpoint.status, terminalProofExists,
    completeSourcesVerified: input.sources.length, sourceCharacters: prepared.sourceCharacters,
    modelCalls: 0, productionWrites: 0, formalAcceptance: false }));
  process.exit(0);
}
assert.ok(ready, 'Wait for the original worker to exit and its verified four-area terminal proof; never overlap or restart it');
const outputPath = path.join(path.dirname(prepared.inputPath), 'result.json');
const identity = { requestProofSha256: fileHash(requestProofPath), inputSha256: prepared.inputSha256,
  candidateSha256: prepared.candidateSha256, terminalProofSha256: fileHash(prepared.requiredTerminalProof),
  runnerSha256: fileHash(runnerPath), preparerSha256: fileHash(preparerPath) };
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
if (mode === '--execute') {
  assert.ok(!fs.existsSync(outputPath), 'Preserve the prior attempt; inspect it or use --verify, never resubmit blindly');
  const { loadModelStore, activeChannel, connectionOf } = await import(`${binding.runtimePath}/apps/api/src/model-settings.ts`);
  const { UsageLedger, redactSecrets, ModelGateway, OpenAICompatibleAdapter } = await import(`${binding.runtimePath}/packages/model-gateway/src/index.ts`);
  const settings = loadModelStore('data/model-settings.json');
  const connection = connectionOf(activeChannel(settings), settings.source);
  assert.equal(connection.planningModel, 'gpt-5.6-luna');
  assert.ok(settings.channels.every(channel => !channel.fallback));
  const endpoint = connection.endpoint.replace(/\/$/, '').replace(/(?:\/v1)?$/, '/v1');
  const ledger = new UsageLedger(Infinity, undefined, { maxCalls: 2 });
  const gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, connection.timeoutMs, true)]]), ledger);
  const state = { ...identity, status: 'running', startedAt: new Date().toISOString(), pid: process.pid,
    model: connection.planningModel, fallback: false, maxCalls: 2, rawResponses: [], modelCalls: 0,
    productionWrites: 0, formalAcceptance: false };
  fs.writeFileSync(outputPath, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
  const save = () => {
    state.usage = ledger.summary(); state.modelCalls = state.usage.calls;
    fs.writeFileSync(`${outputPath}.pending`, JSON.stringify(state, null, 2) + '\n');
    fs.renameSync(`${outputPath}.pending`, outputPath);
  };
  const planner = new JsonDesignPlanner({ complete: async call => {
    const response = await gateway.complete({ role: call.role ?? 'reviewing', model: connection.planningModel,
      system: call.system, user: call.user, maxOutputTokens: call.maxOutputTokens, responseFormat: 'json', temperature: 0.2 },
    'openai-compatible', { endpoint, apiKey: connection.apiKey });
    state.rawResponses.push(response.text); save(); return response.text;
  } });
  try { state.result = await planner.reviewDesignContent(input); state.status = 'completed'; }
  catch (error) { state.status = 'failed'; state.failure = {
    error: String(redactSecrets(error.message)), modelResponses: error.modelResponses ?? [],
  }; }
  state.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: state.status, modelCalls: state.modelCalls,
    checks: state.result?.checks.map(({ criterion, verdict, explanation }) => ({ criterion, verdict, explanation })),
    error: state.failure?.error, formalAcceptance: false }));
  assert.equal(state.status, 'completed', 'Inspect the saved failed attempt before considering further calls');
} else {
  const state = read(outputPath);
  assert.equal(state.status, 'completed');
  for (const [key, expected] of Object.entries(identity)) assert.equal(state[key], expected, key);
  assert.equal(state.model, 'gpt-5.6-luna'); assert.equal(state.fallback, false);
  assert.equal(state.maxCalls, 2); assert.equal(state.productionWrites, 0); assert.equal(state.formalAcceptance, false);
  assert.ok(state.modelCalls > 0 && state.modelCalls <= 2);
  assert.equal(state.modelCalls, state.usage.calls);
  assert.deepEqual(state.rawResponses, state.result.modelResponses);
  let cursor = 0;
  const planner = new JsonDesignPlanner({ complete: async () => {
    assert.ok(cursor < state.rawResponses.length, 'Saved responses exhausted');
    return state.rawResponses[cursor++];
  } });
  assert.deepEqual(await planner.reviewDesignContent(input), state.result);
  assert.equal(cursor, state.rawResponses.length);
  const proofPath = 'docs/audits/2026-10-17-design71-fire-control-content-review.json';
  const proof = { verifiedAt: new Date().toISOString(), requestProofPath, ...identity,
    outputPath, outputSha256: fileHash(outputPath), basedOnInputHash: prepared.basedOnInputHash,
    localInputHash: input.inputHash, model: state.model, fallback: false, modelCalls: state.modelCalls,
    responsesReplayed: cursor, result: state.result, replayModelCalls: 0, productionWrites: 0, formalAcceptance: false,
    limitation: 'Scoped review of an unapplied control-rule proposal. Does not replace original findings, apply a candidate, resolve production questions, approve prose or verify full design quality.' };
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ verified: true, responsesReplayed: cursor, modelCalls: state.modelCalls,
    checks: state.result.checks.map(({ criterion, verdict }) => ({ criterion, verdict })), formalAcceptance: false }));
}
