-- CinemaVault Track 4: Watch Together Collaborative Sessions & Swipe Rooms

create table if not exists public.watch_sessions (
  id bigint generated always as identity primary key,
  room_code text unique not null check (room_code ~ '^[A-Z0-9]{8}$'),
  host_user_id uuid references auth.users(id) on delete set null,
  host_name text not null default 'Host' check (char_length(host_name) <= 48),
  host_vector real[] check (host_vector is null or cardinality(host_vector) = 64),
  host_watched_ids integer[] not null default '{}'::integer[],
  host_avoid_rules jsonb not null default '[]'::jsonb,
  guest_name text check (guest_name is null or char_length(guest_name) <= 48),
  guest_vector real[] check (guest_vector is null or cardinality(guest_vector) = 64),
  guest_watched_ids integer[] not null default '{}'::integer[],
  guest_avoid_rules jsonb not null default '[]'::jsonb,
  deck_items jsonb not null default '[]'::jsonb,
  host_votes jsonb not null default '{}'::jsonb,
  guest_votes jsonb not null default '{}'::jsonb,
  region text not null default 'US',
  provider_ids integer[] not null default '{}'::integer[],
  expires_at timestamptz not null default (now() + interval '48 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists watch_sessions_host_user_idx
  on public.watch_sessions (host_user_id)
  where host_user_id is not null;

create index if not exists watch_sessions_expires_idx
  on public.watch_sessions (expires_at);

drop trigger if exists trg_watch_sessions_touch_updated_at on public.watch_sessions;
create trigger trg_watch_sessions_touch_updated_at
  before update on public.watch_sessions
  for each row execute function public.touch_updated_at();

alter table public.watch_sessions enable row level security;
revoke all on public.watch_sessions from public, anon, authenticated;

-- Room access is mediated strictly through room_code-scoped RPCs so nobody can scan active rooms.
create or replace function public.create_watch_session(
  p_room_code text,
  p_host_name text default 'Host',
  p_host_vector real[] default null,
  p_host_watched_ids integer[] default '{}'::integer[],
  p_host_avoid_rules jsonb default '[]'::jsonb,
  p_deck_items jsonb default '[]'::jsonb,
  p_region text default 'US',
  p_provider_ids integer[] default '{}'::integer[]
)
returns public.watch_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.watch_sessions;
  v_code text := upper(trim(coalesce(p_room_code, '')));
begin
  if v_code !~ '^[A-Z0-9]{8}$' then
    raise exception 'Invalid watch session room code';
  end if;

  insert into public.watch_sessions (
    room_code,
    host_user_id,
    host_name,
    host_vector,
    host_watched_ids,
    host_avoid_rules,
    deck_items,
    region,
    provider_ids
  )
  values (
    v_code,
    (select auth.uid()),
    coalesce(nullif(trim(p_host_name), ''), 'Host'),
    p_host_vector,
    coalesce(p_host_watched_ids, '{}'::integer[]),
    coalesce(p_host_avoid_rules, '[]'::jsonb),
    coalesce(p_deck_items, '[]'::jsonb),
    coalesce(nullif(trim(p_region), ''), 'US'),
    coalesce(p_provider_ids, '{}'::integer[])
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.get_watch_session_by_code(p_room_code text)
returns public.watch_sessions
language sql
security definer
set search_path = ''
as $$
  select *
  from public.watch_sessions
  where room_code = upper(trim(coalesce(p_room_code, '')))
  limit 1;
$$;

create or replace function public.join_watch_session(
  p_room_code text,
  p_guest_name text default 'Partner',
  p_guest_vector real[] default null,
  p_guest_watched_ids integer[] default '{}'::integer[],
  p_guest_avoid_rules jsonb default '[]'::jsonb,
  p_deck_items jsonb default null
)
returns public.watch_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.watch_sessions;
  v_code text := upper(trim(coalesce(p_room_code, '')));
begin
  update public.watch_sessions
  set
    guest_name = coalesce(nullif(trim(p_guest_name), ''), guest_name, 'Partner'),
    guest_vector = coalesce(p_guest_vector, guest_vector),
    guest_watched_ids = coalesce(p_guest_watched_ids, guest_watched_ids),
    guest_avoid_rules = coalesce(p_guest_avoid_rules, guest_avoid_rules),
    deck_items = coalesce(p_deck_items, deck_items)
  where room_code = v_code
    and expires_at > now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.submit_watch_session_vote(
  p_room_code text,
  p_role text,
  p_tmdb_id integer,
  p_vote text
)
returns public.watch_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.watch_sessions;
  v_code text := upper(trim(coalesce(p_room_code, '')));
  v_role text := lower(trim(coalesce(p_role, '')));
  v_vote text := lower(trim(coalesce(p_vote, '')));
begin
  if v_role not in ('host', 'guest') then
    raise exception 'Invalid participant role';
  end if;
  if v_vote not in ('yes', 'no') then
    raise exception 'Invalid swipe vote';
  end if;

  if v_role = 'host' then
    update public.watch_sessions
    set host_votes = coalesce(host_votes, '{}'::jsonb) || jsonb_build_object(p_tmdb_id::text, v_vote)
    where room_code = v_code
      and expires_at > now()
    returning * into v_row;
  else
    update public.watch_sessions
    set guest_votes = coalesce(guest_votes, '{}'::jsonb) || jsonb_build_object(p_tmdb_id::text, v_vote)
    where room_code = v_code
      and expires_at > now()
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke execute on function public.create_watch_session(text, text, real[], integer[], jsonb, jsonb, text, integer[]) from public;
revoke execute on function public.get_watch_session_by_code(text) from public;
revoke execute on function public.join_watch_session(text, text, real[], integer[], jsonb, jsonb) from public;
revoke execute on function public.submit_watch_session_vote(text, text, integer, text) from public;

grant execute on function public.create_watch_session(text, text, real[], integer[], jsonb, jsonb, text, integer[]) to anon, authenticated;
grant execute on function public.get_watch_session_by_code(text) to anon, authenticated;
grant execute on function public.join_watch_session(text, text, real[], integer[], jsonb, jsonb) to anon, authenticated;
grant execute on function public.submit_watch_session_vote(text, text, integer, text) to anon, authenticated;
