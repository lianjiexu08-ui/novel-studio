import { Alert, Button, Form, Input, InputNumber, Typography } from 'antd';
import { COVENANT_DEFAULTS, type CovenantFormValues } from '../covenant';

const { Text } = Typography;
const { TextArea } = Input;

export function CovenantForm({
  initialValues,
  submitText,
  submitting,
  onSubmit,
  showAuthorText = false,
}: {
  initialValues: CovenantFormValues;
  submitText: string;
  submitting: boolean;
  onSubmit: (values: CovenantFormValues) => Promise<void>;
  showAuthorText?: boolean;
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
        <Text type="secondary">保存后进入“世界构建”，规划模型会先生成世界包，再生成 Story Bible；作者可以逐步审核和锁定。</Text>
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
        <Form.Item name="substyle" label="题材流派" extra="例如「玄幻·废柴流」。没有想好就留空。">
          <Input placeholder="如 玄幻·退婚流、仙侠·凡人流" maxLength={50} />
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
        <Form.Item name="protagonistGoal" label="主角想要什么" extra="没有想好就留空。">
          <TextArea rows={2} maxLength={500} placeholder="例如：查清父亲死因，护住妹妹。" />
        </Form.Item>
        <Form.Item name="obstacle" label="主要阻碍">
          <TextArea rows={2} maxLength={500} placeholder="例如：凶手是宗门长老，而主角只是外门弟子。" />
        </Form.Item>
        <Form.Item name="readingExperience" label="想给读者的感觉">
          <TextArea rows={2} maxLength={500} placeholder="例如：憋屈不过三章，每卷一次大翻盘。" />
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
        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item name="targetChapterCount" label="目标章数" extra="生成全书计划时的默认值，可留空。">
            <InputNumber min={1} max={2000} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="volumeCount" label="分卷数">
            <InputNumber min={1} max={50} style={{ width: 160 }} />
          </Form.Item>
        </div>
        <Form.Item name="chapterWords" label="单章字数" rules={[{ required: true, type: 'number', min: 500, max: 20000, message: '单章字数在 500 到 20000 之间' }]}>
          <InputNumber min={500} max={20000} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="updateCadence" label="更新节奏" rules={[{ required: true, whitespace: true, message: '写一个更新节奏，或保留「日更」' }]}>
          <Input maxLength={50} placeholder={COVENANT_DEFAULTS.updateCadence} />
        </Form.Item>
        {showAuthorText && (
          <Form.Item name="authorText" label="这次修改，你的原话" extra="原话会和结构化结果一起留在约定历史里，方便以后回看当时为什么这样改。">
            <TextArea rows={3} maxLength={4000} placeholder="例如：我想让主角更狠一点，第一卷不要再忍了。" />
          </Form.Item>
        )}
        <Button type="primary" htmlType="submit" loading={submitting}>{submitText}</Button>
      </Form>
    </>
  );
}
