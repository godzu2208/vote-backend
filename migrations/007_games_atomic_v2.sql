-- V2 hardening: atomic game editing + clean restart/lobby reset.
-- IMPORTANT: run this migration in Supabase before deploying the matching backend.

create or replace function public.update_game_atomic(
  p_game_id uuid,
  p_created_by uuid,
  p_title text,
  p_cover_url text,
  p_background_type text,
  p_background_value text,
  p_questions jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_question jsonb;
  v_session_id uuid;
  v_index integer := 0;
  v_duration integer;
  v_question_text text;
  v_background_type text;
  v_background_value text;
  v_image_url text;
  v_option text;
  v_option_index integer;
begin
  if p_title is null or btrim(p_title) = '' then raise exception 'invalid_title'; end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) < 1 then raise exception 'invalid_questions'; end if;
  if p_background_type is null or p_background_type not in ('color','gradient','image') then raise exception 'invalid_background_type'; end if;

  select status into v_status
  from public.games
  where id = p_game_id and created_by = p_created_by
  for update;

  if v_status is null then raise exception 'game_not_found'; end if;
  if v_status not in ('draft','lobby') then raise exception 'game_not_editable'; end if;

  if v_status = 'lobby' and exists (
    select 1 from public.game_participants where game_id = p_game_id
  ) then
    raise exception 'game_lobby_has_participants';
  end if;

  -- The game is not playable yet, so rebuild its question set atomically.
  delete from public.votes where session_id in (select id from public.sessions where game_id = p_game_id);
  delete from public.selections where session_id in (select id from public.sessions where game_id = p_game_id);
  delete from public.vote_logs where session_id in (select id from public.sessions where game_id = p_game_id);
  delete from public.sessions where game_id = p_game_id;

  update public.games
  set title = btrim(p_title),
      cover_url = nullif(btrim(coalesce(p_cover_url, '')), ''),
      background_type = p_background_type,
      background_value = nullif(btrim(coalesce(p_background_value, '')), ''),
      current_session_id = null,
      updated_at = now()
  where id = p_game_id;

  for v_question in select value from jsonb_array_elements(p_questions)
  loop
    v_index := v_index + 1;
    v_question_text := btrim(coalesce(v_question->>'question', ''));
    v_duration := coalesce((v_question->>'durationSeconds')::integer, 20);
    v_background_type := coalesce(v_question->>'backgroundType', 'gradient');
    v_background_value := nullif(btrim(coalesce(v_question->>'backgroundValue', '')), '');
    v_image_url := nullif(btrim(coalesce(v_question->>'imageUrl', '')), '');

    if v_question_text = '' then raise exception 'invalid_question'; end if;
    if v_duration <= 0 or v_duration > 3600 then raise exception 'invalid_duration'; end if;
    if v_background_type not in ('color','gradient','image') then raise exception 'invalid_background_type'; end if;
    if jsonb_typeof(v_question->'options') <> 'array' or jsonb_array_length(v_question->'options') < 2 then raise exception 'invalid_options'; end if;

    insert into public.sessions(
      question, status, game_id, sort_order, duration_seconds,
      background_type, background_value, image_url
    ) values (
      v_question_text, 'pending', p_game_id, v_index, v_duration,
      v_background_type, v_background_value, v_image_url
    ) returning id into v_session_id;

    v_option_index := 0;
    for v_option in select value from jsonb_array_elements_text(v_question->'options')
    loop
      v_option_index := v_option_index + 1;
      if btrim(v_option) <> '' then
        insert into public.options(session_id, label, sort_order)
        values (v_session_id, btrim(v_option), v_option_index);
      end if;
    end loop;

    if not exists (select 1 from public.options where session_id = v_session_id) then
      raise exception 'invalid_options';
    end if;
  end loop;

  if v_status = 'lobby' then
    select id into v_session_id
    from public.sessions
    where game_id = p_game_id
    order by sort_order
    limit 1;
    update public.games set current_session_id = v_session_id where id = p_game_id;
  end if;
end;
$$;

revoke execute on function public.update_game_atomic(uuid,uuid,text,text,text,text,jsonb) from anon, authenticated;

create or replace function public.reset_game_to_lobby(
  p_game_id uuid,
  p_created_by uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first uuid;
  v_status text;
begin
  select status into v_status from public.games where id = p_game_id and created_by = p_created_by for update;
  if v_status is null then raise exception 'game_not_found'; end if;
  if v_status not in ('draft','closed','lobby') then raise exception 'game_not_ready'; end if;

  delete from public.votes where session_id in (select id from public.sessions where game_id = p_game_id);
  delete from public.selections where session_id in (select id from public.sessions where game_id = p_game_id);
  delete from public.vote_logs where session_id in (select id from public.sessions where game_id = p_game_id);

  update public.sessions
  set status = 'pending', started_at = null, ended_at = null,
      remaining_seconds = null, paused_at = null
  where game_id = p_game_id;

  select id into v_first from public.sessions where game_id = p_game_id order by sort_order limit 1;
  if v_first is null then raise exception 'game_has_no_questions'; end if;

  update public.games
  set status = 'lobby', current_session_id = v_first, updated_at = now()
  where id = p_game_id;
end;
$$;

revoke execute on function public.reset_game_to_lobby(uuid,uuid) from anon, authenticated;

create or replace function public.reset_game_and_start(
  p_game_id uuid,
  p_created_by uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first uuid;
  v_duration integer;
  v_status text;
begin
  select status into v_status from public.games where id = p_game_id and created_by = p_created_by for update;
  if v_status is null then raise exception 'game_not_found'; end if;
  if v_status not in ('lobby','closed') then raise exception 'game_not_ready'; end if;

  delete from public.votes where session_id in (select id from public.sessions where game_id = p_game_id);
  delete from public.selections where session_id in (select id from public.sessions where game_id = p_game_id);
  delete from public.vote_logs where session_id in (select id from public.sessions where game_id = p_game_id);

  update public.sessions
  set status = 'pending', started_at = null, ended_at = null,
      remaining_seconds = null, paused_at = null
  where game_id = p_game_id;

  select id, duration_seconds into v_first, v_duration
  from public.sessions where game_id = p_game_id order by sort_order limit 1;
  if v_first is null then raise exception 'game_has_no_questions'; end if;

  update public.sessions
  set status = 'active', started_at = now(),
      ended_at = now() + make_interval(secs => coalesce(v_duration,20)),
      remaining_seconds = null, paused_at = null
  where id = v_first;

  update public.games
  set status = 'active', current_session_id = v_first, updated_at = now()
  where id = p_game_id;
end;
$$;

revoke execute on function public.reset_game_and_start(uuid,uuid) from anon, authenticated;
