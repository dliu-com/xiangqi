import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { FUNCTIONS, HEALTH_FUNCTIONS, CHECKS, SITE, NOT_TESTED } from '../src/health-checks.js';
import { renderHealthMarkdown } from '../scripts/health-md.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

// The exact inline Lambda code CDK deploys, with a fake DynamoDB client.
function createHandler({ send, env = {} } = {}) {
  const sent = [];
  class GetItemCommand { constructor(input) { this.input = input; } }
  class PutItemCommand { constructor(input) { this.input = input; } }
  class DynamoDBClient { async send(command, options) { sent.push(command); return send ? send(command, options) : {}; } }
  const context = {
    exports: {}, Buffer, console: { error() {} }, AbortController, setTimeout, clearTimeout,
    process: { env: { TABLE_NAME: 'test-game', SITE_ORIGIN: SITE, ...env } },
    require: () => ({ DynamoDBClient, GetItemCommand, PutItemCommand }),
  };
  vm.runInNewContext([
    read('src/engine.js').replace(/^export /gm, ''),
    read('backend/game-service.js').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''),
    read('backend/handler.cjs'),
  ].join('\n'), context);
  return { handler: context.exports.handler, sent, GetItemCommand, PutItemCommand };
}

// A /health request whose cookies, headers, query string and body throw if the handler touches them.
function healthEvent(method = 'GET') {
  const forbidden = new Set(['headers', 'cookies', 'queryStringParameters', 'rawQueryString', 'body', 'isBase64Encoded']);
  return new Proxy({ rawPath: '/health', requestContext: { http: { method } } }, {
    get(target, key) {
      if (forbidden.has(key)) throw new Error(`/health read event.${String(key)}`);
      return target[key];
    },
  });
}

test('GET /health returns application/health+json with the documented functions, cached for 60 s', async () => {
  const { handler, sent, GetItemCommand } = createHandler();
  const response = await handler(healthEvent());
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/health+json');
  assert.equal(response.headers['cache-control'], 'public, max-age=60');
  const body = JSON.parse(response.body);
  assert.equal(body.status, 'pass');
  assert.match(body.time, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.deepEqual(body.functions, HEALTH_FUNCTIONS.map(({ key, name }) => ({ key, name, status: 'pass' })));
  assert.deepEqual(Object.keys(body).sort(), ['functions', 'status', 'time']);
  // One cheap read of a fixed key, and never a write.
  assert.equal(sent.length, 1);
  assert.ok(sent[0] instanceof GetItemCommand);
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].input.Key)), { gameId: { S: 'current' } });
  assert.equal(sent[0].input.ProjectionExpression, '#revision');
  assert.notEqual(sent[0].input.ConsistentRead, true);
  assert.equal((await handler(healthEvent('HEAD'))).statusCode, 200);
});

test('/health reads no cookies, Authorization header, query string or body', async () => {
  const { handler } = createHandler();
  const response = await handler(healthEvent());
  assert.equal(response.statusCode, 200);
  const source = read('backend/handler.cjs');
  const healthCode = source.slice(source.indexOf('const HEALTH_FUNCTIONS'), source.indexOf('exports.handler')).replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(healthCode, /\bevent\b|cookie|authorization|querystring|rawquery/i);
  // In the handler, /health returns before anything reads the request's headers or body.
  const entry = source.slice(source.indexOf('exports.handler'));
  assert.ok(entry.indexOf('return health()') < entry.indexOf('event.headers'));
});

test('a failed or timed-out read returns 503 fail with a generic reason and no details', async () => {
  const failing = createHandler({ send: () => { throw Object.assign(new Error('User arn:aws:iam::000000000000:role/x not authorized on table test-game'), { name: 'AccessDeniedException' }); } });
  const failed = await failing.handler(healthEvent());
  assert.equal(failed.statusCode, 503);
  const body = JSON.parse(failed.body);
  assert.equal(body.status, 'fail');
  assert.deepEqual(body.functions[0], { key: 'game', name: 'Shared game storage', status: 'fail', output: 'read failed' });
  assert.equal(body.functions[1].status, 'pass');
  assert.doesNotMatch(failed.body, /arn:|test-game|AccessDenied|authorized/);

  const hanging = createHandler({
    env: { HEALTH_TIMEOUT_MS: '20' },
    send: (command, options) => new Promise((resolve, reject) => options.abortSignal.addEventListener('abort', () => reject(new Error('aborted')))),
  });
  const timedOut = JSON.parse((await hanging.handler(healthEvent())).body);
  assert.deepEqual(timedOut.functions[0], { key: 'game', name: 'Shared game storage', status: 'fail', output: 'timeout' });
});

test('/health accepts only GET and HEAD', async () => {
  const { handler, sent } = createHandler();
  const response = await handler({ rawPath: '/health', requestContext: { http: { method: 'POST' } }, headers: {} });
  assert.equal(response.statusCode, 405);
  assert.equal(sent.length, 0);
});

