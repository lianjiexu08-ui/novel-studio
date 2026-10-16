// Freeze tested source for proposal70; old runtime directories remain intact.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const read = file => JSON.parse(fs.readFileSync(file));
const fileHash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const previous = read('data/audit-runtimes/design69-review30-runtime-bound.json');
const rehearsal = read('docs/audits/2026-10-17-design69-terminology-save-rehearsal.json');
for (const [file, expected] of Object.entries(rehearsal.sourceHashes)) assert.equal(fileHash(file), expected);
const runtimePath = path.resolve('data/audit-runtimes/design70-runtime');
const bindingPath = 'data/audit-runtimes/design70-runtime-bound.json';
assert.ok(!fs.existsSync(runtimePath) && !fs.existsSync(bindingPath), 'Do not replace a frozen runtime');
const sourceHashes = {};
for (const name of Object.keys(previous.sourceHashes)) {
  const target = path.join(runtimePath, name); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(name, target); sourceHashes[name] = fileHash(target);
}
fs.mkdirSync(path.join(runtimePath, 'node_modules'));
for (const name of fs.readdirSync('node_modules')) {
  const source = fs.realpathSync(path.resolve('node_modules', name));
  const local = path.join(runtimePath, path.relative(process.cwd(), source));
  fs.symlinkSync(fs.existsSync(path.join(local, 'package.json')) ? local : source, path.join(runtimePath, 'node_modules', name));
}
const binding = { runtimePath, frozenAt: new Date().toISOString(), scheduleVersion: 31,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceHashes };
fs.writeFileSync(bindingPath, JSON.stringify(binding, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ runtimePath, scheduleVersion: 31, sourceFiles: Object.keys(sourceHashes).length, productionWrites: 0 }));
