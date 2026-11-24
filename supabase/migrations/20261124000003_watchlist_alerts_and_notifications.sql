-- CinemaVault Track 6: Watchlist Availability Snapshots, User Notifications & Digest Preferences

alter table public.profiles
  add column if not exists alert_email_enabled boolean not null default false,
  add column if not exists alert_frequency text not null default 'weekly' check (alert_frequency in ('weekly', 'off')),
  add column if not exists last_digest_sent_at timestamptz;

create table if not exists public.watchlist_provider_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  tmdb_id integer not null,
  region text not null default 'US',
  provider_ids integer[] not null default '{}'::integer[],
  checked_at timestamptz not null default now(),
  primary key (user_id, tmdb_id, region)
);

alter table public.watchlist_provider_snapshots enable row level security;
revoke all on public.watchlist_provider_snapshots from public, anon, authenticated;

create table if not exists public.user_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('watchlist_available', 'high_match_release')),
  tmdb_id integer not null,
  title text not null,
  poster text,
  provider_id integer not null default 0,
  provider_name text,
  match_pct smallint,
  watch_link text,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, type, tmdb_id, provider_id)
);

create index if not exists user_notifications_user_created_idx
  on public.user_notifications (user_id, created_at desc);

create index if not exists user_notifications_unread_idx
  on public.user_notifications (user_id)
  where read_at is null;

alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from public, anon, authenticated;
grant select, update on public.user_notifications to authenticated;

drop policy if exists user_notifications_select_own on public.user_notifications;
create policy user_notifications_select_own
  on public.user_notifications
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_notifications_update_own on public.user_notifications;
create policy user_notifications_update_own
  on public.user_notifications
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
