// Bounded local review only: never save a formal design report or mutate a work.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const mode = process.argv[2];
assert.ok(['--check', '--execute', '--verify'].includes(mode) && process.argv.length === 3);
const { createHash } = await import('node:crypto');
const read = file => JSON.parse(fs.readFileSync(file));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));
const requestProofPath = 'docs/audits/2026-10-17-design71-world-content-request.json';
const prepared = read(requestProofPath);
for (const [file, expected] of [
  [prepared.candidatePath, prepared.candidateSha256], [prepared.candidateProofPath, prepared.candidateProofSha256],
  [prepared.rehearsalPath, prepared.rehearsalSha256], [prepared.inputPath, prepared.inputSha256],
  [prepared.fullInputPath, prepared.fullInputSha256], [prepared.runtimeBindingPath, prepared.runtimeBindingSha256],
]) assert.equal(fileHash(file), expected, file);
const binding = read(prepared.runtimeBindingPath);
assert.equal(binding.runtimePath, prepared.runtimePath);
for (const [file, expected] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(`${binding.runtimePath}/${file}`), expected, file);
const input = read(prepared.inputPath), full = read(prepared.fullInputPath), candidateProof = read(prepared.candidateProofPath);
assert.equal(input.inputHash, prepared.inputHash); assert.equal(full.inputHash, input.inputHash);
assert.deepEqual(input.rubric, prepared.rubric);
assert.equal(JSON.stringify(input.sources).length, prepared.sourceCharacters);
assert.equal(input.sources.length, prepared.selectedSources.length);
assert.equal(new Set(input.sources.map(s => s.id)).size, input.sources.length);
const history = candidateProof.findings.map(finding => ({ id: `review-history/${finding.stageId}`,
  text: '以下是原提案71的历史模型意见，包含可能错误的定位或判断；不是新增世界事实，也不证明新候选通过。须与本次实际提供的候选原文独立对照。\n'
    + JSON.stringify({ stageId: finding.stageId, result: finding.result, actuallyReadSourceIds: finding.originalSourceIds }, null, 2) }));
assert.deepEqual(prepared.historySourceIds, history.map(s => s.id));
for (const source of input.sources) {
  assert.deepEqual(source, [...full.sources, ...history].find(s => s.id === source.id), source.id);
  const record = prepared.selectedSources.find(s => s.id === source.id);
  assert.equal(record.sha256, hash(source.text)); assert.equal(record.characters, source.text.length);
}
for (const id of prepared.requiredSourceIds) assert.ok(input.sources.some(s => s.id === id), id);
assert.deepEqual(prepared.omittedSourceIds, full.sources.filter(s => !input.sources.some(selected => selected.id === s.id)).map(s => s.id));

