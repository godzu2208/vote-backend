-- 006_games_v2.sql
-- V2 foundation: one Game PIN can contain multiple question rounds.
-- Existing V1 sessions remain valid; game_id is nullable for backwards compatibility.

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null,
  title text not null,
  pin text not null,
  status text not null default 'draft'
    check (status in ('draft', 'lobby', 'active', 'closed')),
  cover_url text,
  background_type text not null default 'gradient'
    check (background_type in ('color', 'gradient', 'image')),
  background_value text,
  current_session_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists games_pin_uidx on public.games(pin);
create index if not exists games_created_by_idx on public.games(created_by);
create index if not exists games_status_idx on public.games(status);

alter table public.sessions
  add column if not exists game_id uuid,
  add column if not exists sort_order integer not null default 1,
  add column if not exists background_type text default 'gradient',
  add column if not exists background_value text,
  add column if not exists image_url text;

alter table public.sessions
  drop constraint if exists sessions_background_type_check;

alter table public.sessions
  add constraint sessions_background_type_check
  check (background_type is null or background_type in ('color', 'gradient', 'image'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sessions_game_id_fkey'
      and conrelid = 'public.sessions'::regclass
  ) then
    alter table public.sessions
      add constraint sessions_game_id_fkey
      foreign key (game_id) references public.games(id) on delete cascade;
  end if;
end $$;

create unique index if not exists sessions_game_sort_uidx
  on public.sessions(game_id, sort_order)
  where game_id is not null;

create index if not exists sessions_game_id_idx on public.sessions(game_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'games_current_session_id_fkey'
      and conrelid = 'public.games'::regclass
  ) then
    alter table public.games
      add constraint games_current_session_id_fkey
      foreign key (current_session_id) references public.sessions(id)
      on delete set null;
  end if;
end $$;

create table if not exists public.game_participants (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null,
  display_name text not null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(game_id, user_id)
);

create index if not exists game_participants_game_idx
  on public.game_participants(game_id);
create index if not exists game_participants_user_idx
  on public.game_participants(user_id);

-- Keep last_seen_at fresh when a participant rejoins.
create or replace function public.touch_game_participant(
  p_game_id uuid,
  p_user_id uuid,
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into game_participants(game_id, user_id, display_name)
  values (p_game_id, p_user_id, p_display_name)
  on conflict (game_id, user_id)
  do update set
    display_name = excluded.display_name,
    last_seen_at = now();
end;
$$;

revoke execute on function public.touch_game_participant(uuid, uuid, text)
  from anon, authenticated;

-- Realtime for game-level state and participant lobby.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'game_participants'
  ) then
    alter publication supabase_realtime add table public.game_participants;
  end if;
end $$;
