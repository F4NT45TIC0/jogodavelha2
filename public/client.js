const socketUrl = window.JDV2_CONFIG?.socketUrl || window.location.origin;
const socketOptions = socketUrl === window.location.origin ? {} : { transports: ['websocket'] };
const socket = io(socketUrl, socketOptions);

const STORAGE_KEY = 'jogo-da-velha-2:sessions';
const ACTIVE_ROOM_KEY = 'jogo-da-velha-2:active-room';
const BOARD_NAMES = [
  'superior esquerdo',
  'superior central',
  'superior direito',
  'meio esquerdo',
  'centro',
  'meio direito',
  'inferior esquerdo',
  'inferior central',
  'inferior direito'
];

const lobbyView = document.querySelector('#lobbyView');
const gameView = document.querySelector('#gameView');
const lobbyForm = document.querySelector('#lobbyForm');
const nicknameInput = document.querySelector('#nicknameInput');
const roomInput = document.querySelector('#roomInput');
const createRoomButton = document.querySelector('#createRoomButton');
const lobbyError = document.querySelector('#lobbyError');
const roomCode = document.querySelector('#roomCode');
const copyLinkButton = document.querySelector('#copyLinkButton');
const backButton = document.querySelector('#backButton');
const playerX = document.querySelector('#playerX');
const playerO = document.querySelector('#playerO');
const statusText = document.querySelector('#statusText');
const targetText = document.querySelector('#targetText');
const mainBoard = document.querySelector('#mainBoard');
const gameError = document.querySelector('#gameError');
const rematchButton = document.querySelector('#rematchButton');
const newRoomButton = document.querySelector('#newRoomButton');

let state = null;
let session = null;
let messageTimer = null;

init();

function init() {
  const urlRoom = getRoomFromUrl();
  const activeRoom = urlRoom || localStorage.getItem(ACTIVE_ROOM_KEY);
  const savedSession = activeRoom ? getSavedSession(activeRoom) : null;

  if (urlRoom) {
    roomInput.value = urlRoom;
  }

  if (savedSession) {
    nicknameInput.value = savedSession.nickname || '';
    session = savedSession;
  }

  if (urlRoom && savedSession) {
    joinRoom(urlRoom, savedSession.nickname, savedSession.token, true);
  }

  lobbyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    joinRoom(roomInput.value, nicknameInput.value);
  });

  createRoomButton.addEventListener('click', () => {
    createRoom();
  });

  roomInput.addEventListener('input', () => {
    roomInput.value = normalizeRoom(roomInput.value);
  });

  mainBoard.addEventListener('click', (event) => {
    const button = event.target.closest('.cell');
    if (!button) {
      return;
    }

    playMove(Number(button.dataset.board), Number(button.dataset.cell));
  });

  copyLinkButton.addEventListener('click', async () => {
    if (!state) {
      return;
    }

    const link = makeRoomUrl(state.roomId);

    try {
      await navigator.clipboard.writeText(link);
      showGameMessage('Link copiado.', true);
    } catch {
      showGameMessage(link, true);
    }
  });

  backButton.addEventListener('click', () => {
    showLobby();
  });

  rematchButton.addEventListener('click', () => {
    socket.emit('game:rematch');
  });

  newRoomButton.addEventListener('click', () => {
    createRoom();
  });

  socket.on('connect', () => {
    if (session && session.roomId && session.token) {
      joinRoom(session.roomId, session.nickname, session.token, true);
    }
  });

  socket.on('connect_error', () => {
    if (gameView.hidden) {
      showLobbyError('Não foi possível conectar ao servidor em tempo real.');
    } else {
      showGameMessage('Servidor em tempo real indisponível.');
    }
  });

  socket.on('room:update', (room) => {
    if (!session || room.roomId !== session.roomId) {
      return;
    }

    state = room;
    showGame();
    render();
  });

  socket.on('room:closed', (payload = {}) => {
    const closedRoomId = payload.roomId || state?.roomId || session?.roomId;

    if (closedRoomId) {
      clearSavedSession(closedRoomId);
    }

    state = null;
    session = null;
    clearRoomUrl();
    showLobby();
    showLobbyError(payload.reason || 'Essa sala foi encerrada automaticamente.');
  });

  socket.on('game:error', (message) => {
    showGameMessage(message);
  });
}

function createRoom() {
  const nickname = nicknameInput.value.trim();
  if (!nickname) {
    showLobbyError('Informe um apelido para criar a sala.');
    return;
  }

  socket.emit('room:create', { nickname }, (response) => {
    handleRoomResponse(response);
  });
}

