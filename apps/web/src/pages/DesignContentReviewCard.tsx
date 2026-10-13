import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Collapse, Empty, Modal, Select, Space, Tag, Typography } from 'antd';
import type { DesignContentReviewDto, DesignReviewAreaDto, DesignReviewOverviewDto } from 'novel-studio-contracts';
import { api, type DesignReviewStageDetail } from '../api';

const labels = { world: '世界、势力与历史', power: '力量、功法与法宝', characters: '人物、关系与认知', story: '主线、分卷与章纲' };
const statuses = { missing: '尚未评审', outdated: '设计已变，需重评', passed: '本项设计通过', needs_revision: '需要返修', inconclusive: '材料不足', reviewing: '评审进行中', interrupted: '评审未完成' };
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
  const stopReview = useRef(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [stageDetail, setStageDetail] = useState<DesignReviewStageDetail | null>(null);
  const activeWork = useRef(workId);
  activeWork.current = workId;
  async function load() {
    const current = ++request.current;
    setData(null); setError('');
    try { const result = await api.designContentReviews(workId, planId); if (current === request.current) setData(result); }
    catch (cause) { if (current === request.current) setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  useEffect(() => { void load(); return () => { request.current += 1; }; }, [workId, revision, planId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { activeWork.current = workId; setBusy(null); setSource(null); setStageDetail(null); setPlanId(undefined); return () => { activeWork.current = ''; stopReview.current = true; }; }, [workId]);
  async function review(area: DesignReviewAreaDto) {
    setBusy(area); stopReview.current = false; setStopRequested(false);
    try {
      const { runId } = await api.startDesignReview(workId, area, data?.selectedPlan?.id);
      if (activeWork.current !== workId) return;
      await load();
      while (!stopReview.current && activeWork.current === workId) {
        const progress = await api.stepDesignReview(workId, runId);
        if (activeWork.current !== workId) return;
        await load();
        if (progress.status === 'completed') {
          message.info(`${labels[area]}评审已完成，请查看逐项结论。`);
          await onReviewed(); break;
        }
      }
    } catch (cause) {
      if (activeWork.current === workId) { message.error(cause instanceof Error ? cause.message : String(cause)); await load(); }
    } finally { if (activeWork.current === workId) setBusy(null); }
  }
  async function showStage(runId: string, stageId: string) {
    try { const detail = await api.designReviewStage(workId, runId, stageId); if (activeWork.current === workId) setStageDetail(detail); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : String(cause)); }
  }
  function details(report: Pick<DesignContentReviewDto, 'summary' | 'checks' | 'sources' | 'scope'> & { createdAt?: string }) {
    return <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text type="secondary">世界 v{report.scope.worldPackRevision} · 圣经 v{report.scope.storyBibleRevision} · 计划 v{report.scope.planRevision} {report.createdAt ? ` · ${new Date(report.createdAt).toLocaleString()}` : ''}</Typography.Text>
      <Typography.Paragraph>{report.summary}</Typography.Paragraph>
      {report.checks.map((check) => <Card size="small" key={check.criterion} title={<Space><Tag color={check.verdict === 'pass' ? 'success' : 'warning'}>{verdicts[check.verdict]}</Tag>{criteria[check.criterion] ?? check.criterion}</Space>}>
        <Typography.Paragraph>{check.explanation}</Typography.Paragraph>
        {check.evidence.map((item, index) => <div key={`${item.sourceId}-${index}`}><Button type="link" size="small" onClick={() => setSource(report.sources.find((entry) => entry.id === item.sourceId) ?? null)}>查看所审材料：{item.sourceId}</Button><blockquote style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.quote}</blockquote></div>)}
        {check.revisionAdvice && <Typography.Paragraph><strong>模型返修建议（待核对）：</strong>{check.revisionAdvice}</Typography.Paragraph>}
      </Card>)}
    </Space>;
  }
  return <Card title="分项内容评审" extra={<Button onClick={() => void load()}>刷新记录</Button>}>
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert type={data?.ready ? 'info' : 'warning'} showIcon message={data?.ready ? '所选计划的设计评审通过，写作仍需锁定和批准'  : '长篇写作前，先完成四项内容评审'} description="使用规划模型逐项审查内容，保存原文证据和返修建议。大材料先逐批审原文、对照各批之间的冲突，再综合结论；进度自动保存，刷新或失败后可继续。可以先评审待批准提案，评审不会批准计划；修改创作约定、设定或计划会使旧结论过期。模型建议尚未采纳，不会自动成为故事事实；设计通过也不代表已验收正文。" />
      {data?.plans?.length ? <Space wrap><Typography.Text>本次评审计划</Typography.Text><Select aria-label="本次评审计划" style={{ minWidth: 260 }} disabled={busy !== null} value={data.selectedPlan?.id} onChange={(value) => setPlanId(value)} options={data.plans.map((plan) => ({ value: plan.id, label: `计划 v${plan.revision} · ${{ proposed: '待批准提案', reviewed: '结构已审', approved: '当前批准版', superseded: '已替代' }[plan.status]}` }))} /><Typography.Text type="secondary">默认最新提案；写作仅使用批准版的评审。</Typography.Text></Space> : null}
      {busy && <Alert type="info" message={stopRequested ? '本批结束后停止，已完成进度会保留。' : `正在评审${labels[busy]}，每批可能需要几分钟。`} action={<Button disabled={stopRequested} onClick={() => { stopReview.current = true; setStopRequested(true); }}>本批后停止</Button>} />}
      {error ? <Alert type="error" message="评审记录加载失败" description={error} /> : data ? <>
        <Collapse items={data.areas.map((area) => {
          const report = data.reports.find((item) => item.id === area.reportId);
          return { key: area.area, label: <Space wrap>{labels[area.area]}<Tag color={area.status === 'passed' ? 'success' : 'warning'}>{statuses[area.status]}</Tag></Space>, extra: <Button size="small" loading={busy === area.area} disabled={busy !== null || !data.inputHash} onClick={(event) => { event.stopPropagation(); void review(area.area); }}>{['reviewing', 'interrupted'].includes(area.status) ? '继续本项' : '评审本项'}</Button>, children: report ? details(report) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无评审。先准备设计及计划提案，再评审本项。" /> };
        })} />
        {data.runs.filter((run, index, runs) => run.inputHash === data.inputHash && !runs.slice(index + 1).some(next => next.inputHash === data.inputHash && next.area === run.area)).map(run => <Card size="small" key={run.id} title={`${labels[run.area]} · ${run.stages.filter(stage => stage.completed).length}/${run.stages.length} 步`}>
          <Typography.Paragraph type="secondary">原文 {run.totalSources} 项 · {run.totalCharacters.toLocaleString()} 字符。{run.status === 'completed' ? '所有批次已完成，结论见上方。' : run.status === 'running' ? '一批正在执行；断线后需等执行结束或租约到期再继续。' : '未完成，不计为本项通过；继续时保留已完成批次。'}</Typography.Paragraph>
          <Collapse items={[{ key: 'stages', label: '查看批次、证据与失败记录', children: <Space direction="vertical" style={{ width: '100%' }}>{run.stages.map(stage => <div key={stage.id}>
            <Tag color={stage.verdict === 'passed' ? 'success' : stage.verdict ? 'warning' : stage.error ? 'error' : 'default'}>{stage.verdict ? stage.verdict === 'passed' ? '本批通过' : statuses[stage.verdict] : stage.error ? '失败可重试' : '待审'}</Tag>{stage.label}
            {(stage.completed || stage.error) && <Button type="link" size="small" onClick={() => void showStage(run.id, stage.id)}>原文与结果</Button>}
            {stage.error && <Typography.Paragraph type="danger">{stage.error}</Typography.Paragraph>}
          </div>)}</Space> }]} />
        </Card>)}
        <Collapse items={[{ key: 'history', label: `历史评审记录（${data.reports.length}）`, children: <Collapse items={[...data.reports].reverse().map((report) => ({ key: report.id, label: `${labels[report.area]} · ${statuses[report.status]} · ${new Date(report.createdAt).toLocaleString()}${report.inputHash !== data.inputHash ? '（已过期）' : ''}`, children: details(report) }))} /> }]} />
      </> : !error && <Typography.Text>正在加载评审记录…</Typography.Text>}
    </Space>
    <Modal open={stageDetail !== null} title={stageDetail?.stage.label ?? '批次详情'} footer={null} onCancel={() => setStageDetail(null)} width={900}>
      {stageDetail && <Space direction="vertical" style={{ width: '100%' }}>
        <Alert type="info" showIcon message={stageDetail.stage.kind === 'synthesis' ? '本步综合前置评审报告，引用材料是报告，不是故事原文。' : '本批结论只覆盖下列材料，不代表整项设计通过。'} />
        {stageDetail.stage.error && <Alert type="error" message="本批尚未完成" description={stageDetail.stage.error} />}
        {stageDetail.stage.result && details({ ...stageDetail.stage.result, sources: stageDetail.input.sources, scope: stageDetail.input.scope })}
        <Collapse style={{ width: '100%' }} items={[
          { key: 'materials', label: `查看全部所审材料（${stageDetail.input.sources.length} 项）`, children: <Space direction="vertical">{stageDetail.input.sources.map(item => {
            const original = stageDetail.input.stage?.sourceMap.find(unit => unit.id === item.id);
            return <Button key={item.id} type="link" onClick={() => setSource(item)}>{original ? `${original.sourceId} · 字符 ${original.start}–${original.end}` : item.id}</Button>;
          })}</Space> },
          { key: 'diagnostics', label: `模型原答与失败记录（执行 ${stageDetail.stage.attempts} 次）`, children: <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify({ modelResponses: stageDetail.stage.modelResponses, failures: stageDetail.stage.failures, rejectedResult: stageDetail.stage.rejectedResult }, null, 2)}</pre> },
        ]} />
      </Space>}
    </Modal>
    <Modal open={source !== null} title={source?.id} footer={null} onCancel={() => setSource(null)} width={800}><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{source?.text}</pre></Modal>
  </Card>;
}
