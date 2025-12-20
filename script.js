// ===========================================
// LETTER DISTRIBUTION CONFIGURATION
// ===========================================
// Change this array to use different letter sets.
// Options based on research:
//   - Brainworkshop: ['C', 'H', 'J', 'K', 'L', 'Q', 'R', 'S', 'T'] (phonetically distinct)
//   - Jaeggi 2003:   ['B', 'C', 'D', 'G', 'H', 'K', 'P', 'Q', 'T', 'W'] (more rhyming = harder)
//   - Full alphabet: All 26 letters available in /audio/corsica/
//
// For phonetically similar challenge sets, consider rotating groups:
//   - Group 1: B, C, D, P, T, V, Z (maybe E)
//   - Group 2: F, S, X
//   - Group 3: N, M (maybe L)
//   - Group 4: J, A, K
//   - Group 5: I, Y

const LETTER_DISTRIBUTIONS = {
  brainworkshop: ['C', 'H', 'J', 'K', 'L', 'Q', 'R', 'S', 'T'],
  jaeggi2003: ['B', 'C', 'D', 'G', 'H', 'K', 'P', 'Q', 'T', 'W'],
  phoneticallyDistinct: ['C', 'H', 'K', 'L', 'Q', 'R', 'S', 'T'],
  rhymingChallenge: ['B', 'C', 'D', 'P', 'T', 'V', 'Z'],
  fullAlphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
};

// Current active letter set - change this to switch distributions
const ACTIVE_DISTRIBUTION = 'brainworkshop';
const letters = LETTER_DISTRIBUTIONS[ACTIVE_DISTRIBUTION];

// Audio configuration
const AUDIO_BASE_PATH = 'audio/corsica';
const AUDIO_FORMAT = 'webm';

// ===========================================
// AUDIO SYSTEM
// ===========================================
let audioCtx = null;
const audioBuffers = new Map(); // letter -> AudioBuffer
let audioLoaded = false;

async function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  // Resume context if suspended (needed for some browsers)
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
}

