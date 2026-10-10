import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { redactSecrets } from '../../../packages/model-gateway/src/index.ts';
import { FailoverPlanningClient, JsonBookPlanner, JsonDesignPlanner, OpenAICompatibleChapterProvider, OpenAICompatiblePlanningClient } from '../../../packages/planner/src/index.ts';
import type { UsageLedger } from '../../../packages/model-gateway/src/index.ts';
import type { ModelProvider } from '../../../novel-service-core/src/core.ts';
import type { DesignProvider, PlanProvider } from '../../../packages/application/src/index.ts';

/** Machine-local model connection. The key lives only in this file and in process memory. */
export interface ModelConnection {
  endpoint: string;
  apiKey: string;
  planningModel: string;
  writingModel: string;
  timeoutMs: number;
  independentExtraction: boolean;
  source: 'saved' | 'environment' | 'none';
  /** Channel name, used only in failover logs. */
  name?: string;
}

export interface ModelChannel {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  planningModel: string;
  writingModel: string;
  timeoutMs: number;
  independentExtraction: boolean;
  /** Tried in list order when the active channel is overloaded, rate limited or times out. */
  fallback: boolean;
}

/** Every saved channel stays on disk. Only `activeId` is wired into planning and writing. */
export interface ModelStore {
  activeId?: string;
  channels: ModelChannel[];
  source: 'saved' | 'environment' | 'none';
}

export interface ModelChannelView {
  id: string;
  name: string;
  endpoint: string;
  hasApiKey: boolean;
  apiKeyHint: string;
  planningModel: string;
  writingModel: string;
  timeoutMs: number;
  independentExtraction: boolean;
  fallback: boolean;
}

export interface ModelSettingsView {
  configured: boolean;
  planningConfigured: boolean;
  source: ModelStore['source'];
  activeId?: string;
  channels: ModelChannelView[];
  storedAt: string;
  savedId?: string;
}

