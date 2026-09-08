import { supabaseAdmin } from '../config/supabaseAdmin';

interface JoinParams {
  sessionId: string;
  userId: string;
  userAgent: string;
  ipAddress: string;
}

interface SelectParams {
  sessionId: string;
  userId: string;
  optionId: string | null;
  userAgent: string;
  ipAddress: string;
}

/**
 * Ghi log "join" - chỉ 1 lần duy nhất mỗi user/session.
 * Idempotent: nếu đã join rồi thì bỏ qua, không tạo dòng log trùng.
 */
export async function joinSession({ sessionId, userId, userAgent, ipAddress }: JoinParams) {
  const { data: existing, error: checkError } = await supabaseAdmin
    .from('vote_logs')
    .select('id')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .eq('action', 'join')
    .maybeSingle();

  if (checkError) throw checkError;
  if (existing) return { alreadyJoined: true };

  const { error: insertError } = await supabaseAdmin.from('vote_logs').insert({
    session_id: sessionId,
    user_id: userId,
    action: 'join',
    option_id: null,
    user_agent: userAgent,
    ip_address: ipAddress,
  });

  if (insertError) throw insertError;
  return { alreadyJoined: false };
}

/**
 * Ghi/đè trạng thái đang chọn của user (bảng selections - mutable).
 * KHÔNG ghi log ở bước này theo đúng thiết kế: chỉ kết quả cuối cùng mới được log.
 * Dùng upsert với primary key (session_id, user_id) nên Postgres tự xử lý
 * an toàn khi nhiều request tới cùng lúc cho cùng 1 user (ví dụ user bấm rất nhanh).
 */
export async function upsertSelection({ sessionId, userId, optionId, userAgent, ipAddress }: SelectParams) {
  // Chỉ cho phép chọn khi session đang active - chặn cả lúc 'pending' (chưa start),
  // 'paused' (đang tạm dừng) và 'closed' (đã chốt).
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('sessions')
    .select('status, ended_at')
    .eq('id', sessionId)
    .single();

  if (sessionError) throw sessionError;

  const isPastDeadline = session?.ended_at ? new Date(session.ended_at).getTime() <= Date.now() : false;

  // Kiểm tra CẢ status lẫn ended_at: việc khóa (/session/:id/close) do trang admin
  // chủ động gọi khi countdown về 0, không có tiến trình nền nào tự khóa hộ.
  // Nếu admin gọi trễ vài giây (mạng chậm, thao tác chậm), server vẫn tự chặn ghi mới
  // ngay khi qua deadline thật, không phụ thuộc vào việc status đã kịp chuyển 'closed' hay chưa.
  if (!session || session.status !== 'active' || isPastDeadline) {
    const err: any = new Error('session_not_active');
    err.code = 'session_not_active';
    throw err;
  }

  const { error } = await supabaseAdmin.from('selections').upsert(
    {
      session_id: sessionId,
      user_id: userId,
      option_id: optionId,
      user_agent: userAgent,
      ip_address: ipAddress,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'session_id,user_id' }
  );

  if (error) throw error;
  return { ok: true };
}

/**
 * Chốt kết quả cuối cùng - chạy ĐÚNG 1 LẦN khi hết giờ hoặc admin bấm khóa.
 * Toàn bộ thao tác nằm trong 1 Postgres function (transaction) để đảm bảo
 * không có race condition dù có ai gọi API này 2 lần cùng lúc (idempotent nhờ
 * status check + primary key trên bảng votes).
 */
export async function closeSession(sessionId: string) {
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('sessions')
    .select('status')
    .eq('id', sessionId)
    .single();

  if (sessionError) throw sessionError;
  if (!session) {
    const err: any = new Error('session_not_found');
    err.code = 'session_not_found';
    throw err;
  }
  if (session.status === 'closed') {
    return { alreadyClosed: true };
  }

  // Gọi Postgres function `close_session` (xem migrations/001_close_session_function.sql)
  // để đảm bảo toàn bộ bước chạy trong 1 transaction atomic.
  const { error: rpcError } = await supabaseAdmin.rpc('close_session', {
    p_session_id: sessionId,
  });

  if (rpcError) throw rpcError;
  return { alreadyClosed: false };
}

/**
 * Mở vote: set 'active', tính ended_at = now + durationSeconds.
 * Dùng cả để Start lần đầu (từ 'pending') lẫn Restart (từ 'closed', hiếm khi cần).
 */
