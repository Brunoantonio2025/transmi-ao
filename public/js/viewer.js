// Viewer WebRTC Client - Kiosk Mode
(function() {
'use strict';

// Variáveis globais
let peerConnection = null;
let ws = null;
let isConnected = false;
let viewerId = null;

// Elementos DOM
const remoteVideo = document.getElementById('remoteVideo');
const videoPlaceholder = document.getElementById('videoPlaceholder');
const liveIndicator = document.getElementById('liveIndicator');
const videoStatus = document.getElementById('videoStatus');

// Configuração WebRTC
const rtcConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Função para logs (desativada no modo cliente)
function addLog(message, type) { /* noop */ }

// Utilitários kiosk
function requestFullscreen(el) {
    // Só tentar fullscreen se for uma interação direta do usuário
    if (!document.fullscreenElement && document.hasFocus()) {
        const elem = el || document.documentElement;
        const req = elem.requestFullscreen || elem.webkitRequestFullscreen || elem.msRequestFullscreen;
        if (req) {
            try { 
                return req.call(elem).catch(() => Promise.resolve()); 
            } catch (_) { 
                return Promise.resolve(); 
            }
        }
    }
    return Promise.resolve();
}

function enableKioskInteractions() {
    const overlay = document.getElementById('activateOverlay');
    function activate(event) {
        // Esconder overlay e habilitar áudio após interação do usuário
        overlay.classList.remove('visible');
        try { localStorage.setItem('kioskActivated', '1'); } catch (e) {}
        requestWakeLock();
        
        // Habilitar áudio apenas após interação real do usuário
        enableAudio();
        
        // Tentar fullscreen apenas se o usuário clicou
        if (event && (event.type === 'click' || event.type === 'touchstart')) {
            setTimeout(() => {
                requestFullscreen(document.documentElement);
            }, 100);
        }
    }
    overlay.addEventListener('click', activate);
    overlay.addEventListener('touchstart', activate, { passive: true });
}

// Habilitar áudio após interação do usuário
function enableAudio() {
    console.log('Tentando habilitar áudio...');
    if (remoteVideo && remoteVideo.srcObject) {
        console.log('Video element encontrado, srcObject:', remoteVideo.srcObject);
        
        const stream = remoteVideo.srcObject;
        const audioTracks = stream.getAudioTracks();
        console.log('Audio tracks no enableAudio:', audioTracks.length);
        
        if (audioTracks.length > 0) {
            // Garantir que o track de áudio esteja habilitado
            audioTracks.forEach(track => {
                track.enabled = true;
                console.log('Audio track habilitado:', track.enabled);
            });
        }
        
        // Desmutar o elemento de vídeo
        remoteVideo.muted = false;
        console.log('Video element desmutado:', !remoteVideo.muted);
        
        // Definir volume máximo
        remoteVideo.volume = 1.0;
        console.log('Volume definido para:', remoteVideo.volume);
        
        // Tentar tocar novamente
        try {
            remoteVideo.play().then(() => {
                console.log('Vídeo tocando com áudio habilitado');
            }).catch(e => {
                console.error('Erro ao tocar vídeo:', e);
            });
        } catch (e) {
            console.error('Erro no play():', e);
        }
    } else {
        console.warn('Video element ou srcObject não encontrado');
    }
}

function showActivateOverlay() {
    const overlay = document.getElementById('activateOverlay');
    let activated = false;
    try { activated = localStorage.getItem('kioskActivated') === '1'; } catch (e) {}
    if (activated) {
        // Não forçar fullscreen automaticamente, apenas esconder overlay
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

// WebSocket
function initializeWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${wsProtocol}//${window.location.host}`);

    ws.onopen = function() {
        ws.send(JSON.stringify({ type: 'register-viewer' }));
    };

    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    ws.onclose = function() {
        resetVideoState();
        setTimeout(initializeWebSocket, 3000);
        releaseWakeLock();
    };

    ws.onerror = function(error) {
        addLog('Erro WebSocket: ' + error.message, 'error');
    };
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'registered':
            viewerId = data.viewerId;
            if (data.broadcastActive && !isConnected) {
                connectToWatch();
            }
            break;
        case 'broadcast-started':
            if (!isConnected) {
                connectToWatch();
            }
            break;
        case 'broadcast-stopped':
            resetVideoState();
            break;
        case 'offer':
            handleOffer(data.offer);
            break;
        case 'ice-candidate':
            handleIceCandidate(data.candidate);
            break;
        case 'broadcast-status':
            if (data.isActive && !isConnected) {
                connectToWatch();
            }
            break;
    }
}

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

function connectToWatch() {
    if (isConnected) return;
    isConnected = true;
    setupPeerConnection();
}

function setupPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfiguration);
    
    peerConnection.ontrack = function(event) {
        console.log('Stream recebido:', event.streams[0]);
        const stream = event.streams[0];
        
        // Debug: verificar tracks de áudio e vídeo
        const videoTracks = stream.getVideoTracks();
        const audioTracks = stream.getAudioTracks();
        console.log('Video tracks:', videoTracks.length);
        console.log('Audio tracks:', audioTracks.length);
        
        if (audioTracks.length > 0) {
            console.log('Audio track encontrado:', audioTracks[0]);
            console.log('Audio track enabled:', audioTracks[0].enabled);
            console.log('Audio track muted:', audioTracks[0].muted);
        } else {
            console.warn('Nenhum track de áudio encontrado no stream!');
        }
        
        remoteVideo.srcObject = stream;
        remoteVideo.style.display = 'block';
        videoPlaceholder.style.display = 'none';
        liveIndicator.classList.add('active');
        
        try {
            // Iniciar mutado para permitir autoplay
            remoteVideo.muted = true;
            const playPromise = remoteVideo.play();
            if (playPromise && typeof playPromise.then === 'function') {
                playPromise.catch(() => {});
            }
            // Áudio será habilitado apenas após interação do usuário
        } catch (e) {}
        
        requestWakeLock();
    };
    
    peerConnection.onicecandidate = function(event) {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                candidate: event.candidate,
                target: 'broadcaster',
                viewerId: viewerId
            }));
        }
    };
    
    peerConnection.onconnectionstatechange = function() {
        if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
            resetVideoState();
        }
    };
}

