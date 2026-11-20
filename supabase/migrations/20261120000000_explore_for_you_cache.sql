-- CinemaVault Explore "For You" Cloud Cache Schema
-- Caches up to 120 curated personalized film entries per authenticated user
-- so switching devices restores the Explore "For You" catalog without extra Gemini calls.

create table if not exists public.user_explore_picks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile_hash text not null,
  source text not null default 'local-ranker',
  model_used text,
  items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 120),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_user_explore_picks_touch_updated_at on public.user_explore_picks;
create trigger trg_user_explore_picks_touch_updated_at
  before update on public.user_explore_picks
  for each row execute function public.touch_updated_at();

alter table public.user_explore_picks enable row level security;

revoke all on public.user_explore_picks from public, anon;
grant select, insert, update, delete on public.user_explore_picks to authenticated;

drop policy if exists explore_picks_select_own on public.user_explore_picks;
create policy explore_picks_select_own
  on public.user_explore_picks
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists explore_picks_insert_own on public.user_explore_picks;
create policy explore_picks_insert_own
  on public.user_explore_picks
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists explore_picks_update_own on public.user_explore_picks;
create policy explore_picks_update_own
  on public.user_explore_picks
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists explore_picks_delete_own on public.user_explore_picks;
create policy explore_picks_delete_own
  on public.user_explore_picks
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
