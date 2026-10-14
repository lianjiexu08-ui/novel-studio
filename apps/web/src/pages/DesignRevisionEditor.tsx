import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App, Button, Card, Collapse, Empty, Input, Modal, Popconfirm, Select, Space, Spin, Typography } from 'antd';
import { api, ApiRequestError } from '../api';
import { readDesignDraft, removeDesignDraft, replaceRevisionField, revisionChanges, revisionSections, writeDesignDraft, type DesignDraft, type RevisionField } from '../design-revision';

const { Text, Paragraph } = Typography;
const fullText = (value: string | string[]) => Array.isArray(value) ? value.map((item, index) => `${index + 1}. ${item}`).join('\n\n') : value;

export function DesignRevisionEditor({ workId, onClose, onSaved }: { workId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<DesignDraft>();
  const [sectionKey, setSectionKey] = useState<string>('worldPack');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [storageStatus, setStorageStatus] = useState('');
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState<number>();
  const [reload, setReload] = useState(0);
  const active = useRef(true), changeSequence = useRef(0);
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    setError('');
    void Promise.all([api.designCandidate(workId), readDesignDraft(workId)]).then(([baseline, cached]) => {
      if (cancelled) return;
      if (cached && (!cached.baseline?.candidate || !cached.candidate || !cached.baseline.expectedInputHash)) throw new Error('本地草稿格式无法读取，请保留浏览器数据后重试。');
      setDraft(cached ?? { baseline, candidate: structuredClone(baseline.candidate) });
      setStale(Boolean(cached && (cached.baseline.expectedInputHash !== baseline.expectedInputHash || cached.baseline.basePlanId !== baseline.basePlanId)));
      setStorageStatus(cached ? '已恢复本机草稿' : '修改后自动保存本机草稿');
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; active.current = false; };
  }, [workId, reload]);
  const sections = useMemo(() => draft ? revisionSections(draft.candidate) : [], [draft]);
  const selected = sections.find(section => section.key === sectionKey) ?? sections[0];
  const changes = useMemo(() => draft ? revisionChanges(draft.baseline.candidate, draft.candidate) : [], [draft]);
  function change(field: RevisionField, value: string | string[]) {
    if (!draft) return;
    const next = { ...draft, candidate: replaceRevisionField(draft.candidate, field.path, value) }, sequence = ++changeSequence.current;
    setDraft(next); setError(''); setStorageStatus('正在保存本机草稿…');
    void writeDesignDraft(workId, next).then(() => {
      if (active.current && sequence === changeSequence.current) setStorageStatus('本机草稿已保存');
    }).catch(cause => { if (active.current && sequence === changeSequence.current) setStorageStatus(`本机草稿保存失败，请勿关闭页面：${cause instanceof Error ? cause.message : String(cause)}`); });
  }
  async function discard() {
    setBusy(true);
    try {
      await removeDesignDraft(workId);
      if (!active.current) return;
      setDraft(undefined); setPreview(false); setStale(false); setReload(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (active.current) setBusy(false); }
  }
  async function save() {
    if (!draft || !changes.length) return;
    setBusy(true); setError('');
    try {
      const result = await api.saveDesignCandidate(workId, { ...draft.baseline, candidate: draft.candidate });
      // A committed proposal is never submitted again because draft cleanup or
      // refreshing another panel failed after the successful response.
      if (!active.current) return;
      setSaved(result.plan.revision);
      try { await removeDesignDraft(workId); }
      catch { message.warning('新提案已保存，本机旧草稿清理失败；再次打开时请重新载入当前设计。'); }
      try { await onSaved(); }
      catch { message.warning('新提案已保存，页面刷新失败，请关闭后刷新页面。'); }
    } catch (cause) {
      if (!active.current) return;
      if (cause instanceof ApiRequestError && cause.code === 'PLAN_CONFLICT') setStale(true);
      const locations = new Map(sections.flatMap(section => section.fields.map(field => [field.path.join('.'), `${section.label} · ${field.label}`])));
      const details = cause instanceof ApiRequestError && Array.isArray(cause.details) ? cause.details.map(item => `${locations.get(item.path) ?? item.path ?? ''}：${item.message ?? '内容不符合保存要求'}`).join('\n') : '';
      setError(`${cause instanceof Error ? cause.message : String(cause)}${details ? `\n${details}` : ''}`);
    } finally { if (active.current) setBusy(false); }
  }
  return <Modal open title="修订设定与全书计划" width={1100} style={{ top: 24 }} styles={{ body: { maxHeight: 'calc(100vh - 190px)', overflowY: 'auto', paddingRight: 4 } }} onCancel={busy ? undefined : onClose} closable={!busy} maskClosable={false}
    footer={saved ? <Button onClick={onClose}>关闭</Button> : <Space wrap>
      <Popconfirm title="放弃本机草稿并载入最新设计？" onConfirm={() => void discard()} okText="放弃并重载" cancelText="保留草稿"><Button disabled={busy}>放弃草稿并重载</Button></Popconfirm>
      <Button disabled={busy} onClick={onClose}>关闭</Button>
      {preview ? <><Button disabled={busy} onClick={() => setPreview(false)}>继续修改</Button><Button type="primary" disabled={!changes.length || stale} loading={busy} onClick={() => void save()}>保存为待评审提案</Button></>
        : <Button type="primary" disabled={!changes.length || busy} onClick={() => setPreview(true)}>查看改动（{changes.length}）</Button>}
    </Space>}>
    {saved ? <Alert type="success" showIcon message={`已保存为计划 v${saved} 的设计提案`} description="请针对新版本重新进行四项内容评审。原批准计划保留；新提案须评审、锁定并批准后才能用于写作。" /> : <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Text type={storageStatus.includes('失败') ? 'danger' : 'secondary'}>{storageStatus}</Text>
      {stale && <Alert type="warning" showIcon message="草稿依据的设计已更新" description="保留的改稿仍可查看和复制。请核对改动后重新载入最新设计，避免覆盖其他修订。" />}
      {error && <Alert type="error" showIcon message="修订尚未保存" description={<div style={{ whiteSpace: 'pre-wrap' }}>{error}</div>} action={!draft ? <Button onClick={() => setReload(value => value + 1)}>重试</Button> : undefined} />}
      {!draft ? !error && <Spin /> : preview ? <>
        <Alert type="info" showIcon message={`本次修改 ${changes.length} 处文本`} description="逐项核对改前与改后。保存后整套设计形成待评审提案，待解决问题继续保留。" />
        <Collapse style={{ width: '100%' }} items={changes.map(field => ({ key: JSON.stringify(field.path), label: `${field.section} · ${field.label}`, children: <Space direction="vertical" style={{ width: '100%' }}>
          <Text strong>改前</Text><Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}>{fullText(field.before) || '（空）'}</Paragraph>
          <Text strong>改后</Text><Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}>{fullText(field.value) || '（空）'}</Paragraph>
        </Space> }))} />
      </> : <>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>按条目修订世界规则、人物关系和故事计划的文本。章节区间、引用关系、锁定状态及问题处理状态保持原样。列表中的每条内容单独编辑，完整原文会随草稿保留。</Paragraph>
        <Select aria-label="选择修订条目" showSearch optionFilterProp="label" style={{ width: '100%' }} value={selected?.key} onChange={setSectionKey} options={sections.map(section => ({ value: section.key, label: section.label }))} disabled={busy} />
        <div style={{ maxHeight: '55vh', overflow: 'auto', width: '100%', paddingRight: 8 }}>
          {selected ? <Space direction="vertical" style={{ width: '100%' }}>{selected.fields.map(field => <Card size="small" key={JSON.stringify(field.path)} title={field.label}>
            {typeof field.value === 'string' ? <Input.TextArea aria-label={field.label} value={field.value} autoSize={{ minRows: 2, maxRows: 12 }} disabled={busy} onChange={event => change(field, event.target.value)} />
              : <Space direction="vertical" style={{ width: '100%' }}>{field.value.map((value, index) => <div key={index} style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'start' }}>
                <Input.TextArea aria-label={`${field.label} 第 ${index + 1} 条`} value={value} autoSize={{ minRows: 2, maxRows: 10 }} disabled={busy} onChange={event => change(field, (field.value as string[]).map((previous, i) => i === index ? event.target.value : previous))} />
                <Button disabled={busy} aria-label={`移除${field.label}第 ${index + 1} 条`} onClick={() => change(field, (field.value as string[]).filter((_, i) => i !== index))}>移除</Button>
              </div>)}<Button disabled={busy} onClick={() => change(field, [...field.value as string[], ''])}>添加一条{field.label}</Button></Space>}
          </Card>)}</Space> : <Empty description="没有可修订文本" />}
        </div>
      </>}
    </Space>}
  </Modal>;
}
