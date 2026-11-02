import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import * as engine from '../src/engine.js';
import { registerGameTools } from '../src/agent-tools.js';
import { createState, transition } from '../backend/game-service.js';

const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (status, data) => ({ ok: status === 200, status, json: async () => structuredClone(data) });

// Run the real client with a minimal DOM and a controllable, local-only API.
async function createClient(initialState = createState(), storage = new Map()) {
  const elements = new Map(), tools = new Map(), requests = [];
  const intervals = [];
  const documentListeners = new Map();
  let remote = structuredClone(initialState), onGet = null, beforePost = null;
  const element = () => {
    const listeners = new Map(), classes = new Set();
    return {
      style: {}, classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) },
      textContent: '', disabled: false, attributes: {}, children: [],
      append(child) { this.children.push(child); },
      addEventListener(name, listener) { listeners.set(name, listener); },
      setAttribute(name, value) { this.attributes[name] = value; },
      click() { if (!this.disabled) return listeners.get('click')?.(); },
    };
  };
  const document = {
    documentElement: element(),
    fullscreenElement: null,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
    querySelectorAll: () => [],
    addEventListener(name, listener) { documentListeners.set(name, listener); },
    modelContext: { registerTool(tool) { tools.set(tool.name, tool); } },
  };
  vm.runInNewContext(source, {
    ...engine, registerGameTools, document, window: { addEventListener() {} },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    console, AbortController, AbortSignal, TextEncoder, structuredClone, crypto: webcrypto,
    setTimeout, clearTimeout,
    setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; },
    clearInterval() {},
    async fetch(url, options = {}) {
      assert.equal(url, './api/game');
      const method = options.method || 'GET';
      requests.push({ method, ...options });
      if (method === 'GET') return onGet ? onGet(options) : response(200, { state: remote });
      if (beforePost) beforePost();
      try {
        remote = transition(remote, JSON.parse(options.body));
        return response(200, { state: remote });
      } catch (error) {
        return response(error.statusCode, { message: error.message, state: remote });
      }
    },
  });
  await flush();
  assert.equal(tools.get('get_xiangqi_game').execute().ready, true);
  requests.length = 0;
  return {
    requests, intervals, elements, storage, document,
    dispatchDocument: (name, event = {}) => documentListeners.get(name)?.(event),
    state: () => tools.get('get_xiangqi_game').execute(),
    move: (from = 56, to = 47) => tools.get('play_xiangqi_move').execute({ from, to, expectedRevision: tools.get('get_xiangqi_game').execute().revision }),
    remoteMove() { remote = transition(remote, { expectedRevision: remote.revision, action: { type: 'move', from: 54, to: 45 } }); },
    remote: () => structuredClone(remote),
    onGet(handler) { onGet = handler; },
    beforePost(handler) { beforePost = handler; },
  };
}

test('each move checks the latest revision before POST, using the original revision', async () => {
  const client = await createClient();
  const saved = await client.move();
  assert.equal(saved.success, true);
  assert.deepEqual(client.requests.map(request => request.method), ['GET', 'POST']);
  assert.equal(client.requests[0].cache, 'no-store');
  assert.equal(JSON.parse(client.requests[1].body).expectedRevision, 0);
  assert.equal(client.state().moveCount, 1);
  assert.equal(client.state().board[47].side, 'red');
});

test('device B sees device A move on its five-second poll without focus or visibility events', async () => {
  const deviceA = await createClient();
  const deviceB = await createClient();
  deviceB.onGet(() => response(200, { state: deviceA.remote() }));
  await deviceA.move(54, 45);
  assert.equal(deviceB.state().moveCount, 0);
  assert.equal(deviceB.intervals.length, 1);
  assert.equal(deviceB.intervals[0].delay, 5000);
  deviceB.intervals[0].callback();
  await flush();
  assert.equal(deviceB.state().moveCount, 1);
  assert.equal(deviceB.state().turn, 'black');
  assert.equal(deviceB.state().board[54], null);
  assert.equal(deviceB.state().board[45].side, 'red');
  assert.deepEqual(deviceB.requests.map(request => request.method), ['GET']);
});

