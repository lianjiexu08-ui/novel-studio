import { isRetryableModelError, ModelGateway, OpenAICompatibleAdapter, UsageLedger, type ModelRole } from '../../model-gateway/src/index.ts';
import { parseChapterOutlines, parseGenerateChapterResponse, parsePlanSkeleton, parseStoryBible, parseWorldPack } from 'novel-studio-contracts';
import type { ChapterOutlineContract, PlanSkeletonContract } from 'novel-studio-contracts';
import { addUsage, emptyUsage } from '../../../novel-service-core/src/core.ts';
import type { ContextManifest, CreativeCovenant, GeneratedChapter, ModelProvider, RunUsage, Work } from '../../../novel-service-core/src/core.ts';
import type { StoryBible, WorldPack } from '../../../novel-service-core/src/world.ts';

export interface PlanningClient {
  complete(input: { system: string; user: string; maxOutputTokens: number; role?: ModelRole }): Promise<string>;
}

export class PlanningParseError extends Error {}

export interface DesignPlanner {
  generateWorldPack(input: { title: string; covenant: CreativeCovenant }): Promise<WorldPack>;
  generateStoryBible(input: { title: string; covenant: CreativeCovenant; worldPack: WorldPack; chapterTarget?: number; previousStoryBible?: StoryBible }): Promise<StoryBible>;
}

export class JsonDesignPlanner implements DesignPlanner {
  private readonly client: PlanningClient;
  private readonly targetChapters: number;

  constructor(client: PlanningClient, targetChapters = 100) { this.client = client; this.targetChapters = targetChapters; }

  async generateWorldPack(input: { title: string; covenant: CreativeCovenant }): Promise<WorldPack> {
    return completeValidated(this.client, {
      system: worldPackSystem + worldPackShape,
      user: JSON.stringify({ task: 'generate_world_pack', title: input.title, covenant: input.covenant }, null, 2),
      maxOutputTokens: 12_000,
    }, (value) => {
      const parsed = parseWorldPack(value);
      assertWorldPackScale(parsed);
      return parsed as WorldPack;
    });
  }

  async generateStoryBible(input: { title: string; covenant: CreativeCovenant; worldPack: WorldPack; chapterTarget?: number; previousStoryBible?: StoryBible }): Promise<StoryBible> {
    const chapterTarget = input.chapterTarget ?? this.targetChapters;
    const next = await completeValidated(this.client, {
      system: storyBibleSystem + storyBibleShape,
      user: JSON.stringify({ task: 'generate_story_bible', title: input.title, covenant: input.covenant, chapterTarget, worldPack: input.worldPack, previousStoryBible: input.previousStoryBible }, null, 2),
      maxOutputTokens: 12_000,
    }, (value) => {
      const parsed = parseStoryBible(value) as StoryBible;
      assertStoryBibleScale(parsed, chapterTarget);
      if (input.previousStoryBible) assertStoryBibleContinuity(input.previousStoryBible, parsed);
      return parsed;
    });
    if (input.previousStoryBible) {
      return { ...next, revision: Math.max(next.revision, input.previousStoryBible.revision + 1), worldPackRevision: input.worldPack.revision };
    }
    return next;
  }
}

interface BookPlanningInput {
  title: string;
  covenant: CreativeCovenant;
  worldPack?: WorldPack;
  storyBible?: StoryBible;
  adoptedFacts: unknown;
  authorRequest?: string;
}

/**
 * Model-backed book planner: a skeleton (volumes, climaxes, dependencies), then
 * chapter outlines one group at a time. Output is only ever a proposal; the
 * application stores it as an unapproved plan revision.
 */
export class JsonBookPlanner {
  private readonly client: PlanningClient;

  constructor(client: PlanningClient) { this.client = client; }

