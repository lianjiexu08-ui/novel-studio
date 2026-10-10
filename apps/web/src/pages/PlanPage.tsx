import { useEffect, useMemo, useState } from 'react';
import { App as AntApp, Button, Empty, Form, Input, InputNumber, Popconfirm, Spin, Table, Tabs, Tooltip } from 'antd';
import { CheckOutlined, EditOutlined, PlusOutlined, ReloadOutlined, RobotOutlined, SafetyOutlined } from '@ant-design/icons';
import { useOutletContext } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { EditorModal } from './EditorModal';
import type { BookPlanContract, NodeRealizationDto, PlanOverviewDto, PlanRevisionDto } from 'novel-studio-contracts';
import type { WorkspaceContext } from './Workspace';

const { TextArea } = Input;

type Plan = BookPlanContract;
type Volume = Plan['volumes'][number];
type Outline = Plan['chapters'][number];

const STATUS: Record<PlanRevisionDto['status'], { label: string; tag: string }> = {
  proposed: { label: '待审核', tag: 'tag-warn' },
  reviewed: { label: '已审核，待批准', tag: 'tag-gold' },
  approved: { label: '已批准', tag: 'tag-ok' },
  superseded: { label: '已被替代', tag: 'tag-mute' },
};

const SOURCE: Record<PlanRevisionDto['source'], string> = { model: '模型生成', author: '作者编写', mixed: '模型+作者' };

const REALIZATION: Record<NodeRealizationDto['status'], { label: string; tag: string }> = {
  unrealized: { label: '未写到', tag: 'tag-mute' },
  partial: { label: '部分落实', tag: 'tag-warn' },
  realized: { label: '已落实', tag: 'tag-ok' },
  diverged: { label: '正文偏离', tag: 'tag-bad' },
  insufficient: { label: '证据不足', tag: 'tag-warn' },
};

const MILESTONE_KIND: Record<Plan['milestones'][number]['kind'], string> = { climax: '高潮', turn: '转折', payoff: '兑现' };

function splitVolumes(target: number, count: number): Volume[] {
  const size = Math.ceil(target / count);
  return Array.from({ length: count }, (_, index) => ({
    id: `vol-${index + 1}`, order: index + 1, title: `第${index + 1}卷`,
    startChapter: index * size + 1, endChapter: Math.min(target, (index + 1) * size),
    goal: '', opposition: '', characterIds: [], climax: '', endState: '', carryOver: '',
  })).filter((volume) => volume.startChapter <= target);
}

function emptyOutline(chapterNumber: number, plan: Plan): Outline {
  const volume = plan.volumes.find((item) => item.startChapter <= chapterNumber && item.endChapter >= chapterNumber);
  return {
    id: `chapter-${chapterNumber}`, chapterNumber, volumeId: volume?.id ?? '', title: '', summary: '', characterGoals: '', conflict: '', choice: '', cost: '',
    threads: [], endState: '', characterIds: [], scenes: [], source: 'author',
  };
}

const lines = (value?: string) => (value ?? '').split('\n').map((item) => item.trim()).filter(Boolean);

