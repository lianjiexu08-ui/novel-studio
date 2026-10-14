import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import { once } from 'node:events';
import { channel } from 'node:diagnostics_channel';
import { setTimeout as delay } from 'node:timers/promises';
import { ModelTimeoutError, OpenAICompatibleAdapter } from '../src/index.ts';

const request = { role: 'reviewing' as const, model: 'test-model', system: 'test', user: 'test' };

async function localModel(handler: RequestListener) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  return { endpoint, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}

test('native fetch delegates header and body timeouts to the configured model idle timer', async () => {
  const server = await localModel((_req, res) => {
    const timer = setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'reviewed' } }] })); }, 40);
    res.once('close', () => clearTimeout(timer));
  });
  const transport: Array<{ headersTimeout: number; bodyTimeout: number }> = [];
  const requests = channel('undici:request:create');
  const listener = (message: unknown) => {
    const { request: actual } = message as { request: { origin: string; headersTimeout: number; bodyTimeout: number } };
    if (String(actual.origin) === server.endpoint) transport.push({ headersTimeout: actual.headersTimeout, bodyTimeout: actual.bodyTimeout });
  };
  requests.subscribe(listener);
  try {
    const result = await new OpenAICompatibleAdapter(fetch, 600_000).complete(request, { endpoint: server.endpoint, apiKey: 'test-key' });
    assert.equal(result.text, 'reviewed');
    // Observe the actual native request, not just constructor options. Fetch
    // can otherwise overwrite Agent defaults with its own five-minute limit.
    assert.deepEqual(transport, [{ headersTimeout: 0, bodyTimeout: 0 }]);
  } finally { requests.unsubscribe(listener); await server.close(); }
});

test('native fetch still aborts a silent provider at the configured idle limit', async () => {
  let received = 0;
  const server = await localModel(() => { received++; });
  try {
    await assert.rejects(() => new OpenAICompatibleAdapter(fetch, 100).complete(request, { endpoint: server.endpoint, apiKey: 'test-key' }), ModelTimeoutError);
    assert.equal(received, 1, 'the request is neither silently retried nor sent to a fallback');
  } finally { await server.close(); }
});

test('native streaming can outlast the idle limit while data keeps arriving', async () => {
  const server = await localModel(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders();
    for (let i = 0; i < 9; i++) {
      await delay(40);
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: String(i) } }] })}\n\n`);
    }
    res.end('data: [DONE]\n\n');
  });
  try {
    const started = Date.now();
    const result = await new OpenAICompatibleAdapter(fetch, 180).complete(request, { endpoint: server.endpoint, apiKey: 'test-key' });
    assert.equal(result.text, '012345678');
    assert.ok(Date.now() - started > 180);
  } finally { await server.close(); }
});
