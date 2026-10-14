import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { validateDesignCandidate } from '../packages/application/src/design-candidate.ts';
export { validateDesignCandidate };

async function main() {
  const { values } = parseArgs({ options: { candidate: { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('node --experimental-strip-types scripts/validate-design-candidate.mjs --candidate FILE [--output FILE]\nRead-only; exit 0 means contracts and structure are valid, not content approval. Exit 1 means invalid input.');
    return;
  }
  if (!values.candidate) throw new Error('--candidate is required');
  const bytes = await readFile(values.candidate);
  const result = { observedAt: new Date().toISOString(), candidateFileSha256: createHash('sha256').update(bytes).digest('hex'),
    ...validateDesignCandidate(JSON.parse(bytes.toString('utf8'))) };
  const json = JSON.stringify(result, null, 2) + '\n';
  if (values.output) await writeFile(values.output, json, { flag: 'wx' });
  console.log(json);
  process.exitCode = result.valid ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
