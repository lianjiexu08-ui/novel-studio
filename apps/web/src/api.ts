import type {
  AdoptionResponse,
  ApiError,
  BibleDto,
  CandidateDto,
  ChapterReadinessDto,
  ChapterVersionDto,
  CharacterDto,
  CharacterInput,
  CharacterPatch,
  CreateWorkRequest,
  DesignDto,
  OutboxEventDto,
  PlotNodeDto,
  PlotNodeInput,
  PlotNodePatch,
  RelationshipDto,
  RelationshipInput,
  RelationshipPatch,
  UpdateWorkRequest,
  WorkDto,
  WorldRuleDto,
  WorldRuleInput,
  WorldRulePatch,
  HotTopicsResponse,
  ModelSettingsDto,
  ProbeModelChannelRequest,
  UpdateModelSettingsRequest,
  BookPlanContract,
  ChapterBriefDto,
  ConfirmBriefRequest,
  CovenantImpactDto,
  GenerateOutlinesRequest,
  GeneratePlanRequest,
  PlanOverviewDto,
  PlanReviewDto,
  PlanRevisionDto,
} from 'novel-studio-contracts';

export interface ChapterHistoryDto {
  chapterNumber: number;
  events: Array<{ id: string; chapterNumber: number; eventType: string; subjectId: string; predicate: string; value: unknown; evidence: string; storyTime?: number }>;
  characterStates: Array<{ characterId: string; field: string; value: unknown; sourceEventId: string; sourceChapterVersionId: string; storyTime?: number }>;
  knowledgeStates: Array<{ characterId: string; subjectId: string; proposition: string; belief: unknown; sourceEventId: string; sourceChapterVersionId: string; storyTime?: number }>;
  relationships: Array<RelationshipDto | undefined>;
  resourceStates: Array<{ subjectId: string; field: string; value: unknown; sourceEventId: string; sourceChapterVersionId: string; storyTime?: number }>;
  artifactStates: Array<{ subjectId: string; field: string; value: unknown; sourceEventId: string; sourceChapterVersionId: string; storyTime?: number }>;
  arcStates: Array<{ arcId: string; status: string; value: unknown; sourceEventId: string; sourceChapterVersionId: string; storyTime?: number }>;
  secretStates: Array<{ secretId: string; revealed: boolean; value: unknown; sourceEventId: string; sourceChapterVersionId: string; storyTime?: number }>;
  promiseStates: Array<{ promiseId: string; status: string; value: unknown; sourceEventId: string; sourceChapterVersionId: string; storyTime?: number }>;
  threadStates: Array<{ threadId: string; status: string; value: unknown; sourceEventId: string; sourceChapterVersionId: string; storyTime?: number }>;
  volumeStates: Array<{ volumeId: string; status: string; value: unknown; sourceEventId: string; sourceChapterVersionId: string; storyTime?: number }>;
  quality: {
    contextManifest: { chapterNumber: number; stateRevision: number; constraintRevision: number; worldPackRevision?: number; storyBibleRevision?: number; adoptedVersionIds: string[]; includedEventIds: string[]; requiredMaterialStatus: string; omittedOptionalMaterial: string[]; estimatedTokens: number; contextBudget: number; canonHash: string; stateHash: string; createdAt: string };
    version?: { id: string; revision: number; status: string; stale: boolean; sourceCandidateId?: string };
    candidate?: { id: string; status: string; proposedEvents: Array<{ eventType: string; subjectId: string; predicate: string; value: unknown; evidence?: string; plotNodeId?: string }>; observedEvents?: Array<{ eventType: string; subjectId: string; predicate: string; value: unknown; evidence?: string; plotNodeId?: string }>; checks: Array<{ checker: string; status: string; message: string; candidateId: string; checkedAt: string }> };
    checkCoverage: { total: number; passed: number; failed: number; inconclusive: number; unavailable: number };
    plotNodes: Array<{ id: string; title: string; expectedResult: string; targetChapter?: number; realization: { status: string; chapterVersionId?: string; evidence?: string; updatedAt: string } }>;
    impacts: Array<{ id: string; changedChapterNumber: number; affectedChapterNumbers: number[]; reason: string; createdAt: string }>;
    closureCoverage: { ready: boolean; errors: string[]; resolved: { volumes: number; arcs: number; secrets: number; promises: number; threads: number }; expected: { volumes: number; arcs: number; secrets: number; promises: number; threads: number } };
  };
}

export interface DesignHistoryDto {
  revisions: Array<{
    id: string;
    workId: string;
    kind: 'world_pack' | 'story_bible';
    revision: number;
    status: string;
    contentHash: string;
    snapshot: unknown;
    createdAt: string;
  }>;
}

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8787';
const TOKEN = import.meta.env.VITE_API_TOKEN ?? '';

