const $ = id => document.getElementById(id);

// ── Load saved settings ────────────────────────────────────────────────────────
chrome.storage.sync.get(
  ['apiKey', 'openaiKey', 'geminiKey', 'backendUrl', 'glossary', 'enabled'],
  ({ apiKey, openaiKey, geminiKey, backendUrl, glossary, enabled }) => {
    if (apiKey)     $('apiKey').value     = apiKey;
    if (openaiKey)  $('openaiKey').value  = openaiKey;
    if (geminiKey)  $('geminiKey').value  = geminiKey;
    if (backendUrl) $('backendUrl').value = backendUrl;
    $('enabled').checked = enabled !== false;

    // Glossary: convert object to text
    if (glossary && typeof glossary === 'object') {
      const lines = Object.entries(glossary).map(([en, pt]) => `${en} = ${pt}`);
      $('glossaryText').value = lines.join('\n');
    }

    // Item 17 – show onboarding banner if no keys configured
    const hasKeys = !!(apiKey || openaiKey || geminiKey || backendUrl);
    chrome.storage.local.get(['onboardingComplete'], ({ onboardingComplete }) => {
      if (!hasKeys && !onboardingComplete) {
        $('onboardingBanner').style.display = 'block';
      }
    });
  }
);

// ── Auto-save toggle immediately ──────────────────────────────────────────────
$('enabled').addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: $('enabled').checked });
});

// ── Show/hide API keys ────────────────────────────────────────────────────────
function makeToggle(btnId, inputId) {
  $(btnId).addEventListener('click', () => {
    const input = $(inputId);
    input.type = input.type === 'password' ? 'text' : 'password';
    $(btnId).textContent = input.type === 'password' ? '👁' : '🙈';
  });
}
makeToggle('toggleKey', 'apiKey');
makeToggle('toggleOpenaiKey', 'openaiKey');
makeToggle('toggleGeminiKey', 'geminiKey');

// ── Collapsible sections ──────────────────────────────────────────────────────
function makeCollapsible(toggleId, bodyId, chevronId) {
  $(toggleId).addEventListener('click', () => {
    const body    = $(bodyId);
    const chevron = $(chevronId);
    const isOpen  = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    chevron.classList.toggle('open', !isOpen);
  });
}
makeCollapsible('advancedToggle', 'advancedBody', 'advancedChevron');
makeCollapsible('glossaryToggle', 'glossaryBody', 'glossaryChevron');

// ── Save button ───────────────────────────────────────────────────────────────
$('save').addEventListener('click', () => {
  const apiKey     = $('apiKey').value.trim();
  const openaiKey  = $('openaiKey').value.trim();
  const geminiKey  = $('geminiKey').value.trim();
  const backendUrl = $('backendUrl').value.trim().replace(/\/$/, '');
  const enabled    = $('enabled').checked;

  if (!apiKey && !openaiKey && !geminiKey && !backendUrl) {
    showStatus('Insira ao menos uma API Key ou Backend URL', 'error');
    return;
  }

  // Parse glossary textarea: "english = português" per line
  const glossaryRaw = $('glossaryText').value.trim();
  const glossary = {};
  if (glossaryRaw) {
    for (const line of glossaryRaw.split('\n')) {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const en = parts[0].trim();
        const pt = parts.slice(1).join('=').trim();
        if (en && pt) glossary[en] = pt;
      }
    }
  }

  chrome.storage.sync.set(
    { apiKey, openaiKey, geminiKey, backendUrl, glossary, enabled, mode: 'caption' },
    () => {
      showStatus('Salvo ✓');
      $('onboardingBanner').style.display = 'none';
    }
  );
});

// ── Onboarding link (Item 17) ─────────────────────────────────────────────────
$('onboardingLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  window.close();
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
