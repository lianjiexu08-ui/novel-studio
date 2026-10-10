import { useCallback, useEffect, useState } from 'react';
import { App as AntApp, Button, Empty, Form, Input, InputNumber, Table } from 'antd';
import { ApiOutlined, ExperimentOutlined, RocketOutlined } from '@ant-design/icons';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api, ApiRequestError, type NextChapterDto } from '../api';
import { EditorModal } from './EditorModal';
import { covenantReady } from '../covenant';
import type { CandidateDto, ChapterReadinessDto, OutboxEventDto } from 'novel-studio-contracts';
import type { WorkspaceContext } from './Workspace';

const OUTBOX_LABELS: Record<string, string> = {
  projection: '状态投影',
  search_index: '检索索引',
  export: '导出',
  publication_check: '发布核验',
};

const CHECK_TAG: Record<string, string> = {
  passed: 'tag-ok',
  failed: 'tag-bad',
  inconclusive: 'tag-warn',
  unavailable: 'tag-mute',
};

const BLOCKER_ROUTE: Record<string, string> = {
  COVENANT_INCOMPLETE: 'covenant',
  CANON_NOT_READY: 'design',
  PLAN_NOT_APPROVED: 'plan',
  PLAN_OUTDATED: 'plan',
  PLAN_OUTLINE_MISSING: 'plan',
  PLAN_PREREQUISITE_UNMET: 'plan',
};

type BriefForm = { pov?: string; location?: string; storyTime?: string; mustDoText?: string; mustNotHappenText?: string; endState?: string };
const lines = (value?: string) => (value ?? '').split('\n').map((item) => item.trim()).filter(Boolean);

function NextChapterPanel({ next, onConfirm }: { next: NextChapterDto; onConfirm: () => void }) {
  const current = next.brief?.brief;
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">
            准备第 {next.chapterNumber} 章
            {next.volume && <span className="tag tag-gold" style={{ marginLeft: 8 }}>{next.volume.title} · 第 {next.volume.startChapter}-{next.volume.endChapter} 章</span>}
            {current && (current.status === 'author_confirmed'
              ? <span className={`tag ${next.brief!.needsConfirmation ? 'tag-bad' : 'tag-ok'}`} style={{ marginLeft: 6 }}>{next.brief!.needsConfirmation ? '任务卡需重新确认' : '你已确认'}</span>
              : <span className="tag tag-mute" style={{ marginLeft: 6 }}>按章纲推导</span>)}
          </h2>
          <p className="panel-note">任务卡由已批准的章纲和已采用的事实推导；前置是否满足只看采用稿，不能手动勾选。</p>
        </div>
        {current && <Button onClick={onConfirm}>{current.status === 'author_confirmed' ? '修改并重新确认' : '确认任务卡'}</Button>}
      </div>
      {!current ? (
        <p className="panel-note">没有可用的任务卡：先在「全书计划」里批准一版带第 {next.chapterNumber} 章章纲的计划。</p>
      ) : (
        <div className="setting-list">
          <div className="check-row"><span className="toc-meta">视角 / 人物</span><span>{current.pov || '—'}{current.characters.length > 0 && ` ｜ ${current.characters.join('、')}`}</span></div>
          {(current.location || current.storyTime) && <div className="check-row"><span className="toc-meta">地点 / 时间</span><span>{current.location || '—'} ｜ {current.storyTime || '—'}</span></div>}
          <div className="check-row"><span className="toc-meta">本章必须</span><span>{current.mustDo.map((item) => <div key={item}>{item}</div>)}</span></div>
          {current.mustNotHappen.length > 0 && <div className="check-row"><span className="toc-meta">不能发生</span><span>{current.mustNotHappen.map((item) => <div key={item}>{item}</div>)}</span></div>}
          <div className="check-row"><span className="toc-meta">结束状态</span><span>{current.endState}</span></div>
          {current.dependsOn.map((dependency) => (
            <div key={dependency.dependencyId} className="check-row">
              <span className={`tag ${dependency.satisfied ? 'tag-ok' : dependency.requiredness === 'must' ? 'tag-bad' : 'tag-warn'}`}>{dependency.satisfied ? '前置已满足' : dependency.requiredness === 'must' ? '前置未满足' : '可选前置'}</span>
              <span>{dependency.description}</span>
              {dependency.evidence && <span className="toc-meta">{dependency.evidence}</span>}
            </div>
          ))}
          {current.preserve.length > 0 && <div className="check-row"><span className="toc-meta">必须保留</span><span>{current.preserve.map((item) => <div key={item}>{item}</div>)}</span></div>}
        </div>
      )}
      {next.nextClimax && (
        <div className="check-row">
          <span className="tag tag-gold">下一个高潮</span>
          <span>第 {next.nextClimax.milestone.startChapter}-{next.nextClimax.milestone.endChapter} 章「{next.nextClimax.milestone.title}」</span>
          <span className="toc-meta">{next.nextClimax.missing.length ? `还缺：${next.nextClimax.missing.join('；')}` : '必需前置都已写出'}</span>
        </div>
      )}
    </div>
  );
}

