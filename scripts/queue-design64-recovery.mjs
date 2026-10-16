import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const root = '/Users/lianjie/Documents/ChatGPT/novel';
const control = root + '/data/audit-runtimes/design64-control';
const runner = root + '/scripts/resume-design64-review.mjs';
const proof = JSON.parse(fs.readFileSync(root + '/docs/audits/2026-10-16-design64-recovery-rehearsal-3.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const alive = pid => {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code !== 'ESRCH') throw error; return false; }
};
assert.equal(hash(fs.readFileSync(runner)), proof.resumeScriptSha256);
assert.equal(process.env.DATABASE_URL, 'file:' + root + '/data/novel-studio.db');
const initial = JSON.parse(fs.readFileSync(control + '/result.json'));
assert.ok(['running', 'completed_with_failures', 'completed'].includes(initial.status));
assert.equal(initial.runtimeCommit, proof.runtimeCommit);
const out = control + '/resume-waiter.json';
const state = { status: 'waiting_for_original_queue', pid: process.pid, originalPid: initial.pid,
  startedAt: new Date().toISOString(), runnerSha256: proof.resumeScriptSha256,
  productionDatabaseWrites: 0, modelCalls: 0 };
if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ status: 'preflight_passed', originalStatus: initial.status,
    originalProcessAlive: alive(initial.pid), runnerSha256: state.runnerSha256, modelCalls: 0, databaseWrites: false }));
} else {
  fs.writeFileSync(out, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
  const save = () => {
    fs.writeFileSync(out + '.pending', JSON.stringify(state, null, 2) + '\n');
    fs.renameSync(out + '.pending', out);
  };
  try {
    const deadline = Date.now() + 12 * 60 * 60 * 1000;
    while (true) {
      const bytes = fs.readFileSync(control + '/result.json');
      const current = JSON.parse(bytes);
      assert.equal(current.pid, initial.pid, 'Original queue was replaced');
      assert.equal(current.runtimeCommit, initial.runtimeCommit);
      if (!alive(current.pid)) {
        assert.ok(['completed_with_failures', 'completed'].includes(current.status), 'Original exited without a terminal checkpoint');
        state.priorCheckpointSha256 = hash(bytes);
        if (current.status === 'completed') { state.status = 'skipped_no_failures'; break; }
        assert.equal(hash(fs.readFileSync(runner)), state.runnerSha256, 'Recovery runner changed after rehearsal');
        assert.ok(!fs.existsSync(control + '/resume-1-result.json'), 'Recovery already exists; inspect it');
        state.status = 'resuming'; save();
        const child = spawn(process.execPath, ['--experimental-strip-types', runner, '--execute',
          '--prior-sha256=' + state.priorCheckpointSha256], { cwd: root, env: process.env, stdio: 'inherit' });
        state.recoveryPid = child.pid; save();
        const code = await new Promise((resolve, reject) => {
          child.once('error', reject); child.once('exit', (exitCode, signal) => resolve(exitCode ?? signal));
        });
        assert.equal(code, 0, 'Recovery process failed');
        const result = JSON.parse(fs.readFileSync(control + '/resume-1-result.json'));
        assert.equal(result.priorCheckpointSha256, state.priorCheckpointSha256);
        state.status = result.status;
        state.modelCalls = result.resumeUsage.calls;
        state.totalCalls = result.totalCalls;
        state.productionDatabaseWrites = 'review progress only; protected history verified by recovery';
        break;
      }
      assert.ok(Date.now() < deadline, 'Original queue still live after observation window; no restart attempted');
      await setTimeout(5000);
    }
  } catch (error) {
    state.status = 'stopped'; state.error = String(error.message); process.exitCode = 1;
  } finally { state.finishedAt = new Date().toISOString(); save(); }
  console.log(JSON.stringify(state));
}
