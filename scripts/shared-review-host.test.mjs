import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {PrismaWorkRepository} from '../packages/persistence/src/prisma-repository.ts';
import {ChapterWorkflow} from '../packages/application/src/index.ts';
import {createReadyWork,fixtureDesignReview} from '../packages/application/test/fixtures.ts';
import {createApiServer} from '../apps/api/src/server.ts';
import {startSharedReviewHost} from './shared-review-host.mjs';

test('UI reads during model wait and long saves share review transactions without duplicate model calls',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'novel-shared-review-')),url='file:'+join(dir,'test.db');
  writeFileSync(join(dir,'test.db'),'');
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate','--schema','packages/persistence/prisma/schema.prisma'],{env:{...process.env,DATABASE_URL:url},stdio:'pipe'});
  const client=new PrismaClient({datasources:{db:{url}}}),repo=new PrismaWorkRepository(client);
  let host;
  t.after(async()=>{await host?.close();await repo.disconnect();rmSync(dir,{recursive:true,force:true});});
  const modelEntered=Promise.withResolvers(),modelRelease=Promise.withResolvers();let modelCalls=0;
  const workflow=new ChapterWorkflow(repo,{generateChapter:()=>{throw Error('No prose in this test');}},
    {generateWorldPack:async()=>{throw Error('unused');},generateStoryBible:async()=>{throw Error('unused');},
      reviewDesignContent:async input=>{modelCalls++;modelEntered.resolve();await modelRelease.promise;return fixtureDesignReview(input);}});
  const work=await createReadyWork(workflow,'共享评审'),run=await workflow.startDesignReview(work.id,'world');
  const events=[];
  host=await startSharedReviewHost({createApiServer,repository:repo,port:0,status:()=>({status:'running',workId:work.id}),onResponse:e=>events.push(e)});
  const origin='http://127.0.0.1:'+host.app.server.address().port;
  const get=async path=>{const r=await fetch(origin+path);assert.equal(r.status,200,path);return r.json();};
  const originalTx=client.$transaction.bind(client);let active=0,maximum=0;
  client.$transaction=async(...args)=>{maximum=Math.max(maximum,++active);try{return await originalTx(...args);}finally{active--;}};
  const commitEntered=Promise.withResolvers(),commitRelease=Promise.withResolvers();
  const transaction=repo.transaction.bind(repo);
  repo.transaction=(id,cb)=>transaction(id,async ctx=>{
    const result=await cb(ctx);
    if(ctx.work.designReviewRuns.get(run.id)?.stages[0].result){commitEntered.resolve();await commitRelease.promise;}
    return result;
  });
  const stepping=workflow.stepDesignReview(work.id,run.id);
  await modelEntered.promise;
  const pending=await get(`/works/${work.id}/design/content-reviews?view=summary`);
  assert.equal(modelCalls,1);assert.ok(JSON.stringify(pending).includes(run.id));
  for(const [method,route] of [['POST',`/works/${work.id}/design/review-runs/${run.id}/step`],['POST',`/works/${work.id}/design/generate`],['POST',`/works/${work.id}/chapters/1/generate`],['PUT',`/works/${work.id}/design/candidate`]]){
    const reply=await fetch(origin+route,{method,headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(reply.status,409);assert.equal((await reply.json()).error.code,'REVIEW_SESSION_ACTIVE');
  }
  assert.equal((await get('/design-review-session')).readOnly,true);
  modelRelease.resolve();await commitEntered.promise;
  // Reproduce a save longer than SQLite's acquisition wait while the page reads.
  const readers=Promise.allSettled(['/design','/design/history','/quality-audit','/design/content-reviews?view=summary'].map(s=>get(`/works/${work.id}${s}`)));
  assert.deepEqual(await get('/health'),{ok:true});
  await new Promise(r=>setTimeout(r,6000));commitRelease.resolve();
  await stepping;for(const result of await readers)assert.equal(result.status,'fulfilled',JSON.stringify(result));
  assert.equal(maximum,1);assert.equal(modelCalls,1);
  const restored=await repo.get(work.id);assert.ok(restored.designReviewRuns.get(run.id).stages[0].result);
  assert.equal(restored.title,work.title);assert.equal(restored.versions.size,0);
  assert.ok(events.every(e=>e.statusCode===200||e.statusCode===409));
});
