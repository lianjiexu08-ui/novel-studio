import type {
  AdoptionResponse,
  ApiError,
  CandidateDto,
  ChapterVersionDto,
  CreateWorkRequest,
  OutboxEventDto,
  UpdateWorkRequest,
  WorkDto,
} from 'novel-studio-contracts';

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
  listChapters: (workId: string) => call<{ chapters: ChapterVersionDto[] }>(`/works/${workId}/chapters`),
  generate: (workId: string, chapterNumber: number) =>
    call<{ candidate: CandidateDto }>(`/works/${workId}/chapters/${chapterNumber}/generate`, { method: 'POST', body: {} }),
  check: (workId: string, candidateId: string) =>
    call<{ candidate: CandidateDto }>(`/works/${workId}/candidates/${candidateId}/check`, { method: 'POST' }),
  adopt: (workId: string, candidateId: string, expectedStateRevision: number) =>
    call<AdoptionResponse>(`/works/${workId}/candidates/${candidateId}/adopt`, { method: 'POST', body: { expectedStateRevision } }),
  outbox: (workId: string) => call<{ events: OutboxEventDto[] }>(`/works/${workId}/outbox`),
};
