// The CDK stack prepends the shared engine and game-service code to this handler.
const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const db = new DynamoDBClient({});
const response = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  body: JSON.stringify(body),
});
async function readGame() {
  const data = await db.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: { gameId: { S: 'current' } },
    ConsistentRead: true,
  }));
  return data.Item ? JSON.parse(data.Item.state.S) : createState();
}
// Public, read-only health check for status.dliu.com (see /docs/health). It reads nothing from the request
// (no headers, cookies or query string), makes one cheap read and never writes. Keys match /docs/health.
const HEALTH_FUNCTIONS = [
  { key: 'game', name: 'Shared game storage' },
  { key: 'rules', name: 'Move rules' },
];
async function checkGame() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.HEALTH_TIMEOUT_MS) || 2000);
  const started = Date.now();
  try {
    await db.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: { gameId: { S: 'current' } },
      ProjectionExpression: '#revision',
      ExpressionAttributeNames: { '#revision': 'revision' },
    }), { abortSignal: controller.signal });
    return Date.now() - started > 1000 ? { status: 'warn', output: 'slow' } : { status: 'pass' };
  } catch {
    return { status: 'fail', output: controller.signal.aborted ? 'timeout' : 'read failed' };
  } finally {
    clearTimeout(timeout);
  }
}
function checkRules() {
  try {
    return allLegalMoves(initialBoard(), 'red').length === 44 ? { status: 'pass' } : { status: 'fail', output: 'rules check failed' };
  } catch {
    return { status: 'fail', output: 'rules check failed' };
  }
}
async function health() {
  const results = { game: await checkGame(), rules: checkRules() };
  const functions = HEALTH_FUNCTIONS.map(({ key, name }) => ({ key, name, ...results[key] }));
  const status = functions.some(f => f.status === 'fail') ? 'fail' : functions.some(f => f.status === 'warn') ? 'warn' : 'pass';
  return {
    statusCode: status === 'fail' ? 503 : 200,
    headers: { 'content-type': 'application/health+json', 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff' },
    body: JSON.stringify({ status, time: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), functions }),
  };
}

exports.handler = async event => {
  const method = event.requestContext?.http?.method;
  const requestPath = event.rawPath;
  if (requestPath === '/health') {
    if (method !== 'GET' && method !== 'HEAD') return response(405, { message: '不支持此请求方法。' });
    return health();
  }
  if (requestPath !== '/api/game') return response(404, { message: '页面不存在。' });
  try {
    if (method === 'GET') return response(200, { state: await readGame() });
    if (method !== 'POST') return response(405, { message: '不支持此请求方法。' });
    const headers = event.headers || {};
    if (headers.origin && headers.origin !== process.env.SITE_ORIGIN) return response(403, { message: '请求来源无效。' });
    if (!headers['content-type']?.toLowerCase().startsWith('application/json')) return response(415, { message: '请使用 JSON 格式。' });
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
    if (Buffer.byteLength(raw) > 2048) return response(413, { message: '请求过大。' });
    let request;
    try { request = JSON.parse(raw); } catch { return response(400, { message: '请求格式无效。' }); }
    const current = await readGame();
    const next = transition(current, request);
    await db.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: { gameId: { S: 'current' }, revision: { N: String(next.revision) }, state: { S: JSON.stringify(next) } },
      ConditionExpression: 'attribute_not_exists(#revision) OR #revision = :expected',
      ExpressionAttributeNames: { '#revision': 'revision' },
      ExpressionAttributeValues: { ':expected': { N: String(current.revision) } },
    }));
    return response(200, { state: next });
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException' || error.statusCode === 409) {
      return response(409, { message: '棋局已更新，已为你同步最新进度。', state: await readGame() });
    }
    if (error instanceof GameError) return response(error.statusCode, { message: error.message });
    console.error('Game API failed', { name: error.name, message: error.message });
    return response(500, { message: '棋局暂时无法同步，请稍后重试。' });
  }
};
