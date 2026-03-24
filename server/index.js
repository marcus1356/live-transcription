'use strict';
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const multer   = require('multer');
const FormData = require('form-data');
const axios    = require('axios');

const { authMiddleware }             = require('./middleware/auth');
const { PLAN_LIMITS, getTodayUsage, incrementUsage } = require('./db');

const app  = express();
const port = parseInt(process.env.PORT || '3001', 10);

// ── Static files (web platform) ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Middleware ────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
]);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (
      origin.startsWith('chrome-extension://') ||
      origin.startsWith('http://localhost') ||
      origin.startsWith('http://127.0.0.1') ||
      ALLOWED_ORIGINS.has(origin)
    ) return cb(null, true);
    cb(new Error('CORS not allowed: ' + origin));
  },
  methods: ['GET','POST','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(express.json({ limit: '2mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));

// ── GET /api/health ───────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ── Cost helpers ──────────────────────────────────────────────────────────────
function estimateTokens(t) { return Math.ceil((t||'').length / 4); }
function estimateCost(provider, input, output) {
  const i = estimateTokens(input), o = estimateTokens(output);
  if (provider === 'claude')  return (i * 0.25 + o * 1.25) / 1e6;
  if (provider === 'openai')  return (i * 0.15 + o * 0.60) / 1e6;
  if (provider === 'gemini')  return (i * 0.075 + o * 0.30) / 1e6;
  return 0;
}

// ── POST /api/translate ───────────────────────────────────────────────────────
// Optional auth: logged-in users get their plan limit enforced;
// unauthenticated calls fall through to MyMemory (free fallback only)
app.post('/api/translate', async (req, res) => {
  // Optionally resolve user
  let user = null;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const jwt = require('jsonwebtoken');
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET || 'change-me-in-production');
      user = require('./db').getUserById(payload.userId);
    } catch {}
  }

  // Rate-limit free users
  if (user) {
    const limit = PLAN_LIMITS[user.plan] ?? 30;
    if (limit !== -1) {
      const used = getTodayUsage(user.id);
      if (used >= limit) {
        return res.status(429).json({
          error: `Limite diário atingido (${limit} traduções). Faça upgrade para o plano Pro.`,
          limitReached: true,
        });
      }
    }
    incrementUsage(user.id);
  }

  const { text, context = [], glossary = {} } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey    = process.env.OPENAI_API_KEY;
  const geminiKey    = process.env.GEMINI_API_KEY;

  let extra = '';
  if (context.length > 0) extra += `Contexto anterior: ${context.join(' | ')}. Mantenha coerência.\n`;
  const glossaryEntries = Object.entries(glossary);
  if (glossaryEntries.length > 0) extra += `Use: ${glossaryEntries.map(([e,p])=>`${e}→${p}`).join(', ')}.\n`;
  const prompt = extra
    ? `${extra}Translate to Brazilian Portuguese. Return ONLY the translation:\n\n${text}`
    : `Translate to Brazilian Portuguese. Return ONLY the translation:\n\n${text}`;

  // 1. Claude Haiku
  if (anthropicKey) {
    try {
      const r = await axios.post('https://api.anthropic.com/v1/messages',
        { model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: prompt }] },
        { headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' } }
      );
      const translation = r.data.content[0].text.trim();
      return res.json({ translation, provider: 'claude', cost: estimateCost('claude', prompt, translation) });
    } catch (e) { console.warn('[translate] Claude:', e.response?.data?.error?.message || e.message); }
  }

  // 2. OpenAI GPT-4o-mini
  if (openaiKey) {
    try {
      const sysMsg = extra ? `Translate English to Brazilian Portuguese. Return ONLY the translation.\n${extra}` : 'Translate English to Brazilian Portuguese. Return ONLY the translation.';
      const r = await axios.post('https://api.openai.com/v1/chat/completions',
        { model: 'gpt-4o-mini', max_tokens: 300, messages: [{ role: 'system', content: sysMsg }, { role: 'user', content: text }] },
        { headers: { 'Authorization': `Bearer ${openaiKey}` } }
      );
      const translation = r.data.choices[0].message.content.trim();
      return res.json({ translation, provider: 'openai', cost: estimateCost('openai', sysMsg + text, translation) });
    } catch (e) { console.warn('[translate] OpenAI:', e.response?.data?.error?.message || e.message); }
  }

  // 3. Gemini
  if (geminiKey) {
    try {
      const r = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
        { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 300 } }
      );
      const translation = r.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      if (translation) return res.json({ translation, provider: 'gemini', cost: estimateCost('gemini', prompt, translation) });
    } catch (e) { console.warn('[translate] Gemini:', e.response?.data?.error?.message || e.message); }
  }

  // 4. MyMemory fallback
  try {
    const r = await axios.get('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en|pt-BR');
    return res.json({ translation: r.data.responseData.translatedText, provider: 'mymemory', cost: 0 });
  } catch (e) {
    return res.status(502).json({ error: 'Todos os provedores falharam' });
  }
});

// ── POST /api/transcribe ──────────────────────────────────────────────────────
app.post('/api/transcribe', authMiddleware, upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'audio required' });
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'Whisper não configurado no servidor' });
  try {
    const form = new FormData();
    form.append('file', req.file.buffer, { filename: 'audio.webm', contentType: req.file.mimetype || 'audio/webm' });
    form.append('model', 'whisper-1');
    form.append('language', 'en');
    if (req.body.previousText) form.append('prompt', req.body.previousText);
    const r = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: { 'Authorization': `Bearer ${openaiKey}`, ...form.getHeaders() },
      maxBodyLength: 30 * 1024 * 1024,
    });
    return res.json({ text: r.data.text?.trim() || '', cost: (5/60) * 0.006 });
  } catch (e) {
    return res.status(502).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`\n🌐 Live Translator — http://localhost:${port}`);
  console.log(`  Claude:  ${process.env.ANTHROPIC_API_KEY ? '✓' : '✗ NOT SET'}`);
  console.log(`  OpenAI:  ${process.env.OPENAI_API_KEY    ? '✓' : '✗ NOT SET'}`);
  console.log(`  Gemini:  ${process.env.GEMINI_API_KEY    ? '✓' : '✗ NOT SET'}`);
});
