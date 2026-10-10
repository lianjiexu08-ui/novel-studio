import { useEffect, useMemo, useState } from 'react';
import { App as AntApp, Button, Segmented } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { HotTopic } from 'novel-studio-contracts';
import { api, ApiRequestError } from '../api';
import { COVENANT_DEFAULTS, toCovenant, type CovenantFormValues } from '../covenant';
import { findFlow, genreLabel, GENRES, type SubGenre } from '../genres';
import { CovenantForm } from './CovenantForm';

const EMPTY: CovenantFormValues = {
  title: '',
  ...COVENANT_DEFAULTS,
};

export function CreateWorkPage() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [category, setCategory] = useState(GENRES[0].name);
  const [picked, setPicked] = useState<string | null>(null);
  const [hot, setHot] = useState<HotTopic[]>([]);
  const [hotState, setHotState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [draft, setDraft] = useState<CovenantFormValues>(EMPTY);
  const [formKey, setFormKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  async function loadHot() {
    setHotState('loading');
    try {
      const result = await api.hotTopics('');
      setHot(result.topics);
      setHotState(result.topics.length ? 'ready' : 'failed');
    } catch {
      setHotState('failed');
    }
  }

  useEffect(() => { void loadHot(); }, []);

  const hotFlows = useMemo(() => {
    const names = new Map<string, HotTopic>();
    for (const topic of hot) {
      const match = findFlow(topic.title);
      if (match && !names.has(match.flow.name)) names.set(match.flow.name, topic);
    }
    return names;
  }, [hot]);

  const hotCategories = useMemo(() => new Set(GENRES.filter((item) => item.flows.some((flow) => hotFlows.has(flow.name))).map((item) => item.name)), [hotFlows]);
  const current = GENRES.find((item) => item.name === category) ?? GENRES[0];

  function pick(categoryName: string, flow: SubGenre) {
    const label = genreLabel(categoryName, flow.name);
    setPicked(label);
    setDraft((previous) => ({
      ...EMPTY,
      title: previous.title,
      substyle: label,
      audience: flow.audience,
      hook: flow.hook,
      protagonistGoal: flow.protagonistGoal,
      obstacle: flow.obstacle,
      readingExperience: flow.readingExperience,
    }));
    setFormKey((key) => key + 1);
    message.success(`已选「${label}」。下面是这个流派的草稿，改成你自己的故事再保存。`);
    window.setTimeout(() => document.getElementById('new-work-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  }

  function jumpTo(theme: string) {
    const match = findFlow(theme);
    if (!match) return;
    setCategory(match.category.name);
    pick(match.category.name, match.flow);
  }

  async function submit(values: CovenantFormValues) {
    setSubmitting(true);
    try {
      const work = await api.createWork({ title: values.title.trim(), covenant: toCovenant(values) });
      message.success('创作约定已保存');
      navigate(`/works/${work.id}/overview`);
    } catch (error) {
      message.error(error instanceof ApiRequestError ? `[${error.code}] ${error.message}` : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  const hotList = [...hotFlows.keys()];

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">开书</p>
          <h1 className="page-title">创作新作品</h1>
          <p className="page-desc">先选大类，再选具体流派。选中后会给一份这个流派的约定草稿，书名和细节由你来定。</p>
        </div>
      </header>

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2 className="panel-title">选题材流派</h2>
            <p className="panel-note">
              {hotState === 'loading' && '正在看网文讨论里哪些流派在热…'}
              {hotState === 'ready' && (hotList.length ? `网文讨论里正在热：${hotList.join('、')}。带「热」的就是。` : '网文讨论里提到的题材暂时没有对上下面的流派。')}
              {hotState === 'failed' && '这次没取到网文热度，流派仍然可以直接选。'}
            </p>
          </div>
          <Button size="small" onClick={() => void loadHot()} loading={hotState === 'loading'}>刷新热度</Button>
        </header>

        {hotList.length > 0 && (
          <div className="hot-chips">
            {hotList.map((name) => (
              <button key={name} type="button" className="hot-chip" onClick={() => jumpTo(name)}>🔥 {name}</button>
            ))}
          </div>
        )}

        <Segmented
          block
          value={category}
          onChange={(value) => setCategory(String(value))}
          options={GENRES.map((item) => ({ value: item.name, label: hotCategories.has(item.name) ? `${item.name} · 热` : item.name }))}
        />

        <div className="topic-list">
          {current.flows.map((flow) => {
            const label = genreLabel(current.name, flow.name);
            const heat = hotFlows.get(flow.name);
            return (
              <button key={flow.name} type="button" className={picked === label ? 'topic-card is-selected' : 'topic-card'} onClick={() => pick(current.name, flow)}>
                <span className="topic-card-head">
                  <span className="topic-card-title">{flow.name}</span>
                  {heat && <span className="tag tag-gold" title={heat.source}>热{heat.heat ? ` · ${heat.heat}` : ''}</span>}
                </span>
                <span className="topic-card-summary">{flow.pitch}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="panel" id="new-work-form">
        {picked && <p className="panel-note" style={{ marginBottom: 16 }}>已选「{picked}」。钩子、目标、阻碍都是这个流派的通用写法，换成你自己的设定会更好。书名请自己起。</p>}
        <CovenantForm key={formKey} initialValues={draft} submitText="保存约定并进入作品" submitting={submitting} onSubmit={submit} />
      </div>
    </section>
  );
}
