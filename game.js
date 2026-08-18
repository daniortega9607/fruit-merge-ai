// 🍉 Frutitas — Suika Game minimalista con Matter.js + emojis
// Juego de fusionar frutas con física. Suelta frutas, fusiona iguales, haz la sandía.

const { Engine, World, Bodies, Body, Events, Composite, Vector } = Matter;

// --- Configuración fija ---
const FRUITS = [
    { emoji: '🍒', radius: 16, score: 1,  color: '#e74c3c' },
    { emoji: '🍓', radius: 22, score: 3,  color: '#e84393' },
    { emoji: '🍇', radius: 28, score: 6,  color: '#a29bfe' },
    { emoji: '🍊', radius: 34, score: 10, color: '#fdcb6e' },
    { emoji: '🍋', radius: 40, score: 15, color: '#ffeaa7' },
    { emoji: '🍎', radius: 48, score: 21, color: '#ff7675' },
    { emoji: '🍐', radius: 56, score: 28, color: '#55efc4' },
    { emoji: '🍑', radius: 64, score: 36, color: '#fab1a0' },
    { emoji: '🍍', radius: 74, score: 45, color: '#fdcb6e' },
    { emoji: '🍈', radius: 84, score: 55, color: '#a8e6cf' },
    { emoji: '🍉', radius: 96, score: 66, color: '#ff6b6b' },
];

const WALL_THICKNESS = 20;
const DROP_COOLDOWN = 600; // ms entre soltar frutas

// --- Dimensiones dinámicas (se recalculan al resize) ---
let GAME_WIDTH = 400;
let GAME_HEIGHT = 600;
let DROP_Y = 60;
let DANGER_LINE_Y = 90;
let fruitScale = 1; // Escala de frutas proporcional al ancho

// --- Estado del juego ---
let engine, world;
let canvas, ctx;
let currentFruitLevel = 0;
let nextFruitLevel = 0;
let canDrop = true;
let lastDropTime = 0;
let score = 0;
let bestScore = parseInt(localStorage.getItem('frutitas-best') || '0');
let gameOver = false;
let pointerX = 0;
let physicsBodies = [];
let particles = [];
let mergeFlash = [];
let dangerTimer = 0;
let walls = [];

// --- Setup del canvas ---
function setupCanvas() {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
    resizeCanvas();
}

function resizeCanvas() {
    const container = document.getElementById('game-container');
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    GAME_WIDTH = rect.width;
    GAME_HEIGHT = rect.height;

    canvas.width = GAME_WIDTH * dpr;
    canvas.height = GAME_HEIGHT * dpr;
    canvas.style.width = GAME_WIDTH + 'px';
    canvas.style.height = GAME_HEIGHT + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Posiciones relativas
    DROP_Y = 50;
    DANGER_LINE_Y = 80;
    pointerX = GAME_WIDTH / 2;

    // Escala de frutas: basada en el ancho (420px = escala 1)
    fruitScale = Math.min(GAME_WIDTH / 420, 1.2);
    // Aplicar escala a las frutas
    const baseRadii = [16, 22, 28, 34, 40, 48, 56, 64, 74, 84, 96];
    FRUITS.forEach((f, i) => { f.radius = baseRadii[i] * fruitScale; });

    // Reconstruir paredes si el motor ya existe
    if (world) {
        for (const w of walls) World.remove(world, w);
        walls = [];
        buildWalls();
    }
}

function buildWalls() {
    const wallOpts = { isStatic: true, restitution: 0.3, friction: 0.5 };
    const floor = Bodies.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - WALL_THICKNESS / 2, GAME_WIDTH, WALL_THICKNESS, wallOpts);
    const leftWall = Bodies.rectangle(WALL_THICKNESS / 2, GAME_HEIGHT / 2, WALL_THICKNESS, GAME_HEIGHT, wallOpts);
    const rightWall = Bodies.rectangle(GAME_WIDTH - WALL_THICKNESS / 2, GAME_HEIGHT / 2, WALL_THICKNESS, GAME_HEIGHT, wallOpts);
    World.add(world, [floor, leftWall, rightWall]);
    walls = [floor, leftWall, rightWall];
}

window.addEventListener('resize', () => {
    resizeCanvas();
});

// --- Setup del motor de física ---
function setupPhysics() {
    engine = Engine.create();
    world = engine.world;
    engine.gravity.y = 1.0;
    buildWalls();
}

