import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractValidationError, parseContextManifest, parseGenerateChapterResponse, parseTaskEnvelope } from '../src/index.ts';

test('chapter response requires structured events and content', () => {
  const parsed = parseGenerateChapterResponse({ content: '正文', proposedEvents: [{ eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: 1 }] });
  assert.equal(parsed.proposedEvents.length, 1);
  assert.throws(() => parseGenerateChapterResponse({ content: '', proposedEvents: [{ eventType: 'bad' }] }), ContractValidationError);
});

test('context manifest rejects invalid versions and statuses', () => {
  assert.throws(() => parseContextManifest({ workId: 'w', chapterNumber: 0, stateRevision: -1, adoptedVersionIds: [], includedEventIds: [], requiredMaterialStatus: 'unknown', omittedOptionalMaterial: [] }), ContractValidationError);
  assert.equal(parseContextManifest({ workId: 'w', chapterNumber: 1, stateRevision: 0, adoptedVersionIds: [], includedEventIds: [], requiredMaterialStatus: 'complete', omittedOptionalMaterial: [] }).chapterNumber, 1);
});

test('task envelope carries idempotency and input versions', () => {
  const task = parseTaskEnvelope({ taskId: 't', workId: 'w', kind: 'adopt', inputVersionIds: ['v1'], attempt: 1, idempotencyKey: 'w:1:adopt' });
  assert.equal(task.idempotencyKey, 'w:1:adopt');
  assert.throws(() => parseTaskEnvelope({ ...task, attempt: 0 }), ContractValidationError);
});
