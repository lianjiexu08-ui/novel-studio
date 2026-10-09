import { useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { Spin } from 'antd';
import { api } from '../api';
import type { WorkDto } from 'novel-studio-contracts';
import { useWorkChrome } from '../work-chrome';

export interface WorkspaceContext {
  work: WorkDto;
  refresh: () => Promise<void>;
}

/** Loads the work for /works/:workId/* routes and provides it to child pages. */
export function Workspace() {
  const { workId } = useParams<{ workId: string }>();
  const { setTitle } = useWorkChrome();
  const [work, setWork] = useState<WorkDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(work?.title ?? null);
    return () => setTitle(null);
  }, [work?.title, setTitle]);

  async function refresh() {
    if (!workId) return;
    try {
      setWork(await api.getWork(workId));
      setError(null);
    } catch {
      setError('作品不存在或加载失败');
    }
  }

  useEffect(() => {
    setWork(null);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);

  if (error) {
    return (
      <section className="page">
        <header className="page-head">
          <div>
            <p className="page-kicker">创作空间</p>
            <h1 className="page-title">未找到作品</h1>
            <p className="page-desc">{error}</p>
          </div>
        </header>
      </section>
    );
  }
  if (!work) return <div className="state-block"><Spin size="large" /></div>;
  return <Outlet context={{ work, refresh } satisfies WorkspaceContext} />;
}
