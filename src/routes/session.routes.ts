import { Router } from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import { getSessionInfo, startSession, closeSession } from '../services/voteService';

const router = Router();

router.get('/session/:id', authMiddleware, async (req, res) => {
  try {
    const info = await getSessionInfo(req.params.id);
    return res.json(info);
  } catch (err) {
    console.error('[GET /session/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Body: { durationSeconds: number }
router.post('/session/:id/start', authMiddleware, requireAdmin, async (req, res) => {
  const durationSeconds = Number(req.body?.durationSeconds);
  if (!durationSeconds || durationSeconds <= 0) {
    return res.status(400).json({ error: 'invalid_body', message: 'Thiếu durationSeconds hợp lệ.' });
  }
  try {
    await startSession(req.params.id, durationSeconds);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[POST /session/:id/start]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Khóa thủ công (ngoài cron tự động khi hết giờ)
router.post('/session/:id/close', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await closeSession(req.params.id);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[POST /session/:id/close]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
