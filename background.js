// ── Live Translator background.js ─────────────────────────────────────────────

// ── Keyboard shortcut commands (Item 9) ───────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  const tabs = await chrome.tabs.query({});
  const testTab = tabs.find(t => t.url && t.url.includes('test.html'));
  if (!testTab) return;
  if (command === 'toggle-mic') {
    chrome.tabs.sendMessage(testTab.id, { action: 'shortcut-toggle-mic' }).catch(() => {});
  } else if (command === 'toggle-sys-audio') {
    chrome.tabs.sendMessage(testTab.id, { action: 'shortcut-toggle-sys-audio' }).catch(() => {});
  }
});

// ── Message router ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'translate') {
    const opts = {
      context:            request.context    || [],
      glossary:           request.glossary   || {},
      backendUrl:         request.backendUrl || null,
      previousTranscript: request.previousTranscript || null,
    };
    translateText(request.text, request.apiKey, request.openaiKey, request.geminiKey, opts)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err  => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'transcribe') {
    const opts = {
      backendUrl:    request.backendUrl    || null,
      previousText:  request.previousText  || null,
      previousTranscript: request.previousTranscript || null,
    };
    transcribeAudio(request.audioData, request.mimeType, request.openaiKey, opts)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err   => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Item 12 – tabCapture helpers
  if (request.action === 'getMyTabId') {
    sendResponse({ tabId: sender.tab ? sender.tab.id : null });
    return false;
  }

  if (request.action === 'getTabStreamId') {
    (async () => {
      try {
        // Find a Meet/Teams/Zoom tab
        const allTabs = await chrome.tabs.query({});
        const meetTab = allTabs.find(t =>
          t.url && (
            t.url.includes('meet.google.com') ||
            t.url.includes('teams.microsoft.com') ||
            t.url.includes('zoom.us')
          )
        );
        if (!meetTab) {
          sendResponse({ success: false, error: 'Nenhuma aba Meet/Teams/Zoom encontrada' });
          return;
        }
        chrome.tabCapture.getMediaStreamId(
          { consumerTabId: request.consumerTabId, targetTabId: meetTab.id },
          (streamId) => {
            if (chrome.runtime.lastError) {
              sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ success: true, streamId, tabTitle: meetTab.title });
            }
          }
        );
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  return false;
});

// ── Cost estimation helpers (Item 18) ─────────────────────────────────────────
function estimateTokens(text) {
  // Rough: ~4 chars per token
  return Math.ceil((text || '').length / 4);
}

function estimateTranslationCost(provider, inputText, outputText) {
  const inTok  = estimateTokens(inputText);
  const outTok = estimateTokens(outputText);
  if (provider === 'claude') {
    return (inTok * 0.25 + outTok * 1.25) / 1_000_000;
  } else if (provider === 'openai') {
    return (inTok * 0.15 + outTok * 0.60) / 1_000_000;
  } else if (provider === 'gemini') {
    return (inTok * 0.075 + outTok * 0.30) / 1_000_000;
  }
  return 0;
}

function estimateWhisperCost(audioDurationSeconds) {
  // $0.006 per minute
  return (audioDurationSeconds / 60) * 0.006;
}

// ── Text deduplication (Item 15) ──────────────────────────────────────────────
function deduplicateText(previousText, newText) {
  if (!previousText || !newText) return newText;

  const prevWords = previousText.trim().split(/\s+/);
  const newWords  = newText.trim().split(/\s+/);

  // Check longest common suffix of previousText matching prefix of newText (3-15 words)
  let overlapLen = 0;
  for (let len = Math.min(15, prevWords.length, newWords.length); len >= 3; len--) {
    const suffix = prevWords.slice(-len).join(' ').toLowerCase();
    const prefix = newWords.slice(0, len).join(' ').toLowerCase();
    if (suffix === prefix) {
      overlapLen = len;
      break;
    }
  }

  let result = overlapLen > 0 ? newWords.slice(overlapLen).join(' ') : newText;

  // Remove exact sentence repetitions (Whisper sometimes repeats last sentence verbatim)
  if (previousText.trim().length > 10) {
    const prevSentences = previousText.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
    const lastSentence  = prevSentences[prevSentences.length - 1];
    if (lastSentence && lastSentence.length > 10 && result.toLowerCase().startsWith(lastSentence.toLowerCase())) {
      result = result.slice(lastSentence.length).replace(/^[\s,]+/, '');
    }
  }

  return result.trim() || newText;
}

// ── Transcription (Whisper) (Item 15 + backend proxy) ─────────────────────────
async function transcribeAudio(audioData, mimeType, openaiKey, opts = {}) {
  const { backendUrl, previousText } = opts;

  const binary = atob(audioData);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType || 'audio/webm' });

  // Whisper cost: assume ~5s average chunk = 5/60 min
  const audioDurationEst = 5;
  const cost = estimateWhisperCost(audioDurationEst);

  let rawText;

  // Item 14 – backend proxy
  if (backendUrl) {
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'audio.webm');
      const res = await fetch(`${backendUrl}/api/transcribe`, {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        rawText = data.text;
      }
    } catch (_) {}
  }

  if (rawText === undefined) {
    if (!openaiKey) throw new Error('OpenAI key required for transcription');

    const formData = new FormData();
    formData.append('file', blob, 'audio.webm');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    // Item 1 – pass previous_text as prompt hint
    if (previousText) {
      formData.append('prompt', previousText);
    }

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    rawText = data.text?.trim() || '';
  }

  // Item 15 – deduplicate
  const text = deduplicateText(previousText, rawText);

  return { text, cost };
}