export const newModelChannelId = () => `channel_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

export function activeChannel(store: ModelStore): ModelChannel | undefined {
  return store.channels.find((channel) => channel.id === store.activeId);
}

export function connectionOf(channel: ModelChannel | undefined, source: ModelStore['source']): ModelConnection {
  if (!channel) {
    return { endpoint: '', apiKey: '', planningModel: '', writingModel: '', timeoutMs: 180_000, independentExtraction: true, source: 'none' };
  }
  return {
    endpoint: channel.endpoint, apiKey: channel.apiKey, planningModel: channel.planningModel, writingModel: channel.writingModel,
    timeoutMs: channel.timeoutMs, independentExtraction: channel.independentExtraction, source, name: channel.name,
  };
}

function hostLabel(endpoint: string): string {
  try { return new URL(endpoint).host; } catch { return ''; }
}

function asChannel(raw: Partial<ModelChannel>, fallbackName: string): ModelChannel {
  const endpoint = String(raw.endpoint ?? '').trim();
  return {
    id: String(raw.id || newModelChannelId()),
    name: String(raw.name || hostLabel(endpoint) || fallbackName).trim() || fallbackName,
    endpoint,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    planningModel: String(raw.planningModel ?? '').trim(),
    writingModel: String(raw.writingModel ?? '').trim(),
    timeoutMs: Number(raw.timeoutMs) || 180_000,
    independentExtraction: raw.independentExtraction !== false,
    fallback: raw.fallback !== false,
  };
}

const STORED_AT = 'data/model-settings.json';

export function connectionFromEnvironment(): ModelConnection {
  const endpoint = process.env.NOVEL_MODEL_ENDPOINT?.trim() ?? '';
  const apiKey = process.env.NOVEL_MODEL_API_KEY ?? '';
  const planningModel = process.env.NOVEL_PLANNING_MODEL?.trim() ?? '';
  const writingModel = process.env.NOVEL_WRITING_MODEL?.trim() ?? '';
  const timeoutMs = Number(process.env.NOVEL_MODEL_TIMEOUT_MS ?? 180_000);
  const present = Boolean(endpoint || apiKey || planningModel || writingModel);
  return {
    endpoint, apiKey, planningModel, writingModel,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 180_000,
    independentExtraction: process.env.NOVEL_INDEPENDENT_EXTRACTION !== 'false',
    source: present ? 'environment' : 'none',
  };
}

export function loadModelStore(filePath: string): ModelStore {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<ModelStore> & Partial<ModelChannel>;
    if (Array.isArray(parsed.channels)) {
      const channels = parsed.channels.map((channel) => asChannel(channel, '未命名渠道'));
      const activeId = channels.some((channel) => channel.id === parsed.activeId) ? parsed.activeId : channels[0]?.id;
      return { source: 'saved', activeId, channels };
    }
    if (parsed.endpoint || parsed.apiKey || parsed.planningModel || parsed.writingModel) {
      const channel = asChannel(parsed, '默认渠道');
      return { source: 'saved', activeId: channel.id, channels: [channel] };
    }
    return { source: 'none', channels: [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const env = connectionFromEnvironment();
    if (env.source === 'none') return { source: 'none', channels: [] };
    const channel = asChannel({ ...env, name: hostLabel(env.endpoint) || '环境变量' }, '环境变量');
    return { source: 'environment', activeId: channel.id, channels: [channel] };
  }
}

export function saveModelStore(filePath: string, store: ModelStore, updateEnvironment = true): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const stored = {
    activeId: store.activeId,
    channels: store.channels.map(({ id, name, endpoint, apiKey, planningModel, writingModel, timeoutMs, independentExtraction, fallback }) => ({
      id, name, endpoint, apiKey, planningModel, writingModel, timeoutMs, independentExtraction, fallback,
    })),
  };
  writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (!updateEnvironment) return;
  const active = connectionOf(activeChannel({ ...store, source: 'saved' }), 'saved');
  process.env.NOVEL_MODEL_ENDPOINT = active.endpoint;
  process.env.NOVEL_MODEL_API_KEY = active.apiKey;
  process.env.NOVEL_PLANNING_MODEL = active.planningModel;
  process.env.NOVEL_WRITING_MODEL = active.writingModel;
  process.env.NOVEL_MODEL_TIMEOUT_MS = String(active.timeoutMs);
  process.env.NOVEL_INDEPENDENT_EXTRACTION = String(active.independentExtraction);
}

export function upsertChannel(store: ModelStore, channel: ModelChannel, activate: boolean): ModelStore {
  const exists = store.channels.some((item) => item.id === channel.id);
  const channels = exists ? store.channels.map((item) => (item.id === channel.id ? channel : item)) : [...store.channels, channel];
  const activeId = activate || !store.activeId ? channel.id : store.activeId;
  return { source: 'saved', activeId, channels };
}

export function removeChannel(store: ModelStore, channelIdToRemove: string): ModelStore {
  const channels = store.channels.filter((channel) => channel.id !== channelIdToRemove);
  const activeId = store.activeId === channelIdToRemove ? channels[0]?.id : store.activeId;
  return { source: 'saved', activeId, channels };
}

function channelView(channel: ModelChannel): ModelChannelView {
  return {
    id: channel.id, name: channel.name, endpoint: channel.endpoint,
    hasApiKey: channel.apiKey.length > 0,
    apiKeyHint: channel.apiKey.length >= 8 ? channel.apiKey.slice(-4) : '',
    planningModel: channel.planningModel, writingModel: channel.writingModel,
    timeoutMs: channel.timeoutMs, independentExtraction: channel.independentExtraction, fallback: channel.fallback,
  };
}

/** Saved backups, in list order, that have enough to answer a request. */
export function backupConnections(store: ModelStore): ModelConnection[] {
  return store.channels
    .filter((channel) => channel.id !== store.activeId && channel.fallback && channel.endpoint && channel.apiKey && (channel.planningModel || channel.writingModel))
    .map((channel) => connectionOf(channel, 'saved'));
}

export function toModelSettingsView(store: ModelStore, providers: { configured: boolean; planningConfigured: boolean }, savedId?: string): ModelSettingsView {
  return {
    configured: providers.configured,
    planningConfigured: providers.planningConfigured,
    source: store.source,
    activeId: store.activeId,
    channels: store.channels.map(channelView),
    storedAt: STORED_AT,
    savedId,
  };
}

export function providersFromConnection(connection: ModelConnection, ledger: UsageLedger, backups: ModelConnection[] = []): {
  provider: ModelProvider;
  designProvider?: DesignProvider;
  planProvider?: PlanProvider;
  configured: boolean;
  planningConfigured: boolean;
} {
  const writingModel = connection.writingModel || connection.planningModel;
  const configured = Boolean(connection.endpoint && connection.apiKey && writingModel);
  const planningConfigured = Boolean(connection.endpoint && connection.apiKey && connection.planningModel);
  if (!configured) {
    return {
      configured, planningConfigured,
      provider: {
        demo: true,
        generateChapter: ({ chapterNumber, context }) => {
          const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: chapterNumber + context.includedEventIds.length, storyTime: chapterNumber, evidence: 'paragraph 1' };
          return { content: `第${chapterNumber}章：主角踏入新的修行阶段。`, proposedEvents: [event], observedEvents: [event] };
        },
      },
    };
  }
  const chain = (role: 'planning' | 'writing') => {
    const members = [connection, ...backups].map((item) => {
      const model = role === 'planning' ? item.planningModel || item.writingModel : item.writingModel || item.planningModel;
      return { name: item.name || hostOf(item.endpoint), client: new OpenAICompatiblePlanningClient(item.endpoint, item.apiKey, model, ledger, item.timeoutMs) };
    });
    return new FailoverPlanningClient(members, (from, to, error) => {
      console.warn(`[model] ${role} channel "${from}" failed (${String(redactSecrets(error instanceof Error ? error.message : error))}); trying "${to}"`);
    });
  };
  return {
    configured, planningConfigured,
    provider: new OpenAICompatibleChapterProvider(connection.endpoint, connection.apiKey, writingModel, ledger, connection.timeoutMs, connection.independentExtraction, chain('writing')),
    designProvider: planningConfigured ? new JsonDesignPlanner(chain('planning'), Number(process.env.NOVEL_PLANNING_CHAPTER_TARGET ?? 100)) : undefined,
    planProvider: planningConfigured ? new JsonBookPlanner(chain('planning')) : undefined,
  };
}

function hostOf(endpoint: string): string {
  try { return new URL(endpoint).host; } catch { return 'channel'; }
}

function apiRoot(endpoint: string): string {
  const base = endpoint.replace(/\/$/, '');
  return /\/v1$/i.test(base) ? base : `${base}/v1`;
}

async function providerFetch(url: string, apiKey: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      redirect: 'error',
      headers: { authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function failureText(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return '连接超时';
  return String(redactSecrets(error instanceof Error ? error.message : error));
}

/** Checks the key against the endpoint. Without a chosen model, listing models is enough to prove the channel works. */
export async function testModelConnection(connection: ModelConnection): Promise<{ ok: boolean; message: string }> {
  const model = connection.writingModel || connection.planningModel;
  if (!connection.endpoint || !connection.apiKey) return { ok: false, message: '先填写接口地址和密钥' };
  if (!model) {
    try {
      const ids = await listModelIds(connection);
      return { ok: true, message: ids.length ? `已连通，接口有 ${ids.length} 个模型。拉取列表后即可选择。` : '已连通，但接口没有返回模型列表' };
    } catch (error) {
      return { ok: false, message: failureText(error) };
    }
  }
  try {
    const response = await providerFetch(`${apiRoot(connection.endpoint)}/chat/completions`, connection.apiKey, connection.timeoutMs, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: '回复 OK' }], max_tokens: 8, temperature: 0 }),
    });
    const body = await response.json().catch(() => ({})) as { error?: { message?: string }; choices?: Array<{ message?: { content?: string } }> };
    if (!response.ok) return { ok: false, message: `接口返回 ${response.status}：${String(redactSecrets(body.error?.message ?? '调用失败'))}` };
    const text = body.choices?.[0]?.message?.content?.trim();
    return { ok: true, message: text ? `已连通，模型回复：${text.slice(0, 80)}` : '已连通' };
  } catch (error) {
    return { ok: false, message: failureText(error) };
  }
}

export async function listModelIds(connection: ModelConnection): Promise<string[]> {
  if (!connection.endpoint || !connection.apiKey) throw new Error('先填写接口地址和密钥');
  const response = await providerFetch(`${apiRoot(connection.endpoint)}/models`, connection.apiKey, Math.min(connection.timeoutMs, 20_000));
  const body = await response.json().catch(() => ({})) as { error?: { message?: string }; data?: Array<{ id?: string }> };
  if (!response.ok) throw new Error(`接口返回 ${response.status}：${String(redactSecrets(body.error?.message ?? '拉取模型失败'))}`);
  return (body.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id)).sort((a, b) => a.localeCompare(b));
}
