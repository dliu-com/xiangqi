import { initialBoard, legalMoves, applyMove, positionStatus, otherSide } from '../src/engine.js';

export class GameError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

export function createState() {
  return { revision: 0, board: initialBoard(), turn: 'red', history: [], result: null, updatedAt: null };
}

// Both the live Lambda and the local preview use this authoritative game logic.
export function transition(current, request) {
  if (!request || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
    throw new GameError('棋局版本无效，请刷新后重试。');
  }
  if (request.expectedRevision !== current.revision) throw new GameError('棋局已更新，已为你同步最新进度。', 409);
  const action = request.action;
  if (!action || typeof action.type !== 'string') throw new GameError('操作无效。');
  let next = { ...current, board: current.board.slice(), history: current.history.slice() };

  if (action.type === 'new') {
    next = createState();
  } else if (action.type === 'undo') {
    const move = next.history.pop();
    if (!move) throw new GameError('还没有可以撤回的走棋。');
    next.board[move.from] = move.piece;
    next.board[move.to] = move.captured;
    next.turn = move.piece.side;
    next.result = null;
  } else {
    if (current.result) throw new GameError('棋局已经结束，请开始新局。');
    if (action.type === 'move') {
      const { from, to } = action;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 89 || to < 0 || to > 89) throw new GameError('落点无效。');
      const piece = current.board[from];
      if (!piece || piece.side !== current.turn || !legalMoves(current.board, from).includes(to)) throw new GameError('这步棋不符合规则，请重新选择。');
      if (next.history.length >= 2000) throw new GameError('本局记录已满，请和棋或开始新局。');
      const captured = current.board[to];
      next.board = applyMove(current.board, from, to);
      next.turn = otherSide(current.turn);
      const status = positionStatus(next.board, next.turn);
      next.history.push({ from, to, piece, captured, check: status.check });
      next.result = status.winner ? { winner: status.winner, reason: status.reason } : null;
    } else if (action.type === 'draw') {
      next.result = { winner: null, reason: 'agreement' };
    } else if (action.type === 'resign') {
      next.result = { winner: otherSide(current.turn), reason: 'resignation' };
    } else {
      throw new GameError('不支持的操作。');
    }
  }
  next.revision = current.revision + 1;
  next.updatedAt = new Date().toISOString();
  return next;
}
