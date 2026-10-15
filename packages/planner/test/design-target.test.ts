import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonDesignPlanner, PlanningParseError } from '../src/index.ts';
import { minimalStoryBible, minimalWorldPack, readyCovenant } from '../../application/test/fixtures.ts';
import { ChapterWorkflow, InMemoryWorkRepository } from '../../application/src/index.ts';

const world = minimalWorldPack();

function blueprint(chapters: number) {
  const bible = minimalStoryBible(world);
  let start = 1;
  bible.arcBeats = [];
  bible.volumes = Array.from({ length: 3 }, (_, index) => {
    const count = Math.floor(chapters / 3) + (index < chapters % 3 ? 1 : 0);
    for (let beat = 0; beat < 3; beat++) bible.arcBeats!.push({
      id: `beat-${index}-${beat}`, arcId: 'arc', characterId: 'hero', kind: 'choice',
      plannedChapter: start + beat, expectedChange: '选择守城，承担失去差使的代价',
    });
    start += count;
    return { ...bible.volumes[0], id: `vol-${index + 1}`, order: index + 1, plannedChapterCount: count };
  });
  bible.secrets = [{ id: 'secret', ownerCharacterId: 'rival', title: '失踪原因', truth: '受命调查', revealCondition: '取得回信', status: 'proposed' }];
  bible.promises = [{ id: 'promise', title: '守城之约', promise: '保住同门', payoffCondition: '掩护撤退', status: 'proposed' }];
  bible.openThreads = [{ id: 'thread', title: '城门内应', kind: 'mystery', question: '谁开了城门', plannedResolution: '对照签押证词', status: 'proposed' }];
  return bible;
}

test('story design follows the saved author chapter target through the workflow', async () => {
  const calls: Array<{ chapterTarget: number; outputBudget: number }> = [];
  const planner = new JsonDesignPlanner({ complete: async request => {
    calls.push({ chapterTarget: JSON.parse(request.user).chapterTarget, outputBudget: request.maxOutputTokens });
    return JSON.stringify(blueprint(450));
  } });
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, { generateChapter: () => { throw new Error('must not write prose'); } }, planner);
  const work = await workflow.createWork('目标章数传递', { ...readyCovenant(), targetChapterCount: 450 });
  await workflow.saveWorldPack(work.id, world);
  const generated = await workflow.generateStoryBible(work.id);
  assert.deepEqual(calls, [{ chapterTarget: 450, outputBudget: 32_000 }]);
  assert.equal(generated.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0), 450);
  const saved = (await repository.get(work.id))!;
  assert.deepEqual(saved.storyBible, generated);
  assert.equal(saved.storyBible!.status, 'proposed');
  assert.equal(saved.versions.size, 0);
});

test('an explicit trial target overrides the full-book covenant without changing it', async () => {
  const covenant = { ...readyCovenant(), targetChapterCount: 450 };
  const planner = new JsonDesignPlanner({ complete: async request => {
    assert.equal(JSON.parse(request.user).chapterTarget, 100);
    assert.equal(request.maxOutputTokens, 12_000);
    return JSON.stringify(blueprint(100));
  } });
  const generated = await planner.generateStoryBible({ title: '百章试运行', covenant, worldPack: world, chapterTarget: 100 });
  assert.equal(generated.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0), 100);
  assert.equal(covenant.targetChapterCount, 450);
});

test('the configured default still applies when neither caller nor author specifies a target', async () => {
  const { targetChapterCount: _target, ...covenant } = readyCovenant();
  const planner = new JsonDesignPlanner({ complete: async request => {
    assert.equal(JSON.parse(request.user).chapterTarget, 150);
    return JSON.stringify(blueprint(150));
  } }, 150);
  const generated = await planner.generateStoryBible({ title: '默认规模', covenant, worldPack: world });
  assert.equal(generated.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0), 150);
});

test('a shorter model response cannot silently replace an author-requested long-book design', async () => {
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async () => {
    calls++;
    return JSON.stringify(blueprint(100));
  } });
  await assert.rejects(() => planner.generateStoryBible({ title: '不可缩水', covenant: { ...readyCovenant(), targetChapterCount: 450 }, worldPack: world }),
    error => error instanceof PlanningParseError && /exactly 450 chapters/.test(error.message));
  assert.equal(calls, 2, 'one repair attempt is allowed, but a repeated wrong total must fail');
});
