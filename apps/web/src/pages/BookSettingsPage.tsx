import { useEffect, useMemo, useState } from 'react';
import {
  Alert, App as AntApp, Button, Empty, Form, Input, InputNumber, Popconfirm, Radio, Select, Spin, Table, Tabs, Tag, Tooltip,
} from 'antd';
import { DeleteOutlined, EditOutlined, LockOutlined, PlusOutlined, UnlockOutlined } from '@ant-design/icons';
import { useOutletContext } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { EditorModal } from './EditorModal';
import type { BibleDto, CharacterDto, RelationshipDto, WorldRuleDto } from 'novel-studio-contracts';
import type { WorkspaceContext } from './Workspace';

const { TextArea } = Input;

const ROLE_LABEL: Record<CharacterDto['role'], string> = {
  protagonist: '主角',
  major: '主要人物',
  supporting: '配角',
  minor: '龙套',
};

const RULE_LABEL: Record<WorldRuleDto['category'], string> = {
  power: '力量体系',
  cost: '代价与禁忌',
  resource: '资源',
  institution: '势力与制度',
  geography: '地理',
  other: '其他',
};

type Editing<T> = { open: false } | { open: true; item?: T };

function LockButton({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  return (
    <Tooltip title={locked ? '已锁定。模型不能改，你要先解锁才能编辑或删除' : '锁定后模型不能改动'}>
      <Button size="small" type="text" icon={locked ? <LockOutlined style={{ color: 'var(--gold)' }} /> : <UnlockOutlined />} onClick={onToggle} />
    </Tooltip>
  );
}

function RowActions({ locked, onEdit, onDelete, onToggleLock }: {
  locked: boolean; onEdit: () => void; onDelete: () => void; onToggleLock: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
      <LockButton locked={locked} onToggle={onToggleLock} />
      <Tooltip title={locked ? '先解锁' : '编辑'}>
        <Button size="small" type="text" icon={<EditOutlined />} disabled={locked} onClick={onEdit} />
      </Tooltip>
      <Popconfirm title="确定删除？" okText="删除" cancelText="取消" onConfirm={onDelete} disabled={locked}>
        <Tooltip title={locked ? '先解锁' : '删除'}>
          <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={locked} />
        </Tooltip>
      </Popconfirm>
    </div>
  );
}

export function BookSettingsPage() {
  const { message } = AntApp.useApp();
  const { work } = useOutletContext<WorkspaceContext>();
  const [bible, setBible] = useState<BibleDto | null>(null);
  const [editingCharacter, setEditingCharacter] = useState<Editing<CharacterDto>>({ open: false });
  const [editingRelationship, setEditingRelationship] = useState<Editing<RelationshipDto>>({ open: false });
  const [editingRule, setEditingRule] = useState<Editing<WorldRuleDto>>({ open: false });

  async function load() {
    try {
      setBible(await api.bible(work.id));
    } catch (error) {
      message.error(error instanceof ApiRequestError ? `[${error.code}] ${error.message}` : String(error));
    }
  }

  useEffect(() => { void load(); }, [work.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action: () => Promise<unknown>, success?: string): Promise<boolean> {
    try {
      await action();
      if (success) message.success(success);
      await load();
      return true;
    } catch (error) {
      message.error(error instanceof ApiRequestError ? error.message : String(error));
      return false;
    }
  }

  const nameOf = useMemo(() => {
    const names = new Map((bible?.characters ?? []).map((item) => [item.id, item.name]));
    return (characterId: string) => names.get(characterId) ?? characterId;
  }, [bible]);

  if (!bible) return <div className="state-block"><Spin size="large" /></div>;

  const knownIds = new Set(bible.characters.map((item) => item.id));
  const orphanSubjects = [...new Set(bible.states.filter((state) => !knownIds.has(state.characterId)).map((state) => state.characterId))];
  const characterOptions = bible.characters.map((item) => ({ value: item.id, label: item.name }));

  const charactersTab = (
    <>
      <div className="panel-head">
        <p className="panel-note">名字和别名都指向同一个人物。「当前状态」只来自已经采用的章节，不能在这里手改。</p>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditingCharacter({ open: true })}>添加人物</Button>
      </div>
      {orphanSubjects.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`采用稿里出现了还没有档案的主体：${orphanSubjects.join('、')}`}
          description="这是占位模型写的事件。以后接上真实模型，事件会指向这里的人物 ID。"
        />
      )}
      <Table
        rowKey="id"
        size="middle"
        pagination={false}
        dataSource={bible.characters}
        locale={{ emptyText: <Empty description="还没有人物" /> }}
        columns={[
          {
            title: '人物', key: 'name', width: 200,
            render: (_: unknown, row: CharacterDto) => (
              <div>
                <strong>{row.name}</strong>
                {row.aliases.length > 0 && <div className="toc-meta">{row.aliases.join(' / ')}</div>}
              </div>
            ),
          },
          { title: '定位', dataIndex: 'role', width: 100, render: (role: CharacterDto['role']) => <span className="tag tag-gold">{ROLE_LABEL[role]}</span> },
          { title: '身份', dataIndex: 'identity', ellipsis: true },
          { title: '目标', dataIndex: 'goal', ellipsis: true },
          {
            title: '当前状态', key: 'state', width: 180,
            render: (_: unknown, row: CharacterDto) => {
              const states = bible.states.filter((state) => state.characterId === row.id);
              return states.length
                ? states.map((state) => <div key={state.field} className="toc-meta">{state.field} = {String(state.value)}</div>)
                : <span className="toc-meta">尚无采用稿记录</span>;
            },
          },
          {
            title: '', key: 'actions', width: 120,
            render: (_: unknown, row: CharacterDto) => (
              <RowActions
                locked={row.locked}
                onToggleLock={() => void run(() => api.updateCharacter(work.id, row.id, { locked: !row.locked }), row.locked ? '已解锁' : '已锁定')}
                onEdit={() => setEditingCharacter({ open: true, item: row })}
                onDelete={() => void run(() => api.removeCharacter(work.id, row.id), '已删除')}
              />
            ),
          },
        ]}
      />
    </>
  );

  const relationshipsTab = (
    <>
      <div className="panel-head">
        <p className="panel-note">「客观」是故事里真实的关系；「认知」是前一个人怎么看后一个人，可以和事实不一致。锁定的关系，候选稿要是改了它，就不能采用。</p>
        <Tooltip title={bible.characters.length < 2 ? '至少先有两个人物' : undefined}>
          <Button type="primary" icon={<PlusOutlined />} disabled={bible.characters.length < 2} onClick={() => setEditingRelationship({ open: true })}>添加关系</Button>
        </Tooltip>
      </div>
      <Table
        rowKey="id"
        size="middle"
        pagination={false}
        dataSource={bible.relationships}
        locale={{ emptyText: <Empty description="还没有关系" /> }}
        columns={[
          {
            title: '人物', key: 'pair', width: 200,
            render: (_: unknown, row: RelationshipDto) => <span><strong>{nameOf(row.fromCharacterId)}</strong> → <strong>{nameOf(row.toCharacterId)}</strong></span>,
          },
          {
            title: '层', dataIndex: 'layer', width: 80,
            render: (layer: RelationshipDto['layer']) => <span className={layer === 'objective' ? 'tag tag-ok' : 'tag tag-warn'}>{layer === 'objective' ? '客观' : '认知'}</span>,
          },
          { title: '类型', dataIndex: 'kind', width: 100 },
          { title: '内容', dataIndex: 'value', ellipsis: true },
          { title: '起于', dataIndex: 'sinceChapter', width: 90, render: (value?: number) => (value ? `第 ${value} 章` : '—') },
          { title: '备注', dataIndex: 'note', ellipsis: true },
          {
            title: '', key: 'actions', width: 120,
            render: (_: unknown, row: RelationshipDto) => (
              <RowActions
                locked={row.locked}
                onToggleLock={() => void run(() => api.updateRelationship(work.id, row.id, { locked: !row.locked }), row.locked ? '已解锁' : '已锁定')}
                onEdit={() => setEditingRelationship({ open: true, item: row })}
                onDelete={() => void run(() => api.removeRelationship(work.id, row.id), '已删除')}
              />
            ),
          },
        ]}
      />
    </>
  );

  const rulesTab = (
    <>
      <div className="panel-head">
        <p className="panel-note">力量来源、门槛、代价、反制、资源和制度。这些是作品约束，不是已经发生的事件。</p>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditingRule({ open: true })}>添加规则</Button>
      </div>
      <Table
        rowKey="id"
        size="middle"
        pagination={false}
        dataSource={bible.worldRules}
        locale={{ emptyText: <Empty description="还没有世界规则" /> }}
        columns={[
          { title: '类别', dataIndex: 'category', width: 120, render: (category: WorldRuleDto['category']) => <span className="tag tag-gold">{RULE_LABEL[category]}</span> },
          { title: '规则', dataIndex: 'title', width: 180, render: (title: string) => <strong>{title}</strong> },
          { title: '内容', dataIndex: 'content', render: (content: string) => <span style={{ whiteSpace: 'pre-wrap' }}>{content}</span> },
          {
            title: '', key: 'actions', width: 120,
            render: (_: unknown, row: WorldRuleDto) => (
              <RowActions
                locked={row.locked}
                onToggleLock={() => void run(() => api.updateWorldRule(work.id, row.id, { locked: !row.locked }), row.locked ? '已解锁' : '已锁定')}
                onEdit={() => setEditingRule({ open: true, item: row })}
                onDelete={() => void run(() => api.removeWorldRule(work.id, row.id), '已删除')}
              />
            ),
          },
        ]}
      />
    </>
  );

  const characterItem = editingCharacter.open ? editingCharacter.item : undefined;
  const relationshipItem = editingRelationship.open ? editingRelationship.item : undefined;
  const ruleItem = editingRule.open ? editingRule.item : undefined;

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">本书</p>
          <h1 className="page-title">设定</h1>
          <p className="page-desc">人物、关系和世界规则只作用于当前作品。改这里不会改写已经采用的正文。</p>
        </div>
      </header>

      <div className="panel">
        <Tabs
          className="ns-tabs"
          items={[
            { key: 'characters', label: `人物 ${bible.characters.length}`, children: charactersTab },
            { key: 'relationships', label: `关系 ${bible.relationships.length}`, children: relationshipsTab },
            { key: 'rules', label: `世界规则 ${bible.worldRules.length}`, children: rulesTab },
          ]}
        />
      </div>

      <EditorModal<{ name: string; aliases: string[]; role: CharacterDto['role']; identity: string; goal: string; principles: string; voice: string; notes: string }>
        open={editingCharacter.open}
        title={characterItem ? `编辑人物「${characterItem.name}」` : '添加人物'}
        initialValues={characterItem ?? { role: 'supporting', aliases: [] }}
        onCancel={() => setEditingCharacter({ open: false })}
        onSubmit={async (values) => {
          const ok = await run(
            () => (characterItem ? api.updateCharacter(work.id, characterItem.id, values) : api.addCharacter(work.id, values)),
            characterItem ? '人物已更新' : '人物已添加',
          );
          if (ok) setEditingCharacter({ open: false });
        }}
      >
        <Form.Item name="name" label="名字" rules={[{ required: true, whitespace: true, message: '写一个名字' }]}><Input maxLength={50} /></Form.Item>
        <Form.Item name="aliases" label="别名与称号" extra="输入后按回车。不能和其他人物的名字重复。">
          <Select mode="tags" open={false} tokenSeparators={[',', '，', '、']} placeholder="如：渊哥、林师兄" />
        </Form.Item>
        <Form.Item name="role" label="定位">
          <Radio.Group options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} optionType="button" />
        </Form.Item>
        <Form.Item name="identity" label="身份"><TextArea rows={2} maxLength={1000} placeholder="出身、门派、血缘" /></Form.Item>
        <Form.Item name="goal" label="目标"><TextArea rows={2} maxLength={1000} /></Form.Item>
        <Form.Item name="principles" label="价值取向与底线"><TextArea rows={2} maxLength={1000} /></Form.Item>
        <Form.Item name="voice" label="说话方式"><TextArea rows={2} maxLength={1000} placeholder="口头禅、语气、用词习惯" /></Form.Item>
        <Form.Item name="notes" label="备注"><TextArea rows={2} maxLength={1000} /></Form.Item>
      </EditorModal>

      <EditorModal<{ fromCharacterId: string; toCharacterId: string; layer: RelationshipDto['layer']; kind: string; value: string; sinceChapter?: number; note: string }>
        open={editingRelationship.open}
        title={relationshipItem ? '编辑关系' : '添加关系'}
        initialValues={relationshipItem ?? { layer: 'objective' }}
        onCancel={() => setEditingRelationship({ open: false })}
        onSubmit={async (values) => {
          const body = { ...values, sinceChapter: values.sinceChapter ?? undefined };
          const ok = await run(
            () => (relationshipItem ? api.updateRelationship(work.id, relationshipItem.id, body) : api.addRelationship(work.id, body)),
            relationshipItem ? '关系已更新' : '关系已添加',
          );
          if (ok) setEditingRelationship({ open: false });
        }}
      >
        <Form.Item name="fromCharacterId" label="从" rules={[{ required: true, message: '选一个人物' }]}><Select options={characterOptions} /></Form.Item>
        <Form.Item name="toCharacterId" label="到" rules={[{ required: true, message: '选一个人物' }]}><Select options={characterOptions} /></Form.Item>
        <Form.Item name="layer" label="层">
          <Radio.Group optionType="button" options={[{ value: 'objective', label: '客观关系' }, { value: 'belief', label: '人物认知' }]} />
        </Form.Item>
        <Form.Item name="kind" label="类型" rules={[{ required: true, whitespace: true, message: '如师徒、血缘、敌对、信任' }]}><Input maxLength={30} placeholder="如：师徒、血缘、敌对、信任" /></Form.Item>
        <Form.Item name="value" label="内容"><Input maxLength={200} placeholder="如：亲传弟子、亲兄妹、恨之入骨" /></Form.Item>
        <Form.Item name="sinceChapter" label="从第几章起成立" extra="留空表示开篇之前就成立。"><InputNumber min={1} style={{ width: 160 }} /></Form.Item>
        <Form.Item name="note" label="备注"><TextArea rows={2} maxLength={500} /></Form.Item>
      </EditorModal>

      <EditorModal<{ category: WorldRuleDto['category']; title: string; content: string }>
        open={editingRule.open}
        title={ruleItem ? `编辑规则「${ruleItem.title}」` : '添加世界规则'}
        initialValues={ruleItem ?? { category: 'power' }}
        onCancel={() => setEditingRule({ open: false })}
        onSubmit={async (values) => {
          const ok = await run(
            () => (ruleItem ? api.updateWorldRule(work.id, ruleItem.id, values) : api.addWorldRule(work.id, values)),
            ruleItem ? '规则已更新' : '规则已添加',
          );
          if (ok) setEditingRule({ open: false });
        }}
      >
        <Form.Item name="category" label="类别"><Select options={Object.entries(RULE_LABEL).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Form.Item name="title" label="规则名" rules={[{ required: true, whitespace: true, message: '写一个规则名' }]}><Input maxLength={100} placeholder="如：境界划分、禁术代价" /></Form.Item>
        <Form.Item name="content" label="内容"><TextArea rows={5} maxLength={2000} /></Form.Item>
      </EditorModal>
    </section>
  );
}
