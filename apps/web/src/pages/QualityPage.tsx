import { Alert, Card, Col, Empty, Row, Statistic, Table, Tag, Typography } from 'antd';

const { Text } = Typography;

export function QualityPage() {
  return (
    <Card title="质量">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="没跑完的检查不是通过"
        description="failed、inconclusive、unavailable 和缺失都会挡住采用。审查模型的意见要回到正文证据，不能直接当成已证实事实。"
      />
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}><Card size="small"><Statistic title="确定冲突" value={0} /></Card></Col>
        <Col xs={24} md={8}><Card size="small"><Statistic title="语义疑点" value={0} /></Card></Col>
        <Col xs={24} md={8}><Card size="small"><Statistic title="信息不足" value={0} /></Card></Col>
      </Row>
      <Table
        size="middle"
        rowKey="id"
        dataSource={[]}
        pagination={false}
        locale={{ emptyText: <Empty description="当前没有待处理问题" /> }}
        columns={[
          { title: '严重程度', dataIndex: 'severity', width: 110, render: () => <Tag>阻断采用</Tag> },
          { title: '位置', dataIndex: 'location' },
          { title: '为什么提出', dataIndex: 'reason' },
          { title: '证据', dataIndex: 'evidence' },
          { title: '状态', dataIndex: 'status' },
        ]}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>
        上面的 0 表示这份列表是空的，不表示全书已经检查通过。质量问题接口还没有接入。
      </Text>
    </Card>
  );
}
