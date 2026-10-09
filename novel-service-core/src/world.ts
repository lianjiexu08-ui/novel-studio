import { randomUUID } from 'node:crypto';

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const now = () => new Date().toISOString();

export type CanonStatus = 'draft' | 'proposed' | 'reviewed' | 'locked' | 'deprecated';

export interface WorldAxiom {
  id: string;
  title: string;
  content: string;
  scope: string;
  precedence: number;
  status: CanonStatus;
}

export interface PowerSystemDefinition {
  id: string;
  name: string;
  source: string;
  unit: string;
  realmIds: string[];
  status: CanonStatus;
}

export interface PowerRealmDefinition {
  id: string;
  systemId: string;
  name: string;
  rank: number;
  prerequisites: string[];
  capabilities: string[];
  cost: string;
  counters: string[];
  status: CanonStatus;
}

export interface TechniqueDefinition {
  id: string;
  name: string;
  kind: 'technique' | 'cultivation' | 'bloodline' | 'secret';
  allowedRealmIds: string[];
  effect: string;
  cost: string;
  limitations: string[];
  counters: string[];
  status: CanonStatus;
}

export interface ArtifactDefinition {
  id: string;
  name: string;
  tier: string;
  effect: string;
  cost: string;
  limitations: string[];
  status: CanonStatus;
}

export interface ResourceDefinition {
  id: string;
  name: string;
  unit: string;
  source: string;
  scarcity: string;
  status: CanonStatus;
}

export interface WorldLocation {
  id: string;
  name: string;
  kind: 'plane' | 'continent' | 'country' | 'region' | 'city' | 'sect' | 'secret_realm' | 'ruin' | 'other';
  parentId?: string;
  entryConditions: string[];
  status: CanonStatus;
}

export interface WorldFaction {
  id: string;
  name: string;
  kind: 'empire' | 'sect' | 'clan' | 'merchant' | 'religion' | 'species' | 'other';
  locationIds: string[];
  goals: string[];
  resources: string[];
  status: CanonStatus;
}

export interface HistoricalEventDefinition {
  id: string;
  title: string;
  storyTime: string;
  causes: string[];
  consequences: string[];
  factionIds: string[];
  status: CanonStatus;
}

export interface TerminologyDefinition {
  id: string;
  canonical: string;
  aliases: string[];
  kind: 'person' | 'place' | 'faction' | 'realm' | 'technique' | 'artifact' | 'resource' | 'other';
  status: CanonStatus;
}

export interface UnresolvedQuestion {
  id: string;
  question: string;
  blocking: boolean;
  status: 'open' | 'resolved' | 'deferred';
}

export interface WorldPack {
  id: string;
  revision: number;
  title: string;
  summary: string;
  status: CanonStatus;
  axioms: WorldAxiom[];
  powerSystems: PowerSystemDefinition[];
  realms: PowerRealmDefinition[];
  techniques: TechniqueDefinition[];
  artifacts: ArtifactDefinition[];
  resources: ResourceDefinition[];
  locations: WorldLocation[];
  factions: WorldFaction[];
  historicalEvents: HistoricalEventDefinition[];
  terminology: TerminologyDefinition[];
  unresolvedQuestions: UnresolvedQuestion[];
  createdAt: string;
  lockedAt?: string;
}

export interface StoryCharacterSeed {
  id: string;
  name: string;
  role: 'protagonist' | 'major' | 'supporting' | 'stage';
  goal: string;
  identity: string;
  locationId?: string;
  factionId?: string;
  startingRealmId?: string;
}

export interface StoryRelationshipSeed {
  id: string;
  fromCharacterId: string;
  toCharacterId: string;
  kind: 'kinship' | 'social' | 'trust' | 'emotion' | 'allegiance' | 'private_intent' | 'belief';
  value: string;
  locked: boolean;
}

export interface StoryArcSeed {
  id: string;
  title: string;
  characterIds: string[];
  goal: string;
  stakes: string;
  plannedOutcome: string;
}

export interface StoryVolumeSeed {
  id: string;
  order: number;
  title: string;
  goal: string;
  climax: string;
  endState: string;
  plannedChapterCount: number;
  arcIds: string[];
}

