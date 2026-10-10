import { useEffect, useState } from 'react';
import { App as AntApp, Button, Empty, Popconfirm, Spin, Table, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api, ApiRequestError, type RunCheckpoint } from '../api';
import { OUTBOX_LABELS } from '../labels';
import type { OutboxEventDto } from 'novel-studio-contracts';

interface RunRow extends RunCheckpoint {
  workId: string;
  workTitle: string;
  running: boolean;
}

interface TaskRow extends OutboxEventDto {
  workTitle: string;
}

const PHASE_LABEL: Record<string, string> = {
  idle: '待开始',
  generated: '已生成',
  checked: '已检查',
  adopted: '已采用',
  complete: '已完成',
  paused: '已暂停',
  cancelled: '已取消',
};

const PHASE_COLOR: Record<string, string> = {
  complete: 'success',
  paused: 'warning',
  cancelled: 'default',
};

function attemptLabel(row: RunRow): string {
  const attempts = row.attempts ?? {};
  const chapter = String(row.phase === 'complete' ? row.targetChapter : row.nextChapter);
  const count = attempts[chapter];
  return count && count > 1 ? `第 ${chapter} 章 · 第 ${count} 次` : '第 1 次';
}

function progressLabel(row: RunRow): string {
  if (row.phase === 'complete') return `已写到第 ${row.targetChapter} 章`;
  if (row.phase === 'cancelled') return `停在第 ${row.nextChapter} 章之前`;
  return `下一章第 ${row.nextChapter} 章 / 目标第 ${row.targetChapter} 章`;
}

export function TasksPage() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load(silent = false) {
    if (!silent) setRuns(null);
    setError(null);
    try {
      const { works } = await api.listWorks();
      const grouped = await Promise.all(works.map(async (work) => {
        const [status, outbox] = await Promise.all([api.checkpoints(work.id), api.outbox(work.id)]);
        return {
          runs: status.checkpoints.map((checkpoint) => ({
            ...checkpoint,
            workId: work.id,
            workTitle: work.title,
            running: Boolean(checkpoint.active) || status.activeRunIds.includes(checkpoint.runId),
          })),
          tasks: outbox.events.map((event) => ({ ...event, workTitle: work.title })),
        };
      }));
      setRuns(grouped.flatMap((item) => item.runs));
      setTasks(grouped.flatMap((item) => item.tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : String(cause));
      setRuns((current) => current ?? []);
    }
  }

  useEffect(() => { void load(); }, []);

  const watching = runs?.some((run) => run.running || run.control) ?? false;
  useEffect(() => {
    if (!watching) return undefined;
    const timer = window.setInterval(() => void load(true), 4000);
    return () => window.clearInterval(timer);
  }, [watching]);

  async function act(row: RunRow, action: 'pause' | 'cancel' | 'resume') {
    const key = `${row.workId}:${row.runId}:${action}`;
    setBusy(key);
    try {
      if (action === 'resume') {
        await api.resumeRun(row.workId, row.runId, row.targetChapter);
        message.success('已从检查点继续');
      } else {
        await api.controlRun(row.workId, row.runId, action);
        message.success(action === 'pause' ? '已请求暂停，进行中的步骤会在边界停下' : '已取消这条运行');
      }
      await load(true);
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.code === 'BATCH_RUNS_DISABLED') {
        message.error('多章连续生成默认关闭。这条运行停在检查点上，正文请回到章节页逐章继续。');
      } else {
        message.error(cause instanceof ApiRequestError ? cause.message : String(cause));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">运行</p>
          <h1 className="page-title">任务中心</h1>
          <p className="page-desc">每本书的连续生成检查点，以及采用之后的派生任务。暂停和取消作用在已有运行上；正文仍在章节页逐章写。</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
      </header>

      {error && <p className="page-desc">{error}</p>}

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2 className="panel-title">连续生成</h2>
            <p className="panel-note">阶段、进度和失败原因来自已保存的检查点。进行中的运行会在下一步边界响应暂停或取消。</p>
          </div>
        </header>
        {runs === null ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spin /></div>
        ) : (
          <Table
            size="middle"
            rowKey={(row) => `${row.workId}:${row.runId}`}
            dataSource={runs}
            pagination={false}
            locale={{ emptyText: <Empty description="还没有连续生成记录。章节在创作页逐章写。" /> }}
            columns={[
              {
                title: '作品', dataIndex: 'workTitle',
                render: (title: string, row: RunRow) => (
                  <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/works/${row.workId}/write`)}>{title}</Button>
                ),
              },
              { title: '运行', dataIndex: 'runId', ellipsis: true },
              {
                title: '阶段', dataIndex: 'phase', width: 120,
                render: (phase: string, row: RunRow) => (
                  <Tag color={row.running ? 'processing' : PHASE_COLOR[phase] ?? 'blue'}>
                    {row.running ? '进行中' : row.control === 'pause' ? '即将暂停' : row.control === 'cancel' ? '即将取消' : PHASE_LABEL[phase] ?? phase}
                  </Tag>
                ),
              },
              { title: '进度', key: 'progress', render: (_: unknown, row: RunRow) => progressLabel(row) },
              { title: '尝试', key: 'attempts', width: 140, render: (_: unknown, row: RunRow) => attemptLabel(row) },
              { title: '失败原因', dataIndex: 'error', ellipsis: true, render: (value?: string) => value || '—' },
              {
                title: '操作', key: 'actions', width: 180,
                render: (_: unknown, row: RunRow) => {
                  if (row.phase === 'complete' || row.phase === 'cancelled') return '—';
                  const paused = row.phase === 'paused' && !row.running;
                  return (
                    <span style={{ display: 'flex', gap: 8 }}>
                      {paused ? (
                        <Button size="small" type="primary" loading={busy === `${row.workId}:${row.runId}:resume`} onClick={() => void act(row, 'resume')}>继续</Button>
                      ) : (
                        <Button size="small" loading={busy === `${row.workId}:${row.runId}:pause`} onClick={() => void act(row, 'pause')}>暂停</Button>
                      )}
                      <Popconfirm title="取消后不能用同一个运行编号继续" onConfirm={() => void act(row, 'cancel')}>
                        <Button size="small" danger loading={busy === `${row.workId}:${row.runId}:cancel`}>取消</Button>
                      </Popconfirm>
                    </span>
                  );
                },
              },
            ]}
          />
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2 className="panel-title">派生任务</h2>
            <p className="panel-note">采用一章之后才会出现。索引或导出失败不会撤回已经采用的正文。</p>
          </div>
        </header>
        <Table
          size="middle"
          rowKey="id"
          dataSource={tasks}
          pagination={false}
          locale={{ emptyText: <Empty description="还没有派生任务" /> }}
          columns={[
            {
              title: '作品', dataIndex: 'workTitle',
              render: (title: string, row: TaskRow) => (
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/works/${row.workId}/overview`)}>{title}</Button>
              ),
            },
            { title: '任务', dataIndex: 'kind', render: (kind: string) => <Tag>{OUTBOX_LABELS[kind] ?? kind}</Tag> },
            { title: '状态', dataIndex: 'publishedAt', width: 100, render: (value?: string) => value ? <Tag color="success">已完成</Tag> : <Tag color="warning">待处理</Tag> },
            { title: '尝试', dataIndex: 'attempts', width: 80 },
            { title: '创建时间', dataIndex: 'createdAt', width: 180, render: (value: string) => new Date(value).toLocaleString() },
          ]}
        />
      </section>
    </section>
  );
}
