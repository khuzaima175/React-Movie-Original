-- CinemaVault v5.5: Opt-in Public Profiles, Community Film Ratings & Taste Twin Social Layer
-- Privacy-first: profiles default to is_public = false; auth.users.email and isSample items are never published.
-- Toggling is_public = false immediately flips is_visible = false, hiding all rows via Postgres RLS.

-- 1. Extend private owner-only public.profiles with opt-in community columns
alter table public.profiles
  add column if not exists username text check (username is null or username ~ '^[a-z0-9_]{3,24}$'),
  add column if not exists bio text check (bio is null or char_length(bio) <= 240),
  add column if not exists is_public boolean not null default false,
  add column if not exists favorite_movie_keys text[] not null default '{}'::text[] check (cardinality(favorite_movie_keys) <= 4),
  add column if not exists taste_vector real[] check (taste_vector is null or cardinality(taste_vector) = 64);

create unique index if not exists profiles_username_unique_idx
  on public.profiles (username)
  where username is not null;

-- 2. Public projection of opted-in profiles (read-only for clients; maintained solely by triggers)
create table if not exists public.public_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text,
  bio text check (bio is null or char_length(bio) <= 240),
  favorite_movie_keys text[] not null default '{}'::text[] check (cardinality(favorite_movie_keys) <= 4),
  taste_vector real[] check (taste_vector is null or cardinality(taste_vector) = 64),
  watched_count integer not null default 0 check (watched_count >= 0),
  is_visible boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.public_profiles enable row level security;
revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

create policy public_profiles_select_all
  on public.public_profiles
  for select
  to anon, authenticated
  using (is_visible = true);

-- 3. Public community film ratings & reviews (read-only for clients; maintained solely by triggers)
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
  is_visible boolean not null default true,
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
  using (is_visible = true);

-- 4. Social follows graph
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

-- 5. Non-exposed internal schema for trigger-only synchronization functions
create schema if not exists cv_internal;
revoke all on schema cv_internal from public, anon, authenticated;

create or replace function cv_internal.sync_public_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_watched_count integer;
begin
  v_user_id := new.id;

  if coalesce(new.is_public, false) = false or new.username is null then
    update public.community_ratings
       set is_visible = false,
           updated_at = now()
     where user_id = v_user_id
       and is_visible = true;

    update public.public_profiles
       set is_visible = false,
           updated_at = now()
     where user_id = v_user_id
       and is_visible = true;

    return new;
  end if;

  select count(*)::integer
    into v_watched_count
    from public.user_vault_items uvi
   where uvi.user_id = v_user_id
     and uvi.status = 'watched'
     and coalesce((uvi.metadata->>'isSample')::boolean, false) = false;

  insert into public.public_profiles (
    user_id,
    username,
    display_name,
    bio,
    favorite_movie_keys,
    taste_vector,
    watched_count,
    is_visible,
    updated_at
  )
  values (
    v_user_id,
    new.username,
    new.display_name,
    new.bio,
    coalesce(new.favorite_movie_keys, '{}'::text[]),
    new.taste_vector,
    coalesce(v_watched_count, 0),
    true,
    now()
  )
  on conflict (user_id) do update
  set username = excluded.username,
      display_name = excluded.display_name,
      bio = excluded.bio,
      favorite_movie_keys = excluded.favorite_movie_keys,
      taste_vector = excluded.taste_vector,
      watched_count = excluded.watched_count,
      is_visible = true,
      updated_at = now();

  if tg_op = 'INSERT'
     or coalesce(old.is_public, false) = false
     or old.username is distinct from new.username
     or old.display_name is distinct from new.display_name then
    insert into public.community_ratings (
      user_id,
      username,
      display_name,
      movie_key,
      tmdb_id,
      imdb_id,
      title,
      year,
      poster,
      user_rating,
      user_note,
      contains_spoilers,
      craft_breakdown,
      watched_at,
      is_visible,
      updated_at
    )
    select
      uvi.user_id,
      new.username,
      new.display_name,
      uvi.movie_key,
      uvi.tmdb_id,
      uvi.imdb_id,
      uvi.title,
      uvi.year,
      uvi.poster,
      uvi.user_rating,
      uvi.user_note,
      coalesce((uvi.metadata->>'containsSpoilers')::boolean, false),
      uvi.metadata->'craftRatings',
      uvi.date_watched,
      true,
      now()
    from public.user_vault_items uvi
    where uvi.user_id = v_user_id
      and uvi.status = 'watched'
      and uvi.user_rating between 1 and 10
      and coalesce((uvi.metadata->>'isSample')::boolean, false) = false
    on conflict (user_id, movie_key) do update
    set username = excluded.username,
        display_name = excluded.display_name,
        tmdb_id = excluded.tmdb_id,
        imdb_id = excluded.imdb_id,
        title = excluded.title,
        year = excluded.year,
        poster = excluded.poster,
        user_rating = excluded.user_rating,
        user_note = excluded.user_note,
        contains_spoilers = excluded.contains_spoilers,
        craft_breakdown = excluded.craft_breakdown,
        watched_at = excluded.watched_at,
        is_visible = true,
        updated_at = now();
  end if;

  return new;
