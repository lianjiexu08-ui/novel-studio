import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractValidationError, parseContextManifest, parseGenerateChapterResponse, parsePlanSkeleton, parseTaskEnvelope } from '../src/index.ts';

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

test('plan fact dependencies use chapter event types, not arc beat labels', () => {
  const base = {
    targetChapterCount: 1, volumeCount: 1, mainConflict: '', theme: '', protagonistArc: '', endingDirection: '', keyTurns: [],
    volumes: [{ id: 'v1', order: 1, title: '卷一', startChapter: 1, endChapter: 1, goal: '', opposition: '', characterIds: [], climax: '', endState: '', carryOver: '' }],
    milestones: [], openQuestions: [], chapters: [],
  };
  assert.throws(() => parsePlanSkeleton({ ...base, dependencies: [{ id: 'dep', targetId: 'chapter-1', fact: { eventType: 'arcBeat', subjectId: 'beat-1' }, requiredness: 'must', description: '非法事件类型' }] }));
  assert.equal(parsePlanSkeleton({ ...base, dependencies: [{ id: 'dep', targetId: 'chapter-1', fact: { eventType: 'plot_progress', subjectId: 'chapter-1' }, requiredness: 'must', description: '合法事件类型' }] }).dependencies[0].fact?.eventType, 'plot_progress');
});