async function handleOffer(offer) {
    if (!peerConnection) { setupPeerConnection(); }
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        if (peerConnection.pendingRemoteCandidates && peerConnection.pendingRemoteCandidates.length > 0) {
            for (const c of peerConnection.pendingRemoteCandidates) {
                try { await peerConnection.addIceCandidate(new RTCIceCandidate(c)); }
                catch (e) {}
            }
            peerConnection.pendingRemoteCandidates = [];
        }
        
        ws.send(JSON.stringify({ type: 'answer', answer: answer, viewerId: viewerId }));
    } catch (error) {}
}

async function handleIceCandidate(candidate) {
    if (peerConnection) {
        try {
            if (peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } else {
                if (!peerConnection.pendingRemoteCandidates) { peerConnection.pendingRemoteCandidates = []; }
                peerConnection.pendingRemoteCandidates.push(candidate);
            }
        } catch (error) {}
    }
}

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

function releaseWakeLock() { 
    try { 
        if (wakeLock) { 
            wakeLock.release(); 
            wakeLock = null; 
        } 
    } catch (_) {} 
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        requestWakeLock();
        // Não forçar fullscreen automaticamente ao voltar para a página
    }
});

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
    showActivateOverlay();
    enableKioskInteractions();
    setupInactivityCursorHide();
    initializeWebSocket();
});

// Cleanup
window.addEventListener('beforeunload', function() {
    if (peerConnection) {
        peerConnection.close();
    }
});

})();
