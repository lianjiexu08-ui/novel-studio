import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  characterInputSchema,
  characterPatchSchema,
  plotNodeInputSchema,
  plotNodePatchSchema,
  relationshipInputSchema,
  relationshipPatchSchema,
  worldRuleInputSchema,
  worldRulePatchSchema,
  type BibleDto,
  type CharacterDto,
  type PlotNodeDto,
  type RelationshipDto,
  type WorldRuleDto,
} from 'novel-studio-contracts';
import { lockPolicyOf, type Character, type PlotNode, type Relationship, type Work, type WorldRule } from '../../../novel-service-core/src/core.ts';
import {
  addCharacter, addPlotNode, addSettingRelationship, addWorldRule,
  removeCharacter, removePlotNode, removeSettingRelationship, removeWorldRule,
  unifiedCharacters,
  updateCharacter, updatePlotNode, updateSettingRelationship, updateWorldRule,
} from '../../../novel-service-core/src/bible.ts';
import type { ChapterWorkflow, WorkRepository } from '../../../packages/application/src/index.ts';

const workParam = z.object({ workId: z.string().min(1) });
const itemParam = z.object({ workId: z.string().min(1), itemId: z.string().min(1) });

function toCharacterDto(character: Character): CharacterDto {
  return { ...character, aliases: [...character.aliases] };
}

function toRelationshipDto(relationship: Relationship): RelationshipDto {
  return {
    id: relationship.id,
    fromCharacterId: relationship.fromCharacterId,
    toCharacterId: relationship.toCharacterId,
    layer: relationship.layer ?? 'objective',
    kind: relationship.kind,
    value: relationship.value,
    note: relationship.note ?? '',
    sinceChapter: relationship.sinceChapter,
    locked: relationship.locked,
    lockPolicy: lockPolicyOf(relationship),
  };
}

function toWorldRuleDto(rule: WorldRule): WorldRuleDto {
  return { ...rule };
}

function toPlotNodeDto(node: PlotNode): PlotNodeDto {
  return {
    id: node.id,
    level: node.level ?? 'chapter',
    title: node.title,
    expectedResult: node.expectedResult,
    targetChapter: node.targetChapter,
    prerequisites: [...node.prerequisites],
    realization: { ...node.realization },
  };
}

export function toBibleDto(work: Work): BibleDto {
  return {
    characters: [...work.characters.values()].map(toCharacterDto),
    relationships: [...work.relationships.values()].map(toRelationshipDto),
    worldRules: [...work.worldRules.values()].map(toWorldRuleDto),
    plotNodes: [...work.plotNodes.values()].map(toPlotNodeDto),
    states: [...work.states.values()].map((state) => ({
      characterId: state.characterId,
      field: state.field,
      value: state.value,
      sourceChapterVersionId: state.sourceChapterVersionId,
      storyTime: state.storyTime,
    })),
  };
}

export function registerSettingsRoutes(
  app: FastifyInstance,
  deps: { workflow: ChapterWorkflow; repository: WorkRepository; notFound: (message: string) => Error },
): void {
  const { workflow, repository, notFound } = deps;

  app.get('/works/:workId/bible', async (request) => {
    const { workId } = workParam.parse(request.params);
    const work = await repository.get(workId);
    if (!work) throw notFound(`unknown work ${workId}`);
    return toBibleDto(work);
  });

  app.get('/works/:workId/entities', async (request) => {
    const { workId } = workParam.parse(request.params);
    const work = await repository.get(workId);
    if (!work) throw notFound(`unknown work ${workId}`);
    return unifiedCharacters(work);
  });

  app.post('/works/:workId/characters', async (request, reply) => {
    const { workId } = workParam.parse(request.params);
    const body = characterInputSchema.parse(request.body ?? {});
    return reply.code(201).send(toCharacterDto(await workflow.editSettings(workId, (work) => addCharacter(work, body))));
  });
  app.patch('/works/:workId/characters/:itemId', async (request) => {
    const { workId, itemId } = itemParam.parse(request.params);
    const body = characterPatchSchema.parse(request.body ?? {});
    return toCharacterDto(await workflow.editSettings(workId, (work) => updateCharacter(work, itemId, body)));
  });
  app.delete('/works/:workId/characters/:itemId', async (request) => {
    const { workId, itemId } = itemParam.parse(request.params);
    await workflow.editSettings(workId, (work) => removeCharacter(work, itemId));
    return { ok: true };
  });

  app.post('/works/:workId/relationships', async (request, reply) => {
    const { workId } = workParam.parse(request.params);
    const body = relationshipInputSchema.parse(request.body ?? {});
    return reply.code(201).send(toRelationshipDto(await workflow.editSettings(workId, (work) => addSettingRelationship(work, body))));
  });
  app.patch('/works/:workId/relationships/:itemId', async (request) => {
    const { workId, itemId } = itemParam.parse(request.params);
    const body = relationshipPatchSchema.parse(request.body ?? {});
    return toRelationshipDto(await workflow.editSettings(workId, (work) => updateSettingRelationship(work, itemId, body)));
  });
  app.delete('/works/:workId/relationships/:itemId', async (request) => {
    const { workId, itemId } = itemParam.parse(request.params);
    await workflow.editSettings(workId, (work) => removeSettingRelationship(work, itemId));
    return { ok: true };
  });

  app.post('/works/:workId/world-rules', async (request, reply) => {
    const { workId } = workParam.parse(request.params);
    const body = worldRuleInputSchema.parse(request.body ?? {});
    return reply.code(201).send(toWorldRuleDto(await workflow.editSettings(workId, (work) => addWorldRule(work, body))));
  });
  app.patch('/works/:workId/world-rules/:itemId', async (request) => {
    const { workId, itemId } = itemParam.parse(request.params);
    const body = worldRulePatchSchema.parse(request.body ?? {});
    return toWorldRuleDto(await workflow.editSettings(workId, (work) => updateWorldRule(work, itemId, body)));
  });
  app.delete('/works/:workId/world-rules/:itemId', async (request) => {
    const { workId, itemId } = itemParam.parse(request.params);
    await workflow.editSettings(workId, (work) => removeWorldRule(work, itemId));
    return { ok: true };
  });

  app.post('/works/:workId/plot-nodes', async (request, reply) => {
    const { workId } = workParam.parse(request.params);
    const body = plotNodeInputSchema.parse(request.body ?? {});
    return reply.code(201).send(toPlotNodeDto(await workflow.editSettings(workId, (work) => addPlotNode(work, body))));
  });
  app.patch('/works/:workId/plot-nodes/:itemId', async (request) => {
    const { workId, itemId } = itemParam.parse(request.params);
    const body = plotNodePatchSchema.parse(request.body ?? {});
    return toPlotNodeDto(await workflow.editSettings(workId, (work) => updatePlotNode(work, itemId, body)));
  });
  app.delete('/works/:workId/plot-nodes/:itemId', async (request) => {
    const { workId, itemId } = itemParam.parse(request.params);
    await workflow.editSettings(workId, (work) => removePlotNode(work, itemId));
    return { ok: true };
  });
}
