import { useEffect, useState } from 'react';
import { Alert, Card, Col, Empty, Row, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { api } from '../api';
import type { DesignDto } from 'novel-studio-contracts';
import { useOutletContext } from 'react-router-dom';
import type { WorkspaceContext } from './Workspace';

const { Text, Title } = Typography;

const statusLabel: Record<string, string> = {
  draft: '草稿', proposed: '待审核', reviewed: '已审核', locked: '已锁定', deprecated: '已废弃',
};

function StatusTag({ status }: { status: string }) {
  return <Tag color={status === 'locked' ? 'success' : status === 'reviewed' ? 'processing' : 'warning'}>{statusLabel[status] ?? status}</Tag>;
}

export function DesignPage() {
  const { work } = useOutletContext<WorkspaceContext>();
  const [design, setDesign] = useState<DesignDto | null>(null);

  useEffect(() => {
    setDesign(null);
    api.design(work.id).then(setDesign).catch(() => setDesign({ constraintRevision: work.constraintRevision }));
  }, [work.id, work.constraintRevision]);

  if (!design) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;

  const world = design.worldPack;
  const bible = design.storyBible;
  const ready = world?.status === 'locked' && bible?.status === 'locked';

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>世界构建与全书蓝图</Title>
        <Text type="secondary">先锁定世界规则，再锁定人物关系、主线和分卷大纲，之后才进入百万字正文生产。</Text>
      </div>
      {!ready && <Alert type="warning" showIcon message="正文生产尚未开放" description="World Pack 和 Story Bible 都锁定后，章节候选才会通过生成门禁。" />}
      {ready && <Alert type="success" showIcon message="可以开始章节生产" description="章节候选会绑定当前世界包与 Story Bible 版本。任何设定修改都会让旧候选失效。" />}

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Card title="World Pack" extra={world ? <StatusTag status={world.status} /> : undefined}>
            {!world ? <Empty description="还没有生成世界包" /> : (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text strong>{world.title}</Text>
                <Text type="secondary">{world.summary || '暂无摘要'}</Text>
                <Row gutter={[12, 12]}>
                  <Col span={8}><Statistic title="境界" value={world.realms.length} /></Col>
                  <Col span={8}><Statistic title="功法" value={world.techniques.length} /></Col>
                  <Col span={8}><Statistic title="法宝" value={world.artifacts.length} /></Col>
                  <Col span={8}><Statistic title="大陆/地点" value={world.locations.length} /></Col>
                  <Col span={8}><Statistic title="势力" value={world.factions.length} /></Col>
                  <Col span={8}><Statistic title="历史事件" value={world.historicalEvents.length} /></Col>
                </Row>
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Story Bible" extra={bible ? <StatusTag status={bible.status} /> : undefined}>
            {!bible ? <Empty description="还没有生成 Story Bible" /> : (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text strong>核心冲突：{bible.coreConflict}</Text>
                <Text type="secondary">结局方向：{bible.endingDirection || '未填写'}</Text>
                <Row gutter={[12, 12]}>
                  <Col span={8}><Statistic title="人物" value={bible.characters.length} /></Col>
                  <Col span={8}><Statistic title="关系" value={bible.relationships.length} /></Col>
                  <Col span={8}><Statistic title="主线弧光" value={bible.arcs.length} /></Col>
                  <Col span={8}><Statistic title="分卷" value={bible.volumes.length} /></Col>
                  <Col span={8}><Statistic title="计划章节" value={bible.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0)} /></Col>
                  <Col span={8}><Statistic title="约束版本" value={design.constraintRevision} prefix="rev " /></Col>
                </Row>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={[...bible.volumes].sort((a, b) => a.order - b.order)}
                  columns={[
                    { title: '卷', dataIndex: 'order', width: 56 },
                    { title: '标题', dataIndex: 'title' },
                    { title: '章节', dataIndex: 'plannedChapterCount', width: 70 },
                  ]}
                />
              </Space>
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
