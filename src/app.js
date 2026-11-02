import { registerGameTools } from './agent-tools.js';
import { initialBoard, legalMoves, positionStatus, otherSide, coordinate, GLYPHS, SIDES, NAMES, RULES } from './engine.js';
const $ = id => document.getElementById(id);
let board = initialBoard(), turn = 'red', history = [], result = null;
let selected = null, destinations = [], flipped = false, cursor = 58;
let status = positionStatus(board, turn), revision = -1;
let saving = false, ready = false, activeRead = null, pendingAction = null;
const squares = [];
let boardFullscreen = false, fullscreenBusy = false;
const viewSettingsKey = 'xiangqi-view-settings';
let playMode = 'shared', playerSide = 'red', sharedFlipped = false;
try {
  const saved = JSON.parse(localStorage.getItem(viewSettingsKey));
  if (saved?.mode === 'separate') playMode = 'separate';
  if (saved?.side === 'black') playerSide = 'black';
  sharedFlipped = saved?.sharedFlipped === true;
} catch { /* Storage may be unavailable; the current page still works. */ }
flipped = playMode === 'separate' ? playerSide === 'black' : sharedFlipped;

for (let index = 0; index < 90; index++) {
  const button = document.createElement('button');
  button.className = 'point'; button.type = 'button';
  button.addEventListener('click', () => selectPoint(index));
  button.addEventListener('keydown', event => handleBoardKey(event, index));
  $('squares').append(button); squares.push(button);
}
for (let c = 0; c < 9; c++) {
  const label = document.createElement('span'); label.className = 'file-label';
  label.style.left = `${(c + .5) / 9 * 100}%`; label.setAttribute('aria-hidden', 'true'); $('board').append(label);
}
for (let r = 0; r < 10; r++) {
  const label = document.createElement('span'); label.className = 'rank-label';
  label.style.top = `${(r + .5) / 10 * 100}%`; label.setAttribute('aria-hidden', 'true'); $('board').append(label);
}
let markings = '';
for (const [r, c] of [[2, 1], [2, 7], [7, 1], [7, 7], ...[3, 6].flatMap(r => [0, 2, 4, 6, 8].map(c => [r, c]))]) {
  const x = 50 + c * 100, y = 50 + r * 100;
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
    if ((c === 0 && dx === -1) || (c === 8 && dx === 1)) continue;
    markings += `<path d="M${x + dx * 10} ${y + dy * 24}V${y + dy * 10}H${x + dx * 24}"/>`;
  }
}
$('board-markings').innerHTML = markings;
$('piece-rules').innerHTML = Object.keys(NAMES).map(type => `<div class="rule-row"><div class="rule-glyphs" lang="zh">${GLYPHS.red[type]} ${GLYPHS.black[type]}</div><div><h3>${NAMES[type]}</h3><p>${RULES[type]}</p></div></div>`).join('');