const checkpoint = read(prepared.originalWorkerCheckpoint);
let workerLive = false;
try { process.kill(checkpoint.pid, 0); workerLive = true; } catch (error) { assert.equal(error.code, 'ESRCH'); }
const terminalProofExists = fs.existsSync(prepared.requiredTerminalProof);
const ready = !workerLive && checkpoint.status === 'completed' && terminalProofExists;
if (mode === '--check') {
  console.log(JSON.stringify({ ready, workerLive, originalReviewStatus: checkpoint.status, terminalProofExists,
    completeSourcesVerified: input.sources.length, sourceCharacters: prepared.sourceCharacters, modelCalls: 0, productionWrites: 0 }));
  process.exit(0);
}
assert.ok(ready, 'Wait for the original worker to exit and its terminal proof; never overlap or restart it');
const terminal = read(prepared.requiredTerminalProof);
assert.equal(terminal.status, 'completed'); assert.equal(terminal.workerAbsent, true);
assert.equal(fileHash(terminal.checkpointPath), terminal.checkpointSha256);
assert.equal(fileHash(prepared.originalWorkerCheckpoint), terminal.checkpointSha256);
assert.equal(checkpoint.inputHash, candidateProof.expectedInputHash);
assert.deepEqual(terminal.replays.map(r => r.area).sort(), ['characters', 'power', 'story', 'world']);
assert.ok(terminal.replays.every(r => r.reportVerification === 'verified' && r.completedStages === r.totalStages));
const outputPath = path.join(path.dirname(prepared.inputPath), 'result.json');
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
if (mode === '--execute') {
  assert.ok(!fs.existsSync(outputPath), 'Preserve the prior attempt. Inspect it or run --verify; never resubmit blindly');
  const { loadModelStore, activeChannel, connectionOf } = await import(`${binding.runtimePath}/apps/api/src/model-settings.ts`);
  const { UsageLedger, redactSecrets, ModelGateway, OpenAICompatibleAdapter } = await import(`${binding.runtimePath}/packages/model-gateway/src/index.ts`);
  const settings = loadModelStore('data/model-settings.json');
  const connection = connectionOf(activeChannel(settings), settings.source);
  assert.equal(connection.planningModel, 'gpt-5.6-luna');
  assert.ok(settings.channels.every(channel => !channel.fallback));
  const endpoint = connection.endpoint.replace(/\/$/, '').replace(/(?:\/v1)?$/, '/v1');
  const ledger = new UsageLedger(Infinity, undefined, { maxCalls: 2 });
  const gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, connection.timeoutMs, true)]]), ledger);
  const state = { status: 'running', startedAt: new Date().toISOString(), pid: process.pid,
    requestProofSha256: fileHash(requestProofPath), inputSha256: prepared.inputSha256, candidateSha256: prepared.candidateSha256,
    terminalProofSha256: fileHash(prepared.requiredTerminalProof), model: connection.planningModel, fallback: false,
    maxCalls: 2, rawResponses: [], modelCalls: 0, productionWrites: 0, formalAcceptance: false };
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
  catch (error) { state.status = 'failed'; state.failure = { error: String(redactSecrets(error.message)), modelResponses: error.modelResponses ?? [] }; }
  state.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: state.status, modelCalls: state.modelCalls,
    checks: state.result?.checks.map(({ criterion, verdict, explanation }) => ({ criterion, verdict, explanation })), error: state.failure?.error }));
  assert.equal(state.status, 'completed', 'Inspect the saved failed attempt before considering further calls');
} else {
  const state = read(outputPath);
  assert.equal(state.status, 'completed'); assert.equal(state.model, 'gpt-5.6-luna'); assert.equal(state.fallback, false);
  assert.equal(state.requestProofSha256, fileHash(requestProofPath));
  assert.equal(state.terminalProofSha256, fileHash(prepared.requiredTerminalProof));
  assert.equal(state.inputSha256, prepared.inputSha256); assert.equal(state.candidateSha256, prepared.candidateSha256);
  assert.ok(state.modelCalls > 0 && state.modelCalls <= 2); assert.equal(state.modelCalls, state.usage.calls);
  assert.deepEqual(state.rawResponses, state.result.modelResponses);
  let cursor = 0;
  const planner = new JsonDesignPlanner({ complete: async () => {
    assert.ok(cursor < state.rawResponses.length, 'Saved responses exhausted'); return state.rawResponses[cursor++];
  } });
  assert.deepEqual(await planner.reviewDesignContent(input), state.result);
  assert.equal(cursor, state.rawResponses.length);
  const proof = { ...prepared, verifiedAt: new Date().toISOString(), requestProofPath, requestProofSha256: fileHash(requestProofPath),
    outputPath, outputSha256: fileHash(outputPath), terminalProofSha256: fileHash(prepared.requiredTerminalProof),
    model: state.model, fallback: false, modelCalls: state.modelCalls, responsesReplayed: cursor, result: state.result,
    replayModelCalls: 0, productionWrites: 0, formalAcceptance: false,
    limitation: 'One scoped candidate content review. Preserve any rejection and the original v71 findings. It does not apply the candidate, resolve production questions, approve prose or replace full design review.' };
  const proofPath = 'docs/audits/2026-10-17-design71-world-content-review.json';
  assert.ok(!fs.existsSync(proofPath), 'Preserve prior verification');
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ verified: true, responsesReplayed: cursor, modelCalls: state.modelCalls,
    checks: state.result.checks.map(({ criterion, verdict }) => ({ criterion, verdict })), formalAcceptance: false }));
}
