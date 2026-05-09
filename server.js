const crypto = require('crypto');
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const {
  applyMove,
  createGameState,
  publicRoomState,
  resetGameState
} = require('./src/game');

const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
const WAITING_ROOM_TTL_MS = readDuration('ROOM_WAITING_TTL_MS', 3 * 60 * 1000);
const EMPTY_ROOM_TTL_MS = readDuration('ROOM_EMPTY_TTL_MS', 3 * 60 * 1000);
const ACTIVE_ROOM_TTL_MS = readDuration('ROOM_ACTIVE_TTL_MS', 15 * 60 * 1000);
const FINISHED_ROOM_TTL_MS = readDuration('ROOM_FINISHED_TTL_MS', 3 * 60 * 1000);
const ROOM_CLEANUP_INTERVAL_MS = readDuration('ROOM_CLEANUP_INTERVAL_MS', 30 * 1000);
const MAX_CHAT_MESSAGES = 80;
const CHAT_MAX_LENGTH = 180;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: parseOrigins(CLIENT_ORIGIN)
  }
});

const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    cleanup: {
      waitingRoomTtlMs: WAITING_ROOM_TTL_MS,
      emptyRoomTtlMs: EMPTY_ROOM_TTL_MS,
      activeRoomTtlMs: ACTIVE_ROOM_TTL_MS,
      finishedRoomTtlMs: FINISHED_ROOM_TTL_MS,
      intervalMs: ROOM_CLEANUP_INTERVAL_MS
    }
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  socket.on('room:create', (payload = {}, reply) => {
    const nickname = cleanNickname(payload.nickname);
    if (!nickname) {
      return sendReply(reply, { ok: false, error: 'Informe um apelido para criar a sala.' });
    }

    const roomId = createRoomId();
    const token = createToken();
    const room = createGameState(roomId);

    room.players.X = createPlayer('X', nickname, token);
    rooms.set(roomId, room);

    attachSocketToPlayer(socket, room, 'X');
    emitRoom(room);

    sendReply(reply, {
      ok: true,
      player: { symbol: 'X', token, nickname },
      room: publicRoomState(room)
    });
  });

  socket.on('room:join', (payload = {}, reply) => {
    const roomId = cleanRoomId(payload.roomId);
    const nickname = cleanNickname(payload.nickname);
    const token = typeof payload.token === 'string' ? payload.token : null;
    const room = rooms.get(roomId);

    if (!room) {
      return sendReply(reply, { ok: false, error: 'Sala não encontrada.' });
    }

    const reconnectSymbol = findPlayerByToken(room, token);
    if (reconnectSymbol) {
      if (nickname) {
        room.players[reconnectSymbol].nickname = nickname;
      }

      attachSocketToPlayer(socket, room, reconnectSymbol);
      emitRoom(room);
      return sendReply(reply, {
        ok: true,
        player: {
          symbol: reconnectSymbol,
          token: room.players[reconnectSymbol].token,
          nickname: room.players[reconnectSymbol].nickname
        },
        room: publicRoomState(room)
      });
    }

    if (!nickname) {
      return sendReply(reply, { ok: false, error: 'Informe um apelido para entrar na sala.' });
    }

    if (room.players.O) {
      return sendReply(reply, { ok: false, error: 'Essa sala já está cheia.' });
    }

    const newToken = createToken();
    room.players.O = createPlayer('O', nickname, newToken);
    room.status = 'playing';
    room.updatedAt = Date.now();

    attachSocketToPlayer(socket, room, 'O');
    emitRoom(room);

    sendReply(reply, {
      ok: true,
      player: { symbol: 'O', token: newToken, nickname },
      room: publicRoomState(room)
    });
  });

  socket.on('game:move', (payload = {}) => {
    const room = rooms.get(socket.data.roomId);
    const symbol = socket.data.symbol;
    const boardIndex = Number(payload.boardIndex);
    const cellIndex = Number(payload.cellIndex);
    const result = applyMove(room, symbol, boardIndex, cellIndex);

    if (!result.ok) {
      socket.emit('game:error', result.reason);
      return;
    }

    emitRoom(room);
  });

  socket.on('game:rematch', () => {
    const room = rooms.get(socket.data.roomId);
    const symbol = socket.data.symbol;

    if (!room || room.status !== 'finished' || (symbol !== 'X' && symbol !== 'O')) {
      return;
    }

    room.rematchRequests[symbol] = true;
    room.updatedAt = Date.now();

    if (room.rematchRequests.X && room.rematchRequests.O) {
      resetGameState(room);
    }

    emitRoom(room);
  });

  socket.on('chat:send', (payload = {}) => {
    const room = rooms.get(socket.data.roomId);
    const symbol = socket.data.symbol;

    if (!room || (symbol !== 'X' && symbol !== 'O') || !room.players[symbol]) {
      socket.emit('chat:error', 'Entre em uma sala para conversar.');
      return;
    }

    const text = cleanChatMessage(payload.text);
    if (!text) {
      socket.emit('chat:error', 'Digite uma mensagem antes de enviar.');
      return;
    }

    room.chatMessages = room.chatMessages || [];
    room.chatMessages.push({
      id: createMessageId(),
      symbol,
      nickname: room.players[symbol].nickname,
      text,
      sentAt: Date.now()
    });

    if (room.chatMessages.length > MAX_CHAT_MESSAGES) {
      room.chatMessages = room.chatMessages.slice(-MAX_CHAT_MESSAGES);
    }

    room.updatedAt = Date.now();
    emitRoom(room);
  });

  socket.on('room:leave', () => {
    const roomId = socket.data.roomId;
    const symbol = socket.data.symbol;
    const room = rooms.get(roomId);

    if (roomId) {
      socket.leave(roomId);
    }

    socket.data.roomId = null;
    socket.data.symbol = null;

    if (room && room.players[symbol] && !hasActiveSocketFor(room.roomId, symbol)) {
      room.players[symbol].connected = false;
      room.players[symbol].lastSeen = Date.now();
      room.updatedAt = Date.now();
      emitRoom(room);
    }
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomId);
    const symbol = socket.data.symbol;

    if (!room || !room.players[symbol]) {
      return;
    }

    if (!hasActiveSocketFor(room.roomId, symbol)) {
      room.players[symbol].connected = false;
      room.players[symbol].lastSeen = Date.now();
      room.updatedAt = Date.now();
      emitRoom(room);
    }
  });
});

