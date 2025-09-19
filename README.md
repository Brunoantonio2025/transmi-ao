# WebRTC Live Streaming

Sistema profissional de transmissão de vídeo ao vivo (broadcast) usando WebRTC, Node.js, Express e WebSocket.

## Recursos
- Transmissão ao vivo via WebRTC (transmissor ↔ espectadores)
- Sinalização via WebSocket (`ws`)
- Servidor HTTP com Express
- Middlewares de produção: Helmet (segurança), CORS, Morgan (logs)
- Health check: `GET /healthz`
- Heartbeat (ping/pong) para derrubar conexões WebSocket mortas

## Estrutura do projeto
```
transmiçao/
├─ public/
│  ├─ index.html           # Página inicial
│  ├─ broadcaster.html     # Interface do transmissor
│  └─ viewer.html          # Interface do espectador
├─ server.js               # Servidor Express + WebSocket (sinalização)
├─ package.json            # Scripts e dependências
├─ .gitignore              # Ignora node_modules e .env
├─ .env.example            # Exemplo de variáveis de ambiente
└─ README.md               # Este arquivo
```

## Pré-requisitos
- Node.js 18+ (recomendado)
- NPM 9+

## Instalação
```bash
npm install
```

## Variáveis de ambiente
Crie um arquivo `.env` na raiz do projeto com base no `.env.example`.

Variáveis suportadas:
- `PORT`: Porta do servidor (padrão `3000`)

## Executando
- Desenvolvimento (com nodemon):
```bash
npm run dev
```
- Produção:
```bash
npm start
```

Acesse:
- Página inicial: http://localhost:3000/
- Transmissor: http://localhost:3000/broadcaster.html
- Espectador: http://localhost:3000/viewer.html
- Health check: http://localhost:3000/healthz

## Logs
- Morgan está configurado em `combined` para logs HTTP
- Logs de aplicação saem no console com timestamp e nível

## Segurança
- Helmet habilitado para melhores cabeçalhos de segurança
- CORS habilitado (ajuste conforme seu domínio)
- Nunca faça commit do `.env` (já está no `.gitignore`)

## Próximos passos (sugestões)
- Adicionar autenticação para o transmissor
- Limitar quantidade de espectadores e controle de sala
- Persistência de métricas (ex.: Prometheus) e dashboards
- CI/CD (GitHub Actions) e deploy (Railway, Render, Fly.io, VPS)
- Configurar ESLint e Prettier
