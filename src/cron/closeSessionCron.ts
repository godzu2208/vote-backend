import { supabaseAdmin } from "../config/supabaseAdmin";
import { closeSession } from "../services/voteService";

const CHECK_INTERVAL_MS =
  Number(process.env.SESSION_CLOSE_CHECK_INTERVAL_MS) || 2000;

/**
 * Dùng setInterval thuần thay vì thư viện cron, vì cần chu kỳ ngắn (vài giây)
 * để tự động đóng session ngay khi hết giờ. Dùng cờ `isRunning` để tránh
 * 2 lượt kiểm tra chạy chồng nhau nếu 1 lượt bị chậm.
 */
let isRunning = false;

export function startCloseSessionWatcher() {
  setInterval(async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      const { data: sessions, error } = await supabaseAdmin
        .from("sessions")
        .select("id")
        .eq("status", "active")
        .lte("ended_at", new Date().toISOString());

      if (error) {
        console.error("[closeSessionWatcher] lỗi query sessions:", error);
        return;
      }

      for (const session of sessions ?? []) {
        try {
          await closeSession(session.id);
          console.log(
            `[closeSessionWatcher] đã khóa session ${session.id} (hết giờ)`,
          );
        } catch (err) {
          console.error(
            `[closeSessionWatcher] lỗi khóa session ${session.id}:`,
            err,
          );
        }
      }
    } finally {
      isRunning = false;
    }
  }, CHECK_INTERVAL_MS);

  console.log(
    `[closeSessionWatcher] đang chạy, kiểm tra mỗi ${CHECK_INTERVAL_MS}ms`,
  );
}
