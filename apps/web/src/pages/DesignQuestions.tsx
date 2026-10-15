import { Alert, Empty, Space, Table, Tag, Typography } from 'antd';
import type { QualityAuditDto } from 'novel-studio-contracts';

type Question = NonNullable<QualityAuditDto['questions']>[number];
const sources = { world: '世界包', story: '人物与故事设定', plan: '最新大纲' };
const blocking = (question: Question) => question.blocking && question.status !== 'resolved';
const category = (question: Question) => blocking(question) ? 'blocking' : question.status;
const priority = (question: Question) => blocking(question) ? 0 : question.status === 'resolved' ? 2 : 1;

export function DesignQuestions({ questions }: { questions: QualityAuditDto['questions'] }) {
  if (!questions) return <Alert type="info" showIcon message="当前服务尚未提供完整设计问题清单" description="可继续查看下方审计发现；不能据此认为大纲没有未决问题。" />;
  const blockers = questions.filter(blocking).length;
  const pending = questions.filter(q => q.status !== 'resolved').length;
  return <details>
    <summary>当前设计问题：{blockers} 条阻塞 · {pending} 条未解决 · 共 {questions.length} 条记录</summary>
    <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 12 }}>
      <Typography.Text type="secondary">汇总当前世界包、人物与故事设定及最新大纲。同名问题按来源分别保留；延期的阻塞项仍需解决。这里展示问题记录，内容评审通过不会自动关闭它们。</Typography.Text>
      <Table size="small" rowKey="id" dataSource={[...questions].sort((a, b) => priority(a) - priority(b))}
        scroll={{ x: 560 }} pagination={{ pageSize: 8, showSizeChanger: false }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选下没有问题记录；仍须完成内容评审" /> }} columns={[
          { title: '来源与版本', key: 'source', width: 150, filters: Object.entries(sources).map(([value, text]) => ({ value, text })),
            onFilter: (value, row) => row.source === value,
            render: (_, row) => `${sources[row.source]} v${row.revision}` },
          { title: '状态', key: 'status', width: 155,
            filters: [{ text: '阻塞（含延期）', value: 'blocking' }, { text: '待解决（不阻塞）', value: 'open' }, { text: '已延期（不阻塞）', value: 'deferred' }, { text: '已解决', value: 'resolved' }],
            onFilter: (value, row) => category(row) === value,
            render: (_, row) => <Tag color={blocking(row) ? 'error' : row.status === 'resolved' ? 'success' : 'default'}>
              {row.status === 'resolved' ? '已解决' : blocking(row) ? row.status === 'deferred' ? '已延期 · 仍阻塞' : '阻塞' : row.status === 'deferred' ? '已延期' : '待解决'}
            </Tag> },
          { title: '问题原文', key: 'question', render: (_, row) => <Space direction="vertical" size={4}>
            <Typography.Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.question}</Typography.Text>
            <Typography.Text type="secondary">问题编号：{row.questionId}</Typography.Text>
          </Space> },
        ]} />
    </Space>
  </details>;
}