export function WritePage() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const { work, refresh } = useOutletContext<WorkspaceContext>();
  const ready = covenantReady(work.covenant);
  const [chapterNumber, setChapterNumber] = useState(1);
  const [candidate, setCandidate] = useState<CandidateDto | null>(null);
  const [outbox, setOutbox] = useState<OutboxEventDto[]>([]);
  const [readiness, setReadiness] = useState<ChapterReadinessDto | null>(null);
  const [manuscriptId, setManuscriptId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [next, setNext] = useState<NextChapterDto | null>(null);
  const [confirming, setConfirming] = useState(false);

  const loadNext = useCallback(() => {
    api.nextChapter(work.id).then(setNext).catch(() => setNext(null));
  }, [work.id]);

  useEffect(() => { loadNext(); }, [loadNext, work.stateRevision, work.constraintRevision]);

  useEffect(() => {
    api.listChapters(work.id)
      .then((result) => {
        const adopted = new Set(result.chapters.filter((c) => c.status === 'adopted' && !c.stale).map((c) => c.chapterNumber));
        let next = 1;
        while (adopted.has(next)) next += 1;
        setChapterNumber(next);
      })
      .catch(() => {});
    api.outbox(work.id).then((result) => setOutbox(result.events)).catch(() => {});
  }, [work.id, work.stateRevision]);

  const loadReadiness = useCallback(() => {
    api.readiness(work.id, chapterNumber).then(setReadiness).catch(() => setReadiness(null));
  }, [work.id, chapterNumber]);

  useEffect(() => { loadReadiness(); }, [loadReadiness, work.stateRevision, work.constraintRevision]);

  async function run(step: string, action: () => Promise<void>, success?: string) {
    setBusy(step);
    try {
      await action();
      if (success) message.success(success);
    } catch (error) {
      if (error instanceof ApiRequestError) message.error(`[${error.code}] ${error.message}`);
      else message.error(String(error));
    } finally {
      setBusy(null);
    }
  }

  const candidateChecked = !!candidate?.checks.length;
  const candidatePassed = candidateChecked && candidate!.checks.every((c) => c.status === 'passed');
  const missingChecks = candidate && readiness ? readiness.requiredChecks.filter((name) => !candidate.checks.some((c) => c.checker === name)) : [];
  const adoptable = !!candidate && candidate.origin === 'model' && !candidate.stale && candidatePassed && missingChecks.length === 0;
  const activeStep = !candidate ? 1 : candidatePassed ? 3 : 2;
  const formalReady = readiness?.ready ?? false;

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">流水线</p>
          <h1 className="page-title">章节创作</h1>
          <p className="page-desc">
            {ready
              ? `对照约定写：${work.covenant.hook}。一次只写一章，候选稿不产生正式事实。`
              : '还没有创作约定。先写明读者承诺和核心吸引点，再生成章节。'}
          </p>
        </div>
      </header>

      {next && <NextChapterPanel next={next} onConfirm={() => setConfirming(true)} />}

      <div className="panel">
        <div className="pipeline">
          <div className={`pipeline-step${activeStep >= 1 ? ' is-on' : ''}`}>
            <span className="step-index">01</span>
            <span className="step-name">生成候选</span>
            <span className="step-hint">前面各章都已采用、设计已锁定、计划已批准才能正式生成</span>
          </div>
          <div className={`pipeline-step${activeStep >= 2 ? ' is-on' : ''}`}>
            <span className="step-index">02</span>
            <span className="step-name">运行检查</span>
            <span className="step-hint">必需检查缺一项或未通过都不能采用</span>
          </div>
          <div className={`pipeline-step${activeStep >= 3 ? ' is-on' : ''}`}>
            <span className="step-index">03</span>
            <span className="step-name">采用</span>
            <span className="step-hint">通过后写入章节，并触发派生任务</span>
          </div>
        </div>

        {readiness && !readiness.ready && (
          <div className="setting-list" style={{ marginBottom: 12 }}>
            {readiness.blockers.map((blocker) => (
              <div key={blocker.code} className="check-row">
                <span className="tag tag-bad">{blocker.code}</span>
                <span>{blocker.nextAction}</span>
                <span className="toc-meta">{blocker.message}</span>
                {BLOCKER_ROUTE[blocker.code] && <Button size="small" onClick={() => navigate(`/works/${work.id}/${BLOCKER_ROUTE[blocker.code]}`)}>去处理</Button>}
              </div>
            ))}
          </div>
        )}

        <div className="pipeline-actions">
          <span className="toc-meta">章节号</span>
          <InputNumber min={1} value={chapterNumber} onChange={(v) => { setChapterNumber(v ?? 1); setCandidate(null); }} />
          <Button type="primary" icon={<ApiOutlined />} disabled={!formalReady} loading={busy === 'generate'}
            onClick={() => run('generate', async () => {
              const result = await api.generate(work.id, chapterNumber);
              setCandidate(result.candidate);
            })}>生成候选</Button>
          <Button icon={<ExperimentOutlined />} disabled={!ready} loading={busy === 'demo'}
            onClick={() => run('demo', async () => {
              const result = await api.generate(work.id, chapterNumber, 'demo');
              setCandidate(result.candidate);
            })}>试写（不可采用）</Button>
          <Button disabled={!candidate} loading={busy === 'check'}
            onClick={() => run('check', async () => {
              const result = await api.check(work.id, candidate!.id);
              setCandidate(result.candidate ?? null);
            })}>运行检查</Button>
          <Button type="primary" ghost icon={<RocketOutlined />} disabled={!adoptable} loading={busy === 'adopt'}
            onClick={() => run('adopt', async () => {
              await api.adopt(work.id, candidate!.id, work.stateRevision);
              setCandidate(null);
              await refresh();
              setOutbox((await api.outbox(work.id)).events);
            }, `第 ${chapterNumber} 章已采用`)}>采用</Button>
          <Button loading={busy === 'finalize'}
            onClick={() => run('finalize', async () => {
              const result = await api.finalizeManuscript(work.id);
              setManuscriptId(result.manuscript.id);
              await refresh();
            }, '已冻结最终书稿')}>冻结最终书稿</Button>
          {manuscriptId && <span className="toc-meta">已冻结：{manuscriptId}</span>}
        </div>

        {candidate && (
          <div className="manuscript">
            <div className="manuscript-head">
              <h2 className="manuscript-title">第 {candidate.chapterNumber} 章{candidate.origin === 'demo' ? '试写稿' : '候选稿'}</h2>
              <span className={candidate.status === 'candidate' ? 'tag tag-warn' : 'tag tag-mute'}>{candidate.status}</span>
              {candidate.origin === 'demo' && <span className="tag tag-mute">演示，不能采用</span>}
              {candidate.stale && <span className="tag tag-bad">已过期，需重新生成</span>}
            </div>
            {candidate.content && <p className="manuscript-body">{candidate.content}</p>}
            <div className="check-row" style={{ borderTop: 'none', paddingTop: 0 }}>
              <span className="quiet-id">{candidate.id}</span>
              <span className="toc-meta">基于 rev {candidate.generatedAgainstRevision}</span>
              {candidate.brief && <span className="toc-meta">按任务卡 {candidate.brief.outlineId}{candidate.brief.status === 'author_confirmed' ? '（你已确认）' : ''}</span>}
            </div>
            {candidate.checks.length === 0
              ? <p className="panel-note">尚未检查</p>
              : candidate.checks.map((check) => (
                <div key={check.checker} className="check-row">
                  <span className={`tag ${CHECK_TAG[check.status] ?? 'tag-mute'}`}>{check.status}</span>
                  <span>{check.checker}</span>
                  <span className="toc-meta">{check.message}</span>
                </div>
              ))}
            {candidateChecked && missingChecks.map((name) => (
              <div key={name} className="check-row">
                <span className="tag tag-bad">missing</span>
                <span>{name}</span>
                <span className="toc-meta">必需检查尚未运行</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">派生任务</h2>
            <p className="panel-note">派生失败不会重复采用正文</p>
          </div>
        </div>
        <Table
          size="small"
          rowKey="id"
          dataSource={outbox}
          pagination={false}
          locale={{ emptyText: <Empty description="暂无事件 — 采用一章后这里会出现派生任务" /> }}
          columns={[
            { title: '类型', dataIndex: 'kind', render: (kind: string) => <span className="tag tag-gold">{OUTBOX_LABELS[kind] ?? kind}</span> },
            { title: '聚合', dataIndex: 'aggregateId', render: (v: string) => <span className="quiet-id">{v.slice(0, 20)}…</span> },
            { title: '状态', dataIndex: 'publishedAt', render: (v?: string) => v ? <span className="tag tag-ok">已发布</span> : <span className="tag tag-warn">待处理</span> },
            { title: '创建时间', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleTimeString() },
          ]}
        />
      </div>

      {next?.brief && (
        <EditorModal<BriefForm>
          open={confirming}
          title={`确认第 ${next.chapterNumber} 章任务卡`}
          initialValues={{
            pov: next.brief.brief.pov, location: next.brief.brief.location, storyTime: next.brief.brief.storyTime, endState: next.brief.brief.endState,
            mustDoText: next.brief.brief.mustDo.join('\n'), mustNotHappenText: next.brief.brief.mustNotHappen.join('\n'),
          }}
          onCancel={() => setConfirming(false)}
          onSubmit={async ({ mustDoText, mustNotHappenText, ...values }) => {
            await run('confirm', async () => {
              await api.confirmBrief(work.id, next.chapterNumber, { ...values, mustDo: lines(mustDoText), mustNotHappen: lines(mustNotHappenText) });
              setConfirming(false);
              loadNext();
              loadReadiness();
            }, '任务卡已确认');
          }}
        >
          <p className="panel-note">这里的修改只影响本章任务卡，不会改动已批准的章纲。前面的事实变了，任务卡会要求你重新确认。</p>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="pov" label="视角" style={{ flex: 1 }}><Input maxLength={100} /></Form.Item>
            <Form.Item name="location" label="地点" style={{ flex: 1 }}><Input maxLength={200} /></Form.Item>
            <Form.Item name="storyTime" label="故事时间" style={{ flex: 1 }}><Input maxLength={200} /></Form.Item>
          </div>
          <Form.Item name="mustDoText" label="本章必须（每行一条）"><Input.TextArea rows={5} /></Form.Item>
          <Form.Item name="mustNotHappenText" label="不能发生（每行一条）"><Input.TextArea rows={4} /></Form.Item>
          <Form.Item name="endState" label="结束状态"><Input.TextArea rows={2} maxLength={1000} /></Form.Item>
        </EditorModal>
      )}
    </section>
  );
}