export async function startSession(sessionId: string, durationSeconds: number) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('sessions')
    .update({
      status: 'active',
      started_at: now,
      duration_seconds: durationSeconds,
      ended_at: new Date(Date.now() + durationSeconds * 1000).toISOString(),
      remaining_seconds: null,
      paused_at: null,
    })
    .eq('id', sessionId);

  if (error) throw error;
}

/**
 * Tạm dừng đếm giờ. Lưu lại số giây còn lại vào remaining_seconds, xóa ended_at
 * (không có hạn chót trong lúc pause) để upsertSelection tự chặn ghi mới.
 */
export async function pauseSession(sessionId: string) {
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('sessions')
    .select('status, ended_at')
    .eq('id', sessionId)
    .single();

  if (sessionError) throw sessionError;
  if (!session || session.status !== 'active') {
    const err: any = new Error('session_not_active');
    err.code = 'session_not_active';
    throw err;
  }

  const remainingMs = session.ended_at ? new Date(session.ended_at).getTime() - Date.now() : 0;
  const remainingSeconds = Math.max(0, Math.round(remainingMs / 1000));

  const { error } = await supabaseAdmin
    .from('sessions')
    .update({
      status: 'paused',
      remaining_seconds: remainingSeconds,
      paused_at: new Date().toISOString(),
      ended_at: null,
    })
    .eq('id', sessionId);

  if (error) throw error;
  return { remainingSeconds };
}

/**
 * Tiếp tục đếm giờ từ chỗ đã dừng: ended_at = now + remaining_seconds đã lưu lúc pause.
 */
export async function resumeSession(sessionId: string) {
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('sessions')
    .select('status, remaining_seconds')
    .eq('id', sessionId)
    .single();

  if (sessionError) throw sessionError;
  if (!session || session.status !== 'paused') {
    const err: any = new Error('session_not_paused');
    err.code = 'session_not_paused';
    throw err;
  }

  const remainingSeconds = session.remaining_seconds ?? 0;

  const { error } = await supabaseAdmin
    .from('sessions')
    .update({
      status: 'active',
      ended_at: new Date(Date.now() + remainingSeconds * 1000).toISOString(),
      remaining_seconds: null,
      paused_at: null,
    })
    .eq('id', sessionId);

  if (error) throw error;
  return { ok: true, remainingSeconds };
}

export async function getSessionInfo(sessionId: string) {
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('sessions')
    .select('id, question, status, duration_seconds, started_at, ended_at, remaining_seconds, paused_at')
    .eq('id', sessionId)
    .single();

  if (sessionError) throw sessionError;

  const { data: options, error: optionsError } = await supabaseAdmin
    .from('options')
    .select('id, label, sort_order')
    .eq('session_id', sessionId)
    .order('sort_order', { ascending: true });

  if (optionsError) throw optionsError;

  return { ...session, options: options ?? [] };
}

/** Đếm số lượng đã chọn (không breakdown theo đáp án) - dùng lúc đang mở vote. */
export async function countCurrentSelections(sessionId: string) {
  const { count, error } = await supabaseAdmin
    .from('selections')
    .select('user_id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .not('option_id', 'is', null);

  if (error) throw error;
  return count ?? 0;
}

/** Bảng xếp hạng đầy đủ - chỉ có ý nghĩa sau khi session đã closed. */
export async function getResults(sessionId: string) {
  const { data: options, error: optionsError } = await supabaseAdmin
    .from('options')
    .select('id, label')
    .eq('session_id', sessionId);

  if (optionsError) throw optionsError;

  const { data: votes, error: votesError } = await supabaseAdmin
    .from('votes')
    .select('option_id')
    .eq('session_id', sessionId);

  if (votesError) throw votesError;

  const countMap = new Map<string, number>();
  let noAnswerCount = 0;

  for (const v of votes ?? []) {
    if (!v.option_id) {
      noAnswerCount += 1;
      continue;
    }
    countMap.set(v.option_id, (countMap.get(v.option_id) ?? 0) + 1);
  }

  const ranking = (options ?? [])
    .map((opt) => ({ optionId: opt.id, label: opt.label, votes: countMap.get(opt.id) ?? 0 }))
    .sort((a, b) => b.votes - a.votes);

  return { ranking, noAnswerCount, totalParticipants: (votes ?? []).length };
}
