const fs = require('fs');
const path = require('path');

const socketUrl = process.env.SOCKET_URL || process.env.NEXT_PUBLIC_SOCKET_URL || '';
const target = path.join(__dirname, '..', 'public', 'runtime-config.js');

fs.writeFileSync(
  target,
  `window.JDV2_CONFIG = ${JSON.stringify({ socketUrl }, null, 2)};\n`,
  'utf8'
);

console.log(`runtime-config.js gerado com socketUrl=${socketUrl || '(mesma origem)'}`);
