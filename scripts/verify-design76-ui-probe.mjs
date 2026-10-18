// Verify the real browser's read-only request log against the isolated runtime.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const bindingPath='data/audit-runtimes/design76-ui-runtime-v2-bound.json';
const binding=JSON.parse(fs.readFileSync(bindingPath));
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(hash(`${binding.runtimePath}/${p}`),h);
for(const[p,h]of Object.entries(binding.dependencyHashes))assert.equal(hash(p),h);
const response=await fetch('http://127.0.0.1:18787/__probe');assert.equal(response.status,200);
const probe=await response.json();assert.equal(probe.readOnly,true);
const requests=probe.requests.filter(r=>r.url!=='/__probe');
assert.ok(requests.every(r=>['GET','HEAD','OPTIONS'].includes(r.method)));
assert.ok(requests.every(r=>r.statusCode>=200&&r.statusCode<300));
const base='/works/work_8b6c9133e13d404083ca33acc63f4f61';
const required=[base,base+'/design',base+'/design/history',base+'/quality-audit',base+'/design/content-reviews?view=summary',
  base+'/design/review-runs/design_run_98b5460a-ed47-4ba2-bb06-7fdded1f910d/stages/batch-3',
  base+'/design/review-annotations?runId=design_run_98b5460a-ed47-4ba2-bb06-7fdded1f910d&stageId=batch-3',
  base+'/design/review-annotations/'+probe.annotationId];
for(const url of required)assert.ok(requests.some(r=>r.method==='GET'&&r.url===url&&r.statusCode===200),url);
const testLog='/tmp/novel-design76-all-tests.log',testText=fs.readFileSync(testLog,'utf8');
assert.ok(testText.includes('All TypeScript package and Node spike tests passed.'));
const total=key=>[...testText.matchAll(new RegExp('ℹ '+key+' (\\d+)','g'))].reduce((n,m)=>n+Number(m[1]),0);
assert.equal(total('fail'),0);
const proof={kind:'design76_private_ui_read_acceptance',createdAt:new Date().toISOString(),verified:true,
  runtimeBindingSha256:hash(bindingPath),sourceCommit:binding.sourceCommit,probeScriptSha256:hash('scripts/probe-design76-review-ui.mjs'),
  verifierSha256:hash(import.meta.filename),database:probe.database,annotationId:probe.annotationId,requests,
  tests:{passed:total('pass'),failed:0,logSha256:hash(testLog)},modelCalls:0,productionWrites:0,formalAcceptance:false,
  limitation:'Shared-client transaction queue only; this probe does not test separate processes competing for SQLite or approve story quality.'};
fs.writeFileSync('docs/audits/2026-10-18-design76-ui-probe.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,requests:requests.length,tests:proof.tests,productionWrites:0}));
