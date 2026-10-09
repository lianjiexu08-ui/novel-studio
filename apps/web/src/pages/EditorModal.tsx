import { useEffect, useState, type ReactNode } from 'react';
import { Form, Modal } from 'antd';

export function EditorModal<T extends object>({
  open,
  title,
  initialValues,
  onCancel,
  onSubmit,
  children,
}: {
  open: boolean;
  title: string;
  initialValues: Partial<T>;
  onCancel: () => void;
  onSubmit: (values: T) => Promise<void>;
  children: ReactNode;
}) {
  const [form] = Form.useForm<T>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue(initialValues as never);
    }
  }, [open, initialValues, form]);

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await onSubmit(values);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onCancel}
      onOk={() => void submit().catch(() => undefined)}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        {children}
      </Form>
    </Modal>
  );
}
