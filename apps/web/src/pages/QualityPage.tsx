import { useEffect, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Col, Empty, InputNumber, Row, Space, Spin, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useOutletContext } from 'react-router-dom';
import { api, ApiRequestError, type ChapterHistoryDto } from '../api';
import type { WorkspaceContext } from './Workspace';

const { Text, Title } = Typography;

function valueOf(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function QualityPage() {
  const { message } = AntApp.useApp();
  const { work } = useOutletContext<WorkspaceContext>();
  const [chapter, setChapter] = useState(1);
  const [history, setHistory] = useState<ChapterHistoryDto | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(chapterNumber = chapter) {
    setLoading(true);
    try { setHistory(await api.history(work.id, chapterNumber)); }
    catch (error) { message.error(error instanceof ApiRequestError ? '[' + error.code + '] ' + error.message : String(error)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(1); }, [work.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return <section className="page">
    <header className="page-head"><div><p className="page-kicker">复查</p><Title level={4} style={{ margin: 0 }}>章节质量与状态</Title><p className="page-desc">选择一个章节，查看截至该章已经成立的事实、角色状态、关系、人物弧光和秘密揭示。所有结果来自已采用版本。</p></div><Space><InputNumber min={1} max={450} value={chapter} onChange={(value) => setChapter(value ?? 1)} /><Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>加载第 {chapter} 章</Button></Space></header>
    {!history ? <div className="state-block"><Spin size="large" /></div> : <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="info" showIcon message={'截至第 ' + history.chapterNumber + ' 章'} description={'事件 ' + history.events.length + ' 条，角色状态 ' + history.characterStates.length + ' 条，关系 ' + history.relationships.filter(Boolean).length + ' 条，弧光进度 ' + history.arcStates.length + ' 条，秘密揭示 ' + history.secretStates.length + ' 条，承诺/开放线收束 ' + (history.promiseStates.length + history.threadStates.length) + ' 条。'} />
      <Row gutter={16}>
        <Col xs={24} md={12}><Card title="事实事件"><Table size="small" pagination={{ pageSize: 8 }} rowKey="id" dataSource={history.events} locale={{ emptyText: <Empty description="截至本章没有事实事件" /> }} columns={[{ title: '章', dataIndex: 'chapterNumber', width: 56 }, { title: '类型', dataIndex: 'eventType' }, { title: '对象', dataIndex: 'subjectId' }, { title: '变化', key: 'change', render: (_: unknown, row: ChapterHistoryDto['events'][number]) => <span>{row.predicate}：{valueOf(row.value)}</span> }]} /></Card></Col>
        <Col xs={24} md={12}><Card title="角色状态"><Table size="small" pagination={{ pageSize: 8 }} rowKey={(row) => row.characterId + row.field} dataSource={history.characterStates} locale={{ emptyText: <Empty description="暂无角色状态" /> }} columns={[{ title: '人物', dataIndex: 'characterId' }, { title: '字段', dataIndex: 'field' }, { title: '当前值', dataIndex: 'value', render: valueOf }]} /></Card></Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} md={12}><Card title="关系快照"><Table size="small" pagination={false} rowKey="id" dataSource={history.relationships.filter(Boolean)} columns={[{ title: '关系', dataIndex: 'kind' }, { title: '值', dataIndex: 'value' }, { title: '锁定', dataIndex: 'locked', render: (value: boolean) => value ? <Tag color="success">是</Tag> : '否' }]} /></Card></Col>
        <Col xs={24} md={12}><Card title="弧光、秘密与收束"><Table size="small" pagination={{ pageSize: 8 }} rowKey="id" dataSource={[...history.arcStates.map((state) => ({ id: state.arcId, kind: '弧光', name: state.arcId, status: state.status, value: valueOf(state.value) })), ...history.secretStates.map((state) => ({ id: state.secretId, kind: '秘密', name: state.secretId, status: state.revealed ? '已揭示' : '未揭示', value: valueOf(state.value) })), ...history.promiseStates.map((state) => ({ id: state.promiseId, kind: '承诺', name: state.promiseId, status: state.status, value: valueOf(state.value) })), ...history.threadStates.map((state) => ({ id: state.threadId, kind: '开放线', name: state.threadId, status: state.status, value: valueOf(state.value) }))]} columns={[{ title: '类型', dataIndex: 'kind' }, { title: 'ID', dataIndex: 'name' }, { title: '状态', dataIndex: 'status' }, { title: '证据', dataIndex: 'value' }]} /></Card></Col>
      </Row>
    </Space>}
  </section>;
}
