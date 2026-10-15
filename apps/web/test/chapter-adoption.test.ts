import test from 'node:test';
import assert from 'node:assert/strict';
import type { CandidateDto, ChapterReadinessDto } from 'novel-studio-contracts';
import { canAdoptChapter } from '../src/chapter-adoption.ts';

function fixture() {
  const current = { workId: 'work', chapterNumber: 1, stateRevision: 12, constraintRevision: 5 };
  const candidate: CandidateDto = {
    id: 'candidate', workId: 'work', chapterNumber: 1, content: '正文', proposedEvents: [], status: 'candidate', runId: 'run',
    generatedAgainstRevision: 12, generatedAgainstConstraintRevision: 5, contentHash: 'a'.repeat(64), origin: 'model', stale: false,
    checks: [{ checker: 'chapter_review', status: 'passed', message: '通过', candidateId: 'candidate', checkedAt: '2026-10-15T00:00:00Z' }],
    checkHistory: [], rulings: [], createdAt: '2026-10-15T00:00:00Z',
  };
  const readiness: ChapterReadinessDto = { chapterNumber: 1, ready: true, modelConfigured: true, blockers: [], requiredChecks: ['chapter_review'] };
  return { candidate, readiness, current };
}

test('passing prose cannot enable adoption before design acceptance or while readiness is unavailable', () => {
  const { candidate, readiness, current } = fixture();
  assert.equal(canAdoptChapter(candidate, readiness, current), true);
  assert.equal(canAdoptChapter(candidate, null, current), false);
  for (const code of ['CANON_NOT_READY', 'DESIGN_REVIEW_REQUIRED'] as const) {
    assert.equal(canAdoptChapter(candidate, { ...readiness, ready: false, blockers: [{ code, message: '设计未通过', nextAction: '修订设计' }] }, current), false);
  }
});

test('switching chapter or work and advancing revisions cannot reuse an old candidate or readiness response', () => {
  const { candidate, readiness, current } = fixture();
  for (const changed of [{ ...current, workId: 'other' }, { ...current, chapterNumber: 2 }, { ...current, stateRevision: 13 }, { ...current, constraintRevision: 6 }]) {
    assert.equal(canAdoptChapter(candidate, readiness, changed), false);
  }
  assert.equal(canAdoptChapter(candidate, { ...readiness, chapterNumber: 2 }, current), false);
});

test('a newly required or failed review blocks adoption; demo and rejected drafts remain ineligible', () => {
  const { candidate, readiness, current } = fixture();
  assert.equal(canAdoptChapter(candidate, { ...readiness, requiredChecks: ['chapter_review', 'canon_consistency'] }, current), false);
  for (const status of ['failed', 'inconclusive', 'unavailable'] as const) {
    assert.equal(canAdoptChapter({ ...candidate, checks: [{ ...candidate.checks[0], status }] }, readiness, current), false);
  }
  for (const changed of [{ ...candidate, origin: 'demo' as const }, { ...candidate, status: 'rejected' as const }, { ...candidate, stale: true }]) {
    assert.equal(canAdoptChapter(changed, readiness, current), false);
  }
});

test('model configuration is not required to adopt an existing reviewed candidate', () => {
  const { candidate, readiness, current } = fixture();
  assert.equal(canAdoptChapter(candidate, { ...readiness, ready: false, modelConfigured: false,
    blockers: [{ code: 'MODEL_NOT_CONFIGURED', message: '未配置模型', nextAction: '配置模型后生成' }] }, current), true);
});
