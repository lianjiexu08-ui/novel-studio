import { Alert, Card, Empty, Space, Steps, Table, Tag, Typography } from 'antd';

const { Text } = Typography;

export function PublishPage() {
  return (
    <Card title="发布">
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="还没有连接任何投稿平台"
        description="这里不会出现真实投稿成功。超时之后要先核验平台上的结果，再决定是否重试。未知不能当成已发布，也不能当成失败后直接再投一次。"
      />
      <Steps
        size="small"
        current={-1}
        style={{ marginBottom: 20 }}
        items={[
          { title: '排期' },
          { title: '提交' },
          { title: '核验' },
          { title: '已发布' },
        ]}
      />
      <Space size={8} wrap style={{ marginBottom: 16 }}>
        <Tag>scheduled 排期</Tag>
        <Tag color="processing">submitting 提交中</Tag>
        <Tag color="warning">verifying 核验中</Tag>
        <Tag color="success">published 已发布</Tag>
        <Tag>unknown 结果未知</Tag>
        <Tag color="error">failed 失败</Tag>
        <Tag color="error">blocked 被阻断</Tag>
      </Space>
      <Table
        size="middle"
        rowKey="id"
        dataSource={[]}
        pagination={false}
        locale={{ emptyText: <Empty description="存稿队列是空的。采用成功不等于已经投稿。" /> }}
        columns={[
          { title: '作品', dataIndex: 'work' },
          { title: '章节快照', dataIndex: 'snapshot' },
          { title: '平台', dataIndex: 'platform' },
          { title: '状态', dataIndex: 'state' },
        ]}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>平台适配器还是接口占位，页面不会把本地采用稿显示成已发布。</Text>
    </Card>
  );
}
