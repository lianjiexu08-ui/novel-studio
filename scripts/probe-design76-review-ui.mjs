// Read-only UI acceptance against the private annotation rehearsal database.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
process.env.API_CORS_ORIGIN='http://127.0.0.1:5182';
const read=p=>JSON.parse(fs.readFileSync(p));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const binding=read('data/audit-runtimes/design76-ui-runtime-v2-bound.json');
const rehearsal=read('docs/audits/2026-10-18-design76-review-annotation-rehearsal.json');
assert.equal(rehearsal.verified,true);assert.equal(rehearsal.productionWrites,0);
assert.ok(rehearsal.database.includes('/design76-note-rehearsal-'));
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(hash(`${binding.runtimePath}/${p}`),h);
for(const[p,h]of Object.entries(binding.dependencyHashes))assert.equal(hash(p),h);
const {PrismaWorkRepository}=await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const {createApiServer}=await import(`${binding.runtimePath}/apps/api/src/server.ts`);
const prisma=new PrismaClient({datasources:{db:{url:'file:'+rehearsal.database}}});
const repository=new PrismaWorkRepository(prisma);
const unavailable=()=>{throw Error('UI verification cannot call a model');};
const {app}=createApiServer({repository,authToken:'',provider:{generateChapter:unavailable},
  designProvider:{generateWorld:unavailable,generateBible:unavailable},planProvider:{generatePlan:unavailable,generateOutlines:unavailable},
  manageModelSettings:false,writeProcessEnvironment:false,allowBatchRuns:false});
const requests=[];
app.addHook('onError',async(request,_reply,error)=>{console.error(JSON.stringify({url:request.url,name:error.name,message:error.message.slice(0,2000)}));});
app.addHook('onRequest',async(request,reply)=>{
  if(!['GET','HEAD','OPTIONS'].includes(request.method))return reply.code(405).send({error:{code:'READ_ONLY',message:'UI acceptance is read-only'}});
});
app.addHook('onResponse',async(request,reply)=>{requests.push({method:request.method,url:request.url,statusCode:reply.statusCode});});
app.get('/__probe',async()=>({readOnly:true,database:rehearsal.database,annotationId:rehearsal.note.id,requests}));
await app.listen({port:18787,host:'127.0.0.1'});
console.log(JSON.stringify({ready:true,pid:process.pid,port:18787,database:rehearsal.database,annotationId:rehearsal.note.id,readOnly:true}));
process.once('SIGTERM',async()=>{await app.close();await repository.disconnect();await prisma.$disconnect();process.exit(0);});
