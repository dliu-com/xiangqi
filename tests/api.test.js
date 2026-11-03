import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const logged = [];
const context_console = { error: (...args) => logged.push(args) };
// Execute the exact inline code deployed by CDK against a conditional-write store.
function createApi({ failWith } = {}) {
  let item = null;
  class GetItemCommand { constructor(input) { this.input = input; } }
  class PutItemCommand { constructor(input) { this.input = input; } }
  class DynamoDBClient {
    async send(command) {
      if (failWith) throw failWith;
      assert.equal(command.input.TableName, 'test-game');
      if (command instanceof GetItemCommand) {
        assert.equal(command.input.ConsistentRead, true);
        return item ? { Item: structuredClone(item) } : {};
      }
      assert.equal(command.input.ConditionExpression, 'attribute_not_exists(#revision) OR #revision = :expected');
      const expected = command.input.ExpressionAttributeValues[':expected'].N;
      if (item && item.revision.N !== expected) {
        const error = new Error('Conflict'); error.name = 'ConditionalCheckFailedException'; throw error;
      }
      item = structuredClone(command.input.Item);
      return {};
    }
  }
  const context = {
    exports: {}, Buffer, console: context_console,
    process: { env: { TABLE_NAME: 'test-game', SITE_ORIGIN: 'https://xiangqi.dliu.com' } },
    require: name => {
      assert.equal(name, '@aws-sdk/client-dynamodb');
      return { DynamoDBClient, GetItemCommand, PutItemCommand };
    },
  };
  const source = [
    readFileSync(new URL('../src/engine.js', import.meta.url), 'utf8').replace(/^export /gm, ''),
    readFileSync(new URL('../backend/game-service.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''),
    readFileSync(new URL('../backend/handler.cjs', import.meta.url), 'utf8'),
  ].join('\n');
  vm.runInNewContext(source, context);
  return async (method, payload, overrides = {}) => {
    const response = await context.exports.handler({
      rawPath: '/api/game', requestContext: { http: { method } },
      headers: { 'content-type': 'application/json', origin: 'https://xiangqi.dliu.com' },
      ...(payload ? { body: JSON.stringify(payload) } : {}), ...overrides,
    });
    return { ...response, data: JSON.parse(response.body) };
  };
}

test('GET restores a game saved by POST, with no cached API responses', async () => {
  const api = createApi();
  const first = await api('GET');
  assert.equal(first.data.state.revision, 0);
  const save = await api('POST', { expectedRevision: 0, action: { type: 'move', from: 54, to: 45 } });
  assert.equal(save.statusCode, 200);
  const restored = await api('GET');
  assert.equal(restored.headers['cache-control'], 'no-store');
  assert.deepEqual(restored.data.state, save.data.state);
  assert.equal(restored.data.state.board[54], null);
  assert.equal(restored.data.state.board[45].type, 'soldier');
  assert.equal(restored.data.state.turn, 'black');
});

test('two simultaneous writes cannot lose a move', async () => {
  const api = createApi();
  const results = await Promise.all([
    api('POST', { expectedRevision: 0, action: { type: 'move', from: 54, to: 45 } }),
    api('POST', { expectedRevision: 0, action: { type: 'move', from: 56, to: 47 } }),
  ]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  const current = await api('GET');
  assert.equal(current.data.state.history.length, 1);
  const conflict = results.find(r => r.statusCode === 409);
  assert.deepEqual(conflict.data.state, current.data.state);
});

test('malformed and cross-origin requests are rejected without saving', async () => {
  const api = createApi();
  assert.equal((await api('POST', null, { body: '{' })).statusCode, 400);
  assert.equal((await api('POST', null, { body: 'x'.repeat(2049) })).statusCode, 413);
  assert.equal((await api('POST', {}, { headers: { 'content-type': 'text/plain' } })).statusCode, 415);
  assert.equal((await api('POST', {}, { headers: { origin: 'https://example.org' } })).statusCode, 403);
  assert.equal((await api('DELETE')).statusCode, 405);
  assert.equal((await api('GET', null, { rawPath: '/api/other' })).statusCode, 404);
  assert.equal((await api('GET')).data.state.revision, 0);
});

test('injection-style and type-confused bodies are rejected without saving', async () => {
  const api = createApi();
  const bodies = [
    'null', '[1,2]', '"text"', '{"expectedRevision":"0","action":{"type":"draw"}}',
    '{"expectedRevision":-1,"action":{"type":"draw"}}', '{"expectedRevision":1e308,"action":{"type":"draw"}}',
    '{"expectedRevision":0,"action":{"type":{"$ne":null}}}', '{"expectedRevision":0,"action":{"type":"__proto__"}}',
    '{"expectedRevision":0,"action":{"type":"constructor"}}', '{"expectedRevision":0,"__proto__":{"type":"new"},"action":{}}',
    '{"expectedRevision":0,"action":{"type":"move","from":1.5,"to":"2"}}', '{"expectedRevision":0,"action":{"type":"move","from":-1,"to":90}}',
    '{"expectedRevision":0,"action":{"type":"move","from":0,"to":0}}', '{"expectedRevision":0,"action":{"type":"move","from":0,"to":89}}',
    '{"expectedRevision":0,"action":{"type":"move","from":0,"to":9}}',
  ];
  for (const body of bodies) {
    const response = await api('POST', null, { body });
    assert.equal(response.statusCode, 400, body);
    assert.equal(typeof response.data.message, 'string');
    assert.equal(response.data.state, undefined, body);
  }
  assert.equal((await api('GET')).data.state.revision, 0);
  assert.equal(({}).type, undefined);
});

test('Origin null, other dliu.com sites and oversized base64 bodies are refused', async () => {
  const api = createApi();
  const draw = JSON.stringify({ expectedRevision: 0, action: { type: 'draw' } });
  for (const origin of ['null', 'https://blog.dliu.com', 'http://xiangqi.dliu.com', 'https://xiangqi.dliu.com.evil.example']) {
    assert.equal((await api('POST', null, { body: draw, headers: { 'content-type': 'application/json', origin } })).statusCode, 403, origin);
  }
  for (const type of ['application/x-www-form-urlencoded', 'multipart/form-data', undefined]) {
    assert.equal((await api('POST', null, { body: draw, headers: { 'content-type': type, origin: 'https://xiangqi.dliu.com' } })).statusCode, 415, type);
  }
  const big = Buffer.from(JSON.stringify({ expectedRevision: 0, pad: 'a'.repeat(2100), action: { type: 'draw' } })).toString('base64');
  assert.equal((await api('POST', null, { body: big, isBase64Encoded: true })).statusCode, 413);
  assert.equal((await api('GET')).data.state.result, null);
});

test('unexpected failures return a generic message and log no request data', async () => {
  logged.length = 0;
  const failure = Object.assign(new Error('User: arn:aws:sts::000000000000:assumed-role/x is not authorized'), { name: 'AccessDeniedException' });
  const api = createApi({ failWith: failure });
  const response = await api('POST', { expectedRevision: 0, action: { type: 'move', from: 54, to: 45 } });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.data, { message: '棋局暂时无法同步，请稍后重试。' });
  assert.doesNotMatch(response.body, /arn:|AccessDenied|stack/);
  assert.equal(logged.length, 1);
  assert.doesNotMatch(JSON.stringify(logged), /from|expectedRevision|origin/);
});
