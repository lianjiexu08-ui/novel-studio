import { randomUUID } from 'node:crypto';

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const now = () => new Date().toISOString();

export class CanonGateError extends Error {}

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
  lockPolicy?: 'document_revision_locked' | 'baseline_locked' | 'event_change_forbidden' | 'evolvable';
  sinceChapter?: number;
  untilChapter?: number;
}

export interface StorySecretSeed {
  id: string;
  ownerCharacterId: string;
  title: string;
  truth: string;
  revealCondition: string;
  status: CanonStatus;
}

export interface StoryArcBeatSeed {
  id: string;
  arcId: string;
  characterId: string;
  kind: 'trigger' | 'belief_shift' | 'choice' | 'cost' | 'consequence' | 'resolution';
  plannedChapter?: number;
  expectedChange: string;
}

export interface StoryPromiseSeed {
  id: string;
  title: string;
  promise: string;
  payoffCondition: string;
  plannedChapter?: number;
  status: CanonStatus;
}

export interface StoryThreadSeed {
  id: string;
  title: string;
  kind: 'main' | 'subplot' | 'mystery' | 'open';
  question: string;
  plannedResolution: string;
  status: CanonStatus;
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

/** A concrete opening outline. Long books are expanded only after these first
 * chapters have a reviewable plan, so the writer never has to invent the
 * opening sequence from a volume summary alone. */
export interface StoryChapterPlan {
  id: string;
  chapterNumber: number;
  title: string;
  purpose: string;
  conflict: string;
  turningPoint: string;
  endHook: string;
  characterIds: string[];
  locationIds: string[];
  arcBeatIds: string[];
  requiredEvents: string[];
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
  secrets?: StorySecretSeed[];
  arcBeats?: StoryArcBeatSeed[];
  promises?: StoryPromiseSeed[];
  openThreads?: StoryThreadSeed[];
  arcs: StoryArcSeed[];
  volumes: StoryVolumeSeed[];
  chapterPlans?: StoryChapterPlan[];
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
  const requiredCollections: Array<[string, unknown[]]> = [
    ['axioms', pack.axioms], ['power systems', pack.powerSystems], ['realms', pack.realms], ['techniques', pack.techniques],
    ['artifacts', pack.artifacts], ['resources', pack.resources], ['locations', pack.locations], ['factions', pack.factions],
    ['historical events', pack.historicalEvents], ['terminology', pack.terminology],
  ];
  for (const [label, items] of requiredCollections) if (items.length === 0) errors.push(`world pack requires at least one ${label} definition`);
  if (!pack.summary.trim()) warnings.push('world pack summary is empty');
  if (pack.powerSystems.some((system) => system.realmIds.length === 0)) errors.push('a power system has no realm ladder');
  if (hasBlockingQuestions(pack.unresolvedQuestions)) warnings.push('blocking unresolved questions remain');
  return { ready: errors.length === 0, errors, warnings };
}

/** Scale and progression checks used once a Story Bible enters the long-form
 * production path. The normal world validator remains useful for small drafts. */
export function validateLongFormWorldPack(pack: WorldPack): GateResult {
  const base = validateWorldPack(pack);
  const errors = [...base.errors];
  const warnings = [...base.warnings];
  const minimums: Array<[string, number, number]> = [
    ['power systems', pack.powerSystems.length, 1], ['realms', pack.realms.length, 3],
    ['techniques', pack.techniques.length, 3], ['artifacts', pack.artifacts.length, 3],
    ['resources', pack.resources.length, 3], ['locations', pack.locations.length, 3],
    ['factions', pack.factions.length, 3], ['historical events', pack.historicalEvents.length, 3],
  ];
  for (const [label, actual, expected] of minimums) if (actual < expected) errors.push(`long-form world pack requires ${expected} ${label}; found ${actual}`);
  if (pack.locations.filter((location) => location.kind === 'continent').length < 3) errors.push('long-form world pack requires at least 3 continent locations');
  for (const system of pack.powerSystems) {
    const realms = pack.realms.filter((realm) => realm.systemId === system.id).sort((a, b) => a.rank - b.rank);
    const ranks = new Set<number>();
    for (const realm of realms) {
      if (ranks.has(realm.rank)) errors.push(`power system ${system.id} has duplicate realm rank ${realm.rank}`);
      ranks.add(realm.rank);
      if (realm.rank < 1) errors.push(`realm ${realm.id} must have a positive rank`);
    }
    if (realms.length >= 3 && realms.some((realm, index) => index > 0 && realm.rank <= realms[index - 1].rank)) errors.push(`power system ${system.id} realm ranks are not strictly increasing`);
  }
  return { ready: errors.length === 0, errors, warnings };
}

export function lockWorldPack(pack: WorldPack): WorldPack {
  if (pack.status !== 'reviewed') throw new CanonGateError('world pack must be reviewed before locking');
  const result = validateWorldPack(pack);
  if (!result.ready) throw new CanonGateError(`world pack is invalid: ${result.errors.join('; ')}`);
  if (hasBlockingQuestions(pack.unresolvedQuestions)) throw new CanonGateError('blocking world pack questions must be resolved before locking');
  return { ...pack, status: 'locked', revision: pack.revision + 1, lockedAt: now() };
}

/** Mark a proposed world pack as reviewed after running all structural checks. */
export function reviewWorldPack(pack: WorldPack): WorldPack {
  if (pack.status === 'locked') return { ...pack };
  if (!['draft', 'proposed', 'reviewed'].includes(pack.status)) throw new CanonGateError('deprecated world pack cannot be reviewed');
  const result = validateWorldPack(pack);
  if (!result.ready) throw new CanonGateError(`world pack is invalid: ${result.errors.join('; ')}`);
  if (hasBlockingQuestions(pack.unresolvedQuestions)) throw new CanonGateError('blocking world pack questions must be resolved before review');
  return { ...pack, status: 'reviewed', revision: pack.status === 'reviewed' ? pack.revision : pack.revision + 1 };
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
  collectIds(bible.secrets ?? [], 'secrets', errors);
  collectIds(bible.arcBeats ?? [], 'arc beats', errors);
  collectIds(bible.promises ?? [], 'promises', errors);
  collectIds(bible.openThreads ?? [], 'open threads', errors);
  collectIds(bible.volumes, 'volumes', errors);
  collectIds(bible.chapterPlans ?? [], 'chapter plans', errors);
  for (const character of bible.characters) {
    if (character.locationId && !locationIds.has(character.locationId)) errors.push(`character ${character.id} references unknown location ${character.locationId}`);
    if (character.factionId && !factionIds.has(character.factionId)) errors.push(`character ${character.id} references unknown faction ${character.factionId}`);
    if (character.startingRealmId && !realmIds.has(character.startingRealmId)) errors.push(`character ${character.id} references unknown realm ${character.startingRealmId}`);
  }
  for (const relationship of bible.relationships) {
    if (!characterIds.has(relationship.fromCharacterId) || !characterIds.has(relationship.toCharacterId)) errors.push(`relationship ${relationship.id} references unknown character`);
    if (relationship.fromCharacterId === relationship.toCharacterId) errors.push(`relationship ${relationship.id} cannot connect a character to itself`);
    if (relationship.sinceChapter !== undefined && relationship.untilChapter !== undefined && relationship.untilChapter < relationship.sinceChapter) errors.push(`relationship ${relationship.id} has an invalid chapter interval`);
  }
  for (const secret of bible.secrets ?? []) {
    if (!characterIds.has(secret.ownerCharacterId)) errors.push(`secret ${secret.id} references unknown owner ${secret.ownerCharacterId}`);
  }
  for (const arc of bible.arcs) {
    for (const characterId of arc.characterIds) if (!characterIds.has(characterId)) errors.push(`arc ${arc.id} references unknown character ${characterId}`);
  }
  for (const beat of bible.arcBeats ?? []) {
    if (!arcIds.has(beat.arcId)) errors.push(`arc beat ${beat.id} references unknown arc ${beat.arcId}`);
    if (!characterIds.has(beat.characterId)) errors.push(`arc beat ${beat.id} references unknown character ${beat.characterId}`);
  }
  for (const volume of bible.volumes) {
    if (volumeOrders.has(volume.order)) errors.push(`volumes have duplicate order ${volume.order}`);
    volumeOrders.add(volume.order);
    if (volume.plannedChapterCount < 1) errors.push(`volume ${volume.id} must plan at least one chapter`);
    for (const arcId of volume.arcIds) if (!arcIds.has(arcId)) errors.push(`volume ${volume.id} references unknown arc ${arcId}`);
  }
  const arcBeatIds = new Set((bible.arcBeats ?? []).map((beat) => beat.id));
  for (const plan of bible.chapterPlans ?? []) {
    if (!Number.isInteger(plan.chapterNumber) || plan.chapterNumber < 1) errors.push(`chapter plan ${plan.id} has an invalid chapter number`);
    if (!plan.title.trim() || !plan.purpose.trim() || !plan.conflict.trim() || !plan.turningPoint.trim() || !plan.endHook.trim()) errors.push(`chapter plan ${plan.id} must include title, purpose, conflict, turning point and end hook`);
    for (const characterId of plan.characterIds) if (!characterIds.has(characterId)) errors.push(`chapter plan ${plan.id} references unknown character ${characterId}`);
    for (const locationId of plan.locationIds) if (!locationIds.has(locationId)) errors.push(`chapter plan ${plan.id} references unknown location ${locationId}`);
    for (const arcBeatId of plan.arcBeatIds) if (!arcBeatIds.has(arcBeatId)) errors.push(`chapter plan ${plan.id} references unknown arc beat ${arcBeatId}`);
  }
  if (!bible.coreConflict.trim()) errors.push('story bible core conflict is required');
  if (!bible.endingDirection.trim()) errors.push('story bible ending direction is required');
  if (!bible.characters.some((character) => character.role === 'protagonist')) errors.push('story bible needs a protagonist');
  if (!bible.volumes.length) errors.push('story bible needs at least one volume');
  if (!bible.relationships.length) errors.push('story bible needs initial character relationships');
  if (!bible.arcs.length) errors.push('story bible needs at least one story arc');
  const sortedOrders = [...volumeOrders].sort((a, b) => a - b);
  if (sortedOrders.some((order, index) => order !== index + 1)) errors.push('volume orders must be contiguous starting at 1');
  if (hasBlockingQuestions(bible.unresolvedQuestions)) warnings.push('blocking unresolved story questions remain');
  return { ready: errors.length === 0, errors, warnings };
}

/** Extra guarantees for the multi-volume production path. Short hand-authored
 * bibles may remain valid, but a long-form manuscript must have explicit
 * objects that can later receive chapter evidence and closure status. */
export function validateLongFormStoryBible(bible: StoryBible, worldPack: WorldPack, expectedChapterCount?: number): GateResult {
  const base = validateStoryBible(bible, worldPack);
  const errors = [...base.errors];
  const warnings = [...base.warnings];
  const chapterCount = bible.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0);
  if (expectedChapterCount !== undefined && chapterCount !== expectedChapterCount) errors.push(`story bible plans ${chapterCount} chapters; expected ${expectedChapterCount}`);
  if (chapterCount >= 100 && bible.volumes.length < 3) errors.push('long-form story bible requires at least 3 volumes');
  const openingPlans = [...(bible.chapterPlans ?? [])].sort((a, b) => a.chapterNumber - b.chapterNumber);
  if (chapterCount >= 50) {
    if (openingPlans.length < 50) errors.push(`long-form story bible requires a 50-chapter opening plan; found ${openingPlans.length}`);
    const expected = Array.from({ length: 50 }, (_, index) => index + 1);
    if (openingPlans.slice(0, 50).map((plan) => plan.chapterNumber).some((chapter, index) => chapter !== expected[index])) errors.push('opening chapter plans must cover chapters 1 through 50 without gaps');
  }
  if (!bible.secrets?.length) errors.push('long-form story bible requires at least one secret with a reveal condition');
  if (!bible.arcBeats?.length) errors.push('long-form story bible requires at least one arc beat');
  if (!bible.promises?.length) errors.push('long-form story bible requires at least one promise with a payoff condition');
  if (!bible.openThreads?.length) errors.push('long-form story bible requires at least one open thread with a planned resolution');
  for (const secret of bible.secrets ?? []) if (!secret.revealCondition.trim()) errors.push(`secret ${secret.id} has no reveal condition`);
  for (const promise of bible.promises ?? []) if (!promise.payoffCondition.trim()) errors.push(`promise ${promise.id} has no payoff condition`);
  for (const thread of bible.openThreads ?? []) if (!thread.plannedResolution.trim()) errors.push(`open thread ${thread.id} has no planned resolution`);
  const minimumBeats = Math.max(6, bible.volumes.length * 3);
  if ((bible.arcBeats?.length ?? 0) < minimumBeats) errors.push(`long-form story bible requires at least ${minimumBeats} planned arc beats; found ${bible.arcBeats?.length ?? 0}`);
  for (const volume of bible.volumes) {
    const start = 1 + bible.volumes.slice(0, volume.order - 1).reduce((sum, item) => sum + item.plannedChapterCount, 0);
    const end = start + volume.plannedChapterCount - 1;
    if (!(bible.arcBeats ?? []).some((beat) => beat.plannedChapter !== undefined && beat.plannedChapter >= start && beat.plannedChapter <= end)) errors.push(`volume ${volume.id} has no planned arc beat`);
  }
  return { ready: errors.length === 0, errors, warnings };
}

