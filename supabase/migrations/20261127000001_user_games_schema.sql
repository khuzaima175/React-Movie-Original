-- GameVault Cloud Sync Schema (`public.user_games`)
-- Strictly isolated from CinemaVault's `public.user_vault_items`.
-- Follows Supabase Postgres Best Practices: identity PK, composite RLS index,
-- revoked public/anon grants, and cached `(select auth.uid())` RLS policies.

create table if not exists public.user_games (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  igdb_id integer not null check (igdb_id > 0),
  status text not null check (status in ('completed', 'playing', 'backlog', 'dropped', 'played')),
  title text not null,
  year smallint check (year is null or (year >= 1970 and year <= 2040)),
  cover_url text,
  user_rating smallint check (user_rating is null or (user_rating >= 1 and user_rating <= 10)),
  hours_played numeric(7,1) not null default 0 check (hours_played >= 0 and hours_played <= 50000),
  platform_played text,
  user_note text,
  date_played text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, igdb_id)
);

create index if not exists user_games_user_status_updated_idx
  on public.user_games (user_id, status, updated_at desc);

drop trigger if exists trg_user_games_touch_updated_at on public.user_games;
create trigger trg_user_games_touch_updated_at
  before update on public.user_games
  for each row execute function public.touch_updated_at();

alter table public.user_games enable row level security;

revoke all on public.user_games from public, anon;
grant select, insert, update, delete on public.user_games to authenticated;
grant usage, select on sequence public.user_games_id_seq to authenticated;

drop policy if exists user_games_select_own on public.user_games;
create policy user_games_select_own
  on public.user_games
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_games_insert_own on public.user_games;
create policy user_games_insert_own
  on public.user_games
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_games_update_own on public.user_games;
create policy user_games_update_own
  on public.user_games
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_games_delete_own on public.user_games;
create policy user_games_delete_own
  on public.user_games
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
