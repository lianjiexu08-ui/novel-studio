import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Space, Typography } from 'antd';
import type { DesignReviewAnnotationDto } from 'novel-studio-contracts';
import { api } from '../api';

export function ReviewAnnotations({ workId, runId, stageId, onSource, onStage, onQueued }: {
  onQueued?: () => void;
  workId: string; runId: string; stageId?: string;
  onSource: (source: { id: string; text: string }) => void;
  onStage: (runId: string, stageId: string) => void;
}) {
  const [notes, setNotes] = useState<DesignReviewAnnotationDto[]>();
  const [reviewState, setReviewState] = useState<Awaited<ReturnType<typeof api.designReviewAnnotations>>>();
  const [queuing, setQueuing] = useState<string>();
  const [queueError, setQueueError] = useState('');
  const [error, setError] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState('');
  const sourceRequest = useRef(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.designReviewAnnotations(workId, runId, stageId).then(result => {
      if (!cancelled) { setReviewState(result); setNotes(result.annotations); setError(''); setCheckedAt(new Date().toLocaleTimeString()); }
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // Annotations are appended separately from review progress. Reload on entry
  // or explicit refresh, without multiplying the parent's progress polling.
  }, [workId, runId, stageId, attempt]);
  // Do not display another run's notes while the new request is in flight.
  useEffect(() => {
    setReviewState(undefined); setQueueError(''); setQueuing(undefined); setNotes(undefined); setError(''); setSourceError(''); setCheckedAt('');
    return () => { sourceRequest.current++; };
  }, [workId, runId, stageId]);
  async function showSource(note: DesignReviewAnnotationDto, sourceId: string) {
    const request = ++sourceRequest.current;
    try {
      const detail = await api.designReviewAnnotation(workId, note.id);
      if (request !== sourceRequest.current) return;
      const source = detail.sources.find(item => item.id === sourceId);
      if (!source) throw new Error('核对记录缺少对应原文');
      setSourceError(''); onSource(source);
    } catch (cause) { if (request === sourceRequest.current) setSourceError(cause instanceof Error ? cause.message : String(cause)); }
  }
  async function queue(note: DesignReviewAnnotationDto) {
    const request = ++sourceRequest.current;
    setQueuing(note.id); setQueueError('');
    try {
      await api.reconsiderDesignReview(workId, runId, note.id, note.expectedInputHash);
      if (request !== sourceRequest.current) return;
      setAttempt(value => value + 1); onQueued?.();
    } catch (cause) { if (request === sourceRequest.current) setQueueError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (request === sourceRequest.current) setQueuing(undefined); }
  }
  return <>
    <Space wrap>
      <Button size="small" loading={loading} onClick={() => setAttempt(value => value + 1)}>刷新核对记录</Button>
      <Typography.Text type="secondary">核对记录打开时加载，可单独刷新。{checkedAt ? `最近读取：${checkedAt}。` : ''}{notes?.length === 0 ? '暂无独立核对记录。' : ''}</Typography.Text>
    </Space>
    {error && <Alert type="warning" showIcon message="核对记录暂不可用" description={error}
      action={<Button size="small" loading={loading} onClick={() => setAttempt(value => value + 1)}>重试</Button>} />}
    {queueError && <Alert type="error" message="正式复核未提交" description={queueError} />}
    {sourceError && <Alert type="error" message="核对原文加载失败" description={sourceError} />}
    {notes?.length ? <Collapse style={{ width: '100%' }} items={[{
      key: 'annotations', label: `独立核对记录（${notes.length} 条，不改变原判定）`,
      children: <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary">以下说明单独保存，原评语、判定和补读记录仍然保留。引文匹配只确认来源，说明本身仍需判断；它不会自动解决设计问题或批准写作。</Typography.Paragraph>
        {notes.map(note => <div key={note.id} style={{ width: '100%', overflowWrap: 'anywhere' }}>
          <Typography.Text strong>计划 v{note.scope.planRevision} · {note.stageId} · {note.criterion}</Typography.Text>
          <Typography.Paragraph type="secondary">记录时间：{new Date(note.createdAt).toLocaleString()}</Typography.Paragraph>
          {!stageId && <Button type="link" size="small" onClick={() => onStage(note.runId, note.stageId)}>查看被核对批次</Button>}
          <Typography.Text>{note.claimField === 'revisionAdvice' ? '被核对的原返修建议：' : '被核对的原评语：'}</Typography.Text>
          <blockquote style={{ whiteSpace: 'pre-wrap' }}>{note.claimQuote}</blockquote>
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{note.explanation}</Typography.Paragraph>
          {reviewState?.reconsiderations?.find(item => item.annotationId === note.id) ? (() => {
            const item = reviewState.reconsiderations!.find(item => item.annotationId === note.id)!;
            return <Button type="link" size="small" onClick={() => onStage(runId, item.stageId)}>{item.resolved ? '已正式复核解决，查看依据' : item.completed ? '复核仍未解决，查看原问题与结果' : '已加入正式复核，查看待审材料'}</Button>;
          })() : reviewState?.reconsiderableAnnotationIds?.includes(note.id) ? <Space direction="vertical">
            <Button size="small" disabled={!!queuing} loading={queuing === note.id} onClick={() => void queue(note)}>提交正式复核</Button>
            <Typography.Text type="secondary">加入本任务下一步，继续评审时调用模型核验整项返修及完整依据；原判定保留。</Typography.Text>
          </Space> : null}
          {note.evidence.map((evidence, index) => <div key={`${evidence.sourceId}/${index}`}>
            <Button type="link" size="small" style={{ height: 'auto', whiteSpace: 'normal', textAlign: 'left' }}
              onClick={() => void showSource(note, evidence.sourceId)}>查看完整依据：{evidence.sourceId}</Button>
            <blockquote style={{ whiteSpace: 'pre-wrap' }}>{evidence.quote}</blockquote>
          </div>)}
        </div>)}
      </Space>,
    }]} /> : null}
  </>;
}