  async generatePlanSkeleton(input: BookPlanningInput & { targetChapterCount: number; volumeCount: number; previousPlan?: unknown }): Promise<PlanSkeletonContract> {
    return completeValidated(this.client, {
      system: planSkeletonSystem,
      user: JSON.stringify({
        task: 'generate_book_plan', title: input.title, covenant: input.covenant, targetChapterCount: input.targetChapterCount, volumeCount: input.volumeCount,
        authorRequest: input.authorRequest, worldPack: input.worldPack, storyBible: input.storyBible, previousPlan: input.previousPlan, adoptedFacts: input.adoptedFacts,
      }, null, 2),
      maxOutputTokens: 8_000,
    }, (value) => {
      const skeleton = parsePlanSkeleton(value);
      if (skeleton.targetChapterCount !== input.targetChapterCount || skeleton.volumes.length !== input.volumeCount) {
        throw new PlanningParseError(`plan must cover exactly ${input.targetChapterCount} chapters in ${input.volumeCount} volumes (got ${skeleton.targetChapterCount} / ${skeleton.volumes.length})`);
      }
      return skeleton;
    });
  }

  async generateChapterOutlines(input: BookPlanningInput & { skeleton: unknown; from: number; to: number; before: unknown[]; after: unknown[] }): Promise<ChapterOutlineContract[]> {
    return completeValidated(this.client, {
      system: chapterOutlineSystem + '\nscenes 字段必须是字符串数组，每个元素是一句场景描述，不得返回对象。',
      user: JSON.stringify({
        task: 'generate_chapter_outlines', from: input.from, to: input.to, title: input.title, covenant: input.covenant, authorRequest: input.authorRequest,
        plan: input.skeleton, previousOutlines: input.before, followingOutlines: input.after, storyBible: input.storyBible, adoptedFacts: input.adoptedFacts,
      }, null, 2),
      maxOutputTokens: Math.min(12_000, 900 * (input.to - input.from + 1) + 1_000),
    }, (value) => {
      const outlines = parseChapterOutlines(value).map((outline) => ({ ...outline, source: 'model' as const }));
      const numbers = new Set(outlines.map((outline) => outline.chapterNumber));
      const missing = Array.from({ length: input.to - input.from + 1 }, (_, index) => input.from + index).filter((chapter) => !numbers.has(chapter));
      if (missing.length) throw new PlanningParseError(`outline batch ${input.from}-${input.to} is missing chapters ${missing.join(', ')}`);
      return outlines.filter((outline) => outline.chapterNumber >= input.from && outline.chapterNumber <= input.to);
    });
  }
}

export class OpenAICompatiblePlanningClient implements PlanningClient {
  private readonly gateway: ModelGateway;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;

  /** Pass a shared `UsageLedger` so planning, writing and extraction draw on one budget. */
  constructor(endpoint: string, apiKey: string, model: string, budget: number | UsageLedger = Number.POSITIVE_INFINITY, timeoutMs = 60_000) {
    const normalizedEndpoint = endpoint.replace(/\/$/, '');
    this.endpoint = /\/v1$/i.test(normalizedEndpoint) ? normalizedEndpoint : `${normalizedEndpoint}/v1`;
    this.apiKey = apiKey;
    this.model = model;
    // Some OpenAI-compatible distributors keep streaming responses open for a
    // long time even after the complete JSON is available. Production planning
    // uses one bounded JSON response; the adapter still supports streaming for
    // callers and tests that need it.
    this.gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, timeoutMs, false)]]), budget instanceof UsageLedger ? budget : new UsageLedger(budget));
  }

  async complete(input: { system: string; user: string; maxOutputTokens: number; role?: ModelRole }): Promise<string> {
    return (await this.completeWithUsage(input)).text;
  }

  async completeWithUsage(input: { system: string; user: string; maxOutputTokens: number; role?: ModelRole }): Promise<{ text: string; usage: RunUsage }> {
    const response = await this.gateway.complete({
      role: input.role ?? 'planning', model: this.model, system: input.system, user: input.user,
      maxOutputTokens: input.maxOutputTokens, responseFormat: 'json', temperature: 0.2,
    }, 'openai-compatible', { endpoint: this.endpoint, apiKey: this.apiKey });
    const { inputTokens, outputTokens, costUsd } = response.usage;
    return { text: response.text, usage: { calls: 1, failedCalls: 0, inputTokens, outputTokens, costUsd, costKnown: costUsd > 0 || inputTokens + outputTokens === 0 } };
  }
}

