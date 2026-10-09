import { Alert, Card, Descriptions, Table, Tag, Typography } from 'antd';

const { Text } = Typography;

const ROLES = [
  { role: '规划', model: '未配置', note: '章节计划和前置条件' },
  { role: '写作', model: '本地占位生成器', note: '固定样例正文，不调用外部 API' },
  { role: '审稿', model: '确定性规则', note: '目前只检查正文是否为空；语义审查未接入' },
  { role: '抽取', model: '与写作同一占位结果', note: '声明和抽取目前被写成同一份事件' },
];

export function SystemPage() {
  return (
    <Card title="系统设置">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="密钥、预算和平台连接还不能在这里保存"
        description="模型调用走服务端的占位生成器。升级配置要先在固定场景上比较，评估本身不会改采用稿、故事状态或发布队列。"
      />
      <Descriptions
        column={1}
        style={{ marginBottom: 20 }}
        items={[
          { key: 'store', label: '数据', children: '本地 SQLite，文件在 data/novel-studio.db。重启后作品还在。' },
          { key: 'auth', label: '鉴权', children: '未在页面配置。服务端只有设置了 API_TOKEN 才会要求 Bearer。' },
          { key: 'budget', label: '调用预算', children: <Tag>未配置</Tag> },
          { key: 'platform', label: '平台连接', children: <Tag>未连接</Tag> },
          { key: 'pause', label: '紧急暂停', children: '调度器还没接到页面，这里不能暂停后台任务。' },
        ]}
      />
      <Table
        size="middle"
        rowKey="role"
        pagination={false}
        dataSource={ROLES}
        columns={[
          { title: '角色', dataIndex: 'role', width: 100 },
          { title: '当前实现', dataIndex: 'model' },
          { title: '说明', dataIndex: 'note' },
        ]}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>这张表是当前进程的实际行为，不是已保存的模型配置。</Text>
    </Card>
  );
}
