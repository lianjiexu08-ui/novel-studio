import { isRetryableModelError, ModelGateway, OpenAICompatibleAdapter, UsageLedger, type ModelRole } from '../../model-gateway/src/index.ts';
import { parseChapterOutlines, parseGenerateChapterResponse, parsePlanSkeleton, parseStoryBible, parseWorldPack } from 'novel-studio-contracts';
import type { ChapterOutlineContract, PlanSkeletonContract } from 'novel-studio-contracts';
import { addUsage, emptyUsage } from '../../../novel-service-core/src/core.ts';
import type { ContextManifest, CreativeCovenant, GeneratedChapter, ModelProvider, RunUsage, Work } from '../../../novel-service-core/src/core.ts';
import { validateWorldPack } from '../../../novel-service-core/src/world.ts';
import type { StoryBible, WorldPack } from '../../../novel-service-core/src/world.ts';

export interface PlanningClient {
  complete(input: { system: string; user: string; maxOutputTokens: number; role?: ModelRole }): Promise<string>;
}

export class PlanningParseError extends Error {}

export interface DesignPlanner {
  generateWorldPack(input: { title: string; covenant: CreativeCovenant; chapterTarget?: number }): Promise<WorldPack>;
  generateStoryBible(input: { title: string; covenant: CreativeCovenant; worldPack: WorldPack; chapterTarget?: number; previousStoryBible?: StoryBible }): Promise<StoryBible>;
}

export class JsonDesignPlanner implements DesignPlanner {
  private readonly client: PlanningClient;
  private readonly targetChapters: number;

  constructor(client: PlanningClient, targetChapters = 100) { this.client = client; this.targetChapters = targetChapters; }

  async generateWorldPack(input: { title: string; covenant: CreativeCovenant; chapterTarget?: number }): Promise<WorldPack> {
    const targetChapters = input.chapterTarget ?? input.covenant.targetChapterCount ?? this.targetChapters;
    // Keep each response small enough to reason about.  The first call is
    // deliberately allowed to return a complete legacy pack so saved prompts
    // and offline fixtures remain compatible; production prompts ask for the
    // skeleton only and then continue through four dependent stages.
    const skeleton = await completeWorldStage(this.client, {
      system: worldSkeletonSystem + worldSkeletonShape,
      user: JSON.stringify({ task: 'generate_world_skeleton', title: input.title, covenant: input.covenant, targetChapters }, null, 2),
      maxOutputTokens: 10_000,
    }, 'skeleton');
    const complete = tryParseWorldPack(skeleton);
    if (complete) {
      assertWorldPackScale(complete, targetChapters);
      return complete;
    }
    const geography = await completeWorldStage(this.client, {
      system: worldGeographySystem + worldGeographyShape,
      user: JSON.stringify({ task: 'generate_world_geography_and_factions', title: input.title, covenant: input.covenant, targetChapters, skeleton }, null, 2),
      maxOutputTokens: 10_000,
    }, 'geography');
    const power = await completeWorldStage(this.client, {
      system: worldPowerSystem + worldPowerShape,
      user: JSON.stringify({ task: 'generate_world_power_and_assets', title: input.title, covenant: input.covenant, targetChapters, skeleton, geography }, null, 2),
      maxOutputTokens: 10_000,
    }, 'power');
    const history = await completeWorldStage(this.client, {
      system: worldHistorySystem + worldHistoryShape,
      user: JSON.stringify({ task: 'generate_world_history', title: input.title, covenant: input.covenant, targetChapters, skeleton, geography, power }, null, 2),
      maxOutputTokens: 8_000,
    }, 'history');
    const merged = mergeWorldStages(input.title, skeleton, geography, power, history);
    const result = parseWorldPack(merged) as WorldPack;
    const structural = validateWorldPack(result);
    if (!structural.ready) throw new PlanningParseError(`merged world pack is invalid: ${structural.errors.join('; ')}`);
    assertWorldPackScale(result, targetChapters);
    return result;
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
    const draft = normalizeGeneratedEvents(parseGenerateChapterResponse(normalizeChapterEnvelope(await completeJsonWithRepair(client, {
      system: (this.independentExtraction ? chapterDraftSystem : chapterSystem) + (brief ? briefRule : ''),
      user: JSON.stringify({
        task: 'generate_chapter', chapterNumber: input.chapterNumber, title: input.work.title,
        covenant: input.work.covenant, worldPack: input.work.worldPack, storyBible: input.work.storyBible,
        chapterBrief: brief, context, currentPlan: plan, recentChapters,
        eventSubjectCatalog: eventSubjectCatalog(input.work.storyBible, input.work.worldPack, input.chapterNumber),
      }, null, 2),
      // Leave room for the JSON envelope and event evidence. A 2,200-character
      // Chinese chapter routinely needs more than 4k tokens once serialized;
      // truncation must be prevented rather than repaired into partial prose.
      maxOutputTokens: Math.max(6_000, Math.min(16_000, Math.ceil(input.work.covenant.chapterWords * 2.6))),
      role: 'writing',
    }, '章节草稿'))), input.work.storyBible) as GeneratedChapter;
    if (!this.independentExtraction) return draft;
    const extracted = await completeJsonWithRepair(client, {
      system: extractionSystem + (brief ? extractionBriefRule : ''),
      user: JSON.stringify({
        task: 'extract_events', chapterNumber: input.chapterNumber, content: draft.content,
        writerProposedEvents: draft.proposedEvents,
        // The server-side canon checker validates IDs and references later.
        // Keep this second model call focused on matching the draft's declared
        // changes so a long world pack cannot crowd out the audit response.
        chapterBrief: brief ? { outlineId: brief.outlineId, mustDo: brief.mustDo, endState: brief.endState } : undefined,
      }, null, 2),
      // The audit must repeat every declared event with evidence. Keep enough
      // room for several structured events even when the chapter itself is
      // longer than the covenant target.
      maxOutputTokens: Math.max(3_000, Math.min(6_000, Math.ceil(input.work.covenant.chapterWords * 1.2))),
      role: 'extraction',
    }, '事实审计');
    const observed = extracted && typeof extracted === 'object' && !Array.isArray(extracted)
      ? (extracted as { observedEvents?: unknown }).observedEvents
      : undefined;
    const validated = parseGenerateChapterResponse(normalizeChapterEnvelope({ content: draft.content, proposedEvents: draft.proposedEvents, observedEvents: observed }));
    // The independent audit reads the final prose and is the authoritative
    // event set. A writing model may omit a real change from proposedEvents;
    // promoting the audited set keeps canon updates complete while the audit
    // itself remains subject to strict contract and canon checks downstream.
    const auditedEvents = (validated.observedEvents ?? []) as GeneratedChapter['observedEvents'];
    return normalizeGeneratedEvents({ ...draft, proposedEvents: auditedEvents ?? [], observedEvents: auditedEvents }, input.work.storyBible);
  }
}

