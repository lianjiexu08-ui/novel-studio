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
      const result = await api.updateWork(work.id, { title: values.title.trim(), covenant: toCovenant(values), authorText: values.authorText?.trim() || undefined });
      await refresh();
      const notes = [
        result.impact.staleCandidateIds.length ? `${result.impact.staleCandidateIds.length} 份未采用的候选稿已过期` : '',
        result.impact.planToRecheck ? '建议回到「全书计划」重新审核当前计划' : '',
      ].filter(Boolean);
      message.success(`创作约定已更新${notes.length ? `：${notes.join('；')}` : ''}`);
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
        <div className="panel-head">
          <div>
            <h2 className="panel-title">这本书怎么生成</h2>
            <p className="panel-note">规划、写作、抽取和审稿都只作用于当前作品。模型地址和密钥仍是整机共用的，不写在这本书里。</p>
          </div>
        </div>
        <div className="role-list">
          <article className="role-row">
            <div className="role-head">
              <h3>规划</h3>
              <span className="tag tag-gold">本书约定</span>
            </div>
            <p>用这本书的读者承诺、吸引点和硬边界生成世界包、Story Bible 和分卷大纲。改约定不会改写已经采用的正文。</p>
          </article>
          <article className="role-row">
            <div className="role-head">
              <h3>写作</h3>
              <span className="tag tag-gold">本书锁定设定</span>
            </div>
            <p>按这本书已经锁定的设计和最近章节写正文。写什么只看这本书。</p>
          </article>
          <article className="role-row">
            <div className="role-head">
              <h3>抽取</h3>
              <span className="tag tag-gold">本书候选</span>
            </div>
            <p>这本章的事件声明必须和独立读到的正文一致，否则不能采用。要不要做这次独立抽取，目前仍是整机开关，各书还不能单独关闭。</p>
          </article>
          <article className="role-row">
            <div className="role-head">
              <h3>审稿</h3>
              <span className="tag tag-gold">本书单章 {covenant.chapterWords} 字</span>
            </div>
            <p>检查正文是否为空、事件是否自洽、有没有改动这本书的锁定设定。接上真实模型后，正文还要达到这章目标的至少 {Math.max(200, Math.floor(covenant.chapterWords * 0.75))} 字。</p>
          </article>
        </div>
      </div>
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
          protagonistGoal: covenant.protagonistGoal,
          obstacle: covenant.obstacle,
          readingExperience: covenant.readingExperience,
          mustKeep: covenant.mustKeep,
          lockedNotes: covenant.lockedNotes,
          avoid: covenant.avoid,
          targetLength: covenant.targetLength,
          targetChapterCount: covenant.targetChapterCount,
          volumeCount: covenant.volumeCount,
          chapterWords: covenant.chapterWords,
          updateCadence: covenant.updateCadence,
        }}
        showAuthorText
        submitText="保存约定"
        submitting={submitting}
        onSubmit={submit}
      />
      </div>
    </section>
  );
}
