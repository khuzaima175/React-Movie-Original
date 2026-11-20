-- CinemaVault v5.4: Sync user taste_rules on profiles & expand user_explore_picks cap to 260 items

alter table public.profiles
  add column if not exists taste_rules jsonb not null default '[]'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_taste_rules_array_check;

alter table public.profiles
  add constraint profiles_taste_rules_array_check
  check (
    jsonb_typeof(taste_rules) = 'array'
    and jsonb_array_length(taste_rules) <= 8
  );

alter table public.user_explore_picks
  drop constraint if exists user_explore_picks_items_check;

alter table public.user_explore_picks
  add constraint user_explore_picks_items_check
  check (
    jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) <= 260
  );