test('a newer remote game is displayed without sending the stale move', async () => {
  const client = await createClient();
  client.remoteMove();
  await assert.rejects(client.move(), /落子未获确认/);
  assert.deepEqual(client.requests.map(request => request.method), ['GET']);
  assert.equal(client.state().revision, 1);
  assert.equal(client.state().board[45].side, 'red');
  assert.equal(client.state().board[47], null);
  assert.equal(client.state().ready, true);
  assert.match(client.elements.get('sync-status').textContent, /棋局已更新/);
});

for (const failure of ['HTTP error', 'network error', 'timeout', 'invalid state']) {
  test(`a pre-move ${failure} prevents POST and allows later polling recovery`, async () => {
    const client = await createClient();
    client.onGet(() => {
      if (failure === 'HTTP error') return response(503, {});
      if (failure === 'invalid state') return response(200, { state: {} });
      throw new Error(failure);
    });
    await assert.rejects(client.move(), /落子未获确认/);
    assert.deepEqual(client.requests.map(request => request.method), ['GET']);
    assert.equal(client.remote().revision, 0);
    assert.equal(client.state().ready, false);
    assert.match(client.elements.get('sync-status').textContent, /本次操作未保存/);
    client.onGet(null);
    client.intervals[0].callback();
    await flush();
    assert.equal(client.state().ready, true);
    assert.equal(client.state().moveCount, 0);
  });
}

test('a competing move after the GET is still rejected by the conditional POST', async () => {
  const client = await createClient();
  client.beforePost(() => client.remoteMove());
  await assert.rejects(client.move(), /落子未获确认/);
  assert.deepEqual(client.requests.map(request => request.method), ['GET', 'POST']);
  assert.equal(client.state().revision, 1);
  assert.equal(client.state().board[45].side, 'red');
  assert.equal(client.state().board[47], null);
  assert.equal(client.remote().history.length, 1);
});

test('polling and a second move cannot overlap a pending pre-move check', async () => {
  const client = await createClient();
  let release;
  client.onGet(() => new Promise(resolve => { release = resolve; }));
  const move = client.move();
  assert.equal(client.state().ready, false);
  assert.equal(client.elements.get('new-game-button').disabled, true);
  client.intervals[0].callback();
  await assert.rejects(client.move(), /正在同步/);
  assert.deepEqual(client.requests.map(request => request.method), ['GET']);
  release(response(200, { state: client.remote() }));
  assert.equal((await move).success, true);
  assert.deepEqual(client.requests.map(request => request.method), ['GET', 'POST']);
});

test('a move cancels an older poll and ignores its late response', async () => {
  const client = await createClient();
  const oldState = client.remote();
  let release;
  client.onGet(() => new Promise(resolve => { release = resolve; }));
  client.intervals[0].callback();
  const poll = client.requests[0];
  client.onGet(null);
  assert.equal((await client.move()).success, true);
  assert.equal(poll.signal.aborted, true);
  release(response(200, { state: oldState }));
  await flush();
  assert.equal(client.state().revision, 1);
  assert.equal(client.state().board[47].side, 'red');
  assert.equal(client.state().ready, true);
});

function endgamePosition(winner = 'red') {
  const state = createState();
  state.board.fill(null);
  state.board[4] = { side: 'black', type: 'general' };
  state.board[86] = { side: 'red', type: 'general' };
  state.board[12] = { side: 'red', type: 'chariot' };
  state.board[22] = { side: 'red', type: 'chariot' };
  if (winner === 'black') {
    state.board = state.board.reverse().map(piece => piece ? { ...piece, side: engine.otherSide(piece.side) } : null);
    state.turn = 'black';
  }
  return state;
}

test('ordinary check has a prominent warning but play can continue; syncing a new game clears it', async () => {
  const state = endgamePosition();
  state.board[12] = null;
  const client = await createClient(state);
  await client.move(22, 13);
  assert.equal(client.state().result, null);
  assert.equal(client.elements.get('game-alert').hidden, false);
  assert.equal(client.elements.get('game-alert-title').textContent, '将军！');
  assert.match(client.elements.get('game-alert-detail').textContent, /黑方被将军/);
  assert.match(client.elements.get('squares').children[4].innerHTML, /check-badge/);
  assert.equal(client.elements.get('squares').children[4].disabled, false);
  const newGame = transition(client.remote(), { expectedRevision: 1, action: { type: 'new' } });
  client.onGet(() => response(200, { state: newGame }));
  client.intervals[0].callback();
  await flush();
  assert.equal(client.elements.get('game-alert').hidden, true);
});

