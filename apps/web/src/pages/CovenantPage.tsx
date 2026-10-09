import { useState } from 'react';
import { Alert, App as AntApp } from 'antd';
import { useOutletContext } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { toCovenant, type CovenantFormValues } from '../covenant';
import { CovenantForm } from './CovenantForm';
import type { WorkspaceContext } from './Workspace';

export function CovenantPage() {
  const { message } = AntApp.useApp();
  const { work, refresh } = useOutletContext<WorkspaceContext>();
  const [submitting, setSubmitting] = useState(false);
  const covenant = work.covenant;

  async function submit(values: CovenantFormValues) {
    setSubmitting(true);
    try {
      await api.updateWork(work.id, { title: values.title.trim(), covenant: toCovenant(values) });
      await refresh();
      message.success('创作约定已更新');
    } catch (error) {
      message.error(error instanceof ApiRequestError ? `[${error.code}] ${error.message}` : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">开书</p>
          <h1 className="page-title">创作约定</h1>
          <p className="page-desc">读者承诺和硬边界。修改这里不会改写已经采用的正文。</p>
        </div>
      </header>
      <div className="panel">
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="这些句子还不是故事事实"
        description="锁定关系、必须保留和避免元素只约束后面的生成。已经采用的章节若和约定冲突，要另开修订，不能在这里直接覆盖。"
      />
      <CovenantForm
        key={`${work.id}:${work.title}:${covenant.hook}`}
        initialValues={{
          title: work.title,
          substyle: covenant.substyle,
          audience: covenant.audience,
          hook: covenant.hook,
          mustKeep: covenant.mustKeep,
          lockedNotes: covenant.lockedNotes,
          avoid: covenant.avoid,
          targetLength: covenant.targetLength,
          chapterWords: covenant.chapterWords,
          updateCadence: covenant.updateCadence,
        }}
        submitText="保存约定"
        submitting={submitting}
        onSubmit={submit}
      />
      </div>
    </section>
  );
}
