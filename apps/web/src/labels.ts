export const OUTBOX_LABELS: Record<string, string> = {
  projection: '状态投影',
  search_index: '检索索引',
  export: '导出',
  publication_check: '发布核验',
};

export const CHECK_LABELS: Record<string, string> = {
  deterministic_rules: '确定性规则',
  semantic_checker: '语义审查',
};

export const CHECK_TAG_COLOR: Record<string, string> = {
  passed: 'success',
  failed: 'error',
  inconclusive: 'warning',
  unavailable: 'default',
};

export function checkMessage(checker: string, message: string): string {
  if (checker === 'deterministic_rules' && message === 'ok') return '正文非空，可以通过';
  if (checker === 'deterministic_rules' && message === 'empty chapter') return '正文为空，不能采用';
  if (checker === 'semantic_checker' && message === 'checker unavailable') return '审查模型不可用，不能当作通过';
  return message;
}

export function countChars(content: string): number {
  return content.replace(/\s/g, '').length;
}
