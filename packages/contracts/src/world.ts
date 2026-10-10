import { z } from 'zod';

export const canonStatusSchema = z.enum(['draft', 'proposed', 'reviewed', 'locked', 'deprecated']);
export const worldAxiomSchema = z.object({
  id: z.string().min(1), title: z.string().trim().min(1), content: z.string(), scope: z.string().trim().min(1), precedence: z.number().int(), status: canonStatusSchema,
});
export const powerSystemDefinitionSchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1), source: z.string(), unit: z.string().trim().min(1), realmIds: z.array(z.string().min(1)), status: canonStatusSchema,
});
export const powerRealmDefinitionSchema = z.object({
  id: z.string().min(1), systemId: z.string().min(1), name: z.string().trim().min(1), rank: z.number().int().positive(), prerequisites: z.array(z.string().min(1)), capabilities: z.array(z.string()), cost: z.string(), counters: z.array(z.string()), status: canonStatusSchema,
});
export const techniqueDefinitionSchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1), kind: z.enum(['technique', 'cultivation', 'bloodline', 'secret']), allowedRealmIds: z.array(z.string().min(1)), effect: z.string(), cost: z.string(), limitations: z.array(z.string()), counters: z.array(z.string()), status: canonStatusSchema,
});
export const artifactDefinitionSchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1), tier: z.string().trim().min(1), effect: z.string(), cost: z.string(), limitations: z.array(z.string()), status: canonStatusSchema,
});
export const resourceDefinitionSchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1), unit: z.string().trim().min(1), source: z.string(), scarcity: z.string(), status: canonStatusSchema,
});
export const worldLocationSchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1), kind: z.enum(['plane', 'continent', 'country', 'region', 'city', 'sect', 'secret_realm', 'ruin', 'other']), parentId: z.string().min(1).optional(), entryConditions: z.array(z.string()), status: canonStatusSchema,
});
export const worldFactionSchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1), kind: z.enum(['empire', 'sect', 'clan', 'merchant', 'religion', 'species', 'other']), locationIds: z.array(z.string().min(1)), goals: z.array(z.string()), resources: z.array(z.string()), status: canonStatusSchema,
});
export const historicalEventDefinitionSchema = z.object({
  id: z.string().min(1), title: z.string().trim().min(1), storyTime: z.string().trim().min(1), causes: z.array(z.string()), consequences: z.array(z.string()), factionIds: z.array(z.string().min(1)), status: canonStatusSchema,
});
export const terminologyDefinitionSchema = z.object({
  id: z.string().min(1), canonical: z.string().trim().min(1), aliases: z.array(z.string().trim().min(1)), kind: z.enum(['person', 'place', 'faction', 'realm', 'technique', 'artifact', 'resource', 'other']), status: canonStatusSchema,
});
export const unresolvedQuestionSchema = z.object({
  id: z.string().min(1), question: z.string().trim().min(1), blocking: z.boolean(), status: z.enum(['open', 'resolved', 'deferred']),
});

export const worldPackSchema = z.object({
  id: z.string().min(1), revision: z.number().int().positive(), title: z.string().trim().min(1), summary: z.string(), status: canonStatusSchema,
  axioms: z.array(worldAxiomSchema), powerSystems: z.array(powerSystemDefinitionSchema), realms: z.array(powerRealmDefinitionSchema), techniques: z.array(techniqueDefinitionSchema), artifacts: z.array(artifactDefinitionSchema), resources: z.array(resourceDefinitionSchema), locations: z.array(worldLocationSchema), factions: z.array(worldFactionSchema), historicalEvents: z.array(historicalEventDefinitionSchema), terminology: z.array(terminologyDefinitionSchema), unresolvedQuestions: z.array(unresolvedQuestionSchema), createdAt: z.string().datetime(), lockedAt: z.string().datetime().optional(),
});

export const storyCharacterSeedSchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1), role: z.enum(['protagonist', 'major', 'supporting', 'stage']), goal: z.string(), identity: z.string(), locationId: z.string().min(1).optional(), factionId: z.string().min(1).optional(), startingRealmId: z.string().min(1).optional(),
});
export const storyRelationshipSeedSchema = z.object({
  id: z.string().min(1), fromCharacterId: z.string().min(1), toCharacterId: z.string().min(1), kind: z.enum(['kinship', 'social', 'trust', 'emotion', 'allegiance', 'private_intent', 'belief']), value: z.string(), locked: z.boolean(), lockPolicy: z.enum(['document_revision_locked', 'baseline_locked', 'event_change_forbidden', 'evolvable']).optional(), sinceChapter: z.number().int().positive().optional(), untilChapter: z.number().int().positive().optional(),
});
export const storySecretSeedSchema = z.object({
  id: z.string().min(1), ownerCharacterId: z.string().min(1), title: z.string().trim().min(1), truth: z.string(), revealCondition: z.string(), status: canonStatusSchema,
});
export const storyArcBeatSeedSchema = z.object({
  id: z.string().min(1), arcId: z.string().min(1), characterId: z.string().min(1), kind: z.enum(['trigger', 'belief_shift', 'choice', 'cost', 'consequence', 'resolution']), plannedChapter: z.number().int().positive().optional(), expectedChange: z.string(),
});
export const storyPromiseSeedSchema = z.object({
  id: z.string().min(1), title: z.string().trim().min(1), promise: z.string(), payoffCondition: z.string(), plannedChapter: z.number().int().positive().optional(), status: canonStatusSchema,
});
export const storyThreadSeedSchema = z.object({
  id: z.string().min(1), title: z.string().trim().min(1), kind: z.enum(['main', 'subplot', 'mystery', 'open']), question: z.string(), plannedResolution: z.string(), status: canonStatusSchema,
});
export const storyArcSeedSchema = z.object({
  id: z.string().min(1), title: z.string().trim().min(1), characterIds: z.array(z.string().min(1)), goal: z.string(), stakes: z.string(), plannedOutcome: z.string(),
});
export const storyVolumeSeedSchema = z.object({
  id: z.string().min(1), order: z.number().int().positive(), title: z.string().trim().min(1), goal: z.string(), climax: z.string(), endState: z.string(), plannedChapterCount: z.number().int().positive(), arcIds: z.array(z.string().min(1)),
});
export const storyBibleSchema = z.object({
  id: z.string().min(1), revision: z.number().int().positive(), worldPackId: z.string().min(1), worldPackRevision: z.number().int().positive(), status: canonStatusSchema, coreConflict: z.string().trim().min(1), endingDirection: z.string(), characters: z.array(storyCharacterSeedSchema), relationships: z.array(storyRelationshipSeedSchema), secrets: z.array(storySecretSeedSchema).optional(), arcBeats: z.array(storyArcBeatSeedSchema).optional(), promises: z.array(storyPromiseSeedSchema).optional(), openThreads: z.array(storyThreadSeedSchema).optional(), arcs: z.array(storyArcSeedSchema), volumes: z.array(storyVolumeSeedSchema), unresolvedQuestions: z.array(unresolvedQuestionSchema), createdAt: z.string().datetime(), lockedAt: z.string().datetime().optional(),
});

export type WorldPackContract = z.infer<typeof worldPackSchema>;
export type StoryBibleContract = z.infer<typeof storyBibleSchema>;

export function parseWorldPack(input: unknown): WorldPackContract {
  return worldPackSchema.parse(input);
}

export function parseStoryBible(input: unknown): StoryBibleContract {
  return storyBibleSchema.parse(input);
}
