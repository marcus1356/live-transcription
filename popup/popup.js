const $ = id => document.getElementById(id);

// ── Load saved settings ────────────────────────────────────────────────────────

chrome.storage.sync.get(['apiKey', 'openaiKey', 'enabled'], ({ apiKey, openaiKey, enabled }) => {
  if (apiKey)    $('apiKey').value    = apiKey;
  if (openaiKey) $('openaiKey').value = openaiKey;
  $('enabled').checked = enabled !== false;
});

// ── Auto-save toggle immediately ──────────────────────────────────────────────

$('enabled').addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: $('enabled').checked });
});

// ── Show/hide API keys ────────────────────────────────────────────────────────

$('toggleKey').addEventListener('click', () => {
  const input = $('apiKey');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('toggleKey').textContent = input.type === 'password' ? '👁' : '🙈';
});

$('toggleOpenaiKey').addEventListener('click', () => {
  const input = $('openaiKey');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('toggleOpenaiKey').textContent = input.type === 'password' ? '👁' : '🙈';
});

// ── Save button ───────────────────────────────────────────────────────────────

$('save').addEventListener('click', () => {
  const apiKey    = $('apiKey').value.trim();
  const openaiKey = $('openaiKey').value.trim();
  const enabled   = $('enabled').checked;

  if (!apiKey && !openaiKey) {
    showStatus('Insira ao menos uma API Key', 'error');
    return;
  }

  chrome.storage.sync.set({ apiKey, openaiKey, enabled, mode: 'caption' }, () => {
    showStatus('Salvo ✓');
  });
});

// ── Open output window ────────────────────────────────────────────────────────

$('openApp').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('test.html') });
});

$('openOutput').addEventListener('click', () => {
  chrome.windows.create({
    url: chrome.runtime.getURL('output.html'),
    type: 'popup',
    width: 640,
    height: 200,
    focused: true,
  });
});

// ── Status feedback ────────────────────────────────────────────────────────────

function showStatus(msg, type = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status ' + type;
  setTimeout(() => {
    el.textContent = '';
    el.className = 'status';
  }, 2500);
}
