import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = p => JSON.parse(fs.readFileSync(p));
const control = 'data/audit-runtimes/design77-notes-continuation';
const uiPath = 'docs/audits/2026-10-18-design77-notes-continuation-segment-2-ui.json';
const notesPath = 'docs/audits/2026-10-18-design77-segment2-notes-applied.json';
const ui = read(uiPath), saved = read(notesPath);
assert.equal(ui.verified, true); assert.equal(ui.annotations.notesSha256, sha(notesPath));
assert.equal(saved.verdictChanges, 0); assert.equal(saved.notes.length, 2);
const axPath = `${control}/segment-2-notes-ax.txt`, screenshotPath = `${control}/segment-2-notes.jpg`;
const ax = fs.readFileSync(axPath, 'utf8');
const displayedChecks = ['原文批次 4 · 计划 v77', '独立核对记录（2 条，不改变原判定）',
  '本次评审携带的核对说明（0 条）', '通过 时空与分卷', '通过 近期成长目标与回报',
  ...saved.notes.flatMap(note => [note.claimQuote, note.explanation, ...note.evidence.map(e => e.quote)])];
for (const text of displayedChecks) assert.ok(ax.includes(text), text);
assert.equal(fs.readFileSync(screenshotPath).subarray(0, 3).toString('hex'), 'ffd8ff');
const result = { verified: true, uiPath, uiSha256: sha(uiPath), notesPath, notesSha256: sha(notesPath),
  axPath, axSha256: sha(axPath), screenshotPath, screenshotSha256: sha(screenshotPath), displayedChecks,
  annotationIds: saved.notes.map(note => note.id), originalVerdictsRetained: true,
  lateAnnotationsDistinguished: true, formalAcceptance: false, modelCalls: 0, productionWrites: 0 };
fs.writeFileSync('docs/audits/2026-10-18-design77-segment2-note-ui-verified.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ verified: true, displayedChecks: displayedChecks.length, formalAcceptance: false }));
