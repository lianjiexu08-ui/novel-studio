import { useEffect, useState } from 'react';
import { App as AntApp, Button, Empty, InputNumber, Table } from 'antd';
import { ApiOutlined, RocketOutlined } from '@ant-design/icons';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { covenantReady } from '../covenant';
import type { CandidateDto, OutboxEventDto } from 'novel-studio-contracts';
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

export function WritePage() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const { work, refresh } = useOutletContext<WorkspaceContext>();
  const ready = covenantReady(work.covenant);
  const [chapterNumber, setChapterNumber] = useState(1);
  const [candidate, setCandidate] = useState<CandidateDto | null>(null);
  const [outbox, setOutbox] = useState<OutboxEventDto[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.outbox(work.id).then((result) => setOutbox(result.events)).catch(() => {});
  }, [work.id, work.stateRevision]);

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
  const activeStep = !candidate ? 1 : candidatePassed ? 3 : 2;

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">流水线</p>
          <h1 className="page-title">章节创作</h1>
          <p className="page-desc">
            {ready
              ? `对照约定写：${work.covenant.hook}。候选稿不产生正式事实。`
              : '还没有创作约定。先写明读者承诺和核心吸引点，再生成章节。'}
          </p>
        </div>
      </header>

      <div className="panel">
        <div className="pipeline">
          <div className={`pipeline-step${activeStep >= 1 ? ' is-on' : ''}`}>
            <span className="step-index">01</span>
            <span className="step-name">生成候选</span>
            <span className="step-hint">按章节号起草，不写入正式正文</span>
          </div>
          <div className={`pipeline-step${activeStep >= 2 ? ' is-on' : ''}`}>
            <span className="step-index">02</span>
            <span className="step-name">运行检查</span>
            <span className="step-hint">未检查或未全部通过时不能采用</span>
          </div>
          <div className={`pipeline-step${activeStep >= 3 ? ' is-on' : ''}`}>
            <span className="step-index">03</span>
            <span className="step-name">采用</span>
            <span className="step-hint">通过后写入章节，并触发派生任务</span>
          </div>
        </div>

        <div className="pipeline-actions">
          <span className="toc-meta">章节号</span>
          <InputNumber min={1} value={chapterNumber} onChange={(v) => setChapterNumber(v ?? 1)} />
          {!ready && <Button onClick={() => navigate(`/works/${work.id}/covenant`)}>去写约定</Button>}
          <Button type="primary" icon={<ApiOutlined />} disabled={!ready} loading={busy === 'generate'}
            onClick={() => run('generate', async () => {
              const result = await api.generate(work.id, chapterNumber);
              setCandidate(result.candidate);
            })}>生成候选</Button>
          <Button disabled={!candidate} loading={busy === 'check'}
            onClick={() => run('check', async () => {
              const result = await api.check(work.id, candidate!.id);
              setCandidate(result.candidate);
            })}>运行检查</Button>
          <Button type="primary" ghost icon={<RocketOutlined />} disabled={!candidatePassed} loading={busy === 'adopt'}
            onClick={() => run('adopt', async () => {
              await api.adopt(work.id, candidate!.id, work.stateRevision);
              setCandidate(null);
              await refresh();
              setOutbox((await api.outbox(work.id)).events);
            }, `第 ${chapterNumber} 章已采用`)}>采用</Button>
        </div>

        {candidate && (
          <div className="manuscript">
            <div className="manuscript-head">
              <h2 className="manuscript-title">第 {candidate.chapterNumber} 章候选稿</h2>
              <span className={candidate.status === 'candidate' ? 'tag tag-warn' : 'tag tag-mute'}>{candidate.status}</span>
            </div>
            {candidate.content && <p className="manuscript-body">{candidate.content}</p>}
            <div className="check-row" style={{ borderTop: 'none', paddingTop: 0 }}>
              <span className="quiet-id">{candidate.id}</span>
              <span className="toc-meta">基于 rev {candidate.generatedAgainstRevision}</span>
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
    </section>
  );
}
