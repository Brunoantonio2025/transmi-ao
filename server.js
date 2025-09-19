const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

// Configuração do servidor Express
const app = express();
const port = process.env.PORT || 3000;

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Middlewares de produção
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));

// Criar servidor HTTP
const server = http.createServer(app);

// Configurar WebSocket Server
const wss = new WebSocket.Server({ server });

// Armazenar conexões ativas
const connections = {
  broadcaster: null,
  viewers: new Map() // Mudança para Map para associar viewerId com WebSocket
};

// Função para logging com timestamp
function log(message, type = 'INFO') {
  const timestamp = new Date().toLocaleString('pt-BR');
  console.log(`[${timestamp}] [${type}] ${message}`);
}

// Heartbeat para detectar conexões WebSocket mortas
function heartbeat() {
  this.isAlive = true;
}

// Função para enviar mensagem segura via WebSocket
function safeSend(ws, data) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      return true;
    }
  } catch (error) {
    log(`Erro ao enviar mensagem: ${error.message}`, 'ERROR');
  }
  return false;
}

// Gerenciar conexões WebSocket
wss.on('connection', (ws) => {
  log('Nova conexão WebSocket estabelecida');
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  // Enviar status inicial da transmissão
  safeSend(ws, {
    type: 'broadcast-status',
    isActive: connections.broadcaster !== null,
    viewerCount: connections.viewers.size
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      log(`Mensagem recebida: ${data.type}`);

      switch (data.type) {
        case 'register-broadcaster':
          // Registrar transmissor
          if (connections.broadcaster) {
            log('Tentativa de registro de segundo transmissor rejeitada', 'WARN');
            safeSend(ws, {
              type: 'error',
              message: 'Já existe um transmissor ativo'
            });
            return;
          }

          connections.broadcaster = ws;
          log('Transmissor registrado com sucesso');

          // Notificar todos os espectadores que a transmissão começou
          connections.viewers.forEach((viewer, viewerId) => {
            safeSend(viewer, {
              type: 'broadcast-started',
              viewerCount: connections.viewers.size
            });
          });

          safeSend(ws, {
            type: 'registered',
            role: 'broadcaster',
            viewerCount: connections.viewers.size
          });
          break;
        case 'start-broadcast':
          // Transmissor iniciou a transmissão: notificar espectadores e informar transmissor sobre espectadores atuais
          log('Transmissão iniciada pelo transmissor');
          // Notificar espectadores que a transmissão começou
          connections.viewers.forEach((viewer, viewerId) => {
            safeSend(viewer, {
              type: 'broadcast-started',
              viewerCount: connections.viewers.size
            });
          });

          // Enviar ao transmissor eventos de viewer conectado para cada espectador atual
          if (connections.broadcaster) {
            connections.viewers.forEach((viewer, viewerId) => {
              safeSend(connections.broadcaster, {
                type: 'viewer-connected',
                viewerId: viewerId,
                viewerCount: connections.viewers.size
              });
            });
          }
          break;

        case 'register-viewer':
          // Registrar espectador
          const viewerId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
          ws.viewerId = viewerId;
          connections.viewers.set(viewerId, ws);
          log(`Espectador registrado. Total: ${connections.viewers.size}`);

          // Notificar status da transmissão
          safeSend(ws, {
            type: 'registered',
            role: 'viewer',
            viewerId: viewerId,
            broadcastActive: connections.broadcaster !== null,
            viewerCount: connections.viewers.size
          });

          // Se há transmissor ativo, iniciar processo de conexão
          if (connections.broadcaster) {
            safeSend(connections.broadcaster, {
              type: 'viewer-connected',
              viewerId: viewerId,
              viewerCount: connections.viewers.size
            });
          }
          break;

        case 'offer':
          // Transmissor enviou oferta SDP - repassar para espectador específico
          log(`Repassando oferta SDP para espectador ${data.viewerId}`);
          const targetViewer = connections.viewers.get(data.viewerId);
          if (targetViewer) {
            safeSend(targetViewer, {
              type: 'offer',
              offer: data.offer
            });
          } else {
            log(`Espectador ${data.viewerId} não encontrado`, 'WARN');
            safeSend(ws, {
              type: 'error',
              message: 'Espectador não encontrado'
            });
          }
          break;

        case 'answer':
          // Espectador enviou resposta SDP - repassar para transmissor
          log('Repassando resposta SDP para transmissor');
          if (connections.broadcaster) {
            safeSend(connections.broadcaster, {
              type: 'answer',
              answer: data.answer,
              viewerId: data.viewerId || 'unknown'
            });
          }
          break;

        case 'ice-candidate':
          // Repassar ICE candidates entre transmissor e espectadores
          if (data.target === 'broadcaster' && connections.broadcaster) {
            log('Repassando ICE candidate para transmissor');
            safeSend(connections.broadcaster, {
              type: 'ice-candidate',
              candidate: data.candidate,
              viewerId: data.viewerId
            });
          } else if (data.target === 'viewer' && data.viewerId) {
            log(`Repassando ICE candidate para espectador ${data.viewerId}`);
            const targetViewer = connections.viewers.get(data.viewerId);
            if (targetViewer) {
              safeSend(targetViewer, {
                type: 'ice-candidate',
                candidate: data.candidate
              });
            } else {
              log(`Espectador ${data.viewerId} não encontrado para ICE candidate`, 'WARN');
              safeSend(ws, {
                type: 'error',
                message: 'Espectador não encontrado para ICE candidate'
              });
            }
          }
          break;

        case 'stop-broadcast':
          // Parar transmissão
          log('Parando transmissão por solicitação do transmissor');
          connections.viewers.forEach((viewer, viewerId) => {
            safeSend(viewer, {
              type: 'broadcast-stopped'
            });
          });
          break;

        default:
          log(`Tipo de mensagem desconhecido: ${data.type}`, 'WARN');
      }
    } catch (error) {
      log(`Erro ao processar mensagem: ${error.message}`, 'ERROR');
      safeSend(ws, {
        type: 'error',
        message: 'Erro interno do servidor'
      });
    }
  });

  // Gerenciar desconexões
  ws.on('close', () => {
    log('Conexão WebSocket fechada');

    // Limpar transmissor se necessário
    if (ws === connections.broadcaster) {
      connections.broadcaster = null;
      log('Transmissor desconectado');

      // Notificar espectadores
      connections.viewers.forEach((viewer, viewerId) => {
        safeSend(viewer, {
          type: 'broadcast-stopped'
        });
      });
    }

    // Remover espectador se necessário
    if (ws.viewerId && connections.viewers.has(ws.viewerId)) {
      connections.viewers.delete(ws.viewerId);
      log(`Espectador desconectado. Total: ${connections.viewers.size}`);

      // Notificar transmissor sobre novo número de espectadores
      if (connections.broadcaster) {
        safeSend(connections.broadcaster, {
          type: 'viewer-disconnected',
          viewerId: ws.viewerId,
          viewerCount: connections.viewers.size
        });
      }
    }
  });

  ws.on('error', (error) => {
    log(`Erro WebSocket: ${error.message}`, 'ERROR');
  });
});

// Rota principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/healthz', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    broadcasterActive: connections.broadcaster !== null,
    viewerCount: connections.viewers.size
  });
});

// Iniciar servidor
server.listen(port, () => {
  log(`Servidor rodando na porta ${port}`);
  log(`Acesse: http://localhost:${port}`);
  log('Páginas disponíveis:');
  log('  - http://localhost:3000/ (página inicial)');
  log('  - http://localhost:3000/broadcaster.html (transmissor)');
  log('  - http://localhost:3000/viewer.html (espectador)');
});

// Intervalo para pingar clientes e encerrar conexões mortas
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      // Remover do mapa de viewers se aplicável
      if (ws.viewerId && connections.viewers.has(ws.viewerId)) {
        connections.viewers.delete(ws.viewerId);
      }
      if (ws === connections.broadcaster) {
        connections.broadcaster = null;
      }
      return ws.terminate();
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (e) {
      log(`Erro ao enviar ping: ${e.message}`, 'WARN');
    }
  });
}, 30000);

wss.on('close', function close() {
  clearInterval(interval);
});