async function loadAudioFiles() {
  const startBtn = document.getElementById('start-btn');
  const statusEl = document.getElementById('loading-status');

  statusEl.textContent = `Loading audio (0/${letters.length})...`;
  statusEl.classList.remove('error');

  let loaded = 0;
  let failed = [];

  for (const letter of letters) {
    try {
      const url = `${AUDIO_BASE_PATH}/${letter.toLowerCase()}.${AUDIO_FORMAT}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();

      // Create audio context if not exists (needed for decoding)
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }

      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      audioBuffers.set(letter, audioBuffer);

      loaded++;
      statusEl.textContent = `Loading audio (${loaded}/${letters.length})...`;
    } catch (err) {
      console.error(`Failed to load audio for letter ${letter}:`, err);
      failed.push(letter);
    }
  }

  if (failed.length > 0) {
    statusEl.textContent = `Warning: Failed to load: ${failed.join(', ')}`;
    statusEl.classList.add('error');

    // Still allow playing if at least some letters loaded
    if (loaded >= letters.length / 2) {
      audioLoaded = true;
      startBtn.disabled = false;
      startBtn.textContent = 'Start';
    } else {
      startBtn.textContent = 'Audio Error';
    }
  } else {
    statusEl.textContent = '';
    audioLoaded = true;
    startBtn.disabled = false;
    startBtn.textContent = 'Start';
  }
}

function playLetter(letter) {
  if (!audioCtx || !audioBuffers.has(letter)) {
    console.warn(`Cannot play letter ${letter}: audio not loaded`);
    return;
  }

  // Resume context if suspended
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const buffer = audioBuffers.get(letter);
  const source = audioCtx.createBufferSource();
  const gainNode = audioCtx.createGain();

  source.buffer = buffer;
  source.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  gainNode.gain.value = 1.0;
  source.start(0);
}

function playClick() {
  if (!audioCtx) return;

  // Resume context if suspended
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.frequency.value = 800;
  osc.type = 'square';

  gain.gain.setValueAtTime(0.03, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);

  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.05);
}

// ===========================================
// GAME STATE
// ===========================================
let nLevel = 2;
let numTrials = 20;
let currentTrial = 0;
let history = [];
let responses = [];
let gameActive = false;
let stimulusShown = false;
let gameTimeout = null;

// Threshold for leveling up (80%)
const LEVEL_UP_THRESHOLD = 80;

// Touch handling
let touchStartX = 0;
let touchStartY = 0;
const SWIPE_THRESHOLD = 50;

// ===========================================
// UI FUNCTIONS
// ===========================================
function adjustN(delta) {
  nLevel = Math.max(1, Math.min(9, nLevel + delta));
  document.getElementById('n-value').textContent = nLevel;
}

function adjustTrials(delta) {
  numTrials = Math.max(10, Math.min(50, numTrials + delta));
  document.getElementById('trials-value').textContent = numTrials;
}

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

function exitGame() {
  gameActive = false;
  if (gameTimeout) {
    clearTimeout(gameTimeout);
    gameTimeout = null;
  }
  hideStimulus();
  showScreen('start-screen');
}

// ===========================================
// GAME LOGIC
// ===========================================
async function startGame() {
  await initAudio();

  currentTrial = 0;
  history = [];
  responses = [];
  gameActive = true;

  document.getElementById('trial-total').textContent = numTrials;
  document.getElementById('n-display').textContent = `${nLevel}-Back`;

  showScreen('game-screen');

  gameTimeout = setTimeout(nextTrial, 1000);
}

function nextTrial() {
  if (currentTrial >= numTrials) {
    endGame();
    return;
  }

  // Determine if this should be a match (30% chance for each type after n trials)
  let position, letter;

  if (currentTrial >= nLevel && Math.random() < 0.3) {
    position = history[currentTrial - nLevel].position;
  } else {
    position = Math.floor(Math.random() * 9);
  }

  if (currentTrial >= nLevel && Math.random() < 0.3) {
    letter = history[currentTrial - nLevel].letter;
  } else {
    letter = letters[Math.floor(Math.random() * letters.length)];
  }

  history.push({ position, letter });
  responses.push({ position: null, audio: null });

  currentTrial++;
  document.getElementById('trial-num').textContent = currentTrial;

  // Show stimulus
  showStimulus(position, letter);
  stimulusShown = true;

  // Hide after 500ms, then wait before next trial
  gameTimeout = setTimeout(() => {
    if (!gameActive) return;
    hideStimulus();
    stimulusShown = false;

    gameTimeout = setTimeout(() => {
      if (!gameActive) return;
      nextTrial();
    }, 2000);
  }, 500);
}

function showStimulus(position, letter) {
  document.querySelectorAll('.cell').forEach(c => c.classList.remove('active'));
  document.querySelector(`.cell[data-pos="${position}"]`).classList.add('active');
  playLetter(letter);
}

function hideStimulus() {
  document.querySelectorAll('.cell').forEach(c => c.classList.remove('active'));
}

function handleInput(direction) {
  if (!gameActive || currentTrial === 0) return;

  playClick();

  const responseIndex = currentTrial - 1;

  // Map swipe to response
  // left = position match, right = audio match, up = both, down = neither
  switch(direction) {
    case 'left':
      responses[responseIndex].position = true;
      responses[responseIndex].audio = false;
      showFeedback('←');
      break;
    case 'right':
      responses[responseIndex].position = false;
      responses[responseIndex].audio = true;
      showFeedback('→');
      break;
    case 'up':
      responses[responseIndex].position = true;
      responses[responseIndex].audio = true;
      showFeedback('↑');
      break;
    case 'down':
      responses[responseIndex].position = false;
      responses[responseIndex].audio = false;
      showFeedback('↓');
      break;
  }
}

function showFeedback(symbol) {
  const fb = document.getElementById('feedback');
  fb.textContent = symbol;
  fb.classList.add('show');
  setTimeout(() => fb.classList.remove('show'), 300);
}

// ===========================================
// SCORE CALCULATION
// ===========================================
// Uses Brainworkshop's method: TP / (TP + FP + FN)
// This ignores true negatives, measuring only "active" performance.
// A player who never responds scores 0%, not 70%+ from TN inflation.

function calculateScores(history, responses, nLevel) {
  let position = { tp: 0, fp: 0, fn: 0 };
  let audio = { tp: 0, fp: 0, fn: 0 };

  for (let i = nLevel; i < history.length; i++) {
    const wasPositionMatch = history[i].position === history[i - nLevel].position;
    const wasAudioMatch = history[i].letter === history[i - nLevel].letter;

    const response = responses[i];
    const respondedPosition = response.position === true;
    const respondedAudio = response.audio === true;

    // Position scoring
    if (wasPositionMatch && respondedPosition) {
      position.tp++;
    } else if (!wasPositionMatch && respondedPosition) {
      position.fp++;
    } else if (wasPositionMatch && !respondedPosition) {
      position.fn++;
    }
    // True negatives (wasPositionMatch=false, respondedPosition=false) are ignored

    // Audio scoring
    if (wasAudioMatch && respondedAudio) {
      audio.tp++;
    } else if (!wasAudioMatch && respondedAudio) {
      audio.fp++;
    } else if (wasAudioMatch && !respondedAudio) {
      audio.fn++;
    }
    // True negatives ignored
  }

  // Brainworkshop formula: TP / (TP + FP + FN)
  const calcPct = (stats) => {
    const denom = stats.tp + stats.fp + stats.fn;
    return denom === 0 ? 0 : Math.round((stats.tp / denom) * 100);
  };

  const positionPct = calcPct(position);
  const audioPct = calcPct(audio);

  // Overall: combine all TP, FP, FN
  const overallDenom = position.tp + position.fp + position.fn + audio.tp + audio.fp + audio.fn;
  const overallPct = overallDenom === 0 ? 0 : Math.round(((position.tp + audio.tp) / overallDenom) * 100);

  return { positionPct, audioPct, overallPct };
}

// ===========================================
// RESULTS UI
// ===========================================

function updateResultsUI(scores) {
  document.getElementById('last-position').textContent = `${scores.positionPct}%`;
  document.getElementById('last-audio').textContent = `${scores.audioPct}%`;
  document.getElementById('last-overall').textContent = `${scores.overallPct}%`;

  document.getElementById('last-results').classList.add('show');

  const levelUpMessage = document.getElementById('level-up-message');
  if (scores.overallPct >= LEVEL_UP_THRESHOLD && nLevel < 9) {
    nLevel++;
    document.getElementById('n-value').textContent = nLevel;
    levelUpMessage.textContent = `Level up! Now playing ${nLevel}-Back`;
    levelUpMessage.style.display = 'block';
  } else {
    levelUpMessage.style.display = 'none';
  }
}

function endGame() {
  gameActive = false;

  const scores = calculateScores(history, responses, nLevel);
  recordSession(nLevel, scores, numTrials);
  updateResultsUI(scores);

  showScreen('start-screen');
}

// ===========================================
// TOUCH HANDLING
// ===========================================
const gameScreen = document.getElementById('game-screen');

gameScreen.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  e.preventDefault();
}, { passive: false });

gameScreen.addEventListener('touchend', (e) => {
  if (!gameActive) return;

  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;

  if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) {
    return; // Not a swipe
  }

  if (Math.abs(dx) > Math.abs(dy)) {
    handleInput(dx > 0 ? 'right' : 'left');
  } else {
    handleInput(dy > 0 ? 'down' : 'up');
  }

  e.preventDefault();
}, { passive: false });

// Prevent default touch behaviors on game screen only
gameScreen.addEventListener('touchmove', (e) => {
  e.preventDefault();
}, { passive: false });

// ===========================================
// LOCAL STORAGE STATS
// ===========================================
const STATS_KEY = 'swipeback_stats';
const MAX_HISTORY = 30;

function getStats() {
  try {
    const stored = localStorage.getItem(STATS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Failed to load stats:', e);
  }

  return {
    firstPlayed: null,
    lastPlayed: null,
    totalSessions: 0,
    totalTrials: 0,
    levels: {},  // { "2": { attempts: 5, totalScore: 360, bestScore: 88 }, ... }
    history: []  // [{ date, nLevel, positionPct, audioPct, overallPct }, ...]
  };
}

function saveStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (e) {
    console.warn('Failed to save stats:', e);
  }
}

function recordSession(nLevel, scores, trials) {
  const stats = getStats();
  const now = new Date().toISOString();

  // Update timestamps
  if (!stats.firstPlayed) {
    stats.firstPlayed = now;
  }
  stats.lastPlayed = now;

  // Update totals
  stats.totalSessions++;
  stats.totalTrials += trials;

  // Update per-level stats
  const levelKey = String(nLevel);
  if (!stats.levels[levelKey]) {
    stats.levels[levelKey] = { attempts: 0, totalScore: 0, bestScore: 0 };
  }
  stats.levels[levelKey].attempts++;
  stats.levels[levelKey].totalScore += scores.overallPct;
  stats.levels[levelKey].bestScore = Math.max(stats.levels[levelKey].bestScore, scores.overallPct);

  // Add to history
  stats.history.push({
    date: now,
    nLevel,
    positionPct: scores.positionPct,
    audioPct: scores.audioPct,
    overallPct: scores.overallPct
  });

  // Trim history to max size
  if (stats.history.length > MAX_HISTORY) {
    stats.history = stats.history.slice(-MAX_HISTORY);
  }

  saveStats(stats);
}

function toggleStats() {
  const modal = document.getElementById('stats-modal');
  if (modal.classList.contains('active')) {
    modal.classList.remove('active');
  } else {
    renderStats();
    modal.classList.add('active');
  }
}

function renderStats() {
  const stats = getStats();
  const body = document.getElementById('stats-body');

  if (stats.totalSessions === 0) {
    body.innerHTML = '<div class="no-stats">No sessions yet.<br>Play a round to see your stats!</div>';
    return;
  }

  // Calculate summary stats
  const avgScore = stats.history.length > 0
    ? Math.round(stats.history.reduce((sum, s) => sum + s.overallPct, 0) / stats.history.length)
    : 0;

  const highestLevel = Object.keys(stats.levels).reduce((max, lvl) =>
    Math.max(max, parseInt(lvl)), 0);

  // Build HTML
  let html = `
    <div class="stats-summary">
      <div class="stats-summary-item">
        <span class="label">Sessions</span>
        <span class="value">${stats.totalSessions}</span>
      </div>
      <div class="stats-summary-item">
        <span class="label">Total Trials</span>
        <span class="value">${stats.totalTrials}</span>
      </div>
      <div class="stats-summary-item">
        <span class="label">Avg Score</span>
        <span class="value">${avgScore}%</span>
      </div>
      <div class="stats-summary-item">
        <span class="label">Highest Level</span>
        <span class="value">${highestLevel}-Back</span>
      </div>
    </div>
  `;

  // Per-level breakdown
  const levelKeys = Object.keys(stats.levels).sort((a, b) => parseInt(a) - parseInt(b));
  if (levelKeys.length > 0) {
    html += '<div class="stats-section-title">By Level</div><div class="level-stats">';
    for (const lvl of levelKeys) {
      const level = stats.levels[lvl];
      const avg = Math.round(level.totalScore / level.attempts);
      html += `
        <div class="level-stat-row">
          <span class="level-name">${lvl}-Back</span>
          <span class="level-details">${level.attempts} sessions, avg ${avg}%, best ${level.bestScore}%</span>
        </div>
      `;
    }
    html += '</div>';
  }

  // Recent sessions
  if (stats.history.length > 0) {
    html += '<div class="stats-section-title">Recent Sessions</div><div class="recent-sessions">';
    const recent = stats.history.slice(-10).reverse();
    for (const session of recent) {
      const date = new Date(session.date);
      const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      html += `
        <div class="session-row">
          <span class="session-date">${dateStr}</span>
          <span class="session-level">${session.nLevel}-Back</span>
          <span class="session-score">${session.overallPct}%</span>
        </div>
      `;
    }
    html += '</div>';
  }

  body.innerHTML = html;
}

function confirmClearStats() {
  if (confirm('Clear all statistics? This cannot be undone.')) {
    localStorage.removeItem(STATS_KEY);
    renderStats();
  }
}

// Start loading audio files on page load
loadAudioFiles();
