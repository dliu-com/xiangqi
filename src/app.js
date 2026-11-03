import { registerGameTools } from './agent-tools.js';
import { initialBoard, legalMoves, positionStatus, otherSide, coordinate, GLYPHS, NAMES, RULES } from './engine.js';
import { t, sideName, pieceName, RULES_EN, translateError, LANGUAGE_EVENT } from './i18n.js';
const $ = id => document.getElementById(id);
let board = initialBoard(), turn = 'red', history = [], result = null;
let selected = null, destinations = [], flipped = false, cursor = 58;
let status = positionStatus(board, turn), revision = -1;
let saving = false, ready = false, activeRead = null, pendingAction = null;
const squares = [];
let boardFullscreen = false, fullscreenBusy = false;
let syncText = () => t('正在载入棋局…', 'Loading the game…'), syncError = false;
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
function renderPieceRules() {
  $('piece-rules').innerHTML = Object.keys(NAMES).map(type => `<div class="rule-row"><div class="rule-glyphs" lang="zh">${GLYPHS.red[type]} ${GLYPHS.black[type]}</div><div><h3>${pieceName(type)}</h3><p>${t(RULES[type], RULES_EN[type])}</p></div></div>`).join('');
}
renderPieceRules();

function announce(message) { $('announcement').textContent = message; }
const syncedText = () => t('已同步 · 棋局自动保存', 'Synced · saved automatically');
// The sync line keeps a function, so a language change can redraw the current message.
function setSync(text, error = false) {
  syncText = text; syncError = error;
  $('sync-status').textContent = text();
  $('sync-status').classList.toggle('sync-error', error);
  $('sync-retry').hidden = !error;
  renderFullscreenStatus();
}
function renderFullscreenStatus() {
  const statusLine = $('fullscreen-status');
  if (!statusLine) return;
  const turnText = result ? result.winner ? t(`${sideName(result.winner)}获胜`, `${sideName(result.winner)} wins`) : t('双方和棋', 'Draw') : t(`轮到${sideName(turn)}${status.check ? ' · 将军！' : ''}`, `${sideName(turn)} to move${status.check ? ' · Check!' : ''}`);
  const message = `${turnText} · ${$('sync-status').textContent}`;
  if (statusLine.textContent !== message) statusLine.textContent = message;
}
function setBoardFullscreen(enabled) {
  boardFullscreen = enabled;
  document.documentElement.classList.toggle('board-fullscreen', enabled);
  if ($('fullscreen-button')) {
    $('fullscreen-button').textContent = enabled ? t('退出全屏', 'Exit full screen') : t('全屏棋盘', 'Full-screen board');
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
  } catch { announce(t('请使用浏览器的退出全屏按钮，或按 Esc。', 'Use the browser’s exit full-screen button, or press Esc.')); }
  finally { fullscreenBusy = false; $('fullscreen-button').disabled = false; }
}
function canPlayTurn() { return playMode === 'shared' || turn === playerSide; }
function waitingMessage() { return t(`你执${sideName(playerSide)}，请等待${sideName(turn)}落子。`, `You play ${sideName(playerSide)}. Waiting for ${sideName(turn)} to move.`); }
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
  const help = separate
    ? t(`你执${sideName(playerSide)}，己方在下方。${result ? '本局已结束。' : canPlayTurn() ? '轮到你落子。' : `等待${sideName(turn)}落子。`}`,
      `You play ${sideName(playerSide)}, at the bottom. ${result ? 'The game is over.' : canPlayTurn() ? 'Your move.' : `Waiting for ${sideName(turn)}.`}`)
    : t('面对面对弈：双方棋子分别朝向各自玩家。', 'Face to face: each side’s pieces face their own player.');
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
// Everything drawn with innerHTML comes from these fields, so only known sides and piece types are accepted.
const validPiece = piece => piece === null || (typeof piece === 'object' && Object.hasOwn(GLYPHS, piece.side) && Object.hasOwn(NAMES, piece.type));
const validPoint = index => Number.isInteger(index) && index >= 0 && index < 90;
const validMove = move => move && validPoint(move.from) && validPoint(move.to) && move.piece && validPiece(move.piece) && validPiece(move.captured ?? null);
function acceptState(state) {
  if (!state || !Number.isSafeInteger(state.revision) || !Array.isArray(state.board) || state.board.length !== 90 || !state.board.every(validPiece)
    || !Array.isArray(state.history) || !state.history.every(validMove) || !['red', 'black'].includes(state.turn)
    || (state.result != null && (typeof state.result !== 'object' || (state.result.winner != null && !Object.hasOwn(GLYPHS, state.result.winner))))) throw new Error('Invalid game data');
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
  if (!response.ok) throw new Error(`Game read failed (${response.status})`);
  const data = await response.json();
  return data.state;
}
function showUpdatedGame() {
  setSync(() => t('棋局已更新，请重新操作。', 'The game changed. Please try again.'));
  announce(t('其他设备已更新棋局，请根据最新局面重新操作。', 'Another device changed the game. Play again from the latest position.'));
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
    if (!saving) setSync(syncedText);
  } catch {
    if (activeRead === controller && !saving) { ready = false; setSync(() => t('同步中断，请点击重试。', 'Sync interrupted. Press Retry.'), true); }
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
      setSync(() => t('正在确认最新棋局…', 'Checking the latest position…'));
      const state = await fetchRemoteState(AbortSignal.timeout(20000));
      acceptState(state);
      if (state.revision !== expectedRevision) {
        showUpdatedGame();
        return { success: false, revision, turn, moveCount: history.length, result };
      }
    }
    setSync(() => t('正在保存棋局…', 'Saving…'));
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
      const failed = () => translateError(data.message) || t('操作未完成，请重试。', 'That did not go through. Please try again.');
      setSync(failed, true); announce(failed());
    } else {
      acceptState(data.state); ready = true; succeeded = true; setSync(syncedText);
      announce(result
        ? result.winner ? t(`${sideName(result.winner)}获胜。`, `${sideName(result.winner)} wins.`) : t('双方和棋。', 'Draw.')
        : t(`${action.type === 'undo' ? '已撤回上一步。' : action.type === 'new' ? '新局开始。' : '落子成功。'}轮到${sideName(turn)}。${status.check ? '将军！请保护将帅。' : ''}`,
          `${action.type === 'undo' ? 'Last move undone.' : action.type === 'new' ? 'New game started.' : 'Move played.'} ${sideName(turn)} to move.${status.check ? ' Check! Protect the general.' : ''}`));
    }
  } catch {
    ready = false;
    if (writeStarted) {
      uncertain = true; setSync(() => t('正在确认保存结果，请稍候…', 'Confirming whether it was saved…'), true);
    } else {
      const message = () => t('无法确认最新棋局，本次操作未保存。请重试。', 'Could not check the latest position, so nothing was saved. Please try again.');
      setSync(message, true); announce(message());
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
  if (result) { announce(t('棋局已结束，请开始新局或悔棋。', 'The game is over. Start a new game or undo.')); return; }
  if (!canPlayTurn()) { announce(waitingMessage()); return; }
  if (selected !== null && destinations.includes(index)) { void submitAction({ type: 'move', from: selected, to: index }); return; }
  if (board[index]?.side === turn) {
    if (selected === index) { selected = null; destinations = []; }
    else { selected = index; destinations = legalMoves(board, index); announce(t(`已选择${sideName(turn)}${pieceName(board[index].type)}，位于 ${coordinate(index)}。共有 ${destinations.length} 个可落子的位置。`, `Selected ${sideName(turn)} ${pieceName(board[index].type)} on ${coordinate(index)}. ${destinations.length} legal ${destinations.length === 1 ? 'point' : 'points'}.`)); }
    render(); return;
  }
  announce(selected !== null ? t('这步棋不符合规则。请点击标记位置，或选择其他棋子。', 'That move is not legal. Tap a marked point, or choose another piece.') : t(`轮到${sideName(turn)}，请选择己方棋子。`, `${sideName(turn)} to move. Choose one of your pieces.`));
}
function playerMarkup(side) {
  const captures = history.filter(move => move.piece.side === side && move.captured).map(move => `<span class="captured-piece ${move.captured.side}" lang="zh" title="${t(`已吃${sideName(move.captured.side)}${pieceName(move.captured.type)}`, `Captured ${sideName(move.captured.side)} ${pieceName(move.captured.type)}`)}">${GLYPHS[move.captured.side][move.captured.type]}</span>`).join('');
  const who = playMode === 'separate' ? side === playerSide ? t(' · 我', ' · You') : t(' · 对方', ' · Opponent') : '';
  return `<div class="player-id"><span class="avatar ${side}" lang="zh">${GLYPHS[side].general}</span><span class="player-name">${sideName(side)}${who}</span>${turn === side && !result ? `<span class="turn-tag">${t('行棋中', 'To move')}</span>` : ''}</div><div class="captures" aria-label="${t(`${sideName(side)}已吃棋子`, `Pieces captured by ${sideName(side)}`)}">${captures}</div>`;
}
function renderGameAlert() {
  const alert = $('game-alert');
  // An older cached HTML page can briefly coexist with a newer script during publishing.
  if (!alert) return;
  let title = '', detail = '', symbol = '';
  if (result) {
    symbol = result.winner ? '终' : '和';
    if (result.winner) {
      const loser = sideName(otherSide(result.winner)), winner = sideName(result.winner);
      const reason = result.reason === 'checkmate' ? t('绝杀', 'Checkmate') : result.reason === 'stalemate' ? t('困毙', 'Stalemate') : t('认输', 'Resignation');
      title = t(`${reason} · ${loser}已输`, `${reason} · ${loser} loses`);
      detail = t(`${winner}获胜。${result.reason === 'checkmate' ? `${loser}被将死，已无合法走法。` : ''}本局结束，可悔棋或再开一局。`,
        `${winner} wins. ${result.reason === 'checkmate' ? `${loser} is checkmated and has no legal move. ` : ''}The game is over: undo, or start a new game.`);
    } else {
      title = t('本局和棋', 'Draw'); detail = t('双方握手言和，可以再开一局。', 'The players agreed a draw. Start another game whenever you like.');
    }
  } else if (status.check) {
    symbol = '将'; title = t('将军！', 'Check!');
    detail = t(`${sideName(turn)}被将军，请先解除将军，保护${turn === 'red' ? '帅' : '将'}。`, `${sideName(turn)} is in check. Get out of check to protect the general.`);
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
    button.innerHTML = piece ? `<span class="piece ${piece.side}" lang="zh" aria-hidden="true"><span class="piece-symbol">${GLYPHS[piece.side][piece.type]}</span></span>${check ? `<span class="check-badge" aria-hidden="true">${result?.reason === 'checkmate' ? t('将死', 'Mate') : t('将军', 'Check')}</span>` : ''}` : '';
    button.setAttribute('aria-label', t(`${coordinate(index)}，${piece ? `${sideName(piece.side)}${pieceName(piece.type)}` : '空位'}${legal ? '，可落子' : ''}${check ? '，被将军' : ''}`,
      `${coordinate(index)}, ${piece ? `${sideName(piece.side)} ${pieceName(piece.type)}` : 'empty'}${legal ? ', legal move' : ''}${check ? ', in check' : ''}`));
    button.setAttribute('aria-pressed', String(selected === index));
    button.title = piece ? t(`${sideName(piece.side)}${pieceName(piece.type)}`, `${sideName(piece.side)} ${pieceName(piece.type)}`) + ` · ${coordinate(index)}` : coordinate(index);
    button.tabIndex = cursor === index ? 0 : -1;
  });
  document.querySelectorAll('.file-label').forEach((label, c) => { label.textContent = 'abcdefghi'[flipped ? 8 - c : c]; });
  document.querySelectorAll('.rank-label').forEach((label, r) => { label.textContent = flipped ? r : 9 - r; });
  $('top-player').innerHTML = playerMarkup(flipped ? 'red' : 'black');
  $('bottom-player').innerHTML = playerMarkup(flipped ? 'black' : 'red');
  const activeSide = result?.winner || turn;
  $('turn-icon').className = `turn-piece ${activeSide}`;
  $('turn-icon').textContent = result && !result.winner ? '和' : GLYPHS[activeSide].general;
  $('turn-title').textContent = result ? result.winner ? t(`${sideName(result.winner)}获胜`, `${sideName(result.winner)} wins`) : t('握手言和', 'Draw agreed') : t(`轮到${sideName(turn)}`, `${sideName(turn)} to move`);
  $('turn-kicker').textContent = result ? t('本局结束', 'Game over') : status.check ? t('将军 · 请应将', 'Check · respond') : history.length ? t(`第 ${Math.floor(history.length / 2) + 1} 回合`, `Move ${Math.floor(history.length / 2) + 1}`) : t('红先黑后', 'Red moves first');
  const loser = result?.winner ? sideName(otherSide(result.winner)) : '';
  $('status-detail').textContent = result
    ? result.reason === 'checkmate' ? t(`绝杀！${loser}已输，将帅被将死，已无合法走法。`, `Checkmate! ${loser} loses: the general is mated and has no legal move.`)
      : result.reason === 'stalemate' ? t(`${loser}已输：困毙，无合法走法。`, `${loser} loses: stalemate, no legal move.`)
      : result.reason === 'resignation' ? t(`${loser}认输，本局结束。`, `${loser} resigned. The game is over.`)
      : t('双方同意和棋。不妨交换红黑，再来一局。', 'Draw agreed. Why not swap colours and play again?')
    : status.check ? t(`${sideName(turn)}被将军！请选择能够解除将军的走法。`, `${sideName(turn)} is in check! Choose a move that gets out of check.`) : t('点击己方棋子，查看可落子的位置。', 'Tap one of your pieces to see where it can go.');
  if (!result && !canPlayTurn()) $('status-detail').textContent = status.check ? t(`${sideName(turn)}被将军，等待对方应将。`, `${sideName(turn)} is in check. Waiting for the reply.`) : waitingMessage();
  $('move-count').textContent = t(`共 ${history.length} 步`, `${history.length} ${history.length === 1 ? 'move' : 'moves'}`);
  renderViewSettings(); renderGameAlert(); renderHistory(); renderFullscreenStatus(); updateControls();
}
function renderHistory() {
  if (!history.length) {
    $('history').innerHTML = `<div class="history-empty"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 6h20v20H6zM6 13h20M6 20h20M13 6v20M20 6v20"/></svg><p>${t('棋局将启，静候落子。', 'The game is about to begin.')}</p><small>${t('每一步，都会记录在这里。', 'Every move is recorded here.')}</small></div>`; return;
  }
  let html = '';
  for (let i = 0; i < history.length; i += 2) {
    html += `<div class="history-row"><span class="move-number">${i / 2 + 1}.</span>`;
    for (const index of [i, i + 1]) {
      const move = history[index];
      if (!move) { html += '<span></span>'; continue; }
      const title = t(`${sideName(move.piece.side)}${pieceName(move.piece.type)}，${coordinate(move.from)} 至 ${coordinate(move.to)}${move.captured ? `，吃${pieceName(move.captured.type)}` : ''}${move.check ? '，将军' : ''}`,
        `${sideName(move.piece.side)} ${pieceName(move.piece.type)}, ${coordinate(move.from)} to ${coordinate(move.to)}${move.captured ? `, takes ${pieceName(move.captured.type)}` : ''}${move.check ? ', check' : ''}`);
      html += `<span class="move-entry ${index === history.length - 1 ? 'latest' : ''}" title="${title}"><span class="move-glyph ${move.piece.side}" lang="zh">${GLYPHS[move.piece.side][move.piece.type]}</span><span>${coordinate(move.from)}${move.captured ? '×' : '–'}${coordinate(move.to)}</span>${move.check ? `<span class="move-mark" aria-label="${t('将军', 'Check')}">+</span>` : ''}</span>`;
    }
    html += '</div>';
  }
  $('history').innerHTML = html;
}
function handleBoardKey(event, index) {
  if (event.key === 'Escape') { event.preventDefault(); selected = null; destinations = []; render(); announce(t('已取消选择。', 'Selection cancelled.')); return; }
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
  announce(t(`已交换上下方，${sideName(flipped ? 'black' : 'red')}在下方。`, `Board flipped. ${sideName(flipped ? 'black' : 'red')} is at the bottom.`));
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
$('new-game-button').addEventListener('click', () => confirmAction(t('重新开始一局？', 'Start a new game?'), t('当前棋局和棋谱将被清空，所有设备都会同步更新。新局由红方先行。', 'The current game and its moves will be cleared on every device. Red moves first in the new game.'), t('开始新局', 'Start new game'), 'new'));
$('draw-button').addEventListener('click', () => confirmAction(t('双方同意和棋？', 'Agree a draw?'), t('请与对手确认。双方同意后，本局以和棋结束。', 'Check with your opponent first. Once you both agree, the game ends in a draw.'), t('确认和棋', 'Agree draw'), 'draw'));
$('resign-button').addEventListener('click', () => confirmAction(t(`${sideName(turn)}确认认输？`, `Does ${sideName(turn)} resign?`), t(`认输后，本局由${sideName(otherSide(turn))}获胜。`, `${sideName(otherSide(turn))} wins if you resign.`), t('确认认输', 'Resign'), 'resign'));
$('sync-retry').addEventListener('click', () => { void readRemote(); });
window.addEventListener('focus', () => { void readRemote(); });
window.addEventListener('online', () => { void readRemote(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void readRemote(); });
window.addEventListener(LANGUAGE_EVENT, () => {
  renderPieceRules(); setBoardFullscreen(boardFullscreen); setSync(syncText, syncError); render();
});
render();
void readRemote();
// readRemote skips checks while a read or save is already in progress.
const syncInterval = setInterval(() => { void readRemote(); }, 5000);

const unregisterGameTools = registerGameTools(document.modelContext, () => ({
  ready: ready && !saving, revision, board: structuredClone(board), turn,
  moveCount: history.length, result: result ? { ...result } : null,
  mode: playMode, playerSide: playMode === 'separate' ? playerSide : null,
}), async ({ from, to, expectedRevision }) => {
  if (!ready || saving) throw new Error(t('棋局正在同步，请稍后重试。', 'The game is syncing. Try again shortly.'));
  if (!canPlayTurn()) throw new Error(waitingMessage());
  if (expectedRevision !== revision) throw new Error(t('棋局版本已更新，请先读取最新局面。', 'The game has changed. Read the latest position first.'));
  if (result || board[from]?.side !== turn || !legalMoves(board, from).includes(to)) throw new Error(t('这步棋不符合规则。', 'That move is not legal.'));
  const saved = await submitAction({ type: 'move', from, to }, expectedRevision);
  if (!saved?.success) throw new Error(t('落子未获确认，请重新读取棋局。', 'The move was not confirmed. Read the game again.'));
  return saved;
});
window.addEventListener('pagehide', event => {
  if (!event.persisted) { clearInterval(syncInterval); unregisterGameTools(); }
});
