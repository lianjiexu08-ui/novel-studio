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
export class ModelTimeoutError extends Error {}

export interface UsageLimits {
  maxCalls?: number;
  /** Cap on output tokens; each call reserves its requested maxOutputTokens up front. */
  maxOutputTokens?: number;
}

export interface UsageSummary {
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** False once any call reported tokens without a price; `costUsd` is then a lower bound. */
  costKnown: boolean;
  byRole: Partial<Record<ModelRole, { calls: number; failedCalls: number; outputTokens: number; costUsd: number }>>;
  limits: { budgetUsd: number; maxCalls?: number; maxOutputTokens?: number };
}

/**
 * Shared across every model role. Failed calls count against the call cap;
 * a successful response is always recorded (it was already billed) and only
 * then reported as over budget.
 */
export class UsageLedger {
  private spentUsd = 0;
  private outputTokens = 0;
  private calls = 0;
  private readonly failures: Array<{ role: ModelRole; recordedAt: string }> = [];
  private readonly records: UsageRecord[] = [];
  private readonly budgetUsd: number;
  private readonly clock: () => string;
  private readonly limits: UsageLimits;

  constructor(budgetUsd: number, clock: () => string = () => new Date().toISOString(), limits: UsageLimits = {}) {
    this.budgetUsd = budgetUsd;
    this.clock = clock;
    this.limits = limits;
  }

  reserve(estimatedCostUsd = 0, requestedOutputTokens = 0): void {
    if (estimatedCostUsd < 0) throw new Error('estimated cost cannot be negative');
    if (this.spentUsd + estimatedCostUsd > this.budgetUsd) throw new BudgetExceededError(`model budget exceeded (${this.budgetUsd.toFixed(4)} USD)`);
    if (this.limits.maxCalls !== undefined && this.calls + 1 > this.limits.maxCalls) throw new BudgetExceededError(`model call limit reached (${this.limits.maxCalls})`);
    if (this.limits.maxOutputTokens !== undefined && this.outputTokens + requestedOutputTokens > this.limits.maxOutputTokens) throw new BudgetExceededError(`model output token limit reached (${this.limits.maxOutputTokens})`);
  }

  record(response: ModelResponse, role: ModelRole): UsageRecord {
    this.calls += 1;
    this.spentUsd += response.usage.costUsd;
    this.outputTokens += response.usage.outputTokens;
    const record: UsageRecord = { ...response.usage, provider: response.provider, model: response.model, role, recordedAt: this.clock() };
    this.records.push(record);
    if (this.spentUsd > this.budgetUsd) throw new BudgetExceededError(`model response exceeded budget (${this.budgetUsd.toFixed(4)} USD)`);
    return { ...record };
  }

  recordFailure(role: ModelRole): void {
    this.calls += 1;
    this.failures.push({ role, recordedAt: this.clock() });
  }

  get spent(): number { return this.spentUsd; }
  list(): UsageRecord[] { return this.records.map((record) => ({ ...record })); }

  summary(): UsageSummary {
    const byRole: UsageSummary['byRole'] = {};
    const bucket = (role: ModelRole) => (byRole[role] ??= { calls: 0, failedCalls: 0, outputTokens: 0, costUsd: 0 });
    for (const record of this.records) {
      const entry = bucket(record.role);
      entry.calls += 1;
      entry.outputTokens += record.outputTokens;
      entry.costUsd += record.costUsd;
    }
    for (const failure of this.failures) {
      const entry = bucket(failure.role);
      entry.calls += 1;
      entry.failedCalls += 1;
    }
    return {
      calls: this.calls, failedCalls: this.failures.length,
      inputTokens: this.records.reduce((sum, record) => sum + record.inputTokens, 0),
      outputTokens: this.outputTokens, costUsd: this.spentUsd,
      costKnown: this.records.every((record) => record.costUsd > 0 || record.inputTokens + record.outputTokens === 0),
      byRole, limits: { budgetUsd: this.budgetUsd, ...this.limits },
    };
  }
}

