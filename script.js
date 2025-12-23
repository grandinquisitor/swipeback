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
let sequence = [];  // Pre-generated game sequence
let responses = [];
let gameActive = false;
let stimulusShown = false;
let gameTimeout = null;

// Thresholds for level changes
const LEVEL_UP_THRESHOLD = 85;
const LEVEL_DOWN_THRESHOLD = 70;

// Immediate feedback: show subtle correct/incorrect indicator on input
// Set to false for "pure" training mode without feedback cues
const SHOW_IMMEDIATE_FEEDBACK = true;

// ===========================================
// SEQUENCE GENERATION
// ===========================================
// Pre-generates the entire game sequence with guaranteed match counts.
// This prevents variable difficulty from random match distributions
// and eliminates accidental matches on non-match trials.

function buildGameSequence(n, totalTrials) {
  const matchableTrials = totalTrials - n;  // Trials where matches are possible

  // Calculate match counts (roughly 30% each, with some dual matches)
  // For 20 trials with n=2, that's 18 matchable trials
  // Target: ~4 position-only, ~4 audio-only, ~2 dual = 6 total each type
  const dualMatches = Math.max(1, Math.round(matchableTrials * 0.10));
  const positionOnlyMatches = Math.max(2, Math.round(matchableTrials * 0.20));
  const audioOnlyMatches = Math.max(2, Math.round(matchableTrials * 0.20));

  // Pick which trial indices will have matches (indices are 0-based, starting from n)
  const positionMatchTrials = new Set();
  const audioMatchTrials = new Set();

  // Helper: pick random trials that aren't already selected
  function pickRandomTrials(count, excludeSet) {
    const picked = [];
    while (picked.length < count) {
      const trial = n + Math.floor(Math.random() * matchableTrials);
      if (!excludeSet.has(trial) && !picked.includes(trial)) {
        picked.push(trial);
      }
    }
    return picked;
  }

  // 1. Pick position-only matches
  const posOnly = pickRandomTrials(positionOnlyMatches, new Set());
  posOnly.forEach(t => positionMatchTrials.add(t));

  // 2. Pick audio-only matches (excluding position matches)
  const audOnly = pickRandomTrials(audioOnlyMatches, positionMatchTrials);
  audOnly.forEach(t => audioMatchTrials.add(t));

  // 3. Pick dual matches (new trials for both)
  const excluded = new Set([...positionMatchTrials, ...audioMatchTrials]);
  const dual = pickRandomTrials(dualMatches, excluded);
  dual.forEach(t => {
    positionMatchTrials.add(t);
    audioMatchTrials.add(t);
  });

  // Now generate the actual sequence
  const positions = [];
  const letterSeq = [];

  // Helper: pick a random value different from a target
  function randomExcluding(max, exclude) {
    const val = Math.floor(Math.random() * (max - 1));
    return val >= exclude ? val + 1 : val;
  }

  for (let i = 0; i < totalTrials; i++) {
    if (i < n) {
      // First n trials: completely random
      positions.push(Math.floor(Math.random() * 9));
      letterSeq.push(letters[Math.floor(Math.random() * letters.length)]);
    } else {
      // Position: match or guaranteed non-match
      if (positionMatchTrials.has(i)) {
        positions.push(positions[i - n]);
      } else {
        positions.push(randomExcluding(9, positions[i - n]));
      }

      // Audio: match or guaranteed non-match
      if (audioMatchTrials.has(i)) {
        letterSeq.push(letterSeq[i - n]);
      } else {
        const prevLetterIndex = letters.indexOf(letterSeq[i - n]);
        const newIndex = randomExcluding(letters.length, prevLetterIndex);
        letterSeq.push(letters[newIndex]);
      }
    }
  }

  // Build sequence array with match flags for debugging/verification
  const seq = [];
  for (let i = 0; i < totalTrials; i++) {
    seq.push({
      position: positions[i],
      letter: letterSeq[i],
      isPositionMatch: positionMatchTrials.has(i),
      isAudioMatch: audioMatchTrials.has(i)
    });
  }

  return seq;
}

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
  sequence = buildGameSequence(nLevel, numTrials);
  responses = sequence.map(() => ({ position: null, audio: null }));
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

  const stimulus = sequence[currentTrial];

  currentTrial++;
  document.getElementById('trial-num').textContent = currentTrial;

  // Show stimulus
  showStimulus(stimulus.position, stimulus.letter);
  stimulusShown = true;

  // Hide after 500ms, then wait before next trial
  gameTimeout = setTimeout(() => {
    if (!gameActive) return;
    hideStimulus();
    stimulusShown = false;

    gameTimeout = setTimeout(() => {
      if (!gameActive) return;

      // Evaluate the trial that just ended (before showing next stimulus)
      evaluateTrialFeedback(currentTrial - 1);

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
  // left and right are additive; down cancels previous input
  switch(direction) {
    case 'left':
      responses[responseIndex].position = true;
      showFeedback('\u2190'); // left arr
      break;
    case 'right':
      responses[responseIndex].audio = true;
      showFeedback('\u2192'); // right arr
      break;
    case 'up':
      responses[responseIndex].position = true;
      responses[responseIndex].audio = true;
      showFeedback('\u2191'); // up arr
      break;
    case 'down':
      responses[responseIndex].position = null;
      responses[responseIndex].audio = null;
      showFeedback('\u2193'); // down arr
      break;
  }
}

// Evaluate and show correctness feedback for a completed trial
function evaluateTrialFeedback(trialIndex) {
  if (!SHOW_IMMEDIATE_FEEDBACK || trialIndex < nLevel) return;

  const stimulus = sequence[trialIndex];
  const response = responses[trialIndex];

  const userResponded = response.position === true || response.audio === true;
  const wasMatch = stimulus.isPositionMatch || stimulus.isAudioMatch;

  // Skip feedback for true negatives (no input when there was no match)
  if (!userResponded && !wasMatch) return;

  // Evaluate final response state against actual matches
  const positionCorrect = stimulus.isPositionMatch === (response.position === true);
  const audioCorrect = stimulus.isAudioMatch === (response.audio === true);

  showCorrectnessFeedback(positionCorrect && audioCorrect);
}

function showCorrectnessFeedback(isCorrect) {
  const grid = document.querySelector('.grid');
  const className = isCorrect ? 'feedback-correct' : 'feedback-incorrect';

  // Remove any existing feedback classes
  grid.classList.remove('feedback-correct', 'feedback-incorrect');

  // Force reflow to restart animation
  void grid.offsetWidth;

  grid.classList.add(className);

  // Remove after animation completes
  setTimeout(() => {
    grid.classList.remove(className);
  }, 300);
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

function calculateScores(sequence, responses, nLevel) {
  let position = { tp: 0, fp: 0, fn: 0 };
  let audio = { tp: 0, fp: 0, fn: 0 };

  for (let i = nLevel; i < sequence.length; i++) {
    // Use pre-computed match flags from sequence generation
    const wasPositionMatch = sequence[i].isPositionMatch;
    const wasAudioMatch = sequence[i].isAudioMatch;

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
    levelUpMessage.className = 'level-up-message level-up';
    levelUpMessage.style.display = 'block';
  } else if (scores.overallPct < LEVEL_DOWN_THRESHOLD && nLevel > 1) {
    nLevel--;
    document.getElementById('n-value').textContent = nLevel;
    levelUpMessage.textContent = `Dropped to ${nLevel}-Back`;
    levelUpMessage.className = 'level-up-message level-down';
    levelUpMessage.style.display = 'block';
  } else {
    levelUpMessage.style.display = 'none';
  }
}

function endGame() {
  gameActive = false;

  const scores = calculateScores(sequence, responses, nLevel);
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
// KEYBOARD CONTROLS (Desktop)
// ===========================================
// Arrow keys map to same directions as swipes:
// Left = position match, Right = audio match, Up = both, Down = neither

document.addEventListener('keydown', (e) => {
  if (!gameActive) return;

  switch(e.key) {
    case 'ArrowLeft':
      handleInput('left');
      e.preventDefault();
      break;
    case 'ArrowRight':
      handleInput('right');
      e.preventDefault();
      break;
    case 'ArrowUp':
      handleInput('up');
      e.preventDefault();
      break;
    case 'ArrowDown':
      handleInput('down');
      e.preventDefault();
      break;
    case 'Escape':
      exitGame();
      e.preventDefault();
      break;
  }
});

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

// Display service worker cache version
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(reg => {
    reg.active?.postMessage({ type: 'GET_VERSION' });
  });
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data.type === 'VERSION') {
      document.getElementById('cache-version').textContent = e.data.version;
    }
  });
}
