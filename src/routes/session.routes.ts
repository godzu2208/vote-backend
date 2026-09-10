import { Router } from "express";
import { authMiddleware, requireAdmin } from "../middleware/auth";
import {
  getSessionInfo,
  getSessionByCode,
  startSession,
  closeSession,
  pauseSession,
  resumeSession,
  createSession,
  listSessions,
  getLiveStats,
  getJoinedCount,
} from "../services/voteService";

const router = Router();

// Mã tham gia: 3-8 ký tự chữ/số, admin tự đặt (tùy chọn) hoặc để hệ thống tự sinh.
const JOIN_CODE_PATTERN = /^[A-Za-z0-9]{3,8}$/;

// Tạo câu hỏi mới (admin only). Body: { question: string, options: string[], joinCode?: string }
router.post("/session", authMiddleware, requireAdmin, async (req, res) => {
  const { question, options, joinCode } = req.body ?? {};
  if (typeof question !== "string" || !question.trim()) {
    return res
      .status(400)
      .json({ error: "invalid_body", message: "Thiếu question hợp lệ." });
  }
  if (
    !Array.isArray(options) ||
    options.filter((o) => typeof o === "string" && o.trim()).length < 2
  ) {
    return res
      .status(400)
      .json({ error: "invalid_body", message: "Cần tối thiểu 2 lựa chọn." });
  }
  if (joinCode !== undefined && joinCode !== null && joinCode !== "") {
    if (
      typeof joinCode !== "string" ||
      !JOIN_CODE_PATTERN.test(joinCode.trim())
    ) {
      return res.status(400).json({
        error: "invalid_body",
        message: "Mã tham gia phải là 3-8 ký tự chữ hoặc số.",
      });
    }
  }
  try {
    const session = await createSession({ question, options, joinCode });
    return res.status(201).json({ ok: true, session });
  } catch (err: any) {
    if (err.code === "join_code_taken") {
      return res.status(409).json({
        error: "join_code_taken",
        message: "Mã tham gia này đã được dùng, hãy chọn mã khác.",
      });
    }
    if (err.code === "23505" || err?.details?.includes?.("sessions_join_code_uidx")) {
      return res.status(409).json({
        error: "join_code_taken",
        message: "Mã tham gia này đã được dùng, hãy chọn mã khác.",
      });
    }
    if (err.code === "join_code_generation_failed") {
      return res.status(500).json({
        error: "join_code_generation_failed",
        message: "Không thể tự sinh mã tham gia, vui lòng thử lại.",
      });
    }
    console.error("[POST /session]", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// Danh sách toàn bộ câu hỏi đã tạo (admin only).
router.get("/sessions", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const sessions = await listSessions();
    return res.json({ sessions });
  } catch (err) {
    console.error("[GET /sessions]", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// Tra sessionId từ mã tham gia ngắn - dùng ở màn hình user nhập mã trước khi /join.
// Đặt TRƯỚC "/session/:id" không cần thiết vì path khác nhau ("/session/code/:code"
// so với "/session/:id"), nhưng vẫn đặt sớm trong file cho dễ đọc.
router.get("/session/code/:code", authMiddleware, async (req, res) => {
  try {
    const session = await getSessionByCode(req.params.code);
    if (!session) {
      return res.status(404).json({
        error: "not_found",
        message: "Mã tham gia không hợp lệ hoặc không tồn tại.",
      });
    }
    return res.json({ session });
  } catch (err) {
    console.error("[GET /session/code/:code]", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// Số người đã vào phòng - dùng cho màn hình chờ của user.
// Chỉ trả về một con số, không lộ danh sách user.
router.get("/session/:id/joined-count", authMiddleware, async (req, res) => {
  try {
    const count = await getJoinedCount(req.params.id);
    return res.json({ count });
  } catch (err) {
    console.error("[GET /session/:id/joined-count]", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// Thống kê realtime cho màn hình MC (admin only).
router.get(
  "/session/:id/live-stats",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const stats = await getLiveStats(req.params.id);
      return res.json(stats);
    } catch (err) {
      console.error("[GET /session/:id/live-stats]", err);
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

router.get("/session/:id", authMiddleware, async (req, res) => {
  try {
    const info = await getSessionInfo(req.params.id);
    return res.json(info);
  } catch (err) {
    console.error("[GET /session/:id]", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// Body: { durationSeconds: number }
router.post(
  "/session/:id/start",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    const durationSeconds = Number(req.body?.durationSeconds);
    if (!durationSeconds || durationSeconds <= 0) {
      return res.status(400).json({
        error: "invalid_body",
        message: "Thiếu durationSeconds hợp lệ.",
      });
    }
    try {
      await startSession(req.params.id, durationSeconds);
      return res.json({ ok: true });
    } catch (err) {
      console.error("[POST /session/:id/start]", err);
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

// Tạm dừng đếm giờ (chỉ hợp lệ khi đang 'active').
router.post(
  "/session/:id/pause",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pauseSession(req.params.id);
      return res.json({ ok: true, ...result });
    } catch (err: any) {
      if (err.code === "session_not_active") {
        return res.status(409).json({
          error: "session_not_active",
          message: "Chỉ có thể tạm dừng khi vote đang mở (active).",
        });
      }
      console.error("[POST /session/:id/pause]", err);
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

// Chạy tiếp từ chỗ đã dừng (chỉ hợp lệ khi đang 'paused').
router.post(
  "/session/:id/resume",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await resumeSession(req.params.id);
      return res.json(result);
    } catch (err: any) {
      if (err.code === "session_not_paused") {
        return res.status(409).json({
          error: "session_not_paused",
          message: "Chỉ có thể resume khi đang ở trạng thái paused.",
        });
      }
      console.error("[POST /session/:id/resume]", err);
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

// Khóa thủ công (ngoài cron tự động khi hết giờ) - chốt kết quả cuối cùng.
router.post(
  "/session/:id/close",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await closeSession(req.params.id);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[POST /session/:id/close]", err);
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

export default router;