export function PlanPage() {
  const { message } = AntApp.useApp();
  const { work } = useOutletContext<WorkspaceContext>();
  const [overview, setOverview] = useState<PlanOverviewDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingCore, setEditingCore] = useState(false);
  const [editingVolume, setEditingVolume] = useState<Volume | null>(null);
  const [editingOutline, setEditingOutline] = useState<Outline | null>(null);
  const [regen, setRegen] = useState<{ from: number; to: number; request: string }>({ from: 1, to: 10, request: '' });

  async function load() {
    try {
      setOverview(await api.plans(work.id));
    } catch (error) {
      message.error(error instanceof ApiRequestError ? `[${error.code}] ${error.message}` : String(error));
    }
  }

  useEffect(() => { void load(); }, [work.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(step: string, action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(step);
    try {
      await action();
      message.success(success);
      await load();
      return true;
    } catch (error) {
      message.error(error instanceof ApiRequestError ? error.message : String(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const latest = overview?.latest;
  const active = overview?.active;
  const plan = latest?.plan;
  const lastReview = latest?.reviews.at(-1);
  const approvable = !!latest && latest.status === 'reviewed' && !!lastReview?.passed && lastReview.contentHash === latest.contentHash;
  const realization = useMemo(() => new Map((overview?.realization?.nodes ?? []).map((node) => [node.nodeId, node])), [overview]);

  function save(next: Plan, note: string) {
    return run('save', () => api.savePlan(work.id, { plan: next, baseRevisionId: latest?.id, note }), '已另存为新版本，需重新审核后批准');
  }

  if (!overview) return <div className="state-block"><Spin size="large" /></div>;

  const planner = overview.planningConfigured;
  const target = work.covenant.targetChapterCount ?? 100;
  const volumes = work.covenant.volumeCount ?? Math.max(1, Math.ceil(target / 100));

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">本书</p>
          <h1 className="page-title">全书计划</h1>
          <p className="page-desc">
            计划是未来意图，不是事实。每次修改都存为新版本；审核只做结构检查，批准由你单独确认。
            正式写作只按已批准的版本，并且前 {Math.min(50, plan?.targetChapterCount ?? 50)} 章都要有章纲。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Tooltip title={planner ? '' : '没有配置规划模型（NOVEL_PLANNING_MODEL），可以手动编写计划'}>
            <Button icon={<RobotOutlined />} disabled={!planner} onClick={() => setGenerating(true)}>模型生成计划</Button>
          </Tooltip>
          {!latest && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>手动新建</Button>}
          {latest && latest.status !== 'approved' && latest.status !== 'superseded' && (
            <Button icon={<SafetyOutlined />} loading={busy === 'review'}
              onClick={() => void run('review', () => api.reviewPlan(work.id, latest.id), '审核完成')}>结构审核</Button>
          )}
          {latest && latest.status !== 'approved' && (
            <Popconfirm
              title="批准这一版计划？"
              description="批准后正式写作按这一版执行；按旧计划生成、尚未采用的候选稿会过期。已采用的正文不会被改动。"
              okText="批准" cancelText="取消" disabled={!approvable}
              onConfirm={() => void run('approve', () => api.approvePlan(work.id, latest.id), '计划已批准')}>
              <Tooltip title={approvable ? '' : '先通过结构审核（审核要对应当前这一版内容和当前设计）'}>
                <Button type="primary" icon={<CheckOutlined />} disabled={!approvable} loading={busy === 'approve'}>批准</Button>
              </Tooltip>
            </Popconfirm>
          )}
        </div>
      </header>

      {!latest ? (
        <div className="panel">
          <Empty description="还没有全书计划。先定全书目标章数和分卷，再写前 50 章章纲；或者让规划模型先出一版草案。" />
        </div>
      ) : (
        <>
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2 className="panel-title">
                  第 {latest.revision} 版 <span className={`tag ${STATUS[latest.status].tag}`}>{STATUS[latest.status].label}</span>
                  <span className="tag tag-mute" style={{ marginLeft: 6 }}>{SOURCE[latest.source]}</span>
                </h2>
                <p className="panel-note">
                  {active ? (active.id === latest.id ? '这就是当前生效的计划。' : `当前生效的是第 ${active.revision} 版；这一版批准后才会替换它。`) : '还没有已批准的计划，正式写作不可用。'}
                  {latest.note && `  备注：${latest.note}`}
                </p>
              </div>
              <Button icon={<EditOutlined />} onClick={() => setEditingCore(true)}>编辑总纲</Button>
            </div>
            <div className="setting-list">
              <div className="check-row"><span className="toc-meta">全书目标</span><span>{plan!.targetChapterCount} 章 · {plan!.volumes.length} 卷 · 已写章纲 {plan!.chapters.length} 章</span></div>
              <div className="check-row"><span className="toc-meta">主冲突</span><span>{plan!.mainConflict || '—'}</span></div>
              <div className="check-row"><span className="toc-meta">主角弧光</span><span>{plan!.protagonistArc || '—'}</span></div>
              <div className="check-row"><span className="toc-meta">结局方向</span><span>{plan!.endingDirection || '—'}</span></div>
            </div>
          </div>

          {lastReview && (
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2 className="panel-title">结构审核 {lastReview.passed ? <span className="tag tag-ok">通过</span> : <span className="tag tag-bad">未通过</span>}</h2>
                  <p className="panel-note">
                    {lastReview.contentHash === latest.contentHash ? '审核对应当前这一版内容。' : '内容已变化，需要重新审核。'}
                    通过只代表结构完整，不代表写得好。
                  </p>
                </div>
              </div>
              {lastReview.issues.length === 0
                ? <p className="panel-note">没有发现问题。</p>
                : lastReview.issues.map((issue, index) => (
                  <div key={`${issue.code}-${index}`} className="check-row">
                    <span className={`tag ${issue.severity === 'error' ? 'tag-bad' : 'tag-warn'}`}>{issue.severity === 'error' ? '必须修' : '提示'}</span>
                    <span>{issue.message}</span>
                    <span className="quiet-id">{issue.code}</span>
                  </div>
                ))}
            </div>
          )}

          <div className="panel">
            <Tabs items={[
              {
                key: 'volumes', label: `分卷（${plan!.volumes.length}）`,
                children: (
                  <Table rowKey="id" size="middle" pagination={false} dataSource={plan!.volumes}
                    columns={[
                      { title: '卷', dataIndex: 'title', width: 120, render: (title: string, row: Volume) => <strong>{row.order}. {title}</strong> },
                      { title: '范围', key: 'range', width: 130, render: (_: unknown, row: Volume) => `第 ${row.startChapter}-${row.endChapter} 章` },
                      { title: '目标 / 阻力', key: 'goal', render: (_: unknown, row: Volume) => <div>{row.goal || '—'}<div className="toc-meta">阻力：{row.opposition || '—'}</div></div> },
                      { title: '高潮', dataIndex: 'climax', render: (value: string) => value || <span className="tag tag-warn">未写</span> },
                      { title: '结束状态', dataIndex: 'endState', render: (value: string) => value || '—' },
                      { title: '', key: 'edit', width: 60, render: (_: unknown, row: Volume) => <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditingVolume(row)} /> },
                    ]} />
                ),
              },
              {
                key: 'outlines', label: `章纲（${plan!.chapters.length}/${Math.min(50, plan!.targetChapterCount)}）`,
                children: (
                  <>
                    <div className="pipeline-actions" style={{ marginBottom: 12 }}>
                      <span className="toc-meta">重生成</span>
                      第 <InputNumber min={1} max={plan!.targetChapterCount} value={regen.from} onChange={(value) => setRegen({ ...regen, from: value ?? 1 })} />
                      - <InputNumber min={1} max={plan!.targetChapterCount} value={regen.to} onChange={(value) => setRegen({ ...regen, to: value ?? 1 })} /> 章
                      <Input style={{ width: 260 }} placeholder="这组想怎么改（可空）" value={regen.request} onChange={(event) => setRegen({ ...regen, request: event.target.value })} />
                      <Tooltip title={planner ? '只改这一段，其他章纲原样保留；一次最多 20 章' : '没有配置规划模型'}>
                        <Button icon={<ReloadOutlined />} disabled={!planner} loading={busy === 'regen'}
                          onClick={() => void run('regen', () => api.generateOutlines(work.id, { baseRevisionId: latest.id, from: regen.from, to: regen.to, authorRequest: regen.request || undefined }), '已生成新版本，需要审核')}>
                          重生成这一组
                        </Button>
                      </Tooltip>
                      <Button icon={<PlusOutlined />} onClick={() => {
                        const have = new Set(plan!.chapters.map((item) => item.chapterNumber));
                        let next = 1;
                        while (have.has(next)) next += 1;
                        setEditingOutline(emptyOutline(Math.min(next, plan!.targetChapterCount), plan!));
                      }}>补写下一章章纲</Button>
                    </div>
                    <Table rowKey="chapterNumber" size="small" dataSource={plan!.chapters} pagination={{ pageSize: 20, showSizeChanger: false }}
                      columns={[
                        { title: '章', dataIndex: 'chapterNumber', width: 70, render: (value: number) => `第 ${value} 章` },
                        { title: '章纲', key: 'summary', render: (_: unknown, row: Outline) => (
                          <div>
                            <strong>{row.title || '（无标题）'}</strong> <span className="toc-meta">{row.source === 'model' ? '模型' : '作者'}</span>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{row.summary}</div>
                            <div className="toc-meta">冲突：{row.conflict || '—'} ｜ 选择：{row.choice || '—'} ｜ 代价：{row.cost || '—'}</div>
                          </div>
                        ) },
                        { title: '结束状态', dataIndex: 'endState', width: 200 },
                        ...(active?.id === latest.id ? [{
                          title: '正文落实', key: 'real', width: 130,
                          render: (_: unknown, row: Outline) => {
                            const node = realization.get(row.id);
                            return node ? <span className={`tag ${REALIZATION[node.status].tag}`}>{REALIZATION[node.status].label}</span> : '—';
                          },
                        }] : []),
                        { title: '', key: 'edit', width: 60, render: (_: unknown, row: Outline) => <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditingOutline(row)} /> },
                      ]} />
                  </>
                ),
              },
              {
                key: 'milestones', label: `高潮与前置（${plan!.milestones.length}）`,
                children: (
                  <>
                    <Table rowKey="id" size="small" pagination={false} dataSource={plan!.milestones}
                      locale={{ emptyText: <Empty description="还没有高潮节点。每卷至少安排一次高潮，并写清铺垫。" /> }}
                      columns={[
                        { title: '类型', dataIndex: 'kind', width: 70, render: (kind: keyof typeof MILESTONE_KIND) => <span className="tag tag-gold">{MILESTONE_KIND[kind]}</span> },
                        { title: '节点', dataIndex: 'title', render: (title: string, row) => <div><strong>{title}</strong><div className="toc-meta">铺垫：{row.setup.join('、') || '—'} ｜ 代价：{row.cost || '—'}</div></div> },
                        { title: '计划章', key: 'range', width: 130, render: (_: unknown, row) => `第 ${row.startChapter}-${row.endChapter} 章` },
                        { title: '前置', key: 'deps', render: (_: unknown, row) => plan!.dependencies.filter((dependency) => dependency.targetId === row.id).map((dependency) => (
                          <div key={dependency.id} className="toc-meta">{dependency.requiredness === 'must' ? '必须' : '可选'}：{dependency.description}</div>
                        )) },
                      ]} />
                    {plan!.openQuestions.length > 0 && (
                      <div className="setting-list" style={{ marginTop: 12 }}>
                        {plan!.openQuestions.map((question) => (
                          <div key={question.id} className="check-row">
                            <span className={`tag ${question.blocking && question.status === 'open' ? 'tag-bad' : 'tag-mute'}`}>{question.blocking ? '阻断' : '待定'}</span>
                            <span>{question.question}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ),
              },
              {
                key: 'realization', label: '计划 vs 正文',
                children: !overview.realization ? <Empty description="批准计划后，这里对照每个章纲和高潮在采用稿里的落实情况。" /> : (
                  <Table rowKey="nodeId" size="small" pagination={{ pageSize: 20, showSizeChanger: false }}
                    dataSource={overview.realization.nodes.filter((node) => node.due || node.evidence.length > 0 || node.kind === 'milestone')}
                    locale={{ emptyText: <Empty description="还没有写到计划里的章节。" /> }}
                    columns={[
                      { title: '节点', dataIndex: 'title', render: (title: string, row: NodeRealizationDto) => <div><strong>{title}</strong><div className="toc-meta">{row.kind === 'chapter' ? '章纲' : '高潮/节点'} · 第 {row.startChapter}{row.endChapter !== row.startChapter ? `-${row.endChapter}` : ''} 章</div></div> },
                      { title: '状态', key: 'status', width: 160, render: (_: unknown, row: NodeRealizationDto) => (
                        <div>
                          <span className={`tag ${REALIZATION[row.status].tag}`}>{REALIZATION[row.status].label}</span>
                          {row.overdue && <span className="tag tag-bad" style={{ marginLeft: 4 }}>已过期</span>}
                          {!row.due && <span className="tag tag-mute" style={{ marginLeft: 4 }}>未到</span>}
                        </div>
                      ) },
                      { title: '证据', key: 'evidence', render: (_: unknown, row: NodeRealizationDto) => row.evidence.map((item) => <div key={item.eventId} className="toc-meta">第 {item.chapterNumber} 章：{item.text}</div>) },
                    ]} />
                ),
              },
            ]} />
          </div>
        </>
      )}

      <EditorModal<{ targetChapterCount: number; volumeCount: number; authorRequest?: string }>
        open={generating}
        title="模型生成全书计划"
        initialValues={{ targetChapterCount: target, volumeCount: volumes }}
        onCancel={() => setGenerating(false)}
        onSubmit={async (values) => {
          const ok = await run('generate', () => api.generatePlan(work.id, values), '计划草案已生成，请审核后再批准');
          if (ok) setGenerating(false);
        }}
      >
        <p className="panel-note">模型先出骨架，再按 5-10 章一组写前 50 章章纲。结果只是草案，不会自动批准。已采用章节的章纲会保留。</p>
        <Form.Item name="targetChapterCount" label="全书目标章数" rules={[{ required: true }]}><InputNumber min={1} max={2000} style={{ width: 160 }} /></Form.Item>
        <Form.Item name="volumeCount" label="分卷数" rules={[{ required: true }]}><InputNumber min={1} max={50} style={{ width: 160 }} /></Form.Item>
        <Form.Item name="authorRequest" label="你的要求"><TextArea rows={3} maxLength={2000} placeholder="如：前三章必须立住主角的困境；第一卷结尾翻盘" /></Form.Item>
      </EditorModal>

      <EditorModal<{ targetChapterCount: number; volumeCount: number; mainConflict?: string }>
        open={creating}
        title="手动新建全书计划"
        initialValues={{ targetChapterCount: target, volumeCount: volumes }}
        onCancel={() => setCreating(false)}
        onSubmit={async (values) => {
          const next: Plan = {
            targetChapterCount: values.targetChapterCount, volumeCount: values.volumeCount, mainConflict: values.mainConflict ?? '', theme: '', protagonistArc: '', endingDirection: '',
            keyTurns: [], volumes: splitVolumes(values.targetChapterCount, values.volumeCount), chapters: [], milestones: [], dependencies: [], openQuestions: [],
          };
          const ok = await save(next, '手动新建');
          if (ok) setCreating(false);
        }}
      >
        <p className="panel-note">先按卷数平均切分章节范围，之后可以逐卷调整，再补章纲。</p>
        <Form.Item name="targetChapterCount" label="全书目标章数" rules={[{ required: true }]}><InputNumber min={1} max={2000} style={{ width: 160 }} /></Form.Item>
        <Form.Item name="volumeCount" label="分卷数" rules={[{ required: true }]}><InputNumber min={1} max={50} style={{ width: 160 }} /></Form.Item>
        <Form.Item name="mainConflict" label="主冲突"><TextArea rows={2} maxLength={2000} /></Form.Item>
      </EditorModal>

      {plan && (
        <EditorModal<Pick<Plan, 'targetChapterCount' | 'mainConflict' | 'theme' | 'protagonistArc' | 'endingDirection'>>
          open={editingCore}
          title="编辑总纲"
          initialValues={plan}
          onCancel={() => setEditingCore(false)}
          onSubmit={async (values) => {
            const ok = await save({ ...plan, ...values }, '编辑总纲');
            if (ok) setEditingCore(false);
          }}
        >
          <Form.Item name="targetChapterCount" label="全书目标章数" extra="改了总章数，记得调整最后一卷的范围；审核会指出对不上的地方。"><InputNumber min={1} max={2000} style={{ width: 160 }} /></Form.Item>
          <Form.Item name="mainConflict" label="主冲突"><TextArea rows={2} maxLength={2000} /></Form.Item>
          <Form.Item name="theme" label="主题"><Input maxLength={200} /></Form.Item>
          <Form.Item name="protagonistArc" label="主角弧光"><TextArea rows={2} maxLength={2000} /></Form.Item>
          <Form.Item name="endingDirection" label="结局方向"><TextArea rows={2} maxLength={2000} /></Form.Item>
        </EditorModal>
      )}

      {plan && editingVolume && (
        <EditorModal<Volume>
          open
          title={`编辑「${editingVolume.title}」`}
          initialValues={editingVolume}
          onCancel={() => setEditingVolume(null)}
          onSubmit={async (values) => {
            const next = { ...plan, volumes: plan.volumes.map((item) => (item.id === editingVolume.id ? { ...item, ...values } : item)) };
            const ok = await save(next, `编辑${editingVolume.title}`);
            if (ok) setEditingVolume(null);
          }}
        >
          <Form.Item name="title" label="卷名" rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="startChapter" label="起始章"><InputNumber min={1} /></Form.Item>
            <Form.Item name="endChapter" label="结束章"><InputNumber min={1} /></Form.Item>
          </div>
          <Form.Item name="goal" label="本卷目标"><TextArea rows={2} maxLength={2000} /></Form.Item>
          <Form.Item name="opposition" label="主要阻力"><TextArea rows={2} maxLength={2000} /></Form.Item>
          <Form.Item name="climax" label="卷末高潮"><TextArea rows={2} maxLength={2000} /></Form.Item>
          <Form.Item name="endState" label="结束状态"><TextArea rows={2} maxLength={2000} /></Form.Item>
          <Form.Item name="carryOver" label="带入下一卷"><TextArea rows={2} maxLength={2000} /></Form.Item>
        </EditorModal>
      )}

      {plan && editingOutline && (
        <EditorModal<Outline & { scenesText?: string }>
          open
          title={`第 ${editingOutline.chapterNumber} 章章纲`}
          initialValues={{ ...editingOutline, scenesText: editingOutline.scenes.join('\n') }}
          onCancel={() => setEditingOutline(null)}
          onSubmit={async ({ scenesText, ...values }) => {
            const outline: Outline = { ...editingOutline, ...values, scenes: lines(scenesText), source: 'author' };
            const others = plan.chapters.filter((item) => item.chapterNumber !== editingOutline.chapterNumber);
            const ok = await save({ ...plan, chapters: [...others, outline] }, `编辑第 ${editingOutline.chapterNumber} 章章纲`);
            if (ok) setEditingOutline(null);
          }}
        >
          <Form.Item name="title" label="标题"><Input maxLength={100} /></Form.Item>
          <Form.Item name="summary" label="事件摘要" rules={[{ required: true, whitespace: true, message: '写这一章发生什么' }]}><TextArea rows={3} maxLength={2000} /></Form.Item>
          <Form.Item name="characterGoals" label="人物目标" rules={[{ required: true, whitespace: true }]}><TextArea rows={2} maxLength={2000} /></Form.Item>
          <Form.Item name="conflict" label="主要冲突" rules={[{ required: true, whitespace: true }]}><TextArea rows={2} maxLength={2000} /></Form.Item>
          <Form.Item name="choice" label="关键选择" rules={[{ required: true, whitespace: true }]}><TextArea rows={2} maxLength={2000} /></Form.Item>
          <Form.Item name="cost" label="代价或后果" rules={[{ required: true, whitespace: true }]}><TextArea rows={2} maxLength={2000} /></Form.Item>
          <Form.Item name="endState" label="结束状态" rules={[{ required: true, whitespace: true }]}><TextArea rows={2} maxLength={2000} /></Form.Item>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="location" label="地点" style={{ flex: 1 }}><Input maxLength={200} /></Form.Item>
            <Form.Item name="storyTime" label="故事时间" style={{ flex: 1 }}><Input maxLength={200} /></Form.Item>
          </div>
          <Form.Item name="scenesText" label="场景（每行一个）"><TextArea rows={3} /></Form.Item>
        </EditorModal>
      )}
    </section>
  );
}
