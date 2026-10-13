import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Collapse, Empty, Modal, Select, Space, Tag, Typography } from 'antd';
import type { DesignContentReviewDto, DesignReviewAreaDto, DesignReviewOverviewDto } from 'novel-studio-contracts';
import { api } from '../api';

const labels = { world: '世界、势力与历史', power: '力量、功法与法宝', characters: '人物、关系与认知', story: '主线、分卷与章纲' };
const statuses = { missing: '尚未评审', outdated: '设计已变，需重评', passed: '本项设计通过', needs_revision: '需要返修', inconclusive: '材料不足' };
const verdicts = { pass: '通过', revise: '返修', insufficient: '材料不足' };
const criteria: Record<string, string> = { geography: '地理与势力', history: '历史因果', capacity: '长篇承载能力', tiers: '品阶与门槛', costs: '消耗与恢复', counters: '上限与反制', agency: '独立动机与选择', relationships: '关系变化', knowledge: '秘密与认知', causality: '情节因果', timeline: '时空与分卷', payoff: '铺垫与兑现', opening: '开篇递进' };

export function DesignContentReviewCard({ workId, revision, onReviewed }: { workId: string; revision: number; onReviewed: () => Promise<void> }) {
  const { message } = App.useApp();
  const [data, setData] = useState<DesignReviewOverviewDto | null>(null);
  const [error, setError] = useState('');
  const [planId, setPlanId] = useState<string>();
  const [busy, setBusy] = useState<DesignReviewAreaDto | null>(null);
  const [source, setSource] = useState<{ id: string; text: string } | null>(null);
  const request = useRef(0);
  const activeWork = useRef(workId);
  activeWork.current = workId;
  async function load() {
    const current = ++request.current;
    setData(null); setError('');
    try { const result = await api.designContentReviews(workId, planId); if (current === request.current) setData(result); }
    catch (cause) { if (current === request.current) setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  useEffect(() => { void load(); return () => { request.current += 1; }; }, [workId, revision, planId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { activeWork.current = workId; setBusy(null); setSource(null); setPlanId(undefined); return () => { activeWork.current = ''; }; }, [workId]);
  async function review(area: DesignReviewAreaDto) {
    setBusy(area);
    try {
      const { report } = await api.reviewDesignContent(workId, area, data?.selectedPlan?.id);
      if (activeWork.current !== workId) return;
      message.info(`${labels[area]}：${statuses[report.status]}`);
      await onReviewed();
      if (activeWork.current === workId) await load();
    } catch (cause) { if (activeWork.current === workId) message.error(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (activeWork.current === workId) setBusy(null); }
  }
  function details(report: DesignContentReviewDto) {
    return <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text type="secondary">世界 v{report.scope.worldPackRevision} · 圣经 v{report.scope.storyBibleRevision} · 计划 v{report.scope.planRevision} · {new Date(report.createdAt).toLocaleString()}</Typography.Text>
      <Typography.Paragraph>{report.summary}</Typography.Paragraph>
      {report.checks.map((check) => <Card size="small" key={check.criterion} title={<Space><Tag color={check.verdict === 'pass' ? 'success' : 'warning'}>{verdicts[check.verdict]}</Tag>{criteria[check.criterion] ?? check.criterion}</Space>}>
        <Typography.Paragraph>{check.explanation}</Typography.Paragraph>
        {check.evidence.map((item, index) => <div key={`${item.sourceId}-${index}`}><Button type="link" size="small" onClick={() => setSource(report.sources.find((entry) => entry.id === item.sourceId) ?? null)}>查看所审原文：{item.sourceId}</Button><blockquote style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.quote}</blockquote></div>)}
        {check.revisionAdvice && <Typography.Paragraph><strong>模型返修建议（待核对）：</strong>{check.revisionAdvice}</Typography.Paragraph>}
      </Card>)}
    </Space>;
  }
  return <Card title="分项内容评审" extra={<Button onClick={() => void load()}>刷新记录</Button>}>
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert type={data?.ready ? 'info' : 'warning'} showIcon message={data?.ready ? '所选计划的设计评审通过，写作仍需锁定和批准'  : '长篇写作前，先完成四项内容评审'} description="使用规划模型逐项审查内容，保存原文证据和返修建议。可以先评审待批准提案，评审不会批准计划；修改创作约定、设定或计划会使旧结论过期。模型建议尚未采纳，不会自动成为故事事实；设计通过也不代表已验收正文。" />
      {data?.plans?.length ? <Space wrap><Typography.Text>本次评审计划</Typography.Text><Select aria-label="本次评审计划" style={{ minWidth: 260 }} disabled={busy !== null} value={data.selectedPlan?.id} onChange={(value) => setPlanId(value)} options={data.plans.map((plan) => ({ value: plan.id, label: `计划 v${plan.revision} · ${{ proposed: '待批准提案', reviewed: '结构已审', approved: '当前批准版', superseded: '已替代' }[plan.status]}` }))} /><Typography.Text type="secondary">默认最新提案；写作仅使用批准版的评审。</Typography.Text></Space> : null}
      {busy && <Alert type="info" message={`正在评审${labels[busy]}，通常需要一到几分钟；不会修改设计或续写正文。`} />}
      {error ? <Alert type="error" message="评审记录加载失败" description={error} /> : data ? <>
        <Collapse items={data.areas.map((area) => {
          const report = data.reports.find((item) => item.id === area.reportId);
          return { key: area.area, label: <Space wrap>{labels[area.area]}<Tag color={area.status === 'passed' ? 'success' : 'warning'}>{statuses[area.status]}</Tag></Space>, extra: <Button size="small" loading={busy === area.area} disabled={busy !== null || !data.inputHash} onClick={(event) => { event.stopPropagation(); void review(area.area); }}>评审本项</Button>, children: report ? details(report) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无评审。先准备设计及计划提案，再评审本项。" /> };
        })} />
        <Collapse items={[{ key: 'history', label: `历史评审记录（${data.reports.length}）`, children: <Collapse items={[...data.reports].reverse().map((report) => ({ key: report.id, label: `${labels[report.area]} · ${statuses[report.status]} · ${new Date(report.createdAt).toLocaleString()}${report.inputHash !== data.inputHash ? '（已过期）' : ''}`, children: details(report) }))} /> }]} />
      </> : !error && <Typography.Text>正在加载评审记录…</Typography.Text>}
    </Space>
    <Modal open={source !== null} title={source?.id} footer={null} onCancel={() => setSource(null)} width={800}><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{source?.text}</pre></Modal>
  </Card>;
}
