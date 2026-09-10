-- 005_restart_session.sql
-- Reset một session đã closed thành một vòng vote mới.
-- Chạy toàn bộ trong một transaction để không bao giờ giữ lại votes cũ.

create or replace function public.restart_session(
  p_session_id uuid,
  p_duration_seconds integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_duration_seconds is null or p_duration_seconds <= 0 then
    raise exception 'invalid_duration';
  end if;

  select status into v_status
  from public.sessions
  where id = p_session_id
  for update;

  if v_status is null then
    raise exception 'session_not_found';
  end if;

  if v_status <> 'closed' then
    raise exception 'session_not_closed';
  end if;

  -- Xóa kết quả và trạng thái lựa chọn của vòng cũ trước.
  delete from public.votes
  where session_id = p_session_id;

  delete from public.selections
  where session_id = p_session_id;

  -- Xóa cả log join/vote/no_answer của vòng cũ để Joined/Waiting bắt đầu lại từ 0.
  delete from public.vote_logs
  where session_id = p_session_id;

  update public.sessions
  set status = 'active',
      started_at = now(),
      duration_seconds = p_duration_seconds,
      ended_at = now() + make_interval(secs => p_duration_seconds),
      remaining_seconds = null,
      paused_at = null
  where id = p_session_id;
end;
$$;

revoke execute on function public.restart_session(uuid, integer) from anon, authenticated;
