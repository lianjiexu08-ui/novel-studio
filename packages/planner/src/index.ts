import { ModelGateway, OpenAICompatibleAdapter, UsageLedger, type ModelRole } from '../../model-gateway/src/index.ts';
import { parseGenerateChapterResponse, parseStoryBible, parseWorldPack } from 'novel-studio-contracts';
import type { ContextManifest, CreativeCovenant, GeneratedChapter, ModelProvider, Work } from '../../../novel-service-core/src/core.ts';
import type { StoryBible, WorldPack } from '../../../novel-service-core/src/world.ts';

export interface PlanningClient {
  complete(input: { system: string; user: string; maxOutputTokens: number; role?: ModelRole }): Promise<string>;
}

export class PlanningParseError extends Error {}

export interface DesignPlanner {
  generateWorldPack(input: { title: string; covenant: CreativeCovenant }): Promise<WorldPack>;
  generateStoryBible(input: { title: string; covenant: CreativeCovenant; worldPack: WorldPack }): Promise<StoryBible>;
}

export class JsonDesignPlanner implements DesignPlanner {
  private readonly client: PlanningClient;
  private readonly targetChapters: number;

  constructor(client: PlanningClient, targetChapters = 100) { this.client = client; this.targetChapters = targetChapters; }

  async generateWorldPack(input: { title: string; covenant: CreativeCovenant }): Promise<WorldPack> {
    const text = await this.client.complete({
      system: worldPackSystem,
      user: JSON.stringify({ task: 'generate_world_pack', title: input.title, covenant: input.covenant }, null, 2),
      maxOutputTokens: 12_000,
    });
    const parsed = parseWorldPack(readJson(text));
    assertWorldPackScale(parsed);
    return parsed as WorldPack;
  }

  async generateStoryBible(input: { title: string; covenant: CreativeCovenant; worldPack: WorldPack; chapterTarget?: number }): Promise<StoryBible> {
    const chapterTarget = input.chapterTarget ?? this.targetChapters;
    const text = await this.client.complete({
      system: storyBibleSystem,
      user: JSON.stringify({ task: 'generate_story_bible', title: input.title, covenant: input.covenant, chapterTarget, worldPack: input.worldPack }, null, 2),
      maxOutputTokens: 12_000,
    });
    const parsed = parseStoryBible(readJson(text));
    assertStoryBibleScale(parsed, chapterTarget);
    return parsed as StoryBible;
  }
}

export class OpenAICompatiblePlanningClient implements PlanningClient {
  private readonly gateway: ModelGateway;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(endpoint: string, apiKey: string, model: string, budgetUsd = Number.POSITIVE_INFINITY, timeoutMs = 60_000) {
    const normalizedEndpoint = endpoint.replace(/\/$/, '');
    this.endpoint = /\/v1$/i.test(normalizedEndpoint) ? normalizedEndpoint : `${normalizedEndpoint}/v1`;
    this.apiKey = apiKey;
    this.model = model;
    this.gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, timeoutMs)]]), new UsageLedger(budgetUsd));
  }

  async complete(input: { system: string; user: string; maxOutputTokens: number; role?: ModelRole }): Promise<string> {
    const response = await this.gateway.complete({
      role: input.role ?? 'planning', model: this.model, system: input.system, user: input.user,
      maxOutputTokens: input.maxOutputTokens, responseFormat: 'json', temperature: 0.2,
    }, 'openai-compatible', { endpoint: this.endpoint, apiKey: this.apiKey });
    return response.text;
  }
}

/** Network-backed chapter writer. The core still keeps a synchronous fallback for offline mode. */
export class OpenAICompatibleChapterProvider implements ModelProvider {
  private readonly client: PlanningClient;
  private readonly independentExtraction: boolean;