// --- Crear una fruta física ---
function createFruit(level, x, y) {
    const fruit = FRUITS[Math.min(level, FRUITS.length - 1)];
    const body = Bodies.circle(x, y, fruit.radius, {
        restitution: 0.2,
        friction: 0.3,
        density: 0.001,
        label: 'fruit-' + level,
    });
    body.fruitLevel = level;
    body.merged = false;
    World.add(world, body);
    physicsBodies.push(body);
    return body;
}

// --- Soltar la fruta actual ---
function dropFruit() {
    if (!canDrop || gameOver) return;
    const now = Date.now();
    if (now - lastDropTime < DROP_COOLDOWN) return;
    lastDropTime = now;

    const level = currentFruitLevel;
    const fruit = FRUITS[level];
    const x = Math.max(fruit.radius + WALL_THICKNESS,
              Math.min(GAME_WIDTH - fruit.radius - WALL_THICKNESS, pointerX));
    createFruit(level, x, DROP_Y);

    currentFruitLevel = nextFruitLevel;
    nextFruitLevel = pickRandomLevel();
    document.getElementById('next-fruit').textContent = FRUITS[nextFruitLevel].emoji;

    canDrop = false;
    setTimeout(() => { canDrop = true; }, DROP_COOLDOWN);
}

// --- Elegir un nivel aleatorio (solo los 5 primeros para empezar) ---
function pickRandomLevel() {
    return Math.floor(Math.random() * 5);
}

// --- Fusionar frutas ---
function setupMergeDetection() {
    Events.on(engine, 'collisionStart', (event) => {
        for (const pair of event.pairs) {
            const a = pair.bodyA;
            const b = pair.bodyB;

            if (a.fruitLevel !== undefined && b.fruitLevel !== undefined &&
                a.fruitLevel === b.fruitLevel && !a.merged && !b.merged &&
                a.fruitLevel < FRUITS.length - 1) {

                a.merged = true;
                b.merged = true;

                const newLevel = a.fruitLevel + 1;
                const midX = (a.position.x + b.position.x) / 2;
                const midY = (a.position.y + b.position.y) / 2;

                World.remove(world, a);
                World.remove(world, b);
                physicsBodies = physicsBodies.filter(f => f !== a && f !== b);

                const newBody = createFruit(newLevel, midX, midY);
                Body.setVelocity(newBody, { x: 0, y: -2 });

                score += FRUITS[newLevel].score;
                updateScore();

                spawnMergeEffect(midX, midY);
            }
        }
    });
}

// --- Efectos visuales ---
function spawnMergeEffect(x, y) {
    for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8;
        const speed = 2 + Math.random() * 3;
        particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 1,
            life: 1.0,
            size: 3 + Math.random() * 4,
            color: ['#fff', '#ffeaa7', '#fdcb6e', '#ff7675'][Math.floor(Math.random() * 4)]
        });
    }
    mergeFlash.push({ x, y, life: 1.0 });
}

// --- Game Over ---
function checkGameOver() {
    let inDanger = false;
    for (const body of physicsBodies) {
        if (body.position.y - body.circleRadius < DANGER_LINE_Y && body.speed < 1.0) {
            inDanger = true;
            break;
        }
    }
    if (inDanger) {
        dangerTimer += 1;
        if (dangerTimer > 120) {
            triggerGameOver();
        }
    } else {
        dangerTimer = 0;
    }
}

function triggerGameOver() {
    if (gameOver) return;
    gameOver = true;
    document.getElementById('final-score').textContent = score;
    document.getElementById('game-over').classList.add('show');
    if (score > bestScore) {
        bestScore = score;
        localStorage.setItem('frutitas-best', String(bestScore));
        document.getElementById('best').textContent = bestScore;
    }
}

// --- Reiniciar ---
function resetGame() {
    for (const body of physicsBodies) {
        World.remove(world, body);
    }
    physicsBodies = [];
    particles = [];
    mergeFlash = [];
    dangerTimer = 0;
    score = 0;
    gameOver = false;
    canDrop = true;
    currentFruitLevel = pickRandomLevel();
    nextFruitLevel = pickRandomLevel();
    document.getElementById('next-fruit').textContent = FRUITS[nextFruitLevel].emoji;
    document.getElementById('game-over').classList.remove('show');
    updateScore();
}

// --- HUD ---
function updateScore() {
    document.getElementById('score').textContent = score;
    document.getElementById('best').textContent = Math.max(bestScore, score);
}

