// Bind the captured note detail to the saved annotation and unchanged verdict.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = p => JSON.parse(fs.readFileSync(p));
const directory = 'data/audit-runtimes/design77-shared-review';
const uiPath = 'docs/audits/2026-10-18-design77-segment-1-ui-verified.json';
const notesPath = 'docs/audits/2026-10-18-design77-segment1-notes-applied.json';
const ui = read(uiPath), saved = read(notesPath);
assert.equal(ui.verified, true);
assert.equal(ui.annotations.proofSha256, sha(notesPath));
assert.equal(saved.verdictChanges, 0);
const note = saved.notes.find(n => n.criterion === 'costs');
assert.ok(note);
const axPath = `${directory}/segment-1-sword-note-ax.txt`;
const screenshotPath = `${directory}/segment-1-sword-note.png`;
const ax = fs.readFileSync(axPath, 'utf8');
const displayedChecks = [
  '原文批次 3 · 计划 v77',
  '独立核对记录（1 条，不改变原判定）',
  '本次评审携带的核对说明（0 条）',
  '返修 消耗与恢复',
  note.claimQuote,
  note.explanation,
  ...note.evidence.map(e => e.quote),
];
for (const text of displayedChecks) assert.ok(ax.includes(text), text);
const screenshot = fs.readFileSync(screenshotPath);
// The browser capture used a .png name but returned JPEG bytes; preserve it.
const screenshotMimeType = screenshot.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  ? 'image/png' : screenshot.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'image/jpeg' : undefined;
assert.ok(screenshotMimeType, 'Unsupported screenshot format');
const result = {
  verified: true, uiPath, uiSha256: sha(uiPath), notesPath, notesSha256: sha(notesPath),
  annotationId: note.id, runId: note.runId, stageId: note.stageId,
  axPath, axSha256: sha(axPath), screenshotPath, screenshotSha256: sha(screenshotPath), screenshotMimeType,
  displayedChecks, originalVerdictRetained: true, lateAnnotationDistinguished: true,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false,
};
fs.writeFileSync('docs/audits/2026-10-18-design77-segment1-note-ui-verified.json',
  JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ verified: true, displayedChecks: displayedChecks.length, formalAcceptance: false }));
