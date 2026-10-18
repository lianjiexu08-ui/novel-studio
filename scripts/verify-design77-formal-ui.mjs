// Validate the saved browser observations against the applied formal recheck.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = 'data/audit-runtimes/design77-formal-reconsideration';
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const original = fs.readFileSync(`${root}/original-note-ax.txt`, 'utf8');
const result = fs.readFileSync(`${root}/result-ax.txt`, 'utf8');
for (const text of ['原文批次 3 · 计划 v77', '返修 消耗与恢复', '已正式复核解决，查看依据']) assert.ok(original.includes(text), text);
for (const text of ['正式复核 batch-3/costs · 计划 v77', '通过 消耗与恢复', '本批依据原文解决的原问题： batch-3/costs', '消耗与恢复的原文证据（24 条）', '不代表整项设计通过']) assert.ok(result.includes(text), text);
const applied = JSON.parse(fs.readFileSync(`${root}/apply-live.json`));
assert.equal(applied.verified, true); assert.equal(applied.stage.result.checks[0].verdict, 'pass');
assert.equal(applied.stage.result.checks[0].evidence.length, 24); assert.equal(applied.formalAcceptance, false);
const proof = { verified: true, observedAt: new Date().toISOString(),
  originalNegativeVisible: true, explicitReconsiderationLinkVisible: true, resultVisible: true, evidenceCount: 24,
  scopeLimitationVisible: true, finalUi: 'data/audit-ui/design77-formal-reconsideration-v5/dist',
  apiPreflightSha256: sha('docs/audits/2026-10-18-design77-formal-api-preflight-v5.json'),
  observations: Object.fromEntries(['original-note-ax.txt', 'original-note.jpg', 'result-ax.txt', 'result.jpg'].map(file => [`${root}/${file}`, sha(`${root}/${file}`)])),
  webSourceHashes: Object.fromEntries(['apps/web/src/pages/DesignContentReviewCard.tsx', 'apps/web/src/pages/ReviewAnnotations.tsx', 'apps/web/src/api.ts'].map(file => [file, sha(file)])),
  modelCalls: 0, productionWrites: 0, formalAcceptance: false };
fs.copyFileSync(process.argv[1], `${root}/verify-ui.mjs`, fs.constants.COPYFILE_EXCL);
fs.writeFileSync('docs/audits/2026-10-18-design77-formal-reconsideration-ui.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx', flush: true });
console.log(JSON.stringify({ verified: true, originalNegativeVisible: true, resultVisible: true, formalAcceptance: false }));
