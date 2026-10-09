import { randomUUID } from 'node:crypto';
import { LockedConstraintError, SettingConflictError } from './core.ts';
import type { Character, PlotNode, Relationship, Work, WorldRule } from './core.ts';

/**
 * Author-owned story settings: characters, relationships, world rules and plot nodes.
 * These are constraints and plans, not adopted story facts, so edits never bump stateRevision.
 * Only the author reaches these functions; model output has no path to unlock anything.
 */

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const now = () => new Date().toISOString();

export type CharacterInput = Omit<Character, 'id' | 'locked' | 'createdAt'>;
export type CharacterPatch = Partial<CharacterInput> & { locked?: boolean };
export type RelationshipInput = Required<Pick<Relationship, 'fromCharacterId' | 'toCharacterId' | 'kind' | 'value' | 'layer' | 'note'>> & Pick<Relationship, 'sinceChapter'>;
export type RelationshipPatch = Partial<RelationshipInput> & { locked?: boolean };
export type WorldRuleInput = Omit<WorldRule, 'id' | 'locked' | 'createdAt'>;
export type WorldRulePatch = Partial<WorldRuleInput> & { locked?: boolean };
export type PlotNodeInput = Required<Pick<PlotNode, 'title' | 'expectedResult' | 'prerequisites' | 'level'>> & Pick<PlotNode, 'targetChapter'>;
export type PlotNodePatch = Partial<PlotNodeInput>;

function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function guardLocked(item: { locked: boolean }, patch: object, label: string): void {
  if (item.locked && Object.keys(patch).some((key) => key !== 'locked')) {
    throw new LockedConstraintError(`${label}已锁定，先解锁再修改`);
  }
}

function mustGet<T>(map: Map<string, T>, key: string, label: string): T {
  const item = map.get(key);
  if (!item) throw new Error(`unknown ${label} ${key}`);
  return item;
}

function namesOf(character: Pick<Character, 'name' | 'aliases'>): string[] {
  return [character.name, ...character.aliases].map((name) => name.trim()).filter(Boolean);
}

function assertUniqueNames(work: Work, candidate: Pick<Character, 'name' | 'aliases'>, selfId?: string): void {
  const wanted = namesOf(candidate);
  if (new Set(wanted).size !== wanted.length) throw new SettingConflictError('名字和别名里有重复');
  for (const other of work.characters.values()) {
    if (other.id === selfId) continue;
    const clash = namesOf(other).find((name) => wanted.includes(name));
    if (clash) throw new SettingConflictError(`「${clash}」已经是人物「${other.name}」的名字或别名`);
  }
}

export function addCharacter(work: Work, input: CharacterInput): Character {
  const character: Character = { ...input, id: id('character'), locked: false, createdAt: now() };
  assertUniqueNames(work, character);
  work.characters.set(character.id, character);
  return character;
}

export function updateCharacter(work: Work, characterId: string, patch: CharacterPatch): Character {
  const character = mustGet(work.characters, characterId, 'character');
  const changes = defined(patch);
  guardLocked(character, changes, `人物「${character.name}」`);
  const next = { ...character, ...changes };
  assertUniqueNames(work, next, character.id);
  Object.assign(character, next);
  return character;
}

export function removeCharacter(work: Work, characterId: string): void {
  const character = mustGet(work.characters, characterId, 'character');
  if (character.locked) throw new LockedConstraintError(`人物「${character.name}」已锁定，先解锁再删除`);
  const used = [...work.relationships.values()].filter((item) => item.fromCharacterId === characterId || item.toCharacterId === characterId);
  if (used.length) throw new SettingConflictError(`人物「${character.name}」还有 ${used.length} 条关系，先删除这些关系`);
  work.characters.delete(characterId);
}

