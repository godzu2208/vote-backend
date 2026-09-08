import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';

const ALLOWED_EMAIL_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || 'rever.vn';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * Xác thực mọi request bằng JWT do Supabase phát ra.
 * Không tự decode JWT bằng secret thủ công - luôn nhờ Supabase verify hộ,
 * vì Supabase có thể đổi cơ chế ký (JWKS/asymmetric) mà không báo trước.
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      return res.status(401).json({ error: 'missing_token', message: 'Thiếu token xác thực.' });
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ error: 'invalid_token', message: 'Token không hợp lệ hoặc đã hết hạn.' });
    }

    const email = data.user.email?.toLowerCase() || '';
    const emailDomain = email.split('@')[1];

    if (emailDomain !== ALLOWED_EMAIL_DOMAIN) {
      return res.status(403).json({
        error: 'forbidden_domain',
        message: `Chỉ chấp nhận tài khoản @${ALLOWED_EMAIL_DOMAIN}.`,
      });
    }

    req.user = {
      id: data.user.id,
      email,
      isAdmin: ADMIN_EMAILS.includes(email),
    };

    next();
  } catch (err) {
    console.error('[authMiddleware] lỗi verify token:', err);
    return res.status(500).json({ error: 'auth_internal_error' });
  }
}

/**
 * Chặn route chỉ dành cho admin. Phải đặt SAU authMiddleware.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'admin_only', message: 'Chỉ admin mới được thực hiện thao tác này.' });
  }
  next();
}
