import test from 'node:test';
import assert from 'node:assert/strict';
import { LockedConstraintError, SettingConflictError, Work } from '../src/core.ts';
import {
  addCharacter, addPlotNode, addSettingRelationship, addWorldRule, removeCharacter, removePlotNode,
  removeSettingRelationship, updateCharacter, updatePlotNode, updateSettingRelationship, updateWorldRule,
} from '../src/bible.ts';

const person = (name: string, aliases: string[] = []) => ({
  name, aliases, role: 'major' as const, identity: '', goal: '', principles: '', voice: '', notes: '',
});

test('names and aliases resolve to exactly one character', () => {
  const work = new Work('人物');
  addCharacter(work, person('林渊', ['渊哥']));
  assert.throws(() => addCharacter(work, person('渊哥')), SettingConflictError);
  assert.throws(() => addCharacter(work, person('苏晚', ['苏晚'])), SettingConflictError);
});

test('settings edits never advance the story revision', () => {
  const work = new Work('版本');
  const hero = addCharacter(work, person('林渊'));
  addWorldRule(work, { category: 'power', title: '境界', content: '炼气、筑基、金丹' });
  updateCharacter(work, hero.id, { goal: '查清灭门真相' });
  assert.equal(work.stateRevision, 0);
});

test('locked settings must be unlocked before they change', () => {
  const work = new Work('锁定');
  const master = addCharacter(work, person('玄机子'));
  const disciple = addCharacter(work, person('林渊'));
  const bond = addSettingRelationship(work, {
    fromCharacterId: master.id, toCharacterId: disciple.id, kind: '师徒', value: '亲传', layer: 'objective', note: '',
  });
  updateSettingRelationship(work, bond.id, { locked: true });
  assert.throws(() => updateSettingRelationship(work, bond.id, { value: '逐出师门' }), LockedConstraintError);
  assert.throws(() => updateSettingRelationship(work, bond.id, { locked: false, value: '逐出师门' }), LockedConstraintError);
  assert.throws(() => removeSettingRelationship(work, bond.id), LockedConstraintError);
  updateSettingRelationship(work, bond.id, { locked: false });
  assert.equal(updateSettingRelationship(work, bond.id, { value: '记名' }).value, '记名');

  const rule = addWorldRule(work, { category: 'cost', title: '禁术', content: '折寿十年' });
  updateWorldRule(work, rule.id, { locked: true });
  assert.throws(() => updateWorldRule(work, rule.id, { content: '无代价' }), LockedConstraintError);
});

test('objective fact and a character belief can coexist and disagree', () => {
  const work = new Work('误信');
  const a = addCharacter(work, person('林渊'));
  const b = addCharacter(work, person('苏晚'));
  addSettingRelationship(work, { fromCharacterId: b.id, toCharacterId: a.id, kind: '身份', value: '亲兄妹', layer: 'objective', note: '' });
  addSettingRelationship(work, { fromCharacterId: b.id, toCharacterId: a.id, kind: '身份', value: '仇人之子', layer: 'belief', note: '被师门误导' });
  assert.equal(work.relationships.size, 2);
  assert.throws(() => addSettingRelationship(work, { fromCharacterId: b.id, toCharacterId: a.id, kind: '身份', value: '陌生人', layer: 'belief', note: '' }), SettingConflictError);
});

test('characters with relationships cannot be removed', () => {
  const work = new Work('引用');
  const a = addCharacter(work, person('林渊'));
  const b = addCharacter(work, person('苏晚'));
  addSettingRelationship(work, { fromCharacterId: a.id, toCharacterId: b.id, kind: '同门', value: '', layer: 'objective', note: '' });
  assert.throws(() => removeCharacter(work, a.id), SettingConflictError);
  assert.throws(() => addSettingRelationship(work, { fromCharacterId: a.id, toCharacterId: 'character_missing', kind: '敌对', value: '', layer: 'objective', note: '' }), /unknown character/);
});

test('plot nodes keep their dependency and realization history', () => {
  const work = new Work('大纲');
  const oath = addPlotNode(work, { level: 'volume', title: '三年之约', expectedResult: '主角赴约', prerequisites: [], targetChapter: 30 });
  const duel = addPlotNode(work, { level: 'chapter', title: '比武', expectedResult: '击败对手', prerequisites: [oath.id], targetChapter: 31 });
  assert.equal(duel.realization.status, 'unrealized');
  assert.throws(() => removePlotNode(work, oath.id), SettingConflictError);
  assert.throws(() => updatePlotNode(work, duel.id, { prerequisites: [duel.id] }), SettingConflictError);
  oath.realization = { status: 'realized', chapterVersionId: 'version_x', evidence: 'p3', updatedAt: new Date().toISOString() };
  updatePlotNode(work, duel.id, { prerequisites: [] });
  assert.throws(() => removePlotNode(work, oath.id), SettingConflictError);
});
