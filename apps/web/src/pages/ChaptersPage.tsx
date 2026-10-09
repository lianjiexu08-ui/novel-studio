import { useEffect, useState } from 'react';
import { App as AntApp, Button, Card, Empty, Modal, Select, Space, Spin, Tag, Typography } from 'antd';
import { FileAddOutlined, ReadOutlined } from '@ant-design/icons';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../api';
import { covenantReady } from '../covenant';
import type { ChapterVersionDto, ManuscriptRevisionDto } from 'novel-studio-contracts';
import type { WorkspaceContext } from './Workspace';

const { Paragraph, Text, Title } = Typography;
type ExportedChapter = Pick<ChapterVersionDto, 'id' | 'chapterNumber' | 'content' | 'revision'>;
type ReaderState = { manuscript: ManuscriptRevisionDto; chapters: ExportedChapter[] };

function formatAdoptedAt(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ChaptersPage() {
  const { message } = AntApp.useApp();
  const { work } = useOutletContext<WorkspaceContext>();
  const navigate = useNavigate();
  const [chapters, setChapters] = useState<ChapterVersionDto[] | null>(null);
  const [manuscripts, setManuscripts] = useState<ManuscriptRevisionDto[]>([]);
  const [reader, setReader] = useState<ReaderState | null>(null);
  const [selectedChapter, setSelectedChapter] = useState(1);

  useEffect(() => {
    setChapters(null);
    Promise.all([api.listChapters(work.id), api.manuscripts(work.id)]).then(([chapterResult, manuscriptResult]) => {
      setChapters(chapterResult.chapters);
      setManuscripts(manuscriptResult.manuscripts);
    }).catch(() => { setChapters([]); setManuscripts([]); });
  }, [work.id, work.stateRevision]);

  async function openManuscript(manuscript: ManuscriptRevisionDto) {
    try {
      const exported = await api.exportManuscript(work.id, manuscript.id);
      setReader(exported);
      setSelectedChapter(exported.chapters[0]?.chapterNumber ?? 1);
    } catch (error) { message.error(String(error)); }
  }

  if (chapters === null) return <div className="state-block"><Spin size="large" /></div>;
  const ready = covenantReady(work.covenant);
  const next = ready ? '/works/' + work.id + '/write' : '/works/' + work.id + '/covenant';
  const current = reader?.chapters.find((chapter) => chapter.chapterNumber === selectedChapter);

  return <section className="page">
    <header className="page-head"><div><p className="page-kicker">目录</p><h1 className="page-title">章节</h1><p className="page-desc">{ready ? '已采用的正文按章节排列。冻结后的书稿快照可以随时复查。' : '这本小说还没有创作约定，先补上再写章节。'}</p></div><Button type="primary" icon={<FileAddOutlined />} onClick={() => navigate(next)}>{ready ? '创建章节' : '先写约定'}</Button></header>

    {manuscripts.length > 0 && <Card title="最终书稿快照" style={{ marginBottom: 20 }}><Space direction="vertical" style={{ width: '100%' }}>{manuscripts.map((manuscript) => <Card.Grid key={manuscript.id} style={{ width: '100%', padding: 16 }}><Space wrap><Tag color={manuscript.status === 'final' ? 'success' : 'default'}>{manuscript.status === 'final' ? '当前最终版' : '历史版本'}</Tag><Text strong>修订 {manuscript.revision}</Text><Text type="secondary">{manuscript.chapterCount} 章 · {formatAdoptedAt(manuscript.createdAt)}</Text><Button size="small" icon={<ReadOutlined />} onClick={() => void openManuscript(manuscript)}>查看冻结书稿</Button></Space><div style={{ marginTop: 8 }}><Text type="secondary">内容哈希：{manuscript.contentHash}</Text></div></Card.Grid>)}</Space></Card>}

    {chapters.length === 0 ? <div className="panel empty-panel"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有章节"><Button type="primary" icon={<FileAddOutlined />} onClick={() => navigate(next)}>{ready ? '创建章节，进入章节创作' : '先写约定'}</Button></Empty></div> : <div className="panel"><div className="toc">{chapters.map((chapter) => <button key={chapter.id} type="button" className="toc-row" onClick={() => navigate('/works/' + work.id + '/write')}><span className="toc-num">第 {chapter.chapterNumber} 章</span><span className="tag tag-gold">rev {chapter.revision}</span><span className="toc-meta">已采用 · {formatAdoptedAt(chapter.createdAt)}</span><span className="toc-go">继续创作</span></button>)}</div></div>}

    <Modal open={!!reader} title={reader ? '冻结书稿 · 修订 ' + reader.manuscript.revision : '冻结书稿'} width={900} footer={null} onCancel={() => setReader(null)}>{reader && <Space direction="vertical" style={{ width: '100%' }}><Space wrap><Text type="secondary">内容哈希：{reader.manuscript.contentHash}</Text><Select value={selectedChapter} style={{ width: 180 }} onChange={setSelectedChapter} options={reader.chapters.map((chapter) => ({ value: chapter.chapterNumber, label: '第 ' + chapter.chapterNumber + ' 章 · rev ' + chapter.revision }))} /></Space>{current ? <div><Title level={4}>第 {current.chapterNumber} 章</Title><Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: '60vh', overflow: 'auto' }}>{current.content}</Paragraph></div> : <Empty description="书稿没有章节内容" />}</Space>}</Modal>
  </section>;
}