type CompletionInput = { system: string; user: string; maxOutputTokens: number; role?: ModelRole };

export interface UsageReportingClient {
  completeWithUsage(input: CompletionInput): Promise<{ text: string; usage: RunUsage }>;
}

/**
 * Tries each channel in order. Only overload, rate limiting, server errors,
 * timeouts and dropped connections move on to the next one; a bad request or
 * an unparseable answer is returned as is.
 */
export class FailoverPlanningClient implements PlanningClient, UsageReportingClient {
  private readonly channels: Array<{ name: string; client: UsageReportingClient }>;
  private readonly onFailover?: (from: string, to: string, error: unknown) => void;

  constructor(channels: Array<{ name: string; client: UsageReportingClient }>, onFailover?: (from: string, to: string, error: unknown) => void) {
    if (channels.length === 0) throw new Error('failover needs at least one channel');
    this.channels = channels;
    this.onFailover = onFailover;
  }

  async complete(input: CompletionInput): Promise<string> {
    return (await this.completeWithUsage(input)).text;
  }

  async completeWithUsage(input: CompletionInput): Promise<{ text: string; usage: RunUsage }> {
    let failed = emptyUsage();
    for (let index = 0; index < this.channels.length; index += 1) {
      const channel = this.channels[index];
      try {
        const result = await channel.client.completeWithUsage(input);
        return { text: result.text, usage: addUsage(failed, result.usage) };
      } catch (error) {
        const next = this.channels[index + 1];
        if (!next || !isRetryableModelError(error)) throw error;
        failed = addUsage(failed, failedCall);
        this.onFailover?.(channel.name, next.name, error);
      }
    }
    throw new Error('unreachable');
  }
}

const failedCall: RunUsage = { calls: 1, failedCalls: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, costKnown: false };

/** Network-backed chapter writer. The core still keeps a synchronous fallback for offline mode. */
export class OpenAICompatibleChapterProvider implements ModelProvider {
  private readonly client: UsageReportingClient;
  private readonly independentExtraction: boolean;

  /** Pass `client` to write through a failover chain instead of a single endpoint. */
  constructor(endpoint: string, apiKey: string, model: string, budget: number | UsageLedger = Number.POSITIVE_INFINITY, timeoutMs = 60_000, independentExtraction = true, client?: UsageReportingClient) {
    this.client = client ?? new OpenAICompatiblePlanningClient(endpoint, apiKey, model, budget, timeoutMs);
    this.independentExtraction = independentExtraction;
  }

  generateChapter(): GeneratedChapter {
    throw new Error('network chapter provider must be called through generateChapterAsync');
  }

