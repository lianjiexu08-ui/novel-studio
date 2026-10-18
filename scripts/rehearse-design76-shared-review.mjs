import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';import {startSharedReviewHost} from './shared-review-host.mjs';
const read=p=>JSON.parse(fs.readFileSync(p));const hash=v=>createHash('sha256').update(JSON.stringify(v)??'undefined').digest('hex');
const fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const preflightPath='docs/audits/2026-10-18-design76-shared-review-preflight.json',preflight=read(preflightPath);
const baseline=read(preflight.control+'/baseline.json'),binding=read('data/audit-runtimes/design76-ui-runtime-v2-bound.json');
assert.equal(fileHash('scripts/shared-review-host.mjs'),baseline.hostHelperSha256);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(fileHash(binding.runtimePath+'/'+p),h);
for(const[p,h]of Object.entries(binding.dependencyHashes))assert.equal(fileHash(p),h);
const directory=fs.mkdtempSync(path.resolve('data/audit-runtimes/design76-shared-rehearsal-')),database=path.join(directory,'private.db');
fs.copyFileSync(preflight.databaseSnapshotPath,database,fs.constants.COPYFILE_EXCL);
const {PrismaWorkRepository}=await import(binding.runtimePath+'/packages/persistence/src/prisma-repository.ts');
const {createApiServer}=await import(binding.runtimePath+'/apps/api/src/server.ts');
const client=new PrismaClient({datasources:{db:{url:'file:'+database}}}),repository=new PrismaWorkRepository(client);
const digests=work=>Object.fromEntries(Object.keys(work).sort().map(k=>[k,hash(work[k] instanceof Map?[...work[k]].map(([id,v])=>[id,hash(v)]):work[k])]));
let before,host;const requests=[];
const output='docs/audits/2026-10-18-design76-shared-review-rehearsal.json';assert.ok(!fs.existsSync(output));
try{
  let work=await repository.get(baseline.workId);assert.ok(work);before=digests(work);work=undefined;
  host=await startSharedReviewHost({createApiServer,repository,port:0,status:()=>({status:'rehearsal'}),onResponse:r=>requests.push(r)});
  const origin='http://127.0.0.1:'+host.app.server.address().port;
  const held=Promise.withResolvers(),release=Promise.withResolvers();
  const writing=repository.transaction(baseline.workId,async()=>{held.resolve();await release.promise;});
  await held.promise;
  const reads=Promise.allSettled(['/design','/design/history','/quality-audit','/design/content-reviews?view=summary'].map(async suffix=>{
    const response=await fetch(origin+'/works/'+baseline.workId+suffix);assert.equal(response.status,200,suffix);
    const body=await response.json();return{suffix,bodySha256:hash(body)};
  }));
  assert.equal((await fetch(origin+'/health')).status,200);
  await new Promise(r=>setTimeout(r,6500));release.resolve();await writing;
  const results=await reads;for(const result of results)assert.equal(result.status,'fulfilled',JSON.stringify(result));
  await host.close();host=undefined;
  let after=await repository.get(baseline.workId);assert.deepEqual(digests(after),before);
  const counts={runs:after.designReviewRuns.size,reports:after.designContentReviews.size,annotations:after.designReviewAnnotations.size};after=undefined;
  fs.writeFileSync(output,JSON.stringify({kind:'design76_full_history_shared_review_rehearsal',verified:true,createdAt:new Date().toISOString(),
    directory,database,preflightSha256:fileHash(preflightPath),hostHelperSha256:baseline.hostHelperSha256,runnerSha256:baseline.runnerSha256,
    scriptSha256:fileHash(import.meta.filename),runtimeBindingSha256:preflight.runtimeBindingSha256,requests,results,counts,
    allWorkFieldsUnchanged:true,workFieldDigests:before,modelCalls:0,productionWrites:0,formalAcceptance:false,maxRssKiB:process.resourceUsage().maxRSS},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({verified:true,requests:requests.length,counts,productionWrites:0,maxRssKiB:process.resourceUsage().maxRSS}));
}finally{await host?.close();await repository.disconnect();}