export class ApiRequestError extends Error {
  constructor(
    readonly code: ApiError['error']['code'],
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = (await response.json()) as T & ApiError;
  if (!response.ok) {
    const error = payload.error;
    throw new ApiRequestError(error?.code ?? 'INTERNAL', error?.message ?? `HTTP ${response.status}`, response.status);
  }
  return payload;
}

export const api = {
  hotTopics: (query = '') => call<HotTopicsResponse>(`/topics/hot?q=${encodeURIComponent(query)}`),
  createWork: (body: CreateWorkRequest) => call<WorkDto>('/works', { method: 'POST', body }),
  updateWork: (workId: string, body: UpdateWorkRequest) => call<WorkDto & { impact: CovenantImpactDto }>(`/works/${workId}`, { method: 'PATCH', body }),
  listWorks: () => call<{ works: WorkDto[] }>('/works'),
  getWork: (workId: string) => call<WorkDto>(`/works/${workId}`),
  design: (workId: string) => call<DesignDto>(`/works/${workId}/design`),
  designHistory: (workId: string) => call<DesignHistoryDto>(`/works/${workId}/design/history`),
  generateDesign: (workId: string, stage: 'world_pack' | 'story_bible', chapterTarget?: number) =>
    call<{ worldPack?: DesignDto['worldPack']; storyBible?: DesignDto['storyBible'] }>(`/works/${workId}/design/generate`, { method: 'POST', body: { stage, ...(chapterTarget ? { chapterTarget } : {}) } }),
  reviewWorldPack: (workId: string) => call<{ worldPack: NonNullable<DesignDto['worldPack']> }>(`/works/${workId}/world-pack/review`, { method: 'POST', body: {} }),
  lockWorldPack: (workId: string) => call<{ worldPack: NonNullable<DesignDto['worldPack']> }>(`/works/${workId}/world-pack/lock`, { method: 'POST', body: {} }),
  reviewStoryBible: (workId: string) => call<{ storyBible: NonNullable<DesignDto['storyBible']> }>(`/works/${workId}/story-bible/review`, { method: 'POST', body: {} }),
  lockStoryBible: (workId: string) => call<{ storyBible: NonNullable<DesignDto['storyBible']> }>(`/works/${workId}/story-bible/lock`, { method: 'POST', body: {} }),
  manuscripts: (workId: string) => call<{ manuscripts: import('novel-studio-contracts').ManuscriptRevisionDto[] }>(`/works/${workId}/manuscripts`),
  exportManuscript: (workId: string, manuscriptId: string) => call<{ manuscript: import('novel-studio-contracts').ManuscriptRevisionDto; chapters: Array<Pick<ChapterVersionDto, 'id' | 'chapterNumber' | 'content' | 'revision'>> }>(`/works/${workId}/manuscripts/${manuscriptId}/export`),
  listChapters: (workId: string) => call<{ chapters: ChapterVersionDto[] }>(`/works/${workId}/chapters`),
  readiness: (workId: string, chapterNumber: number) => call<ChapterReadinessDto>(`/works/${workId}/chapters/${chapterNumber}/readiness`),
  generate: (workId: string, chapterNumber: number, mode: 'formal' | 'demo' = 'formal') =>
    call<{ candidate: CandidateDto }>(`/works/${workId}/chapters/${chapterNumber}/generate`, { method: 'POST', body: { mode } }),
  checkpoints: (workId: string) => call<{ checkpoints: RunCheckpoint[]; activeRunIds: string[] }>(`/works/${workId}/runs`),
  controlRun: (workId: string, runId: string, action: 'pause' | 'cancel') =>
    call<{ checkpoint: RunCheckpoint }>(`/works/${workId}/runs/${encodeURIComponent(runId)}/${action}`, { method: 'POST', body: {} }),
  resumeRun: (workId: string, runId: string, targetChapter: number) =>
    call<{ runId: string; status: string; checkpoint?: RunCheckpoint }>(`/works/${workId}/runs`, { method: 'POST', body: { runId, targetChapter, background: true } }),
  history: (workId: string, chapterNumber: number) => call<ChapterHistoryDto>(`/works/${workId}/state/${chapterNumber}`),
  finalizeManuscript: (workId: string) => call<{ manuscript: import('novel-studio-contracts').ManuscriptRevisionDto }>(`/works/${workId}/manuscripts/finalize`, { method: 'POST', body: {} }),
  check: (workId: string, candidateId: string) =>
    call<{ candidate: CandidateDto }>(`/works/${workId}/candidates/${candidateId}/check`, { method: 'POST' }),
  adopt: (workId: string, candidateId: string, expectedStateRevision: number) =>
    call<AdoptionResponse>(`/works/${workId}/candidates/${candidateId}/adopt`, { method: 'POST', body: { expectedStateRevision } }),
  outbox: (workId: string) => call<{ events: OutboxEventDto[] }>(`/works/${workId}/outbox`),

  bible: (workId: string) => call<BibleDto>(`/works/${workId}/bible`),
  addCharacter: (workId: string, body: Partial<CharacterInput> & { name: string }) =>
    call<CharacterDto>(`/works/${workId}/characters`, { method: 'POST', body }),
  updateCharacter: (workId: string, id: string, body: CharacterPatch) =>
    call<CharacterDto>(`/works/${workId}/characters/${id}`, { method: 'PATCH', body }),
  removeCharacter: (workId: string, id: string) => call<{ ok: true }>(`/works/${workId}/characters/${id}`, { method: 'DELETE' }),
  addRelationship: (workId: string, body: Partial<RelationshipInput> & Pick<RelationshipInput, 'fromCharacterId' | 'toCharacterId' | 'kind'>) =>
    call<RelationshipDto>(`/works/${workId}/relationships`, { method: 'POST', body }),
  updateRelationship: (workId: string, id: string, body: RelationshipPatch) =>
    call<RelationshipDto>(`/works/${workId}/relationships/${id}`, { method: 'PATCH', body }),
  removeRelationship: (workId: string, id: string) => call<{ ok: true }>(`/works/${workId}/relationships/${id}`, { method: 'DELETE' }),
  addWorldRule: (workId: string, body: Partial<WorldRuleInput> & Pick<WorldRuleInput, 'category' | 'title'>) =>
    call<WorldRuleDto>(`/works/${workId}/world-rules`, { method: 'POST', body }),
  updateWorldRule: (workId: string, id: string, body: WorldRulePatch) =>
    call<WorldRuleDto>(`/works/${workId}/world-rules/${id}`, { method: 'PATCH', body }),
  removeWorldRule: (workId: string, id: string) => call<{ ok: true }>(`/works/${workId}/world-rules/${id}`, { method: 'DELETE' }),
  addPlotNode: (workId: string, body: Partial<PlotNodeInput> & Pick<PlotNodeInput, 'title'>) =>
    call<PlotNodeDto>(`/works/${workId}/plot-nodes`, { method: 'POST', body }),
  updatePlotNode: (workId: string, id: string, body: PlotNodePatch) =>
    call<PlotNodeDto>(`/works/${workId}/plot-nodes/${id}`, { method: 'PATCH', body }),
  removePlotNode: (workId: string, id: string) => call<{ ok: true }>(`/works/${workId}/plot-nodes/${id}`, { method: 'DELETE' }),

  plans: (workId: string) => call<PlanOverviewDto>(`/works/${workId}/plans`),
  planHistory: (workId: string) => call<{ plans: PlanRevisionDto[]; activePlanId?: string }>(`/works/${workId}/plans/history`),
  generatePlan: (workId: string, body: GeneratePlanRequest) => call<{ plan: PlanRevisionDto }>(`/works/${workId}/plans/generate`, { method: 'POST', body }),
  generateOutlines: (workId: string, body: GenerateOutlinesRequest) => call<{ plan: PlanRevisionDto }>(`/works/${workId}/plans/outlines`, { method: 'POST', body }),
  savePlan: (workId: string, body: { plan: BookPlanContract; baseRevisionId?: string; note?: string }) => call<{ plan: PlanRevisionDto }>(`/works/${workId}/plans`, { method: 'PUT', body }),
  reviewPlan: (workId: string, planId: string) => call<{ review: PlanReviewDto; plan: PlanRevisionDto }>(`/works/${workId}/plans/${planId}/review`, { method: 'POST', body: {} }),
  approvePlan: (workId: string, planId: string) => call<{ plan: PlanRevisionDto }>(`/works/${workId}/plans/${planId}/approve`, { method: 'POST', body: {} }),
  nextChapter: (workId: string) => call<NextChapterDto>(`/works/${workId}/next-chapter`),
  confirmBrief: (workId: string, chapterNumber: number, body: ConfirmBriefRequest) =>
    call<{ brief: ChapterBriefDto }>(`/works/${workId}/chapters/${chapterNumber}/brief/confirm`, { method: 'POST', body }),

  modelSettings: () => call<ModelSettingsDto>('/settings/model'),
  saveModelSettings: (body: UpdateModelSettingsRequest) => call<ModelSettingsDto>('/settings/model', { method: 'PUT', body }),
  activateModelChannel: (id: string) => call<ModelSettingsDto>('/settings/model/activate', { method: 'POST', body: { id } }),
  removeModelChannel: (id: string) => call<ModelSettingsDto>(`/settings/model/channels/${id}`, { method: 'DELETE' }),
  testModelSettings: (body: ProbeModelChannelRequest) => call<{ ok: boolean; message: string }>('/settings/model/test', { method: 'POST', body }),
  listModels: (body: ProbeModelChannelRequest) => call<{ models: string[]; message?: string }>('/settings/model/models', { method: 'POST', body }),
};

export interface RunCheckpoint {
  runId: string;
  targetChapter: number;
  nextChapter: number;
  phase: 'idle' | 'generated' | 'checked' | 'adopted' | 'complete' | 'paused' | 'cancelled' | string;
  candidateIds: Record<string, string>;
  error?: string;
  active?: boolean;
  control?: 'pause' | 'cancel';
  attempts?: Record<string, number>;
}

export interface EffectiveBriefDto {
  brief: ChapterBriefDto;
  needsConfirmation: boolean;
  derived: ChapterBriefDto;
}

export interface NextChapterDto {
  chapterNumber: number;
  blockers: ChapterReadinessDto['blockers'];
  brief?: EffectiveBriefDto;
  volume?: BookPlanContract['volumes'][number];
  nextClimax?: { milestone: BookPlanContract['milestones'][number]; missing: string[] };
  planRevisionId?: string;
}
