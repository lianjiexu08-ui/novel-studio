import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server.ts';
import { InMemoryWorkRepository } from '../../../packages/application/src/index.ts';

function createPayload(title: string) {
  return {
    title,
    covenant: {
      audience: '喜欢阶段突破很清楚的读者',
      hook: '主角用寿命换一次胜利',
    },
  };
}

test('local API runs create -> generate -> check -> adopt -> outbox', async () => {
  const { app } = createApiServer({ repository: new InMemoryWorkRepository() });
  try {
    assert.deepEqual((await app.inject({ method: 'GET', url: '/health' })).json(), { ok: true });

    const created = await app.inject({ method: 'POST', url: '/works', payload: createPayload('API 玄幻试作') });
    assert.equal(created.statusCode, 201);
    const work = created.json();
    assert.ok(work.id);
    assert.equal(work.covenant.hook, '主角用寿命换一次胜利');
    assert.equal(work.covenant.genre, 'xuanhuan');

    const patched = await app.inject({
      method: 'PATCH', url: `/works/${work.id}`,
      payload: { title: work.title, covenant: { ...work.covenant, avoid: '不要后宫' } },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal(patched.json().stateRevision, 0);
    assert.equal(patched.json().covenant.avoid, '不要后宫');

    const generated = await app.inject({ method: 'POST', url: `/works/${work.id}/chapters/1/generate`, payload: { runId: 'api-run-1' } });
    assert.equal(generated.statusCode, 201);
    const candidate = generated.json().candidate;
    assert.equal(candidate.status, 'candidate');
    assert.match(candidate.content, /第1章/);
    assert.ok(candidate.proposedEvents.length > 0);

    const checked = await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidate.id}/check` });
    assert.equal(checked.statusCode, 200);
    assert.equal(checked.json().candidate.checks[0].status, 'passed');

    const adopted = await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidate.id}/adopt`, payload: { expectedStateRevision: 0 } });
    assert.equal(adopted.statusCode, 200);
    assert.equal(adopted.json().outbox.length, 3);

    const outbox = await app.inject({ method: 'GET', url: `/works/${work.id}/outbox` });
    assert.equal(outbox.json().events.length, 3);
  } finally {
    await app.close();
  }
});

test('local API rejects adoption when the state revision is stale', async () => {
  const { app } = createApiServer({ repository: new InMemoryWorkRepository() });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('版本检查') })).json();
    const candidate = (await app.inject({ method: 'POST', url: `/works/${work.id}/chapters/1/generate`, payload: {} })).json().candidate;
    await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidate.id}/check` });
    const result = await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidate.id}/adopt`, payload: { expectedStateRevision: 99 } });
    assert.equal(result.statusCode, 409);
    assert.equal(result.json().error.code, 'STALE_CANDIDATE');
  } finally {
    await app.close();
  }
});

test('local API maps invalid payloads to VALIDATION_FAILED and unknown works to NOT_FOUND', async () => {
  const { app } = createApiServer({ repository: new InMemoryWorkRepository() });
  try {
    const invalid = await app.inject({ method: 'POST', url: '/works', payload: { title: '  ' } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, 'VALIDATION_FAILED');

    const missingCovenant = await app.inject({ method: 'POST', url: '/works', payload: { title: '只有书名' } });
    assert.equal(missingCovenant.statusCode, 400);
    assert.equal(missingCovenant.json().error.code, 'VALIDATION_FAILED');

    const missing = await app.inject({ method: 'GET', url: '/works/work_missing' });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, 'NOT_FOUND');
  } finally {
    await app.close();
  }
});

test('settings API keeps characters, locked relationships and plot nodes under author control', async () => {
  const { app } = createApiServer({ repository: new InMemoryWorkRepository() });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('设定') })).json();
    const base = `/works/${work.id}`;
    const master = (await app.inject({ method: 'POST', url: `${base}/characters`, payload: { name: '玄机子', role: 'major' } })).json();
    const hero = (await app.inject({ method: 'POST', url: `${base}/characters`, payload: { name: '林渊', aliases: ['渊哥'], role: 'protagonist' } })).json();
    assert.equal(hero.role, 'protagonist');

    const clash = await app.inject({ method: 'POST', url: `${base}/characters`, payload: { name: '渊哥' } });
    assert.equal(clash.statusCode, 409);
    assert.equal(clash.json().error.code, 'CONFLICT');

    const bond = (await app.inject({
      method: 'POST', url: `${base}/relationships`,
      payload: { fromCharacterId: master.id, toCharacterId: hero.id, kind: '师徒', value: '亲传' },
    })).json();
    assert.equal(bond.layer, 'objective');
    await app.inject({ method: 'PATCH', url: `${base}/relationships/${bond.id}`, payload: { locked: true } });
    const blocked = await app.inject({ method: 'PATCH', url: `${base}/relationships/${bond.id}`, payload: { value: '反目' } });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().error.code, 'LOCKED_CONSTRAINT');

    const inUse = await app.inject({ method: 'DELETE', url: `${base}/characters/${hero.id}` });
    assert.equal(inUse.json().error.code, 'CONFLICT');

    await app.inject({ method: 'POST', url: `${base}/world-rules`, payload: { category: 'power', title: '境界', content: '炼气、筑基' } });
    const node = (await app.inject({ method: 'POST', url: `${base}/plot-nodes`, payload: { level: 'volume', title: '三年之约', targetChapter: 30 } })).json();
    assert.equal(node.realization.status, 'unrealized');

    const bible = (await app.inject({ method: 'GET', url: `${base}/bible` })).json();
    assert.equal(bible.characters.length, 2);
    assert.equal(bible.relationships[0].locked, true);
    assert.equal(bible.worldRules.length, 1);
    assert.equal(bible.plotNodes.length, 1);
    assert.equal((await app.inject({ method: 'GET', url: base })).json().stateRevision, 0);

    const missing = await app.inject({ method: 'PATCH', url: `${base}/characters/character_missing`, payload: { goal: 'x' } });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('local API enforces bearer auth when a token is configured', async () => {
  const { app } = createApiServer({ repository: new InMemoryWorkRepository(), authToken: 'secret' });
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
    const denied = await app.inject({ method: 'POST', url: '/works', payload: { title: '鉴权' } });
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.json().error.code, 'UNAUTHORIZED');
    const allowed = await app.inject({
      method: 'POST', url: '/works', payload: createPayload('鉴权'),
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(allowed.statusCode, 201);
  } finally {
    await app.close();
  }
});
