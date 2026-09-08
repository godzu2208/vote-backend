import { Router } from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { formatUserAgent } from '../utils/requestMeta';

const router = Router();

// GET /logs?sessionId=&userId=&action=&page=&pageSize=
router.get('/logs', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { sessionId, userId, action } = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Number(req.query.pageSize) || 50);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabaseAdmin
      .from('vote_logs')
      .select(
        `id, session_id, user_id, action, option_id, user_agent, ip_address, created_at,
         profiles ( email, full_name ),
         options ( label )`,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    if (sessionId) query = query.eq('session_id', sessionId);
    if (userId) query = query.eq('user_id', userId);
    if (action) query = query.eq('action', action);

    const { data, error, count } = await query;
    if (error) throw error;

    const rows = (data ?? []).map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      userEmail: row.profiles?.email ?? null,
      userName: row.profiles?.full_name ?? null,
      action: row.action,
      optionId: row.option_id,
      optionLabel: row.options?.label ?? null,
      userAgentRaw: row.user_agent,
      userAgentReadable: formatUserAgent(row.user_agent),
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    }));

    return res.json({ rows, total: count ?? 0, page, pageSize });
  } catch (err) {
    console.error('[GET /logs]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