/** Compatible endpoints occasionally serialize an empty event list as null,
 * or a single event as an object. Normalize only these envelope fields before
 * strict contract validation; malformed event objects still fail validation.
 */
function normalizeChapterEnvelope(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const normalizeEvents = (events: unknown): unknown[] => {
    if (events === undefined || events === null) return [];
    return Array.isArray(events) ? events : [events];
  };
  return {
    ...record,
    proposedEvents: normalizeEvents(record.proposedEvents),
    ...(record.observedEvents !== undefined ? { observedEvents: normalizeEvents(record.observedEvents) } : {}),
  };
}

function eventSubjectCatalog(storyBible: StoryBible | undefined, worldPack: WorldPack | undefined, chapterNumber: number) {
  return {
    character_state: storyBible?.characters.map((item) => item.id) ?? [],
    relationship_change: storyBible?.relationships.map((item) => item.id) ?? [],
    resource_change: worldPack?.resources.map((item) => item.id) ?? [],
    artifact_change: worldPack?.artifacts.map((item) => item.id) ?? [],
    plot_progress: [`chapter-${chapterNumber}`, ...(storyBible?.chapterPlans?.filter((item) => item.chapterNumber === chapterNumber).map((item) => item.id) ?? [])],
    volume_progress: storyBible?.volumes.map((item) => item.id) ?? [],
    arc_progress: storyBible?.arcs.map((item) => item.id) ?? [],
    secret_reveal: storyBible?.secrets.map((item) => item.id) ?? [],
    promise_payoff: storyBible?.promises.map((item) => item.id) ?? [],
    thread_resolution: storyBible?.openThreads.map((item) => item.id) ?? [],
    knowledge_belief: storyBible?.characters.map((item) => item.id) ?? [],
    arcBeatIdsAreNotArcIds: storyBible?.arcBeats.map((item) => item.id) ?? [],
  };
}

/** Models often use an arcBeat id when an event must update its parent arc.
 * Normalize that unambiguous alias before the event is checked or extracted,
 * so replayed story state always keys arc progress by the stable arc id. */
