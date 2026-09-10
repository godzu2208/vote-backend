-- 004_join_code_and_realtime.sql
-- Session code + Supabase Realtime cho live stats.
-- An toàn để chạy nhiều lần.

alter table public.sessions
  add column if not exists join_code text;

-- Chuẩn hóa dữ liệu cũ trước khi thêm constraint.
update public.sessions
set join_code = upper(trim(join_code))
where join_code is not null;

-- Chuẩn hóa code admin nhập thành chữ hoa ở backend.
alter table public.sessions
  drop constraint if exists sessions_join_code_format_check;

alter table public.sessions
  add constraint sessions_join_code_format_check
  check (join_code is null or join_code ~ '^[A-Z0-9]{3,8}$');

create unique index if not exists sessions_join_code_uidx
  on public.sessions (join_code)
  where join_code is not null;

-- Cho frontend admin nhận INSERT/UPDATE realtime của selections và vote_logs.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'selections'
  ) then
    alter publication supabase_realtime add table public.selections;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'vote_logs'
  ) then
    alter publication supabase_realtime add table public.vote_logs;
  end if;
end $$;
