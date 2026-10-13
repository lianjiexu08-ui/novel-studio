import { useState } from 'react';
import { Empty, InputNumber, Space, Table, Typography } from 'antd';
import type { StoryBibleContract } from 'novel-studio-contracts';

const labels = { unaware: '尚不知情', suspects: '有所怀疑', believes: '暂时相信', confirmed: '已确认' };

export function KnowledgePlanView({ bible }: { bible: StoryBibleContract }) {
  const [chapter, setChapter] = useState(1);
  const rows = (bible.secrets ?? []).filter((secret) => secret.status !== 'deprecated').flatMap((secret) =>
    (secret.knowledgeStages ?? []).filter((stage) => stage.sinceChapter <= chapter && (stage.untilChapter === undefined || stage.untilChapter >= chapter))
      .map((stage) => ({ ...stage, key: `${secret.id}-${stage.characterId}-${stage.sinceChapter}`, title: secret.title,
        character: bible.characters.find((character) => character.id === stage.characterId)?.name ?? stage.characterId })));
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Typography.Text type="secondary">查看某章的认知计划。缺少阶段表示尚未设计，不代表角色不知道；已采纳认知仍以章节事件为准。</Typography.Text>
    <Space><label htmlFor="knowledge-plan-chapter">计划章节</label><InputNumber id="knowledge-plan-chapter" min={1} precision={0} value={chapter} onChange={(value) => setChapter(value ?? 1)} /></Space>
    <Table size="small" pagination={{ pageSize: 6 }} rowKey="key" dataSource={rows}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此章没有认知阶段计划" /> }}
      columns={[
        { title: '秘密 / 人物', render: (_, row) => <>{row.title}<br />{row.character}</> },
        { title: '计划范围', render: (_, row) => `${row.sinceChapter}–${row.untilChapter ?? '后续'}` },
        { title: '认知与误解', render: (_, row) => <>{labels[row.certainty]}：{row.belief}</> },
        { title: '线索与选择后果', render: (_, row) => <>{row.trigger}<br />后果：{row.consequence}</> },
        { title: '不能推知', dataIndex: 'forbiddenInferences', render: (items: string[]) => items.join('；') || '未列额外限制' },
      ]} />
  </Space>;
}
