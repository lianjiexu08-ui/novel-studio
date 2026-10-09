import { ModelGateway, OpenAICompatibleAdapter, UsageLedger } from '../../model-gateway/src/index.ts';
import { parseStoryBible, parseWorldPack } from 'novel-studio-contracts';
import type { CreativeCovenant } from '../../../novel-service-core/src/core.ts';
import type { StoryBible, WorldPack } from '../../../novel-service-core/src/world.ts';

export interface PlanningClient {
  complete(input: { system: string; user: string; maxOutputTokens: number }): Promise<string>;
}

export class PlanningParseError extends Error {}

export interface DesignPlanner {
  generateWorldPack(input: { title: string; covenant: CreativeCovenant }): Promise<WorldPack>;
  generateStoryBible(input: { title: string; covenant: CreativeCovenant; worldPack: WorldPack }): Promise<StoryBible>;
}

export class JsonDesignPlanner implements DesignPlanner {
  private readonly client: PlanningClient;

  constructor(client: PlanningClient) { this.client = client; }

  async generateWorldPack(input: { title: string; covenant: CreativeCovenant }): Promise<WorldPack> {
    const text = await this.client.complete({
      system: worldPackSystem,
      user: JSON.stringify({ task: 'generate_world_pack', title: input.title, covenant: input.covenant }, null, 2),
      maxOutputTokens: 12_000,
    });
    const parsed = parseWorldPack(readJson(text));
    return parsed as WorldPack;
  }

  async generateStoryBible(input: { title: string; covenant: CreativeCovenant; worldPack: WorldPack }): Promise<StoryBible> {
    const text = await this.client.complete({
      system: storyBibleSystem,
      user: JSON.stringify({ task: 'generate_story_bible', title: input.title, covenant: input.covenant, worldPack: input.worldPack }, null, 2),
      maxOutputTokens: 12_000,
    });
    const parsed = parseStoryBible(readJson(text));
    return parsed as StoryBible;
  }
}

export class OpenAICompatiblePlanningClient implements PlanningClient {
  private readonly gateway: ModelGateway;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(endpoint: string, apiKey: string, model: string, budgetUsd = Number.POSITIVE_INFINITY) {
    const normalizedEndpoint = endpoint.replace(/\/$/, '');
    this.endpoint = /\/v1$/i.test(normalizedEndpoint) ? normalizedEndpoint : `${normalizedEndpoint}/v1`;
    this.apiKey = apiKey;
    this.model = model;
    this.gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, 60_000)]]), new UsageLedger(budgetUsd));
  }

  async complete(input: { system: string; user: string; maxOutputTokens: number }): Promise<string> {
    const response = await this.gateway.complete({
      role: 'planning', model: this.model, system: input.system, user: input.user,
      maxOutputTokens: input.maxOutputTokens, responseFormat: 'json', temperature: 0.2,
    }, 'openai-compatible', { endpoint: this.endpoint, apiKey: this.apiKey });
    return response.text;
  }
}

function readJson(text: string): unknown {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(normalized);
  } catch {
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');
    if (start < 0 || end <= start) throw new PlanningParseError('planner response did not contain a JSON object');
    try { return JSON.parse(normalized.slice(start, end + 1)); } catch (error) { throw new PlanningParseError(`planner JSON is invalid: ${String(error)}`); }
  }
}

const worldPackSystem = `你是长篇玄幻小说的世界观规划器。只返回一个 JSON 对象，不要 Markdown，不要解释。必须完整包含 id、revision、title、summary、status、createdAt，以及 axioms、powerSystems、realms、techniques、artifacts、resources、locations、factions、historicalEvents、terminology、unresolvedQuestions 数组。所有数组至少有一项；状态使用 proposed；ID 稳定且引用有效。生成可支撑 100 万字、约 450 章、至少 3 卷的世界底座，境界、功法、法宝、资源、地点、势力和历史要具体可检查。createdAt 使用 ISO 8601 时间。`;
const storyBibleSystem = `你是长篇玄幻小说的总纲规划器。只返回一个 JSON 对象，不要 Markdown，不要解释。必须完整包含 id、revision、worldPackId、worldPackRevision、status、coreConflict、endingDirection、characters、relationships、arcs、volumes、unresolvedQuestions、createdAt。至少生成主角、主要配角、对手、关系、秘密、人物弧光和 3 个以上分卷；总计划约 450 章，卷序连续，所有引用必须指向输入世界包或本对象中的有效 ID。状态使用 proposed，createdAt 使用 ISO 8601 时间。`;
