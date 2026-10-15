import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, App, Button, Card, Collapse, Empty, Modal, Select, Space, Tag, Typography } from 'antd';
import type { DesignContentReviewDto, DesignContentReviewSummaryDto, DesignReviewAreaDto, DesignReviewSummaryDto } from 'novel-studio-contracts';
import { api, type DesignReviewStageDetail } from '../api';

const labels = { world: '世界、势力与历史', power: '力量、功法与法宝', characters: '人物、关系与认知', story: '主线、分卷与章纲' };
const statuses = { missing: '尚未评审', outdated: '设计已变，需重评', passed: '本项设计通过', needs_revision: '需要返修', inconclusive: '材料不足', reviewing: '评审进行中', interrupted: '评审未完成' };
const verdicts = { pass: '通过', revise: '返修', insufficient: '材料不足' };
const insufficiencyReasons = { missing_design: '设计内容缺失', unlocatable_sources: '尚无法定位所需材料', capacity_limit: '完整核验材料超出本次容量' };
const criteria: Record<string, string> = { geography: '地理与势力', history: '历史因果', capacity: '长篇承载能力', tiers: '品阶与门槛', costs: '消耗与恢复', counters: '上限与反制', agency: '独立动机与选择', relationships: '关系变化', knowledge: '秘密与认知', causality: '情节因果', timeline: '时空与分卷', payoff: '铺垫与兑现', opening: '开篇递进', pacing: '节奏与场次', genre: '题材体验与成长', growth: '近期成长目标与回报' };
type ReviewRun = DesignReviewSummaryDto['runs'][number];