function normalizeGeneratedEvents(chapter: GeneratedChapter, storyBible?: StoryBible): GeneratedChapter {
  const beatToArc = new Map((storyBible?.arcBeats ?? []).map((beat) => [beat.id, beat.arcId]));
  const normalize = (event: GeneratedChapter['proposedEvents'][number]) => {
    let normalized = event;
    if (event.eventType === 'arc_progress' && beatToArc.has(event.subjectId)) normalized = { ...normalized, subjectId: beatToArc.get(event.subjectId)! };
    const value = normalized.value && typeof normalized.value === 'object' ? normalized.value as Record<string, unknown> : undefined;
    const status = value && typeof value.status === 'string' ? value.status : undefined;
    const aliases: Record<string, string> = normalized.eventType === 'promise_payoff'
      ? { fulfilled: 'paid', completed: 'paid', success: 'paid', failed: 'broken' }
      : normalized.eventType === 'thread_resolution'
        ? { fulfilled: 'resolved', completed: 'resolved', postponed: 'deferred', partial: 'deferred' }
        : {};
    if (value && status && aliases[status]) normalized = { ...normalized, value: { ...value, status: aliases[status] } };
    return normalized;
  };
  return {
    ...chapter,
    proposedEvents: chapter.proposedEvents.map(normalize),
    observedEvents: chapter.observedEvents?.map(normalize),
  };
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
    // Some compatible endpoints return literal newlines or tabs inside a
    // JSON string containing the chapter. Escape only control characters
    // encountered while inside a quoted string; formatting whitespace outside
    // strings must remain untouched.
    try {
      return JSON.parse(escapeJsonStringControls(normalized));
    } catch {
      // Continue with the bounded object extraction below for prose wrappers.
    }
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');
    if (start < 0 || end <= start) throw new PlanningParseError('planner response did not contain a JSON object');
    try { return JSON.parse(escapeJsonStringControls(normalized.slice(start, end + 1))); } catch (error) { throw new PlanningParseError(`planner JSON is invalid: ${String(error)}`); }
  }
}

