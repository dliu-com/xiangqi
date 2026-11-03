import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createState, transition, GameError } from '../backend/game-service.js';
const root = path.resolve(fileURLToPath(new URL('../src/', import.meta.url)));
let state = createState();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/api/game') {
    const send = (code, value) => { response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
    if (request.method === 'GET') return send(200, { state });
    if (request.method !== 'POST') return send(405, { message: '不支持此请求方法。' });
    try {
      let body = '';
      for await (const chunk of request) { body += chunk; if (body.length > 2048) throw new GameError('请求过大。', 413); }
      let data;
      try { data = JSON.parse(body); } catch { throw new GameError('请求格式无效。'); }
      state = transition(state, data);
      return send(200, { state });
    } catch (error) { return send(error.statusCode || 500, { message: error.message, ...(error.statusCode === 409 ? { state } : {}) }); }
  }
  try {
    const pages = { '/': '/index.html', '/docs': '/docs.html' };
    const filename = path.resolve(root, '.' + decodeURIComponent(pages[pathname] || pathname));
    if (!filename.startsWith(root + path.sep) && filename !== root) throw new Error('Invalid path');
    const data = await readFile(filename);
    response.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(data);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(4173, '127.0.0.1', () => console.log('Local: http://127.0.0.1:4173/ (preview game is stored in memory)'));
