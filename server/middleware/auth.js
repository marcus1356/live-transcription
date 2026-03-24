'use strict';
const jwt = require('jsonwebtoken');
const { getUserById } = require('../db');

const SECRET = () => process.env.JWT_SECRET || 'change-me-in-production';

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token required' });
  try {
    const payload = jwt.verify(header.slice(7), SECRET());
    const user = getUserById(payload.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
}

module.exports = { authMiddleware, adminMiddleware, SECRET };
