import { useMemo, useState } from 'react';
import { Alert, Button, Input, Space, Table, Tag, Typography } from 'antd';
import { reviewSourceCoverage, type ReviewSourceInput } from '../design-review-coverage';

const statuses = { complete: '本步完整附带', partial: '本步只附部分', absent: '本步未直接附带', unknown: '范围信息无法核实' };

export function ReviewSourceCoverage({ input, onSource }: { input: ReviewSourceInput; onSource: (source: { id: string; text: string }) => void }) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => reviewSourceCoverage(input), [input]);
  const coverage = input.stage?.coverage;
  if (!coverage || !rows) return <Alert type="info" showIcon message="此批次未保存完整来源目录" description="可查看下方实际附带的材料；缺少范围信息不表示已核验全部原文。" />;
  const synthesis = coverage.synthesis;
  const needle = query.trim().toLocaleLowerCase();
  const filtered = rows.filter(row => `${row.id} ${row.name ?? ''}`.toLocaleLowerCase().includes(needle));
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Alert type="info" showIcon message={coverage.mode === 'reports_with_context'
      ? synthesis ? `${synthesis.scope === 'partial_reports' ? '局部报告汇总' : '全部报告汇总'}：涵盖 ${synthesis.coveredStageIds.length}/${synthesis.totalStages} 个原文核查步骤`
        : '报告汇总：此旧批次未记录所覆盖的步骤范围'
      : coverage.mode === 'whole_input' ? '本步材料范围：本领域全部原文' : '本步材料范围：局部原文'}
      description="下表核对本步直接附带的原文范围。未直接附带的内容可能在其他批次或报告引文中出现，不能据此断言设计缺失；完整附带也不表示模型正确理解或设计已通过。" />
    <Typography.Text type="secondary">来源目录共 {rows.length} 项；本步完整附带 {rows.filter(row => row.status === 'complete').length} 项、部分附带 {rows.filter(row => row.status === 'partial').length} 项。可按名称或来源编号定位，再打开实际材料核对。</Typography.Text>
    <Input aria-label="搜索评审来源" placeholder="搜索名称或来源编号，如第18章、ms_v2_voyage" allowClear value={query} onChange={event => setQuery(event.target.value)} />
    <Table size="small" rowKey="id" dataSource={filtered} locale={{ emptyText: '当前搜索或筛选下没有来源；这不表示设计内容缺失。' }} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 650 }} columns={[
      { title: '原始来源', key: 'source', render: (_, row) => <div style={{ overflowWrap: 'anywhere' }}><Typography.Text>{row.name ?? row.id}</Typography.Text>{row.name && <div><Typography.Text type="secondary">{row.id}</Typography.Text></div>}</div> },
      { title: '本步原文范围', key: 'coverage', width: 170, filters: Object.entries(statuses).map(([value, text]) => ({ value, text })), onFilter: (value, row) => row.status === value,
        render: (_, row) => <Tag color={row.status === 'partial' || row.status === 'unknown' ? 'warning' : 'default'}>{statuses[row.status]}</Tag> },
      { title: '实际附带材料', key: 'materials', width: 200, render: (_, row) => row.fragments.length
        ? row.fragments.map((fragment, index) => <Button key={`${fragment.id}/${index}`} type="link" size="small" onClick={() => onSource(fragment)}>打开片段 {index + 1}（{fragment.start}–{fragment.end}）</Button>)
        : <Typography.Text type="secondary">本步无可打开的原文片段</Typography.Text> },
    ]} />
  </Space>;
}
