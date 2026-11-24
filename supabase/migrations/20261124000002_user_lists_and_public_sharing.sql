-- CinemaVault Track 5: Custom User Lists, Public Sharing & Bookmarks

create table if not exists public.user_lists (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  source_checklist_id text,
  items jsonb not null default '[]'::jsonb,
  is_public boolean not null default false,
  slug text unique check (slug is null or slug ~ '^[a-z0-9-]{4,96}$'),
  bookmark_count integer not null default 0 check (bookmark_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists user_lists_user_updated_idx
  on public.user_lists (user_id, updated_at desc);

create index if not exists user_lists_public_slug_idx
  on public.user_lists (slug)
  where is_public = true and deleted_at is null;

drop trigger if exists trg_user_lists_touch_updated_at on public.user_lists;
create trigger trg_user_lists_touch_updated_at
  before update on public.user_lists
  for each row execute function public.touch_updated_at();

alter table public.user_lists enable row level security;
revoke all on public.user_lists from public, anon, authenticated;
grant select on public.user_lists to anon, authenticated;
grant insert, update, delete on public.user_lists to authenticated;

drop policy if exists user_lists_select_own_or_public on public.user_lists;
create policy user_lists_select_own_or_public
  on public.user_lists
  for select
  to anon, authenticated
  using (
    (is_public = true and deleted_at is null)
    or (select auth.uid()) = user_id
  );

drop policy if exists user_lists_insert_own on public.user_lists;
create policy user_lists_insert_own
  on public.user_lists
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_lists_update_own on public.user_lists;
create policy user_lists_update_own
  on public.user_lists
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_lists_delete_own on public.user_lists;
create policy user_lists_delete_own
  on public.user_lists
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.user_list_bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id text not null references public.user_lists(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, list_id)
);

create index if not exists user_list_bookmarks_list_id_idx
  on public.user_list_bookmarks (list_id);

alter table public.user_list_bookmarks enable row level security;
revoke all on public.user_list_bookmarks from public, anon, authenticated;
grant select, insert, delete on public.user_list_bookmarks to authenticated;

drop policy if exists user_list_bookmarks_select_own on public.user_list_bookmarks;
create policy user_list_bookmarks_select_own
  on public.user_list_bookmarks
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_list_bookmarks_insert_own on public.user_list_bookmarks;
create policy user_list_bookmarks_insert_own
  on public.user_list_bookmarks
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.user_lists ul
      where ul.id = list_id and ul.is_public = true and ul.deleted_at is null
    )
  );

drop policy if exists user_list_bookmarks_delete_own on public.user_list_bookmarks;
create policy user_list_bookmarks_delete_own
  on public.user_list_bookmarks
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.sync_user_list_bookmark_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.user_lists
    set bookmark_count = bookmark_count + 1
    where id = new.list_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.user_lists
    set bookmark_count = greatest(0, bookmark_count - 1)
    where id = old.list_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_user_list_bookmarks_count on public.user_list_bookmarks;
create trigger trg_user_list_bookmarks_count
  after insert or delete on public.user_list_bookmarks
  for each row execute function public.sync_user_list_bookmark_count();
