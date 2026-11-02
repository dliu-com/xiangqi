export const SIDES = { red: '红方', black: '黑方' };
export const GLYPHS = {
  red: { general: '帅', advisor: '仕', elephant: '相', horse: '马', chariot: '车', cannon: '炮', soldier: '兵' },
  black: { general: '将', advisor: '士', elephant: '象', horse: '马', chariot: '车', cannon: '炮', soldier: '卒' }
};
export const NAMES = { general: '将帅', advisor: '士', elephant: '象', horse: '马', chariot: '车', cannon: '炮', soldier: '兵卒' };
export const RULES = {
  general: '在九宫内，每次沿直线走一格。双方将帅不能在没有棋子阻隔的同一直线上照面。',
  advisor: '每次斜走一格，不能走出九宫。',
  elephant: '斜走两格，俗称“象走田”。不能过河，象眼有棋子时不能通过。',
  horse: '先直走一格，再斜走一格，俗称“马走日”。第一步旁边有棋子时会“蹩马腿”。',
  chariot: '沿横线或竖线行走，步数不限，不能越过其他棋子。',
  cannon: '不吃子时走法同车。吃子时必须隔着一枚棋子，作为“炮架”。',
  soldier: '每次向前走一格。过河后也可向左右走一格，始终不能后退。'
};
export const otherSide = side => side === 'red' ? 'black' : 'red';
export const row = index => Math.floor(index / 9);
export const col = index => index % 9;
export const coordinate = index => `${'abcdefghi'[col(index)]}${9 - row(index)}`;
const inBounds = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;
const inPalace = (r, c, side) => c >= 3 && c <= 5 && (side === 'red' ? r >= 7 && r <= 9 : r >= 0 && r <= 2);

export function initialBoard() {
  const board = Array(90).fill(null);
  const back = ['chariot', 'horse', 'elephant', 'advisor', 'general', 'advisor', 'elephant', 'horse', 'chariot'];
  for (const side of ['black', 'red']) {
    const rank = side === 'black' ? 0 : 9;
    back.forEach((type, c) => { board[rank * 9 + c] = { side, type }; });
    for (const c of [1, 7]) board[(side === 'black' ? 2 : 7) * 9 + c] = { side, type: 'cannon' };
    for (const c of [0, 2, 4, 6, 8]) board[(side === 'black' ? 3 : 6) * 9 + c] = { side, type: 'soldier' };
  }
  return board;
}

export function pseudoMoves(board, from) {
  const piece = board[from];
  if (!piece) return [];
  const r = row(from), c = col(from), moves = [];
  const add = (nr, nc) => {
    if (inBounds(nr, nc) && board[nr * 9 + nc]?.side !== piece.side) moves.push(nr * 9 + nc);
  };
  if (piece.type === 'chariot' || piece.type === 'cannon') {
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let screened = false;
      for (let nr = r + dr, nc = c + dc; inBounds(nr, nc); nr += dr, nc += dc) {
        const target = board[nr * 9 + nc];
        if (piece.type === 'chariot') {
          add(nr, nc);
          if (target) break;
        } else if (!screened) {
          if (target) screened = true;
          else add(nr, nc);
        } else if (target) {
          add(nr, nc);
          break;
        }
      }
    }
  } else if (piece.type === 'horse') {
    for (const [dr, dc] of [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]]) {
      const lr = r + (Math.abs(dr) === 2 ? Math.sign(dr) : 0);
      const lc = c + (Math.abs(dc) === 2 ? Math.sign(dc) : 0);
      if (inBounds(lr, lc) && !board[lr * 9 + lc]) add(r + dr, c + dc);
    }
  } else if (piece.type === 'elephant') {
    for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc) || (piece.side === 'red' ? nr < 5 : nr > 4)) continue;
      if (!board[(r + dr / 2) * 9 + c + dc / 2]) add(nr, nc);
    }
  } else if (piece.type === 'advisor') {
    for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      if (inPalace(r + dr, c + dc, piece.side)) add(r + dr, c + dc);
    }
  } else if (piece.type === 'general') {
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (inPalace(r + dr, c + dc, piece.side)) add(r + dr, c + dc);
    }
    // The flying-general rule also makes exposing an open file illegal.
    for (const dr of [-1, 1]) {
      for (let nr = r + dr; inBounds(nr, c); nr += dr) {
        const target = board[nr * 9 + c];
        if (!target) continue;
        if (target.type === 'general' && target.side !== piece.side) add(nr, c);
        break;
      }
    }
  } else if (piece.type === 'soldier') {
    add(r + (piece.side === 'red' ? -1 : 1), c);
    if (piece.side === 'red' ? r <= 4 : r >= 5) {
      add(r, c - 1);
      add(r, c + 1);
    }
  }
  return moves;
}

export function applyMove(board, from, to) {
  const next = board.slice();
  next[to] = next[from];
  next[from] = null;
  return next;
}

export function isInCheck(board, side) {
  const general = board.findIndex(p => p?.side === side && p.type === 'general');
  if (general < 0) return true;
  for (let from = 0; from < 90; from++) {
    if (board[from] && board[from].side !== side && pseudoMoves(board, from).includes(general)) return true;
  }
  return false;
}

export function legalMoves(board, from) {
  const piece = board[from];
  if (!piece) return [];
  return pseudoMoves(board, from).filter(to => !isInCheck(applyMove(board, from, to), piece.side));
}

export function allLegalMoves(board, side) {
  const moves = [];
  for (let from = 0; from < 90; from++) {
    if (board[from]?.side === side) {
      for (const to of legalMoves(board, from)) moves.push({ from, to });
    }
  }
  return moves;
}

export function positionStatus(board, side) {
  const check = isInCheck(board, side);
  const canMove = allLegalMoves(board, side).length > 0;
  return { check, winner: canMove ? null : otherSide(side), reason: canMove ? null : check ? 'checkmate' : 'stalemate' };
}

export function positionKey(board, side) {
  return side + ':' + board.map(p => p ? p.side[0] + p.type : '.').join(',');
}
