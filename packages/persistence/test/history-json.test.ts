import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {historyJsonChunks,historyJsonHash,writeProjectHistory} from '../src/project-history.ts';
import type {Prisma} from '@prisma/client';

test('bounded history serialization preserves Unicode, escaping, ordering and omitted fields byte for byte', () => {
  const records = [{id:'a',text:'甲😀乙𠮷\n"\\',optional:undefined,nested:[null,'\ud800']}, {id:'b',values:[1,0.25,false,undefined]}, null];
  const expected=JSON.stringify(records);
  for(let limit=2;limit<=31;limit++){
    const chunks=[...historyJsonChunks(records,limit)];
    assert.ok(chunks.every(c=>c.length>0&&c.length<=limit));
    assert.equal(Buffer.concat(chunks.map(c=>Buffer.from(c))).toString(),expected);
    assert.deepEqual(JSON.parse(chunks.join('')),JSON.parse(expected));
  }
  assert.equal(historyJsonHash(records),createHash('sha256').update(expected).digest('hex'));
  assert.deepEqual([...historyJsonChunks([])],['[]']);
});

test('history serialization rejects invalid chunk bounds and propagates serialization failures', () => {
  for(const limit of [0,1,1.5,Infinity]) assert.throws(()=>[...historyJsonChunks([],limit)]);
  const cycle: {self?: unknown}={};cycle.self=cycle;
  assert.throws(()=>[...historyJsonChunks([{id:'before'},cycle],2)],/circular/i);
});

test('history writes never send an accumulated array as one database parameter', async () => {
  const values=[{id:'large',text:'甲😀'.repeat(3*1024*1024)}];
  const chunks:string[]=[];
  const tx={$executeRaw:async (statement:Prisma.Sql)=>{
    const chunk=statement.values[0];assert.equal(typeof chunk,'string');
    assert.ok((chunk as string).length<=8*1024*1024);chunks.push(chunk as string);return 1;
  }} as unknown as Parameters<typeof writeProjectHistory>[0];
  await writeProjectHistory(tx,'work','designReviewRuns',values);
  assert.ok(chunks.length>1);
  assert.equal(Buffer.concat(chunks.map(c=>Buffer.from(c))).toString(),JSON.stringify(values));
});
