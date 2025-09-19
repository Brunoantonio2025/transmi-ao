// Variáveis globais
let peerConnection = null;
let ws = null;
let isConnected = false;
let viewerId = null; // ID será atribuído pelo servidor

// Elementos DOM (modo cliente)
const remoteVideo = document.getElementById('remoteVideo');
const videoPlaceholder = document.getElementById('videoPlaceholder');
const liveIndicator = document.getElementById('liveIndicator');
const videoStatus = document.getElementById('videoStatus');
// elementos removidos no modo cliente: status/logs/controles

// Configuração WebRTC
const rtcConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Função para adicionar logs
function addLog(message, type = 'info') { /* logs desativados no modo cliente */ }

// Utilitários kiosk
function requestFullscreen(el) {
    if (!document.fullscreenElement) {
        const elem = el || document.documentElement;
        const req = elem.requestFullscreen || elem.webkitRequestFullscreen || elem.msRequestFullscreen;
        if (req) {
            try { return req.call(elem); } catch (_) { return Promise.resolve(); }
        }
    }
    return Promise.resolve();
}

function exitFullscreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (document.fullscreenElement && exit) try { exit.call(document); } catch (_) {}
}

function enableKioskInteractions() {
    const overlay = document.getElementById('activateOverlay');
    function activate() {
        requestFullscreen(document.documentElement).finally(() => {
            overlay.classList.remove('visible');
            try { localStorage.setItem('kioskActivated', '1'); } catch (e) {}
            requestWakeLock();
        });
    }
    overlay.addEventListener('click', activate);
    overlay.addEventListener('touchstart', activate, { passive: true });
}

function showActivateOverlay() {
    const overlay = document.getElementById('activateOverlay');
    let activated = false;
    try { activated = localStorage.getItem('kioskActivated') === '1'; } catch (e) {}
    if (activated) {
        // Tentar entrar em fullscreen sem mostrar overlay
        requestFullscreen(document.documentElement);
        overlay.classList.remove('visible');
    } else {
        overlay.classList.add('visible');
    }
}

function setupInactivityCursorHide() {
    let timer = null;
    const delay = 3000;
    function resetTimer() {
        document.body.classList.remove('no-cursor');
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => document.body.classList.add('no-cursor'), delay);
    }
    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('touchstart', resetTimer, { passive: true });
    window.addEventListener('keydown', resetTimer);
    resetTimer();
}

// Prevenir distrações
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key.toLowerCase() === 'r')) {
        e.preventDefault();
    }
    if (e.key === 'F5') e.preventDefault();
});
document.addEventListener('gesturestart', (e) => e.preventDefault());

// Inicializar conexão WebSocket
function initializeWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${wsProtocol}//${window.location.host}`);

    ws.onopen = function() {
        addLog('Conexão WebSocket estabelecida', 'success');
        // Registrar como espectador
        ws.send(JSON.stringify({
            type: 'register-viewer'
        }));
    };

    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    ws.onclose = function() {
        addLog('Conexão WebSocket perdida', 'warning');
        // Resetar status
        resetVideoState();
        // Tentar reconectar após 3 segundos
        setTimeout(initializeWebSocket, 3000);
        // tentar reativar wake lock quando reconectar
        releaseWakeLock();
    };

    ws.onerror = function(error) {
        addLog('Erro WebSocket: ' + error.message, 'error');
    };
}

// Processar mensagens WebSocket
function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'registered':
            addLog(`Registrado como ${data.role}`, 'success');
            viewerId = data.viewerId; // Receber viewerId do servidor
            updateBroadcastStatus(data.broadcastActive || false);
            if (data.broadcastActive && !isConnected) {
                addLog('Transmissão já está ativa: conectando automaticamente...', 'info');
                connectToWatch();
            }
            break;
        case 'broadcast-started':
            addLog('Transmissão iniciada pelo transmissor', 'success');
            updateBroadcastStatus(true);
            if (!isConnected) {
                addLog('Conectando automaticamente para assistir...', 'info');
                connectToWatch();
            }
            break;
        case 'broadcast-stopped':
            addLog('Transmissão parada pelo transmissor', 'warning');
            updateBroadcastStatus(false);
            resetVideoState();
            break;
        case 'offer':
            addLog('Oferta SDP recebida do transmissor', 'info');
            handleOffer(data.offer);
            break;
        case 'ice-candidate':
            addLog('ICE candidate recebido do transmissor', 'info');
            handleIceCandidate(data.candidate);
            break;
        case 'broadcast-status':
            updateBroadcastStatus(data.isActive);
            if (data.isActive && !isConnected) {
                addLog('Status indica transmissão ativa: conectando automaticamente...', 'info');
                connectToWatch();
            }
            break;
        case 'error':
            addLog(`Erro do servidor: ${data.message}`, 'error');
            break;
        default:
            addLog(`Mensagem desconhecida: ${data.type}`, 'warning');
    }
}

