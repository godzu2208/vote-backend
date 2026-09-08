import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { upsertSelection, countCurrentSelections } from '../services/voteService';
import { getClientIp, getRawUserAgent } from '../utils/requestMeta';

const router = Router();

// Body: { sessionId: string, optionId: string | null }
router.post('/select', authMiddleware, async (req, res) => {
  const { sessionId, optionId } = req.body ?? {};
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'invalid_body', message: 'Thiếu sessionId.' });
  }
  if (optionId !== null && typeof optionId !== 'string') {
    return res.status(400).json({ error: 'invalid_body', message: 'optionId phải là string hoặc null.' });
  }

  try {
    await upsertSelection({
      sessionId,
      userId: req.user!.id,
      optionId: optionId ?? null,
      userAgent: getRawUserAgent(req),
      ipAddress: getClientIp(req),
    });
    return res.json({ ok: true });
  } catch (err: any) {
    if (err.code === 'session_not_active') {
      return res.status(409).json({
        error: 'session_not_active',
        message: 'Thời gian bình chọn đã kết thúc, không thể chọn/đổi đáp án nữa.',
      });
    }
    console.error('[POST /select]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Đếm số lượng đã chọn hiện tại - dùng để hiển thị realtime lúc đang mở vote
// (nếu không muốn dùng Supabase Realtime subscribe trực tiếp từ frontend).
router.get('/select/count/:sessionId', authMiddleware, async (req, res) => {
  try {
    const count = await countCurrentSelections(req.params.sessionId);
    return res.json({ count });
  } catch (err) {
    console.error('[GET /select/count]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
