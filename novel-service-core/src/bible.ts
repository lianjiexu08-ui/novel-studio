import { randomUUID } from 'node:crypto';
import { LockedConstraintError, SettingConflictError } from './core.ts';
import type { Character, LockPolicy, PlotNode, Relationship, Work, WorldRule } from './core.ts';

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
export type RelationshipPatch = Partial<RelationshipInput> & { locked?: boolean; lockPolicy?: LockPolicy };
export type WorldRuleInput = Omit<WorldRule, 'id' | 'locked' | 'createdAt'>;
export type WorldRulePatch = Partial<WorldRuleInput> & { locked?: boolean };
export type PlotNodeInput = Required<Pick<PlotNode, 'title' | 'expectedResult' | 'prerequisites' | 'level'>> & Pick<PlotNode, 'targetChapter'>;
export type PlotNodePatch = Partial<PlotNodeInput>;

function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function guardLocked(item: { locked: boolean }, patch: object, label: string): void {
  if (item.locked && Object.keys(patch).some((key) => key !== 'locked' && key !== 'lockPolicy')) {
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

function assertCanonicalLink(work: Work, canonicalId: string | undefined, selfId?: string): void {
  if (!canonicalId) return;
  const seed = work.storyBible?.characters.find((item) => item.id === canonicalId);
  if (!seed) throw new SettingConflictError(`Story Bible 里没有人物 ${canonicalId}`);
  const other = [...work.characters.values()].find((item) => item.id !== selfId && item.canonicalId === canonicalId);
  if (other) throw new SettingConflictError(`Story Bible 人物「${seed.name}」已经和设定页的「${other.name}」关联`);
}

export function addCharacter(work: Work, input: CharacterInput): Character {
  const character: Character = { ...input, canonicalId: input.canonicalId || undefined, id: id('character'), locked: false, createdAt: now() };
  assertUniqueNames(work, character);
  assertCanonicalLink(work, character.canonicalId);
  work.characters.set(character.id, character);
  return character;
}

export function updateCharacter(work: Work, characterId: string, patch: CharacterPatch): Character {
  const character = mustGet(work.characters, characterId, 'character');
  const changes = defined(patch);
  guardLocked(character, changes, `人物「${character.name}」`);
  const next = { ...character, ...changes };
  if (next.canonicalId === '') next.canonicalId = undefined;
  assertUniqueNames(work, next, character.id);
  assertCanonicalLink(work, next.canonicalId, character.id);
  Object.assign(character, next);
  return character;
}

export interface UnifiedCharacter {
  entityId: string;
  name: string;
  aliases: string[];
  sources: Array<'manual' | 'story_bible'>;
  manualId?: string;
  bibleId?: string;
}

export interface EntityConflict {
  kind: 'same_name_unlinked' | 'link_target_missing' | 'name_differs';
  name: string;
  manualId?: string;
  bibleId?: string;
  message: string;
}

/**
 * One person list across the settings page and the Story Bible. A manual entry
 * linked through `canonicalId` is the same entity; an unlinked entry sharing a
 * name with a Bible character is reported, never merged silently.
 */
export function unifiedCharacters(work: Work): { entities: UnifiedCharacter[]; conflicts: EntityConflict[] } {
  const seeds = work.storyBible?.characters ?? [];
  const entities: UnifiedCharacter[] = [];
  const conflicts: EntityConflict[] = [];
  const linkedSeeds = new Set<string>();
  for (const character of work.characters.values()) {
    const names = namesOf(character);
    if (character.canonicalId) {
      const seed = seeds.find((item) => item.id === character.canonicalId);
      if (!seed) {
        conflicts.push({ kind: 'link_target_missing', name: character.name, manualId: character.id, bibleId: character.canonicalId, message: `「${character.name}」关联的 Story Bible 人物 ${character.canonicalId} 已不存在` });
        entities.push({ entityId: character.id, name: character.name, aliases: character.aliases, sources: ['manual'], manualId: character.id });
        continue;
      }
      linkedSeeds.add(seed.id);
      if (!names.includes(seed.name)) conflicts.push({ kind: 'name_differs', name: character.name, manualId: character.id, bibleId: seed.id, message: `同一人物在设定页叫「${character.name}」，在 Story Bible 叫「${seed.name}」；ID 相同不代表设定没变，请确认` });
      entities.push({ entityId: seed.id, name: character.name, aliases: [...new Set([...character.aliases, ...(seed.name === character.name ? [] : [seed.name])])], sources: ['manual', 'story_bible'], manualId: character.id, bibleId: seed.id });
      continue;
    }
    for (const seed of seeds.filter((item) => names.includes(item.name))) {
      conflicts.push({ kind: 'same_name_unlinked', name: seed.name, manualId: character.id, bibleId: seed.id, message: `设定页和 Story Bible 都有「${seed.name}」，但没有关联，会被当成两个人` });
    }
    entities.push({ entityId: character.id, name: character.name, aliases: character.aliases, sources: ['manual'], manualId: character.id });
  }
  for (const seed of seeds) {
    if (!linkedSeeds.has(seed.id)) entities.push({ entityId: seed.id, name: seed.name, aliases: [], sources: ['story_bible'], bibleId: seed.id });
  }
  return { entities, conflicts };
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
  if (changes.lockPolicy) changes.locked = changes.lockPolicy !== 'evolvable';
  else if (changes.locked !== undefined) changes.lockPolicy = changes.locked ? 'event_change_forbidden' : 'evolvable';
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
