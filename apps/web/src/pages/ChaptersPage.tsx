import { useEffect, useState } from 'react';
import { Button, Empty, Spin } from 'antd';
import { FileAddOutlined } from '@ant-design/icons';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../api';
import { covenantReady } from '../covenant';
import type { ChapterVersionDto } from 'novel-studio-contracts';
import type { WorkspaceContext } from './Workspace';

function formatAdoptedAt(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ChaptersPage() {
  const { work } = useOutletContext<WorkspaceContext>();
  const navigate = useNavigate();
  const [chapters, setChapters] = useState<ChapterVersionDto[] | null>(null);

  useEffect(() => {
    setChapters(null);
    api.listChapters(work.id).then((result) => setChapters(result.chapters)).catch(() => setChapters([]));
  }, [work.id, work.stateRevision]);

  if (chapters === null) {
    return <div className="state-block"><Spin size="large" /></div>;
  }

  const ready = covenantReady(work.covenant);
  const next = ready ? `/works/${work.id}/write` : `/works/${work.id}/covenant`;

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">目录</p>
          <h1 className="page-title">章节</h1>
          <p className="page-desc">{ready ? '已采用的正文按章节排列。' : '这本小说还没有创作约定，先补上再写章节。'}</p>
        </div>
        <Button type="primary" icon={<FileAddOutlined />} onClick={() => navigate(next)}>
          {ready ? '创建章节' : '先写约定'}
        </Button>
      </header>

      {chapters.length === 0 ? (
        <div className="panel empty-panel">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有章节">
            <Button type="primary" icon={<FileAddOutlined />} onClick={() => navigate(next)}>
              {ready ? '创建章节，进入章节创作' : '先写创作约定'}
            </Button>
          </Empty>
        </div>
      ) : (
        <div className="panel">
          <div className="toc">
            {chapters.map((chapter) => (
              <button
                key={chapter.id}
                type="button"
                className="toc-row"
                onClick={() => navigate(`/works/${work.id}/write`)}
              >
                <span className="toc-num">第 {chapter.chapterNumber} 章</span>
                <span className="tag tag-gold">rev {chapter.revision}</span>
                <span className="toc-meta">已采用 · {formatAdoptedAt(chapter.createdAt)}</span>
                <span className="toc-go">继续创作</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
