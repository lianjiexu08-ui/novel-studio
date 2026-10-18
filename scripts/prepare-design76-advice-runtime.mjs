// Bind an annotation-only runtime and UI build. No model or database writes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const priorBindingPath='data/audit-runtimes/design76-citation-capacity-runtime-bound.json',nextBindingPath='data/audit-runtimes/design76-advice-runtime-bound.json';
const prior=read(priorBindingPath),next=read(nextBindingPath);
assert.deepEqual(Object.keys(prior.sourceHashes).sort(),Object.keys(next.sourceHashes).sort());
for(const b of [prior,next]){
 for(const[p,h]of Object.entries(b.sourceHashes))assert.equal(sha(`${b.runtimePath}/${p}`),h);
 for(const[p,h]of Object.entries(b.dependencyHashes))assert.equal(sha(p),h);
}
const changed=Object.keys(next.sourceHashes).filter(p=>next.sourceHashes[p]!==prior.sourceHashes[p]).sort();
assert.deepEqual(changed,['apps/api/test/review-annotations.test.ts','novel-service-core/src/design-review-annotations.ts','packages/contracts/src/design-review.ts','packages/persistence/test/review-annotations.test.ts']);
const testLog='/tmp/novel-advice-annotation-all-tests.log',testText=fs.readFileSync(testLog,'utf8');
assert.match(testText,/All TypeScript package and Node spike tests passed/);assert.ok(!/ℹ fail [1-9]/.test(testText));
const buildLog='/tmp/novel-advice-annotation-web-build.log';assert.match(fs.readFileSync(buildLog,'utf8'),/built in/);
const target='data/audit-ui/design76-review/dist-v5';assert.ok(!fs.existsSync(target),'Preserve an existing UI release');
fs.cpSync('apps/web/dist',target,{recursive:true,errorOnExist:true,force:false});
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]).sort();
const assets=Object.fromEntries(files(target).map(p=>[path.relative(target,p),sha(p)]));
const js=files(target).filter(p=>p.endsWith('.js')).map(p=>fs.readFileSync(p,'utf8')).join('');
assert.ok(js.includes('被核对的原返修建议：'));assert.ok(js.includes('http://127.0.0.1:8787'));
const proof={kind:'design76_advice_annotation_runtime_preparation',prepared:true,priorBindingPath,priorBindingSha256:sha(priorBindingPath),
 nextBindingPath,nextBindingSha256:sha(nextBindingPath),sourceCommit:next.sourceCommit,changedRuntimeFiles:changed,
 unchangedReviewPromptsSchedulingAndValidation:true,testLog,testLogSha256:sha(testLog),tests:618,buildLog,buildLogSha256:sha(buildLog),
 uiRoot:path.resolve(target),assets,uiSourceSha256:sha('apps/web/src/pages/ReviewAnnotations.tsx'),
 modelCalls:0,productionWrites:0,deployed:false,formalAcceptance:false};
fs.writeFileSync('docs/audits/2026-10-18-design76-advice-runtime-preparation.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({prepared:true,changedRuntimeFiles:changed,uiRoot:target,modelCalls:0,productionWrites:0}));