test('the endpoint, /docs#health, /docs/health.md and the check list use the same function keys', () => {
  const handler = read('backend/handler.cjs');
  const handlerFunctions = [...handler.matchAll(/\{ key: '(\w+)', name: '([^']+)' \}/g)].map(([, key, name]) => ({ key, name }));
  assert.deepEqual(handlerFunctions, HEALTH_FUNCTIONS.map(({ key, name }) => ({ key, name })));
  const functionKeys = FUNCTIONS.map(fn => fn.key);
  for (const { key } of HEALTH_FUNCTIONS) assert.ok(functionKeys.includes(key), key);
  for (const check of CHECKS) {
    for (const key of check.fn.split(', ')) assert.ok(functionKeys.includes(key), `${check.url}: ${key}`);
    assert.ok(['GET', 'HEAD'].includes(check.method), check.url);
  }
  for (const key of functionKeys) assert.ok(CHECKS.some(check => check.fn.split(', ').includes(key)), `no guest check for ${key}`);
  const markdown = read('src/docs-health.md');
  for (const key of functionKeys) assert.ok(markdown.includes(`| \`${key}\` |`), key);
  for (const check of CHECKS) assert.ok(markdown.includes(`| ${check.method} | ${check.url} | ${check.status} |`), check.url);
});

test('/docs/health.md is the generated, full technical version', () => {
  assert.equal(read('src/docs-health.md'), renderHealthMarkdown(), 'run make health-md');
  const markdown = read('src/docs-health.md');
  for (const text of ['application/health+json', 'public, max-age=60', '503', 'Authorization', 'never `POST`', HEALTH_FUNCTIONS[0].check]) {
    assert.ok(markdown.includes(text), text);
  }
});

test('the Testing tab (/docs#health) is for people: numbers, flows, a plain table, a chart and no exact technical details', () => {
  const page = read('src/docs.html');
  assert.ok(page.includes('<a href="/docs#health" data-tab="health" data-en="Testing">测试</a>'));
  assert.ok(page.includes('<a href="/docs#architecture" data-tab="architecture" aria-current="page" data-en="Architecture">架构</a>'));
  assert.ok(page.includes('<article id="health" class="dl-docs" hidden>'));
  const docs = read('src/docs.js');
  assert.ok(docs.includes("import { health } from './docs-health.js';"));
  assert.ok(docs.includes("const TABS = ['architecture', 'cost', 'security', 'health'];"));
  assert.ok(docs.includes('const BUILDERS = { architecture, cost, security, health };'));
  const script = read('src/docs-health.js');
  assert.match(script, /export function health\(root\)/);
  assert.match(script, /root\.append\(stats\(\[/);
  assert.equal((script.match(/flow\(\{/g) || []).length, 2);
  for (const tone of ['good', 'warn', 'bad']) assert.ok(script.includes(`tone: '${tone}'`), tone);
  assert.match(script, /barChart\(/);
  assert.ok(script.includes("t('如果坏了，你会看到', 'If it broke, you would notice')"));
  assert.ok(script.includes("link.textContent = t('给机器读的技术版本（Markdown）', 'Technical version for machines (Markdown)');"));
  assert.ok(script.includes("link.href = '/docs/health.md';"));
  // Nothing folded and no exact technical details: no <details>, code, status codes, content types or JSON.
  assert.doesNotMatch(script, /\bmore\(|\bcode\(|\bmono\(|details|<code|HEALTH_EXAMPLE|HEALTH_FUNCTIONS|application\/|text\/html|\b(200|301|404|405|415|503)\b|https?:\/\//);
  assert.doesNotMatch(script, /CHECKS\.map|check\.(url|status|type|marker|location)/);
  // The plain-words texts it shows have no URLs, status codes or formats either.
  for (const fn of FUNCTIONS) {
    for (const text of [fn.whatZh, fn.whatEn, fn.howZh, fn.howEn, fn.downZh, fn.downEn]) {
      assert.ok(text, fn.key);
      assert.doesNotMatch(text, /https?:|\b\d{3}\b|json|content-type|header/i, text);
    }
  }
  for (const item of NOT_TESTED) assert.doesNotMatch(`${item.zh} ${item.en}`, /https?:|\.js\b|tests\//, item.en);
});

test('/docs/health is a redirect, not a page', () => {
  assert.ok(CHECKS.some(check => check.url === `${SITE}/docs/health` && check.status === 301 && check.location === '/docs#health'));
  assert.ok(!read('scripts/publish-site.sh').includes('docs-health.html'));
  assert.throws(() => read('src/docs-health.html'));
});

test('every guest-check marker is in the file S3 serves, and both docs pages are published', () => {
  const files = {
    '/': 'src/index.html', '/app.js': 'src/app.js', '/styles.css': 'src/styles.css', '/no-such-page': 'src/404.html',
    '/docs': 'src/docs.html', '/docs/health.md': 'src/docs-health.md', '/engine.js': 'src/engine.js',
  };
  for (const check of CHECKS) {
    if (!check.marker || check.json) continue;
    const file = files[new URL(check.url).pathname];
    assert.ok(file, check.url);
    assert.ok(read(file).includes(check.marker), `${check.url}: ${check.marker}`);
  }
  const publish = read('scripts/publish-site.sh');
  assert.ok(publish.includes(`src/docs-health.md" "s3://$SITE_BUCKET_NAME/docs/health.md" --content-type 'text/markdown; charset=utf-8'`));
});
