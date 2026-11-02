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
exports.handler = async event => {
  const method = event.requestContext?.http?.method;
  const requestPath = event.rawPath;
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
