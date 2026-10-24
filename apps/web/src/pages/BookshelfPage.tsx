import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Spin } from 'antd';
import { PlusOutlined, RightOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { covenantReady } from '../covenant';
import type { WorkDto } from 'novel-studio-contracts';

const COVERS = [
  ['#4a3428', '#1c1612'],
  ['#2c3a40', '#14181c'],
  ['#3a3148', '#17141c'],
  ['#314033', '#141814'],
  ['#4a3824', '#1c1612'],
  ['#2e3348', '#14161c'],
];

function coverOf(title: string) {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [from, to] = COVERS[hash % COVERS.length];
  return `linear-gradient(165deg, ${from}, ${to} 72%)`;
}

export function BookshelfPage() {
  const navigate = useNavigate();
  const [works, setWorks] = useState<WorkDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      setWorks((await api.listWorks()).works);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">作品</p>
          <h1 className="page-title">书架</h1>
          <p className="page-desc">
            {works && works.length > 0
              ? `${works.length} 部作品。开书先写创作约定，再写章节。`
              : '开书先写读者承诺和不能改的边界，再进入章节。'}
          </p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/new')}>创作</Button>
      </header>

      {loadFailed && (
        <Alert type="error" showIcon message="暂时无法读取书架"
          description="作品列表读取失败，请稍后重试。"
          action={<Button onClick={() => void load()} loading={loading}>重新加载</Button>} />
      )}

      {works === null && loading ? (
        <div className="state-block"><Spin size="large" /></div>
      ) : works === null ? null : works.length === 0 ? (
        <div className="panel empty-panel">
          <Empty description="书架是空的。点右上角「创作」，先写下这本小说的约定。" />
        </div>
      ) : (
        <div className="book-grid">
          {works.map((work) => {
            const ready = covenantReady(work.covenant);
            return (
              <button
                key={work.id}
                type="button"
                className="book-card"
                onClick={() => navigate(ready ? `/works/${work.id}/chapters` : `/works/${work.id}/covenant`)}
              >
                <div className="book-cover" style={{ background: coverOf(work.title) }}>
                  <span className="book-genre">玄幻</span>
                  <span className="book-cover-title">{work.title}</span>
                </div>
                <div className="book-foot">
                  <span>{ready ? <><span className="tag tag-ok">约定已写</span></> : <span className="tag tag-warn">还没有约定</span>}</span>
                  <span>{ready ? '进入' : '去写约定'} <RightOutlined /></span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
