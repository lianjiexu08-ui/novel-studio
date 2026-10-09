export type ModelRole = 'planning' | 'writing' | 'extraction' | 'reviewing';

export interface ModelRequest {
  role: ModelRole;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: 'text' | 'json';
  estimatedCostUsd?: number;
  metadata?: Record<string, string>;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ModelResponse {
  text: string;
  usage: ModelUsage;
  provider: string;
  model: string;
  requestId?: string;
}

export interface ModelCredential {
  apiKey: string;
  endpoint: string;
}

export interface ModelAdapter {
  readonly provider: string;
  complete(request: ModelRequest, credential: ModelCredential): Promise<ModelResponse>;
}

export interface UsageRecord extends ModelUsage {
  provider: string;
  model: string;
  role: ModelRole;
  recordedAt: string;
}

export class BudgetExceededError extends Error {}

export class UsageLedger {
  private spentUsd = 0;
  private readonly records: UsageRecord[] = [];
  private readonly budgetUsd: number;
  private readonly clock: () => string;

  constructor(budgetUsd: number, clock: () => string = () => new Date().toISOString()) {
    this.budgetUsd = budgetUsd;
    this.clock = clock;
  }

  reserve(estimatedCostUsd = 0): void {
    if (estimatedCostUsd < 0) throw new Error('estimated cost cannot be negative');
    if (this.spentUsd + estimatedCostUsd > this.budgetUsd) throw new BudgetExceededError(`model budget exceeded (${this.budgetUsd.toFixed(4)} USD)`);
  }

  record(response: ModelResponse, role: ModelRole): UsageRecord {
    const next = this.spentUsd + response.usage.costUsd;
    if (next > this.budgetUsd) throw new BudgetExceededError(`model response exceeded budget (${this.budgetUsd.toFixed(4)} USD)`);
    this.spentUsd = next;
    const record: UsageRecord = { ...response.usage, provider: response.provider, model: response.model, role, recordedAt: this.clock() };
    this.records.push(record);
    return { ...record };
  }

  get spent(): number { return this.spentUsd; }
  list(): UsageRecord[] { return this.records.map((record) => ({ ...record })); }
}

export class ModelGateway {
  private readonly adapters: Map<string, ModelAdapter>;
  private readonly ledger: UsageLedger;

  constructor(adapters: Map<string, ModelAdapter>, ledger: UsageLedger) {
    this.adapters = adapters;
    this.ledger = ledger;
  }

  async complete(request: ModelRequest, provider: string, credential: ModelCredential): Promise<ModelResponse> {
    this.ledger.reserve(request.estimatedCostUsd ?? 0);
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new Error(`unknown model provider: ${provider}`);
    const response = await adapter.complete(request, credential);
    this.ledger.record(response, request.role);
    return response;
  }

  usage(): UsageRecord[] { return this.ledger.list(); }
}

export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly provider = 'openai-compatible';
  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  async complete(request: ModelRequest, credential: ModelCredential): Promise<ModelResponse> {
    const response = await this.fetcher(`${credential.endpoint.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${credential.apiKey}` },
      body: JSON.stringify({ model: request.model, messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }], temperature: request.temperature, max_tokens: request.maxOutputTokens, response_format: request.responseFormat === 'json' ? { type: 'json_object' } : undefined }),
    });
    const body = await readJson(response);
    if (!response.ok) throw new Error(`openai-compatible request failed (${response.status}): ${safeErrorMessage(body)}`);
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('openai-compatible response has no message content');
    return { text, usage: normalizeUsage(body?.usage), provider: this.provider, model: request.model, requestId: typeof body?.id === 'string' ? body.id : undefined };
  }
}

export class GeminiAdapter implements ModelAdapter {
  readonly provider = 'gemini';
  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  async complete(request: ModelRequest, credential: ModelCredential): Promise<ModelResponse> {
    const endpoint = `${credential.endpoint.replace(/\/$/, '')}/v1beta/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(credential.apiKey)}`;
    const response = await this.fetcher(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: request.system }] }, contents: [{ role: 'user', parts: [{ text: request.user }] }], generationConfig: { temperature: request.temperature, maxOutputTokens: request.maxOutputTokens, responseMimeType: request.responseFormat === 'json' ? 'application/json' : undefined } }),
    });
    const body = await readJson(response);
    if (!response.ok) throw new Error(`gemini request failed (${response.status}): ${safeErrorMessage(body)}`);
    const text = body?.candidates?.[0]?.content?.parts?.map((part: { text?: unknown }) => part.text).filter((part: unknown): part is string => typeof part === 'string').join('');
    if (!text) throw new Error('gemini response has no candidate content');
    return { text, usage: normalizeUsage(body?.usageMetadata), provider: this.provider, model: request.model, requestId: typeof body?.responseId === 'string' ? body.responseId : undefined };
  }
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,}/gi, '[REDACTED]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [/key|token|secret|credential|authorization/i.test(key) ? key : key, /key|token|secret|credential|authorization/i.test(key) ? '[REDACTED]' : redactSecrets(item)]));
  return value;
}

async function readJson(response: Response): Promise<any> {
  try { return await response.json(); } catch { return {}; }
}

function safeErrorMessage(body: any): string {
  const message = typeof body?.error?.message === 'string' ? body.error.message : 'provider returned an error';
  return String(redactSecrets(message));
}

function normalizeUsage(raw: any): ModelUsage {
  return { inputTokens: Number(raw?.prompt_tokens ?? raw?.promptTokenCount ?? 0), outputTokens: Number(raw?.completion_tokens ?? raw?.candidatesTokenCount ?? 0), costUsd: Number(raw?.cost_usd ?? 0) };
}