function announce(message) { $('announcement').textContent = message; }
function setSync(message, error = false) {
  $('sync-status').textContent = message;
  $('sync-status').classList.toggle('sync-error', error);
  $('sync-retry').hidden = !error;
  renderFullscreenStatus();
}
function renderFullscreenStatus() {
  const statusLine = $('fullscreen-status');
  if (!statusLine) return;
  const turnText = result ? result.winner ? `${SIDES[result.winner]}获胜` : '双方和棋' : `轮到${SIDES[turn]}${status.check ? ' · 将军！' : ''}`;
  const message = `${turnText} · ${$('sync-status').textContent}`;
  if (statusLine.textContent !== message) statusLine.textContent = message;
}
function setBoardFullscreen(enabled) {
  boardFullscreen = enabled;
  document.documentElement.classList.toggle('board-fullscreen', enabled);
  if ($('fullscreen-button')) {
    $('fullscreen-button').textContent = enabled ? '退出全屏' : '全屏棋盘';
    $('fullscreen-button').setAttribute('aria-pressed', String(enabled));
  }
}
async function toggleBoardFullscreen() {
  if (fullscreenBusy) return;
  fullscreenBusy = true;
  $('fullscreen-button').disabled = true;
  try {
    if (boardFullscreen) {
      if (document.fullscreenElement) await document.exitFullscreen();
      setBoardFullscreen(false);
    } else {
      setBoardFullscreen(true);
      // Unsupported or denied native fullscreen still has the viewport-filling board view.
      try { await document.documentElement.requestFullscreen?.(); } catch { /* Keep board view. */ }
    }
  } catch { announce('请使用浏览器的退出全屏按钮，或按 Esc。'); }
  finally { fullscreenBusy = false; $('fullscreen-button').disabled = false; }
}
function canPlayTurn() { return playMode === 'shared' || turn === playerSide; }
function waitingMessage() { return `你执${SIDES[playerSide]}，请等待${SIDES[turn]}落子。`; }
function changeView(mode, side = playerSide) {
  if (saving) return;
  playMode = mode; playerSide = side;
  flipped = playMode === 'separate' ? playerSide === 'black' : sharedFlipped;
  selected = null; destinations = [];
  try { localStorage.setItem(viewSettingsKey, JSON.stringify({ mode: playMode, side: playerSide, sharedFlipped })); } catch { /* Keep the in-memory choice. */ }
  render();
}
function renderViewSettings() {
  const separate = playMode === 'separate';
  $('mode-shared')?.setAttribute('aria-pressed', String(!separate));
  $('mode-separate')?.setAttribute('aria-pressed', String(separate));
  $('side-red')?.setAttribute('aria-pressed', String(playerSide === 'red'));
  $('side-black')?.setAttribute('aria-pressed', String(playerSide === 'black'));
  if ($('side-choices')) $('side-choices').hidden = !separate;
  $('flip-button').hidden = separate;
  if ($('flip-divider')) $('flip-divider').hidden = separate;
  $('top-player').classList.toggle('face-opponent', !separate);
  const help = separate ? `你执${SIDES[playerSide]}，己方在下方。${result ? '本局已结束。' : canPlayTurn() ? '轮到你落子。' : `等待${SIDES[turn]}落子。`}` : '面对面对弈：双方棋子分别朝向各自玩家。';
  if ($('mode-help') && $('mode-help').textContent !== help) $('mode-help').textContent = help;
}
function updateControls() {
  const blocked = saving || !ready;
  for (const button of squares) button.disabled = blocked || !!result || !canPlayTurn();
  $('board').setAttribute('aria-busy', String(blocked));
  $('undo-button').disabled = blocked || !history.length;
  $('new-game-button').disabled = blocked;
  $('draw-button').disabled = blocked || !!result;
  $('resign-button').disabled = blocked || !!result || !canPlayTurn();
  for (const id of ['mode-shared', 'mode-separate', 'side-red', 'side-black', 'flip-button']) {
    if ($(id)) $(id).disabled = saving;
  }
}
function acceptState(state) {
  if (!state || !Number.isSafeInteger(state.revision) || !Array.isArray(state.board) || state.board.length !== 90 || !Array.isArray(state.history) || !['red', 'black'].includes(state.turn)) throw new Error('棋局数据无效。');
  if (state.revision < revision) return;
  if (state.revision !== revision) {
    board = state.board; turn = state.turn; history = state.history; result = state.result;
    revision = state.revision; selected = null; destinations = [];
    status = positionStatus(board, turn); render();
    $('history').scrollTop = $('history').scrollHeight;
  }
}
async function fetchRemoteState(signal) {
  const response = await fetch('./api/game', { cache: 'no-store', signal });
  if (!response.ok) throw new Error('暂时无法读取棋局。');
  const data = await response.json();
  return data.state;
}
function showUpdatedGame() {
  setSync('棋局已更新，请重新操作。');
  announce('其他设备已更新棋局，请根据最新局面重新操作。');
}
async function readRemote() {
  if (activeRead || saving) return;
  const controller = new AbortController();
  activeRead = controller;
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const state = await fetchRemoteState(controller.signal);
    if (activeRead !== controller) return;
    acceptState(state); ready = true;
    if (!saving) setSync('已同步 · 棋局自动保存');
  } catch {
    if (activeRead === controller && !saving) { ready = false; setSync('同步中断，请点击重试。', true); }
  } finally {
    clearTimeout(timeout);
    if (activeRead === controller) activeRead = null;
    updateControls();
  }
}
async function submitAction(action, expectedRevision = revision) {
  if (saving || !ready) return;
  if ((action.type === 'move' || action.type === 'resign') && !canPlayTurn()) {
    announce(waitingMessage()); return;
  }
  if (activeRead) { activeRead.abort(); activeRead = null; }
  saving = true; updateControls();
  let uncertain = false;
  let succeeded = false;
  let writeStarted = false;
  try {
    if (action.type === 'move') {
      setSync('正在确认最新棋局…');
      const state = await fetchRemoteState(AbortSignal.timeout(20000));
      acceptState(state);
      if (state.revision !== expectedRevision) {
        showUpdatedGame();
        return { success: false, revision, turn, moveCount: history.length, result };
      }
    }
    setSync('正在保存棋局…');
    const body = JSON.stringify({ expectedRevision, action });
    // CloudFront signs the origin request; Lambda requires the body hash for POST.
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    const payloadHash = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    writeStarted = true;
    const response = await fetch('./api/game', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-amz-content-sha256': payloadHash },
      body, cache: 'no-store', signal: AbortSignal.timeout(25000),
    });
    const data = await response.json();
    if (response.status === 409) {
      acceptState(data.state); showUpdatedGame();
    } else if (!response.ok) {
      setSync(data.message || '操作未完成，请重试。', true); announce(data.message || '操作未完成。');
    } else {
      acceptState(data.state); ready = true; succeeded = true; setSync('已同步 · 棋局自动保存');
      announce(result ? result.winner ? `${SIDES[result.winner]}获胜。` : '双方和棋。' : `${action.type === 'undo' ? '已撤回上一步。' : action.type === 'new' ? '新局开始。' : '落子成功。'}轮到${SIDES[turn]}。${status.check ? '将军！请保护将帅。' : ''}`);
    }
  } catch {
    ready = false;
    if (writeStarted) {
      uncertain = true; setSync('正在确认保存结果，请稍候…', true);
    } else {
      const message = '无法确认最新棋局，本次操作未保存。请重试。';
      setSync(message, true); announce(message);
    }
  } finally {
    saving = false; updateControls();
    if (uncertain) await readRemote();
  }
  return { success: succeeded, revision, turn, moveCount: history.length, result };
}
function selectPoint(index) {
  if (saving || !ready) return;
  cursor = index;
  if (result) { announce('棋局已结束，请开始新局或悔棋。'); return; }
  if (!canPlayTurn()) { announce(waitingMessage()); return; }
  if (selected !== null && destinations.includes(index)) { void submitAction({ type: 'move', from: selected, to: index }); return; }
  if (board[index]?.side === turn) {
    if (selected === index) { selected = null; destinations = []; }
    else { selected = index; destinations = legalMoves(board, index); announce(`已选择${SIDES[turn]}${NAMES[board[index].type]}，位于 ${coordinate(index)}。共有 ${destinations.length} 个可落子的位置。`); }
    render(); return;
  }
  announce(selected !== null ? '这步棋不符合规则。请点击标记位置，或选择其他棋子。' : `轮到${SIDES[turn]}，请选择己方棋子。`);
}
function playerMarkup(side) {
  const captures = history.filter(move => move.piece.side === side && move.captured).map(move => `<span class="captured-piece ${move.captured.side}" lang="zh" title="已吃${SIDES[move.captured.side]}${NAMES[move.captured.type]}">${GLYPHS[move.captured.side][move.captured.type]}</span>`).join('');
  return `<div class="player-id"><span class="avatar ${side}" lang="zh">${GLYPHS[side].general}</span><span class="player-name">${SIDES[side]}${playMode === 'separate' ? side === playerSide ? ' · 我' : ' · 对方' : ''}</span>${turn === side && !result ? '<span class="turn-tag">行棋中</span>' : ''}</div><div class="captures" aria-label="${SIDES[side]}已吃棋子">${captures}</div>`;
}
function renderGameAlert() {
  const alert = $('game-alert');
  // An older cached HTML page can briefly coexist with a newer script during publishing.
  if (!alert) return;
  let title = '', detail = '', symbol = '';
  if (result) {
    symbol = result.winner ? '终' : '和';
    if (result.winner) {
      const loser = SIDES[otherSide(result.winner)];
      const reason = result.reason === 'checkmate' ? '绝杀' : result.reason === 'stalemate' ? '困毙' : '认输';
      title = `${reason} · ${loser}已输`;
      detail = `${SIDES[result.winner]}获胜。${result.reason === 'checkmate' ? `${loser}被将死，已无合法走法。` : ''}本局结束，可悔棋或再开一局。`;
    } else {
      title = '本局和棋'; detail = '双方握手言和，可以再开一局。';
    }
  } else if (status.check) {
    symbol = '将'; title = '将军！';
    detail = `${SIDES[turn]}被将军，请先解除将军，保护${turn === 'red' ? '帅' : '将'}。`;
  }
  alert.className = `game-alert${result ? ' game-alert-ended' : ''}`;
  for (const [id, text] of [['game-alert-symbol', symbol], ['game-alert-title', title], ['game-alert-detail', detail]]) {
    if ($(id).textContent !== text) $(id).textContent = text;
  }
  alert.hidden = !title;
}
function render() {
  const last = history.at(-1);
  squares.forEach((button, index) => {
    const r = Math.floor(index / 9), c = index % 9;
    button.style.left = `${((flipped ? 8 - c : c) + .5) / 9 * 100}%`;
    button.style.top = `${((flipped ? 9 - r : r) + .5) / 10 * 100}%`;
    const piece = board[index], legal = destinations.includes(index);
    const check = piece?.type === 'general' && piece.side === turn && status.check;
    const facesOpponent = playMode === 'shared' && piece?.side === (flipped ? 'red' : 'black');
    button.className = ['point', piece ? 'occupied' : '', facesOpponent ? 'face-opponent' : '', selected === index ? 'selected' : '', legal ? 'legal' : '', last && (last.from === index || last.to === index) ? 'last-move' : '', check ? 'in-check' : ''].filter(Boolean).join(' ');
    button.innerHTML = piece ? `<span class="piece ${piece.side}" lang="zh" aria-hidden="true"><span class="piece-symbol">${GLYPHS[piece.side][piece.type]}</span></span>${check ? `<span class="check-badge" aria-hidden="true">${result?.reason === 'checkmate' ? '将死' : '将军'}</span>` : ''}` : '';
    button.setAttribute('aria-label', `${coordinate(index)}，${piece ? `${SIDES[piece.side]}${NAMES[piece.type]}` : '空位'}${legal ? '，可落子' : ''}${check ? '，被将军' : ''}`);
    button.setAttribute('aria-pressed', String(selected === index));
    button.title = piece ? `${SIDES[piece.side]}${NAMES[piece.type]} · ${coordinate(index)}` : coordinate(index);
    button.tabIndex = cursor === index ? 0 : -1;
  });
  document.querySelectorAll('.file-label').forEach((label, c) => { label.textContent = 'abcdefghi'[flipped ? 8 - c : c]; });
  document.querySelectorAll('.rank-label').forEach((label, r) => { label.textContent = flipped ? r : 9 - r; });
  $('top-player').innerHTML = playerMarkup(flipped ? 'red' : 'black');
  $('bottom-player').innerHTML = playerMarkup(flipped ? 'black' : 'red');
  const activeSide = result?.winner || turn;
  $('turn-icon').className = `turn-piece ${activeSide}`;
  $('turn-icon').textContent = result && !result.winner ? '和' : GLYPHS[activeSide].general;
  $('turn-title').textContent = result ? result.winner ? `${SIDES[result.winner]}获胜` : '握手言和' : `轮到${SIDES[turn]}`;
  $('turn-kicker').textContent = result ? '本局结束' : status.check ? '将军 · 请应将' : history.length ? `第 ${Math.floor(history.length / 2) + 1} 回合` : '红先黑后';
  $('status-detail').textContent = result ? result.reason === 'checkmate' ? `绝杀！${SIDES[otherSide(result.winner)]}已输，将帅被将死，已无合法走法。` : result.reason === 'stalemate' ? `${SIDES[otherSide(result.winner)]}已输：困毙，无合法走法。` : result.reason === 'resignation' ? `${SIDES[otherSide(result.winner)]}认输，本局结束。` : '双方同意和棋。不妨交换红黑，再来一局。' : status.check ? `${SIDES[turn]}被将军！请选择能够解除将军的走法。` : '点击己方棋子，查看可落子的位置。';
  if (!result && !canPlayTurn()) $('status-detail').textContent = status.check ? `${SIDES[turn]}被将军，等待对方应将。` : waitingMessage();
  $('move-count').textContent = `共 ${history.length} 步`;
  renderViewSettings(); renderGameAlert(); renderHistory(); renderFullscreenStatus(); updateControls();
}
function renderHistory() {
  if (!history.length) {
    $('history').innerHTML = '<div class="history-empty"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 6h20v20H6zM6 13h20M6 20h20M13 6v20M20 6v20"/></svg><p>棋局将启，静候落子。</p><small>每一步，都会记录在这里。</small></div>'; return;
  }
  let html = '';
  for (let i = 0; i < history.length; i += 2) {
    html += `<div class="history-row"><span class="move-number">${i / 2 + 1}.</span>`;
    for (const index of [i, i + 1]) {
      const move = history[index];
      if (!move) { html += '<span></span>'; continue; }
      html += `<span class="move-entry ${index === history.length - 1 ? 'latest' : ''}" title="${SIDES[move.piece.side]}${NAMES[move.piece.type]}，${coordinate(move.from)} 至 ${coordinate(move.to)}${move.captured ? `，吃${NAMES[move.captured.type]}` : ''}${move.check ? '，将军' : ''}"><span class="move-glyph ${move.piece.side}" lang="zh">${GLYPHS[move.piece.side][move.piece.type]}</span><span>${coordinate(move.from)}${move.captured ? '×' : '–'}${coordinate(move.to)}</span>${move.check ? '<span class="move-mark" aria-label="将军">+</span>' : ''}</span>`;
    }
    html += '</div>';
  }
  $('history').innerHTML = html;
}
function handleBoardKey(event, index) {
  if (event.key === 'Escape') { event.preventDefault(); selected = null; destinations = []; render(); announce('已取消选择。'); return; }
  const changes = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
  if (!changes[event.key]) return;
  event.preventDefault();
  const [dr, dc] = changes[event.key], direction = flipped ? -1 : 1;
  const r = Math.max(0, Math.min(9, Math.floor(index / 9) + dr * direction));
  const c = Math.max(0, Math.min(8, index % 9 + dc * direction));
  cursor = r * 9 + c;
  squares.forEach((button, i) => { button.tabIndex = cursor === i ? 0 : -1; }); squares[cursor].focus();
}
$('undo-button').addEventListener('click', () => { void submitAction({ type: 'undo' }); });
$('fullscreen-button')?.addEventListener('click', toggleBoardFullscreen);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) setBoardFullscreen(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && boardFullscreen && !document.fullscreenElement) setBoardFullscreen(false);
});
$('mode-shared')?.addEventListener('click', () => changeView('shared'));
$('mode-separate')?.addEventListener('click', () => changeView('separate'));
$('side-red')?.addEventListener('click', () => changeView('separate', 'red'));
$('side-black')?.addEventListener('click', () => changeView('separate', 'black'));
$('flip-button').addEventListener('click', () => {
  if (saving || playMode !== 'shared') return;
  sharedFlipped = !sharedFlipped; changeView('shared');
  announce(`已交换上下方，${flipped ? '黑方' : '红方'}在下方。`);
});
$('guide-button').addEventListener('click', () => $('guide-dialog').showModal());
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => $('guide-dialog').close()));
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
}
function confirmAction(title, description, accept, type) {
  const confirmedRevision = revision;
  $('confirm-title').textContent = title; $('confirm-description').textContent = description; $('confirm-accept').textContent = accept;
  pendingAction = () => submitAction({ type }, confirmedRevision); $('confirm-dialog').showModal();
}
$('confirm-cancel').addEventListener('click', () => $('confirm-dialog').close());
$('confirm-accept').addEventListener('click', () => { const action = pendingAction; $('confirm-dialog').close(); if (action) void action(); });
$('confirm-dialog').addEventListener('close', () => { pendingAction = null; });
$('new-game-button').addEventListener('click', () => confirmAction('重新开始一局？', '当前棋局和棋谱将被清空，所有设备都会同步更新。新局由红方先行。', '开始新局', 'new'));
$('draw-button').addEventListener('click', () => confirmAction('双方同意和棋？', '请与对手确认。双方同意后，本局以和棋结束。', '确认和棋', 'draw'));
$('resign-button').addEventListener('click', () => confirmAction(`${SIDES[turn]}确认认输？`, `认输后，本局由${SIDES[otherSide(turn)]}获胜。`, '确认认输', 'resign'));
$('sync-retry').addEventListener('click', () => { void readRemote(); });
window.addEventListener('focus', () => { void readRemote(); });
window.addEventListener('online', () => { void readRemote(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void readRemote(); });
render();
void readRemote();
// readRemote skips checks while a read or save is already in progress.
const syncInterval = setInterval(() => { void readRemote(); }, 5000);

const unregisterGameTools = registerGameTools(document.modelContext, () => ({
  ready: ready && !saving, revision, board: structuredClone(board), turn,
  moveCount: history.length, result: result ? { ...result } : null,
  mode: playMode, playerSide: playMode === 'separate' ? playerSide : null,
}), async ({ from, to, expectedRevision }) => {
  if (!ready || saving) throw new Error('棋局正在同步，请稍后重试。');
  if (!canPlayTurn()) throw new Error(waitingMessage());
  if (expectedRevision !== revision) throw new Error('棋局版本已更新，请先读取最新局面。');
  if (result || board[from]?.side !== turn || !legalMoves(board, from).includes(to)) throw new Error('这步棋不符合规则。');
  const saved = await submitAction({ type: 'move', from, to }, expectedRevision);
  if (!saved?.success) throw new Error('落子未获确认，请重新读取棋局。');
  return saved;
});
window.addEventListener('pagehide', event => {
  if (!event.persisted) { clearInterval(syncInterval); unregisterGameTools(); }
});