export interface StoryBible {
  id: string;
  revision: number;
  worldPackId: string;
  worldPackRevision: number;
  status: CanonStatus;
  coreConflict: string;
  endingDirection: string;
  characters: StoryCharacterSeed[];
  relationships: StoryRelationshipSeed[];
  arcs: StoryArcSeed[];
  volumes: StoryVolumeSeed[];
  unresolvedQuestions: UnresolvedQuestion[];
  createdAt: string;
  lockedAt?: string;
}

export interface GateResult {
  ready: boolean;
  errors: string[];
  warnings: string[];
}

function collectIds(items: Array<{ id: string }>, label: string, errors: string[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) errors.push(`${label} has duplicate id ${item.id}`);
    ids.add(item.id);
  }
  return ids;
}

function hasBlockingQuestions(questions: UnresolvedQuestion[]): boolean {
  return questions.some((question) => question.blocking && question.status === 'open');
}

function detectLocationCycle(locations: WorldLocation[], errors: string[]): void {
  const byId = new Map(locations.map((location) => [location.id, location]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (locationId: string): void => {
    if (visiting.has(locationId)) {
      errors.push(`locations contain a parent cycle at ${locationId}`);
      return;
    }
    if (visited.has(locationId)) return;
    visiting.add(locationId);
    const parentId = byId.get(locationId)?.parentId;
    if (parentId) {
      if (!byId.has(parentId)) errors.push(`location ${locationId} references unknown parent ${parentId}`);
      else visit(parentId);
    }
    visiting.delete(locationId);
    visited.add(locationId);
  };
  for (const location of locations) visit(location.id);
}

export function validateWorldPack(pack: WorldPack): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const systemIds = collectIds(pack.powerSystems, 'power systems', errors);
  const realmIds = collectIds(pack.realms, 'realms', errors);
  const locationIds = collectIds(pack.locations, 'locations', errors);
  const factionIds = collectIds(pack.factions, 'factions', errors);
  collectIds(pack.axioms, 'axioms', errors);
  collectIds(pack.techniques, 'techniques', errors);
  collectIds(pack.artifacts, 'artifacts', errors);
  collectIds(pack.resources, 'resources', errors);
  collectIds(pack.historicalEvents, 'historical events', errors);
  collectIds(pack.terminology, 'terminology', errors);

  for (const system of pack.powerSystems) {
    for (const realmId of system.realmIds) if (!realmIds.has(realmId)) errors.push(`power system ${system.id} references unknown realm ${realmId}`);
  }
  for (const realm of pack.realms) {
    if (!systemIds.has(realm.systemId)) errors.push(`realm ${realm.id} references unknown power system ${realm.systemId}`);
  }
  for (const technique of pack.techniques) {
    for (const realmId of technique.allowedRealmIds) if (!realmIds.has(realmId)) errors.push(`technique ${technique.id} references unknown realm ${realmId}`);
  }
  for (const faction of pack.factions) {
    for (const locationId of faction.locationIds) if (!locationIds.has(locationId)) errors.push(`faction ${faction.id} references unknown location ${locationId}`);
  }
  for (const event of pack.historicalEvents) {
    for (const factionId of event.factionIds) if (!factionIds.has(factionId)) errors.push(`historical event ${event.id} references unknown faction ${factionId}`);
  }
  detectLocationCycle(pack.locations, errors);
  if (!pack.title.trim()) errors.push('world pack title is required');
  if (!pack.summary.trim()) warnings.push('world pack summary is empty');
  if (pack.powerSystems.some((system) => system.realmIds.length === 0)) warnings.push('a power system has no realm ladder');
  if (pack.locations.length === 0) warnings.push('world pack has no locations');
  if (pack.factions.length === 0) warnings.push('world pack has no factions');
  if (hasBlockingQuestions(pack.unresolvedQuestions)) warnings.push('blocking unresolved questions remain');
  return { ready: errors.length === 0, errors, warnings };
}

export function lockWorldPack(pack: WorldPack): WorldPack {
  if (pack.status !== 'reviewed') throw new Error('world pack must be reviewed before locking');
  const result = validateWorldPack(pack);
  if (!result.ready) throw new Error(`world pack is invalid: ${result.errors.join('; ')}`);
  if (hasBlockingQuestions(pack.unresolvedQuestions)) throw new Error('blocking world pack questions must be resolved before locking');
  return { ...pack, status: 'locked', revision: pack.revision + 1, lockedAt: now() };
}

export function validateStoryBible(bible: StoryBible, worldPack: WorldPack): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const characterIds = collectIds(bible.characters, 'characters', errors);
  const factionIds = new Set(worldPack.factions.map((faction) => faction.id));
  const locationIds = new Set(worldPack.locations.map((location) => location.id));
  const realmIds = new Set(worldPack.realms.map((realm) => realm.id));
  const arcIds = collectIds(bible.arcs, 'story arcs', errors);
  const volumeOrders = new Set<number>();
  collectIds(bible.relationships, 'relationships', errors);
  collectIds(bible.volumes, 'volumes', errors);
  for (const character of bible.characters) {
    if (character.locationId && !locationIds.has(character.locationId)) errors.push(`character ${character.id} references unknown location ${character.locationId}`);
    if (character.factionId && !factionIds.has(character.factionId)) errors.push(`character ${character.id} references unknown faction ${character.factionId}`);
    if (character.startingRealmId && !realmIds.has(character.startingRealmId)) errors.push(`character ${character.id} references unknown realm ${character.startingRealmId}`);
  }
  for (const relationship of bible.relationships) {
    if (!characterIds.has(relationship.fromCharacterId) || !characterIds.has(relationship.toCharacterId)) errors.push(`relationship ${relationship.id} references unknown character`);
    if (relationship.fromCharacterId === relationship.toCharacterId) errors.push(`relationship ${relationship.id} cannot connect a character to itself`);
  }
  for (const arc of bible.arcs) {
    for (const characterId of arc.characterIds) if (!characterIds.has(characterId)) errors.push(`arc ${arc.id} references unknown character ${characterId}`);
  }
  for (const volume of bible.volumes) {
    if (volumeOrders.has(volume.order)) errors.push(`volumes have duplicate order ${volume.order}`);
    volumeOrders.add(volume.order);
    if (volume.plannedChapterCount < 1) errors.push(`volume ${volume.id} must plan at least one chapter`);
    for (const arcId of volume.arcIds) if (!arcIds.has(arcId)) errors.push(`volume ${volume.id} references unknown arc ${arcId}`);
  }
  if (!bible.coreConflict.trim()) errors.push('story bible core conflict is required');
  if (!bible.endingDirection.trim()) warnings.push('ending direction is empty');
  if (!bible.characters.some((character) => character.role === 'protagonist')) errors.push('story bible needs a protagonist');
  if (!bible.volumes.length) errors.push('story bible needs at least one volume');
  if (hasBlockingQuestions(bible.unresolvedQuestions)) warnings.push('blocking unresolved story questions remain');
  return { ready: errors.length === 0, errors, warnings };
}

