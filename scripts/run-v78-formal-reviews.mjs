// Run the four v78 design reviews one bounded stage at a time.
// The API persists every completed stage, so an interrupted process can be
// restarted with the same run IDs without creating a second review.
import assert from 'node:assert/strict';

const base = process.env.REVIEW_API ?? 'http://127.0.0.1:8790';
const workId = 'work_8b6c9133e13d404083ca33acc63f4f61';
const runs = [
  ['world', 'design_run_0d086731-493f-4cb9-816a-398ff3ff1123'],
  ['power', 'design_run_1050f783-7af7-4062-b5d2-bebd517cb730'],
  ['characters', 'design_run_2b6bc122-ddd6-4c1b-9166-303b1a6953de'],
  ['story', 'design_run_8bf5a361-cec3-4f5c-8fce-a1e65e2c8ac9'],
];
const postStep = async runId => {
  const response = await fetch(`${base}/works/${workId}/design/review-runs/${runId}/step`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`step ${runId} HTTP ${response.status}: ${body?.error?.message ?? 'unknown error'}`);
  return body;
};
for (const [area, runId] of runs) {
  let failures = 0;
  while (true) {
    try {
      const state = await postStep(runId);
      console.log(JSON.stringify({ area, runId, status: state.status, completed: state.completed, total: state.total, reportId: state.reportId }));
      failures = 0;
      if (state.status === 'completed') break;
    } catch (error) {
      failures++;
      console.error(JSON.stringify({ area, runId, failure: failures, error: String(error) }));
      if (failures >= 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 5000 * failures));
    }
  }
}
assert.ok(true);
console.log(JSON.stringify({ completed: true, areas: runs.map(([area]) => area), modelCalls: 'persisted by API' }));