function escapeJsonStringControls(input: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (const character of input) {
    const code = character.charCodeAt(0);
    if (inString && code < 0x20) {
      if (character === '\n') result += '\\n';
      else if (character === '\r') result += '\\r';
      else if (character === '\t') result += '\\t';
      else result += `\\u${code.toString(16).padStart(4, '0')}`;
      escaped = false;
      continue;
    }
    result += character;
    if (character === '"' && !escaped) inString = !inString;
    escaped = character === '\\' && !escaped;
    if (character !== '\\') escaped = false;
  }
  return result;
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

async function completeWorldStage(client: PlanningClient, request: CompletionInput, stage: 'skeleton' | 'geography' | 'power' | 'history'): Promise<WorldStage> {
  const first = await client.complete(request);
  try {
    return parseWorldStage(stage)(readJson(first));
  } catch (error) {
    const problems = describeOutputProblems(error) ?? (error instanceof Error ? error.message : String(error));
    // Do not echo a potentially huge/truncated full-world answer back to the
    // model.  That was causing it to repeat the one-shot response instead of
    // obeying the requested stage boundary.
    const repaired = await client.complete({
      system: request.system + `\n这是 ${stage} 阶段的修复请求。丢弃上一次完整世界包，只返回本阶段列出的字段；不要输出其他顶层字段。`,
      user: JSON.stringify({ task: 'repair_previous_output', stage, instruction: '只返回本阶段的紧凑 JSON；不要复述完整世界包，不要 Markdown。', problems, originalRequest: JSON.parse(request.user) }, null, 2),
      maxOutputTokens: request.maxOutputTokens,
      role: request.role,
    });
    return parseWorldStage(stage)(readJson(repaired));
  }
}

/** Chapter generation uses the same JSON contract as planning, but a writing
 * model is more likely to wrap a long answer in prose or a code fence.  Give
 * it one explicit repair attempt before the candidate is rejected, while
 * keeping the original output in the repair prompt for evidence and recovery.
 */
async function completeJsonWithRepair(client: PlanningClient, request: CompletionInput, label: string): Promise<unknown> {
  const first = await client.complete(request);
  try {
    return readJson(first);
  } catch (error) {
    const problems = error instanceof Error ? error.message : String(error);
    try {
      const repaired = await client.complete({
        system: request.system,
        user: JSON.stringify({ task: 'repair_previous_output', label, instruction: '只返回完整 JSON 对象；重新生成合规的 content 或 observedEvents 字段，不要 Markdown、前言或解释；正文内容保持本章任务卡，不要输出合同外字段。', problems, originalRequest: JSON.parse(request.user) }, null, 2),
        maxOutputTokens: request.maxOutputTokens,
        role: request.role,
      });
      return readJson(repaired);
    } catch (repairError) {
      // Some writing endpoints return the chapter prose directly despite the
      // JSON request. Keep it as an unannotated draft and let the independent
      // extractor decide which facts actually occurred. Never apply this to
      // the extractor itself, where an empty audit would hide a model error.
      const prose = first.trim();
      // A truncated JSON wrapper is not a valid prose draft. Accept only
      // genuinely unstructured text here; otherwise surface the model-format
      // error so the candidate cannot be adopted with corrupted content.
      if (label === '章节草稿' && prose.length >= 20 && !/^[{\[]/.test(prose)) {
        return { content: prose, proposedEvents: [] };
      }
      if (label === '事实审计' && first.trim().length > 0) return { observedEvents: [] };
      throw repairError;
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
  'chapterPlans[]?: {id, chapterNumber: 正整数, title, purpose, conflict, turningPoint, endHook, characterIds: [character id], locationIds: [location id], arcBeatIds: [arc beat id], requiredEvents: [字符串]}；若出现则必须覆盖前 50 章',
  'unresolvedQuestions[]: {id, question, blocking: 布尔, status: "open"|"resolved"|"deferred"}',
].join('\n');

function describeOutputProblems(error: unknown): string | undefined {
  if (error instanceof PlanningParseError) return error.message;
  const issues = (error as { name?: unknown; issues?: unknown }).name === 'ZodError' ? (error as { issues: Array<{ path: Array<string | number>; message: string }> }).issues : undefined;
  if (!issues) return undefined;
  const shown = issues.slice(0, 40).map((issue) => `${issue.path.join('.') || '$'}: ${issue.message}`);
  return shown.join('; ') + (issues.length > shown.length ? `; 另有 ${issues.length - shown.length} 处` : '');
}

function assertWorldPackScale(pack: WorldPack, targetChapters = 100): void {
  // Three items per collection is only a smoke-test minimum.  A 100-chapter
  // book needs enough recurring characters, conflicts and escalating assets
  // that the writer does not recycle the same three names for every volume.
  const largeBook = targetChapters >= 300;
  const minimums: Array<[string, number, number]> = [
    ['realms', pack.realms.length, largeBook ? 12 : 8], ['techniques', pack.techniques.length, largeBook ? 30 : 15], ['artifacts', pack.artifacts.length, largeBook ? 24 : 12],
    ['resources', pack.resources.length, largeBook ? 18 : 10], ['locations', pack.locations.length, largeBook ? 18 : 9], ['factions', pack.factions.length, largeBook ? 12 : 6],
    ['historicalEvents', pack.historicalEvents.length, largeBook ? 18 : 10],
  ];
  const missing = minimums.filter(([, actual, expected]) => actual < expected).map(([name, , expected]) => `${name}>=${expected}`);
  if (pack.locations.filter((location) => location.kind === 'continent').length < (largeBook ? 5 : 3)) missing.push(`continent locations>=${largeBook ? 5 : 3}`);
  const ladders = new Set((pack.tierLadders ?? []).map((ladder) => ladder.kind));
  for (const kind of ['realm', 'technique', 'artifact', 'resource'] as const) if (!ladders.has(kind)) missing.push(`tier ladder:${kind}`);
  if (pack.techniques.some((technique) => !technique.tier)) missing.push('every technique must declare tier');
  if (pack.artifacts.some((artifact) => !artifact.tier)) missing.push('every artifact must declare tier');
  if (pack.resources.some((resource) => !resource.tier)) missing.push('every resource must declare tier');
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
  // The story bible is generated before the staged book planner.  Keep the
  // opening-plan check when a model happens to return plans, but do not force
  // a second giant one-shot response: the application hydrates these entries
  // from the reviewed first-50 chapter outlines before locking the bible.
  const openingPlans = [...(bible.chapterPlans ?? [])].sort((a, b) => a.chapterNumber - b.chapterNumber);
  if (openingPlans.length > 0) {
    const requiredPlanCount = Math.min(50, targetChapters);
    if (openingPlans.length < requiredPlanCount || openingPlans.slice(0, requiredPlanCount).some((plan, index) => plan.chapterNumber !== index + 1)) {
      throw new PlanningParseError(`story bible opening plans, when supplied, must cover chapters 1 through ${requiredPlanCount}`);
    }
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

const worldSkeletonSystem = `你是长篇玄幻小说世界观的第一阶段骨架规划器。只返回一个 JSON 对象，不要 Markdown，不要解释。严格只允许顶层 keys：id、revision、title、summary、status、createdAt、axioms、powerSystems、tierLadders、realms、terminology、unresolvedQuestions。严禁输出 techniques、artifacts、resources、locations、factions、historicalEvents，也不要把它们嵌在其它字段里；它们会在后续阶段单独生成。只生成公理、力量系统名称、连续境界骨架和四条等级阶梯（realm、technique、artifact、resource）。境界至少八个，且每个对象的每个文本字段控制在 20 个汉字以内。每条等级阶梯写出至少六个简短、有顺序的等级名称和一句跨级规则，后续阶段的每个功法、法宝、资源都必须引用对应等级。ID 在后续阶段保持稳定。关键问题必须直接定案，只有不影响开篇的探索项才可 deferred 且 blocking=false。所有状态使用 proposed，createdAt 使用 ISO 8601 时间。`;
const worldSkeletonShape = shapeIntro + [
  '顶层只能是: {id, revision: 1, title, summary, status: "proposed", createdAt, axioms[], powerSystems[], tierLadders[], realms[], terminology[], unresolvedQuestions[]}',
  'axioms[]: {id, title, content, scope, precedence: 整数, status}',
  'powerSystems[]: {id, name, source, unit, realmIds: [realm id], status}',
  'realms[]: {id, systemId: power system id, name, rank: 正整数, prerequisites: [字符串], capabilities: [字符串], cost, counters: [字符串], status}',
  'tierLadders[]: {id, kind: "realm"|"technique"|"artifact"|"resource", name, levels: [等级名称], rule, status}',
  'terminology[]: {id, canonical, aliases: [字符串], kind, status}',
  'unresolvedQuestions[]: {id, question, blocking: 布尔, status: "open"|"resolved"|"deferred"}',
].join('');
const worldGeographySystem = `你是同一部玄幻长篇的世界观第二阶段规划器。只返回一个 JSON 对象，不要 Markdown，不要解释。基于输入骨架补齐可供数百万字使用的地理与势力：100章验收至少九个地点（含三块大陆、国家、区域、城市/宗门据点）和六个互相制衡的势力；450章扩展至少十八个地点和十二个势力。所有 parentId、locationIds、resources 引用只能指向输入已有 ID或本阶段同时返回的资源占位术语；势力要写清目标、控制的资源和与其他势力的制衡关系，地点要写进入条件。不得修改骨架中的 ID、境界、公理或规则。`;
const worldGeographyShape = shapeIntro + [
  '顶层: {locations[], factions[], terminology[], unresolvedQuestions[]}',
  'locations[]: {id, name, kind, parentId?: location id, entryConditions: [字符串], status}',
  'factions[]: {id, name, kind, locationIds: [location id], goals: [字符串], resources: [resource id 或待定术语], status}',
  'terminology[]: {id, canonical, aliases: [字符串], kind, status}',
  'unresolvedQuestions[]: {id, question, blocking: 布尔, status: "open"|"resolved"|"deferred"}',
].join('');
const worldPowerSystem = `你是同一部玄幻长篇的世界观第三阶段规划器。只返回一个 JSON 对象，不要 Markdown，不要解释。基于输入骨架和地理势力补齐力量资产：100章验收至少十五种功法、十二件法宝、十种资源；450章扩展至少三十种功法、二十四件法宝、十八种资源。功法、法宝、资源必须跨多个等级，逐项写清 tier；每种力量都要能对应一个或多个境界。每项都必须写效果、代价、限制和反制；allowedRealmIds 只能使用骨架中的境界 ID；不要修改已有 ID或规则。`;
const worldPowerShape = shapeIntro + [
  '顶层: {techniques[], artifacts[], resources[], terminology[], unresolvedQuestions[]}',
  'techniques[]: {id, name, kind, tier: 等级名称, allowedRealmIds: [realm id], effect, cost, limitations: [字符串], counters: [字符串], status}',
  'artifacts[]: {id, name, tier, effect, cost, limitations: [字符串], status}',
  'resources[]: {id, name, unit, source, scarcity, tier: 等级名称, status}',
  'terminology[]: {id, canonical, aliases: [字符串], kind, status}',
  'unresolvedQuestions[]: {id, question, blocking: 布尔, status: "open"|"resolved"|"deferred"}',
].join('');
const worldHistorySystem = `你是同一部玄幻长篇的世界观第四阶段规划器。只返回一个 JSON 对象，不要 Markdown，不要解释。基于全部输入补齐至少十个有因果链的历史事件（450章扩展至少十八个），覆盖大陆、势力和力量体系的形成、断裂与现状；每个事件必须写 causes、consequences、factionIds，并标明它影响的等级体系或资源流转。不得新增或修改已有实体 ID；可以补充少量术语和不阻断开篇的探索问题。`;
const worldHistoryShape = shapeIntro + [
  '顶层: {historicalEvents[], terminology[], unresolvedQuestions[]}',
  'historicalEvents[]: {id, title, storyTime, causes: [字符串], consequences: [字符串], factionIds: [faction id], status}',
  'terminology[]: {id, canonical, aliases: [字符串], kind, status}',
  'unresolvedQuestions[]: {id, question, blocking: 布尔, status: "open"|"resolved"|"deferred"}',
].join('');

type WorldStage = Record<string, unknown>;

function parseWorldStage(stage: 'skeleton' | 'geography' | 'power' | 'history'): (value: unknown) => WorldStage {
  const required: Record<typeof stage, string[]> = {
    skeleton: ['id', 'title', 'summary', 'axioms', 'powerSystems', 'tierLadders', 'realms', 'terminology', 'unresolvedQuestions'],
    geography: ['locations', 'factions'],
    power: ['techniques', 'artifacts', 'resources'],
    history: ['historicalEvents'],
  };
  return (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PlanningParseError(`${stage} world response must be an object`);
    const record = normalizeWorldEnums(value) as WorldStage;
    // A complete response is checked here so a malformed legacy answer enters
    // the single repair path instead of being mistaken for a partial stage.
    if (stage === 'skeleton' && ['axioms', 'powerSystems', 'realms', 'techniques', 'artifacts', 'resources', 'locations', 'factions', 'historicalEvents', 'terminology'].every((key) => Array.isArray(record[key]))) {
      try { return parseWorldPack(record) as unknown as WorldStage; } catch (error) { throw new PlanningParseError(`complete world pack is invalid: ${describeOutputProblems(error) ?? String(error)}`); }
    }
    const missing = required[stage].filter((key) => key !== 'id' && key !== 'title' && key !== 'summary' && !Array.isArray(record[key]));
    if (stage === 'skeleton' && required[stage].filter((key) => ['id', 'title', 'summary'].includes(key)).some((key) => typeof record[key] !== 'string')) missing.push('metadata');
    if (missing.length) throw new PlanningParseError(`${stage} world response is missing arrays: ${missing.join(', ')}`);
    return record;
  };
}

function tryParseWorldPack(value: WorldStage): WorldPack | undefined {
  try { return parseWorldPack(normalizeWorldEnums(value)) as WorldPack; } catch { return undefined; }
}

function mergeWorldStages(title: string, ...stages: WorldStage[]): WorldStage {
  const [skeleton, geography, power, history] = stages.map((stage) => normalizeWorldEnums(stage) as WorldStage);
  const arrays = (key: string) => [skeleton, geography, power, history].flatMap((stage) => Array.isArray(stage[key]) ? stage[key] : []);
  const unique = (key: string) => [...new Map(arrays(key).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)) && typeof (item as Record<string, unknown>).id === 'string').map((item) => [item.id as string, item])).values()];
  return {
    id: typeof skeleton.id === 'string' ? skeleton.id : `world-${Date.now()}`,
    revision: 1,
    title: typeof skeleton.title === 'string' ? skeleton.title : title,
    summary: typeof skeleton.summary === 'string' ? skeleton.summary : '',
    status: 'proposed',
    createdAt: typeof skeleton.createdAt === 'string' ? skeleton.createdAt : new Date().toISOString(),
    tierLadders: unique('tierLadders'), axioms: unique('axioms'), powerSystems: unique('powerSystems'), realms: unique('realms'), techniques: unique('techniques'),
    artifacts: unique('artifacts'), resources: unique('resources'), locations: unique('locations'), factions: unique('factions'),
    historicalEvents: unique('historicalEvents'), terminology: unique('terminology'), unresolvedQuestions: unique('unresolvedQuestions'),
  };
}

/** Models often translate enum labels while keeping the surrounding object
 * correct.  Normalize only the documented aliases; an unknown label remains
 * unknown and is rejected by the contract parser instead of being guessed. */
function normalizeWorldEnums(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const copy: Record<string, unknown> = { ...source };
  const enumMap = (token: unknown, allowed: string[], aliases: Record<string, string>, fallback?: (text: string) => string) => {
    if (typeof token !== 'string') return token;
    if (allowed.includes(token)) return token;
    return aliases[token] ?? fallback?.(token) ?? token;
  };
  const mapItems = (key: string, mapper: (item: Record<string, unknown>) => Record<string, unknown>) => {
    if (Array.isArray(copy[key])) copy[key] = copy[key].map((item) => item && typeof item === 'object' && !Array.isArray(item) ? mapper({ ...(item as Record<string, unknown>) }) : item);
  };
  mapItems('techniques', (item) => ({ ...item, kind: enumMap(item.kind, ['technique', 'cultivation', 'bloodline', 'secret'], {}, (text) => /血脉/.test(text) ? 'bloodline' : /秘|禁/.test(text) ? 'secret' : /功|修炼|呼吸/.test(text) ? 'cultivation' : 'technique') }));
  mapItems('locations', (item) => ({ ...item, kind: enumMap(item.kind, ['plane', 'continent', 'country', 'region', 'city', 'sect', 'secret_realm', 'ruin', 'other'], { '大陆': 'continent', '国家': 'country', '区域': 'region', '城市': 'city', '宗门据点': 'sect', '秘境': 'secret_realm', '遗迹': 'ruin', 'sect_stronghold': 'sect', 'sect_city': 'sect', 'ruins': 'ruin', 'dungeon': 'secret_realm', 'border_point': 'region', 'nation': 'country', 'territory': 'region', 'capital': 'city' }, (text) => /sect|stronghold/.test(text) ? 'sect' : /nation|country|empire/.test(text) ? 'country' : /territory|border|region/.test(text) ? 'region' : /capital|city/.test(text) ? 'city' : /danger|forbidden|dungeon/.test(text) ? 'secret_realm' : 'other') }));
  mapItems('factions', (item) => ({ ...item, kind: enumMap(item.kind, ['empire', 'sect', 'clan', 'merchant', 'religion', 'species', 'other'], {}, (text) => /帝国|皇权/.test(text) ? 'empire' : /商|商业/.test(text) ? 'merchant' : /妖|族/.test(text) ? 'species' : /教|宗|门|道/.test(text) ? 'sect' : 'other') }));
  mapItems('terminology', (item) => ({ ...item, kind: enumMap(item.kind, ['person', 'place', 'faction', 'realm', 'technique', 'artifact', 'resource', 'other'], {}, (text) => /人|角色/.test(text) ? 'person' : /地|大陆|城|域/.test(text) ? 'place' : /势力|宗门/.test(text) ? 'faction' : /境界|等级/.test(text) ? 'realm' : /法|诀/.test(text) ? 'technique' : /宝|器/.test(text) ? 'artifact' : /资源|材|石|丹/.test(text) ? 'resource' : 'other') }));
  mapItems('tierLadders', (item) => ({ ...item, kind: enumMap(item.kind, ['realm', 'technique', 'artifact', 'resource'], { '境界': 'realm', '功法': 'technique', '法宝': 'artifact', '资源': 'resource' }) }));
  return copy;
}
const storyBibleSystem = `你是长篇玄幻小说的人物关系与分卷总纲规划器。只返回一个 JSON 对象，不要 Markdown，不要解释，不要添加合同外字段。必须完整包含 id、revision、worldPackId、worldPackRevision、status、coreConflict、endingDirection、characters、relationships、secrets、arcBeats、promises、openThreads、arcs、volumes、unresolvedQuestions、createdAt；chapterPlans 首轮可省略，前 50 章会由独立的分阶段章纲规划器生成并在锁定前合并。枚举字段必须使用合同中的英文 token：characters.role 只能是 protagonist/major/supporting/stage，relationships.kind 只能是 kinship/social/trust/emotion/allegiance/private_intent/belief，arcBeats.kind 只能是 trigger/belief_shift/choice/cost/consequence/resolution，openThreads.kind 只能是 main/subplot/mystery/open。至少生成主角、主要配角、对手、关系、秘密、人物弧光、可兑现承诺、待收束开放线和 3 个以上分卷；arcBeats 是全书关键节点提纲，至少生成 3×分卷数 个有 plannedChapter 的节点，并让每卷至少有一个节点，节点要覆盖触发、升级、选择、代价、后果和收束。前 50 章由独立的分阶段章纲规划器生成；本次只需把人物、关系、秘密、弧光、承诺、开放线和分卷总纲写完整，文本保持简洁具体。输入中的 chapterTarget 是当前验收目标，所有分卷 plannedChapterCount 之和必须恰好等于该数；卷序连续，所有引用必须指向输入世界包或本对象中的有效 ID。每个 promise 写明 payoffCondition，每个 openThread 写明 plannedResolution。若输入提供 previousStoryBible，这是从较短验收扩展长篇，必须保留其中已有 characters、relationships、arcs、secrets、promises、openThreads、arcBeats、chapterPlans 的稳定 ID、核心设定和前 50 章承接，只能在其上扩展后续卷；不得为了重写而更换旧 ID。状态使用 proposed，createdAt 使用 ISO 8601 时间。`;
const chapterSystem = `你是同一本长篇玄幻小说的章节写作模型。只返回一个 JSON 对象，不要 Markdown，不要解释。content 用中文写完整章节，遵守创作约定、已锁定世界包和 Story Bible，并参考 currentPlan 指出的当前分卷、临近人物弧光和待兑现承诺；不得跨卷抢跑，也不能漏掉正文明确兑现的计划。参考最近章节保持人物、力量、地点和时间连续。proposedEvents 必须记录本章正文真正改变的事实，observedEvents 必须是独立复核正文后得到的同一组事实，二者完全一致。eventType 只能使用 character_state、relationship_change、knowledge_belief、resource_change、artifact_change、plot_progress、volume_progress、arc_progress、secret_reveal、promise_payoff、thread_resolution。volume_progress 和 arc_progress 的 value.status 只能是 active、resolved、diverged；arc_progress 的 subjectId 必须是 Story Bible 中 arcs 的 arc id，不能填写 arcBeat id；章纲或 arcBeat 的兑现使用 plot_progress，subjectId 填 chapter-N 或 outline id。secret_reveal 表示秘密在本章确实揭示；promise_payoff 的 value.status 只能是 paid、broken、open；thread_resolution 的 value.status 只能是 resolved、deferred、open。每个事件都要有 evidence，subjectId 使用世界包或 Story Bible 中已有的稳定 ID；没有变化就返回空数组。只有正文明确发生的变化才能入账，角色猜测写成 knowledge_belief，计划尚未兑现的内容不要冒充已兑现。不要擅自改写锁定关系、境界规则或分卷目标。`;
const chapterDraftSystem = `你是同一本长篇玄幻小说的章节写作模型。只返回一个 JSON 对象，不要 Markdown，不要解释。content 用中文写完整章节，遵守创作约定、已锁定世界包和 Story Bible，并参考 currentPlan 指出的当前分卷、临近人物弧光和待兑现承诺；不得跨卷抢跑，也不能漏掉正文明确兑现的计划。参考最近章节保持人物、力量、地点和时间连续。proposedEvents 必须记录本章正文真正改变的事实；不要返回 observedEvents，正文会交给独立审计器再次抽取。eventType 只能使用 character_state、relationship_change、knowledge_belief、resource_change、artifact_change、plot_progress、volume_progress、arc_progress、secret_reveal、promise_payoff、thread_resolution。volume_progress 和 arc_progress 的 value.status 只能是 active、resolved、diverged；arc_progress 的 subjectId 必须是 Story Bible 中 arcs 的 arc id，不能填写 arcBeat id；章纲或 arcBeat 的兑现使用 plot_progress，subjectId 填 chapter-N 或 outline id。每个事件都要有 evidence，subjectId 使用世界包或 Story Bible 中已有的稳定 ID；没有变化就返回空数组。只有正文明确发生的变化才能入账，角色猜测写成 knowledge_belief，计划尚未兑现的内容不要冒充已兑现。不要擅自改写锁定关系、境界规则或分卷目标。`;
const briefRule = `输入的 chapterBrief 是作者批准计划给出的本章任务卡：必须完成 mustDo，结尾落在 endState，遵守 preserve；mustNotHappen 中的事情本章绝不能发生或提前揭示；dependsOn 中未满足的前置不能靠临时新增能力或道具补上。若本章正文确实推进了任务卡对应章纲，追加一个 eventType 为 plot_progress、subjectId 为 chapterBrief.outlineId、predicate 为 status、value 为 {"status":"realized"} 的事件（只部分完成用 partial，明显偏离用 diverged），evidence 写正文依据。`;
const extractionBriefRule = `输入的 chapterBrief 只用于判断章纲是否落实：若正文明确完成了 mustDo 并到达 endState，输出一个 eventType 为 plot_progress、subjectId 为 chapterBrief.outlineId、predicate 为 status、value 为 {"status":"realized"} 的事件；只完成一部分用 partial，明显偏离用 diverged；evidence 必须来自正文。不要因为任务卡要求就假定正文已完成。`;
const planSkeletonSystem = `你是长篇玄幻小说的全书规划器。只返回一个 JSON 对象，不要 Markdown，不要解释。字段：targetChapterCount、volumeCount、mainConflict、theme、protagonistArc、endingDirection、keyTurns、volumes、milestones、dependencies、openQuestions。targetChapterCount 和 volumeCount 必须等于输入值。volumes 每项含 id、order、title、startChapter、endChapter、goal、opposition、characterIds、climax、endState、carryOver；卷序从 1 连续，章节范围从第 1 章起连续不重叠，最后一卷结束于 targetChapterCount；characterIds 只能使用 storyBible.characters 中的 id。milestones 是高潮、转折与兑现节点，每项含 id、title、kind（climax/turn/payoff）、startChapter、endChapter、setup（铺垫清单）、cost、outcome；高潮写章节范围，不要为凑数精确到某一章注水，每卷至少一个 climax。dependencies 每项含 id、targetId（milestone id 或 chapter-N）、sourceId（另一个更早的节点，可选）或 fact（{eventType, subjectId, predicate?}，表示正文必须先发生的事实）、requiredness（must/optional）、description；关键依赖不能成环。openQuestions 记录作者尚未决定的事项，只有确实会阻断开篇的才标 blocking。若输入有 adoptedFacts 或 previousPlan，已经写成的正文和已发生事实不可改变，只能在其上规划后续；authorRequest 是作者的要求，优先遵守。`;
const chapterOutlineSystem = `你是长篇玄幻小说的章纲规划器。只返回一个 JSON 对象 {"chapters":[...]}，不要 Markdown，不要解释。为输入 from 到 to 的每一章各写一条章纲，不多不少。每条含 chapterNumber、volumeId（plan.volumes 中覆盖该章的卷 id）、title、summary（本章发生的事件，不是标题复述）、characterGoals、conflict、choice（关键选择）、cost（代价或后果）、threads（推进的线索）、endState（本章结束时的局面）、characterIds（只能用 storyBible.characters 的 id）、location、storyTime、scenes（场景序列）。与 previousOutlines 自然衔接，并为 followingOutlines 留出接口；按 plan.milestones 的范围安排铺垫与高潮，不得提前揭示后续节点，也不要原地踏步重复冲突。已写成的正文（adoptedFacts）是既成事实。authorRequest 是作者对本组的要求，优先遵守。`;
const extractionSystem = `你是长篇玄幻小说的独立事实审计器。只返回一个 JSON 对象，不要 Markdown，不要解释，格式必须是 {"observedEvents":[]}。只阅读正文和已锁定的世界包、Story Bible，独立判断正文真正发生的状态变化；不要相信或补全任何未在正文明确出现的计划。输入可能包含 writerProposedEvents，它只是待核对的声明：逐条检查正文是否明确支持，支持的事件沿用同一 eventType、subjectId、predicate 和 value 原样返回，只把 evidence 改为正文证据；正文没有支持的声明不要返回，也不要新增同一变化的别名事件。eventType 只能使用 character_state、relationship_change、knowledge_belief、resource_change、artifact_change、plot_progress、volume_progress、arc_progress、secret_reveal、promise_payoff、thread_resolution。volume_progress 和 arc_progress 的 value.status 只能是 active、resolved、diverged；每个事件必须包含 eventType、subjectId、predicate、value 和 evidence；没有明确变化就返回空数组。evidence 必须是正文中的短语或准确概述，subjectId 必须使用输入设计中的稳定 ID。`;