function joinRoom(roomIdInput, nicknameInputValue, tokenInput, silent = false) {
  const roomId = normalizeRoom(roomIdInput);
  const saved = getSavedSession(roomId);
  const token = tokenInput || saved?.token || null;
  const nickname = (nicknameInputValue || saved?.nickname || '').trim();

  if (!roomId) {
    if (!silent) {
      showLobbyError('Informe o código da sala.');
    }
    return;
  }

  if (!nickname && !token) {
    if (!silent) {
      showLobbyError('Informe um apelido para entrar na sala.');
    }
    return;
  }

  socket.emit('room:join', { roomId, nickname, token }, (response) => {
    handleRoomResponse(response, silent);
  });
}

function handleRoomResponse(response, silent = false) {
  if (!response || !response.ok) {
    if (silent && session?.roomId) {
      clearSavedSession(session.roomId);
      session = null;
      state = null;
      clearRoomUrl();
      showLobby();
      showLobbyError(response?.error || 'Essa sala não está mais disponível.');
    } else if (!silent) {
      showLobbyError(response?.error || 'Não foi possível entrar na sala.');
    }
    return;
  }

  state = response.room;
  session = {
    roomId: response.room.roomId,
    symbol: response.player.symbol,
    token: response.player.token,
    nickname: response.player.nickname
  };

  saveSession(session);
  updateUrl(session.roomId);
  nicknameInput.value = session.nickname;
  roomInput.value = session.roomId;
  showGame();
  render();
}

function playMove(boardIndex, cellIndex) {
  const validation = validateLocalMove(boardIndex, cellIndex);
  if (!validation.ok) {
    showGameMessage(validation.reason);
    return;
  }

  socket.emit('game:move', { boardIndex, cellIndex });
}

function validateLocalMove(boardIndex, cellIndex) {
  if (!state || !session) {
    return { ok: false, reason: 'Entre em uma sala para jogar.' };
  }

  if (state.status === 'waiting') {
    return { ok: false, reason: 'Aguardando outro jogador entrar.' };
  }

  if (state.status === 'finished') {
    return { ok: false, reason: 'A partida já terminou.' };
  }

  if (state.currentPlayer !== session.symbol) {
    return { ok: false, reason: 'Aguarde sua vez.' };
  }

  if (state.mainBoard[boardIndex]) {
    return { ok: false, reason: 'Esse mini-tabuleiro já foi concluído.' };
  }

  if (!state.availableBoards.includes(boardIndex)) {
    return { ok: false, reason: 'Você precisa jogar no mini-tabuleiro destacado.' };
  }

  if (state.miniBoards[boardIndex][cellIndex]) {
    return { ok: false, reason: 'Essa casa já está marcada.' };
  }

  return { ok: true };
}

function render() {
  if (!state) {
    return;
  }

  roomCode.textContent = state.roomId;
  renderPlayers();
  renderStatus();
  renderBoard();
  renderActions();
}

function renderPlayers() {
  renderPlayer(playerX, state.players.X, 'X');
  renderPlayer(playerO, state.players.O, 'O');
}

function renderPlayer(element, player, symbol) {
  const name = element.querySelector('strong');
  const meta = element.querySelector('small');
  const isCurrent = state.status === 'playing' && state.currentPlayer === symbol;

  element.classList.toggle('active', isCurrent);

  if (!player) {
    name.textContent = 'Aguardando';
    meta.textContent = symbol === session?.symbol ? 'Você' : 'vaga';
    return;
  }

  name.textContent = player.nickname;
  meta.textContent = [
    symbol === session?.symbol ? 'Você' : 'Adversário',
    player.connected ? 'online' : 'offline',
    player.wantsRematch ? 'revanche' : ''
  ]
    .filter(Boolean)
    .join(' - ');
}

function renderStatus() {
  const mySymbol = session?.symbol;
  const currentName = state.players[state.currentPlayer]?.nickname || state.currentPlayer;

  if (state.status === 'waiting') {
    statusText.textContent = 'Aguardando jogador';
  } else if (state.status === 'finished') {
    if (state.winner === 'D') {
      statusText.textContent = 'Empate';
    } else if (state.winner === mySymbol) {
      statusText.textContent = 'Você venceu';
    } else {
      statusText.textContent = 'Você perdeu';
    }
  } else if (state.currentPlayer === mySymbol) {
    statusText.textContent = `Sua vez (${mySymbol})`;
  } else {
    statusText.textContent = `Vez de ${currentName}`;
  }

  if (state.status === 'finished') {
    targetText.textContent = 'Partida encerrada';
  } else if (state.status === 'waiting') {
    targetText.textContent = 'Livre';
  } else if (state.availableBoards.length === 1) {
    targetText.textContent = `Mini-tabuleiro ${BOARD_NAMES[state.availableBoards[0]]}`;
  } else {
    targetText.textContent = 'Jogada livre';
  }
}

