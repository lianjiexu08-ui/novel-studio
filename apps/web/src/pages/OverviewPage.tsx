import { useEffect, useState } from 'react';
import { Button, Card, Col, Empty, Row, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { FileAddOutlined } from '@ant-design/icons';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../api';
import { OUTBOX_LABELS } from '../labels';
import type { ChapterVersionDto, OutboxEventDto } from 'novel-studio-contracts';
import type { WorkspaceContext } from './Workspace';

const { Text, Title } = Typography;

export function OverviewPage() {
  const { work } = useOutletContext<WorkspaceContext>();
  const navigate = useNavigate();
  const [chapters, setChapters] = useState<ChapterVersionDto[] | null>(null);
  const [outbox, setOutbox] = useState<OutboxEventDto[]>([]);

  useEffect(() => {
    setChapters(null);
    api.listChapters(work.id).then((result) => setChapters(result.chapters)).catch(() => setChapters([]));
    api.outbox(work.id).then((result) => setOutbox(result.events)).catch(() => setOutbox([]));
  }, [work.id, work.stateRevision]);

  if (chapters === null) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  const nextChapter = chapters.reduce((max, chapter) => Math.max(max, chapter.chapterNumber), 0) + 1;
  const pending = outbox.filter((event) => !event.publishedAt).length;

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
            pagination={false}
            onRow={(row) => ({ onClick: () => navigate(`/works/${work.id}/write?chapter=${row.chapterNumber}`), style: { cursor: 'pointer' } })}
            columns={[
              { title: '章节', dataIndex: 'chapterNumber', width: 100, render: (n: number) => <Text strong>第 {n} 章</Text> },
              { title: '版本', dataIndex: 'revision', width: 90, render: (r: number) => <Tag>rev {r}</Tag> },
              { title: '正文', dataIndex: 'content', ellipsis: true, render: (content: string) => content },
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
            {outbox.map((event) => (
              <Tag key={event.id} color={event.publishedAt ? 'success' : 'warning'}>
                {OUTBOX_LABELS[event.kind] ?? event.kind} · {event.publishedAt ? '已完成' : '待处理'}
              </Tag>
            ))}
          </Space>
        )}
      </Card>
    </Space>
  );
}
