-- CinemaVault v5.5: Community Sync Triggers & is_visible RLS

alter table public.public_profiles
  add column if not exists is_visible boolean not null default true;

alter table public.community_ratings
  add column if not exists is_visible boolean not null default true;

alter policy public_profiles_select_all
  on public.public_profiles
  using (is_visible = true);

alter policy community_ratings_select_all
  on public.community_ratings
  using (is_visible = true);

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
    user_id, username, display_name, bio, favorite_movie_keys, taste_vector, watched_count, is_visible, updated_at
  )
  values (
    v_user_id, new.username, new.display_name, new.bio, coalesce(new.favorite_movie_keys, '{}'::text[]),
    new.taste_vector, coalesce(v_watched_count, 0), true, now()
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
      user_id, username, display_name, movie_key, tmdb_id, imdb_id, title, year, poster,
      user_rating, user_note, contains_spoilers, craft_breakdown, watched_at, is_visible, updated_at
    )
    select
      uvi.user_id, new.username, new.display_name, uvi.movie_key, uvi.tmdb_id, uvi.imdb_id, uvi.title, uvi.year, uvi.poster,
      uvi.user_rating, uvi.user_note,
      coalesce((uvi.metadata->>'containsSpoilers')::boolean, false),
      uvi.metadata->'craftRatings', uvi.date_watched, true, now()
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
    return null;
  end if;

  if tg_op = 'DELETE' then
    update public.community_ratings
       set is_visible = false,
           updated_at = now()
     where user_id = v_user_id
       and movie_key = v_movie_key
       and is_visible = true;
  elsif new.status <> 'watched'
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
      user_id, username, display_name, movie_key, tmdb_id, imdb_id, title, year, poster,
      user_rating, user_note, contains_spoilers, craft_breakdown, watched_at, is_visible, updated_at
    )
    values (
      v_user_id, v_profile.username, v_profile.display_name, new.movie_key, new.tmdb_id, new.imdb_id, new.title, new.year, new.poster,
      new.user_rating, new.user_note,
      coalesce((new.metadata->>'containsSpoilers')::boolean, false),
      new.metadata->'craftRatings', new.date_watched, true, now()
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

  return null;
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
