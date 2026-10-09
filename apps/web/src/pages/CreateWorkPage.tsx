import { useState } from 'react';
import { App as AntApp } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { COVENANT_DEFAULTS, toCovenant, type CovenantFormValues } from '../covenant';
import { CovenantForm } from './CovenantForm';

const EMPTY: CovenantFormValues = {
  title: '',
  ...COVENANT_DEFAULTS,
};

export function CreateWorkPage() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  async function submit(values: CovenantFormValues) {
    setSubmitting(true);
    try {
      const work = await api.createWork({ title: values.title.trim(), covenant: toCovenant(values) });
      message.success('创作约定已保存');
      navigate(`/works/${work.id}/overview`);
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
          <h1 className="page-title">创作新作品</h1>
          <p className="page-desc">先写下这本小说对读者的承诺，以及不能被改掉的边界。</p>
        </div>
      </header>
      <div className="panel">
        <CovenantForm initialValues={EMPTY} submitText="保存约定并进入作品" submitting={submitting} onSubmit={submit} />
      </div>
    </section>
  );
}
