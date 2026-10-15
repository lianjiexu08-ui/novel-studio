import { Button, Empty, Modal, Select, Space, Tag, Typography } from 'antd';
import type { ChapterVersionDto } from 'novel-studio-contracts';

const { Paragraph, Text } = Typography;

export function AdoptedChapterReader({ chapters, selectedId, onSelect, onClose }: {
  chapters: ChapterVersionDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const ordered = [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
  const index = ordered.findIndex(chapter => chapter.id === selectedId);
  const chapter = ordered[index];
  return <Modal open={selectedId !== null} title={chapter ? `第 ${chapter.chapterNumber} 章 · 已采用稿` : '已采用稿'} width={900} onCancel={onClose} footer={
    <Space wrap>
      <Button disabled={index <= 0} onClick={() => onSelect(ordered[index - 1].id)}>上一章</Button>
      <Button disabled={index < 0 || index >= ordered.length - 1} onClick={() => onSelect(ordered[index + 1].id)}>下一章</Button>
      <Button onClick={onClose}>关闭</Button>
    </Space>
  }>{chapter ? <Space direction="vertical" style={{ width: '100%' }}>
    <Space wrap>
      <Select aria-label="阅读章节" value={chapter.id} style={{ width: 220 }} onChange={onSelect} options={ordered.map(item => ({ value: item.id, label: `第 ${item.chapterNumber} 章 · rev ${item.revision}` }))} />
      <Tag>rev {chapter.revision}</Tag>
      <Text type="secondary">采用于 {new Date(chapter.createdAt).toLocaleString()}</Text>
      {chapter.stale && <Tag color="warning">前文已变，需要复核</Tag>}
    </Space>
    <Text type="secondary">只读查看已采用的原文。采用记录不代表已通过当前设计的质量验收。</Text>
    <div key={chapter.id} style={{ maxHeight: '60vh', overflow: 'auto', width: '100%' }}>
      <Paragraph style={{ whiteSpace: 'pre-wrap', lineHeight: 1.9 }}>{chapter.content}</Paragraph>
    </div>
  </Space> : <Empty description="该采用稿已更新，请关闭后重新选择章节" />}</Modal>;
}
