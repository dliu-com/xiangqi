import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, transition } from '../backend/game-service.js';
const action = (state, type, extra = {}) => transition(state, { expectedRevision: state.revision, action: { type, ...extra } });

test('saved state round-trips between devices and undo restores a captured piece', () => {
  const initial = createState();
  const after = action(initial, 'move', { from: 64, to: 1 });
  assert.equal(after.history.length, 1); assert.equal(after.turn, 'black');
  assert.equal(after.history[0].captured.type, 'horse');
  const anotherDevice = JSON.parse(JSON.stringify(after));
  const undone = action(anotherDevice, 'undo');
  assert.deepEqual(undone.board, initial.board); assert.equal(undone.turn, 'red');
  assert.equal(undone.revision, 2); assert.equal(undone.history.length, 0);
  assert.equal(initial.revision, 0); assert.equal(initial.history.length, 0);
});

test('out-of-date devices cannot overwrite a newer move', () => {
  const state = action(createState(), 'move', { from: 54, to: 45 });
  assert.throws(() => transition(state, { expectedRevision: 0, action: { type: 'new' } }), error => error.statusCode === 409);
});

test('invalid moves, wrong turns and malformed actions are rejected', () => {
  const state = createState();
  for (const extra of [{ from: 27, to: 36 }, { from: 54, to: 55 }, { from: -1, to: 20 }, { from: '54', to: 45 }]) {
    assert.throws(() => action(state, 'move', extra));
  }
  assert.throws(() => transition(state, null));
  assert.throws(() => action(state, 'unknown'));
  assert.throws(() => action(state, 'undo'));
});

test('new games keep revision monotonic and clear the shared position', () => {
  const moved = action(createState(), 'move', { from: 54, to: 45 });
  const next = action(moved, 'new');
  assert.deepEqual(next.board, createState().board);
  assert.equal(next.revision, 2); assert.equal(next.history.length, 0); assert.equal(next.result, null);
});

test('draw and resignation persist, prevent further moves and allow a new game', () => {
  const state = action(createState(), 'move', { from: 54, to: 45 });
  const draw = action(state, 'draw');
  assert.equal(draw.result.reason, 'agreement');
  assert.throws(() => action(draw, 'move', { from: 27, to: 36 }));
  assert.equal(action(draw, 'new').result, null);
  const resigned = action(state, 'resign');
  assert.deepEqual(resigned.result, { winner: 'red', reason: 'resignation' });
  assert.equal(action(resigned, 'undo').result, null);
});
