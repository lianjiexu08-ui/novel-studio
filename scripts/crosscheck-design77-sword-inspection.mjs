// Preserve the original revise; distinguish omitted material from absent rules.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const verificationPath = 'docs/audits/2026-10-18-design77-shared-review-segment-1.json', verification = read(verificationPath);
assert.equal(sha(verification.checkpointPath), verification.checkpointSha256);
const checkpoint = read(verification.checkpointPath);
assert.equal(verification.workerAbsent, true);
const run = checkpoint.runs.find(r => r.input.area === 'power'), stage = run.stages.find(s => s.id === 'batch-3');
const check = stage.result.checks.find(c => c.criterion === 'costs'); assert.equal(check.verdict, 'revise');
const bindingPath = 'data/audit-runtimes/design77-runtime-bound.json', binding = read(bindingPath);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(sha(`${binding.runtimePath}/${p}`), h);
const { annotationSources, designReviewCheckHash } = await import(`${binding.runtimePath}/novel-service-core/src/design-review-annotations.ts`);
const { addDesignReviewAnnotationSchema } = await import(`${binding.runtimePath}/packages/contracts/src/design-review.ts`);
const directory = 'data/audit-runtimes/design77-shared-review/model-calls';
const requestPath = `${directory}/00012.started.json`, request = JSON.parse(read(requestPath).request.user);
assert.ok(!request.sources.some(s => s.origin?.sourceId === 'world/artifacts/art_03'));
assert.deepEqual(stage.modelResponses, ['00012', '00013'].map(id => read(`${directory}/${id}.response.json`).response.text));
const claimQuote = '未定义这种试注是否属于施剑、御物、器物检验或其他操作，也没有对应对象、效果和失败后果。';
assert.ok(check.explanation.includes(claimQuote));
const evidence = [
  { sourceId: 'world/artifacts/art_03', quote: '冷却后的低流量试注是单独的器身复用检查，每次预付本人凝元健康稳定真元上限的半成，另于挥击、剑诀和御物计费；中断、异常或检查失败均不退' },
  { sourceId: 'world/artifacts/art_03', quote: '低流量试注只供已在授业中练成凝元注剑、收注与冷却检查者执行，不能由持剑或晋阶自动取得' },
  { sourceId: 'world/artifacts/art_03', quote: '一次最多三息，半成是整次上限和固定支出，不因延长或多试免费' },
  { sourceId: 'world/artifacts/art_03', quote: '听到异响、剑柄灼热、掌痛或导气不稳即停注，已付不退，剑停用待检修和复验' },
  { sourceId: 'plan/chapters/20', quote: '执行核算：10−2−0.5+1.5=9成；两小时吐纳上限为2成，实际只记1.5成，不抵销此前已付费用。' },
];
for (const item of evidence) assert.ok(run.input.sources.find(s => s.id === item.sourceId)?.text.includes(item.quote));
const localPath = 'docs/audits/2026-10-18-design77-sword-inspection-review.json', local = read(localPath);
assert.equal(local.formalInputHash, run.input.inputHash); assert.equal(local.verified, true);
const annotationInput = addDesignReviewAnnotationSchema.parse({ requestKey: 'design77-power-batch3-sword-inspection',
  runId: run.id, stageId: stage.id, criterion: 'costs', expectedInputHash: run.input.inputHash, expectedCheckHash: designReviewCheckHash(check), claimQuote,
  explanation: '本批未提供赤霞斩铁剑art_03完整原文，不能由此认定世界设定没有试注规则。当前任务的完整输入已经列明：这是独立器身复用检查，须已学会注剑、收注及冷却检查；每次预付健康稳定真元上限半成，与挥击、剑诀和御物分账，最长三息，无攻击效果，异常即停、已付不退并停用待检修。第20章10−2−0.5+1.5=9的账也有明确原文。已另行保存带完整器物、功法及18/20/21章的局部复核，不能把该局部结果当成整项力量验收。本说明指出原返修依据遗漏必要规则；保留原revise、原答与待补读项，不删除半成费用，不自动关闭问题，也不宣称后补说明已进入原任务的模型输入。', evidence });
annotationSources({ designReviewRuns: new Map([[run.id, run]]) }, annotationInput);
const responsePath = `${directory}/00013.response.json`;
const result = { verified: true, verificationPath, verificationSha256: sha(verificationPath), requestPath, requestSha256: sha(requestPath), responsePath, responseSha256: sha(responsePath),
  bindingPath, bindingSha256: sha(bindingPath), runId: run.id, stageId: stage.id, acceptedStageSha256: hash(stage),
  originalCheck: check, originalCheckHash: designReviewCheckHash(check), artifactPresentInFullInput: true, artifactOmittedFromBatch: true,
  localPath, localSha256: sha(localPath), localVerdict: local.result.checks[0].verdict, annotationInput,
  productionWrites: 0, modelCalls: 0, formalAcceptance: false };
fs.writeFileSync('docs/audits/2026-10-18-design77-sword-inspection-scope.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ verified: true, originalVerdict: check.verdict, localVerdict: result.localVerdict, productionWrites: 0 }));