// ── Translation (Claude → OpenAI → Gemini → MyMemory) ────────────────────────
// Item 3: context-aware, Item 4: glossary, Item 13: Gemini, Item 14: backend
async function translateText(text, apiKey, openaiKey, geminiKey, opts = {}) {
  const { context = [], glossary = {}, backendUrl = null } = opts;

  // Build extra instructions from context and glossary
  let extraInstructions = '';
  if (context.length > 0) {
    extraInstructions += `Contexto anterior: ${context.join(' | ')}. Traduza mantendo coerência com o contexto.\n`;
  }
  const glossaryEntries = Object.entries(glossary);
  if (glossaryEntries.length > 0) {
    const glossaryStr = glossaryEntries.map(([en, pt]) => `${en}→${pt}`).join(', ');
    extraInstructions += `Use estas traduções: ${glossaryStr}.\n`;
  }

  const prompt = extraInstructions
    ? `${extraInstructions}Translate to Brazilian Portuguese. Return ONLY the translation:\n\n${text}`
    : `Translate to Brazilian Portuguese. Return ONLY the translation:\n\n${text}`;

  // Item 14 – backend proxy
  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, context, glossary }),
      });
      if (res.ok) {
        const data = await res.json();
        const cost = estimateTranslationCost(data.provider, text, data.translation);
        return { translation: data.translation, provider: data.provider, cost };
      }
    } catch (_) {}
  }

  // 1. Claude Haiku
  if (apiKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const translation = data.content[0].text.trim();
        const cost = estimateTranslationCost('claude', prompt, translation);
        return { translation, provider: 'claude', cost };
      }
    } catch (_) {}
  }

  // 2. OpenAI GPT-4o-mini
  if (openaiKey) {
    try {
      const sysMsg = extraInstructions
        ? `Translate English to Brazilian Portuguese. Return ONLY the translation.\n${extraInstructions}`
        : 'Translate English to Brazilian Portuguese. Return ONLY the translation.';
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 300,
          messages: [
            { role: 'system', content: sysMsg },
            { role: 'user', content: text },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const translation = data.choices[0].message.content.trim();
        const cost = estimateTranslationCost('openai', sysMsg + text, translation);
        return { translation, provider: 'openai', cost };
      }
    } catch (_) {}
  }

  // 3. Gemini 1.5 Flash (Item 13)
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 300 },
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const translation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        if (translation) {
          const cost = estimateTranslationCost('gemini', prompt, translation);
          return { translation, provider: 'gemini', cost };
        }
      }
    } catch (_) {}
  }

  // 4. MyMemory (free fallback)
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en|pt-BR';
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { translation: data.responseData.translatedText, provider: 'mymemory', cost: 0 };
}
