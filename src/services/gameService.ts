import { supabaseAdmin } from "../config/supabaseAdmin";
import { closeSession } from "./voteService";

export type GameStatus = "draft" | "lobby" | "active" | "closed";
export type GameBackgroundType = "color" | "gradient" | "image";

export interface GameQuestionInput {
  question: string;
  options: string[];
  durationSeconds?: number | null;
  imageUrl?: string | null;
  backgroundType?: GameBackgroundType;
  backgroundValue?: string | null;
}

export interface CreateGameInput {
  title: string;
  pin?: string | null;
  coverUrl?: string | null;
  backgroundType?: GameBackgroundType;
  backgroundValue?: string | null;
  questions: GameQuestionInput[];
}

const PIN_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PIN_PATTERN = /^[A-Z0-9]{4,8}$/;

function randomPin(length = 6) {
  let value = "";
  for (let i = 0; i < length; i++) {
    value += PIN_CHARS[Math.floor(Math.random() * PIN_CHARS.length)];
  }
  return value;
}

async function generateUniquePin() {
  for (let i = 0; i < 20; i++) {
    const pin = randomPin();
    const { data, error } = await supabaseAdmin
      .from("games")
      .select("id")
      .eq("pin", pin)
      .maybeSingle();
    if (error) throw error;
    if (!data) return pin;
  }
  const err: any = new Error("game_pin_generation_failed");
  err.code = "game_pin_generation_failed";
  throw err;
}

function normalizeQuestion(input: GameQuestionInput, index: number) {
  const question = input.question?.trim();
  const options = (input.options ?? []).map((x) => x.trim()).filter(Boolean);
  if (!question) throw Object.assign(new Error("invalid_question"), { code: "invalid_question" });
  if (options.length < 2) throw Object.assign(new Error("invalid_options"), { code: "invalid_options" });

  const duration = input.durationSeconds == null ? 20 : Number(input.durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) {
    throw Object.assign(new Error("invalid_duration"), { code: "invalid_duration" });
  }

  return {
    question,
    options,
    durationSeconds: Math.round(duration),
    imageUrl: input.imageUrl?.trim() || null,
    backgroundType: input.backgroundType ?? "gradient",
    backgroundValue: input.backgroundValue?.trim() || null,
    sortOrder: index + 1,
  };
}

export async function createGame(createdBy: string, input: CreateGameInput) {
  const title = input.title?.trim();
  if (!title) throw Object.assign(new Error("invalid_title"), { code: "invalid_title" });
  if (!Array.isArray(input.questions) || input.questions.length < 1) {
    throw Object.assign(new Error("invalid_questions"), { code: "invalid_questions" });
  }

  const questions = input.questions.map(normalizeQuestion);
  const requestedPin = input.pin?.trim().toUpperCase() || null;
  if (requestedPin && !PIN_PATTERN.test(requestedPin)) {
    throw Object.assign(new Error("invalid_pin"), { code: "invalid_pin" });
  }

  const pin = requestedPin || await generateUniquePin();

  const { data: existing } = await supabaseAdmin
    .from("games").select("id").eq("pin", pin).maybeSingle();
  if (existing) throw Object.assign(new Error("game_pin_taken"), { code: "game_pin_taken" });

  const { data: game, error: gameError } = await supabaseAdmin
    .from("games")
    .insert({
      created_by: createdBy,
      title,
      pin,
      status: "draft",
      cover_url: input.coverUrl?.trim() || null,
      background_type: input.backgroundType ?? "gradient",
      background_value: input.backgroundValue?.trim() || null,
    })
    .select("*")
    .single();
  if (gameError) throw gameError;

  try {
    for (const q of questions) {
      const { data: session, error: sessionError } = await supabaseAdmin
        .from("sessions")
        .insert({
          question: q.question,
          status: "pending",
          game_id: game.id,
          sort_order: q.sortOrder,
          duration_seconds: q.durationSeconds,
          background_type: q.backgroundType,
          background_value: q.backgroundValue,
          image_url: q.imageUrl,
        })
        .select("id, question, status, duration_seconds, game_id, sort_order, background_type, background_value, image_url")
        .single();
      if (sessionError) throw sessionError;

      const { error: optionError } = await supabaseAdmin.from("options").insert(
        q.options.map((label, optionIndex) => ({
          session_id: session.id,
          label,
          sort_order: optionIndex + 1,
        }))
      );
      if (optionError) throw optionError;
    }
  } catch (error) {
    await supabaseAdmin.from("games").delete().eq("id", game.id);
    throw error;
  }

  return getGame(game.id, createdBy);
}


