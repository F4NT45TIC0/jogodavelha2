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
