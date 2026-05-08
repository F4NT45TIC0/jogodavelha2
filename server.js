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
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

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
  res.json({ ok: true, rooms: rooms.size });
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

setInterval(() => {
  const now = Date.now();

  for (const [roomId, room] of rooms) {
    const hasConnections = ['X', 'O'].some((symbol) => hasActiveSocketFor(roomId, symbol));
    if (!hasConnections && now - room.updatedAt > ROOM_TTL_MS) {
      rooms.delete(roomId);
    }
  }
}, 30 * 60 * 1000).unref();

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

function hasActiveSocketFor(roomId, symbol) {
  for (const connectedSocket of io.sockets.sockets.values()) {
    if (connectedSocket.data.roomId === roomId && connectedSocket.data.symbol === symbol) {
      return true;
    }
  }

  return false;
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
