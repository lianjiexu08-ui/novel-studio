// HTTP responses may be lost while a model call is still running. Reconcile
// with durable progress before dispatching another stage.
import http from 'node:http';
import https from 'node:https';

export function requestJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const transport = new URL(url).protocol === 'https:' ? https : http;
    const request = transport.request(url, { method, headers: method === 'POST' ? { 'content-type': 'application/json' } : {} }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (error) { reject(error); }
      });
    });
    // A model response plus its bounded repair can exceed fetch's default
    // headers timeout. This deadline is transport-only, never a retry signal.
    request.setTimeout(25 * 60_000, () => request.destroy(new Error('review transport timeout')));
    request.on('error', reject);
    request.end(method === 'POST' ? '{}' : undefined);
  });
}

export function assertReviewBaseline(run, inputHash, planId) {
  if (!run || run.inputHash !== inputHash || run.scope?.planRevisionId !== planId || run.status === 'outdated') {
    throw new Error('Review baseline changed or run missing; no model call dispatched');
  }
}

export async function advanceReview({ before, read, post, wait, onObservation = () => {} }) {
  const pending = before.stages.find(stage => !stage.completed);
  if (!pending) return before;
  if (before.status === 'running' || before.leaseExpiresAt) throw new Error('Review already has an execution lease; no model call dispatched');
  let response;
  let transportError;
  try { response = await post(); } catch (error) { transportError = error; }
  // Even HTTP errors may arrive after a durable commit. Read the exact stage,
  // not just a count (which can change when follow-ups are appended).
  for (;;) {
    const current = await read();
    assertReviewBaseline(current, before.inputHash, before.scope.planRevisionId);
    const stage = current.stages.find(item => item.id === pending.id);
    if (!stage) throw new Error('Dispatched stage missing from durable progress');
    onObservation({ status: current.status, stageId: stage.id, completed: stage.completed, attempts: stage.attempts });
    if (stage.completed) return current;
    if (current.status === 'running' || current.leaseExpiresAt) {
      if (!current.leaseExpiresAt || Date.parse(current.leaseExpiresAt) <= Date.now()) {
        throw new Error('Review lease expired or uncertain; inspect the worker before recovery');
      }
      await wait();
      continue;
    }
    throw new Error(`Stage ${pending.id} did not complete; preserved for inspection: ${stage.error ?? response?.body?.error?.message ?? transportError?.message ?? 'unknown outcome'}`);
  }
}
