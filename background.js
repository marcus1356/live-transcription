chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    translateText(request.text, request.apiKey, request.openaiKey)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request.action === 'transcribe') {
    transcribeAudio(request.audioData, request.mimeType, request.openaiKey)
      .then(text => sendResponse({ success: true, text }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ── Transcription (Whisper) ────────────────────────────────────────────────────

async function transcribeAudio(audioData, mimeType, openaiKey) {
  if (!openaiKey) throw new Error('OpenAI key required for transcription');

  const binary = atob(audioData);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType || 'audio/webm' });

  const formData = new FormData();
  formData.append('file', blob, 'audio.webm');
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');

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
  return data.text?.trim() || '';
}

// ── Translation (Claude → OpenAI → MyMemory) ──────────────────────────────────

async function translateText(text, apiKey, openaiKey) {
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
          messages: [{ role: 'user', content: `Translate to Brazilian Portuguese. Return ONLY the translation:\n\n${text}` }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return { translation: data.content[0].text.trim(), provider: 'claude' };
      }
    } catch (_) {}
  }

  // 2. OpenAI GPT-4o-mini
  if (openaiKey) {
    try {
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
            { role: 'system', content: 'Translate English to Brazilian Portuguese. Return ONLY the translation.' },
            { role: 'user', content: text },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return { translation: data.choices[0].message.content.trim(), provider: 'openai' };
      }
    } catch (_) {}
  }

  // 3. MyMemory (free fallback)
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en|pt-BR';
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { translation: data.responseData.translatedText, provider: 'mymemory' };
}
