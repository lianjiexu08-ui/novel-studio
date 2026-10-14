import type { BookPlanContract, StoryBibleContract, WorldPackContract } from 'novel-studio-contracts';
export interface DesignBundle { worldPack: WorldPackContract; storyBible: StoryBibleContract; plan: BookPlanContract }
export interface DesignEditingBaseline { basePlanId: string; expectedInputHash: string; candidate: DesignBundle }
export interface DesignDraft { baseline: DesignEditingBaseline; candidate: DesignBundle }
type Path = Array<string | number>;
export interface RevisionField { path: Path; label: string; value: string | string[] }
export const documentLabels = { worldPack: '世界与力量', storyBible: '人物与故事线', plan: '全书与章纲' };
export const fieldLabels: Record<string, string> = {
  title: '标题', name: '名称', summary: '摘要', content: '规则内容', source: '来源', scope: '适用范围', unit: '计量单位', rule: '等级规则', levels: '等级序列',
  axioms: '世界规则', powerSystems: '力量来源', tierLadders: '等级阶梯', realms: '境界', techniques: '功法与秘术', artifacts: '法宝', resources: '资源', locations: '大陆与地点', factions: '势力', historicalEvents: '历史事件', terminology: '术语', unresolvedQuestions: '待解决问题',
  prerequisites: '晋阶前提', capabilities: '能力', effect: '效果', cost: '代价', limitations: '限制', counters: '反制', tier: '品阶', scarcity: '稀缺度', usage: '使用方式', requirements: '使用条件', entryConditions: '入口条件', goals: '目标', storyTime: '故事时间', causes: '起因', consequences: '后果', canonical: '规范名称', aliases: '别名', question: '待解决问题',
  coreConflict: '核心冲突', endingDirection: '结局方向', characters: '人物', relationships: '人物关系', secrets: '秘密与认知', arcs: '人物弧光', arcBeats: '弧光节点', promises: '承诺', openThreads: '故事线', volumes: '分卷', chapterPlans: '逐章故事计划',
  goal: '目标', identity: '身份与经历', value: '关系状态', cause: '变化原因', stages: '关系阶段', knowledgeStages: '认知阶段', belief: '当前认知', trigger: '触发条件', consequence: '后续影响', forbiddenInferences: '不可提前知道的内容', truth: '秘密真相', revealCondition: '揭示条件', expectedChange: '预期变化', promise: '承诺内容', payoffCondition: '兑现条件', plannedResolution: '计划收束', stakes: '风险与代价', plannedOutcome: '计划结果', climax: '高潮', endState: '结束状态', purpose: '本章目的', conflict: '冲突', turningPoint: '转折', endHook: '章末钩子', requiredEvents: '必须发生的事件',
  mainConflict: '主线冲突', theme: '主题', protagonistArc: '主角弧光', keyTurns: '关键转折', chapters: '章节细纲', milestones: '阶段里程碑', dependencies: '前置依赖', openQuestions: '待解决问题', opposition: '对抗力量', carryOver: '留到下一卷', characterGoals: '人物目标', choice: '选择', threads: '关联故事线', location: '地点', scenes: '场景', setup: '铺垫与前提', outcome: '结果', description: '前置要求',
};
// This editor revises prose fields. Identity, links, timing ranges and approval
// metadata remain intact; changing structure still uses its dedicated workflow.
const excluded = new Set(['id', 'revision', 'createdAt', 'lockedAt', 'status', 'kind', 'role', 'certainty', 'lockPolicy', 'requiredness', 'eventType', 'subjectId', 'predicate', 'equals', 'threads', 'requiredEvents']);
const textLists = new Set(['keyTurns', 'levels', 'prerequisites', 'capabilities', 'limitations', 'counters', 'requirements', 'entryConditions', 'goals', 'resources', 'causes', 'consequences', 'aliases', 'forbiddenInferences', 'requiredEvents', 'threads', 'scenes', 'setup']);
export function revisionFields(value: unknown, path: Path = [], prefix = ''): RevisionField[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]): RevisionField[] => {
    if (excluded.has(key) || /Ids?$/.test(key) || (key === 'source' && path[0] === 'plan') || (key === 'resources' && path.includes('factions'))) return [];
    const next = [...path, key], label = [prefix, fieldLabels[key] ?? key].filter(Boolean).join(' · ');
    if (typeof child === 'string') return [{ path: next, label, value: child }];
    if (Array.isArray(child)) {
      if (child.every(item => typeof item === 'string') && (child.length > 0 || textLists.has(key))) return [{ path: next, label, value: child }];
      return child.flatMap((item, index) => revisionFields(item, [...next, index], `${label} · ${recordLabel(item, index)}`));
    }
    return revisionFields(child, next, label);
  });
}
function recordLabel(value: unknown, index: number): string {
  const item = value as Record<string, unknown>;
  if (item.chapterNumber) return `第 ${item.chapterNumber} 章 · ${item.title ?? ''}`;
  if (item.sinceChapter) return `第 ${item.sinceChapter}–${item.untilChapter ?? '后续'} 章`;
  return String(item.name ?? item.title ?? item.canonical ?? `条目 ${index + 1}`);
}
export function revisionSections(bundle: DesignBundle) {
  return (Object.keys(documentLabels) as Array<keyof DesignBundle>).flatMap(document => {
    const value = bundle[document];
    const sections: Array<{ key: string; label: string; fields: RevisionField[] }> = [{ key: document, label: `${documentLabels[document]} · 总览`, fields: revisionFields(Object.fromEntries(Object.entries(value).filter(([key, child]) => !Array.isArray(child) || child.every(item => typeof item === 'string') && (child.length > 0 || textLists.has(key)))), [document]) }];
    for (const [key, rows] of Object.entries(value)) {
      if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object') continue;
      rows.forEach((row, index) => {
        let label = recordLabel(row, index);
        if (document === 'storyBible' && key === 'relationships') {
          const name = (id: string) => bundle.storyBible.characters.find(c => c.id === id)?.name ?? id;
          label = `${name(row.fromCharacterId)} → ${name(row.toCharacterId)}`;
        }
        sections.push({ key: `${document}/${key}/${index}`, label: `${documentLabels[document]} · ${fieldLabels[key] ?? key} · ${label}`, fields: revisionFields(row, [document, key, index]) });
      });
    }
    return sections.filter(section => section.fields.length);
  });
}
export function replaceRevisionField(bundle: DesignBundle, path: Path, value: string | string[]): DesignBundle {
  const allowed = revisionSections(bundle).flatMap(section => section.fields).find(field => JSON.stringify(field.path) === JSON.stringify(path));
  if (!allowed || Array.isArray(allowed.value) !== Array.isArray(value)) throw new Error('该项不是可修订的文本字段');
  const clone = structuredClone(bundle);
  let parent: any = clone;
  for (const key of path.slice(0, -1)) parent = parent[key];
  parent[path.at(-1)!] = structuredClone(value);
  return clone;
}
export function revisionChanges(before: DesignBundle, after: DesignBundle) {
  const previous = new Map(revisionSections(before).flatMap(section => section.fields.map(field => [JSON.stringify(field.path), field.value] as const)));
  return revisionSections(after).flatMap(section => section.fields.filter(field => JSON.stringify(previous.get(JSON.stringify(field.path))) !== JSON.stringify(field.value)).map(field => ({ ...field, section: section.label, before: previous.get(JSON.stringify(field.path))! })));
}

async function draftStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('novel-studio-design-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('drafts', mode), request = action(tx.objectStore('drafts'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? request.error ?? new Error('草稿保存失败'));
    });
  } finally { db.close(); }
}
let writes: Promise<unknown> = Promise.resolve();
function queueDraftWrite<T>(action: () => Promise<T>): Promise<T> {
  const next = writes.catch(() => undefined).then(action);
  writes = next;
  return next;
}
export const readDesignDraft = async (workId: string) => { await writes.catch(() => undefined); return draftStore<DesignDraft | undefined>('readonly', store => store.get(workId)); };
export const writeDesignDraft = (workId: string, draft: DesignDraft) => queueDraftWrite(() => draftStore('readwrite', store => store.put(draft, workId)));
export const removeDesignDraft = (workId: string) => queueDraftWrite(() => draftStore('readwrite', store => store.delete(workId)));
