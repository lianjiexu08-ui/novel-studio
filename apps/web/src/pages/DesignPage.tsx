import { useEffect, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Collapse, Col, Empty, List, Row, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { LockOutlined, PlayCircleOutlined, RocketOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { api, ApiRequestError } from '../api';
import type { DesignDto } from 'novel-studio-contracts';
import type { StoryBibleContract as StoryBible, WorldPackContract as WorldPack } from 'novel-studio-contracts';
import { useOutletContext } from 'react-router-dom';
import type { WorkspaceContext } from './Workspace';

const { Text, Title, Paragraph } = Typography;
const statusLabel: Record<string, string> = { draft: '草稿', proposed: '待审核', reviewed: '已审核', locked: '已锁定', deprecated: '已废弃' };

function StatusTag({ status }: { status: string }) {
  return <Tag color={status === 'locked' ? 'success' : status === 'reviewed' ? 'processing' : status === 'proposed' ? 'warning' : 'default'}>{statusLabel[status] ?? status}</Tag>;
}

function DefinitionList({ items }: { items: Array<{ title: string; content: string }> }) {
  return <List size="small" dataSource={items} renderItem={(item) => <List.Item><div><Text strong>{item.title}</Text><Paragraph style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{item.content}</Paragraph></div></List.Item>} />;
}

function WorldDetails({ world }: { world: WorldPack }) {
  return <Collapse items={[
    { key: 'rules', label: `世界规则与术语（${world.axioms.length + world.terminology.length}）`, children: <DefinitionList items={[...world.axioms.map((item) => ({ title: item.title, content: item.content })), ...world.terminology.map((item) => ({ title: item.canonical, content: item.aliases.join('、') || '无别名' }))]} /> },
    { key: 'power', label: `力量体系（${world.powerSystems.length} 个体系，${world.realms.length} 个境界）`, children: <Table size="small" pagination={false} rowKey="id" dataSource={world.realms} columns={[{ title: '境界', dataIndex: 'name' }, { title: '等级', dataIndex: 'rank', width: 64 }, { title: '能力', dataIndex: 'capabilities', render: (v: string[]) => v.join('、') }, { title: '代价', dataIndex: 'cost' }]} /> },
    { key: 'techniques', label: `功法与秘术（${world.techniques.length}）`, children: <Table size="small" pagination={false} rowKey="id" dataSource={world.techniques} columns={[{ title: '名称', dataIndex: 'name' }, { title: '类型', dataIndex: 'kind' }, { title: '效果', dataIndex: 'effect' }, { title: '限制', dataIndex: 'limitations', render: (v: string[]) => v.join('、') }]} /> },
    { key: 'artifacts', label: `法宝与资源（${world.artifacts.length + world.resources.length}）`, children: <Row gutter={[16, 16]}><Col span={12}><Table size="small" pagination={false} rowKey="id" dataSource={world.artifacts} columns={[{ title: '法宝', dataIndex: 'name' }, { title: '品阶', dataIndex: 'tier' }, { title: '效果', dataIndex: 'effect' }]} /></Col><Col span={12}><Table size="small" pagination={false} rowKey="id" dataSource={world.resources} columns={[{ title: '资源', dataIndex: 'name' }, { title: '来源', dataIndex: 'source' }, { title: '稀缺度', dataIndex: 'scarcity' }]} /></Col></Row> },
    { key: 'geography', label: `大陆、地点与势力（${world.locations.length + world.factions.length}）`, children: <Row gutter={[16, 16]}><Col span={12}><Table size="small" pagination={false} rowKey="id" dataSource={world.locations} columns={[{ title: '地点', dataIndex: 'name' }, { title: '类型', dataIndex: 'kind' }, { title: '入口条件', dataIndex: 'entryConditions', render: (v: string[]) => v.join('、') || '无' }]} /></Col><Col span={12}><Table size="small" pagination={false} rowKey="id" dataSource={world.factions} columns={[{ title: '势力', dataIndex: 'name' }, { title: '目标', dataIndex: 'goals', render: (v: string[]) => v.join('、') }]} /></Col></Row> },
    { key: 'history', label: `历史事件（${world.historicalEvents.length}）`, children: <DefinitionList items={world.historicalEvents.map((item) => ({ title: `${item.title} · ${item.storyTime}`, content: `${item.causes.join('；')} → ${item.consequences.join('；')}` }))} /> },
  ]} />;
}

function StoryDetails({ bible }: { bible: StoryBible }) {
  return <Collapse items={[
    { key: 'characters', label: `人物与关系（${bible.characters.length} 人，${bible.relationships.length} 条关系）`, children: <Row gutter={[16, 16]}><Col span={12}><Table size="small" pagination={false} rowKey="id" dataSource={bible.characters} columns={[{ title: '人物', dataIndex: 'name' }, { title: '角色', dataIndex: 'role' }, { title: '目标', dataIndex: 'goal' }, { title: '身份', dataIndex: 'identity' }]} /></Col><Col span={12}><Table size="small" pagination={false} rowKey="id" dataSource={bible.relationships} columns={[{ title: '关系', dataIndex: 'kind' }, { title: '描述', dataIndex: 'value' }, { title: '锁定', dataIndex: 'locked', render: (v: boolean) => v ? '是' : '否' }]} /></Col></Row> },
    { key: 'arcs', label: `弧光、伏笔与承诺（${bible.arcs.length} 条弧光，${bible.secrets?.length ?? 0} 个秘密，${bible.promises?.length ?? 0} 个承诺）`, children: <DefinitionList items={[...bible.arcs.map((item) => ({ title: item.title, content: `${item.goal}；代价：${item.stakes}；结局：${item.plannedOutcome}` })), ...(bible.secrets ?? []).map((item) => ({ title: `秘密：${item.title}`, content: `揭示条件：${item.revealCondition}` })), ...(bible.promises ?? []).map((item) => ({ title: `承诺：${item.title}`, content: `${item.promise}；兑现条件：${item.payoffCondition}` })), ...(bible.openThreads ?? []).map((item) => ({ title: `开放线：${item.title}`, content: `${item.question}；计划收束：${item.plannedResolution}` }))]} /> },
    { key: 'volumes', label: `分卷大纲（${bible.volumes.length} 卷，共 ${bible.volumes.reduce((sum, item) => sum + item.plannedChapterCount, 0)} 章）`, children: <Table size="small" pagination={false} rowKey="id" dataSource={[...bible.volumes].sort((a, b) => a.order - b.order)} columns={[{ title: '卷', dataIndex: 'order', width: 56 }, { title: '标题', dataIndex: 'title' }, { title: '目标', dataIndex: 'goal' }, { title: '高潮', dataIndex: 'climax' }, { title: '章节', dataIndex: 'plannedChapterCount', width: 72 }]} /> },
  ]} />;
}

export function DesignPage() {
  const { message } = AntApp.useApp();
  const { work, refresh } = useOutletContext<WorkspaceContext>();
  const [design, setDesign] = useState<DesignDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setDesign(null);
    try { setDesign(await api.design(work.id)); } catch { setDesign({ constraintRevision: work.constraintRevision }); }
  }
  useEffect(() => { void load(); }, [work.id, work.constraintRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    try { await action(); await refresh(); await load(); message.success(success); }
    catch (error) { message.error(error instanceof ApiRequestError ? `[${error.code}] ${error.message}` : String(error)); }
    finally { setBusy(null); }
  }

  if (!design) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  const world = design.worldPack;
  const bible = design.storyBible;
  const ready = world?.status === 'locked' && bible?.status === 'locked';
  const worldAction = !world ? <Button type="primary" icon={<PlayCircleOutlined />} loading={busy === 'world-generate'} onClick={() => void run('world-generate', () => api.generateDesign(work.id, 'world_pack'), '世界包已生成，等待审核')}>生成世界包</Button>
    : world.status === 'locked' ? <StatusTag status={world.status} />
      : world.status === 'reviewed' ? <Button icon={<LockOutlined />} loading={busy === 'world-lock'} onClick={() => void run('world-lock', () => api.lockWorldPack(work.id), '世界包已锁定')}>锁定世界包</Button>
        : <Button icon={<SafetyCertificateOutlined />} loading={busy === 'world-review'} onClick={() => void run('world-review', () => api.reviewWorldPack(work.id), '世界包结构检查通过，已进入审核态')}>审核世界包</Button>;
  const bibleAction = !world || world.status !== 'locked' ? <Text type="secondary">先锁定世界包</Text>
    : !bible ? <Button type="primary" icon={<PlayCircleOutlined />} loading={busy === 'bible-generate'} onClick={() => void run('bible-generate', () => api.generateDesign(work.id, 'story_bible'), 'Story Bible 已生成，等待审核')}>生成 Story Bible</Button>
      : bible.status === 'locked' ? <StatusTag status={bible.status} />
        : bible.status === 'reviewed' ? <Button icon={<LockOutlined />} loading={busy === 'bible-lock'} onClick={() => void run('bible-lock', () => api.lockStoryBible(work.id), 'Story Bible 已锁定')}>锁定 Story Bible</Button>
          : <Button icon={<SafetyCertificateOutlined />} loading={busy === 'bible-review'} onClick={() => void run('bible-review', () => api.reviewStoryBible(work.id), 'Story Bible 结构检查通过，已进入审核态')}>审核 Story Bible</Button>;

  return <Space direction="vertical" size={20} style={{ width: '100%' }}>
    <div><Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}><div><Title level={4} style={{ margin: 0 }}>世界构建与全书蓝图</Title><Text type="secondary">作者提供创意和偏好，模型先产出世界包，再产出人物关系、人物弧光、伏笔和分卷大纲；每一步都要审核并锁定。</Text></div><Button type="primary" icon={<RocketOutlined />} loading={busy === 'milestone'} onClick={() => void run('milestone', () => api.startMilestone100(work.id), '已启动首个 100 章里程碑后台任务')}>一键启动 100 章里程碑</Button></Space></div>
    {!ready && <Alert type="warning" showIcon message="正文生产尚未开放" description="World Pack 和 Story Bible 都锁定后，章节候选才会通过生成门禁。" />}
    {ready && <Alert type="success" showIcon message="可以开始章节生产" description="章节候选会绑定当前世界包与 Story Bible 版本。任何设定修改都会让旧候选失效。" />}
    <Row gutter={16}>
      <Col xs={24} md={12}><Card title="World Pack" extra={world ? <StatusTag status={world.status} /> : worldAction}>{!world ? <Empty description="还没有生成世界包" /> : <Space direction="vertical" style={{ width: '100%' }}><Space>{worldAction}</Space><Text strong>{world.title}</Text><Paragraph type="secondary">{world.summary || '暂无摘要'}</Paragraph><Row gutter={[12, 12]}><Col span={8}><Statistic title="境界" value={world.realms.length} /></Col><Col span={8}><Statistic title="功法" value={world.techniques.length} /></Col><Col span={8}><Statistic title="法宝" value={world.artifacts.length} /></Col><Col span={8}><Statistic title="大陆/地点" value={world.locations.length} /></Col><Col span={8}><Statistic title="势力" value={world.factions.length} /></Col><Col span={8}><Statistic title="历史事件" value={world.historicalEvents.length} /></Col></Row><WorldDetails world={world} /></Space>}</Card></Col>
      <Col xs={24} md={12}><Card title="Story Bible" extra={bible ? <StatusTag status={bible.status} /> : bibleAction}>{!bible ? <Space direction="vertical"><Empty description="还没有生成 Story Bible" />{bibleAction}</Space> : <Space direction="vertical" style={{ width: '100%' }}><Space>{bibleAction}</Space><Text strong>核心冲突：{bible.coreConflict}</Text><Paragraph type="secondary">结局方向：{bible.endingDirection || '未填写'}</Paragraph><Row gutter={[12, 12]}><Col span={8}><Statistic title="人物" value={bible.characters.length} /></Col><Col span={8}><Statistic title="关系" value={bible.relationships.length} /></Col><Col span={8}><Statistic title="弧光" value={bible.arcs.length} /></Col><Col span={8}><Statistic title="秘密" value={bible.secrets?.length ?? 0} /></Col><Col span={8}><Statistic title="承诺/开放线" value={(bible.promises?.length ?? 0) + (bible.openThreads?.length ?? 0)} /></Col><Col span={8}><Statistic title="计划章节" value={bible.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0)} /></Col></Row><StoryDetails bible={bible} /></Space>}</Card></Col>
    </Row>
  </Space>;
}
