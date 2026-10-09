import type {
  AdoptionResponse,
  ApiError,
  BibleDto,
  CandidateDto,
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
} from 'novel-studio-contracts';

export interface ChapterHistoryDto {
  chapterNumber: number;
  events: Array<{ id: string; chapterNumber: number; eventType: string; subjectId: string; predicate: string; value: unknown; evidence: string; storyTime?: number }>;
  characterStates: Array<{ characterId: string; field: string; value: unknown; sourceEventId: string; sourceChapterVersionId: string; storyTime?: number }>;
  relationships: Array<RelationshipDto | undefined>;
  arcStates: Array<{ arcId: string; status: string; value: unknown; sourceEventId: string; sourceChapterVersionId: string; storyTime?: number }>;
  secretStates: Array<{ secretId: string; revealed: boolean; value: unknown; sourceEventId: string; sourceChapterVersionId: string; storyTime?: number }>;
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
  createWork: (body: CreateWorkRequest) => call<WorkDto>('/works', { method: 'POST', body }),
  updateWork: (workId: string, body: UpdateWorkRequest) => call<WorkDto>(`/works/${workId}`, { method: 'PATCH', body }),
  listWorks: () => call<{ works: WorkDto[] }>('/works'),
  getWork: (workId: string) => call<WorkDto>(`/works/${workId}`),
  design: (workId: string) => call<DesignDto>(`/works/${workId}/design`),
  generateDesign: (workId: string, stage: 'world_pack' | 'story_bible') =>
    call<{ worldPack?: DesignDto['worldPack']; storyBible?: DesignDto['storyBible'] }>(`/works/${workId}/design/generate`, { method: 'POST', body: { stage } }),
  reviewWorldPack: (workId: string) => call<{ worldPack: NonNullable<DesignDto['worldPack']> }>(`/works/${workId}/world-pack/review`, { method: 'POST', body: {} }),
  lockWorldPack: (workId: string) => call<{ worldPack: NonNullable<DesignDto['worldPack']> }>(`/works/${workId}/world-pack/lock`, { method: 'POST', body: {} }),
  reviewStoryBible: (workId: string) => call<{ storyBible: NonNullable<DesignDto['storyBible']> }>(`/works/${workId}/story-bible/review`, { method: 'POST', body: {} }),
  lockStoryBible: (workId: string) => call<{ storyBible: NonNullable<DesignDto['storyBible']> }>(`/works/${workId}/story-bible/lock`, { method: 'POST', body: {} }),
  manuscripts: (workId: string) => call<{ manuscripts: import('novel-studio-contracts').ManuscriptRevisionDto[] }>(`/works/${workId}/manuscripts`),
  exportManuscript: (workId: string, manuscriptId: string) => call<{ manuscript: import('novel-studio-contracts').ManuscriptRevisionDto; chapters: Array<Pick<ChapterVersionDto, 'id' | 'chapterNumber' | 'content' | 'revision'>> }>(`/works/${workId}/manuscripts/${manuscriptId}/export`),
  listChapters: (workId: string) => call<{ chapters: ChapterVersionDto[] }>(`/works/${workId}/chapters`),
  generate: (workId: string, chapterNumber: number) =>
    call<{ candidate: CandidateDto }>(`/works/${workId}/chapters/${chapterNumber}/generate`, { method: 'POST', body: {} }),
  runUntil: (workId: string, targetChapter: number, runId?: string) =>
    call<{ checkpoint: { runId: string; targetChapter: number; nextChapter: number; phase: string; candidateIds: Record<number, string> } }>(`/works/${workId}/runs`, { method: 'POST', body: { targetChapter, runId } }),
  checkpoints: (workId: string) => call<{ checkpoints: Array<{ runId: string; targetChapter: number; nextChapter: number; phase: string; candidateIds: Record<number, string> }> }>(`/works/${workId}/runs`),
  history: (workId: string, chapterNumber: number) => call<ChapterHistoryDto>(`/works/${workId}/state/${chapterNumber}`),
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
};
