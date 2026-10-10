import { useEffect, useState } from 'react';
import { Alert, App as AntApp, Button, Form, Input, InputNumber, Popconfirm, Select, Switch } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api, ApiRequestError } from '../api';
import type { ModelSettingsDto, UpdateModelSettingsRequest } from 'novel-studio-contracts';

type FormValues = {
  name: string;
  endpoint: string;
  apiKey: string;
  planningModel: string;
  writingModel: string;
  timeoutMs: number;
  independentExtraction: boolean;
  fallback: boolean;
};

const blank: FormValues = { name: '', endpoint: '', apiKey: '', planningModel: '', writingModel: '', timeoutMs: 180_000, independentExtraction: true, fallback: true };

interface Preset {
  id: string;
  label: string;
  name: string;
  endpoint: string;
  models: string[];
  planningModel?: string;
  writingModel?: string;
  note?: string;
  warning?: string;
}

const PRESETS: Preset[] = [
  {
    id: 'deepseek', label: 'DeepSeek 官方', name: 'DeepSeek 官方', endpoint: 'https://api.deepseek.com',
    models: ['deepseek-v4-pro', 'deepseek-flash'], planningModel: 'deepseek-v4-pro', writingModel: 'deepseek-flash',
    note: '用 DeepSeek 开放平台的 key。规划建议 deepseek-v4-pro，正文可以用更快的 deepseek-flash。',
  },
  {
    id: 'moonshot', label: 'Kimi 开放平台', name: 'Kimi 开放平台', endpoint: 'https://api.moonshot.cn/v1', models: [],
    note: '用 Kimi 开放平台（platform.moonshot.cn）按量付费的 key。填好密钥后拉取模型列表再选。',
  },
  {
    id: 'kimi-coding', label: 'Kimi 编程套餐', name: 'Kimi 编程套餐', endpoint: 'https://api.kimi.com/coding/v1',
    models: ['kimi-for-coding'], planningModel: 'kimi-for-coding', writingModel: 'kimi-for-coding',
    warning: 'Kimi 编程套餐只允许 Kimi CLI、Claude Code 这类编程工具调用，会检查客户端标识；官方说明伪造标识属于违规，可能被暂停会员权益。Novel Studio 不会冒充编程工具，所以这条可能被限流或拒绝，用来写小说也可能不符合套餐条款。想用 Kimi 写小说，更稳的是「Kimi 开放平台」的 key。',
  },
];