function assertRelationship(work: Work, next: RelationshipInput, selfId?: string): void {
  mustGet(work.characters, next.fromCharacterId, 'character');
  mustGet(work.characters, next.toCharacterId, 'character');
  if (next.fromCharacterId === next.toCharacterId) throw new SettingConflictError('关系的两端不能是同一个人物');
  const duplicate = [...work.relationships.values()].find((item) => item.id !== selfId
    && item.fromCharacterId === next.fromCharacterId && item.toCharacterId === next.toCharacterId
    && item.kind === next.kind && (item.layer ?? 'objective') === next.layer);
  if (duplicate) throw new SettingConflictError('这两个人物之间已经有同类关系');
}

export function addSettingRelationship(work: Work, input: RelationshipInput): Relationship {
  assertRelationship(work, input);
  const relationship: Relationship = { ...input, id: id('relationship'), locked: false };
  work.relationships.set(relationship.id, relationship);
  return relationship;
}

export function updateSettingRelationship(work: Work, relationshipId: string, patch: RelationshipPatch): Relationship {
  const relationship = mustGet(work.relationships, relationshipId, 'relationship');
  const changes = defined(patch);
  guardLocked(relationship, changes, '这条关系');
  const next = { ...relationship, ...changes };
  assertRelationship(work, { ...next, layer: next.layer ?? 'objective', note: next.note ?? '' }, relationship.id);
  Object.assign(relationship, next);
  return relationship;
}

export function removeSettingRelationship(work: Work, relationshipId: string): void {
  const relationship = mustGet(work.relationships, relationshipId, 'relationship');
  if (relationship.locked) throw new LockedConstraintError('这条关系已锁定，先解锁再删除');
  work.relationships.delete(relationshipId);
}

export function addWorldRule(work: Work, input: WorldRuleInput): WorldRule {
  const rule: WorldRule = { ...input, id: id('rule'), locked: false, createdAt: now() };
  work.worldRules.set(rule.id, rule);
  return rule;
}

export function updateWorldRule(work: Work, ruleId: string, patch: WorldRulePatch): WorldRule {
  const rule = mustGet(work.worldRules, ruleId, 'rule');
  const changes = defined(patch);
  guardLocked(rule, changes, `规则「${rule.title}」`);
  Object.assign(rule, changes);
  return rule;
}

export function removeWorldRule(work: Work, ruleId: string): void {
  const rule = mustGet(work.worldRules, ruleId, 'rule');
  if (rule.locked) throw new LockedConstraintError(`规则「${rule.title}」已锁定，先解锁再删除`);
  work.worldRules.delete(ruleId);
}

function assertPrerequisites(work: Work, prerequisites: string[], selfId?: string): void {
  for (const prerequisite of prerequisites) {
    if (prerequisite === selfId) throw new SettingConflictError('节点不能把自己当作前置条件');
    mustGet(work.plotNodes, prerequisite, 'plot node');
  }
}

export function addPlotNode(work: Work, input: PlotNodeInput): PlotNode {
  assertPrerequisites(work, input.prerequisites);
  const node: PlotNode = { ...input, id: id('plot'), realization: { status: 'unrealized', updatedAt: now() } };
  work.plotNodes.set(node.id, node);
  return node;
}

export function updatePlotNode(work: Work, nodeId: string, patch: PlotNodePatch): PlotNode {
  const node = mustGet(work.plotNodes, nodeId, 'plot node');
  const changes = defined(patch);
  if (changes.prerequisites) assertPrerequisites(work, changes.prerequisites, node.id);
  Object.assign(node, changes);
  return node;
}

export function removePlotNode(work: Work, nodeId: string): void {
  const node = mustGet(work.plotNodes, nodeId, 'plot node');
  if (node.realization.status !== 'unrealized') throw new SettingConflictError(`节点「${node.title}」已有正文落实记录，不能删除`);
  const dependents = [...work.plotNodes.values()].filter((item) => item.prerequisites.includes(nodeId));
  if (dependents.length) throw new SettingConflictError(`节点「${node.title}」是 ${dependents.length} 个节点的前置条件，先改掉这些依赖`);
  work.plotNodes.delete(nodeId);
}
