'use strict';

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const FormData = require('form-data');
const axios    = require('axios');

const app  = express();
const port = parseInt(process.env.PORT || '3001', 10);

// ── Multer (in-memory storage for audio files) ────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB max (Whisper limit)
});

// ── CORS: allow chrome-extension:// and localhost origins ────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow non-browser requests
    if (
      origin.startsWith('chrome-extension://') ||
      origin.startsWith('http://localhost') ||
      origin.startsWith('http://127.0.0.1')
    ) {
      return callback(null, true);
    }
    callback(new Error('CORS: origin not allowed: ' + origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '2mb' }));

// ── GET /api/health ───────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ── Cost estimation helpers ───────────────────────────────────────────────────
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}
function estimateCost(provider, inputText, outputText) {
  const i = estimateTokens(inputText), o = estimateTokens(outputText);
  if (provider === 'claude')  return (i * 0.25 + o * 1.25) / 1_000_000;
  if (provider === 'openai')  return (i * 0.15 + o * 0.60) / 1_000_000;
  if (provider === 'gemini')  return (i * 0.075 + o * 0.30) / 1_000_000;
  return 0;
}

// ── POST /api/translate ───────────────────────────────────────────────────────
app.post('/api/translate', async (req, res) => {
  const { text, context = [], glossary = {} } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey    = process.env.OPENAI_API_KEY;
  const geminiKey    = process.env.GEMINI_API_KEY;

  if (!anthropicKey && !openaiKey && !geminiKey) {
    return res.status(500).json({ error: 'No API keys configured on server' });
  }

  // Build extra instructions
  let extra = '';
  if (context.length > 0) extra += `Contexto anterior: ${context.join(' | ')}. Traduza mantendo coerência com o contexto.\n`;
  const glossaryEntries = Object.entries(glossary);
  if (glossaryEntries.length > 0) {
    extra += `Use estas traduções: ${glossaryEntries.map(([en, pt]) => `${en}→${pt}`).join(', ')}.\n`;
  }
  const prompt = extra
    ? `${extra}Translate to Brazilian Portuguese. Return ONLY the translation:\n\n${text}`
    : `Translate to Brazilian Portuguese. Return ONLY the translation:\n\n${text}`;

  // 1. Claude
  if (anthropicKey) {
    try {
      const r = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }, {
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      });
      const translation = r.data.content[0].text.trim();
      return res.json({ translation, provider: 'claude', cost: estimateCost('claude', prompt, translation) });
    } catch (err) {
      console.warn('[translate] Claude error:', err.response?.data?.error?.message || err.message);
    }
  }

  // 2. OpenAI GPT-4o-mini
  if (openaiKey) {
    try {
      const sysMsg = extra
        ? `Translate English to Brazilian Portuguese. Return ONLY the translation.\n${extra}`
        : 'Translate English to Brazilian Portuguese. Return ONLY the translation.';
      const r = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        max_tokens: 300,
        messages: [
          { role: 'system', content: sysMsg },
          { role: 'user', content: text },
        ],
      }, {
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      });
      const translation = r.data.choices[0].message.content.trim();
      return res.json({ translation, provider: 'openai', cost: estimateCost('openai', sysMsg + text, translation) });
    } catch (err) {
      console.warn('[translate] OpenAI error:', err.response?.data?.error?.message || err.message);
    }
  }

  // 3. Gemini 1.5 Flash
  if (geminiKey) {
    try {
      const r = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 300 },
        },
        { headers: { 'Content-Type': 'application/json' } }
      );
      const translation = r.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      if (translation) {
        return res.json({ translation, provider: 'gemini', cost: estimateCost('gemini', prompt, translation) });
      }
    } catch (err) {
      console.warn('[translate] Gemini error:', err.response?.data?.error?.message || err.message);
    }
  }

  // 4. MyMemory fallback
  try {
    const mmUrl = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en|pt-BR';
    const r = await axios.get(mmUrl);
    return res.json({ translation: r.data.responseData.translatedText, provider: 'mymemory', cost: 0 });
  } catch (err) {
    return res.status(502).json({ error: 'All translation providers failed', details: err.message });
  }
});

// ── POST /api/transcribe ──────────────────────────────────────────────────────
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'audio file is required' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured on server' });

  try {
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename:    'audio.webm',
      contentType: req.file.mimetype || 'audio/webm',
    });
    form.append('model', 'whisper-1');
    form.append('language', 'en');

    if (req.body.previousText) {
      form.append('prompt', req.body.previousText);
    }

    const r = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        ...form.getHeaders(),
      },
      maxBodyLength: 30 * 1024 * 1024,
    });

    const text = r.data.text?.trim() || '';
    // Whisper cost: assume 5s average clip
    const cost = (5 / 60) * 0.006;
    return res.json({ text, cost });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('[transcribe] error:', msg);
    return res.status(502).json({ error: msg });
  }
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err.message);
  res.status(500).json({ error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`[live-translator-proxy] listening on http://localhost:${port}`);
  console.log(`  Anthropic key: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'NOT SET'}`);
  console.log(`  OpenAI key:    ${process.env.OPENAI_API_KEY    ? 'configured' : 'NOT SET'}`);
  console.log(`  Gemini key:    ${process.env.GEMINI_API_KEY    ? 'configured' : 'NOT SET'}`);
});