end;
$$;

create or replace function cv_internal.sync_community_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_movie_key text;
  v_profile record;
  v_watched_count integer;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
    v_movie_key := old.movie_key;
  else
    v_user_id := new.user_id;
    v_movie_key := new.movie_key;
  end if;

  select p.username, p.display_name, p.is_public
    into v_profile
    from public.profiles p
   where p.id = v_user_id;

  if not found or coalesce(v_profile.is_public, false) = false or v_profile.username is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE'
     or new.status <> 'watched'
     or new.user_rating is null
     or new.user_rating < 1
     or coalesce((new.metadata->>'isSample')::boolean, false) = true then
    update public.community_ratings
       set is_visible = false,
           updated_at = now()
     where user_id = v_user_id
       and movie_key = v_movie_key
       and is_visible = true;
  else
    insert into public.community_ratings (
      user_id,
      username,
      display_name,
      movie_key,
      tmdb_id,
      imdb_id,
      title,
      year,
      poster,
      user_rating,
      user_note,
      contains_spoilers,
      craft_breakdown,
      watched_at,
      is_visible,
      updated_at
    )
    values (
      v_user_id,
      v_profile.username,
      v_profile.display_name,
      new.movie_key,
      new.tmdb_id,
      new.imdb_id,
      new.title,
      new.year,
      new.poster,
      new.user_rating,
      new.user_note,
      coalesce((new.metadata->>'containsSpoilers')::boolean, false),
      new.metadata->'craftRatings',
      new.date_watched,
      true,
      now()
    )
    on conflict (user_id, movie_key) do update
    set username = excluded.username,
        display_name = excluded.display_name,
        tmdb_id = excluded.tmdb_id,
        imdb_id = excluded.imdb_id,
        title = excluded.title,
        year = excluded.year,
        poster = excluded.poster,
        user_rating = excluded.user_rating,
        user_note = excluded.user_note,
        contains_spoilers = excluded.contains_spoilers,
        craft_breakdown = excluded.craft_breakdown,
        watched_at = excluded.watched_at,
        is_visible = true,
        updated_at = now();
  end if;

  select count(*)::integer
    into v_watched_count
    from public.user_vault_items uvi
   where uvi.user_id = v_user_id
     and uvi.status = 'watched'
     and coalesce((uvi.metadata->>'isSample')::boolean, false) = false;

  update public.public_profiles
     set watched_count = coalesce(v_watched_count, 0),
         updated_at = now()
   where user_id = v_user_id;

  return coalesce(new, old);
end;
$$;

revoke all on function cv_internal.sync_public_profile() from public, anon, authenticated;
revoke all on function cv_internal.sync_community_rating() from public, anon, authenticated;

create trigger trg_profiles_sync_public
  after insert or update on public.profiles
  for each row execute function cv_internal.sync_public_profile();

create trigger trg_vault_items_sync_community
  after insert or update or delete on public.user_vault_items
  for each row execute function cv_internal.sync_community_rating();
