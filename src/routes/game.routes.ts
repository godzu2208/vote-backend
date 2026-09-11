import { Router } from "express";
import { authMiddleware, requireAdmin } from "../middleware/auth";
import {
  createGame, updateGame, listGames, getGame, getGameByPin, joinGame,
  getParticipantCount, enterLobby, startGame, advanceGame, closeGame,
  getGameLiveStats, getQuestionVoters,
} from "../services/gameService";

const router = Router();
const PIN_PATTERN = /^[A-Za-z0-9]{4,8}$/;

router.post("/games", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const game = await createGame(req.user!.id, req.body ?? {});
    return res.status(201).json({ ok: true, game });
  } catch (err: any) {
    const code = err?.code;
    if (["invalid_title","invalid_questions","invalid_question","invalid_options","invalid_duration","invalid_pin"].includes(code)) {
      return res.status(400).json({ error: code, message: "Dữ liệu Game không hợp lệ." });
    }
    if (code === "game_pin_taken" || err?.details?.includes?.("games_pin_uidx")) {
      return res.status(409).json({ error: "game_pin_taken", message: "Game PIN đã được sử dụng." });
    }
    console.error("[POST /games]", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

router.get("/games", authMiddleware, requireAdmin, async (req, res) => {
  try { return res.json({ games: await listGames(req.user!.id) }); }
  catch (err) { console.error("[GET /games]", err); return res.status(500).json({ error: "internal_error" }); }
});

router.get("/games/pin/:pin", authMiddleware, async (req, res) => {
  const pin = req.params.pin.trim().toUpperCase();
  if (!PIN_PATTERN.test(pin)) return res.status(400).json({ error: "invalid_pin", message: "Game PIN không hợp lệ." });
  try {
    const game = await getGameByPin(pin);
    if (!game) return res.status(404).json({ error: "not_found", message: "Không tìm thấy Game." });
    return res.json({ game });
  } catch (err) { console.error("[GET /games/pin/:pin]", err); return res.status(500).json({ error: "internal_error" }); }
});

router.put("/games/:id", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const game = await updateGame(req.params.id, req.user!.id, req.body ?? {});
    return res.json({ ok: true, game });
  } catch (err: any) {
    const code = err?.code;
    if (["invalid_title","invalid_questions","invalid_question","invalid_options","invalid_duration"].includes(code)) {
      return res.status(400).json({ error: code, message: "Dữ liệu Game không hợp lệ." });
    }
    if (code === "game_not_editable") {
      return res.status(409).json({ error: code, message: "Game này không còn ở trạng thái có thể chỉnh sửa." });
    }
    console.error("[PUT /games/:id]", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

router.get("/games/:id", authMiddleware, async (req, res) => {
  try {
    const game = await getGame(req.params.id, req.user!.isAdmin ? req.user!.id : undefined);
    return res.json({ game });
  } catch (err) {
    console.error("[GET /games/:id]", err);
    return res.status(404).json({ error: "not_found", message: "Không tìm thấy Game." });
  }
});

router.post("/games/:id/join", authMiddleware, async (req, res) => {
  try {
    const game = await getGame(req.params.id);
    if (game.status === "closed") return res.status(409).json({ error: "game_closed", message: "Game đã kết thúc." });
    await joinGame(req.params.id, req.user!.id, String(req.body?.displayName ?? ""));
    return res.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "invalid_display_name") return res.status(400).json({ error: err.code, message: "Vui lòng nhập tên hiển thị." });
    console.error("[POST /games/:id/join]", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

router.get("/games/:id/participants/count", authMiddleware, async (req, res) => {
  try { return res.json({ count: await getParticipantCount(req.params.id) }); }
  catch (err) { console.error("[GET /games/:id/participants/count]", err); return res.status(500).json({ error: "internal_error" }); }
});

router.post("/games/:id/lobby", authMiddleware, requireAdmin, async (req, res) => {
  try { return res.json({ ok: true, game: await enterLobby(req.params.id, req.user!.id) }); }
  catch (err) { console.error("[POST /games/:id/lobby]", err); return res.status(500).json({ error: "internal_error" }); }
});

router.post("/games/:id/start", authMiddleware, requireAdmin, async (req, res) => {
  try { return res.json({ ok: true, game: await startGame(req.params.id, req.user!.id) }); }
  catch (err: any) { return res.status(409).json({ error: err?.code ?? "game_not_ready", message: "Game chưa sẵn sàng để bắt đầu." }); }
});

router.post("/games/:id/next", authMiddleware, requireAdmin, async (req, res) => {
  try { return res.json({ ok: true, game: await advanceGame(req.params.id, req.user!.id) }); }
  catch (err: any) { console.error("[POST /games/:id/next]", err); return res.status(409).json({ error: err?.code ?? "game_not_active", message: "Không thể chuyển câu hỏi." }); }
});

router.post("/games/:id/close", authMiddleware, requireAdmin, async (req, res) => {
  try { return res.json({ ok: true, game: await closeGame(req.params.id, req.user!.id) }); }
  catch (err) { console.error("[POST /games/:id/close]", err); return res.status(500).json({ error: "internal_error" }); }
});

router.get("/games/:id/stats", authMiddleware, requireAdmin, async (req, res) => {
  try { return res.json(await getGameLiveStats(req.params.id, req.user!.id)); }
  catch (err) { console.error("[GET /games/:id/stats]", err); return res.status(500).json({ error: "internal_error" }); }
});

router.get("/games/:id/questions/:questionId/voters", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const voters = await getQuestionVoters(req.params.id, req.user!.id, req.params.questionId,
      typeof req.query.optionId === "string" ? req.query.optionId : undefined);
    return res.json({ voters });
  } catch (err) { console.error("[GET /games/:id/questions/:questionId/voters]", err); return res.status(500).json({ error: "internal_error" }); }
});

export default router;