for (const winner of ['red', 'black']) {
  test(`checkmate names the loser when ${winner} wins, survives reload, and clears on undo`, async () => {
    const client = await createClient(endgamePosition(winner));
    await client.move(winner === 'red' ? 22 : 67, winner === 'red' ? 13 : 76);
    const title = `绝杀 · ${engine.SIDES[engine.otherSide(winner)]}已输`;
    assert.equal(client.state().result.reason, 'checkmate');
    assert.equal(client.elements.get('game-alert-title').textContent, title);
    assert.match(client.elements.get('game-alert-detail').textContent, new RegExp(`${engine.SIDES[winner]}获胜`));
    assert(client.elements.get('squares').children.every(button => button.disabled));
    assert.equal(client.elements.get('undo-button').disabled, false);
    assert.equal(client.elements.get('new-game-button').disabled, false);
    const restored = await createClient(client.remote());
    assert.equal(restored.elements.get('game-alert').hidden, false);
    assert.equal(restored.elements.get('game-alert-title').textContent, title);
    const undone = transition(client.remote(), { expectedRevision: 1, action: { type: 'undo' } });
    client.onGet(() => response(200, { state: undone }));
    client.intervals[0].callback();
    await flush();
    assert.equal(client.elements.get('game-alert').hidden, true);
    assert(client.elements.get('squares').children.every(button => !button.disabled));
  });
}

test('shared-device pieces face their owner, including across the river and after swapping seats', async () => {
  const state = createState();
  state.board[27] = null;
  state.board[45] = { side: 'black', type: 'soldier' };
  const client = await createClient(state);
  const points = client.elements.get('squares').children;
  assert.equal(client.state().mode, 'shared');
  assert.match(points[4].className, /face-opponent/);
  assert.match(points[45].className, /face-opponent/);
  assert.doesNotMatch(points[85].className, /face-opponent/);
  assert.equal(client.elements.get('side-choices').hidden, true);
  assert.equal(client.elements.get('top-player').classList.contains('face-opponent'), true);
  client.elements.get('flip-button').click();
  assert.match(points[85].className, /face-opponent/);
  assert.doesNotMatch(points[4].className, /face-opponent/);
  assert(parseFloat(points[4].style.top) > 90);
  assert.equal(client.requests.length, 0);
  assert.equal(client.remote().revision, 0);
});

test('separate-device black selection puts black below, keeps text upright and waits for red', async () => {
  const client = await createClient();
  client.elements.get('mode-separate').click();
  client.elements.get('side-black').click();
  const points = client.elements.get('squares').children;
  assert.equal(client.state().playerSide, 'black');
  assert.equal(client.elements.get('side-choices').hidden, false);
  assert.equal(client.elements.get('side-black').attributes['aria-pressed'], 'true');
  assert.equal(client.elements.get('flip-button').hidden, true);
  assert.match(client.elements.get('bottom-player').innerHTML, /黑方 · 我/);
  assert(parseFloat(points[4].style.top) > 90);
  assert(points.every(point => !point.className.includes('face-opponent')));
  assert(points.every(point => point.disabled));
  assert.equal(client.elements.get('resign-button').disabled, true);
  await assert.rejects(client.move(54, 45), /等待红方/);
  assert.equal(client.requests.length, 0);
  client.remoteMove();
  client.intervals[0].callback();
  await flush();
  assert.equal(client.state().playerSide, 'black');
  assert(points.every(point => !point.disabled));
  assert.equal(client.elements.get('resign-button').disabled, false);
  assert.equal((await client.move(27, 36)).success, true);
  assert.equal(client.state().moveCount, 2);
  assert(points.every(point => point.disabled));
});

test('red selection plays red, waits for black, and shared mode enables the other player', async () => {
  const client = await createClient();
  client.elements.get('mode-separate').click();
  assert.equal(client.state().playerSide, 'red');
  const points = client.elements.get('squares').children;
  assert(parseFloat(points[85].style.top) > 90);
  await client.move(54, 45);
  assert(points.every(point => point.disabled));
  await assert.rejects(client.move(27, 36), /等待黑方/);
  client.elements.get('mode-shared').click();
  assert(points.every(point => !point.disabled));
  assert.equal((await client.move(27, 36)).success, true);
});

