import { Alert, Button, Form, Input, InputNumber, Radio, Typography } from 'antd';
import { COVENANT_DEFAULTS, type CovenantFormValues } from '../covenant';

const { Text } = Typography;
const { TextArea } = Input;

export function CovenantForm({
  initialValues,
  submitText,
  submitting,
  onSubmit,
}: {
  initialValues: CovenantFormValues;
  submitText: string;
  submitting: boolean;
  onSubmit: (values: CovenantFormValues) => Promise<void>;
}) {
  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="先定读者承诺和硬边界"
        description="约定不是已经发生的故事。世界、人物和章节都从这里长出来。样章可以只当文风参考，不会自动把剧情写进正式故事。"
      />
      <div style={{ marginBottom: 16 }}>
        <Radio.Group value="expand">
          <Radio.Button value="expand">展开我的创意</Radio.Button>
          <Radio.Button value="discover" disabled>帮我找故事方向</Radio.Button>
        </Radio.Group>
        <div style={{ marginTop: 8 }}>
          <Text type="secondary">保存后进入“世界构建”，规划模型会先生成世界包，再生成 Story Bible；作者可以逐步审核和锁定。</Text>
        </div>
      </div>
      <Form
        layout="vertical"
        requiredMark
        initialValues={initialValues}
        onFinish={(values) => void onSubmit(values as CovenantFormValues)}
      >
        <Form.Item name="title" label="书名" rules={[{ required: true, whitespace: true, message: '先写书名' }]}>
          <Input placeholder="如《玄天帝尊》" maxLength={200} />
        </Form.Item>
        <Form.Item label="题材">
          <Input value="玄幻" disabled />
        </Form.Item>
        <Form.Item name="substyle" label="子风格" extra="没有想好就留空。">
          <Input placeholder="如宗门、退婚、洪荒" maxLength={50} />
        </Form.Item>
        <Form.Item
          name="audience"
          label="读者与阅读体验"
          rules={[{ required: true, whitespace: true, message: '写明谁在看，以及希望读者读的时候是什么感觉' }]}
        >
          <TextArea rows={3} maxLength={500} placeholder="例如：喜欢境界提升很清楚的读者，每章都要感到往前走了一步。" />
        </Form.Item>
        <Form.Item
          name="hook"
          label="核心吸引点"
          rules={[{ required: true, whitespace: true, message: '写明这本书靠什么让人想看下一章' }]}
        >
          <TextArea rows={3} maxLength={500} placeholder="例如：主角用寿命换禁术，赢一次就少活一段。" />
        </Form.Item>
        <Form.Item name="mustKeep" label="必须保留" extra="你已经定了、后面不能被模型改掉的想法。没有就留空。">
          <TextArea rows={2} maxLength={1000} placeholder="例如：开篇三年之约必须兑现。" />
        </Form.Item>
        <Form.Item name="lockedNotes" label="锁定关系" extra="这是作者约束，还不是故事里已经发生的关系。模型不能解除。">
          <TextArea rows={2} maxLength={1000} placeholder="例如：师徒不能反目。" />
        </Form.Item>
        <Form.Item name="avoid" label="避免元素">
          <TextArea rows={2} maxLength={1000} placeholder="例如：不要系统面板，不要后宫。" />
        </Form.Item>
        <Form.Item name="targetLength" label="预计长度" extra="还没想好就用建议值，之后可以改。">
          <Input maxLength={100} placeholder={COVENANT_DEFAULTS.targetLength} />
        </Form.Item>
        <Form.Item name="chapterWords" label="单章字数" rules={[{ required: true, type: 'number', min: 500, max: 20000, message: '单章字数在 500 到 20000 之间' }]}>
          <InputNumber min={500} max={20000} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="updateCadence" label="更新节奏" rules={[{ required: true, whitespace: true, message: '写一个更新节奏，或保留「日更」' }]}>
          <Input maxLength={50} placeholder={COVENANT_DEFAULTS.updateCadence} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={submitting}>{submitText}</Button>
      </Form>
    </>
  );
}