function renderBoard() {
  const myTurn = state.status === 'playing' && state.currentPlayer === session?.symbol;
  const playableBoards = new Set(state.availableBoards);

  mainBoard.innerHTML = '';

  state.miniBoards.forEach((miniBoard, boardIndex) => {
    const result = state.mainBoard[boardIndex];
    const mini = document.createElement('div');
    mini.className = 'mini-board';
    mini.classList.toggle('playable', playableBoards.has(boardIndex) && state.status === 'playing');
    mini.classList.toggle('completed', Boolean(result));
    mini.classList.toggle('won-x', result === 'X');
    mini.classList.toggle('won-o', result === 'O');
    mini.classList.toggle('draw', result === 'D');
    mini.setAttribute('aria-label', `Mini-tabuleiro ${BOARD_NAMES[boardIndex]}`);

    const cells = document.createElement('div');
    cells.className = 'mini-cells';

    miniBoard.forEach((mark, cellIndex) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.board = String(boardIndex);
      cell.dataset.cell = String(cellIndex);
      cell.textContent = mark || '';
      cell.classList.toggle('mark-x', mark === 'X');
      cell.classList.toggle('mark-o', mark === 'O');
      cell.classList.toggle('can-play', myTurn && playableBoards.has(boardIndex) && !mark && !result);
      cell.setAttribute('aria-label', `Casa ${BOARD_NAMES[cellIndex]} do mini-tabuleiro ${BOARD_NAMES[boardIndex]}`);
      cells.appendChild(cell);
    });

    mini.appendChild(cells);

    if (result) {
      const overlay = document.createElement('div');
      overlay.className = 'mini-result';
      overlay.classList.toggle('x', result === 'X');
      overlay.classList.toggle('o', result === 'O');
      overlay.classList.toggle('draw', result === 'D');
      overlay.textContent = result === 'D' ? '=' : result;
      mini.appendChild(overlay);
    }

    mainBoard.appendChild(mini);
  });
}

function renderActions() {
  const finished = state.status === 'finished';
  rematchButton.hidden = !finished;
  newRoomButton.hidden = !finished;

  if (!finished) {
    return;
  }

  const wantsRematch = state.players[session.symbol]?.wantsRematch;
  rematchButton.textContent = wantsRematch ? 'Aguardando revanche' : 'Pedir revanche';
}

function showLobby() {
  lobbyView.hidden = false;
  gameView.hidden = true;
}

function showGame() {
  lobbyView.hidden = true;
  gameView.hidden = false;
  clearLobbyError();
}

function showLobbyError(message) {
  lobbyError.textContent = message;
}

function clearLobbyError() {
  lobbyError.textContent = '';
}

function showGameMessage(message, notice = false) {
  window.clearTimeout(messageTimer);
  gameError.textContent = message;
  gameError.classList.toggle('notice', notice);
  messageTimer = window.setTimeout(() => {
    gameError.textContent = '';
    gameError.classList.remove('notice');
  }, notice ? 2200 : 3200);
}

function getRoomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return normalizeRoom(params.get('room') || '');
}

function makeRoomUrl(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  return url.toString();
}

function updateUrl(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  window.history.replaceState({}, '', url);
}

function clearRoomUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  window.history.replaceState({}, '', url);
}

function normalizeRoom(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

function getSavedSession(roomId) {
  const sessions = readSessions();
  return sessions[normalizeRoom(roomId)] || null;
}

function saveSession(nextSession) {
  const sessions = readSessions();
  sessions[nextSession.roomId] = nextSession;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  localStorage.setItem(ACTIVE_ROOM_KEY, nextSession.roomId);
}

function clearSavedSession(roomId) {
  const normalizedRoomId = normalizeRoom(roomId);
  const sessions = readSessions();

  delete sessions[normalizedRoomId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));

  if (localStorage.getItem(ACTIVE_ROOM_KEY) === normalizedRoomId) {
    localStorage.removeItem(ACTIVE_ROOM_KEY);
  }
}

function readSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}
