import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env — server không thể khởi động.'
  );
}

// Service role key bypass RLS hoàn toàn -> KHÔNG BAO GIỜ để lộ key này ra frontend.
// Client này chỉ được import và dùng ở backend.
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