export function lockStoryBible(bible: StoryBible, worldPack: WorldPack): StoryBible {
  if (worldPack.status !== 'locked') throw new CanonGateError('world pack must be locked before locking the story bible');
  if (bible.status !== 'reviewed') throw new CanonGateError('story bible must be reviewed before locking');
  const result = validateStoryBible(bible, worldPack);
  if (!result.ready) throw new CanonGateError(`story bible is invalid: ${result.errors.join('; ')}`);
  const plannedChapterCount = bible.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0);
  if (plannedChapterCount >= 100) {
    const longFormWorld = validateLongFormWorldPack(worldPack);
    if (!longFormWorld.ready) throw new CanonGateError(`long-form world pack is invalid: ${longFormWorld.errors.join('; ')}`);
    const longFormBible = validateLongFormStoryBible(bible, worldPack, plannedChapterCount);
    if (!longFormBible.ready) throw new CanonGateError(`long-form story bible is invalid: ${longFormBible.errors.join('; ')}`);
  }
  if (hasBlockingQuestions(bible.unresolvedQuestions)) throw new CanonGateError('blocking story questions must be resolved before locking');
  return { ...bible, status: 'locked', revision: bible.revision + 1, worldPackRevision: worldPack.revision, lockedAt: now() };
}

/** Mark a proposed story bible as reviewed after checking all references. */
export function reviewStoryBible(bible: StoryBible, worldPack: WorldPack): StoryBible {
  if (bible.status === 'locked') return { ...bible };
  if (!['draft', 'proposed', 'reviewed'].includes(bible.status)) throw new CanonGateError('deprecated story bible cannot be reviewed');
  const result = validateStoryBible(bible, worldPack);
  if (!result.ready) throw new CanonGateError(`story bible is invalid: ${result.errors.join('; ')}`);
  if (hasBlockingQuestions(bible.unresolvedQuestions)) throw new CanonGateError('blocking story questions must be resolved before review');
  return { ...bible, status: 'reviewed', revision: bible.status === 'reviewed' ? bible.revision : bible.revision + 1 };
}

export function chapterGenerationGate(worldPack: WorldPack, bible: StoryBible, currentVolumeId?: string): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (worldPack.status !== 'locked') errors.push('world pack is not locked');
  if (bible.status !== 'locked') errors.push('story bible is not locked');
  const worldResult = validateWorldPack(worldPack);
  if (!worldResult.ready) errors.push(...worldResult.errors.map((error) => `world pack: ${error}`));
  const bibleResult = validateStoryBible(bible, worldPack);
  if (!bibleResult.ready) errors.push(...bibleResult.errors.map((error) => `story bible: ${error}`));
  const plannedChapterCount = bible.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0);
  if (plannedChapterCount >= 100) {
    const longFormWorld = validateLongFormWorldPack(worldPack);
    if (!longFormWorld.ready) errors.push(...longFormWorld.errors.map((error) => `long-form world pack: ${error}`));
    const longFormResult = validateLongFormStoryBible(bible, worldPack, plannedChapterCount);
    if (!longFormResult.ready) errors.push(...longFormResult.errors.map((error) => `long-form story bible: ${error}`));
  }
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