export function lockStoryBible(bible: StoryBible, worldPack: WorldPack): StoryBible {
  if (worldPack.status !== 'locked') throw new Error('world pack must be locked before locking the story bible');
  if (bible.status !== 'reviewed') throw new Error('story bible must be reviewed before locking');
  const result = validateStoryBible(bible, worldPack);
  if (!result.ready) throw new Error(`story bible is invalid: ${result.errors.join('; ')}`);
  if (hasBlockingQuestions(bible.unresolvedQuestions)) throw new Error('blocking story questions must be resolved before locking');
  return { ...bible, status: 'locked', revision: bible.revision + 1, worldPackRevision: worldPack.revision, lockedAt: now() };
}

export function chapterGenerationGate(worldPack: WorldPack, bible: StoryBible, currentVolumeId?: string): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (worldPack.status !== 'locked') errors.push('world pack is not locked');
  if (bible.status !== 'locked') errors.push('story bible is not locked');
  if (bible.worldPackId !== worldPack.id || bible.worldPackRevision !== worldPack.revision) errors.push('story bible does not use the current world pack revision');
  if (currentVolumeId && !bible.volumes.some((volume) => volume.id === currentVolumeId)) errors.push(`unknown current volume ${currentVolumeId}`);
  if (!currentVolumeId && bible.volumes.length) warnings.push('current volume has not been selected');
  return { ready: errors.length === 0, errors, warnings };
}

export function createEmptyWorldPack(title: string, summary = ''): WorldPack {
  return {
    id: id('world'), revision: 1, title, summary, status: 'draft', axioms: [], powerSystems: [], realms: [], techniques: [], artifacts: [], resources: [], locations: [], factions: [], historicalEvents: [], terminology: [], unresolvedQuestions: [], createdAt: now(),
  };
}
