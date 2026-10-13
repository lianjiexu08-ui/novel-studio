import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Space, Table, Tag, Typography } from 'antd';
import type { QualityAuditDto } from 'novel-studio-contracts';
import { api } from '../api';

const areaLabels = { world: '世界观', power: '力量体系', timeline: '时间与地点', characters: '人物线', relationships: '人物关系', story: '故事线', plan: '分卷与章纲', manuscript: '成稿收束' };
const statusLabels = { blocked: '存在阻塞，先修设计与正文', needs_review: '仍需复查', ready: '结构检查通过' };
const severityLabels = { error: '阻塞', warning: '待复查', info: '说明' };
const colors = { error: 'error', warning: 'warning', info: 'default' };

export function DesignAuditCard({ workId, revision }: { workId: string; revision: number }) {
  const [audit, setAudit] = useState<QualityAuditDto | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  async function load() {
    const current = ++request.current;
    setLoading(true);
    setAudit(null);
    setError('');
    try {
      const result = await api.qualityAudit(workId);
      if (current === request.current) setAudit(result.audit);
    } catch (cause) {
      if (current === request.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [workId, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Card title="全书设计与连续性审计" extra={<Button loading={loading} onClick={() => void load()}>重新审计</Button>} loading={loading}>
    {error ? <Alert type="error" showIcon message="审计加载失败" description={error} /> : audit ? <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert showIcon type={audit.status === 'blocked' ? 'error' : audit.status === 'needs_review' ? 'warning' : 'info'} message={statusLabels[audit.status]} description="这里检查设定引用、人物与故事线覆盖、计划版本及收束记录。叙事质量尚未评审；结构通过不能代替逐章阅读和内容审核。" />
      <Typography.Text type="secondary">当前世界观 v{audit.scope.currentWorldPackRevision ?? '—'} · 故事圣经 v{audit.scope.currentStoryBibleRevision ?? '—'} · 批准计划 v{audit.scope.activePlanRevision ?? '—'}（绑定圣经 v{audit.scope.activePlanStoryBibleRevision ?? '—'}）· 成稿绑定圣经 v{audit.scope.manuscriptStoryBibleRevision ?? '—'}</Typography.Text>
      <Table size="small" rowKey="id" dataSource={[...audit.findings].sort((a, b) => ({ error: 0, warning: 1, info: 2 }[a.severity] - { error: 0, warning: 1, info: 2 }[b.severity]))} pagination={{ pageSize: 8 }} scroll={{ x: 600 }} locale={{ emptyText: '未发现结构问题；仍需审阅叙事质量' }} columns={[
        { title: '领域', dataIndex: 'area', width: 105, filters: Object.entries(areaLabels).map(([value, text]) => ({ value, text })), onFilter: (value, row) => row.area === value, render: (area: keyof typeof areaLabels) => areaLabels[area] },
        { title: '级别', dataIndex: 'severity', width: 95, filters: Object.entries(severityLabels).map(([value, text]) => ({ value, text })), onFilter: (value, row) => row.severity === value, render: (severity: keyof typeof severityLabels) => <Tag color={colors[severity]}>{severityLabels[severity]}</Tag> },
        { title: '问题与证据', key: 'finding', render: (_, row) => <Space direction="vertical" size={4}><Typography.Text>{row.message}</Typography.Text>{row.evidence && <Typography.Text type="secondary">依据：{row.evidence}</Typography.Text>}{row.recommendation && <Typography.Text>处理：{row.recommendation}</Typography.Text>}</Space> },
      ]} />
    </Space> : <Empty description="尚未加载审计" />}
  </Card>;
}
