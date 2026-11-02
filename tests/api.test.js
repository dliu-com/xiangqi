import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the exact inline code deployed by CDK against a conditional-write store.
function createApi() {
  let item = null;
  class GetItemCommand { constructor(input) { this.input = input; } }
  class PutItemCommand { constructor(input) { this.input = input; } }
  class DynamoDBClient {
    async send(command) {
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
    exports: {}, Buffer, console,
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
