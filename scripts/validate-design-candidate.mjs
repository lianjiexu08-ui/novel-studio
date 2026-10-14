import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { worldPackSchema, storyBibleSchema } from '../packages/contracts/src/world.ts';
import { bookPlanSchema } from '../packages/contracts/src/planning.ts';
import { validateWorldPack, validateStoryBible } from '../novel-service-core/src/world.ts';
import { reviewBookPlan } from '../novel-service-core/src/planning.ts';

/** Read-only preflight for a complete proposed bundle. Match all three API
 * contracts before any save rehearsal; never normalize or drop text silently. */
export function validateDesignCandidate(candidate) {
  const schemas = { worldPack: worldPackSchema, storyBible: storyBibleSchema, plan: bookPlanSchema };
  const issues = [], warnings = [], blockers = [];
  const result = () => ({ valid: issues.length === 0, issues, warnings, blockers,
    formalAcceptance: false, productionWrites: false,
    limitation: 'Checks API contracts and structural references only. Open blockers remain; this does not approve a plan, accept content quality, or certify an atomic save.' });
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    issues.push({ path: '', code: 'INVALID_BUNDLE', message: 'Expected worldPack, storyBible and plan documents' });
    return result();
  }
  for (const key of Object.keys(candidate)) if (!Object.hasOwn(schemas, key)) {
    issues.push({ path: key, code: 'UNKNOWN_DOCUMENT', message: 'Unexpected bundle field; no content was discarded' });
  }
  for (const [key, schema] of Object.entries(schemas)) {
    const parsed = schema.safeParse(candidate[key]);
    if (!parsed.success) issues.push(...parsed.error.issues.map(issue => ({
      path: [key, ...issue.path].join('.'), code: issue.code, message: issue.message,
    })));
    else if (!isDeepStrictEqual(parsed.data, candidate[key])) issues.push({ path: key, code: 'NORMALIZATION_REQUIRED',
      message: 'API parsing would change this document; normalize explicitly, inspect the diff and revalidate before saving' });
  }
  if (issues.length) return result();
  const { worldPack, storyBible, plan } = candidate;
  for (const [key, validation] of [['worldPack', validateWorldPack(worldPack)], ['storyBible', validateStoryBible(storyBible, worldPack)]]) {
    issues.push(...validation.errors.map(message => ({ path: key, code: 'INVALID_REFERENCE_OR_STRUCTURE', message })));
    warnings.push(...validation.warnings.map(message => ({ path: key, message })));
  }
  if (storyBible.worldPackId !== worldPack.id || storyBible.worldPackRevision !== worldPack.revision) {
    issues.push({ path: 'storyBible.worldPackRevision', code: 'WORLD_BINDING_MISMATCH', message: 'Story bible must reference the submitted world ID and revision' });
  }
  for (const [key, questions] of [['worldPack', worldPack.unresolvedQuestions], ['storyBible', storyBible.unresolvedQuestions]]) {
    blockers.push(...questions.filter(q => q.blocking && q.status !== 'resolved').map(q => ({ path: `${key}.unresolvedQuestions`, id: q.id, code: 'BLOCKING_QUESTION' })));
  }
  for (const issue of reviewBookPlan(plan, { characterIds: new Set(storyBible.characters.map(c => c.id)) })) {
    if (issue.code === 'BLOCKING_QUESTION') blockers.push({ path: 'plan.openQuestions', id: issue.nodeId, code: issue.code });
    else if (issue.severity === 'error') issues.push({ path: 'plan', ...issue });
    else warnings.push({ path: 'plan', ...issue });
  }
  return result();
}

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
