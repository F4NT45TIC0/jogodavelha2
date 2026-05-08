const assert = require('assert');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const port = 4300 + Math.floor(Math.random() * 1000);
const url = `http://localhost:${port}`;
const server = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});

let playerX;
let playerO;

run()
  .then(() => {
    console.log('Sincronização em tempo real validada.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (playerX) {
      playerX.close();
    }
    if (playerO) {
      playerO.close();
    }
    server.kill();
  });

async function run() {
  await waitForServer();

  playerX = io(url, { reconnection: false });
  playerO = io(url, { reconnection: false });

  await Promise.all([once(playerX, 'connect'), once(playerO, 'connect')]);

  const created = await emitAck(playerX, 'room:create', { nickname: 'Ana' });
  assert.equal(created.ok, true);
  assert.equal(created.player.symbol, 'X');
  assert.equal(created.room.status, 'waiting');

  const joined = await emitAck(playerO, 'room:join', {
    roomId: created.room.roomId,
    nickname: 'Bia'
  });
  assert.equal(joined.ok, true);
  assert.equal(joined.player.symbol, 'O');
  assert.equal(joined.room.status, 'playing');

  const updateForX = waitForUpdate(playerX, (room) => room.miniBoards[4][2] === 'X');
  const updateForO = waitForUpdate(playerO, (room) => room.miniBoards[4][2] === 'X');
  playerX.emit('game:move', { boardIndex: 4, cellIndex: 2 });

  const [roomX, roomO] = await Promise.all([updateForX, updateForO]);
  assert.equal(roomX.currentPlayer, 'O');
  assert.equal(roomX.nextBoardIndex, 2);
  assert.deepEqual(roomX, roomO);

  const error = once(playerO, 'game:error');
  playerO.emit('game:move', { boardIndex: 0, cellIndex: 0 });
  assert.match(await error, /destacado/);
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Servidor não iniciou a tempo.')), 5000);

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
        reject(new Error(`Servidor encerrou durante o teste com código ${code}.`));
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

function waitForUpdate(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('room:update', handleUpdate);
      reject(new Error('Atualização da sala não chegou a tempo.'));
    }, 5000);

    function handleUpdate(room) {
      if (!predicate(room)) {
        return;
      }

      clearTimeout(timer);
      socket.off('room:update', handleUpdate);
      resolve(room);
    }

    socket.on('room:update', handleUpdate);
  });
}