test('mode, chosen side and shared seating survive refresh without modifying the shared game', async () => {
  const client = await createClient();
  client.elements.get('flip-button').click();
  client.elements.get('mode-separate').click();
  client.elements.get('side-black').click();
  assert.equal(client.requests.length, 0);
  const restored = await createClient(client.remote(), client.storage);
  assert.equal(restored.state().mode, 'separate');
  assert.equal(restored.state().playerSide, 'black');
  restored.elements.get('mode-shared').click();
  assert(parseFloat(restored.elements.get('squares').children[4].style.top) > 90);
  assert.equal(restored.state().revision, 0);
  assert.equal(restored.requests.length, 0);
  const otherDevice = await createClient(client.remote());
  assert.equal(otherDevice.state().mode, 'shared');
  assert(parseFloat(otherDevice.elements.get('squares').children[85].style.top) > 90);
});

test('changing mode clears the selected piece without submitting it', async () => {
  const client = await createClient();
  const points = client.elements.get('squares').children;
  points[54].click();
  assert.match(points[54].className, /selected/);
  client.elements.get('mode-separate').click();
  assert.doesNotMatch(points[54].className, /selected/);
  assert.doesNotMatch(points[45].className, /legal/);
  assert.equal(client.requests.length, 0);
});

test('unavailable or malformed saved preferences do not prevent play', async () => {
  for (const storage of [new Map([['xiangqi-view-settings', '{invalid']]), { get() { throw new Error('Storage unavailable'); }, set() { throw new Error('Storage unavailable'); } }]) {
    const client = await createClient(createState(), storage);
    assert.equal(client.state().mode, 'shared');
    client.elements.get('mode-separate').click();
    assert.equal(client.state().playerSide, 'red');
    assert.equal((await client.move()).success, true);
  }
});

test('board-only fullscreen works without a native API, keeps syncing, and exits with Escape', async () => {
  const client = await createClient();
  await client.elements.get('fullscreen-button').click();
  assert.equal(client.document.documentElement.classList.contains('board-fullscreen'), true);
  assert.equal(client.elements.get('fullscreen-button').textContent, '退出全屏');
  assert.equal(client.requests.length, 0);
  client.remoteMove();
  client.intervals[0].callback();
  await flush();
  assert.match(client.elements.get('fullscreen-status').textContent, /轮到黑方/);
  assert.match(client.elements.get('fullscreen-status').textContent, /已同步/);
  assert.equal(client.document.documentElement.classList.contains('board-fullscreen'), true);
  client.dispatchDocument('keydown', { key: 'Escape' });
  assert.equal(client.document.documentElement.classList.contains('board-fullscreen'), false);
  assert.equal(client.elements.get('fullscreen-button').textContent, '全屏棋盘');
});

test('native fullscreen entry, exit button, and browser exit keep the layout in sync', async () => {
  const client = await createClient();
  client.document.documentElement.requestFullscreen = async () => {
    client.document.fullscreenElement = client.document.documentElement;
    client.dispatchDocument('fullscreenchange');
  };
  client.document.exitFullscreen = async () => {
    client.document.fullscreenElement = null;
    client.dispatchDocument('fullscreenchange');
  };
  await client.elements.get('fullscreen-button').click();
  assert.equal(client.document.fullscreenElement, client.document.documentElement);
  await client.elements.get('fullscreen-button').click();
  assert.equal(client.document.fullscreenElement, null);
  assert.equal(client.document.documentElement.classList.contains('board-fullscreen'), false);
  await client.elements.get('fullscreen-button').click();
  await client.document.exitFullscreen();
  assert.equal(client.elements.get('fullscreen-button').attributes['aria-pressed'], 'false');
  assert.equal(client.requests.length, 0);
});

test('rejected native fullscreen still provides an exit-able board view', async () => {
  const client = await createClient();
  client.document.documentElement.requestFullscreen = async () => { throw new Error('Fullscreen unavailable'); };
  await client.elements.get('fullscreen-button').click();
  assert.equal(client.document.documentElement.classList.contains('board-fullscreen'), true);
  assert.equal(client.elements.get('fullscreen-button').disabled, false);
  await client.elements.get('fullscreen-button').click();
  assert.equal(client.document.documentElement.classList.contains('board-fullscreen'), false);
});