export function SystemPage() {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<FormValues>();
  const [current, setCurrent] = useState<ModelSettingsDto | null>(null);
  const [editingId, setEditingId] = useState<string | 'new'>('new');
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<'save' | 'use' | 'test' | 'models' | 'delete' | null>(null);
  const [preset, setPreset] = useState<Preset | null>(null);

  function applyPreset(next: Preset) {
    setPreset(next);
    setModels(next.models);
    form.setFieldsValue({
      name: next.name,
      endpoint: next.endpoint,
      planningModel: next.planningModel ?? '',
      writingModel: next.writingModel ?? '',
    });
  }

  function show(settings: ModelSettingsDto, channelId: string | 'new') {
    setCurrent(settings);
    setEditingId(channelId);
    setModels([]);
    setPreset(null);
    const channel = channelId === 'new' ? undefined : settings.channels.find((item) => item.id === channelId);
    form.setFieldsValue(channel
      ? { name: channel.name, endpoint: channel.endpoint, apiKey: '', planningModel: channel.planningModel, writingModel: channel.writingModel, timeoutMs: channel.timeoutMs, independentExtraction: channel.independentExtraction, fallback: channel.fallback }
      : blank);
  }

  useEffect(() => {
    api.modelSettings().then((settings) => show(settings, settings.activeId ?? (settings.channels[0]?.id ?? 'new'))).catch((error) => {
      message.error(error instanceof ApiRequestError ? error.message : String(error));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toRequest(values: FormValues, activate?: boolean): UpdateModelSettingsRequest {
    return {
      id: editingId === 'new' ? undefined : editingId,
      name: values.name.trim(),
      endpoint: values.endpoint.trim(),
      apiKey: values.apiKey.trim() || undefined,
      planningModel: values.planningModel?.trim() ?? '',
      writingModel: values.writingModel?.trim() ?? '',
      timeoutMs: values.timeoutMs,
      independentExtraction: values.independentExtraction,
      fallback: values.fallback,
      activate,
    };
  }

  function probeBody(values: FormValues) {
    const request = toRequest(values);
    return {
      id: request.id, endpoint: request.endpoint, apiKey: request.apiKey,
      planningModel: request.planningModel, writingModel: request.writingModel, timeoutMs: request.timeoutMs,
    };
  }

  async function probe(step: 'test' | 'models') {
    const values = form.getFieldsValue();
    form.setFields([{ name: 'planningModel', errors: [] }, { name: 'writingModel', errors: [] }]);
    if (!values.endpoint?.trim()) { message.error('先填写接口地址'); return; }
    if (!values.apiKey?.trim() && !editing?.hasApiKey) { message.error('先填写 API 密钥'); return; }
    setBusy(step);
    try {
      if (step === 'test') {
        const result = await api.testModelSettings(probeBody(values));
        if (result.ok) message.success(result.message);
        else message.error(result.message);
        return;
      }
      const result = await api.listModels(probeBody(values));
      setModels(result.models);
      if (result.message) message.error(result.message);
      else if (result.models.length === 0) message.warning('接口没有返回模型');
      else message.success(`拉到 ${result.models.length} 个模型，在下面的下拉框里选择`);
    } catch (error) {
      message.error(error instanceof ApiRequestError ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function run(step: typeof busy, action: (values: FormValues) => Promise<void>) {
    const values = await form.validateFields();
    setBusy(step);
    try {
      await action(values);
    } catch (error) {
      message.error(error instanceof ApiRequestError ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  const editing = editingId === 'new' ? undefined : current?.channels.find((channel) => channel.id === editingId);
  const active = editingId !== 'new' && editingId === current?.activeId;
  const planningValue = Form.useWatch('planningModel', form);
  const writingValue = Form.useWatch('writingModel', form);
  const modelOptions = (selected?: string) => {
    const ids = selected && !models.includes(selected) ? [selected, ...models] : models;
    return ids.map((id) => ({ value: id, label: id }));
  };
  const keyHint = editing?.hasApiKey
    ? `这条渠道已保存密钥${editing.apiKeyHint ? `，末四位 ${editing.apiKeyHint}` : ''}。留空表示不修改。`
    : '密钥只保存在这台机器的服务端，页面不会再把它读回来。';

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">本机</p>
          <h1 className="page-title">系统设置</h1>
          <p className="page-desc">可以保存多条模型渠道。「使用中」的那条负责规划和写作；它过载、被限流或超时时，按列表顺序自动换到标成「备用」的渠道。</p>
        </div>
        {current && (
          <span className={`tag ${current.configured ? 'tag-ok' : 'tag-warn'}`}>
            {current.configured ? '当前渠道已接入' : '当前没有可用渠道'}
          </span>
        )}
      </header>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">渠道</h2>
            <p className="panel-note">{current?.channels.length ? `已保存 ${current.channels.length} 条，存在 ${current.storedAt}。` : '还没有渠道。先添加一条。'}</p>
          </div>
          <Button icon={<PlusOutlined />} onClick={() => current && show(current, 'new')}>新增渠道</Button>
        </div>
        {current?.channels.map((channel) => (
          <button key={channel.id} type="button" className="check-row" onClick={() => show(current, channel.id)}
            style={{ width: '100%', textAlign: 'left', background: channel.id === editingId ? 'rgba(215,176,116,0.08)' : 'transparent', border: 'none', cursor: 'pointer' }}>
            <span className={`tag ${channel.id === current.activeId ? 'tag-ok' : channel.fallback ? 'tag-gold' : 'tag-mute'}`}>{channel.id === current.activeId ? '使用中' : channel.fallback ? '备用' : '停用'}</span>
            <span><strong>{channel.name}</strong><span className="toc-meta"> {channel.endpoint || '未填地址'} · {channel.planningModel || '未填模型'}</span></span>
          </button>
        ))}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">{editingId === 'new' ? '新渠道' : editing?.name || '编辑渠道'}</h2>
            <p className="panel-note">{active ? '这是当前正在用的渠道，保存后立刻生效。' : '保存只更新这一条。要点「改用这条」，规划和写作才会切过来。'}</p>
          </div>
        </div>
        <Form form={form} layout="vertical" initialValues={blank} style={{ maxWidth: 640 }}>
          {editingId === 'new' && (
            <Form.Item label="快速填写" extra="选一家会先填好地址和推荐模型，密钥还要自己填。">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PRESETS.map((item) => (
                  <Button key={item.id} type={preset?.id === item.id ? 'primary' : 'default'} onClick={() => applyPreset(item)}>{item.label}</Button>
                ))}
              </div>
            </Form.Item>
          )}
          {preset?.note && <Alert type="info" showIcon style={{ marginBottom: 16 }} message={preset.note} />}
          {preset?.warning && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="注意" description={preset.warning} />}
          <Form.Item name="name" label="渠道名称" rules={[{ required: true, whitespace: true, message: '起个名字，方便以后切换' }]}>
            <Input maxLength={40} placeholder="如：官方、中转 A、本地" />
          </Form.Item>
          <Form.Item name="endpoint" label="接口地址" extra="OpenAI 兼容接口。末尾的 /v1 可写可不写。" rules={[{ required: true, whitespace: true, message: '填写接口地址' }]}>
            <Input placeholder="https://api.example.com" autoComplete="off" />
          </Form.Item>
          <Form.Item name="apiKey" label="API 密钥" extra={keyHint}>
            <Input.Password placeholder={editing?.hasApiKey ? '留空则继续使用已保存的密钥' : 'sk-…'} autoComplete="new-password" />
          </Form.Item>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <Button loading={busy === 'test'} onClick={() => void probe('test')}>测试连接</Button>
            <Button loading={busy === 'models'} onClick={() => void probe('models')}>拉取模型列表</Button>
            {models.length > 0 && <span className="toc-meta" style={{ alignSelf: 'center' }}>{models.length} 个模型</span>}
          </div>
          <Form.Item name="planningModel" label="规划模型" extra={models.length ? '从拉到的列表里选。用于全书计划、世界包和 Story Bible。' : '先测试连接，再拉取模型列表，然后在这里选择。'} rules={[{ required: true, message: '选择规划模型' }]}>
            <Select showSearch optionFilterProp="label" options={modelOptions(planningValue)} placeholder={models.length ? '选择规划模型' : '先拉取模型列表'} notFoundContent="先点「拉取模型列表」" />
          </Form.Item>
          <Form.Item name="writingModel" label="写作模型" extra="从同一份列表里选。留空则正文也用规划模型。">
            <Select showSearch allowClear optionFilterProp="label" options={modelOptions(writingValue)} placeholder={models.length ? '选择写作模型' : '先拉取模型列表'} notFoundContent="先点「拉取模型列表」" />
          </Form.Item>
          <Form.Item name="timeoutMs" label="超时（毫秒）" extra="模型连续这么久没有任何输出才算超时；只要还在输出就会一直等。" rules={[{ required: true, type: 'number', min: 5000, max: 600000, message: '5000 到 600000 之间' }]}>
            <InputNumber min={5000} max={600000} step={1000} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="independentExtraction" label="独立抽取" valuePropName="checked" extra="生成正文后再读一遍，核对事件是否和正文一致。">
            <Switch />
          </Form.Item>
          <Form.Item name="fallback" label="作为备用" valuePropName="checked" extra={active ? '这条正在使用。改用别的渠道后，它会按这个开关决定是否当备用。' : '使用中的渠道过载、被限流或超时时，按列表顺序换到这条，用它自己的规划和写作模型。'}>
            <Switch />
          </Form.Item>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button loading={busy === 'save'} onClick={() => void run('save', async (values) => {
              const saved = await api.saveModelSettings(toRequest(values, active));
              show(saved, saved.savedId ?? saved.activeId ?? 'new');
              message.success(active ? '已保存，当前渠道立即生效' : '已保存。它还是备用渠道');
            })}>保存</Button>
            <Button type="primary" loading={busy === 'use'} onClick={() => void run('use', async (values) => {
              const saved = await api.saveModelSettings(toRequest(values, true));
              show(saved, saved.savedId ?? saved.activeId ?? 'new');
              message.success(saved.configured ? '已改用这条渠道' : '已改用这条渠道，但地址、密钥或模型名还不完整');
            })}>改用这条</Button>
            {editing && (
              <Popconfirm title={`删除渠道「${editing.name}」？`} description="只删除这一条，其他渠道还在。" okText="删除" cancelText="取消"
                onConfirm={() => {
                  setBusy('delete');
                  api.removeModelChannel(editing.id)
                    .then((saved) => { show(saved, saved.activeId ?? 'new'); message.success('已删除这条渠道'); })
                    .catch((error) => message.error(error instanceof ApiRequestError ? error.message : String(error)))
                    .finally(() => setBusy(null));
                }}>
                <Button danger loading={busy === 'delete'}>删除这条</Button>
              </Popconfirm>
            )}
          </div>
        </Form>
      </div>
    </section>
  );
}