  /** Reports the usage of every call for this chapter; a thrown error carries the usage spent so far. */
  async generateChapterAsync(input: { work: Work; chapterNumber: number; context: ContextManifest }): Promise<GeneratedChapter> {
    let usage = emptyUsage();
    const tracked: PlanningClient = {
      complete: async (request) => {
        try {
          const result = await this.client.completeWithUsage(request);
          usage = addUsage(usage, result.usage);
          return result.text;
        } catch (error) {
          usage = addUsage(usage, failedCall);
          throw error;
        }
      },
    };
    try {
      return { ...(await this.writeChapter(tracked, input)), usage };
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { usage });
    }
  }

  private async writeChapter(client: PlanningClient, input: { work: Work; chapterNumber: number; context: ContextManifest }): Promise<GeneratedChapter> {
    const recentChapters = input.context.adoptedVersionIds
      .map((versionId) => input.work.versions.get(versionId))
      .filter((version): version is NonNullable<typeof version> => Boolean(version))
      .slice(-8)
      .map((version) => ({ chapterNumber: version.chapterNumber, content: version.content }));
    const plan = input.work.storyBible ? chapterPlan(input.work.storyBible, input.chapterNumber) : undefined;
    const { brief, ...context } = input.context;
    const response = await client.complete({
      system: (this.independentExtraction ? chapterDraftSystem : chapterSystem) + (brief ? briefRule : ''),
      user: JSON.stringify({
        task: 'generate_chapter', chapterNumber: input.chapterNumber, title: input.work.title,
        covenant: input.work.covenant, worldPack: input.work.worldPack, storyBible: input.work.storyBible,
        chapterBrief: brief, context, currentPlan: plan, recentChapters,
      }, null, 2),
      maxOutputTokens: Math.max(4_000, Math.min(12_000, Math.ceil(input.work.covenant.chapterWords * 1.8))),
      role: 'writing',
    });
    const draft = parseGenerateChapterResponse(readJson(response)) as GeneratedChapter;
    if (!this.independentExtraction) return draft;
    const extraction = await client.complete({
      system: extractionSystem + (brief ? extractionBriefRule : ''),
      user: JSON.stringify({
        task: 'extract_events', chapterNumber: input.chapterNumber, content: draft.content,
        worldPack: input.work.worldPack, storyBible: input.work.storyBible,
        chapterBrief: brief ? { outlineId: brief.outlineId, mustDo: brief.mustDo, endState: brief.endState } : undefined,
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

function chapterPlan(bible: StoryBible, chapterNumber: number): { volume?: StoryBible['volumes'][number]; openingPlan?: NonNullable<StoryBible['chapterPlans']>[number]; nearbyArcBeats: StoryBible['arcBeats']; duePromises: StoryBible['promises']; openThreads: StoryBible['openThreads'] } {
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
    openingPlan: bible.chapterPlans?.find((plan) => plan.chapterNumber === chapterNumber),
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

async function completeValidated<T>(client: PlanningClient, request: CompletionInput, accept: (value: unknown) => T): Promise<T> {
  const first = await client.complete(request);
  try {
    return accept(readJson(first));
  } catch (error) {
    const problems = describeOutputProblems(error);
    if (!problems) throw error;
    const repaired = await client.complete({
      system: request.system,
      user: JSON.stringify({ task: 'repair_previous_output', instruction: '上一次输出不符合要求。按 problems 逐条修正，补齐缺失字段，保留已有内容和 ID，重新返回完整 JSON 对象。', problems, originalRequest: JSON.parse(request.user), previousOutput: first }),
      maxOutputTokens: request.maxOutputTokens,
      role: request.role,
    });
    try {
      return accept(readJson(repaired));
    } catch (again) {
      const remaining = describeOutputProblems(again);
      if (!remaining) throw again;
      throw new PlanningParseError(`模型输出修正一次后仍不符合格式：${remaining}`);
    }
  }
}

const shapeIntro = '\n\n字段结构如下。每个对象必须包含列出的全部字段，字段名一字不差，不得改名或省略；"[]" 表示数组，"?" 表示可省略，字符串字段可以写具体内容但不能缺失。\n';
const worldPackShape = shapeIntro + [
  '顶层: {id, revision: 1, title, summary, status: "proposed", createdAt, axioms[], powerSystems[], realms[], techniques[], artifacts[], resources[], locations[], factions[], historicalEvents[], terminology[], unresolvedQuestions[]}',
  'axioms[]: {id, title, content, scope, precedence: 整数, status}',
  'powerSystems[]: {id, name, source, unit, realmIds: [realm id], status}',
  'realms[]: {id, systemId: powerSystem id, name, rank: 正整数, prerequisites: [字符串], capabilities: [字符串], cost, counters: [字符串], status}',
  'techniques[]: {id, name, kind, allowedRealmIds: [realm id], effect, cost, limitations: [字符串], counters: [字符串], status}',
  'artifacts[]: {id, name, tier, effect, cost, limitations: [字符串], status}',
  'resources[]: {id, name, unit, source, scarcity, status}',
  'locations[]: {id, name, kind, parentId?: location id, entryConditions: [字符串], status}',
  'factions[]: {id, name, kind, locationIds: [location id], goals: [字符串], resources: [字符串], status}',
  'historicalEvents[]: {id, title, storyTime, causes: [字符串], consequences: [字符串], factionIds: [faction id], status}',
  'terminology[]: {id, canonical, aliases: [字符串], kind, status}',
  'unresolvedQuestions[]: {id, question, blocking: 布尔, status: "open"|"resolved"|"deferred"}',
].join('\n');
const storyBibleShape = shapeIntro + [
  '顶层: {id, revision: 1, worldPackId, worldPackRevision, status: "proposed", coreConflict, endingDirection, characters[], relationships[], secrets[], arcBeats[], promises[], openThreads[], arcs[], volumes[], unresolvedQuestions[], createdAt}',
  'characters[]: {id, name, role, goal, identity, locationId?, factionId?, startingRealmId?}',
  'relationships[]: {id, fromCharacterId, toCharacterId, kind, value, locked: 布尔, sinceChapter?: 正整数, untilChapter?: 正整数}',
  'secrets[]: {id, ownerCharacterId, title, truth, revealCondition, status}',
  'arcBeats[]: {id, arcId, characterId, kind, plannedChapter: 正整数, expectedChange}',
  'promises[]: {id, title, promise, payoffCondition, plannedChapter?: 正整数, status}',
  'openThreads[]: {id, title, kind, question, plannedResolution, status}',
  'arcs[]: {id, title, characterIds: [character id], goal, stakes, plannedOutcome}',
  'volumes[]: {id, order: 正整数, title, goal, climax, endState, plannedChapterCount: 正整数, arcIds: [arc id]}',
  'unresolvedQuestions[]: {id, question, blocking: 布尔, status: "open"|"resolved"|"deferred"}',
].join('\n');

function describeOutputProblems(error: unknown): string | undefined {
  if (error instanceof PlanningParseError) return error.message;
  const issues = (error as { name?: unknown; issues?: unknown }).name === 'ZodError' ? (error as { issues: Array<{ path: Array<string | number>; message: string }> }).issues : undefined;
  if (!issues) return undefined;
  const shown = issues.slice(0, 40).map((issue) => `${issue.path.join('.') || '$'}: ${issue.message}`);
  return shown.join('; ') + (issues.length > shown.length ? `; 另有 ${issues.length - shown.length} 处` : '');
}

function assertWorldPackScale(pack: WorldPack): void {
  const minimums: Array<[string, number, number]> = [
    ['realms', pack.realms.length, 3], ['techniques', pack.techniques.length, 3], ['artifacts', pack.artifacts.length, 3],
    ['resources', pack.resources.length, 3], ['locations', pack.locations.length, 3], ['factions', pack.factions.length, 3],
    ['historicalEvents', pack.historicalEvents.length, 3],
  ];
  const missing = minimums.filter(([, actual, expected]) => actual < expected).map(([name, , expected]) => `${name}>=${expected}`);
  if (pack.locations.filter((location) => location.kind === 'continent').length < 3) missing.push('continent locations>=3');
  const blockingQuestions = pack.unresolvedQuestions.filter((question) => question.blocking && question.status === 'open');
  if (blockingQuestions.length) missing.push(`blocking unresolved questions must be resolved (${blockingQuestions.map((question) => question.id).join(', ')})`);
  if (missing.length) throw new PlanningParseError(`world pack is too small for the long-form milestone: ${missing.join(', ')}`);
}

function assertStoryBibleScale(bible: StoryBible, targetChapters: number): void {
  const chapterCount = bible.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0);
  if (bible.volumes.length < 3 || chapterCount !== targetChapters) {
    throw new PlanningParseError(`story bible must plan 3 or more volumes and exactly ${targetChapters} chapters (got ${bible.volumes.length} volumes, ${chapterCount} chapters)`);
  }
  if (!bible.secrets?.length || !bible.arcBeats?.length || !bible.promises?.length || !bible.openThreads?.length) throw new PlanningParseError('story bible must include non-empty secrets, arcBeats, promises and openThreads for long-form continuity');
  const openingPlans = [...(bible.chapterPlans ?? [])].sort((a, b) => a.chapterNumber - b.chapterNumber);
  const requiredPlanCount = Math.min(50, targetChapters);
  if (openingPlans.length < requiredPlanCount || openingPlans.slice(0, requiredPlanCount).some((plan, index) => plan.chapterNumber !== index + 1)) {
    throw new PlanningParseError(`story bible must include a concrete opening plan for chapters 1 through ${requiredPlanCount}`);
  }
  const minimumBeats = Math.max(6, bible.volumes.length * 3);
  if ((bible.arcBeats?.length ?? 0) < minimumBeats) throw new PlanningParseError(`story bible needs at least ${minimumBeats} planned arc beats for a multi-volume outline`);
  for (const volume of bible.volumes) {
    const start = 1 + bible.volumes.slice(0, volume.order - 1).reduce((sum, item) => sum + item.plannedChapterCount, 0);
    const end = start + volume.plannedChapterCount - 1;
    if (!(bible.arcBeats ?? []).some((beat) => beat.plannedChapter !== undefined && beat.plannedChapter >= start && beat.plannedChapter <= end)) {
      throw new PlanningParseError(`story bible volume ${volume.id} has no planned arc beat`);
    }
  }
}

function assertStoryBibleContinuity(previous: StoryBible, next: StoryBible): void {
  if (next.worldPackId !== previous.worldPackId) throw new PlanningParseError('expanded story bible changed worldPackId');
  const collections: Array<[string, Array<{ id: string }> | undefined, Array<{ id: string }> | undefined]> = [
    ['characters', previous.characters, next.characters],
    ['relationships', previous.relationships, next.relationships],
    ['arcs', previous.arcs, next.arcs],
    ['secrets', previous.secrets, next.secrets],
    ['arcBeats', previous.arcBeats, next.arcBeats],
    ['promises', previous.promises, next.promises],
    ['openThreads', previous.openThreads, next.openThreads],
    ['volumes', previous.volumes, next.volumes],
    ['chapterPlans', previous.chapterPlans, next.chapterPlans],
  ];
  const missing = collections.flatMap(([label, oldItems, newItems]) => {
    const ids = new Set((newItems ?? []).map((item) => item.id));
    return (oldItems ?? []).filter((item) => !ids.has(item.id)).map((item) => `${label}:${item.id}`);
  });
  if (missing.length) throw new PlanningParseError(`expanded story bible dropped stable IDs: ${missing.join(', ')}`);
}

const worldPackSystem = `你是长篇玄幻小说的世界观规划器。只返回一个 JSON 对象，不要 Markdown，不要解释。必须完整包含 id、revision、title、summary、status、createdAt，以及 axioms、powerSystems、realms、techniques、artifacts、resources、locations、factions、historicalEvents、terminology、unresolvedQuestions 数组。所有数组至少有一项；状态和数组元素 status 使用 proposed；ID 稳定且引用有效。枚举字段必须使用合同中的英文 token：techniques.kind 只能是 technique/cultivation/bloodline/secret，locations.kind 只能是 plane/continent/country/region/city/sect/secret_realm/ruin/other，factions.kind 只能是 empire/sect/clan/merchant/religion/species/other，terminology.kind 只能是 person/place/faction/realm/technique/artifact/resource/other。生成可支撑 100 万字、约 450 章、至少 3 卷的世界底座，至少安排 3 块大陆、3 个以上连续境界、3 个以上不同层级的功法、法宝、资源、势力和历史事件；每项都要有代价、限制或反制关系，具体可检查。长篇正式生产不能留下 blocking=true 且 status=open 的未决问题：对会影响开篇、力量体系或主线因果的关键问题直接给出当前世界中的确定答案并写入相关规则/历史；只有不影响开篇的探索项才可标记为 deferred 且 blocking=false。createdAt 使用 ISO 8601 时间。`;
const storyBibleSystem = `你是长篇玄幻小说的总纲规划器。只返回一个 JSON 对象，不要 Markdown，不要解释。必须完整包含 id、revision、worldPackId、worldPackRevision、status、coreConflict、endingDirection、characters、relationships、secrets、arcBeats、promises、openThreads、arcs、volumes、chapterPlans、unresolvedQuestions、createdAt。枚举字段必须使用合同中的英文 token：characters.role 只能是 protagonist/major/supporting/stage，relationships.kind 只能是 kinship/social/trust/emotion/allegiance/private_intent/belief，arcBeats.kind 只能是 trigger/belief_shift/choice/cost/consequence/resolution，openThreads.kind 只能是 main/subplot/mystery/open。至少生成主角、主要配角、对手、关系、秘密、人物弧光、可兑现承诺、待收束开放线和 3 个以上分卷；arcBeats 是全书关键节点提纲，至少生成 3×分卷数 个有 plannedChapter 的节点，并让每卷至少有一个节点，节点要覆盖触发、升级、选择、代价、后果和收束。必须先完成前 50 章的逐章计划，再让写作模型生成正文；chapterPlans 的每项必须包含 id、chapterNumber、title、purpose、conflict、turningPoint、endHook、characterIds、locationIds、arcBeatIds、requiredEvents，并且 chapterNumber 必须完整覆盖 1 到 50，每章都要有具体冲突、转折和章末钩子。输入中的 chapterTarget 是当前验收目标，所有分卷 plannedChapterCount 之和必须恰好等于该数；卷序连续，所有引用必须指向输入世界包或本对象中的有效 ID。每个 promise 写明 payoffCondition，每个 openThread 写明 plannedResolution。若输入提供 previousStoryBible，这是从较短验收扩展长篇，必须保留其中已有 characters、relationships、arcs、secrets、promises、openThreads、arcBeats、chapterPlans 的稳定 ID、核心设定和前 50 章承接，只能在其上扩展后续卷；不得为了重写而更换旧 ID。状态使用 proposed，createdAt 使用 ISO 8601 时间。`;
const chapterSystem = `你是同一本长篇玄幻小说的章节写作模型。只返回一个 JSON 对象，不要 Markdown，不要解释。content 用中文写完整章节，遵守创作约定、已锁定世界包和 Story Bible，并参考 currentPlan 指出的当前分卷、临近人物弧光和待兑现承诺；不得跨卷抢跑，也不能漏掉正文明确兑现的计划。参考最近章节保持人物、力量、地点和时间连续。proposedEvents 必须记录本章正文真正改变的事实，observedEvents 必须是独立复核正文后得到的同一组事实，二者完全一致。eventType 只能使用 character_state、relationship_change、knowledge_belief、resource_change、artifact_change、plot_progress、volume_progress、arc_progress、secret_reveal、promise_payoff、thread_resolution。volume_progress 和 arc_progress 的 value.status 只能是 active、resolved、diverged；secret_reveal 表示秘密在本章确实揭示；promise_payoff 的 value.status 只能是 paid、broken、open；thread_resolution 的 value.status 只能是 resolved、deferred、open。每个事件都要有 evidence，subjectId 使用世界包或 Story Bible 中已有的稳定 ID；没有变化就返回空数组。只有正文明确发生的变化才能入账，角色猜测写成 knowledge_belief，计划尚未兑现的内容不要冒充已兑现。不要擅自改写锁定关系、境界规则或分卷目标。`;
const chapterDraftSystem = `你是同一本长篇玄幻小说的章节写作模型。只返回一个 JSON 对象，不要 Markdown，不要解释。content 用中文写完整章节，遵守创作约定、已锁定世界包和 Story Bible，并参考 currentPlan 指出的当前分卷、临近人物弧光和待兑现承诺；不得跨卷抢跑，也不能漏掉正文明确兑现的计划。参考最近章节保持人物、力量、地点和时间连续。proposedEvents 必须记录本章正文真正改变的事实；不要返回 observedEvents，正文会交给独立审计器再次抽取。eventType 只能使用 character_state、relationship_change、knowledge_belief、resource_change、artifact_change、plot_progress、volume_progress、arc_progress、secret_reveal、promise_payoff、thread_resolution。volume_progress 和 arc_progress 的 value.status 只能是 active、resolved、diverged；每个事件都要有 evidence，subjectId 使用世界包或 Story Bible 中已有的稳定 ID；没有变化就返回空数组。只有正文明确发生的变化才能入账，角色猜测写成 knowledge_belief，计划尚未兑现的内容不要冒充已兑现。不要擅自改写锁定关系、境界规则或分卷目标。`;
const briefRule = `输入的 chapterBrief 是作者批准计划给出的本章任务卡：必须完成 mustDo，结尾落在 endState，遵守 preserve；mustNotHappen 中的事情本章绝不能发生或提前揭示；dependsOn 中未满足的前置不能靠临时新增能力或道具补上。若本章正文确实推进了任务卡对应章纲，追加一个 eventType 为 plot_progress、subjectId 为 chapterBrief.outlineId、predicate 为 status、value 为 {"status":"realized"} 的事件（只部分完成用 partial，明显偏离用 diverged），evidence 写正文依据。`;
const extractionBriefRule = `输入的 chapterBrief 只用于判断章纲是否落实：若正文明确完成了 mustDo 并到达 endState，输出一个 eventType 为 plot_progress、subjectId 为 chapterBrief.outlineId、predicate 为 status、value 为 {"status":"realized"} 的事件；只完成一部分用 partial，明显偏离用 diverged；evidence 必须来自正文。不要因为任务卡要求就假定正文已完成。`;
const planSkeletonSystem = `你是长篇玄幻小说的全书规划器。只返回一个 JSON 对象，不要 Markdown，不要解释。字段：targetChapterCount、volumeCount、mainConflict、theme、protagonistArc、endingDirection、keyTurns、volumes、milestones、dependencies、openQuestions。targetChapterCount 和 volumeCount 必须等于输入值。volumes 每项含 id、order、title、startChapter、endChapter、goal、opposition、characterIds、climax、endState、carryOver；卷序从 1 连续，章节范围从第 1 章起连续不重叠，最后一卷结束于 targetChapterCount；characterIds 只能使用 storyBible.characters 中的 id。milestones 是高潮、转折与兑现节点，每项含 id、title、kind（climax/turn/payoff）、startChapter、endChapter、setup（铺垫清单）、cost、outcome；高潮写章节范围，不要为凑数精确到某一章注水，每卷至少一个 climax。dependencies 每项含 id、targetId（milestone id 或 chapter-N）、sourceId（另一个更早的节点，可选）或 fact（{eventType, subjectId, predicate?}，表示正文必须先发生的事实）、requiredness（must/optional）、description；关键依赖不能成环。openQuestions 记录作者尚未决定的事项，只有确实会阻断开篇的才标 blocking。若输入有 adoptedFacts 或 previousPlan，已经写成的正文和已发生事实不可改变，只能在其上规划后续；authorRequest 是作者的要求，优先遵守。`;
const chapterOutlineSystem = `你是长篇玄幻小说的章纲规划器。只返回一个 JSON 对象 {"chapters":[...]}，不要 Markdown，不要解释。为输入 from 到 to 的每一章各写一条章纲，不多不少。每条含 chapterNumber、volumeId（plan.volumes 中覆盖该章的卷 id）、title、summary（本章发生的事件，不是标题复述）、characterGoals、conflict、choice（关键选择）、cost（代价或后果）、threads（推进的线索）、endState（本章结束时的局面）、characterIds（只能用 storyBible.characters 的 id）、location、storyTime、scenes（场景序列）。与 previousOutlines 自然衔接，并为 followingOutlines 留出接口；按 plan.milestones 的范围安排铺垫与高潮，不得提前揭示后续节点，也不要原地踏步重复冲突。已写成的正文（adoptedFacts）是既成事实。authorRequest 是作者对本组的要求，优先遵守。`;
const extractionSystem = `你是长篇玄幻小说的独立事实审计器。只返回一个 JSON 对象，不要 Markdown，不要解释，格式必须是 {"observedEvents":[]}。只阅读正文和已锁定的世界包、Story Bible，独立判断正文真正发生的状态变化；不要相信或补全任何未在正文明确出现的计划。eventType 只能使用 character_state、relationship_change、knowledge_belief、resource_change、artifact_change、plot_progress、volume_progress、arc_progress、secret_reveal、promise_payoff、thread_resolution。volume_progress 和 arc_progress 的 value.status 只能是 active、resolved、diverged；每个事件必须包含 eventType、subjectId、predicate、value 和 evidence；没有明确变化就返回空数组。evidence 必须是正文中的短语或准确概述，subjectId 必须使用输入设计中的稳定 ID。`;
