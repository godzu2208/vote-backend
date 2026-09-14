-- 008_delete_game_atomic.sql
-- Atomic delete for a whole game and its child records.

create or replace function public.delete_game_atomic(
  p_game_id uuid,
  p_created_by uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
begin
  select id into v_game_id
  from public.games
  where id = p_game_id and created_by = p_created_by
  for update;

  if v_game_id is null then
    raise exception 'game_not_found';
  end if;

  delete from public.vote_logs
  where session_id in (select id from public.sessions where game_id = p_game_id);

  delete from public.votes
  where session_id in (select id from public.sessions where game_id = p_game_id);

  delete from public.selections
  where session_id in (select id from public.sessions where game_id = p_game_id);

  delete from public.options
  where session_id in (select id from public.sessions where game_id = p_game_id);

  delete from public.sessions
  where game_id = p_game_id;

  delete from public.game_participants
  where game_id = p_game_id;

  delete from public.games
  where id = p_game_id and created_by = p_created_by;
end;
$$;

revoke execute on function public.delete_game_atomic(uuid, uuid) from anon, authenticated;
