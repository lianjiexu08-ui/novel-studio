import { ModelGateway, OpenAICompatibleAdapter, UsageLedger } from '../../model-gateway/src/index.ts';
import { parseGenerateChapterResponse, parseStoryBible, parseWorldPack } from 'novel-studio-contracts';
import type { ContextManifest, CreativeCovenant, GeneratedChapter, ModelProvider, Work } from '../../../novel-service-core/src/core.ts';
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

/** Network-backed chapter writer. The core still keeps a synchronous fallback for offline mode. */
export class OpenAICompatibleChapterProvider implements ModelProvider {
  private readonly client: PlanningClient;

  constructor(endpoint: string, apiKey: string, model: string, budgetUsd = Number.POSITIVE_INFINITY) {
    this.client = new OpenAICompatiblePlanningClient(endpoint, apiKey, model, budgetUsd);
  }

  generateChapter(): GeneratedChapter {
    throw new Error('network chapter provider must be called through generateChapterAsync');
  }

  async generateChapterAsync(input: { work: Work; chapterNumber: number; context: ContextManifest }): Promise<GeneratedChapter> {
    const recentChapters = input.context.adoptedVersionIds
      .map((versionId) => input.work.versions.get(versionId))
      .filter((version): version is NonNullable<typeof version> => Boolean(version))
      .slice(-8)
      .map((version) => ({ chapterNumber: version.chapterNumber, content: version.content }));
    const response = await this.client.complete({
      system: chapterSystem,
      user: JSON.stringify({
        task: 'generate_chapter', chapterNumber: input.chapterNumber, title: input.work.title,
        covenant: input.work.covenant, worldPack: input.work.worldPack, storyBible: input.work.storyBible,
        context: input.context, recentChapters,
      }, null, 2),
      maxOutputTokens: Math.max(4_000, Math.min(12_000, Math.ceil(input.work.covenant.chapterWords * 1.8))),
    });
    return parseGenerateChapterResponse(readJson(response)) as GeneratedChapter;
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
const chapterSystem = `你是同一本长篇玄幻小说的章节写作模型。只返回一个 JSON 对象，不要 Markdown，不要解释。content 用中文写完整章节，遵守创作约定、已锁定世界包和 Story Bible，并参考最近章节保持人物、力量、地点和时间连续。proposedEvents 必须记录本章真正改变的事实，eventType 只能使用 character_state、relationship_change、knowledge_belief、resource_change、artifact_change、plot_progress；observedEvents 必须与 proposedEvents 完全一致。每个事件都要有 evidence，subjectId 使用世界包或 Story Bible 中已有的稳定 ID；没有变化就返回空数组。不要擅自改写锁定关系、境界规则或分卷目标。`;
