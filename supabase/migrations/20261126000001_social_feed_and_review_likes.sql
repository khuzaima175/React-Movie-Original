-- CinemaVault: Social Activity Feed, Community Directory Indexes & Review Likes

alter table public.community_ratings
  add column if not exists like_count integer not null default 0 check (like_count >= 0);

create index if not exists community_ratings_user_updated_idx
  on public.community_ratings (user_id, updated_at desc);

create index if not exists public_profiles_watched_count_idx
  on public.public_profiles (watched_count desc);

create index if not exists user_lists_public_popular_idx
  on public.user_lists (bookmark_count desc, updated_at desc)
  where is_public = true and deleted_at is null;

create table if not exists public.community_review_likes (
  user_id uuid not null references auth.users(id) on delete cascade,
  rating_id bigint not null references public.community_ratings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, rating_id)
);

create index if not exists community_review_likes_rating_id_idx
  on public.community_review_likes (rating_id);

alter table public.community_review_likes enable row level security;
revoke all on public.community_review_likes from public, anon, authenticated;
grant select on public.community_review_likes to anon, authenticated;
grant insert, delete on public.community_review_likes to authenticated;

drop policy if exists community_review_likes_select_all on public.community_review_likes;
create policy community_review_likes_select_all
  on public.community_review_likes
  for select
  to anon, authenticated
  using (true);

drop policy if exists community_review_likes_insert_own on public.community_review_likes;
create policy community_review_likes_insert_own
  on public.community_review_likes
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists community_review_likes_delete_own on public.community_review_likes;
create policy community_review_likes_delete_own
  on public.community_review_likes
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.sync_community_review_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.community_ratings
    set like_count = like_count + 1
    where id = new.rating_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.community_ratings
    set like_count = greatest(0, like_count - 1)
    where id = old.rating_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_community_review_likes_count on public.community_review_likes;
create trigger trg_community_review_likes_count
  after insert or delete on public.community_review_likes
  for each row execute function public.sync_community_review_like_count();
