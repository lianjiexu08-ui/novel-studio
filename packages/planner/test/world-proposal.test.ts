import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonDesignPlanner, PlanningParseError } from '../src/index.ts';
import { ChapterWorkflow, InMemoryWorkRepository } from '../../application/src/index.ts';
import { minimalStoryBible, minimalWorldPack, readyCovenant } from '../../application/test/fixtures.ts';
import { chapterGenerationGate, lockWorldPack, validateWorldPack } from '../../../novel-service-core/src/world.ts';

function worldProposal() {
  const world = minimalWorldPack();
  world.status = 'proposed';
  const expand = <T extends { id: string; name?: string }>(item: T, count: number): T[] => Array.from({ length: count }, (_, i) => ({
    ...structuredClone(item), id: i ? `${item.id}-${i}` : item.id,
    ...(item.name ? { name: i ? `${item.name}${i}` : item.name } : {}),
  }));
  world.realms = expand(world.realms[0], 8).map((realm, i) => ({ ...realm, rank: i + 1 }));
  world.powerSystems[0].realmIds = world.realms.map(realm => realm.id);
  world.techniques = expand({ ...world.techniques[0], tier: '一阶' }, 15);
  world.artifacts = expand(world.artifacts[0], 12);
  world.resources = expand({ ...world.resources[0], tier: '一阶' }, 10);
  world.locations = expand(world.locations[0], 9);
  world.factions = expand(world.factions[0], 6);
  world.historicalEvents = expand(world.historicalEvents[0], 10);
  world.tierLadders = (['realm', 'technique', 'artifact', 'resource'] as const).map(kind => ({
    id: `${kind}-ladder`, kind, name: `${kind}等级`, levels: ['一阶', '二阶', '三阶', '四阶', '五阶', '六阶'],
    rule: '逐阶支付代价', status: 'proposed',
  }));
  world.unresolvedQuestions = [
    { id: 'cold-supply', question: '低境北航防寒的供能和支付尚待核实', blocking: true, status: 'open' },
    { id: 'realm-cost', question: '后续突破的寿储来源待复核', blocking: true, status: 'deferred' },
  ];
  assert.equal(validateWorldPack(world).ready, true);
  return world;
}

for (const mode of ['complete', 'staged'] as const) {
  test(`${mode} world generation saves unresolved questions as a proposal without granting review or writing authority`, async () => {
    const world = worldProposal();
    const { techniques, artifacts, resources, locations, factions, historicalEvents, unresolvedQuestions, ...skeleton } = world;
    const responses = mode === 'complete' ? [world] : [
      { ...skeleton, unresolvedQuestions: [unresolvedQuestions[0]] },
      { locations, factions, unresolvedQuestions: [] },
      { techniques, artifacts, resources, unresolvedQuestions: [unresolvedQuestions[1]] },
      { historicalEvents, unresolvedQuestions: [] },
    ];
    let calls = 0;
    const planner = new JsonDesignPlanner({ complete: async () => {
      assert.ok(calls < responses.length, 'a pending design question must not trigger a repair call');
      return JSON.stringify(responses[calls++]);
    } });
    const repository = new InMemoryWorkRepository();
    const workflow = new ChapterWorkflow(repository, { generateChapter: () => { throw new Error('must not write prose'); } }, planner);
    const work = await workflow.createWork('待复核的世界', readyCovenant({ targetChapterCount: 100 }));
    const generated = await workflow.generateWorldPack(work.id);
    assert.equal(calls, responses.length);
    assert.equal(generated.status, 'proposed');
    assert.deepEqual(generated.unresolvedQuestions, unresolvedQuestions);
    await assert.rejects(() => workflow.reviewWorldPack(work.id), /blocking world pack questions/);
    assert.throws(() => lockWorldPack({ ...generated, status: 'reviewed' }), /blocking world pack questions/);
    const gate = chapterGenerationGate({ ...generated, status: 'locked' }, { ...minimalStoryBible(generated), status: 'locked' });
    assert.equal(gate.ready, false);
    assert.ok(gate.errors.includes('blocking world pack questions must be resolved before writing'));
    const saved = (await repository.get(work.id))!;
    assert.deepEqual(saved.worldPack, generated);
    assert.equal(saved.versions.size, 0);
    assert.ok([...saved.designHistory.values()].some(revision => revision.kind === 'world_pack' && revision.snapshot.status === 'proposed'));
  });
}

test('allowing pending world questions does not admit incomplete scale or broken references', async () => {
  const thin = worldProposal();
  thin.techniques = thin.techniques.slice(0, 1);
  const broken = worldProposal();
  broken.techniques[0].allowedRealmIds = ['missing-realm'];
  for (const [world, expected] of [[thin, /techniques>=15/], [broken, /unknown realm/]] as const) {
    const planner = new JsonDesignPlanner({ complete: async () => JSON.stringify(world) });
    await assert.rejects(() => planner.generateWorldPack({ title: '无效草案', covenant: readyCovenant({ targetChapterCount: 100 }) }),
      error => error instanceof PlanningParseError && expected.test(error.message));
  }
});
