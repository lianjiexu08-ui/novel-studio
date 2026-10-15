// Dispatch-only clarification for the repeatedly rejected power follow-up.
// The frozen planner, source material, parser and acceptance rules stay intact.
export const citationRecoveryGuidance = '\n本次补读的格式复核：必须逐项阅读 citationRequirements 中的每个来源，特别不要遗漏 plan/overview。计划概览规定当前验收范围、细纲终点和宏观安排，不能用章节材料或其他计划片段代替该来源。按该索引找到本请求的真实片段，选择能支持判断的证据；同样核对原问题、全部原始依据和全部新增来源。不要穷举每个来源的全部片段。修复时也要重新核对完整要求，而不只修 problems 首先指出的一项。该提醒不预设通过；若原文不能支持解决，保留 insufficient 或 revise 并说明真实原因，不能机械补编号或删除 resolves 掩盖问题。';

export function citationRecoverySuffix(user) {
  const envelope = JSON.parse(user);
  const request = envelope.task === 'repair_previous_output' ? envelope.originalRequest : envelope;
  return request?.task === 'review_design_content'
    && request.area === 'power'
    && request.stage?.followupFor === 'cross-2-3/tiers'
    ? citationRecoveryGuidance : '';
}
