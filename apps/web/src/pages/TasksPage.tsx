import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Space, Spin, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { OUTBOX_LABELS } from '../labels';
import type { OutboxEventDto } from 'novel-studio-contracts';

const { Text } = Typography;

interface TaskRow extends OutboxEventDto {
  workTitle: string;
}

export function TasksPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TaskRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setRows(null);
    setError(null);
    try {
      const { works } = await api.listWorks();
      const grouped = await Promise.all(works.map(async (work) => {
        const { events } = await api.outbox(work.id);
        return events.map((event) => ({ ...event, workTitle: work.title }));
      }));
      setRows(grouped.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? `[${cause.code}] ${cause.message}` : String(cause));
      setRows([]);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <Card
      title="任务中心"
      extra={<Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="这里目前只列出采用之后的派生任务"
        description="生成、检查、采用还是你在章节创作页上手动触发的。暂停、恢复和有限重试的调度器还没有接到这个页面。派生失败可以以后重试，不会把正文再采用一次。"
      />
      {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} />}
      {rows === null ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spin /></div>
      ) : (
        <Table
          size="middle"
          rowKey="id"
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: <Empty description="还没有派生任务" /> }}
          columns={[
            { title: '作品', dataIndex: 'workTitle', render: (title: string, row: TaskRow) => (
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/works/${row.workId}/overview`)}>{title}</Button>
            ) },
            { title: '任务', dataIndex: 'kind', render: (kind: string) => <Tag color="geekblue">{OUTBOX_LABELS[kind] ?? kind}</Tag> },
            { title: '状态', dataIndex: 'publishedAt', render: (value?: string) => value ? <Tag color="success">已完成</Tag> : <Tag color="warning">待处理</Tag> },
            { title: '尝试', dataIndex: 'attempts', width: 80 },
            { title: '创建时间', dataIndex: 'createdAt', width: 180, render: (value: string) => new Date(value).toLocaleString() },
          ]}
        />
      )}
      <Space style={{ marginTop: 12 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>同一本书的章节按顺序采用；不同书可以并行。这个约束在服务端，页面上还不能改调度。</Text>
      </Space>
    </Card>
  );
}