  constructor(endpoint: string, apiKey: string, model: string, budgetUsd = Number.POSITIVE_INFINITY, timeoutMs = 60_000, independentExtraction = true) {
    this.client = new OpenAICompatiblePlanningClient(endpoint, apiKey, model, budgetUsd, timeoutMs);
    this.independentExtraction = independentExtraction;
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
    const plan = input.work.storyBible ? chapterPlan(input.work.storyBible, input.chapterNumber) : undefined;
    const response = await this.client.complete({
      system: this.independentExtraction ? chapterDraftSystem : chapterSystem,
      user: JSON.stringify({
        task: 'generate_chapter', chapterNumber: input.chapterNumber, title: input.work.title,
        covenant: input.work.covenant, worldPack: input.work.worldPack, storyBible: input.work.storyBible,
        context: input.context, currentPlan: plan, recentChapters,
      }, null, 2),
      maxOutputTokens: Math.max(4_000, Math.min(12_000, Math.ceil(input.work.covenant.chapterWords * 1.8))),
      role: 'writing',
    });
    const draft = parseGenerateChapterResponse(readJson(response)) as GeneratedChapter;
    if (!this.independentExtraction) return draft;
    const extraction = await this.client.complete({
      system: extractionSystem,
      user: JSON.stringify({
        task: 'extract_events', chapterNumber: input.chapterNumber, content: draft.content,
        worldPack: input.work.worldPack, storyBible: input.work.storyBible,
      }, null, 2),
      maxOutputTokens: Math.max(1_500, Math.min(4_000, Math.ceil(input.work.covenant.chapterWords * 0.6))),
      role: 'extraction',
    });
    const extracted = readJson(extraction);
    const observed = extracted && typeof extracted === 'object' && !Array.isArray(extracted)
      ? (extracted as { observedEvents?: unknown }).observedEvents
      : undefined;
    const validated = parseGenerateChapterResponse({ content: draft.content, proposedEvents: draft.proposedEvents, observedEvents: observed });
    return { ...draft, observedEvents: validated.observedEvents as GeneratedChapter['observedEvents'] };
  }
}

function chapterPlan(bible: StoryBible, chapterNumber: number): { volume?: StoryBible['volumes'][number]; nearbyArcBeats: StoryBible['arcBeats']; duePromises: StoryBible['promises']; openThreads: StoryBible['openThreads'] } {
  let start = 1;
  let volume = bible.volumes.find((candidate) => {
    const end = start + candidate.plannedChapterCount - 1;
    const matches = chapterNumber >= start && chapterNumber <= end;
    start = end + 1;
    return matches;
  });
  const windowStart = Math.max(1, chapterNumber - 3);
  const windowEnd = chapterNumber + 3;
  return {
    volume,
    nearbyArcBeats: (bible.arcBeats ?? []).filter((beat) => beat.plannedChapter === undefined || (beat.plannedChapter >= windowStart && beat.plannedChapter <= windowEnd)),
    duePromises: (bible.promises ?? []).filter((promise) => promise.plannedChapter === undefined || (promise.plannedChapter >= windowStart && promise.plannedChapter <= windowEnd)),
    openThreads: (bible.openThreads ?? []).filter((thread) => thread.status !== 'deprecated'),
  };
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

function assertWorldPackScale(pack: WorldPack): void {
  const minimums: Array<[string, number, number]> = [
    ['realms', pack.realms.length, 3], ['techniques', pack.techniques.length, 3], ['artifacts', pack.artifacts.length, 3],
    ['resources', pack.resources.length, 3], ['locations', pack.locations.length, 3], ['factions', pack.factions.length, 3],
    ['historicalEvents', pack.historicalEvents.length, 3],
  ];
  const missing = minimums.filter(([, actual, expected]) => actual < expected).map(([name, , expected]) => `${name}>=${expected}`);
  if (pack.locations.filter((location) => location.kind === 'continent').length < 3) missing.push('continent locations>=3');
  if (missing.length) throw new PlanningParseError(`world pack is too small for the long-form milestone: ${missing.join(', ')}`);
}

function assertStoryBibleScale(bible: StoryBible, targetChapters: number): void {
  const chapterCount = bible.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0);
  if (bible.volumes.length < 3 || chapterCount !== targetChapters) {
    throw new PlanningParseError(`story bible must plan 3 or more volumes and exactly ${targetChapters} chapters (got ${bible.volumes.length} volumes, ${chapterCount} chapters)`);
  }
  if (!bible.secrets?.length || !bible.arcBeats?.length || !bible.promises?.length || !bible.openThreads?.length) throw new PlanningParseError('story bible must include non-empty secrets, arcBeats, promises and openThreads for long-form continuity');
}

