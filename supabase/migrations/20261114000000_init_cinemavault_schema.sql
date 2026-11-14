-- CinemaVault Cloud Vault Sync Schema
-- Requires Postgres 15+ (Supabase hosted Postgres 17.6)

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  user_region text not null default 'GLOBAL',
  preferred_providers integer[] not null default '{}'::integer[],
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_vault_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  movie_key text not null,
  status text not null check (status in ('watched', 'watchlist')),
  tmdb_id integer,
  imdb_id text,
  title text not null,
  year text,
  poster text,
  genre text,
  director text,
  runtime integer,
  imdb_rating numeric(3,1),
  user_rating smallint check (user_rating is null or (user_rating >= 0 and user_rating <= 10)),
  user_note text,
  date_watched timestamptz,
  is_bulk_imported boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, movie_key)
);

create index if not exists user_vault_items_user_status_idx
  on public.user_vault_items (user_id, status, updated_at desc);

drop trigger if exists trg_profiles_touch_updated_at on public.profiles;
create trigger trg_profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_user_vault_items_touch_updated_at on public.user_vault_items;
create trigger trg_user_vault_items_touch_updated_at
  before update on public.user_vault_items
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.user_vault_items enable row level security;

revoke all on public.profiles, public.user_vault_items from public, anon;
grant select, insert, update, delete on public.profiles, public.user_vault_items to authenticated;
grant usage, select on sequence public.user_vault_items_id_seq to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own
  on public.profiles
  for delete
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists vault_items_select_own on public.user_vault_items;
create policy vault_items_select_own
  on public.user_vault_items
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists vault_items_insert_own on public.user_vault_items;
create policy vault_items_insert_own
  on public.user_vault_items
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists vault_items_update_own on public.user_vault_items;
create policy vault_items_update_own
  on public.user_vault_items
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists vault_items_delete_own on public.user_vault_items;
create policy vault_items_delete_own
  on public.user_vault_items
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
