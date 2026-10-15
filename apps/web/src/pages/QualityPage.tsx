import { DesignContentReviewCard } from './DesignContentReviewCard';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Col, Empty, InputNumber, Modal, Row, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useOutletContext } from 'react-router-dom';
import { api, ApiRequestError, type ChapterHistoryDto, type ChapterReviewSourceDto } from '../api';
import type { ManuscriptRevisionDto } from 'novel-studio-contracts';
import type { WorkspaceContext } from './Workspace';
import { DesignAuditCard } from './DesignAuditCard';

const { Text, Title } = Typography;

function valueOf(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function QualityPage() {
  const { message } = AntApp.useApp();
  const { work, refresh } = useOutletContext<WorkspaceContext>();
  const [chapter, setChapter] = useState(1);
  const [history, setHistory] = useState<ChapterHistoryDto | null>(null);
  const [manuscripts, setManuscripts] = useState<ManuscriptRevisionDto[]>([]);
  const [loading, setLoading] = useState(false);
  const loadRequest = useRef(0);
  const [selectedCheckId, setSelectedCheckId] = useState<string>();
  const [reviewSource, setReviewSource] = useState<{ id: string; data?: ChapterReviewSourceDto; error?: string } | null>(null);
  const [rawSource, setRawSource] = useState(false);
  const sourceRequest = useRef(0);
  const formattedSource = useMemo(() => {
    const text = reviewSource?.data?.source.text ?? '';
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
  }, [reviewSource?.data?.source.text]);
  const relationships = history?.relationships.filter((row): row is NonNullable<typeof row> => Boolean(row)) ?? [];
  const currentChapterReview = history?.quality.candidate?.checks.find(check => check.checker === 'chapter_content_review');
  const reviewRecords = history?.quality.candidate?.checkHistory?.filter(check => check.chapterReview
    && (check.chapterReview.result || check.chapterReview.error || check.id === currentChapterReview?.id)) ?? [];
  const chapterReview = reviewRecords.find(check => check.id === selectedCheckId) ?? currentChapterReview;
  const chapterStages = history?.quality.candidate?.checkHistory?.flatMap(check => check.chapterReview?.stage
    ? [{ ...check.chapterReview.stage, checkId: check.id, checkedAt: check.checkedAt, superseded: check.chapterReview.superseded }] : []) ?? [];
  const reviewLabels = { causality: '因果与转折', characters: '人物选择与认知', power: '力量与代价', continuity: '事实连续性', obligations: '章纲兑现', prose: '场景与阅读效果' };
  const characterName = (id: string) => {
    const name = history?.characterNames?.[id];
    return typeof name === 'string' && name ? name : id;
  };

  function closeReviewSource() { sourceRequest.current++; setReviewSource(null); }

  async function showReviewSource(sourceId: string) {
    const candidateId = history?.quality.candidate?.id, checkId = chapterReview?.id;
    if (!candidateId || !checkId) return;
    const request = ++sourceRequest.current;
    setRawSource(false);
    setReviewSource({ id: sourceId });
    try {
      const data = await api.chapterReviewSource(work.id, candidateId, checkId, sourceId);
      if (request === sourceRequest.current) setReviewSource({ id: sourceId, data });
    } catch (error) {
      if (request === sourceRequest.current) setReviewSource({ id: sourceId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function load(chapterNumber = chapter, candidateId?: string) {
    const request = ++loadRequest.current;
    setSelectedCheckId(undefined); closeReviewSource();
    setLoading(true);
    try {
      const result = await api.history(work.id, chapterNumber, candidateId);
      if (request === loadRequest.current) setHistory(result);
    }
    catch (error) { if (request === loadRequest.current) message.error(error instanceof ApiRequestError ? '[' + error.code + '] ' + error.message : String(error)); }
    finally { if (request === loadRequest.current) setLoading(false); }
  }

  useEffect(() => {
    let cancelled = false;
    setChapter(1);
    setHistory(null);
    setManuscripts([]);
    void load(1);
    void api.manuscripts(work.id).then((result) => { if (!cancelled) setManuscripts(result.manuscripts); }).catch(() => { if (!cancelled) setManuscripts([]); });
    return () => { cancelled = true; loadRequest.current++; sourceRequest.current++; };
  }, [work.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return <section className="page">
    <header className="page-head"><div><p className="page-kicker">复查</p><Title level={4} style={{ margin: 0 }}>章节质量与状态</Title><p className="page-desc">选择一个章节，查看已采用正文中的事实与角色状态；关系逐条标明正文事件、作者设定或创作计划，未落实的故事线标为计划。</p></div><Space><InputNumber min={1} max={450} value={chapter} onChange={(value) => setChapter(value ?? 1)} /><Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={() => void load(chapter, chapter === history?.chapterNumber ? history.quality.candidate?.id : undefined)}>加载第 {chapter} 章</Button></Space></header>
    <DesignAuditCard workId={work.id} revision={work.constraintRevision} />
    <DesignContentReviewCard workId={work.id} revision={work.constraintRevision} onReviewed={refresh} />
    {!history ? <div className="state-block"><Spin size="large" /></div> : <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="info" showIcon message={'截至第 ' + history.chapterNumber + ' 章'} description={'事件 ' + history.events.length + ' 条，角色状态 ' + history.characterStates.length + ' 条，角色认知 ' + history.knowledgeStates.length + ' 条，关系 ' + history.relationships.filter(Boolean).length + ' 条，分卷进度 ' + history.volumeStates.length + ' 条，弧光进度 ' + history.arcStates.length + ' 条，秘密记录 ' + history.secretStates.length + ' 条，承诺/开放线收束 ' + (history.promiseStates.length + history.threadStates.length) + ' 条。'} />
      <Alert type={history.quality.closureCoverage.ready ? 'success' : 'warning'} showIcon message="全书收束覆盖" description={`分卷 ${history.quality.closureCoverage.resolved.volumes}/${history.quality.closureCoverage.expected.volumes}，弧光 ${history.quality.closureCoverage.resolved.arcs}/${history.quality.closureCoverage.expected.arcs}，秘密 ${history.quality.closureCoverage.resolved.secrets}/${history.quality.closureCoverage.expected.secrets}，承诺 ${history.quality.closureCoverage.resolved.promises}/${history.quality.closureCoverage.expected.promises}，开放线 ${history.quality.closureCoverage.resolved.threads}/${history.quality.closureCoverage.expected.threads}${history.quality.closureCoverage.errors.length ? `；待处理：${history.quality.closureCoverage.errors.slice(0, 3).join('；')}` : ''}`} />
      <Card title="冻结书稿版本" size="small">
        {manuscripts.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有冻结书稿" /> : <Table size="small" pagination={false} rowKey="id" dataSource={manuscripts} columns={[
          { title: '版本', dataIndex: 'revision', render: (value: number, row: ManuscriptRevisionDto) => <Space><Tag color={row.status === 'final' ? 'success' : 'default'}>{row.status === 'final' ? '当前冻结版' : '历史版本'}</Tag><span>rev {value}</span></Space> },
          { title: '章节', dataIndex: 'chapterCount', render: (value: number) => `${value} 章` },
          { title: '字数覆盖', key: 'coverage', render: (_: unknown, row: ManuscriptRevisionDto) => `${row.wordCount.toLocaleString()} / ${row.targetWordCount.toLocaleString()}（${Math.round(row.lengthCoverage * 100)}%）` },
          { title: '设计版本', key: 'design', render: (_: unknown, row: ManuscriptRevisionDto) => `World ${row.worldPackRevision} / Bible ${row.storyBibleRevision}` },
        ]} />}
      </Card>
      <Card title="独立正文评审">
        <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
          {!!history.quality.reviewCandidates?.length && <><Text strong>选择评审稿</Text><Select aria-label="选择评审稿" style={{ width: '100%' }} disabled={loading}
            value={history.quality.candidate?.id} onChange={value => void load(history.chapterNumber, value)}
            options={history.quality.reviewCandidates.map((item, index, rows) => ({ value: item.id,
              label: `${item.isCurrentVersion ? '当前采纳稿' : item.status === 'adopted' ? '历史采纳稿' : item.origin === 'demo' ? '试写稿' : item.status === 'rejected' ? '已驳回候选' : '待采纳候选'} · 第 ${rows.length - index} 稿 · ${new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}${item.stale ? '（已过期）' : ''}`,
            }))} /></>}
          <Text type="secondary">{history.quality.version ? `事实与人物状态仍依据当前采纳稿（版本 ${history.quality.version.revision}）重建；选择其他评审稿不会将其内容变成已发生事实。` : '本章尚无采纳稿；候选内容与评审意见不计入本章事实。'}</Text>
          {history.quality.candidate?.content && <details key={history.quality.candidate.id}><summary>查看所选评审稿正文</summary><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{history.quality.candidate.content}</p></details>}
          {reviewRecords.length > 1 && <><Text strong>选择评审记录</Text><Select aria-label="选择评审记录" style={{ width: '100%' }} value={chapterReview?.id}
            onChange={value => { setSelectedCheckId(value); closeReviewSource(); }} options={[...reviewRecords].reverse().map(check => ({ value: check.id,
              label: `${check.id === currentChapterReview?.id ? '当前评审' : '历史评审'} · ${new Date(check.checkedAt).toLocaleString('zh-CN', { hour12: false })} · ${{ passed: '通过', failed: '返修', inconclusive: '材料不足', unavailable: '未完成或失效' }[check.status]}`,
            }))} /></>}
        </Space>
        {!chapterReview ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无独立正文评审；规则检查通过不代表正文质量通过" /> : <Space direction="vertical" style={{ width: '100%' }}>
          {chapterReview.id !== currentChapterReview?.id && <Alert type="info" showIcon message="正在查看历史评审；此结论不替代当前评审结果。" />}
          <Alert type={chapterReview.status === 'passed' ? 'success' : chapterReview.status === 'failed' ? 'error' : 'warning'} showIcon
            message={chapterReview.status === 'passed' ? '正文评审通过' : chapterReview.status === 'failed' ? '正文评审需要返修' : chapterReview.status === 'inconclusive' ? '评审材料不足，暂不能采纳' : '评审未完成或已失效，暂不能采纳'} description={chapterReview.message} />
          <Table size="small" pagination={false} rowKey="criterion" dataSource={chapterReview.chapterReview?.result?.checks ?? []} columns={[
            { title: '维度', dataIndex: 'criterion', render: (value: string) => reviewLabels[value as keyof typeof reviewLabels] ?? (value.startsWith('execution/') ? <Space direction="vertical" size={0} style={{ overflowWrap: 'anywhere' }}><Text>逐章验收 · {value.slice('execution/'.length)}</Text>{chapterReview.chapterReview?.inputAvailable && <Button type="link" size="small" onClick={() => void showReviewSource('brief')}>查看本次验收要求</Button>}</Space> : value) },
            { title: '结论', dataIndex: 'verdict', render: (value: string) => <Tag color={value === 'pass' ? 'success' : value === 'revise' ? 'error' : 'warning'}>{value === 'pass' ? '通过' : value === 'revise' ? '返修' : '材料不足'}</Tag> },
            { title: '理由', dataIndex: 'explanation' }, { title: '修改要求', dataIndex: 'revisionAdvice' },
          ]} expandable={{ expandedRowRender: row => <Space direction="vertical">{row.evidence.map((item, index) => <div key={index}>
            <Text>[{item.sourceId}] {item.quote}</Text>
            {chapterReview.id && chapterReview.chapterReview?.inputAvailable && <Button type="link" size="small" onClick={() => void showReviewSource(item.sourceId)}>查看本次所审原文</Button>}
          </div>)}</Space> }} />
          {!chapterReview.chapterReview?.inputAvailable && <Text type="secondary">此记录没有可查看的原材料快照；保留结论与已有引文，不用当前设定补成历史原文。</Text>}
          {chapterStages.length > 0 && <details><summary>分批审读记录（{chapterStages.length}）</summary>
            <Text type="secondary">保留每次批次、交叉检查和综合的历史结论；单批完成不代表整章通过。展开查看原文证据。</Text>
            <Table size="small" rowKey={row => row.checkId ?? row.id + row.checkedAt} pagination={{ pageSize: 6 }} dataSource={chapterStages} columns={[
              { title: '步骤', dataIndex: 'label' }, { title: '尝试', dataIndex: 'attempts' },
              { title: '记录', render: (_, row) => <Space direction="vertical" size={0}><Text>{row.checkedAt}</Text>{row.superseded && <Tag>迟到结果，仅供复查</Tag>}</Space> },
              { title: '结果', render: (_, row) => row.error || row.result?.summary || '尚未完成' },
            ]} expandable={{ expandedRowRender: row => <Space direction="vertical">{row.result?.checks.map(check => <div key={check.criterion}>
              <Text strong>{reviewLabels[check.criterion as keyof typeof reviewLabels] ?? (check.criterion.startsWith('execution/') ? `逐章验收 · ${check.criterion.slice('execution/'.length)}` : check.criterion)} · {check.verdict === 'pass' ? '本批通过' : check.verdict === 'revise' ? '返修' : '材料不足'}</Text>
              <p>{check.explanation} {check.revisionAdvice}</p>{check.evidence.map((item, index) => <p key={index}>[{item.sourceId}] {item.quote}</p>)}
            </div>)}</Space> }} />
          </details>}
        </Space>}
      </Card>
      <Row gutter={16}>
        <Col xs={24} md={12}><Card title="按当前设计重建的上下文" extra={<Text type="secondary">复查参考，非当时生成快照</Text>}><Table size="small" pagination={false} dataSource={[
          { key: 'status', name: '资料状态', value: history.quality.contextManifest.requiredMaterialStatus },
          { key: 'revisions', name: '设计版本', value: `World ${history.quality.contextManifest.worldPackRevision ?? '-'} / Bible ${history.quality.contextManifest.storyBibleRevision ?? '-'}` },
          { key: 'selection', name: '上下文选入', value: `${history.quality.contextManifest.adoptedVersionIds.length} 个章节版本，${history.quality.contextManifest.includedEventIds.length} 条事件` },
          { key: 'budget', name: '估算用量', value: `${history.quality.contextManifest.estimatedTokens} / ${history.quality.contextManifest.contextBudget} tokens` },
          { key: 'omitted', name: '省略说明', value: history.quality.contextManifest.omittedOptionalMaterial.join('；') || '无' },
        ]} columns={[{ title: '项目', dataIndex: 'name', width: 100 }, { title: '值', dataIndex: 'value' }]} /></Card></Col>
        <Col xs={24} md={12}><Card title="检查覆盖"><Table size="small" pagination={false} dataSource={history.quality.candidate?.checks ?? []} rowKey="checker" locale={{ emptyText: <Empty description="本章还没有候选检查记录" /> }} columns={[{ title: '检查器', dataIndex: 'checker' }, { title: '状态', dataIndex: 'status', render: (status: string) => <Tag color={status === 'passed' ? 'success' : status === 'failed' ? 'error' : 'warning'}>{status}</Tag> }, { title: '说明', dataIndex: 'message' }]} /></Card></Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} md={12}><Card title="事实事件"><Table size="small" pagination={{ pageSize: 8 }} rowKey="id" dataSource={history.events} locale={{ emptyText: <Empty description="截至本章没有事实事件" /> }} columns={[{ title: '章', dataIndex: 'chapterNumber', width: 56 }, { title: '类型', dataIndex: 'eventType' }, { title: '对象', dataIndex: 'subjectId' }, { title: '变化', key: 'change', render: (_: unknown, row: ChapterHistoryDto['events'][number]) => <span>{row.predicate}：{valueOf(row.value)}</span> }]} /></Card></Col>
        <Col xs={24} md={12}><Card title="角色状态"><Table size="small" pagination={{ pageSize: 8 }} rowKey={(row) => row.characterId + row.field} dataSource={history.characterStates} locale={{ emptyText: <Empty description="暂无角色状态" /> }} columns={[{ title: '人物', dataIndex: 'characterId' }, { title: '字段', dataIndex: 'field' }, { title: '当前值', dataIndex: 'value', render: valueOf }]} /></Card></Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} md={12}><Card title="资源状态"><Table size="small" pagination={false} rowKey={(row) => row.subjectId + row.field} dataSource={history.resourceStates} locale={{ emptyText: <Empty description="暂无资源变化" /> }} columns={[{ title: '资源', dataIndex: 'subjectId' }, { title: '字段', dataIndex: 'field' }, { title: '当前值', dataIndex: 'value', render: valueOf }]} /></Card></Col>
        <Col xs={24} md={12}><Card title="法宝状态"><Table size="small" pagination={false} rowKey={(row) => row.subjectId + row.field} dataSource={history.artifactStates} locale={{ emptyText: <Empty description="暂无法宝变化" /> }} columns={[{ title: '法宝', dataIndex: 'subjectId' }, { title: '字段', dataIndex: 'field' }, { title: '当前值', dataIndex: 'value', render: valueOf }]} /></Card></Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} md={12}><Card title="关系快照与依据"><Text type="secondary">姓名按当前设定展示，箭头表示关系方向。创作计划尚未落实；展开查看依据。</Text><Table size="small" pagination={{ pageSize: 8 }} rowKey="id" dataSource={relationships} expandable={{ expandedRowRender: row => <Space direction="vertical" style={{ width: '100%' }}><Text type="secondary">人物 ID：{row.fromCharacterId} → {row.toCharacterId} · 关系：{row.id}</Text>{row.basis === 'adopted_event'
          ? <Space direction="vertical"><Text>第 {row.sinceChapter} 章：{row.evidence || '该事件未附引文'}</Text><Text type="secondary">正文版本：{row.sourceChapterVersionId} · 事件：{row.sourceEventId}</Text></Space>
          : row.basis === 'story_plan' ? <Space direction="vertical"><Text>故事圣经 v{row.storyBibleRevision} · 计划范围：{row.sinceChapter ?? 1}–{row.untilChapter ?? '后续'} 章</Text><Text>触发原因：{row.plannedCause || '未另列阶段原因'}</Text><Text>付出与约束：{row.plannedCost || '未另列阶段代价'}</Text><Text type="secondary">此记录没有对应的有效采纳事件，不证明关系已经变化。</Text></Space>
          : <Text type="secondary">{row.basis === 'author_setting' ? '这是作者维护的关系设定，没有对应的正文变化证据。' : '此记录未标注来源，暂不能确认为已发生的关系变化。'}</Text>}</Space> }} columns={[
          { title: '人物与关系', render: (_, row) => <Space direction="vertical" size={0}><Text>{characterName(row.fromCharacterId)} → {characterName(row.toCharacterId)}</Text><Text type="secondary">{row.kind}</Text></Space> }, { title: '值', dataIndex: 'value' },
          { title: '依据', render: (_, row) => <Tag color={row.basis === 'adopted_event' ? 'success' : row.basis === 'story_plan' ? 'processing' : row.basis === 'author_setting' ? 'default' : 'warning'}>{row.basis === 'adopted_event' ? '正文事件' : row.basis === 'story_plan' ? '创作计划' : row.basis === 'author_setting' ? '作者设定' : '来源待核对'}</Tag> },
          { title: '设定锁定', dataIndex: 'locked', render: (value: boolean) => value ? '是' : '否' },
        ]} /></Card></Col>
        <Col xs={24} md={12}><Card title="分卷、弧光、秘密与收束"><Table size="small" pagination={{ pageSize: 8 }} rowKey="id" dataSource={[...history.volumeStates.map((state) => ({ id: state.volumeId, kind: '分卷', name: state.volumeId, status: state.status, value: valueOf(state.value) })), ...history.arcStates.map((state) => ({ id: state.arcId, kind: '弧光', name: state.arcId, status: state.status, value: valueOf(state.value) })), ...history.secretStates.map((state) => ({ id: state.secretId, kind: '秘密', name: state.secretId, status: state.revealed ? '已揭示' : '未揭示', value: valueOf(state.value) })), ...history.promiseStates.map((state) => ({ id: state.promiseId, kind: '承诺', name: state.promiseId, status: state.status, value: valueOf(state.value) })), ...history.threadStates.map((state) => ({ id: state.threadId, kind: '开放线', name: state.threadId, status: state.status, value: valueOf(state.value) }))]} columns={[{ title: '类型', dataIndex: 'kind' }, { title: 'ID', dataIndex: 'name' }, { title: '状态', dataIndex: 'status' }, { title: '证据', dataIndex: 'value' }]} /></Card></Col>
      </Row>
      <Card title="角色认知快照"><Table size="small" pagination={{ pageSize: 8 }} rowKey={(row) => `${row.characterId}:${row.proposition}`} dataSource={history.knowledgeStates} locale={{ emptyText: <Empty description="截至本章没有可重建的角色认知" /> }} columns={[{ title: '人物', dataIndex: 'characterId' }, { title: '关于', dataIndex: 'subjectId' }, { title: '命题', dataIndex: 'proposition' }, { title: '认知', dataIndex: 'belief', render: valueOf }]} /></Card>
      <Card title="大纲节点落实"><Table size="small" pagination={{ pageSize: 8 }} rowKey="id" dataSource={history.quality.plotNodes} locale={{ emptyText: <Empty description="暂无手工大纲节点" /> }} columns={[{ title: '节点', dataIndex: 'title' }, { title: '目标章', dataIndex: 'targetChapter', render: (value?: number) => value ?? '未设' }, { title: '状态', dataIndex: ['realization', 'status'], render: (status: string) => <Tag color={status === 'realized' ? 'success' : status === 'diverged' ? 'error' : 'warning'}>{status}</Tag> }, { title: '证据', dataIndex: ['realization', 'evidence'], render: (value?: string) => value || '暂无' }]} /></Card>
    </Space>}
    <Modal open={reviewSource !== null} title="正文评审所审材料" footer={null} width={900} onCancel={closeReviewSource}>
      {reviewSource?.error ? <Alert type="error" showIcon message="原材料加载失败" description={reviewSource.error} /> : reviewSource?.data ? <Space direction="vertical" style={{ width: '100%' }}>
        <Alert type="info" showIcon message={reviewSource.data.kind === 'review_result' ? '这是前置评审报告摘录，属于综合判断的依据。' : reviewSource.data.kind === 'review_question' ? '这是当次评审提出的待补读问题。' : '这是该次评审实际读取的原文快照。'} description="材料保留于所选评审记录，可能与当前正文或设定不同。" />
        <Text type="secondary">第 {reviewSource.data.chapterNumber} 章 · {new Date(reviewSource.data.checkedAt).toLocaleString()} · {reviewSource.data.source.id}</Text>
        {reviewSource.data.original && <Text type="secondary">原始来源：{reviewSource.data.original.sourceId} · 字符 {reviewSource.data.original.start}–{reviewSource.data.original.end}</Text>}
        {formattedSource !== reviewSource.data.source.text && <Button size="small" onClick={() => setRawSource(value => !value)}>{rawSource ? '按层级排版' : '显示原始文本'}</Button>}
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '55vh', overflow: 'auto', width: '100%' }}>{rawSource ? reviewSource.data.source.text : formattedSource}</pre>
      </Space> : <Spin />}
    </Modal>
  </section>;
}
