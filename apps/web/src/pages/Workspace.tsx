import { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { Button, Space, Spin } from 'antd';
import { api, ApiRequestError } from '../api';
import type { WorkDto } from 'novel-studio-contracts';
import { useWorkChrome } from '../work-chrome';

export interface WorkspaceContext {
  work: WorkDto;
  refresh: () => Promise<void>;
}

/** Loads the work for /works/:workId/* routes and provides it to child pages. */
export function Workspace() {
  const { workId } = useParams<{ workId: string }>();
  const navigate = useNavigate();
  const { setTitle } = useWorkChrome();
  const [work, setWork] = useState<WorkDto | null>(null);
  const [error, setError] = useState<'not_found' | 'unavailable' | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    setTitle(work?.title ?? null);
    return () => setTitle(null);
  }, [work?.title, setTitle]);

  async function refresh() {
    if (!workId) return;
    const sequence = ++requestSequence.current;
    setError(null);
    try {
      const loaded = await api.getWork(workId);
      if (sequence === requestSequence.current) setWork(loaded);
    } catch (cause) {
      if (sequence === requestSequence.current) {
        setError(cause instanceof ApiRequestError && cause.status === 404 ? 'not_found' : 'unavailable');
      }
    }
  }

  useEffect(() => {
    setWork(null);
    void refresh();
    return () => { requestSequence.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);

  if (error) {
    return (
      <section className="page">
        <header className="page-head">
          <div>
            <p className="page-kicker">创作空间</p>
            <h1 className="page-title">{error === 'not_found' ? '未找到作品' : '暂时无法读取作品'}</h1>
            <p className="page-desc">{error === 'not_found' ? '该作品不存在，或已被移除。' : '作品信息读取失败，请稍后重试。'}</p>
          </div>
        </header>
        <Space>
          <Button onClick={() => void refresh()}>重新加载</Button>
          <Button onClick={() => navigate('/')}>返回书架</Button>
        </Space>
      </section>
    );
  }
  if (!work) return <div className="state-block"><Spin size="large" /></div>;
  return <Outlet context={{ work, refresh } satisfies WorkspaceContext} />;
}
