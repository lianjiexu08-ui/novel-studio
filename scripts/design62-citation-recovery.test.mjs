import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citationRecoveryGuidance, citationRecoverySuffix } from './design62-citation-recovery.mjs';

const request = { task: 'review_design_content', area: 'power', stage: { followupFor: 'cross-2-3/tiers' } };
test('clarification applies to the rejected follow-up and its repair', () => {
  assert.equal(citationRecoverySuffix(JSON.stringify(request)), citationRecoveryGuidance);
  assert.equal(citationRecoverySuffix(JSON.stringify({ task: 'repair_previous_output', originalRequest: request })), citationRecoveryGuidance);
});
test('other areas, steps and tasks keep their original dispatch', () => {
  for (const other of [
    { ...request, area: 'story' },
    { ...request, stage: { followupFor: 'cross-2-3/costs' } },
    { ...request, stage: {} },
    { ...request, task: 'generate_chapter' },
    { task: 'repair_previous_output' },
  ]) assert.equal(citationRecoverySuffix(JSON.stringify(other)), '');
});
