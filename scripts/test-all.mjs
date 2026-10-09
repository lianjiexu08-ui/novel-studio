import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packageDirs = [
  'novel-service-core',
  'packages/contracts',
  'packages/model-gateway',
  'packages/planner',
  'packages/application',
  'packages/persistence',
  'packages/worker',
  'apps/api',
];

function run(label, command, args, cwd) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const relative of packageDirs) {
  const directory = join(root, relative);
  const files = readdirSync(join(directory, 'test')).filter((file) => file.endsWith('.test.ts')).map((file) => join('test', file));
  run(relative, process.execPath, ['--experimental-strip-types', '--test', ...files], directory);
}

const spike = join(root, 'novel-service-spike');
if (existsSync(join(spike, 'test_queue.mjs'))) run('novel-service-spike/node', process.execPath, ['--test', 'test_queue.mjs'], spike);

console.log('\nAll TypeScript package and Node spike tests passed.');
