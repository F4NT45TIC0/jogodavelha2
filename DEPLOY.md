# Deploy do Jogo da Velha 2

Este projeto usa duas partes em produção:

- Frontend estatico na Vercel.
- Backend Node/Socket.IO na Railway ou Render.

## Backend na Railway

No terminal, autentique e suba o servidor:

```bash
railway login
railway init
railway up
railway domain
```

Copie a URL publica gerada pela Railway, por exemplo:

```text
https://jogo-da-velha-2-api.up.railway.app
```

## Frontend na Vercel

Use a URL do backend como variavel `SOCKET_URL`:

```bash
vercel env add SOCKET_URL production
vercel --prod
```

O build gera `public/runtime-config.js` apontando o cliente para o backend.

## Backend na Render

O arquivo `render.yaml` ja descreve o servico web:

- build: `npm install`
- start: `npm start`
- health check: `/healthz`

Depois que a Render gerar a URL publica do servico, configure a mesma URL como `SOCKET_URL` na Vercel e rode um novo deploy de producao.

## Expiracao de salas

O servidor remove salas automaticamente com estas variaveis:

- `WAITING_ROOM_TTL_MS`: sala criada sem adversario, padrao 20 minutos.
- `EMPTY_ROOM_TTL_MS`: sala sem jogadores conectados, padrao 20 minutos.
- `ACTIVE_ROOM_TTL_MS`: partida em andamento sem atividade, padrao 2 horas.
- `FINISHED_ROOM_TTL_MS`: partida finalizada, padrao 1 hora.
- `ROOM_CLEANUP_INTERVAL_MS`: frequencia da limpeza, padrao 5 minutos.