export async function updateGame(gameId: string, requesterId: string, input: CreateGameInput) {
  const existing = await getGame(gameId, requesterId);
  if (!['draft', 'lobby'].includes(existing.status)) {
    throw Object.assign(new Error("game_not_editable"), { code: "game_not_editable" });
  }
  if (existing.status === 'lobby') {
    const participants = await getParticipantCount(gameId);
    if (participants > 0) {
      throw Object.assign(new Error("game_lobby_has_participants"), { code: "game_lobby_has_participants" });
    }
  }

  const title = input.title?.trim();
  if (!title) throw Object.assign(new Error("invalid_title"), { code: "invalid_title" });
  if (!Array.isArray(input.questions) || input.questions.length < 1) {
    throw Object.assign(new Error("invalid_questions"), { code: "invalid_questions" });
  }

  const questions = input.questions.map(normalizeQuestion);

  const { error: gameError } = await supabaseAdmin
    .from("games")
    .update({
      title,
      cover_url: input.coverUrl?.trim() || null,
      background_type: input.backgroundType ?? "gradient",
      background_value: input.backgroundValue?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", gameId)
    .eq("created_by", requesterId);
  if (gameError) throw gameError;

  const existingSessions = existing.questions ?? [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const old = existingSessions[i];

    let sessionId: string;
    if (old) {
      const { error } = await supabaseAdmin
        .from("sessions")
        .update({
          question: q.question,
          duration_seconds: q.durationSeconds,
          sort_order: q.sortOrder,
          background_type: q.backgroundType,
          background_value: q.backgroundValue,
          image_url: q.imageUrl,
        })
        .eq("id", old.id)
        .eq("game_id", gameId);
      if (error) throw error;
      sessionId = old.id;

      const { error: deleteOptionsError } = await supabaseAdmin
        .from("options")
        .delete()
        .eq("session_id", sessionId);
      if (deleteOptionsError) throw deleteOptionsError;
    } else {
      const { data: session, error } = await supabaseAdmin
        .from("sessions")
        .insert({
          question: q.question,
          status: "pending",
          game_id: gameId,
          sort_order: q.sortOrder,
          duration_seconds: q.durationSeconds,
          background_type: q.backgroundType,
          background_value: q.backgroundValue,
          image_url: q.imageUrl,
        })
        .select("id")
        .single();
      if (error) throw error;
      sessionId = session.id;
    }

    const { error: optionError } = await supabaseAdmin.from("options").insert(
      q.options.map((label, optionIndex) => ({
        session_id: sessionId,
        label,
        sort_order: optionIndex + 1,
      }))
    );
    if (optionError) throw optionError;
  }

  for (let i = questions.length; i < existingSessions.length; i++) {
    const old = existingSessions[i];
    const { error: deleteOptionsError } = await supabaseAdmin
      .from("options")
      .delete()
      .eq("session_id", old.id);
    if (deleteOptionsError) throw deleteOptionsError;

    const { error: deleteSessionError } = await supabaseAdmin
      .from("sessions")
      .delete()
      .eq("id", old.id)
      .eq("game_id", gameId);
    if (deleteSessionError) throw deleteSessionError;
  }

  return getGame(gameId, requesterId);
}

export async function listGames(createdBy: string) {
  const { data: games, error } = await supabaseAdmin
    .from("games")
    .select("id,title,pin,status,cover_url,background_type,background_value,current_session_id,created_at,updated_at")
    .eq("created_by", createdBy)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return games ?? [];
}

export async function getGame(gameId: string, requesterId?: string) {
  let query = supabaseAdmin
    .from("games")
    .select("id,title,pin,status,cover_url,background_type,background_value,current_session_id,created_by,created_at,updated_at")
    .eq("id", gameId);

  if (requesterId) query = query.eq("created_by", requesterId);
  const { data: game, error } = await query.single();
  if (error) throw error;

  const { data: sessions, error: sessionsError } = await supabaseAdmin
    .from("sessions")
    .select("id,question,status,duration_seconds,started_at,ended_at,remaining_seconds,paused_at,game_id,sort_order,background_type,background_value,image_url")
    .eq("game_id", gameId)
    .order("sort_order", { ascending: true });
  if (sessionsError) throw sessionsError;

  const questions = await Promise.all((sessions ?? []).map(async (session: any) => {
    const { data: options, error: optionsError } = await supabaseAdmin
      .from("options")
      .select("id,label,sort_order")
      .eq("session_id", session.id)
      .order("sort_order", { ascending: true });
    if (optionsError) throw optionsError;
    return { ...session, options: options ?? [] };
  }));

  return { ...game, questions };
}

export async function getGameByPin(pin: string) {
  const normalized = pin.trim().toUpperCase();
  if (!normalized) return null;
  const { data, error } = await supabaseAdmin
    .from("games")
    .select("id,title,pin,status,cover_url,background_type,background_value,current_session_id,created_at")
    .eq("pin", normalized)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function joinGame(gameId: string, userId: string, displayName: string) {
  const name = displayName.trim().slice(0, 80);
  if (!name) throw Object.assign(new Error("invalid_display_name"), { code: "invalid_display_name" });

  const { error } = await supabaseAdmin.rpc("touch_game_participant", {
    p_game_id: gameId,
    p_user_id: userId,
    p_display_name: name,
  });
  if (error) throw error;
  return { ok: true };
}

export async function getGameParticipants(gameId: string) {
  const { data, error } = await supabaseAdmin
    .from("game_participants")
    .select("id,user_id,display_name,joined_at,last_seen_at")
    .eq("game_id", gameId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((p: any) => ({
    id: p.id,
    displayName: p.display_name,
    joinedAt: p.joined_at,
    lastSeenAt: p.last_seen_at,
  }));
}

export async function getParticipantCount(gameId: string) {
  const { count, error } = await supabaseAdmin
    .from("game_participants")
    .select("id", { count: "exact", head: true })
    .eq("game_id", gameId);
  if (error) throw error;
  return count ?? 0;
}

async function setCurrentQuestion(gameId: string, sessionId: string, status: "active" | "pending", durationSeconds = 20) {
  const { error: sessionError } = await supabaseAdmin
    .from("sessions")
    .update({
      status,
      started_at: status === "active" ? new Date().toISOString() : null,
      ended_at: status === "active"
        ? new Date(Date.now() + durationSeconds * 1000).toISOString()
        : null,
    })
    .eq("id", sessionId);
  if (sessionError) throw sessionError;

  const { error } = await supabaseAdmin
    .from("games")
    .update({
      status: status === "active" ? "active" : "lobby",
      current_session_id: sessionId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", gameId);
  if (error) throw error;
}

export async function enterLobby(gameId: string, requesterId: string) {
  const game = await getGame(gameId, requesterId);
  if (game.status !== "draft" && game.status !== "closed") {
    return game;
  }
  const first = game.questions[0];
  if (!first) throw Object.assign(new Error("game_has_no_questions"), { code: "game_has_no_questions" });

  const { error } = await supabaseAdmin
    .from("games")
    .update({ status: "lobby", current_session_id: first.id, updated_at: new Date().toISOString() })
    .eq("id", gameId);
  if (error) throw error;
  return getGame(gameId, requesterId);
}

export async function startGame(gameId: string, requesterId: string) {
  const game = await getGame(gameId, requesterId);
  if (!["lobby", "closed"].includes(game.status)) {
    throw Object.assign(new Error("game_not_ready"), { code: "game_not_ready" });
  }

  const current = game.questions.find((q: any) => q.id === game.current_session_id) ?? game.questions[0];
  await setCurrentQuestion(gameId, current.id, "active", current.duration_seconds ?? 20);
  return getGame(gameId, requesterId);
}

export async function advanceGame(gameId: string, requesterId: string) {
  const game = await getGame(gameId, requesterId);
  if (game.status !== "active") {
    throw Object.assign(new Error("game_not_active"), { code: "game_not_active" });
  }

  const currentIndex = game.questions.findIndex((q: any) => q.id === game.current_session_id);
  if (currentIndex < 0) throw Object.assign(new Error("current_question_not_found"), { code: "current_question_not_found" });

  await closeSession(game.questions[currentIndex].id);

  const next = game.questions[currentIndex + 1];
  if (!next) {
    const { error } = await supabaseAdmin
      .from("games")
      .update({ status: "closed", current_session_id: null, updated_at: new Date().toISOString() })
      .eq("id", gameId);
    if (error) throw error;
    return getGame(gameId, requesterId);
  }

  // New question = fresh round. Existing session is still pending until activated.
  await setCurrentQuestion(gameId, next.id, "active", next.duration_seconds ?? 20);
  return getGame(gameId, requesterId);
}

export async function closeGame(gameId: string, requesterId: string) {
  const game = await getGame(gameId, requesterId);
  if (game.current_session_id) {
    const current = game.questions.find((q: any) => q.id === game.current_session_id);
    if (current && current.status !== "closed") await closeSession(current.id);
  }
  const { error } = await supabaseAdmin
    .from("games")
    .update({ status: "closed", updated_at: new Date().toISOString() })
    .eq("id", gameId);
  if (error) throw error;
  return getGame(gameId, requesterId);
}

export async function getGameLiveStats(gameId: string, requesterId: string) {
  const game = await getGame(gameId, requesterId);
  const participantCount = await getParticipantCount(gameId);
  if (!game.current_session_id) {
    return { participantCount, joinedCount: participantCount, votedCount: 0, waitingCount: participantCount, optionCounts: {} };
  }
  const current = game.questions.find((q: any) => q.id === game.current_session_id);
  if (!current) return { participantCount, joinedCount: participantCount, votedCount: 0, waitingCount: participantCount, optionCounts: {} };

  const { data: selections, error } = await supabaseAdmin
    .from("selections").select("user_id,option_id").eq("session_id", current.id);
  if (error) throw error;

  const optionCounts: Record<string, number> = {};
  const voted = new Set<string>();
  for (const row of selections ?? []) {
    if (!row.option_id) continue;
    voted.add(row.user_id);
    optionCounts[row.option_id] = (optionCounts[row.option_id] ?? 0) + 1;
  }

  return {
    participantCount,
    joinedCount: participantCount,
    votedCount: voted.size,
    waitingCount: Math.max(0, participantCount - voted.size),
    optionCounts,
    currentSessionId: current.id,
  };
}


export async function getGameDashboard(gameId: string, requesterId: string) {
  const game = await getGame(gameId, requesterId);

  const participantResult = await supabaseAdmin
    .from("game_participants")
    .select("id,user_id,display_name,joined_at,last_seen_at")
    .eq("game_id", gameId)
    .order("joined_at", { ascending: true });
  if (participantResult.error) throw participantResult.error;

  const participants = (participantResult.data ?? []).map((p: any) => ({
    id: p.id,
    userId: p.user_id,
    displayName: p.display_name,
    joinedAt: p.joined_at,
    lastSeenAt: p.last_seen_at,
  }));
  const participantCount = participants.length;
  const participantMap = new Map(participants.map((p: any) => [p.userId, p]));

  const questionDashboards = await Promise.all((game.questions ?? []).map(async (question: any) => {
    const [{ data: options, error: optionsError }, { data: votes, error: votesError }] = await Promise.all([
      supabaseAdmin.from("options").select("id,label,sort_order").eq("session_id", question.id).order("sort_order", { ascending: true }),
      supabaseAdmin.from("votes").select("user_id,option_id,finalized_at").eq("session_id", question.id).order("finalized_at", { ascending: true }),
    ]);
    if (optionsError) throw optionsError;
    if (votesError) throw votesError;

    const counts: Record<string, number> = {};
    for (const option of options ?? []) counts[option.id] = 0;

    const voteByUser = new Map<string, any>((votes ?? []).map((v: any) => [v.user_id, v]));
    const cutoff = question.started_at ? new Date(question.started_at).getTime() : Number.POSITIVE_INFINITY;
    const expectedParticipants = participants.filter((p: any) => new Date(p.joinedAt).getTime() <= cutoff);

    let noAnswerCount = 0;
    const history: any[] = [];

    for (const participant of expectedParticipants) {
      const vote = voteByUser.get(participant.userId);
      const option = vote?.option_id ? (options ?? []).find((item: any) => item.id === vote.option_id) : null;

      if (vote?.option_id) {
        counts[vote.option_id] = (counts[vote.option_id] ?? 0) + 1;
      } else {
        noAnswerCount += 1;
      }

      history.push({
        questionId: question.id,
        questionNumber: question.sort_order,
        question: question.question,
        userId: participant.userId,
        displayName: participant.displayName,
        optionId: vote?.option_id ?? null,
        optionLabel: option?.label ?? "Không chọn",
        timestamp: vote?.finalized_at ?? question.ended_at ?? participant.joinedAt,
      });
    }

    // Safety net for legacy vote rows whose user is not present in game_participants.
    for (const vote of votes ?? []) {
      if (participantMap.has(vote.user_id)) continue;
      const option = vote.option_id ? (options ?? []).find((item: any) => item.id === vote.option_id) : null;
      if (vote.option_id) counts[vote.option_id] = (counts[vote.option_id] ?? 0) + 1;
      else noAnswerCount += 1;
      history.push({
        questionId: question.id,
        questionNumber: question.sort_order,
        question: question.question,
        userId: vote.user_id,
        displayName: "Người chơi",
        optionId: vote.option_id,
        optionLabel: option?.label ?? "Không chọn",
        timestamp: vote.finalized_at ?? question.ended_at ?? new Date().toISOString(),
      });
    }

    const ranking = (options ?? [])
      .map((option: any) => ({
        optionId: option.id,
        label: option.label,
        votes: counts[option.id] ?? 0,
      }))
      .sort((a: any, b: any) => b.votes - a.votes);

    return {
      questionId: question.id,
      questionNumber: question.sort_order,
      question: question.question,
      status: question.status,
      startedAt: question.started_at,
      endedAt: question.ended_at,
      totalVotes: Object.values(counts).reduce((sum: number, value: any) => sum + Number(value || 0), 0),
      noAnswerCount,
      ranking,
      history,
    };
  }));

  const voteHistory = questionDashboards
    .flatMap((q: any) => q.history)
    .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const totalVotes = questionDashboards.reduce((sum: number, q: any) => sum + q.totalVotes, 0);

  return {
    game: {
      id: game.id,
      title: game.title,
      pin: game.pin,
      status: game.status,
      createdAt: game.created_at,
      updatedAt: game.updated_at,
    },
    participantCount,
    participants: participants.map(({ userId, ...p }: any) => ({ ...p, userId })),
    totalVotes,
    questions: questionDashboards,
    voteHistory,
    participantJoinTimestamps: participants.map((p: any) => p.joinedAt),
  };
}

export async function getQuestionVoters(gameId: string, requesterId: string, questionId: string, optionId?: string) {
  const game = await getGame(gameId, requesterId);
  const question = game.questions.find((q: any) => q.id === questionId);
  if (!question) throw new Error("question_not_found");

  const { data: participants, error: pError } = await supabaseAdmin
    .from("game_participants")
    .select("user_id,display_name,joined_at")
    .eq("game_id", gameId);
  if (pError) throw pError;
  const names = new Map((participants ?? []).map((p: any) => [p.user_id, p.display_name]));

  const source = question.status === "active" ? "selections" : "votes";
  const { data: rows, error } = await supabaseAdmin
    .from(source)
    .select("user_id,option_id,updated_at,finalized_at")
    .eq("session_id", questionId)
    .order(source === "selections" ? "updated_at" : "finalized_at", { ascending: true });
  if (error) throw error;

  const filtered = optionId ? (rows ?? []).filter((v: any) => v.option_id === optionId) : (rows ?? []);
  return filtered.map((v: any) => ({
    userId: v.user_id,
    displayName: names.get(v.user_id) ?? "Người chơi",
    optionId: v.option_id,
    timestamp: v.updated_at ?? v.finalized_at ?? question.ended_at ?? new Date().toISOString(),
  }));
}
