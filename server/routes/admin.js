'use strict';
const router = require('express').Router();
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { getAllUsers, updateUserPlan, getStats } = require('../db');

router.use(authMiddleware, adminMiddleware);

router.get('/stats', (_req, res) => res.json(getStats()));

router.get('/users', (_req, res) => res.json(getAllUsers()));

router.patch('/users/:id/plan', (req, res) => {
  const { plan } = req.body;
  if (!['free','pro','school'].includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
  updateUserPlan(Number(req.params.id), plan);
  res.json({ ok: true });
});

module.exports = router;
