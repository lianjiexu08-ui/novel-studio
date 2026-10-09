import { Alert, Card, Descriptions, Table, Tag, Typography } from 'antd';

const { Text } = Typography;

const ROLES = [
  { role: '规划', model: '服务端 OpenAI-compatible', note: '世界包、人物关系、力量体系和分卷大纲；配置缺失时明确报错' },
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
        message="模型连接由服务端环境变量管理"
        description="世界构建页会按 NOVEL_MODEL_ENDPOINT、NOVEL_MODEL_API_KEY 和 NOVEL_PLANNING_MODEL 调用规划模型；密钥不会写入浏览器或作品数据。"
      />
      <Descriptions
        column={1}
        style={{ marginBottom: 20 }}
        items={[
          { key: 'store', label: '数据', children: '本地 SQLite，文件在 data/novel-studio.db。重启后作品还在。' },
          { key: 'auth', label: '鉴权', children: '未在页面配置。服务端只有设置了 API_TOKEN 才会要求 Bearer。' },
          { key: 'budget', label: '调用预算', children: '可由 NOVEL_MODEL_BUDGET_USD 设置' },
          { key: 'platform', label: '平台连接', children: <Tag>未连接</Tag> },
          { key: 'pause', label: '紧急暂停', children: '章节生成仍采用候选 → 检查 → 采用门禁；任务中心的后台暂停控制待接入。' },
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
