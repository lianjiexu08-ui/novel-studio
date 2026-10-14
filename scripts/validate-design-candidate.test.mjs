import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDesignCandidate } from './validate-design-candidate.mjs';
import { minimalWorldPack, minimalStoryBible, minimalPlan } from '../packages/application/test/fixtures.ts';

function fixture() {
  const worldPack = minimalWorldPack();
  return { worldPack, storyBible: minimalStoryBible(worldPack), plan: minimalPlan() };
}

test('valid proposed bundles retain blockers without implying approval or mutating content', () => {
  const input = fixture();
  input.plan.openQuestions.push({ id: 'pending', question: '尚需完整内容复核', blocking: true, status: 'open' });
  const before = structuredClone(input), result = validateDesignCandidate(input);
  assert.equal(result.valid, true);
  assert.deepEqual(result.blockers, [{ path: 'plan.openQuestions', id: 'pending', code: 'BLOCKING_QUESTION' }]);
  assert.equal(result.formalAcceptance, false);
  assert.deepEqual(input, before);
});

test('a 510-character milestone fails the actual plan contract, while sentence splitting preserves all text', () => {
  const input = fixture(), text = '核验。'.repeat(170);
  input.plan.milestones.push({ id: 'return', title: '回执', kind: 'turn', startChapter: 1, endChapter: 2, setup: [text], cost: '实付', outcome: '待核' });
  const result = validateDesignCandidate(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(i => i.path === 'plan.milestones.0.setup.0' && i.code === 'too_big'));
  input.plan.milestones[0].setup = [text.slice(0, 255), text.slice(255)];
  assert.equal(input.plan.milestones[0].setup.join(''), text);
  assert.equal(validateDesignCandidate(input).valid, true);
});

test('unknown or noncanonical content is reported instead of silently stripped or trimmed', () => {
  const input = fixture();
  input.plan.mysteryField = '不得丢掉的作者文本';
  assert.ok(validateDesignCandidate(input).issues.some(i => i.code === 'NORMALIZATION_REQUIRED'));
  delete input.plan.mysteryField;
  input.worldPack.title += ' ';
  assert.ok(validateDesignCandidate(input).issues.some(i => i.path === 'worldPack' && i.code === 'NORMALIZATION_REQUIRED'));
  assert.equal(input.worldPack.title.endsWith(' '), true);
  assert.equal(validateDesignCandidate({ ...fixture(), extra: {} }).valid, false);
});

test('contract-valid stale world bindings and dangling character references fail structural preflight', () => {
  const input = fixture();
  input.storyBible.worldPackRevision += 1;
  input.plan.chapters[0].characterIds = ['missing-character'];
  const result = validateDesignCandidate(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(i => i.code === 'WORLD_BINDING_MISMATCH'));
  assert.ok(result.issues.some(i => i.code === 'REFERENCE_UNKNOWN'));
});
