import cron from 'node-cron';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { closeSession } from '../services/voteService';

const CHECK_INTERVAL_MS = Number(process.env.SESSION_CLOSE_CHECK_INTERVAL_MS) || 2000;

/**
 * Vì node-cron chỉ hỗ trợ tối thiểu 1 giây theo cú pháp cron chuẩn (khó biểu diễn
 * "mỗi 2 giây" gọn gàng), dùng setInterval thuần cho chu kỳ ngắn thay vì ép cron string.
 * Dùng cờ `isRunning` để tránh 2 lượt kiểm tra chạy chồng nhau nếu 1 lượt bị chậm.
 */
let isRunning = false;

export function startCloseSessionWatcher() {
  setInterval(async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      const { data: sessions, error } = await supabaseAdmin
        .from('sessions')
        .select('id')
        .eq('status', 'active')
        .lte('ended_at', new Date().toISOString());

      if (error) {
        console.error('[closeSessionWatcher] lỗi query sessions:', error);
        return;
      }

      for (const session of sessions ?? []) {
        try {
          await closeSession(session.id);
          console.log(`[closeSessionWatcher] đã khóa session ${session.id} (hết giờ)`);
        } catch (err) {
          console.error(`[closeSessionWatcher] lỗi khóa session ${session.id}:`, err);
        }
      }
    } finally {
      isRunning = false;
    }
  }, CHECK_INTERVAL_MS);

  console.log(`[closeSessionWatcher] đang chạy, kiểm tra mỗi ${CHECK_INTERVAL_MS}ms`);
}

// Giữ import cron để không bị tree-shake / báo lỗi unused nếu sau này
// muốn chuyển sang lịch cron thực sự (ví dụ dọn dẹp dữ liệu cũ hàng ngày).
export { cron };
