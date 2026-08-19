// 🍉 Frutitas — Multijugador con PeerJS (topología estrella)
// El host es el peer central. Los invitados se conectan a su ID.
// Mensajes: score_update, player_lost, game_start, game_end, lobby_update, timer_config

window.MP = (() => {
    const PEER_ID_PREFIX = 'frutitas-';
    const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos
    const ROOM_CODE_LEN = 5;

    // --- Estado ---
    let peer = null;
    let conns = [];        // conexiones (si host: a invitados; si invitado: [al host])
    let isHost = false;
    let roomCode = null;
    let playerName = '';
    let playerId = null;
    let players = {};      // { peerId: { name, score, lost, isHost } }
    let gameTimer = 0;     // 0 = infinito
    let gameStartTime = 0;
    let timerInterval = null;
    let scoreSyncInterval = null;

    // --- DOM helpers ---
    function showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    }
    function setMenuStatus(msg, isError) {
        const el = document.getElementById('menu-status');
        el.textContent = msg;
        el.classList.toggle('error', !!isError);
    }

    // --- Generar código de sala ---
    function generateRoomCode() {
        let code = '';
        for (let i = 0; i < ROOM_CODE_LEN; i++) {
            code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
        }
        return code;
    }

    function peerIdForCode(code) {
        return PEER_ID_PREFIX + code.toLowerCase();
    }

    // --- Obtener nombre del jugador ---
    function getName() {
        const input = document.getElementById('name-input');
        let name = input.value.trim();
        if (!name) {
            name = 'Jugador' + Math.floor(Math.random() * 1000);
        }
        localStorage.setItem('frutitas-name', name);
        return name;
    }

    // --- Restaurar nombre ---
    function restoreName() {
        const saved = localStorage.getItem('frutitas-name');
        if (saved) document.getElementById('name-input').value = saved;
    }

    // --- Detectar código en URL ---
    function getRoomCodeFromURL() {
        const hash = window.location.hash;
        if (hash && hash.length >= 2) {
            const code = hash.substring(1).toUpperCase();
            if (code.length >= 4 && code.length <= 6) return code;
        }
        return null;
    }

    // --- Jugar solo ---
    function startSingle() {
        playerName = getName();
        isHost = false;
        players = {};
        startLocalGame();
    }

    // --- Crear sala ---
    function showCreate() {
        document.getElementById('menu-join-fields').style.display = 'none';
        playerName = getName();
        roomCode = generateRoomCode();
        isHost = true;
        playerId = 'host';

        showScreen('lobby-screen');
        document.getElementById('room-code-display').textContent = roomCode;
        updateShareLink();
        document.getElementById('start-game-btn').style.display = 'block';
        document.getElementById('lobby-waiting').textContent = 'Esperando jugadores...';
        document.getElementById('timer-config-wrap').style.display = 'flex';

        // Inicializar PeerJS como host
        const peerId = peerIdForCode(roomCode);
        peer = new Peer(peerId);

        peer.on('open', (id) => {
            console.log('Host peer abierto:', id);
            players[playerId] = { name: playerName, score: 0, lost: false, isHost: true };
            updateLobbyUI();
        });

        peer.on('connection', (conn) => {
            console.log('Invitado conectándose:', conn.peer);
            conns.push(conn);
            setupGuestConn(conn);
        });

        peer.on('error', (err) => {
            console.error('Peer error (host):', err);
            if (err.type === 'unavailable-id') {
                setMenuStatus('Ese código de sala ya existe. Intenta de nuevo.', true);
                showScreen('menu-screen');
            }
        });
    }

    // --- Unirme a sala ---
    function showJoin() {
        const fields = document.getElementById('menu-join-fields');
        fields.style.display = 'block';
        const input = document.getElementById('join-code-input');
        input.value = '';
        setTimeout(() => input.focus(), 100);
        setMenuStatus('Escribe el código de 5 letras');
    }

    function joinFromMenu() {
        const code = document.getElementById('join-code-input').value.trim().toUpperCase();
        if (code.length < 4) {
            setMenuStatus('El código es muy corto', true);
            return;
        }
        joinRoom(code);
    }

    function joinRoom(code) {
        playerName = getName();
        roomCode = code;
        isHost = false;
        playerId = 'guest-' + Date.now();

        showScreen('lobby-screen');
        document.getElementById('room-code-display').textContent = roomCode;
        document.getElementById('start-game-btn').style.display = 'none';
        document.getElementById('lobby-waiting').textContent = 'Conectando...';
        document.getElementById('timer-config-wrap').style.display = 'none';
        updateShareLink();

        const hostId = peerIdForCode(roomCode);
        peer = new Peer();

        peer.on('open', (id) => {
            console.log('Guest peer abierto:', id);
            const conn = peer.connect(hostId, { reliable: true });
            conns = [conn];

            conn.on('open', () => {
                console.log('Conectado al host');
                conn.send({ type: 'join', name: playerName, peerId: peer.id });
            });

            conn.on('data', (data) => {
                handleHostMessage(data, conn);
            });

            conn.on('close', () => {
                console.log('Host se desconectó');
                showToast('💀 El host se fue');
                setTimeout(() => backToMenu(), 2000);
            });
        });

        peer.on('error', (err) => {
            console.error('Peer error (guest):', err);
            if (err.type === 'peer-unavailable') {
                setMenuStatus('No se encontró la sala "' + roomCode + '". ¿Está bien el código?', true);
                showScreen('menu-screen');
            }
        });
    }

    // --- Configurar conexión con invitado (lado del host) ---
    function setupGuestConn(conn) {
        conn.on('open', () => {
            // Enviar lista actual de jugadores al nuevo invitado
            sendToConn(conn, { type: 'lobby_update', players: serializePlayers(), timer: gameTimer });
        });

        conn.on('data', (data) => {
            handleGuestMessage(data, conn);
        });

        conn.on('close', () => {
            console.log('Invitado se desconectó:', conn.peer);
            conns = conns.filter(c => c !== conn);
            // Remover jugador
            for (const [pid, info] of Object.entries(players)) {
                if (info.connPeerId === conn.peer) {
                    delete players[pid];
                    break;
                }
            }
            updateLobbyUI();
            broadcastLobbyUpdate();
            // Si estábamos en juego, notificar
            if (Game.isRunning()) {
                broadcastPlayers();
            }
        });
    }

    // --- Manejar mensajes del invitado (lado del host) ---
    function handleGuestMessage(data, conn) {
        switch (data.type) {
            case 'join':
                // Registrar nuevo jugador
                const guestId = data.peerId || conn.peer;
                players[guestId] = { name: data.name, score: 0, lost: false, isHost: false, connPeerId: conn.peer };
                updateLobbyUI();
                broadcastLobbyUpdate();
                break;
            case 'score_update':
                if (players[data.peerId]) {
                    players[data.peerId].score = data.score;
                }
                // Retransmitir a todos
                broadcastPlayers();
                break;
            case 'player_lost':
                if (players[data.peerId]) {
                    players[data.peerId].lost = true;
                    players[data.peerId].finalScore = data.score;
                }
                // Notificar a todos
                broadcastToAll({ type: 'player_lost', name: players[data.peerId]?.name || '?' });
                checkAllFinished();
                break;
        }
    }

    // --- Manejar mensajes del host (lado del invitado) ---
    function handleHostMessage(data, conn) {
        switch (data.type) {
            case 'lobby_update':
                players = data.players || {};
                gameTimer = data.timer || 0;
                updateLobbyUI();
                document.getElementById('lobby-waiting').textContent =
                    Object.keys(players).length > 1 ? 'Esperando a que el host inicie...' : 'Solo tú en la sala';
                break;
            case 'game_start':
                startMultiplayerGame(data.timer || 0);
                break;
            case 'players_update':
                players = data.players;
                updatePositionBadge();
                break;
            case 'player_lost':
                showToast('💀 ' + data.name + ' perdió');
                break;
            case 'game_end':
                showResults(data.results);
                break;
            case 'host_left':
                showToast('💀 El host se fue');
                setTimeout(() => backToMenu(), 2000);
                break;
        }
    }

    // --- Serializar jugadores para envío ---
    function serializePlayers() {
        const out = {};
        for (const [pid, info] of Object.entries(players)) {
            out[pid] = { name: info.name, score: info.score, lost: info.lost, isHost: info.isHost };
        }
        return out;
    }

    // --- Broadcast a todos los invitados (host) ---
    function broadcastToAll(msg) {
        for (const conn of conns) {
            if (conn.open) sendToConn(conn, msg);
        }
    }

    function sendToConn(conn, msg) {
        if (conn.open) {
            try { conn.send(msg); } catch (e) { console.warn('Error enviando:', e); }
        }
    }

    function broadcastLobbyUpdate() {
        broadcastToAll({ type: 'lobby_update', players: serializePlayers(), timer: gameTimer });
    }

    function broadcastPlayers() {
        broadcastToAll({ type: 'players_update', players: serializePlayers() });
        updatePositionBadge();
    }

    // --- Actualizar UI del lobby ---
    function updateLobbyUI() {
        const list = document.getElementById('players-list');
        list.innerHTML = '';
        const playerList = Object.entries(players).sort((a, b) => (b[1].isHost ? 1 : 0) - (a[1].isHost ? 1 : 0));
        for (const [pid, info] of playerList) {
            const li = document.createElement('li');
            li.textContent = info.name;
            if (info.isHost) li.classList.add('host');
            list.appendChild(li);
        }
        const count = Object.keys(players).length;
        if (isHost) {
            document.getElementById('lobby-waiting').textContent =
                count > 1 ? `${count} jugadores conectados` : 'Esperando jugadores...';
        }
    }

    function updateShareLink() {
        const base = window.location.origin + window.location.pathname;
        const link = base + '#' + roomCode;
        document.getElementById('share-link-display').textContent = link;
    }

    function copyLink() {
        const base = window.location.origin + window.location.pathname;
        const link = base + '#' + roomCode;
        navigator.clipboard.writeText(link).then(() => {
            const btn = document.getElementById('copy-link-btn');
            btn.textContent = '✅ Copiado!';
            setTimeout(() => { btn.textContent = '📋 Copiar link'; }, 2000);
        });
    }

    // --- Timer config ---
    function selectTimer(seconds) {
        gameTimer = seconds;
        document.querySelectorAll('.timer-option').forEach(btn => {
            btn.classList.toggle('selected', parseInt(btn.dataset.t) === seconds);
        });
    }

    // --- Host inicia el juego ---
    function hostStartGame() {
        // Incluir al host en players si no está
        if (!players[playerId]) {
            players[playerId] = { name: playerName, score: 0, lost: false, isHost: true };
        }
        broadcastToAll({ type: 'game_start', timer: gameTimer });
        startMultiplayerGame(gameTimer);
    }

    // --- Iniciar juego multijugador ---
    function startMultiplayerGame(timerSeconds) {
        showScreen('game-screen');
        document.getElementById('position-badge').classList.add('show');
        if (timerSeconds > 0) {
            document.getElementById('timer-display').classList.add('show');
            gameStartTime = Date.now();
            startTimer(timerSeconds);
        }
        // Resetear scores
        if (isHost) {
            for (const pid of Object.keys(players)) {
                players[pid].score = 0;
                players[pid].lost = false;
            }
        } else {
            // Guests resetean su copia local
            for (const pid of Object.keys(players)) {
                players[pid].score = 0;
                players[pid].lost = false;
            }
        }
        Game.start(() => {
            // Callback cuando el score cambia
            onScoreChange();
        });
        updatePositionBadge();
    }

    function startLocalGame() {
        players = {};
        showScreen('game-screen');
        document.getElementById('position-badge').classList.remove('show');
        document.getElementById('timer-display').classList.remove('show');
        Game.start();
    }

    // --- Timer ---
    function startTimer(seconds) {
        clearInterval(timerInterval);
        const display = document.getElementById('timer-display');
        timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
            const remaining = seconds - elapsed;
            if (remaining <= 0) {
                clearInterval(timerInterval);
                display.textContent = '0:00';
                display.classList.add('urgent');
                // Terminar juego
                if (isHost) {
                    triggerGameEnd();
                } else {
                    // Guests reportan score final al host
                    sendToHost({ type: 'player_lost', peerId: peer.id, score: Game.getScore() });
                    Game.forceGameOver();
                }
                return;
            }
            const m = Math.floor(remaining / 60);
            const s = remaining % 60;
            display.textContent = m + ':' + (s < 10 ? '0' : '') + s;
            if (remaining <= 10) display.classList.add('urgent');
        }, 250);
    }

    // --- Score change callback ---
    function onScoreChange() {
        const score = Game.getScore();
        if (isHost) {
            players[playerId].score = score;
            broadcastPlayers();
        } else {
            sendToHost({ type: 'score_update', peerId: peer.id, score: score });
        }
    }

    function sendToHost(msg) {
        if (conns.length > 0 && conns[0].open) {
            try { conns[0].send(msg); } catch (e) { console.warn('Error enviando al host:', e); }
        }
    }

    // --- Position badge ---
    function updatePositionBadge() {
        const myScore = Game.getScore();
        // Contar cuántos tienen más score que yo (no perdidos o ya perdidos con más score)
        const others = Object.values(players).filter(p => !p.isHost || p.isHost);
        const allScores = Object.values(players).map(p => p.score);
        const myRank = allScores.filter(s => s > myScore).length + 1;
        const total = Object.keys(players).length || 1;

        const badge = document.getElementById('position-badge');
        const ordinals = ['🥇1°', '🥈2°', '🥉3°', '4°', '5°', '6°', '7°', '8°'];
        const rankText = ordinals[myRank - 1] || (myRank + '°');
        badge.textContent = `${rankText} de ${total}`;
    }

    // --- Player lost (local game over) ---
    function onLocalGameOver() {
        const score = Game.getScore();
        if (isHost) {
            players[playerId].lost = true;
            players[playerId].finalScore = score;
            // Notificar a invitados
            broadcastToAll({ type: 'player_lost', name: playerName });
            checkAllFinished();
        } else {
            sendToHost({ type: 'player_lost', peerId: peer.id, score: score });
        }
        // Mostrar spectating
        document.getElementById('spectating-msg').style.display = 'block';
        document.getElementById('restart-btn').style.display = 'none';
    }

    // --- Host: verificar si todos terminaron ---
    function checkAllFinished() {
        const allLost = Object.values(players).every(p => p.lost);
        if (allLost && Object.keys(players).length > 0) {
            triggerGameEnd();
        }
    }

    // --- Host: terminar juego ---
    function triggerGameEnd() {
        const results = Object.entries(players)
            .map(([pid, p]) => ({ name: p.name, score: p.finalScore || p.score || 0 }))
            .sort((a, b) => b.score - a.score);
        broadcastToAll({ type: 'game_end', results: results });
        showResults(results);
    }

    // --- Mostrar resultados ---
    function showResults(results) {
        clearInterval(timerInterval);
        Game.stop();
        showScreen('results-screen');
        const list = document.getElementById('results-list');
        list.innerHTML = '';
        const medals = ['🥇', '🥈', '🥉'];
        results.forEach((r, i) => {
            const li = document.createElement('li');
            if (i === 0) li.classList.add('winner');
            const rank = medals[i] || (i + 1);
            li.innerHTML = `<span class="rank">${rank}</span><span class="name">${escapeHtml(r.name)}</span><span class="pts">${r.score}</span>`;
            list.appendChild(li);
        });
        // Mostrar "Jugar de nuevo" solo al host
        const playAgainBtn = document.getElementById('play-again-btn');
        if (isHost) {
            playAgainBtn.style.display = 'block';
            playAgainBtn.onclick = hostRestart;
        } else {
            playAgainBtn.style.display = 'none';
        }
    }

    // --- Host: reiniciar partida para todos ---
    function hostRestart() {
        // Resetear estado de todos los jugadores
        for (const pid of Object.keys(players)) {
            players[pid].score = 0;
            players[pid].lost = false;
            players[pid].finalScore = 0;
        }
        broadcastToAll({ type: 'game_start', timer: gameTimer });
        startMultiplayerGame(gameTimer);
    }

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // --- Toast ---
    function showToast(text) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = text;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // --- Volver al menú ---
    function backToMenu() {
        clearInterval(timerInterval);
        clearInterval(scoreSyncInterval);
        if (peer) { try { peer.destroy(); } catch(e) {} peer = null; }
        conns = [];
        players = {};
        isHost = false;
        roomCode = null;
        Game.stop();
        showScreen('menu-screen');
        setMenuStatus('');
        // Limpiar URL
        if (window.location.hash) {
            history.replaceState(null, '', window.location.pathname);
        }
    }

    // --- Auto-join si hay código en la URL ---
    function autoInit() {
        restoreName();
        const urlCode = getRoomCodeFromURL();
        if (urlCode) {
            joinRoom(urlCode);
        }
    }

    // --- Inicialización ---
    window.addEventListener('load', () => {
        setTimeout(autoInit, 300);
    });

    // --- API pública ---
    return {
        startSingle,
        showCreate,
        showJoin,
        joinFromMenu,
        joinRoom,
        copyLink,
        selectTimer,
        hostStartGame,
        backToMenu,
        showToast,
        onLocalGameOver,
        onScoreChange,
        updatePositionBadge,
        isActive() { return isHost || conns.length > 0; },
    };
})();