// Inventory current proposal obligations without changing their status or gates.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const candidatePath = 'data/design-candidates/design76-followup-controls-v7.json';
const candidate = read(candidatePath), applied = read('docs/audits/2026-10-18-design77-proposal-applied.json');
assert.equal(hash(candidate), applied.candidateSha256);
const frozen = read('data/audit-runtimes/design77-shared-review/inputs.json');
assert.ok(Object.values(frozen).every(input => input.inputHash === applied.newInputHash));
const questions = [];
for (const [document, key, field] of [['world', 'worldPack', 'unresolvedQuestions'], ['story', 'storyBible', 'unresolvedQuestions'], ['plan', 'plan', 'openQuestions']]) {
  for (const question of candidate[key][field]) if (question.blocking && question.status !== 'resolved') {
    questions.push({ document, ...question, chapterChecks: [] });
  }
}
const allChecks = candidate.plan.chapters.flatMap(chapter => (chapter.executionChecks ?? []).map(check => ({ chapterNumber: chapter.chapterNumber, ...check })));
for (const question of questions) question.chapterChecks = allChecks.filter(check => check.sourceQuestion?.document === question.document && check.sourceQuestion.questionId === question.id);
const groups = new Map();
for (const question of questions) {
  const members = groups.get(question.question) ?? [];
  members.push({ document: question.document, id: question.id });
  groups.set(question.question, members);
}
assert.equal(questions.length, 41);
const gatePaths = ['novel-service-core/src/world.ts', 'novel-service-core/src/planning.ts', 'novel-service-core/src/core.ts', 'packages/application/src/index.ts'];
const result = { planId: applied.appliedPlanId, inputHash: applied.newInputHash, candidateSha256: applied.candidateSha256,
  blockingRecords: questions.length, distinctExactQuestionTexts: groups.size,
  exactTextDuplicates: [...groups].filter(([, members]) => members.length > 1).map(([question, members]) => ({ question, members })),
  chapterChecks: allChecks.length, checksWithQuestionReference: allChecks.filter(check => check.sourceQuestion).length,
  blockingRecordsWithAtLeastOneChapterCheck: questions.filter(q => q.chapterChecks.length).length,
  questions, gateSourceHashes: Object.fromEntries(gatePaths.map(p => [p, sha(p)])),
  productionWrites: 0, modelCalls: 0, formalAcceptance: false,
  limitation: 'Exact-text grouping and explicit reference inventory only. Linked checks do not prove complete coverage or execution. Mixed design and future-prose requirements remain open; no obligation is closed, downgraded, or reclassified by this inventory.' };
fs.writeFileSync('docs/audits/2026-10-18-design77-blocker-scope.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ records: questions.length, distinctTexts: groups.size, duplicateGroups: result.exactTextDuplicates.length, checks: allChecks.length, linkedChecks: result.checksWithQuestionReference, linkedBlockers: result.blockingRecordsWithAtLeastOneChapterCheck, productionWrites: 0 }));
