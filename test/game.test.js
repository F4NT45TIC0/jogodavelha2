const assert = require('assert');
const { applyMove, createGameState } = require('../src/game');

function makeRoom() {
  const room = createGameState('TEST1');
  room.players.X = { symbol: 'X', nickname: 'Ana', connected: true };
  room.players.O = { symbol: 'O', nickname: 'Bia', connected: true };
  room.status = 'playing';
  return room;
}

{
  const room = makeRoom();
  const result = applyMove(room, 'X', 4, 2);

  assert.equal(result.ok, true);
  assert.equal(room.miniBoards[4][2], 'X');
  assert.equal(room.currentPlayer, 'O');
  assert.equal(room.nextBoardIndex, 2);
}

{
  const room = makeRoom();
  applyMove(room, 'X', 4, 2);
  const result = applyMove(room, 'O', 0, 0);

  assert.equal(result.ok, false);
  assert.match(result.reason, /destacado/);
}

{
  const room = makeRoom();
  room.currentPlayer = 'O';
  room.nextBoardIndex = 5;
  room.mainBoard[5] = 'X';

  const result = applyMove(room, 'O', 0, 0);

  assert.equal(result.ok, true);
  assert.equal(room.miniBoards[0][0], 'O');
}

{
  const room = makeRoom();
  room.miniBoards[0][0] = 'X';
  room.miniBoards[0][1] = 'X';

  const result = applyMove(room, 'X', 0, 2);

  assert.equal(result.ok, true);
  assert.equal(room.mainBoard[0], 'X');
}

{
  const room = makeRoom();
  room.mainBoard[0] = 'X';
  room.mainBoard[1] = 'X';
  room.miniBoards[2][0] = 'X';
  room.miniBoards[2][1] = 'X';

  const result = applyMove(room, 'X', 2, 2);

  assert.equal(result.ok, true);
  assert.equal(room.mainBoard[2], 'X');
  assert.equal(room.winner, 'X');
  assert.equal(room.status, 'finished');
}

console.log('Regras do jogo validadas.');
