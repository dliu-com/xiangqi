import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, pseudoMoves, legalMoves, allLegalMoves, applyMove, isInCheck, positionStatus } from '../src/engine.js';
const piece = (side, type) => ({ side, type });
const at = (r, c) => r * 9 + c;
const empty = () => Array(90).fill(null);

test('standard opening has 32 pieces and 44 legal moves for each side', () => {
  const board = initialBoard();
  assert.equal(board.filter(Boolean).length, 32);
  assert.equal(allLegalMoves(board, 'red').length, 44);
  assert.equal(allLegalMoves(board, 'black').length, 44);
  assert.equal(isInCheck(board, 'red'), false);
  const replies = allLegalMoves(board, 'red').reduce((n, m) => n + allLegalMoves(applyMove(board, m.from, m.to), 'black').length, 0);
  assert.equal(replies, 1920);
});

test('horse legs block only their corresponding two destinations', () => {
  const board = empty(); board[40] = piece('red', 'horse');
  assert.equal(pseudoMoves(board, 40).length, 8);
  board[31] = piece('black', 'soldier');
  const moves = pseudoMoves(board, 40);
  assert.equal(moves.length, 6);
  assert(!moves.includes(21)); assert(!moves.includes(23));
  assert(moves.includes(59));
});

test('elephants cannot cross the river or pass a blocked eye', () => {
  const board = empty(); board[49] = piece('red', 'elephant');
  assert.deepEqual(pseudoMoves(board, 49).sort(), [65, 69]);
  board[59] = piece('black', 'soldier');
  assert.deepEqual(pseudoMoves(board, 49), [65]);
});

test('cannon requires exactly one screen to capture', () => {
  const board = empty(); board[40] = piece('red', 'cannon'); board[4] = piece('black', 'chariot');
  assert(!pseudoMoves(board, 40).includes(4));
  board[22] = piece('red', 'soldier');
  assert(pseudoMoves(board, 40).includes(4));
  assert(!pseudoMoves(board, 40).includes(13));
  board[13] = piece('black', 'soldier');
  assert(!pseudoMoves(board, 40).includes(4));
  assert(pseudoMoves(board, 40).includes(13));
});

test('soldiers gain sideways moves only after crossing and never move backward', () => {
  const board = empty(); board[49] = piece('red', 'soldier');
  assert.deepEqual(pseudoMoves(board, 49), [40]);
  board[49] = null; board[40] = piece('red', 'soldier');
  assert.deepEqual(pseudoMoves(board, 40).sort(), [31, 39, 41]);
  board[40] = null; board[49] = piece('black', 'soldier');
  assert.deepEqual(pseudoMoves(board, 49).sort(), [48, 50, 58]);
});

test('advisors and generals stay inside the palace', () => {
  const board = empty(); board[76] = piece('red', 'advisor');
  assert.deepEqual(pseudoMoves(board, 76).sort(), [66, 68, 84, 86]);
  board[76] = piece('red', 'general');
  assert.deepEqual(pseudoMoves(board, 76).sort(), [67, 75, 77, 85]);
  board[76] = null; board[67] = piece('red', 'general');
  assert(!pseudoMoves(board, 67).includes(58));
});

test('moving the last blocker off the generals file is illegal', () => {
  const board = empty(); board[4] = piece('black', 'general'); board[85] = piece('red', 'general'); board[49] = piece('red', 'chariot');
  assert(pseudoMoves(board, 49).includes(48));
  assert(!legalMoves(board, 49).includes(48));
  assert(legalMoves(board, 49).includes(40));
  assert(isInCheck(applyMove(board, 49, 48), 'red'));
});

test('pinned pieces cannot expose their general to a chariot', () => {
  const board = empty(); board[3] = piece('black', 'general'); board[85] = piece('red', 'general'); board[13] = piece('black', 'chariot'); board[76] = piece('red', 'chariot');
  assert(!legalMoves(board, 76).includes(75));
  assert(legalMoves(board, 76).includes(13));
});

test('checkmate and stalemate both lose in Xiangqi', () => {
  const board = empty(); board[4] = piece('black', 'general'); board[86] = piece('red', 'general');
  board[at(1, 0)] = piece('red', 'chariot');
  board[at(2, 3)] = piece('red', 'chariot');
  board[at(2, 5)] = piece('red', 'chariot');
  assert.deepEqual(positionStatus(board, 'black'), { check: false, winner: 'red', reason: 'stalemate' });
  board[at(2, 4)] = piece('red', 'chariot');
  assert.deepEqual(positionStatus(board, 'black'), { check: true, winner: 'red', reason: 'checkmate' });
});

test('applying a capture preserves the previous position for other consumers', () => {
  const board = initialBoard(), snapshot = structuredClone(board);
  const next = applyMove(board, 64, 1);
  assert.equal(next[1].side, 'red'); assert.equal(next[64], null);
  assert.deepEqual(board, snapshot);
});
