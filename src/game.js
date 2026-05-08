const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

function createGameState(roomId) {
  return {
    roomId,
    players: {
      X: null,
      O: null
    },
    currentPlayer: 'X',
    mainBoard: Array(9).fill(null),
    miniBoards: Array.from({ length: 9 }, () => Array(9).fill(null)),
    nextBoardIndex: null,
    winner: null,
    status: 'waiting',
    rematchRequests: {
      X: false,
      O: false
    },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function resetGameState(room) {
  room.currentPlayer = 'X';
  room.mainBoard = Array(9).fill(null);
  room.miniBoards = Array.from({ length: 9 }, () => Array(9).fill(null));
  room.nextBoardIndex = null;
  room.winner = null;
  room.status = room.players.X && room.players.O ? 'playing' : 'waiting';
  room.rematchRequests = {
    X: false,
    O: false
  };
  room.updatedAt = Date.now();
}

function checkWinner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] !== 'D' && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }

  return null;
}

function isFull(board) {
  return board.every(Boolean);
}

function isMiniBoardOpen(room, boardIndex) {
  return Number.isInteger(boardIndex) && boardIndex >= 0 && boardIndex <= 8 && !room.mainBoard[boardIndex];
}

function getAvailableBoards(room) {
  if (
    room.nextBoardIndex !== null &&
    Number.isInteger(room.nextBoardIndex) &&
    isMiniBoardOpen(room, room.nextBoardIndex)
  ) {
    return [room.nextBoardIndex];
  }

  return room.mainBoard
    .map((value, index) => (value ? null : index))
    .filter((index) => index !== null);
}

function validateMove(room, symbol, boardIndex, cellIndex) {
  if (!room) {
    return { ok: false, reason: 'Sala não encontrada.' };
  }

  if (room.status === 'waiting') {
    return { ok: false, reason: 'Aguardando outro jogador entrar na sala.' };
  }

  if (room.status === 'finished' || room.winner) {
    return { ok: false, reason: 'A partida já terminou.' };
  }

  if (symbol !== 'X' && symbol !== 'O') {
    return { ok: false, reason: 'Você precisa estar jogando nesta sala.' };
  }

  if (room.currentPlayer !== symbol) {
    return { ok: false, reason: 'Ainda não é a sua vez.' };
  }

  if (!Number.isInteger(boardIndex) || boardIndex < 0 || boardIndex > 8) {
    return { ok: false, reason: 'Mini-tabuleiro inválido.' };
  }

  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex > 8) {
    return { ok: false, reason: 'Casa inválida.' };
  }

  if (room.mainBoard[boardIndex]) {
    return { ok: false, reason: 'Esse mini-tabuleiro já foi concluído.' };
  }

  const availableBoards = getAvailableBoards(room);
  if (!availableBoards.includes(boardIndex)) {
    return { ok: false, reason: 'Você precisa jogar no mini-tabuleiro destacado.' };
  }

  if (room.miniBoards[boardIndex][cellIndex]) {
    return { ok: false, reason: 'Essa casa já está marcada.' };
  }

  return { ok: true };
}

function applyMove(room, symbol, boardIndex, cellIndex) {
  const validation = validateMove(room, symbol, boardIndex, cellIndex);
  if (!validation.ok) {
    return validation;
  }

  room.miniBoards[boardIndex][cellIndex] = symbol;

  const miniWinner = checkWinner(room.miniBoards[boardIndex]);
  if (miniWinner) {
    room.mainBoard[boardIndex] = miniWinner;
  } else if (isFull(room.miniBoards[boardIndex])) {
    room.mainBoard[boardIndex] = 'D';
  }

  const finalWinner = checkWinner(room.mainBoard);
  if (finalWinner) {
    room.winner = finalWinner;
    room.status = 'finished';
    room.nextBoardIndex = null;
  } else if (isFull(room.mainBoard)) {
    room.winner = 'D';
    room.status = 'finished';
    room.nextBoardIndex = null;
  } else {
    room.currentPlayer = symbol === 'X' ? 'O' : 'X';
    room.nextBoardIndex = room.mainBoard[cellIndex] ? null : cellIndex;
  }

  room.rematchRequests.X = false;
  room.rematchRequests.O = false;
  room.updatedAt = Date.now();

  return { ok: true };
}

function publicRoomState(room) {
  return {
    roomId: room.roomId,
    players: {
      X: publicPlayer(room.players.X, room.rematchRequests.X),
      O: publicPlayer(room.players.O, room.rematchRequests.O)
    },
    currentPlayer: room.currentPlayer,
    mainBoard: room.mainBoard,
    miniBoards: room.miniBoards,
    nextBoardIndex: room.nextBoardIndex,
    availableBoards: getAvailableBoards(room),
    winner: room.winner,
    status: room.status
  };
}

function publicPlayer(player, wantsRematch) {
  if (!player) {
    return null;
  }

  return {
    symbol: player.symbol,
    nickname: player.nickname,
    connected: player.connected,
    wantsRematch
  };
}

module.exports = {
  createGameState,
  resetGameState,
  applyMove,
  getAvailableBoards,
  publicRoomState
};
