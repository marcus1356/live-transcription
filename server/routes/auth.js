'use strict';
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { createUser, getUserByEmail, setAdmin, countUsers } = require('../db');
const { SECRET } = require('../middleware/auth');

function makeToken(userId) {
  return jwt.sign({ userId }, SECRET(), { expiresIn: '30d' });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'email, password e name são obrigatórios' });
  if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres' });
  if (getUserByEmail(email)) return res.status(409).json({ error: 'E-mail já cadastrado' });

  const hash = await bcrypt.hash(password, 10);
  const isFirst = countUsers() === 0;
  const user = createUser(email, hash, name);
  if (isFirst) setAdmin(user.id); // first signup becomes admin
  res.json({ token: makeToken(user.id), user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email e password são obrigatórios' });
  const user = getUserByEmail(email);
  if (!user) return res.status(401).json({ error: 'E-mail ou senha incorretos' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'E-mail ou senha incorretos' });
  res.json({ token: makeToken(user.id), user: { id: user.id, email: user.email, name: user.name, plan: user.plan, is_admin: user.is_admin } });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').authMiddleware, (req, res) => {
  const { id, email, name, plan, is_admin } = req.user;
  const { getTodayUsage, PLAN_LIMITS } = require('../db');
  const used  = getTodayUsage(id);
  const limit = PLAN_LIMITS[plan] ?? 30;
  res.json({ id, email, name, plan, is_admin, usage: { used, limit, unlimited: limit === -1 } });
});

module.exports = router;
