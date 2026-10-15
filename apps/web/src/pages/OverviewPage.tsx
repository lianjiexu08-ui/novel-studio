import { useEffect, useState } from 'react';
import { Button, Card, Col, Empty, Row, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { FileAddOutlined } from '@ant-design/icons';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../api';
import { OUTBOX_LABELS } from '../labels';
import type { ChapterVersionDto, OutboxEventDto } from 'novel-studio-contracts';
import type { WorkspaceContext } from './Workspace';
import { AdoptedChapterReader } from './AdoptedChapterReader';

const { Text, Title } = Typography;

export function OverviewPage() {
  const { work } = useOutletContext<WorkspaceContext>();
  const navigate = useNavigate();
  const [chapters, setChapters] = useState<ChapterVersionDto[] | null>(null);
  const [outbox, setOutbox] = useState<OutboxEventDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setChapters(null);
    setOutbox([]);
    setSelectedId(null);
    let active = true;
    api.listChapters(work.id).then((result) => { if (active) setChapters(result.chapters); }).catch(() => { if (active) setChapters([]); });
    api.outbox(work.id).then((result) => { if (active) setOutbox(result.events); }).catch(() => { if (active) setOutbox([]); });
    return () => { active = false; };
  }, [work.id, work.stateRevision]);

  if (chapters === null) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  const nextChapter = chapters.reduce((max, chapter) => Math.max(max, chapter.chapterNumber), 0) + 1;
  const pending = outbox.filter((event) => !event.publishedAt).length;
  const taskCounts = new Map<string, { kind: string; completed: boolean; count: number }>();
  for (const event of outbox) {
    const completed = Boolean(event.publishedAt), key = `${event.kind}/${completed}`;
    const group = taskCounts.get(key) ?? { kind: event.kind, completed, count: 0 };
    group.count += 1;
    taskCounts.set(key, group);
  }

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{work.title}</Title>
          <Text type="secondary">创作和发布是分开的。这里只统计已经采用的正文。</Text>
        </div>
        <Button type="primary" icon={<FileAddOutlined />} onClick={() => navigate(`/works/${work.id}/write?chapter=${nextChapter}`)}>
          写第 {nextChapter} 章
        </Button>
      </div>

      <Row gutter={16}>
        <Col xs={12} md={6}><Card><Statistic title="故事版本" value={work.stateRevision} prefix="rev " /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="已采用章节" value={chapters.length} suffix="章" /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="待处理派生任务" value={pending} suffix="项" /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="下一章" value={nextChapter} prefix="第 " suffix=" 章" /></Card></Col>
      </Row>

      <Card title="已采用章节">
        {chapters.length === 0 ? (
          <Empty description="还没有采用稿。候选稿不会出现在这里。" />
        ) : (
          <Table
            size="middle"
            rowKey="id"
            dataSource={[...chapters].sort((a, b) => b.chapterNumber - a.chapterNumber)}
            pagination={{ defaultPageSize: 10, showSizeChanger: false, showTotal: total => `共 ${total} 章` }}
            onRow={(row) => ({ onClick: () => setSelectedId(row.id), style: { cursor: 'pointer' } })}
            columns={[
              { title: '章节', dataIndex: 'chapterNumber', width: 110, render: (n: number, row: ChapterVersionDto) => <Button type="link" onClick={event => { event.stopPropagation(); setSelectedId(row.id); }}>第 {n} 章</Button> },
              { title: '版本', dataIndex: 'revision', width: 90, render: (r: number) => <Tag>rev {r}</Tag> },
              { title: '正文摘录', dataIndex: 'content', ellipsis: { showTitle: false }, render: (content: string) => content.length > 120 ? `${content.slice(0, 120)}…` : content },
              { title: '采用时间', dataIndex: 'createdAt', width: 180, render: (v: string) => new Date(v).toLocaleString() },
            ]}
          />
        )}
      </Card>

      <Card title="派生任务" extra={<Text type="secondary" style={{ fontSize: 12 }}>索引或导出失败不会撤回已采用正文</Text>}>
        {outbox.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="采用一章之后，投影、索引和导出会出现在这里" />
        ) : (
          <Space size={8} wrap>
            {[...taskCounts].map(([key, group]) => (
              <Tag key={key} color={group.completed ? 'success' : 'warning'}>
                {OUTBOX_LABELS[group.kind] ?? group.kind} · {group.completed ? '已完成' : '待处理'} {group.count} 项
              </Tag>
            ))}
            <Button type="link" onClick={() => navigate('/tasks')}>查看任务详情</Button>
          </Space>
        )}
      </Card>
      <AdoptedChapterReader chapters={chapters} selectedId={selectedId} onSelect={setSelectedId} onClose={() => setSelectedId(null)} />
    </Space>
  );
}