function LazyReviewReport({ workId, report, render }: { workId: string; report: DesignContentReviewSummaryDto; render: (report: DesignContentReviewDto) => ReactNode }) {
  const [detail, setDetail] = useState<DesignContentReviewDto>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // Older API versions embed full reports. Keep their evidence usable during
  // a rolling upgrade without calling an endpoint they do not yet support.
  const embedded = 'sources' in report && 'checks' in report ? report as DesignContentReviewDto : undefined;
  useEffect(() => {
    if (embedded) return;
    let cancelled = false;
    setDetail(undefined); setError('');
    void api.designContentReview(workId, report.id).then(({ report: full }) => {
      if (!cancelled) setDetail(full);
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [workId, report.id, embedded, attempt]);
  if (embedded || detail) return render(embedded ?? detail!);
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Typography.Text type="secondary">世界 v{report.scope.worldPackRevision} · 圣经 v{report.scope.storyBibleRevision} · 计划 v{report.scope.planRevision}</Typography.Text>
    <Typography.Paragraph>{report.summary}</Typography.Paragraph>
    {error ? <Alert type="error" message="评审详情加载失败" description={error} action={<Button onClick={() => setAttempt(value => value + 1)}>重试</Button>} /> : <Typography.Text>正在加载逐项结论与原文证据…</Typography.Text>}
  </Space>;
}

export function DesignContentReviewCard({ workId, revision, onReviewed }: { workId: string; revision: number; onReviewed: () => Promise<void> }) {
  const { message } = App.useApp();
  const [data, setData] = useState<DesignReviewSummaryDto | null>(null);
  const [error, setError] = useState('');
  const [planId, setPlanId] = useState<string>();
  const [busy, setBusy] = useState<DesignReviewAreaDto | null>(null);
  const [source, setSource] = useState<{ id: string; text: string } | null>(null);
  const request = useRef(0);
  const pendingLoad = useRef<number | null>(null);
  const revisionToken = useRef<string>();
  const nextPollAt = useRef(0);
  const [refreshedAt, setRefreshedAt] = useState<string>();
  const stopReview = useRef(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [stageDetail, setStageDetail] = useState<DesignReviewStageDetail | null>(null);
  const activeWork = useRef(workId);
  activeWork.current = workId;
  const load = useCallback(async (reset = false, background = false) => {
    if (background && pendingLoad.current !== null) return;
    const current = ++request.current;
    pendingLoad.current = current;
    if (reset) { setData(null); setRefreshedAt(undefined); setError(''); revisionToken.current = undefined; }
    try {
      const result = await api.pollDesignContentReviews(workId, planId, revisionToken.current);
      if (current === request.current) {
        if (!result.unchanged) setData(result);
        revisionToken.current = result.revisionToken;
        // Older servers return the full history; poll less often until upgraded.
        nextPollAt.current = Date.now() + (result.revisionToken ? 15_000 : 60_000);
        setError(''); setRefreshedAt(new Date().toLocaleTimeString());
      }
    }
    catch (cause) { if (current === request.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (pendingLoad.current === current) pendingLoad.current = null; }
  }, [workId, planId]);
  useEffect(() => {
    void load(true);
    const refreshVisible = () => { if (document.visibilityState === 'visible') void load(false, true); };
    const timer = window.setInterval(() => { if (Date.now() >= nextPollAt.current) refreshVisible(); }, 15_000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      request.current += 1;
      pendingLoad.current = null;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [load, revision]);
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
  function details(report: Pick<DesignContentReviewDto, 'summary' | 'checks' | 'sources' | 'scope' | 'resolvedDeferrals'> & { createdAt?: string }) {
    return <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text type="secondary">世界 v{report.scope.worldPackRevision} · 圣经 v{report.scope.storyBibleRevision} · 计划 v{report.scope.planRevision} {report.createdAt ? ` · ${new Date(report.createdAt).toLocaleString()}` : ''}</Typography.Text>
      <Typography.Paragraph>{report.summary}</Typography.Paragraph>
      {report.resolvedDeferrals?.length ? <Collapse size="small" style={{ width: '100%' }} items={[{
        key: 'deferrals', label: `补读复核记录（${report.resolvedDeferrals.length} 项）`,
        children: <Typography.Paragraph>已完成的补读复核：{report.resolvedDeferrals.map(item => `${item.checkId} → ${item.resolvedByStageId}`).join('；')}。原问题与引用仍保留在批次记录中。</Typography.Paragraph>,
      }]} /> : null}
      {report.checks.map((check) => <Card size="small" key={check.criterion} title={<Space><Tag color={check.verdict === 'pass' ? 'success' : 'warning'}>{check.awaitingSources ? '等待跨批补读' : verdicts[check.verdict]}</Tag>{criteria[check.criterion] ?? check.criterion}</Space>}>
        <Typography.Paragraph>{check.explanation}</Typography.Paragraph>
        {check.insufficiencyReason && <Typography.Paragraph type="secondary">不足原因：{insufficiencyReasons[check.insufficiencyReason]}。仍需补充或独立复核，不代表通过。</Typography.Paragraph>}
        {check.awaitingSources && <Typography.Paragraph>待核来源：{check.awaitingSources.join('、')}。其他批次须读取原文并明确复核，目录存在不等于通过。</Typography.Paragraph>}
        {check.resolves && <Typography.Paragraph>本批依据原文解决的补读项：{check.resolves.join('、')}</Typography.Paragraph>}
        {check.revisionAdvice && <Typography.Paragraph><strong>模型返修建议（待核对）：</strong>{check.revisionAdvice}</Typography.Paragraph>}
        {check.evidence.length > 0 && <Collapse size="small" items={[{
          key: 'evidence', label: `${criteria[check.criterion] ?? check.criterion}的原文证据（${check.evidence.length} 条）`,
          children: <Space direction="vertical" style={{ width: '100%' }}>{check.evidence.map((item, index) => <div key={`${item.sourceId}-${index}`} style={{ width: '100%' }}>
            <Typography.Text type="secondary">证据 {index + 1} · {item.sourceId.startsWith('review-result/') ? '前置评审报告摘录' : item.sourceId.startsWith('review-question/') ? '待补读问题' : '所审材料摘录'}</Typography.Text>
            <Button type="link" size="small" onClick={() => setSource(report.sources.find((entry) => entry.id === item.sourceId) ?? null)}>查看所审材料：{item.sourceId}</Button>
            <blockquote style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.quote}</blockquote>
          </div>)}</Space>,
        }]} />}
      </Card>)}
    </Space>;
  }
  function runDetails(run: ReviewRun, historical = false) {
    const revisions = run.stages.filter(stage => stage.verdict === 'needs_revision');
    const incomplete = run.stages.filter(stage => stage.verdict === 'inconclusive').length;
    return <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text type="secondary">世界 v{run.scope.worldPackRevision} · 圣经 v{run.scope.storyBibleRevision} · 计划 v{run.scope.planRevision} · {new Date(run.createdAt).toLocaleString()}</Typography.Text>
      <Typography.Paragraph type="secondary">原文 {run.totalSources} 项 · {run.totalCharacters.toLocaleString()} 字符。{historical
        ? run.reportId ? '已形成最终报告，具体结论可在历史评审记录中查看。' : '尚未形成最终报告，已保存的批次和失败记录仍可查阅。'
        : run.status === 'completed' ? '所有批次已完成，结论见上方。' : run.status === 'running' ? '一批正在执行；断线后需等执行结束或租约到期再继续。' : '未完成，不计为本项通过；继续时保留已完成批次。'}</Typography.Paragraph>
      {!historical && run.status !== 'completed' && <Typography.Text type="secondary">补读可能增加总步数。已完成的批次不等于本项设计通过，最终结论须等全部核验完成。</Typography.Text>}
      {!historical && revisions.length > 0 && <Alert type="warning" showIcon message={`已有 ${revisions.length} 个批次提出返修`} description={<Space direction="vertical">
        <Typography.Text>这是已保存的批次意见，需对照原文核实；后续结论和修订不会抹去这些记录。</Typography.Text>
        {revisions.map(stage => <Button key={stage.id} type="link" size="small" style={{ height: 'auto', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => void showStage(run.id, stage.id)}>查看返修证据：{stage.label}</Button>)}
      </Space>} />}
      {!historical && incomplete > 0 && <Typography.Text type="secondary">另有 {incomplete} 个批次曾标记材料不足，补读及处理结果见批次与最终报告；不计为通过，也不直接等同于已确认的设定错误。</Typography.Text>}
      <Collapse style={{ width: '100%' }} items={[{ key: 'stages', label: '查看批次、证据与失败记录', children: <Space direction="vertical" style={{ width: '100%' }}>{run.stages.map(stage => <div key={stage.id}>
        <Tag color={stage.verdict === 'passed' ? 'success' : stage.verdict ? 'warning' : stage.error ? 'error' : 'default'}>{stage.verdict ? stage.verdict === 'passed' ? '本批通过' : statuses[stage.verdict] : stage.error ? historical ? '有失败记录' : '失败可重试' : '待审'}</Tag>{stage.label}
        {(stage.completed || stage.error || stage.attempts > 0) && <Button type="link" size="small" onClick={() => void showStage(run.id, stage.id)}>原文与结果</Button>}
        {stage.error && <Typography.Paragraph type="danger">{stage.error}</Typography.Paragraph>}
      </div>)}</Space> }]} />
    </Space>;
  }
  function reportDetails(report: DesignContentReviewSummaryDto) {
    return <LazyReviewReport key={`${workId}/${report.id}`} workId={workId} report={report} render={details} />;
  }
  const currentRuns = data?.runs.filter((run, index, runs) => run.inputHash === data.inputHash && !runs.slice(index + 1).some(next => next.inputHash === data.inputHash && next.area === run.area)) ?? [];
  const currentRunIds = new Set(currentRuns.map(run => run.id));
  const historicalRuns = data?.runs.filter(run => !currentRunIds.has(run.id)).reverse() ?? [];
  return <Card title="分项内容评审" extra={<Button onClick={() => void load()}>刷新记录</Button>}>
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Text type="secondary">页面可见时自动刷新评审记录，切回页面时立即刷新。{refreshedAt ? `最近检查：${refreshedAt}。` : ''}刷新只读取进度，不会启动或继续评审。</Typography.Text>
      <Alert type={data?.ready ? 'info' : 'warning'} showIcon message={data?.ready ? '所选计划的设计评审通过，写作仍需锁定和批准'  : '长篇写作前，先完成四项内容评审'} description="使用规划模型逐项审查内容，保存原文证据和返修建议。大材料先逐批审原文、对照各批之间的冲突，再综合结论；进度自动保存，刷新或失败后可继续。可以先评审待批准提案，评审不会批准计划；修改创作约定、设定或计划会使旧结论过期。模型建议尚未采纳，不会自动成为故事事实；设计通过也不代表已验收正文。" />
      {data?.plans?.length ? <Space wrap><Typography.Text>本次评审计划</Typography.Text><Select aria-label="本次评审计划" style={{ minWidth: 260 }} disabled={busy !== null} value={data.selectedPlan?.id} onChange={(value) => setPlanId(value)} options={data.plans.map((plan) => ({ value: plan.id, label: `计划 v${plan.revision} · ${{ proposed: '待批准提案', reviewed: '结构已审', approved: '当前批准版', superseded: '已替代' }[plan.status]}` }))} /><Typography.Text type="secondary">默认最新提案；写作仅使用批准版的评审。</Typography.Text></Space> : null}
      {busy && <Alert type="info" message={stopRequested ? '本批结束后停止，已完成进度会保留。' : `正在评审${labels[busy]}，每批可能需要几分钟。`} action={<Button disabled={stopRequested} onClick={() => { stopReview.current = true; setStopRequested(true); }}>本批后停止</Button>} />}
      {error && <Alert type="error" message={data ? '评审记录刷新失败，以下仍为上次成功读取的记录' : '评审记录加载失败'} description={error} />}
      {data ? <>
        <Collapse items={data.areas.map((area) => {
          const report = data.reports.find((item) => item.id === area.reportId);
          const run = currentRuns.find(item => item.area === area.area);
          return { key: area.area, label: <Space wrap>{labels[area.area]}<Tag color={area.status === 'passed' ? 'success' : 'warning'}>{statuses[area.status]}</Tag></Space>, extra: <Button size="small" loading={busy === area.area} disabled={busy !== null || !data.inputHash} onClick={(event) => { event.stopPropagation(); void review(area.area); }}>{['reviewing', 'interrupted'].includes(area.status) ? '继续本项' : '评审本项'}</Button>, children: report ? reportDetails(report) : run ? <Alert type="info" showIcon message={`已保存 ${run.stages.filter(stage => stage.completed).length}/${run.stages.length} 步，尚未形成最终报告`} description="请在下方当前任务中查看批次结论、返修证据及失败记录。本项仍未通过内容验收。" /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无当前设计的评审任务。先准备设计及计划提案，再评审本项。" /> };
        })} />
        {currentRuns.map(run => <Card size="small" key={run.id} title={`${labels[run.area]} · ${run.stages.filter(stage => stage.completed).length}/${run.stages.length} 步`}>{runDetails(run)}</Card>)}
        {historicalRuns.length > 0 && <Collapse items={[{ key: 'run-history', label: `历史评审任务与批次（${historicalRuns.length}）`, children: <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary">保留旧版本及同一设计的较早任务，包括未形成最终报告的失败或中断任务。这些历史记录不代表当前所选设计通过；继续评审请使用上方对应项目的入口。</Typography.Paragraph>
          <Collapse style={{ width: '100%' }} items={historicalRuns.map(run => ({ key: run.id, label: <Space wrap>{labels[run.area]} · 计划 v{run.scope.planRevision} · {run.stages.filter(stage => stage.completed).length}/{run.stages.length} 步<Tag>{run.inputHash !== data.inputHash ? '与当前所选设计或计划不同' : '同一设计的较早任务'}</Tag><Typography.Text type="secondary">{new Date(run.createdAt).toLocaleString()}</Typography.Text></Space>, children: runDetails(run, true) }))} />
        </Space> }]} />}
        <Collapse items={[{ key: 'history', label: `历史评审记录（${data.reports.length}）`, children: <Collapse items={[...data.reports].reverse().map((report) => ({ key: report.id, label: `${labels[report.area]} · ${statuses[report.status]} · ${new Date(report.createdAt).toLocaleString()}${report.inputHash !== data.inputHash ? '（已过期）' : ''}`, children: reportDetails(report) }))} /> }]} />
      </> : !error && <Typography.Text>正在加载评审记录…</Typography.Text>}
    </Space>
    <Modal open={stageDetail !== null} title={stageDetail ? `${stageDetail.stage.label} · 计划 v${stageDetail.input.scope.planRevision}` : '批次详情'} footer={null} onCancel={() => setStageDetail(null)} width={900}>
      {stageDetail && <Space direction="vertical" style={{ width: '100%' }}>
        {stageDetail.input.inputHash !== data?.inputHash && <Alert type="warning" showIcon message="此批次对应的设计或计划与当前所选版本不同，仅供历史核查。" />}
        {!stageDetail.stage.result && <Typography.Text type="secondary">世界 v{stageDetail.input.scope.worldPackRevision} · 圣经 v{stageDetail.input.scope.storyBibleRevision} · 计划 v{stageDetail.input.scope.planRevision}</Typography.Text>}
        <Alert type="info" showIcon message={stageDetail.stage.kind === 'synthesis' ? '本步综合前置评审报告；新版流程另附计划原文。请按来源区分报告转述与原始设计。' : '本批结论只覆盖下列材料，不代表整项设计通过。'} />
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