// --- Renderizar ---
function drawFruit(body) {
    const level = body.fruitLevel;
    const fruit = FRUITS[level];
    const x = body.position.x;
    const y = body.position.y;
    const r = body.circleRadius;
    const angle = body.angle;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = fruit.color + '40';
    ctx.fill();

    ctx.font = `${r * 1.3}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fruit.emoji, 0, r * 0.05);

    ctx.restore();
}

function drawCurrentFruit() {
    if (gameOver || currentFruitLevel === null) return;
    const fruit = FRUITS[currentFruitLevel];
    const x = Math.max(fruit.radius + WALL_THICKNESS,
              Math.min(GAME_WIDTH - fruit.radius - WALL_THICKNESS, pointerX));
    const y = DROP_Y;

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(x, y, fruit.radius, 0, Math.PI * 2);
    ctx.fillStyle = fruit.color + '30';
    ctx.fill();

    ctx.font = `${fruit.radius * 1.3}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 1;
    ctx.fillText(fruit.emoji, x, y + fruit.radius * 0.05);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#ffffff20';
    ctx.setLineDash([5, 8]);
    ctx.beginPath();
    ctx.moveTo(x, y + fruit.radius);
    ctx.lineTo(x, GAME_HEIGHT - WALL_THICKNESS);
    ctx.stroke();
    ctx.restore();
}

function drawDangerLine() {
    ctx.save();
    ctx.strokeStyle = '#e9456040';
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(WALL_THICKNESS, DANGER_LINE_Y);
    ctx.lineTo(GAME_WIDTH - WALL_THICKNESS, DANGER_LINE_Y);
    ctx.stroke();
    ctx.restore();
}

function drawWalls() {
    ctx.save();
    const grad = ctx.createLinearGradient(0, GAME_HEIGHT - WALL_THICKNESS, 0, GAME_HEIGHT);
    grad.addColorStop(0, '#16213e');
    grad.addColorStop(1, '#0f3460');
    ctx.fillStyle = grad;
    ctx.fillRect(0, GAME_HEIGHT - WALL_THICKNESS, GAME_WIDTH, WALL_THICKNESS);

    ctx.fillStyle = '#16213e';
    ctx.fillRect(0, 0, WALL_THICKNESS, GAME_HEIGHT);
    ctx.fillRect(GAME_WIDTH - WALL_THICKNESS, 0, WALL_THICKNESS, GAME_HEIGHT);
    ctx.restore();
}

function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.15;
        p.life -= 0.02;

        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }

        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function drawMergeFlash() {
    for (let i = mergeFlash.length - 1; i >= 0; i--) {
        const f = mergeFlash[i];
        f.life -= 0.015;
        if (f.life <= 0) {
            mergeFlash.splice(i, 1);
            continue;
        }
        ctx.save();
        ctx.globalAlpha = f.life;
        ctx.font = 'bold 20px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffeaa7';
        ctx.fillText('+', f.x, f.y - (1 - f.life) * 40);
        ctx.restore();
    }
}

function render() {
    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Fondo que llena todo
    const grad = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
    grad.addColorStop(0, '#1a1a2e');
    grad.addColorStop(1, '#0f3460');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    drawWalls();
    drawDangerLine();
    drawCurrentFruit();

    for (const body of physicsBodies) {
        drawFruit(body);
    }

    drawParticles();
    drawMergeFlash();
}

// --- Game loop ---
function gameLoop() {
    if (!gameOver) {
        Engine.update(engine, 1000 / 60);
        checkGameOver();
    }
    render();
    requestAnimationFrame(gameLoop);
}

// --- Input ---
function setupInput() {
    const getPointerX = (clientX) => {
        const rect = canvas.getBoundingClientRect();
        return (clientX - rect.left) * (GAME_WIDTH / rect.width);
    };

    canvas.addEventListener('mousemove', (e) => {
        pointerX = getPointerX(e.clientX);
    });
    canvas.addEventListener('click', (e) => {
        pointerX = getPointerX(e.clientX);
        dropFruit();
    });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        pointerX = getPointerX(e.touches[0].clientX);
    }, { passive: false });
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        pointerX = getPointerX(e.touches[0].clientX);
    }, { passive: false });
    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        dropFruit();
    }, { passive: false });

    document.getElementById('restart-btn').addEventListener('click', resetGame);
}

// --- Inicializar ---
function init() {
    setupCanvas();
    setupPhysics();
    setupMergeDetection();
    setupInput();

    currentFruitLevel = pickRandomLevel();
    nextFruitLevel = pickRandomLevel();
    document.getElementById('next-fruit').textContent = FRUITS[nextFruitLevel].emoji;
    document.getElementById('best').textContent = bestScore;
    updateScore();

    gameLoop();
}

window.addEventListener('load', () => {
    if (typeof Matter !== 'undefined') {
        init();
    } else {
        setTimeout(init, 500);
    }
});

document.addEventListener('gesturestart', (e) => e.preventDefault());