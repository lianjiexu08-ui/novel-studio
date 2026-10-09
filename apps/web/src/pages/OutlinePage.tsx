import { useEffect, useState } from 'react';
import { App as AntApp, Button, Empty, Form, Input, InputNumber, Popconfirm, Radio, Select, Spin, Table, Tooltip } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useOutletContext } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { EditorModal } from './EditorModal';
import type { PlotNodeDto } from 'novel-studio-contracts';
import type { WorkspaceContext } from './Workspace';

const { TextArea } = Input;

const LEVEL_LABEL: Record<PlotNodeDto['level'], string> = { book: '全书', volume: '分卷', chapter: '章节' };
const LEVEL_ORDER: Record<PlotNodeDto['level'], number> = { book: 0, volume: 1, chapter: 2 };

const REALIZATION: Record<PlotNodeDto['realization']['status'], { label: string; tag: string }> = {
  unrealized: { label: '未落实', tag: 'tag-mute' },
  partial: { label: '部分落实', tag: 'tag-warn' },
  realized: { label: '已落实', tag: 'tag-ok' },
  diverged: { label: '正文偏离', tag: 'tag-bad' },
  insufficient: { label: '证据不足', tag: 'tag-warn' },
};

type NodeForm = { level: PlotNodeDto['level']; title: string; expectedResult: string; targetChapter?: number; prerequisites: string[] };

export function OutlinePage() {
  const { message } = AntApp.useApp();
  const { work } = useOutletContext<WorkspaceContext>();
  const [nodes, setNodes] = useState<PlotNodeDto[] | null>(null);
  const [editing, setEditing] = useState<{ open: boolean; item?: PlotNodeDto }>({ open: false });

  async function load() {
    try {
      setNodes((await api.bible(work.id)).plotNodes);
    } catch (error) {
      message.error(error instanceof ApiRequestError ? `[${error.code}] ${error.message}` : String(error));
    }
  }

  useEffect(() => { void load(); }, [work.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    try {
      await action();
      message.success(success);
      await load();
      return true;
    } catch (error) {
      message.error(error instanceof ApiRequestError ? error.message : String(error));
      return false;
    }
  }

  if (!nodes) return <div className="state-block"><Spin size="large" /></div>;

  const sorted = [...nodes].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]
    || (a.targetChapter ?? Number.MAX_SAFE_INTEGER) - (b.targetChapter ?? Number.MAX_SAFE_INTEGER)
    || a.title.localeCompare(b.title, 'zh-CN'));
  const titleOf = new Map(nodes.map((node) => [node.id, node.title]));
  const item = editing.item;

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">本书</p>
          <h1 className="page-title">大纲</h1>
          <p className="page-desc">计划和正文落实分开记录。落实状态只由采用稿决定，这里不能手动标为已落实。</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ open: true })}>添加节点</Button>
      </header>

      <div className="panel">
        <Table
          rowKey="id"
          size="middle"
          pagination={false}
          dataSource={sorted}
          locale={{ emptyText: <Empty description="还没有大纲节点。可以先写全书目标，再拆分卷和章节。" /> }}
          columns={[
            { title: '层级', dataIndex: 'level', width: 80, render: (level: PlotNodeDto['level']) => <span className="tag tag-gold">{LEVEL_LABEL[level]}</span> },
            {
              title: '计划', key: 'plan',
              render: (_: unknown, row: PlotNodeDto) => (
                <div>
                  <strong>{row.title}</strong>
                  {row.expectedResult && <div className="toc-meta" style={{ whiteSpace: 'pre-wrap' }}>{row.expectedResult}</div>}
                  {row.prerequisites.length > 0 && (
                    <div className="toc-meta">前置：{row.prerequisites.map((id) => titleOf.get(id) ?? id).join('、')}</div>
                  )}
                </div>
              ),
            },
            { title: '目标章', dataIndex: 'targetChapter', width: 90, render: (value?: number) => (value ? `第 ${value} 章` : '—') },
            {
              title: '正文落实', key: 'realization', width: 160,
              render: (_: unknown, row: PlotNodeDto) => (
                <div>
                  <span className={`tag ${REALIZATION[row.realization.status].tag}`}>{REALIZATION[row.realization.status].label}</span>
                  {row.realization.evidence && <div className="toc-meta">证据：{row.realization.evidence}</div>}
                </div>
              ),
            },
            {
              title: '', key: 'actions', width: 90,
              render: (_: unknown, row: PlotNodeDto) => {
                const realized = row.realization.status !== 'unrealized';
                return (
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing({ open: true, item: row })} />
                    <Popconfirm title="确定删除这个节点？" okText="删除" cancelText="取消" disabled={realized}
                      onConfirm={() => void run(() => api.removePlotNode(work.id, row.id), '已删除')}>
                      <Tooltip title={realized ? '已有正文落实记录，不能删除' : '删除'}>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={realized} />
                      </Tooltip>
                    </Popconfirm>
                  </div>
                );
              },
            },
          ]}
        />
      </div>

      <EditorModal<NodeForm>
        open={editing.open}
        title={item ? `编辑节点「${item.title}」` : '添加大纲节点'}
        initialValues={item ?? { level: 'chapter', prerequisites: [] }}
        onCancel={() => setEditing({ open: false })}
        onSubmit={async (values) => {
          const body = { ...values, targetChapter: values.targetChapter ?? undefined, prerequisites: values.prerequisites ?? [] };
          const ok = await run(
            () => (item ? api.updatePlotNode(work.id, item.id, body) : api.addPlotNode(work.id, body)),
            item ? '节点已更新' : '节点已添加',
          );
          if (ok) setEditing({ open: false });
        }}
      >
        <Form.Item name="level" label="层级">
          <Radio.Group optionType="button" options={Object.entries(LEVEL_LABEL).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        <Form.Item name="title" label="节点" rules={[{ required: true, whitespace: true, message: '写一个节点名' }]}><Input maxLength={100} placeholder="如：三年之约、宗门大比" /></Form.Item>
        <Form.Item name="expectedResult" label="预期结果" extra="写计划要达成什么。这是未来计划，不会变成当前事实。"><TextArea rows={3} maxLength={1000} /></Form.Item>
        <Form.Item name="targetChapter" label="目标章"><InputNumber min={1} style={{ width: 160 }} /></Form.Item>
        <Form.Item name="prerequisites" label="前置节点">
          <Select mode="multiple" options={nodes.filter((node) => node.id !== item?.id).map((node) => ({ value: node.id, label: node.title }))} placeholder="完成这些节点之后才能写" />
        </Form.Item>
      </EditorModal>
    </section>
  );
}
