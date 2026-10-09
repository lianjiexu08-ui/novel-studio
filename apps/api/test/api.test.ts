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

test('design API saves and locks the world pack before the story bible', async () => {
  const { app } = createApiServer({ repository: new InMemoryWorkRepository() });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('世界包门禁') })).json();
    const base = `/works/${work.id}`;
    const worldPack = {
      id: 'world_api', revision: 1, title: '九霄界', summary: '三界玄幻', status: 'reviewed',
      axioms: [{ id: 'axiom', title: '因果有价', content: '力量必须支付代价', scope: 'all', precedence: 1, status: 'reviewed' }], powerSystems: [{ id: 'system', name: '灵力', source: '天地', unit: '灵气', realmIds: ['realm'], status: 'reviewed' }],
      realms: [{ id: 'realm', systemId: 'system', name: '炼气', rank: 1, prerequisites: [], capabilities: ['引气'], cost: '时间', counters: [], status: 'reviewed' }],
      techniques: [{ id: 'technique', name: '引气诀', kind: 'cultivation', allowedRealmIds: ['realm'], effect: '引气', cost: '时间', limitations: [], counters: [], status: 'reviewed' }], artifacts: [{ id: 'artifact', name: '青云剑', tier: '一阶', effect: '增幅', cost: '灵石', limitations: [], status: 'reviewed' }], resources: [{ id: 'resource', name: '灵石', unit: '枚', source: '矿脉', scarcity: '常见', status: 'reviewed' }], locations: [{ id: 'home', name: '青州', kind: 'continent', entryConditions: [], status: 'reviewed' }],
      factions: [{ id: 'sect', name: '青云宗', kind: 'sect', locationIds: ['home'], goals: ['守护青州'], resources: [], status: 'reviewed' }],
      historicalEvents: [{ id: 'history', title: '立宗', storyTime: '百年前', causes: ['动荡'], consequences: ['建宗'], factionIds: ['sect'], status: 'reviewed' }], terminology: [{ id: 'term', canonical: '灵气', aliases: [], kind: 'other', status: 'reviewed' }], unresolvedQuestions: [], createdAt: new Date().toISOString(),
    };
    assert.equal((await app.inject({ method: 'PUT', url: `${base}/world-pack`, payload: worldPack })).statusCode, 200);
    const lockedWorld = (await app.inject({ method: 'POST', url: `${base}/world-pack/lock`, payload: {} })).json().worldPack;
    assert.equal(lockedWorld.status, 'locked');
    const storyBible = {
      id: 'bible_api', revision: 1, worldPackId: lockedWorld.id, worldPackRevision: lockedWorld.revision, status: 'reviewed',
      coreConflict: '宗门存亡', endingDirection: '守住家园',
      characters: [{ id: 'hero', name: '林渊', role: 'protagonist', goal: '守护青州', identity: '弟子', locationId: 'home', factionId: 'sect', startingRealmId: 'realm' }, { id: 'rival', name: '苏晚', role: 'major', goal: '查明真相', identity: '弟子', locationId: 'home', factionId: 'sect', startingRealmId: 'realm' }],
      relationships: [{ id: 'rel', fromCharacterId: 'hero', toCharacterId: 'rival', kind: 'trust', value: '同门', locked: false }], arcs: [{ id: 'arc', title: '守城', characterIds: ['hero'], goal: '成长', stakes: '宗门存亡', plannedOutcome: '守住宗门' }], volumes: [{ id: 'v1', order: 1, title: '入门', goal: '成长', climax: '守城', endState: '入筑基', plannedChapterCount: 10, arcIds: ['arc'] }],
      unresolvedQuestions: [], createdAt: new Date().toISOString(),
    };
    assert.equal((await app.inject({ method: 'PUT', url: `${base}/story-bible`, payload: storyBible })).statusCode, 200);
    const lockedBible = (await app.inject({ method: 'POST', url: `${base}/story-bible/lock`, payload: {} })).json().storyBible;
    assert.equal(lockedBible.status, 'locked');
    let stateRevision = 0;
    for (let chapterNumber = 1; chapterNumber <= 10; chapterNumber += 1) {
      const candidate = (await app.inject({ method: 'POST', url: `${base}/chapters/${chapterNumber}/generate`, payload: { runId: 'manuscript-run' } })).json().candidate;
      await app.inject({ method: 'POST', url: `${base}/candidates/${candidate.id}/check` });
      const adopted = await app.inject({ method: 'POST', url: `${base}/candidates/${candidate.id}/adopt`, payload: { expectedStateRevision: stateRevision } });
      assert.equal(adopted.statusCode, 200);
      stateRevision += 1;
    }
    const finalized = await app.inject({ method: 'POST', url: `${base}/manuscripts/finalize`, payload: {} });
    assert.equal(finalized.statusCode, 200);
    assert.equal(finalized.json().manuscript.chapterCount, 10);
    assert.equal(finalized.json().manuscript.status, 'final');
    assert.equal(finalized.json().manuscript.contentHash.length, 64);
    const exported = await app.inject({ method: 'GET', url: `${base}/manuscripts/${finalized.json().manuscript.id}/export` });
    assert.equal(exported.statusCode, 200);
    assert.equal(exported.json().chapters.length, 10);
    assert.equal(exported.json().chapters[0].chapterNumber, 1);
    const design = (await app.inject({ method: 'GET', url: `${base}/design` })).json();
    assert.equal(design.worldPack.status, 'locked');
    assert.equal(design.storyBible.status, 'locked');
    assert.ok(design.constraintRevision >= 4);
    assert.equal((await app.inject({ method: 'GET', url: `${base}/manuscripts` })).json().manuscripts.length, 1);
  } finally {
    await app.close();
  }
});
