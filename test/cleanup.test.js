const assert = require('assert');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const port = 5300 + Math.floor(Math.random() * 1000);
const url = `http://localhost:${port}`;
const server = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    WAITING_ROOM_TTL_MS: '250',
    EMPTY_ROOM_TTL_MS: '10000',
    ACTIVE_ROOM_TTL_MS: '10000',
    FINISHED_ROOM_TTL_MS: '10000',
    ROOM_CLEANUP_INTERVAL_MS: '100'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let player;

run()
  .then(() => {
    console.log('Limpeza automatica de salas validada.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (player) {
      player.close();
    }
    server.kill();
  });

async function run() {
  await waitForServer();

  player = io(url, { reconnection: false });
  await once(player, 'connect');

  const created = await emitAck(player, 'room:create', { nickname: 'Ana' });
  assert.equal(created.ok, true);
  assert.equal(created.room.status, 'waiting');

  const closed = await once(player, 'room:closed');
  assert.equal(closed.roomId, created.room.roomId);
  assert.match(closed.reason, /advers/i);

  const joined = await emitAck(player, 'room:join', {
    roomId: created.room.roomId,
    nickname: 'Bia'
  });
  assert.equal(joined.ok, false);
  assert.match(joined.error, /encontrada/i);
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Servidor nao iniciou a tempo.')), 5000);

    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes(url)) {
        clearTimeout(timer);
        resolve();
      }
    });

    server.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('EADDRINUSE')) {
        clearTimeout(timer);
        reject(new Error(`Porta ocupada no teste: ${port}`));
      }
    });

    server.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Servidor encerrou durante o teste com codigo ${code}.`));
      }
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function once(socket, event) {
  return new Promise((resolve) => {
    socket.once(event, resolve);
  });
}