const worldPackSystem = `你是长篇玄幻小说的世界观规划器。只返回一个 JSON 对象，不要 Markdown，不要解释。必须完整包含 id、revision、title、summary、status、createdAt，以及 axioms、powerSystems、realms、techniques、artifacts、resources、locations、factions、historicalEvents、terminology、unresolvedQuestions 数组。所有数组至少有一项；状态和数组元素 status 使用 proposed；ID 稳定且引用有效。枚举字段必须使用合同中的英文 token：techniques.kind 只能是 technique/cultivation/bloodline/secret，locations.kind 只能是 plane/continent/country/region/city/sect/secret_realm/ruin/other，factions.kind 只能是 empire/sect/clan/merchant/religion/species/other，terminology.kind 只能是 person/place/faction/realm/technique/artifact/resource/other。生成可支撑 100 万字、约 450 章、至少 3 卷的世界底座，至少安排 3 块大陆、3 个以上连续境界、3 个以上不同层级的功法、法宝、资源、势力和历史事件；每项都要有代价、限制或反制关系，具体可检查。createdAt 使用 ISO 8601 时间。`;
const storyBibleSystem = `你是长篇玄幻小说的总纲规划器。只返回一个 JSON 对象，不要 Markdown，不要解释。必须完整包含 id、revision、worldPackId、worldPackRevision、status、coreConflict、endingDirection、characters、relationships、secrets、arcBeats、promises、openThreads、arcs、volumes、unresolvedQuestions、createdAt。枚举字段必须使用合同中的英文 token：characters.role 只能是 protagonist/major/supporting/stage，relationships.kind 只能是 kinship/social/trust/emotion/allegiance/private_intent/belief，arcBeats.kind 只能是 trigger/belief_shift/choice/cost/consequence/resolution，openThreads.kind 只能是 main/subplot/mystery/open。至少生成主角、主要配角、对手、关系、秘密、人物弧光、可兑现承诺、待收束开放线和 3 个以上分卷；输入中的 chapterTarget 是当前验收目标，所有分卷 plannedChapterCount 之和必须恰好等于该数；卷序连续，所有引用必须指向输入世界包或本对象中的有效 ID。每个 promise 写明 payoffCondition，每个 openThread 写明 plannedResolution。状态使用 proposed，createdAt 使用 ISO 8601 时间。`;
const chapterSystem = `你是同一本长篇玄幻小说的章节写作模型。只返回一个 JSON 对象，不要 Markdown，不要解释。content 用中文写完整章节，遵守创作约定、已锁定世界包和 Story Bible，并参考 currentPlan 指出的当前分卷、临近人物弧光和待兑现承诺；不得跨卷抢跑，也不能漏掉正文明确兑现的计划。参考最近章节保持人物、力量、地点和时间连续。proposedEvents 必须记录本章正文真正改变的事实，observedEvents 必须是独立复核正文后得到的同一组事实，二者完全一致。eventType 只能使用 character_state、relationship_change、knowledge_belief、resource_change、artifact_change、plot_progress、arc_progress、secret_reveal、promise_payoff、thread_resolution。arc_progress 的 value.status 只能是 active、resolved、diverged；secret_reveal 表示秘密在本章确实揭示；promise_payoff 的 value.status 只能是 paid、broken、open；thread_resolution 的 value.status 只能是 resolved、deferred、open。每个事件都要有 evidence，subjectId 使用世界包或 Story Bible 中已有的稳定 ID；没有变化就返回空数组。只有正文明确发生的变化才能入账，角色猜测写成 knowledge_belief，计划尚未兑现的内容不要冒充已兑现。不要擅自改写锁定关系、境界规则或分卷目标。`;
const chapterDraftSystem = `你是同一本长篇玄幻小说的章节写作模型。只返回一个 JSON 对象，不要 Markdown，不要解释。content 用中文写完整章节，遵守创作约定、已锁定世界包和 Story Bible，并参考 currentPlan 指出的当前分卷、临近人物弧光和待兑现承诺；不得跨卷抢跑，也不能漏掉正文明确兑现的计划。参考最近章节保持人物、力量、地点和时间连续。proposedEvents 必须记录本章正文真正改变的事实；不要返回 observedEvents，正文会交给独立审计器再次抽取。eventType 只能使用 character_state、relationship_change、knowledge_belief、resource_change、artifact_change、plot_progress、arc_progress、secret_reveal、promise_payoff、thread_resolution。每个事件都要有 evidence，subjectId 使用世界包或 Story Bible 中已有的稳定 ID；没有变化就返回空数组。只有正文明确发生的变化才能入账，角色猜测写成 knowledge_belief，计划尚未兑现的内容不要冒充已兑现。不要擅自改写锁定关系、境界规则或分卷目标。`;
const extractionSystem = `你是长篇玄幻小说的独立事实审计器。只返回一个 JSON 对象，不要 Markdown，不要解释，格式必须是 {"observedEvents":[]}。只阅读正文和已锁定的世界包、Story Bible，独立判断正文真正发生的状态变化；不要相信或补全任何未在正文明确出现的计划。eventType 只能使用 character_state、relationship_change、knowledge_belief、resource_change、artifact_change、plot_progress、arc_progress、secret_reveal、promise_payoff、thread_resolution。每个事件必须包含 eventType、subjectId、predicate、value 和 evidence；没有明确变化就返回空数组。evidence 必须是正文中的短语或准确概述，subjectId 必须使用输入设计中的稳定 ID。`;
