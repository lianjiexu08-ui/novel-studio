// Resume existing v78 reviews; never create, approve, lock, or generate prose.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requestJson, advanceReview, assertReviewBaseline, parseReviewRetry } from './design-review-step-client.mjs';

export const workId = 'work_8b6c9133e13d404083ca33acc63f4f61';
export const planId = 'plan_a5fff5fb0e5a4dcfb63912107924c2fa';
const inputHash = '28c13900f419ccc8a3faa5e8a3600348b6e119964681e21ef8f4f00919733d08';
const runs = [
  ['world', 'design_run_0d086731-493f-4cb9-816a-398ff3ff1123'],
  ['power', 'design_run_1050f783-7af7-4062-b5d2-bebd517cb730'],
  ['characters', 'design_run_2b6bc122-ddd6-4c1b-9166-303b1a6953de'],
  ['story', 'design_run_8bf5a361-cec3-4f5c-8fce-a1e65e2c8ac9'],
];

async function main() {
  const base = process.env.REVIEW_API ?? 'http://127.0.0.1:8790';
  const limit = Number(process.env.REVIEW_MAX_STEPS ?? Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('REVIEW_MAX_STEPS must be a positive integer');
  let retryFailedStage = parseReviewRetry(process.env.REVIEW_RETRY_FAILED_STAGE);
  const directory = 'data/audit-runtimes/design78-recovery';
  fs.mkdirSync(directory, { recursive: true });
  const journal = `${directory}/continuation-${Date.now()}-${process.pid}.jsonl`;
  const log = value => {
    const line = JSON.stringify({ at: new Date().toISOString(), ...value });
    fs.appendFileSync(journal, line + '\n', { flush: true });
    console.log(line);
  };
  const overview = async () => {
    const response = await requestJson(`${base}/works/${workId}/design/content-reviews?planId=${planId}&view=summary`);
    if (response.status !== 200) throw new Error(`Cannot read review state: HTTP ${response.status}`);
    for (const [, id] of runs) assertReviewBaseline(response.body.runs.find(run => run.id === id), inputHash, planId);
    return response.body;
  };
  const sha = url => createHash('sha256').update(fs.readFileSync(url)).digest('hex');
  log({ status: 'started', workId, planId, inputHash, limit, retryFailedStage,
    runnerSha256: sha(new URL(import.meta.url)),
    clientSha256: sha(new URL('./design-review-step-client.mjs', import.meta.url)),
  });
  try {
    let state = await overview(), count = 0;
    while (count < limit) {
      const current = runs.map(([area, id]) => ({ area, run: state.runs.find(run => run.id === id) }));
      if (current.some(({ run }) => run.stages.some(stage => stage.verdict === 'needs_revision'))) {
        log({ status: 'stopped_for_content_revision', formalAcceptance: false });
        return;
      }
      const pending = current.filter(({ run }) => run.status !== 'completed');
      if (!pending.length) {
        log({ status: 'reviews_completed', contentReviewsPassed: state.ready, formalAcceptance: false, approved: false });
        return;
      }
      // Give every domain source review before concentrating on cross checks.
      pending.sort((a, b) => a.run.stages.filter(s => s.completed).length - b.run.stages.filter(s => s.completed).length);
      const selected = retryFailedStage ? pending.find(item => item.run.id === retryFailedStage.runId) : pending[0];
      if (!selected) throw new Error('Inspected retry run is missing or completed; no model call dispatched');
      const { area, run } = selected;
      log({ status: 'dispatching', area, runId: run.id, stageId: run.stages.find(s => !s.completed)?.id });
      const after = await advanceReview({ before: run, retryFailedStage,
        post: () => requestJson(`${base}/works/${workId}/design/review-runs/${run.id}/step`, 'POST'),
        read: async () => { state = await overview(); return state.runs.find(item => item.id === run.id); },
        wait: () => new Promise(resolve => setTimeout(resolve, 15_000)),
        onObservation: value => log({ area, runId: run.id, ...value }),
      });
      retryFailedStage = undefined;
      log({ area, runId: run.id, status: after.status, completed: after.stages.filter(s => s.completed).length, total: after.stages.length });
      if (after.stages.some(stage => stage.verdict === 'needs_revision')) {
        log({ status: 'stopped_for_content_revision', area, runId: run.id, formalAcceptance: false });
        return;
      }
      count++;
    }
    log({ status: 'stopped_after_stage_limit', completedThisSession: count, formalAcceptance: false });
  } catch (error) {
    log({ status: 'stopped_for_inspection', error: String(error), formalAcceptance: false });
    process.exitCode = 1;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