export class ModelGateway {
  private readonly adapters: Map<string, ModelAdapter>;
  private readonly ledger: UsageLedger;

  constructor(adapters: Map<string, ModelAdapter>, ledger: UsageLedger) {
    this.adapters = adapters;
    this.ledger = ledger;
  }

  async complete(request: ModelRequest, provider: string, credential: ModelCredential): Promise<ModelResponse> {
    this.ledger.reserve(request.estimatedCostUsd ?? 0, request.maxOutputTokens ?? 0);
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new Error(`unknown model provider: ${provider}`);
    let response: ModelResponse;
    try {
      response = await adapter.complete(request, credential);
    } catch (error) {
      this.ledger.recordFailure(request.role);
      throw error;
    }
    this.ledger.record(response, request.role);
    return response;
  }

  usage(): UsageRecord[] { return this.ledger.list(); }
  summary(): UsageSummary { return this.ledger.summary(); }
}

export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly provider = 'openai-compatible';
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(fetcher: typeof fetch = fetch, timeoutMs = 60_000) {
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Streams the completion. `timeoutMs` is an idle limit: it restarts on every
   * chunk, so a long answer that keeps arriving is never cut off. Endpoints that
   * ignore `stream` and answer with plain JSON are still accepted.
   */
  async complete(request: ModelRequest, credential: ModelCredential): Promise<ModelResponse> {
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), this.timeoutMs);
    };
    const timedOut = () => new ModelTimeoutError(`model produced no output for ${this.timeoutMs}ms`);
    try {
      let response: Response;
      try {
        response = await this.fetcher(`${credential.endpoint.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${credential.apiKey}` },
          body: JSON.stringify({ model: request.model, messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }], temperature: request.temperature, max_tokens: request.maxOutputTokens, response_format: request.responseFormat === 'json' ? { type: 'json_object' } : undefined, stream: true }),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw timedOut();
        throw error;
      }
      touch();
      if (!response.ok) throw new Error(`openai-compatible request failed (${response.status}): ${safeErrorMessage(await readJson(response))}`);
      const streamed = (response.headers.get('content-type') ?? '').includes('text/event-stream') && response.body;
      if (!streamed) {
        const body = await readJson(response);
        const text = body?.choices?.[0]?.message?.content;
        if (typeof text !== 'string') throw new Error('openai-compatible response has no message content');
        return { text, usage: normalizeUsage(body?.usage), provider: this.provider, model: request.model, requestId: typeof body?.id === 'string' ? body.id : undefined };
      }
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      let usage: unknown;
      let requestId: string | undefined;
      const consume = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        let chunk: any;
        try { chunk = JSON.parse(payload); } catch { return; }
        if (chunk?.error) throw new Error(`openai-compatible request failed (stream): ${safeErrorMessage(chunk)}`);
        const piece = chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content;
        if (typeof piece === 'string') text += piece;
        if (chunk?.usage) usage = chunk.usage;
        if (typeof chunk?.id === 'string') requestId = chunk.id;
      };
      for (;;) {
        let read: ReadableStreamReadResult<Uint8Array>;
        try {
          read = await reader.read();
        } catch (error) {
          if (controller.signal.aborted) throw timedOut();
          throw error;
        }
        if (read.done) break;
        touch();
        buffer += decoder.decode(read.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) consume(line);
      }
      consume(buffer + decoder.decode());
      if (!text) throw new Error('openai-compatible response has no message content');
      return { text, usage: normalizeUsage(usage), provider: this.provider, model: request.model, requestId };
    } finally {
      clearTimeout(timer);
    }
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

/** Overload, rate limiting, server errors, timeouts and dropped connections; another channel may succeed. */
export function isRetryableModelError(error: unknown): boolean {
  if (error instanceof ModelTimeoutError) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message;
  if (/request failed \((429|5\d\d)\)/.test(message)) return true;
  if (/overload|rate limit|too many requests|try again later|temporarily unavailable|capacity/i.test(message)) return true;
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|terminated/i.test(`${message} ${String((error as { cause?: unknown }).cause ?? '')}`);
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
