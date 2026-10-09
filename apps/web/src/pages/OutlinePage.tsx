import { Alert, Card, Empty, Table, Tag, Typography } from 'antd';

const { Text } = Typography;

const COLUMNS = [
  { title: '节点', dataIndex: 'name', width: 160 },
  { title: '计划', dataIndex: 'plan' },
  { title: '正文落实', dataIndex: 'text', render: () => <Tag>未落实</Tag> },
  { title: '故事事实', dataIndex: 'fact', render: () => <Tag>未入账</Tag> },
];

export function OutlinePage() {
  return (
    <Card title="大纲">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="计划、正文落实、故事事实分成三列"
        description="邻章里的相似内容不能算作本章落实。正文和计划偏离时保留正文，再决定继续、改计划，或另开修订。未来节点不会提前写成当前事实。"
      />
      <Table
        size="middle"
        rowKey="name"
        columns={COLUMNS}
        dataSource={[]}
        pagination={false}
        locale={{ emptyText: <Empty description="还没有章节计划" /> }}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>大纲接口还没接上，所以这里不会编造节点。</Text>
    </Card>
  );
}
