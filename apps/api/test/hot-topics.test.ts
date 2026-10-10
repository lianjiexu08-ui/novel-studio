import test from 'node:test';
import assert from 'node:assert/strict';
import { collectHotTopics, extractNovelThemes, parseDuckDuckGo } from '../src/hot-topics.ts';
import { createApiServer } from '../src/server.ts';
import { InMemoryWorkRepository } from '../../../packages/application/src/index.ts';

const html = `
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">2026 网文热门题材</a>
<a class="result__snippet" href="https://example.com/a">番茄和起点都在谈【规则怪谈】，新年代文也在升温。还在写废柴退婚就过时了。</a>
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb">男频赛道</a>
<a class="result__snippet" href="https://example.com/b">另一篇网文讨论再次提到规则怪谈，发疯文学是另一条赛道。</a>
<a class="result__a" href="https://example.com/skip">今日天气</a>
<a class="result__snippet">这是天气预报，不是小说。</a>
`;

test('discussion parser keeps novel pages and drops unrelated results', () => {
  const hits = parseDuckDuckGo(html);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.url, 'https://example.com/a');
  assert.match(hits[0]?.summary ?? '', /规则怪谈/);
});

test('theme extraction ranks novel themes and skips a trend the page calls outdated', () => {
  const topics = extractNovelThemes(parseDuckDuckGo(html));
  assert.equal(topics[0]?.title, '规则怪谈');
  assert.equal(topics[0]?.heat, '2 处提及');
  assert.ok(topics.some((topic) => topic.title === '新年代文'));
  assert.ok(topics.some((topic) => topic.title === '发疯文学'));
  assert.equal(topics.some((topic) => topic.title.includes('退婚')), false);
});

test('a keyword search still returns novel themes from the discussion page', async () => {
  const fetchImpl: typeof fetch = async () => new Response(html, { status: 200 });
  const result = await collectHotTopics('规则怪谈', fetchImpl);
  assert.equal(result.topics[0]?.title, '规则怪谈');
  assert.deepEqual(result.sources, ['网文题材讨论']);
  assert.equal(result.failures.length, 0);
});

test('a design model timeout is reported as MODEL_TIMEOUT, not an internal error', async () => {
  const { ModelTimeoutError } = await import('../../../packages/model-gateway/src/index.ts');
  const { ChapterWorkflow } = await import('../../../packages/application/src/index.ts');
  const repository = new InMemoryWorkRepository();
  const work = await new ChapterWorkflow(repository, { generateChapter: () => ({ content: '', proposedEvents: [] }) }).createWork('超时', {
    entryMode: 'expand', genre: 'xuanhuan', substyle: '玄幻·家族流', audience: '读者', hook: '钩子', mustKeep: '', lockedNotes: '', avoid: '',
    targetLength: '长篇', chapterWords: 2200, updateCadence: '日更', protagonistGoal: '', obstacle: '', readingExperience: '',
  });
  const { app } = createApiServer({
    repository,
    designProvider: {
      generateWorldPack: async () => { throw new ModelTimeoutError('model produced no output for 60000ms'); },
      generateStoryBible: async () => { throw new Error('unused'); },
    } as never,
  });
  try {
    const response = await app.inject({ method: 'POST', url: `/works/${work.id}/design/generate`, payload: { stage: 'world_pack' } });
    assert.equal(response.statusCode, 504, response.body);
    assert.equal(response.json().error.code, 'MODEL_TIMEOUT');
    assert.match(response.json().error.message, /60 秒/);
  } finally {
    await app.close();
  }
});

test('GET /topics/hot returns the injected list and rejects an overlong query', async () => {
  const { app } = createApiServer({
    repository: new InMemoryWorkRepository(),
    topicSearch: async (query) => ({ query, topics: [{ id: 'topic-1', title: '规则怪谈', summary: '摘要', source: '测试' }], sources: ['测试'], failures: [], fetchedAt: '2026-10-10T00:00:00.000Z' }),
  });
  try {
    const listed = await app.inject({ method: 'GET', url: '/topics/hot?q=玄幻' });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().topics[0].title, '规则怪谈');
    assert.equal(listed.json().query, '玄幻');
    const rejected = await app.inject({ method: 'GET', url: `/topics/hot?q=${'x'.repeat(81)}` });
    assert.equal(rejected.statusCode, 400);
  } finally {
    await app.close();
  }
});
