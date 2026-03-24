// ── Live Transcription Translator ────────────────────────────────────────────

// ── Panel UI ──────────────────────────────────────────────────────────────────

function createPanel() {
  if (document.getElementById('lt-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'lt-panel';
  panel.innerHTML = `
    <div id="lt-header">
      <span id="lt-title">🌐 Live Translator</span>
      <div id="lt-header-actions">
        <span id="lt-status-dot"></span>
        <button id="lt-mic-btn" title="Falar em inglês">🎤</button>
        <button id="lt-toggle-size" title="Expandir">⤢</button>
        <button id="lt-close" title="Fechar">✕</button>
      </div>
    </div>
    <div id="lt-mic-bar" style="display:none">
      <span id="lt-mic-indicator">●</span>
      <span id="lt-mic-interim">ouvindo...</span>
    </div>
    <div id="lt-history"></div>
    <div id="lt-empty">
      <div>🎧</div>
      <div>Aguardando legendas em inglês...<br>Ou clique em 🎤 para falar</div>
    </div>
  `;
  document.body.appendChild(panel);
  document.getElementById('lt-close').onclick       = () => { stopMic(); panel.remove(); };
  document.getElementById('lt-toggle-size').onclick = () => panel.classList.toggle('lt-expanded');
  document.getElementById('lt-mic-btn').onclick     = toggleMic;
}

// ── Entry management ──────────────────────────────────────────────────────────

let currentEntryEl = null;
let lastEN = '';

function addEntry(en) {
  const history = document.getElementById('lt-history');
  if (!history) return null;
  document.getElementById('lt-empty').style.display = 'none';

  if (currentEntryEl) currentEntryEl.classList.remove('lt-active');

  const el = document.createElement('div');
  el.className = 'lt-entry lt-active';
  el.innerHTML =
    '<div class="lt-en"><span class="lt-flag">🇺🇸</span><span>' + esc(en) + '</span></div>' +
    '<div class="lt-pt lt-pending"><span class="lt-flag">🇧🇷</span><span>traduzindo...</span></div>';

  history.appendChild(el);
  currentEntryEl = el;

  // Keep max 150 entries
  while (history.children.length > 150) history.removeChild(history.firstChild);

  // Scroll to bottom only if user is already at bottom
  const atBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 60;
  if (atBottom) history.scrollTop = history.scrollHeight;

  setStatusDot(true);
  return el;
}

function updatePT(entryEl, en, pt) {
  if (!entryEl) return;
  const d = entryEl.querySelector('.lt-pt');
  if (!d) return;
  d.className = 'lt-pt';
  d.innerHTML = '<span class="lt-flag">🇧🇷</span><span>' + esc(pt) + '</span>';
  chrome.storage.local.set({ liveTranslation: { en, pt, ts: Date.now() } });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ── Status dot ────────────────────────────────────────────────────────────────

let dotTimer = null;
function setStatusDot(on) {
  const dot = document.getElementById('lt-status-dot');
  if (!dot) return;
  dot.className = on ? 'on' : '';
  clearTimeout(dotTimer);
  if (on) dotTimer = setTimeout(() => setStatusDot(false), 6000);
}

// ── Settings ──────────────────────────────────────────────────────────────────

function getSettings() {
  return new Promise(r => chrome.storage.sync.get(['apiKey', 'openaiKey', 'enabled'], r));
}

// ── Translation ───────────────────────────────────────────────────────────────

let inFlight = false;

async function translate(text) {
  if (!text || text === lastEN) return;
  if (inFlight) return;

  const { apiKey, openaiKey, enabled } = await getSettings();
  if (enabled === false) return;

  lastEN = text;
  inFlight = true;
  const entryEl = addEntry(text);

  try {
    chrome.runtime.sendMessage({ action: 'translate', text, apiKey, openaiKey }, (res) => {
      inFlight = false;
      if (chrome.runtime.lastError) return;
      updatePT(entryEl, text, res?.success ? res.translation : ('⚠ ' + (res?.error || 'erro')));
    });
  } catch (_) {
    inFlight = false;
  }
}

// ── Caption mode (MutationObserver) ──────────────────────────────────────────

let lastRaw = '';
let captionDebounce = null;
let observer = null;

function extractCaption() {
  for (const el of document.querySelectorAll('[aria-live]')) {
    const tag  = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    if (['button','nav','header','footer','dialog','script','style'].includes(tag)) continue;
    if (['tooltip','navigation','button','menuitem','alert'].includes(role)) continue;
    // Skip the panel itself
    if (el.closest('#lt-panel')) continue;
    const text = el.textContent?.trim();
    if (text && text.length > 8) return text;
  }
  for (const sel of ['[jsname="YSxPC"]','[jsname="tgaKEf"]','.a4cQT','.TBMuR','.CNusmb']) {
    try {
      const text = document.querySelector(sel)?.textContent?.trim();
      if (text && text.length > 8) return text;
    } catch (_) {}
  }
  return null;
}

function onMutation() {
  const text = extractCaption();
  if (!text || text === lastRaw) return;
  lastRaw = text;
  clearTimeout(captionDebounce);
  captionDebounce = setTimeout(() => translate(text), 350);
}

function startObserver() {
  if (observer) observer.disconnect();
  observer = new MutationObserver(onMutation);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function stopObserver() {
  observer?.disconnect(); observer = null;
  clearTimeout(captionDebounce);
}

// ── Mic mode (Web Speech API) ─────────────────────────────────────────────────

let recognition   = null;
let micActive     = false;
let micDebounce   = null;
let lastInterim   = '';

function toggleMic() { micActive ? stopMic() : startMic(); }

function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('Use o Chrome para reconhecimento de voz.'); return; }

  recognition = new SR();
  recognition.lang            = 'en-US';
  recognition.continuous      = true;
  recognition.interimResults  = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    micActive = true;
    const btn = document.getElementById('lt-mic-btn');
    const bar = document.getElementById('lt-mic-bar');
    if (btn) { btn.textContent = '⏹'; btn.title = 'Parar'; btn.classList.add('lt-mic-on'); }
    if (bar) bar.style.display = 'flex';
  };

  recognition.onresult = (event) => {
    let interim = '';
    let final   = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      event.results[i].isFinal ? (final += t) : (interim += t);
    }

    const display = (final || interim).trim();
    const interimEl = document.getElementById('lt-mic-interim');
    if (interimEl) interimEl.textContent = display || 'ouvindo...';

    if (final.trim().length > 4) {
      // Frase final confirmada — traduz imediatamente
      clearTimeout(micDebounce);
      lastInterim = '';
      lastEN = '';            // permite re-traduzir
      translate(final.trim());
      if (interimEl) interimEl.textContent = 'ouvindo...';
    } else if (interim.trim().length > 4 && interim.trim() !== lastInterim) {
      // Texto interim — espera 450ms de silêncio antes de traduzir
      lastInterim = interim.trim();
      clearTimeout(micDebounce);
      micDebounce = setTimeout(() => {
        if (!lastInterim) return;
        lastEN = '';
        translate(lastInterim);
        lastInterim = '';
        if (interimEl) interimEl.textContent = 'ouvindo...';
      }, 450);
    }
  };

  recognition.onerror = (e) => {
    if (e.error !== 'no-speech') console.warn('[LT] mic:', e.error);
  };

  recognition.onend = () => {
    if (micActive) recognition.start(); // auto-restart
  };

  recognition.start();
}

function stopMic() {
  micActive = false;
  clearTimeout(micDebounce);
  if (recognition) { recognition.onend = null; recognition.stop(); recognition = null; }
  const btn = document.getElementById('lt-mic-btn');
  const bar = document.getElementById('lt-mic-bar');
  if (btn) { btn.textContent = '🎤'; btn.title = 'Falar em inglês'; btn.classList.remove('lt-mic-on'); }
  if (bar) bar.style.display = 'none';
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const { enabled } = await getSettings();
  if (enabled === false) return;
  // App page has its own full UI — skip panel injection but still observe
  if (document.documentElement.getAttribute('data-lt-app') === 'true') {
    startObserver();
    return;
  }
  createPanel();
  startObserver();
}

chrome.storage.onChanged.addListener(({ enabled }) => {
  if (!enabled) return;
  enabled.newValue === false ? stopObserver() : (createPanel(), startObserver());
});

setTimeout(init, 600);
