-- Run once in the selected Supabase project's SQL Editor.
begin;
create table public.block_time_games (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('classic', 'endless')),
  score bigint not null check (score >= 0),
  lines integer not null check (lines >= 0),
  level integer not null check (level >= 1),
  created_at timestamptz not null default now()
);
create index block_time_games_history on public.block_time_games(user_id, created_at desc);
create index block_time_games_best on public.block_time_games(user_id, mode, score desc);
alter table public.block_time_games enable row level security;
revoke all on public.block_time_games from anon;
revoke all on public.block_time_games from authenticated;
grant select, insert on public.block_time_games to authenticated;
create policy "Read own games" on public.block_time_games for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own games" on public.block_time_games for insert to authenticated with check ((select auth.uid()) = user_id);
commit;
