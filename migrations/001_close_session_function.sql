-- Chạy file này trong Supabase SQL Editor sau khi đã có schema + RLS.
-- Function này được gọi qua supabaseAdmin.rpc('close_session', { p_session_id }).
-- Toàn bộ nằm trong 1 transaction (mặc định của Postgres function) nên an toàn
-- tuyệt đối dù backend có gọi trùng lặp hoặc 150 user đang ghi selections cùng lúc.

create or replace function close_session(p_session_id uuid)
returns void
language plpgsql
security definer -- chạy với quyền cao hơn RLS, vì đây là thao tác hệ thống nội bộ
as $$
begin
  -- Nếu session đã closed rồi thì không làm gì cả (idempotent)
  if (select status from sessions where id = p_session_id) = 'closed' then
    return;
  end if;

  -- 1. Copy toàn bộ trạng thái đang chọn hiện tại -> kết quả chính thức
  insert into votes (session_id, user_id, option_id)
  select session_id, user_id, option_id
  from selections
  where session_id = p_session_id
  on conflict (session_id, user_id) do nothing;

  -- 2. Ghi log cho những user có selections (đã chọn hoặc để trống)
  insert into vote_logs (session_id, user_id, action, option_id, user_agent, ip_address)
  select
    session_id,
    user_id,
    case when option_id is null then 'no_answer' else 'vote' end,
    option_id,
    user_agent,
    ip_address
  from selections
  where session_id = p_session_id;

  -- 3. Ghi log cho user đã "join" nhưng chưa từng có dòng trong selections
  --    (join xong không bấm chọn gì cả, kể cả 1 lần)
  insert into vote_logs (session_id, user_id, action, option_id)
  select distinct l.session_id, l.user_id, 'no_answer', null
  from vote_logs l
  left join selections s
    on s.session_id = l.session_id and s.user_id = l.user_id
  where l.session_id = p_session_id
    and l.action = 'join'
    and s.user_id is null;

  -- 3b. Với các user ở bước 3, cũng cần có 1 dòng trong `votes` (option_id = null)
  --     để bảng xếp hạng/tổng số người tham gia đếm đúng.
  insert into votes (session_id, user_id, option_id)
  select distinct l.session_id, l.user_id, null
  from vote_logs l
  left join votes v
    on v.session_id = l.session_id and v.user_id = l.user_id
  where l.session_id = p_session_id
    and l.action = 'join'
    and v.user_id is null
  on conflict (session_id, user_id) do nothing;

  -- 4. Khóa session
  update sessions
  set status = 'closed',
      ended_at = coalesce(ended_at, now())
  where id = p_session_id;
end;
$$;

-- Chỉ service role mới được gọi function này (mặc định security definer + không
-- grant execute cho anon/authenticated là đã đủ an toàn, nhưng revoke rõ ràng cho chắc):
revoke execute on function close_session(uuid) from anon, authenticated;
