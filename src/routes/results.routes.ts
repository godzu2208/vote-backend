import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getResults } from '../services/voteService';
import { supabaseAdmin } from '../config/supabaseAdmin';

const router = Router();

router.get('/results/:sessionId', authMiddleware, async (req, res) => {
  try {
    // Chỉ trả kết quả khi session đã đóng, tránh lộ số liệu giữa chừng qua endpoint này
    const { data: session, error } = await supabaseAdmin
      .from('sessions')
      .select('status')
      .eq('id', req.params.sessionId)
      .single();

    if (error) throw error;
    if (!session || session.status !== 'closed') {
      return res.status(409).json({ error: 'session_not_closed', message: 'Kết quả chưa được chốt.' });
    }

    const results = await getResults(req.params.sessionId);
    return res.json(results);
  } catch (err) {
    console.error('[GET /results/:sessionId]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
