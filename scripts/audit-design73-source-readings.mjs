// Deterministic source excerpts and arithmetic, not a replacement model review.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inputPath = 'data/audit-runtimes/design73-review/inputs.json';
const bytes = fs.readFileSync(inputPath);
const inputs = JSON.parse(bytes);
const citations = [];
function cite(id, field, quote) {
  const source = inputs.power.sources.find(item => item.id === id)
    ?? inputs.story.sources.find(item => item.id === id);
  assert.ok(source, `Missing source ${id}`);
  const value = JSON.parse(source.text)[field];
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.ok(text.includes(quote), `Quote differs: ${id}/${field}`);
  citations.push({ sourceId: id, field, quote, sourceSha256: hash(source.text) });
  return citations.length - 1;
}
const findings = [
  {
    id: 'permit-expires-before-arrival', disposition: 'confirmed_design_conflict',
    evidence: [
      cite('plan/chapters/31', 'scenes', '凭证有效至216日晨卸货复核'),
      cite('plan/chapters/32', 'storyTime', '第214日日暮至第216日日暮；实体海程两昼夜'),
      cite('plan/chapters/32', 'scenes', '普通避火衣与借符按附单留到217日晨卸货交接后分别归还'),
    ],
    nextAction: 'Clarify departure-document scope and destination revalidation or validity through actual unloading; do not invent a completed renewal or shorten the two-day voyage.',
  },
  {
    id: 'failed-training-cycle-cost', disposition: 'confirmed_resource_gap',
    evidence: [
      cite('world/techniques/tech_19', 'cost', '每个十日周期实际消耗一枚下品青灵石'),
      cite('world/techniques/tech_19', 'cost', '耗材开封即扣，失败或中断不返'),
      cite('plan/milestones/ms_v3_training', 'setup', '周期3耗材报废、周期不计入有效六周期'),
      cite('plan/milestones/ms_v3_training', 'setup', '六个有效周期各实耗一枚下品青灵石'),
    ],
    arithmetic: '6 valid cycles + 1 failed opened cycle = 7 consumed stones',
    nextAction: 'Bind the seventh stone to actual available inventory, debit the failed cycle, and record required pre/post-cycle medical checks and restart permission; do not refund the failed cycle.',
  },
  {
    id: 'lifespan-dates-misread', disposition: 'review_claim_contradicted_by_sources',
    evidence: [
      cite('plan/chapters/28', 'endState', '第209日新增第二笔5元载，林辰条件性保守下界约13.479452元载'),
      cite('plan/chapters/32', 'endState', '第216日暮靠泊天宝外港'),
      cite('plan/chapters/32', 'endState', '保守下界约13.460274元载'),
    ],
    balances: [209, 216].map(day => ({ day, balance: 7 - 3 + 10 - (day - 19) / 365 })),
    nextAction: 'Preserve both date-specific balances. Obtain an evidence-linked review correction; do not rewrite day216 to the day209 value.',
  },
  {
    id: 'true-energy-carry-forward', disposition: 'review_claim_contradicted_by_sources',
    evidence: [
      cite('plan/chapters/30', 'cost', '实际完成两小时不施术静息后，仅记回半成至伤后上限六成'),
      cite('world/axioms/ax_05', 'content', '普通步行和肉身握持不凭空附加施术'),
      cite('plan/chapters/32', 'cost', '各扣半成，共一成；由六成降至五成'),
      cite('plan/chapters/42', 'cost', '沿用215日行动后保守余量五成'),
      cite('plan/chapters/42', 'cost', '此次缓慢试注共耗半成，余四成半'),
      cite('plan/chapters/42', 'cost', '一小时不受扰温和吐纳，复测只记回半成至伤后上限五成'),
      cite('plan/chapters/44', 'cost', '出剑前沿用239日复测的保守余量五成，一式二成后余三成'),
    ],
    arithmetic: 'chapter30: 6 - 0.5 + 0.5 = 6; chapter32/day215: 6 - 0.5 - 0.5 = 5; chapter42/day239: 5 - 0.5 + 0.5 = 5; chapter44/day244: 5 - 2 = 3',
    nextAction: 'Clarify chapter32/day215 as the balance origin if needed, retaining the actual day239 and day244 action dates. Do not invent an additional recovery or move the later action to day215.',
  },
  {
    id: 'separate-entry-and-guard-teams', disposition: 'clarification_needed_not_proven_date_collision',
    evidence: [
      cite('plan/chapters/18', 'summary', '褚衡与邵闻在外门核对186日出发的换班牌与行粮'),
      cite('plan/chapters/19', 'summary', '第181日至183日，林辰、苏凌霜携本批联名符牌'),
      cite('plan/chapters/19', 'summary', '顾峤与杜砺在内外口交接'),
    ],
    nextAction: 'Clarify the first entry party and later relief guards, their route/escort and handoff duties; preserve the different actors and existing three-day travel dates.',
  },
];
assert.equal(findings[2].balances[0].balance.toFixed(6), '13.479452');
assert.equal(findings[2].balances[1].balance.toFixed(6), '13.460274');
const proof = {
  observedAt: new Date().toISOString(), inputPath, inputsSha256: hash(bytes), findings, citations,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false, blockersClosed: 0,
  limitation: 'Source excerpts and arithmetic only. Formal report judgments remain unchanged. This does not prove full design quality or settle all retained review findings.',
};
const outputPath = 'docs/audits/2026-10-18-design73-source-readings.json';
fs.writeFileSync(outputPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ outputPath, findings: findings.map(({ id, disposition }) => ({ id, disposition })) }));