// Atualizar status da transmissão
function updateBroadcastStatus(isActive) { /* UI reduzida: apenas overlay atualiza */ }

// Atualizar contador de espectadores (modo cliente: não exibido)
function updateViewerCount(count) { /* noop */ }

// Resetar estado do vídeo
function resetVideoState() {
    remoteVideo.style.display = 'none';
    videoPlaceholder.style.display = 'block';
    liveIndicator.classList.remove('active');
    videoStatus.textContent = 'Aguardando transmissão';
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
}

// Conectar e começar a assistir
function connectToWatch() {
    if (isConnected) return;
    isConnected = true;
    addLog('Iniciando conexão para assistir', 'info');
    setupPeerConnection();
}

// Configurar conexão peer
function setupPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfiguration);
    addLog('Conexão peer criada', 'info');
    peerConnection.ontrack = function(event) {
        addLog('Stream remoto recebido', 'success');
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.style.display = 'block';
        videoPlaceholder.style.display = 'none';
        liveIndicator.classList.add('active');
        try {
            if (localStorage.getItem('kioskActivated') === '1' && !document.fullscreenElement) {
                requestFullscreen(document.documentElement);
            }
        } catch(e) {}
        try {
            remoteVideo.muted = true;
            const playPromise = remoteVideo.play();
            if (playPromise && typeof playPromise.then === 'function') {
                playPromise.catch(() => { addLog('Autoplay bloqueado. Interaja com a página para iniciar o vídeo.', 'warning'); });
            }
        } catch (e) { addLog('Falha ao iniciar reprodução automática: ' + e.message, 'warning'); }
        requestWakeLock();
    };
    peerConnection.onicecandidate = function(event) {
        if (event.candidate) {
            addLog('Enviando ICE candidate para transmissor', 'info');
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                candidate: event.candidate,
                target: 'broadcaster',
                viewerId: viewerId
            }));
        }
    };
    peerConnection.onconnectionstatechange = function() {
        addLog(`Estado da conexão: ${peerConnection.connectionState}`, 'info');
        if (peerConnection.connectionState === 'connected') {
            addLog('Conexão P2P estabelecida com sucesso', 'success');
        } else if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
            addLog('Conexão P2P perdida', 'warning');
            resetVideoState();
        }
    };
    peerConnection.oniceconnectionstatechange = function() { addLog(`Estado ICE: ${peerConnection.iceConnectionState}`, 'info'); };
}

// Processar oferta SDP do transmissor
async function handleOffer(offer) {
    if (!peerConnection) { setupPeerConnection(); }
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        addLog('Oferta SDP configurada', 'success');
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        addLog('Resposta SDP criada', 'success');
        if (peerConnection.pendingRemoteCandidates && peerConnection.pendingRemoteCandidates.length > 0) {
            addLog(`Processando ${peerConnection.pendingRemoteCandidates.length} ICE candidates remotos pendentes`, 'info');
            for (const c of peerConnection.pendingRemoteCandidates) {
                try { await peerConnection.addIceCandidate(new RTCIceCandidate(c)); }
                catch (e) { addLog('Falha ao aplicar ICE remoto pendente: ' + e.message, 'warning'); }
            }
            peerConnection.pendingRemoteCandidates = [];
        }
        ws.send(JSON.stringify({ type: 'answer', answer: answer, viewerId: viewerId }));
        addLog('Resposta SDP enviada para transmissor', 'info');
    } catch (error) {
        addLog(`Erro ao processar oferta: ${error.message}`, 'error');
    }
}

// Processar ICE candidate do transmissor
async function handleIceCandidate(candidate) {
    if (peerConnection) {
        try {
            if (peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                addLog('ICE candidate processado', 'info');
            } else {
                if (!peerConnection.pendingRemoteCandidates) { peerConnection.pendingRemoteCandidates = []; }
                peerConnection.pendingRemoteCandidates.push(candidate);
                addLog('ICE candidate remoto enfileirado (aguardando descrição remota)', 'info');
            }
        } catch (error) { addLog(`Erro ao processar ICE candidate: ${error.message}`, 'error'); }
    }
}

// Desconectar
function disconnect() { isConnected = false; addLog('Desconectando...', 'warning'); resetVideoState(); }

// Inicializar quando a página carregar (modo cliente: auto)
document.addEventListener('DOMContentLoaded', function() {
    showActivateOverlay();
    enableKioskInteractions();
    setupInactivityCursorHide();
    initializeWebSocket();
});

// Wake Lock API
let wakeLock = null;
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            if (!wakeLock) {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => { wakeLock = null; });
            }
        }
    } catch (_) {}
}
function releaseWakeLock() { try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (_) {} 

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        requestWakeLock();
        try { if (localStorage.getItem('kioskActivated') === '1' && !document.fullscreenElement) requestFullscreen(document.documentElement); } catch(_) {}
    }
});

// Limpar recursos quando a página for fechada
window.addEventListener('beforeunload', function() {
    if (peerConnection) {
        peerConnection.close();
    }
});
