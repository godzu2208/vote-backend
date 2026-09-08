import { Router } from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import {
  getSessionInfo,
  startSession,
  closeSession,
  pauseSession,
  resumeSession,
} from '../services/voteService';

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

// Tạm dừng đếm giờ (chỉ hợp lệ khi đang 'active').
router.post('/session/:id/pause', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await pauseSession(req.params.id);
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    if (err.code === 'session_not_active') {
      return res.status(409).json({
        error: 'session_not_active',
        message: 'Chỉ có thể tạm dừng khi vote đang mở (active).',
      });
    }
    console.error('[POST /session/:id/pause]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Chạy tiếp từ chỗ đã dừng (chỉ hợp lệ khi đang 'paused').
router.post('/session/:id/resume', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await resumeSession(req.params.id);
    return res.json(result);
  } catch (err: any) {
    if (err.code === 'session_not_paused') {
      return res.status(409).json({
        error: 'session_not_paused',
        message: 'Chỉ có thể resume khi đang ở trạng thái paused.',
      });
    }
    console.error('[POST /session/:id/resume]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Khóa thủ công (ngoài cron tự động khi hết giờ) - chốt kết quả cuối cùng.
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