setInterval(cleanupRooms, ROOM_CLEANUP_INTERVAL_MS).unref();

server.listen(PORT, () => {
  console.log(`Jogo da Velha 2 rodando em http://localhost:${PORT}`);
});

function createRoomId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let roomId = '';

  do {
    roomId = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(roomId));

  return roomId;
}

function createToken() {
  return crypto.randomUUID();
}

function createMessageId() {
  return crypto.randomBytes(8).toString('hex');
}

function createPlayer(symbol, nickname, token) {
  return {
    symbol,
    nickname,
    token,
    connected: true,
    joinedAt: Date.now(),
    lastSeen: null
  };
}

function cleanNickname(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);
}

function cleanChatMessage(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX_LENGTH);
}

function cleanRoomId(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

function findPlayerByToken(room, token) {
  if (!token) {
    return null;
  }

  if (room.players.X && room.players.X.token === token) {
    return 'X';
  }

  if (room.players.O && room.players.O.token === token) {
    return 'O';
  }

  return null;
}

function attachSocketToPlayer(socket, room, symbol) {
  const previousRoomId = socket.data.roomId;
  const previousSymbol = socket.data.symbol;

  if (previousRoomId && previousRoomId !== room.roomId) {
    socket.leave(previousRoomId);
    socket.data.roomId = null;
    socket.data.symbol = null;

    const previousRoom = rooms.get(previousRoomId);
    if (previousRoom && previousRoom.players[previousSymbol] && !hasActiveSocketFor(previousRoomId, previousSymbol)) {
      previousRoom.players[previousSymbol].connected = false;
      previousRoom.players[previousSymbol].lastSeen = Date.now();
      previousRoom.updatedAt = Date.now();
      emitRoom(previousRoom);
    }
  }

  socket.join(room.roomId);
  socket.data.roomId = room.roomId;
  socket.data.symbol = symbol;
  room.players[symbol].connected = true;
  room.updatedAt = Date.now();
}

function emitRoom(room) {
  io.to(room.roomId).emit('room:update', publicRoomState(room));
}

function cleanupRooms() {
  const now = Date.now();

  for (const [roomId, room] of rooms) {
    const connectedCount = countActiveSockets(roomId);
    const idleFor = now - room.updatedAt;

    if (connectedCount === 0 && idleFor > EMPTY_ROOM_TTL_MS) {
      closeRoom(roomId, 'Sala removida por falta de jogadores conectados.');
      continue;
    }

    if (room.status === 'waiting' && !room.players.O && now - room.createdAt > WAITING_ROOM_TTL_MS) {
      closeRoom(roomId, 'Sala expirada porque nenhum adversário entrou.');
      continue;
    }

    if (room.status === 'finished' && idleFor > FINISHED_ROOM_TTL_MS) {
      closeRoom(roomId, 'Sala finalizada removida automaticamente.');
      continue;
    }

    if (room.status === 'playing' && idleFor > ACTIVE_ROOM_TTL_MS) {
      closeRoom(roomId, 'Partida removida por inatividade.');
    }
  }
}

function closeRoom(roomId, reason) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  io.to(roomId).emit('room:closed', { roomId, reason });

  for (const connectedSocket of io.sockets.sockets.values()) {
    if (connectedSocket.data.roomId === roomId) {
      connectedSocket.leave(roomId);
      connectedSocket.data.roomId = null;
      connectedSocket.data.symbol = null;
    }
  }

  rooms.delete(roomId);
}

function hasActiveSocketFor(roomId, symbol) {
  for (const connectedSocket of io.sockets.sockets.values()) {
    if (connectedSocket.data.roomId === roomId && connectedSocket.data.symbol === symbol) {
      return true;
    }
  }

  return false;
}

function countActiveSockets(roomId) {
  let count = 0;

  for (const connectedSocket of io.sockets.sockets.values()) {
    if (connectedSocket.data.roomId === roomId) {
      count += 1;
    }
  }

  return count;
}

function sendReply(reply, payload) {
  if (typeof reply === 'function') {
    reply(payload);
  }
}

function parseOrigins(value) {
  if (!value || value === '*') {
    return '*';
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function readDuration(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
