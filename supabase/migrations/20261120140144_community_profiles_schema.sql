-- CinemaVault v5.5: Opt-in Public Profiles, Community Film Ratings & Follows Schema

alter table public.profiles
  add column if not exists username text check (username is null or username ~ '^[a-z0-9_]{3,24}$'),
  add column if not exists bio text check (bio is null or char_length(bio) <= 240),
  add column if not exists is_public boolean not null default false,
  add column if not exists favorite_movie_keys text[] not null default '{}'::text[] check (cardinality(favorite_movie_keys) <= 4),
  add column if not exists taste_vector real[] check (taste_vector is null or cardinality(taste_vector) = 64);

create unique index if not exists profiles_username_unique_idx
  on public.profiles (username)
  where username is not null;

create table if not exists public.public_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text,
  bio text check (bio is null or char_length(bio) <= 240),
  favorite_movie_keys text[] not null default '{}'::text[] check (cardinality(favorite_movie_keys) <= 4),
  taste_vector real[] check (taste_vector is null or cardinality(taste_vector) = 64),
  watched_count integer not null default 0 check (watched_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.public_profiles enable row level security;
revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

create policy public_profiles_select_all
  on public.public_profiles
  for select
  to anon, authenticated
  using (true);

create table if not exists public.community_ratings (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  display_name text,
  movie_key text not null,
  tmdb_id integer,
  imdb_id text,
  title text not null,
  year text,
  poster text,
  user_rating smallint not null check (user_rating between 1 and 10),
  user_note text,
  contains_spoilers boolean not null default false,
  craft_breakdown jsonb,
  watched_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, movie_key)
);

create index if not exists community_ratings_tmdb_updated_idx
  on public.community_ratings (tmdb_id, updated_at desc)
  where tmdb_id is not null;

create index if not exists community_ratings_imdb_updated_idx
  on public.community_ratings (imdb_id, updated_at desc)
  where imdb_id is not null;

create index if not exists community_ratings_username_updated_idx
  on public.community_ratings (username, updated_at desc);

create index if not exists community_ratings_user_id_idx
  on public.community_ratings (user_id);

alter table public.community_ratings enable row level security;
revoke all on public.community_ratings from public, anon, authenticated;
grant select on public.community_ratings to anon, authenticated;

create policy community_ratings_select_all
  on public.community_ratings
  for select
  to anon, authenticated
  using (true);

create table if not exists public.user_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists user_follows_following_idx
  on public.user_follows (following_id);

alter table public.user_follows enable row level security;
revoke all on public.user_follows from public, anon, authenticated;
grant select on public.user_follows to anon, authenticated;
grant insert, delete on public.user_follows to authenticated;

create policy user_follows_select_all
  on public.user_follows
  for select
  to anon, authenticated
  using (true);

create policy user_follows_insert_own
  on public.user_follows
  for insert
  to authenticated
  with check (
    (select auth.uid()) = follower_id
    and exists (
      select 1
      from public.public_profiles pp
      where pp.user_id = following_id
    )
  );

create policy user_follows_delete_own
  on public.user_follows
  for delete
  to authenticated
  using ((select auth.uid()) = follower_id);
