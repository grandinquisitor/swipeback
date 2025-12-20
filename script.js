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

  gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
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

function endGame() {
  gameActive = false;

  // Calculate scores
  let positionCorrect = 0;
  let audioCorrect = 0;
  let positionTotal = 0;
  let audioTotal = 0;

  for (let i = nLevel; i < history.length; i++) {
    const wasPositionMatch = history[i].position === history[i - nLevel].position;
    const wasAudioMatch = history[i].letter === history[i - nLevel].letter;

    const response = responses[i];
    const respondedPosition = response.position === true;
    const respondedAudio = response.audio === true;

    positionTotal++;
    audioTotal++;

    if (wasPositionMatch === respondedPosition) positionCorrect++;
    if (wasAudioMatch === respondedAudio) audioCorrect++;
  }

  const positionPct = Math.round((positionCorrect / positionTotal) * 100);
  const audioPct = Math.round((audioCorrect / audioTotal) * 100);
  const overallPct = Math.round(((positionCorrect + audioCorrect) / (positionTotal + audioTotal)) * 100);

  // Update the last results display
  document.getElementById('last-position').textContent = `${positionPct}%`;
  document.getElementById('last-audio').textContent = `${audioPct}%`;
  document.getElementById('last-overall').textContent = `${overallPct}%`;

  // Show the results panel
  document.getElementById('last-results').classList.add('show');

  // Check if player should level up
  const levelUpMessage = document.getElementById('level-up-message');
  if (overallPct >= LEVEL_UP_THRESHOLD && nLevel < 9) {
    nLevel++;
    document.getElementById('n-value').textContent = nLevel;
    levelUpMessage.textContent = `Level up! Now playing ${nLevel}-Back`;
    levelUpMessage.style.display = 'block';
  } else {
    levelUpMessage.style.display = 'none';
  }

  // Return to start screen
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

// Start loading audio files on page load
loadAudioFiles();
