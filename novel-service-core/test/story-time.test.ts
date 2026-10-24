import test from 'node:test';
import assert from 'node:assert/strict';
import { explicitStoryTimeConflicts } from '../src/story-time.ts';

test('reports the observed shift-handover mismatch without changing the text', () => {
  const text = '第188日巳末10:45离营、午正12:00交押、酉初19:00两岗接夜班；第189日辰初07:00换日班';
  const issues = explicitStoryTimeConflicts(text);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /酉初19:00/);
  assert.match(issues[0], /17:00.*18:00/);
  assert.deepEqual(explicitStoryTimeConflicts(text.replace('酉初', '戌初')), []);
});

test('handles the midnight boundary and initial/midpoint hour windows', () => {
  assert.deepEqual(explicitStoryTimeConflicts('子时23:59，子时00:59，子初23:15，子正00:30，丑初01:00，午末12:59'), []);
  assert.equal(explicitStoryTimeConflicts('子初00:00；子正23:59；子时01:00；午正11:00').length, 4);
  assert.equal(explicitStoryTimeConflicts('酉时（19：00）').length, 1);
  assert.deepEqual(explicitStoryTimeConflicts('戌初 (19:00)，卯正 06:00，辰末08:45'), []);
});

test('does not infer equivalents from separate events, ranges or bare times', () => {
  for (const text of ['酉初出发，19:00抵达', '酉初至19:00', '戌初至入夜', '19:00交班', '酉初', '第19日酉时', '酉初19日抵达']) {
    assert.deepEqual(explicitStoryTimeConflicts(text), [], text);
  }
});
