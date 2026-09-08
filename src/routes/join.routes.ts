import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { joinSession } from '../services/voteService';
import { getClientIp, getRawUserAgent } from '../utils/requestMeta';

const router = Router();

router.post('/join', authMiddleware, async (req, res) => {
  const { sessionId } = req.body ?? {};
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'invalid_body', message: 'Thiếu sessionId.' });
  }

  try {
    const result = await joinSession({
      sessionId,
      userId: req.user!.id,
      userAgent: getRawUserAgent(req),
      ipAddress: getClientIp(req),
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[POST /join]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
