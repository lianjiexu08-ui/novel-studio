import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = (process.env.NOVEL_API_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const token = process.env.API_TOKEN ?? '';
const title = process.env.NOVEL_MILESTONE_TITLE ?? `玄幻长篇验收-${new Date().toISOString().slice(0, 10)}`;
const existingWorkId = process.env.NOVEL_MILESTONE_WORK_ID;
const configuredRunId = process.env.NOVEL_MILESTONE_RUN_ID;
const configuredExpansionRunId = process.env.NOVEL_MILESTONE_EXPANSION_RUN_ID;
const pollMs = Number(process.env.NOVEL_MILESTONE_POLL_MS ?? 5000);
const maxPolls = Number(process.env.NOVEL_MILESTONE_MAX_POLLS ?? 720);
const expandToFullBook = process.env.NOVEL_MILESTONE_EXPAND === 'true';

const covenant = {
  entryMode: 'expand',
  genre: 'xuanhuan',
  substyle: '宗门成长、群像、秘境探索',
  audience: '喜欢长篇玄幻、世界观考据和人物成长的读者',
  hook: '主角以记忆和寿命为代价借用禁忌力量，逐步揭开诸界战争的真相',
  mustKeep: '力量有代价，人物关系会因选择改变，所有伏笔最终可追踪',
  lockedNotes: '',
  avoid: '无代价升级、突然出现的万能设定、没有铺垫的反转',
  targetLength: '先完成三卷100章验收，再扩展到约450章百万字',
  chapterWords: 2200,
  updateCadence: '日更',
};

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path} failed (${response.status}): ${payload?.error?.message ?? 'unknown error'}`);
  return payload;
}

const work = existingWorkId
  ? await api(`/works/${existingWorkId}`)
  : await api('/works', { method: 'POST', body: { title, covenant } });
console.log(`${existingWorkId ? 'resuming' : 'created'} work ${work.id}: ${work.title}`);
async function waitForRun(targetChapter, started) {
  let checkpoint;
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    const state = await api(`/works/${work.id}/runs`);
    checkpoint = state.checkpoints.find((item) => item.runId === started.runId);
    if (!checkpoint) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      continue;
    }
    if (attempt === 1 || attempt % 6 === 0 || checkpoint.phase === 'paused' || checkpoint.phase === 'complete') {
      console.log(`poll ${attempt}: phase=${checkpoint.phase} nextChapter=${checkpoint.nextChapter}/${checkpoint.targetChapter}${checkpoint.error ? ` error=${checkpoint.error}` : ''}`);
    }
    if (checkpoint.phase === 'paused') throw new Error(`milestone paused at chapter ${checkpoint.nextChapter}: ${checkpoint.error ?? 'unknown error'}`);
    if (checkpoint.phase === 'complete' && checkpoint.nextChapter === targetChapter + 1) return checkpoint;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`milestone did not finish after ${maxPolls} polls`);
}

async function finalizeAndExport(label) {
  const finalized = await api(`/works/${work.id}/manuscripts/finalize`, { method: 'POST', body: {} });
  const exported = await api(`/works/${work.id}/manuscripts/${finalized.manuscript.id}/export`);
  if (!exported.closureCoverage?.ready) throw new Error(`${label} manuscript has unresolved closure coverage`);
  await mkdir('data', { recursive: true });
  const output = `data/model-milestone-${label}-${work.id}.json`;
  await writeFile(output, `${JSON.stringify(exported, null, 2)}\n`);
  console.log(`frozen manuscript ${finalized.manuscript.id} with ${finalized.manuscript.chapterCount} chapters, ${finalized.manuscript.wordCount}/${finalized.manuscript.targetWordCount} words (${Math.round(finalized.manuscript.lengthCoverage * 100)}%)`);
  console.log(`exported ${output}`);
}

const started = await api(`/works/${work.id}/milestones/100/start`, { method: 'POST', body: configuredRunId ? { runId: configuredRunId } : {} });
console.log(`started 100-chapter run ${started.runId}; world=${started.milestone.worldPack?.id ?? 'missing'} bible=${started.milestone.storyBible?.id ?? 'missing'}`);
await waitForRun(100, started);
await finalizeAndExport('100');

if (expandToFullBook) {
  const expanded = await api(`/works/${work.id}/milestones/450/start`, { method: 'POST', body: configuredExpansionRunId ? { runId: configuredExpansionRunId } : {} });
  console.log(`started 450-chapter expansion ${expanded.runId}; bible=${expanded.milestone.storyBible?.id ?? 'missing'}`);
  await waitForRun(450, expanded);
  await finalizeAndExport('450');
}
