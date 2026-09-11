-- P.R.I.S.M. — initial schema, RLS policies, and auth provisioning trigger.
-- Run once in the Supabase SQL Editor (Project → SQL Editor → New query) on a fresh project.

-- ─── profiles ───────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Operator',
  title text not null default 'OPERATOR',
  avatar_url text,
  plan_status text not null default 'free' check (plan_status in ('free','active','past_due','canceled')),
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- No insert/delete policy — rows are created only by handle_new_user() below.

-- ─── stats ──────────────────────────────────────────────────
create table public.stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  queries integer not null default 0,
  sessions integer not null default 0,
  streak integer not null default 0,
  uptime integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.stats enable row level security;

create policy "stats_select_own" on public.stats
  for select using (auth.uid() = user_id);

create policy "stats_update_own" on public.stats
  for update using (auth.uid() = user_id);

-- ─── settings ───────────────────────────────────────────────
create table public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  voice_rate numeric not null default 0.82,
  show_wireframe boolean not null default true,
  voice_idx integer not null default -1,
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;

create policy "settings_select_own" on public.settings
  for select using (auth.uid() = user_id);

create policy "settings_update_own" on public.settings
  for update using (auth.uid() = user_id);

-- ─── income_entries ─────────────────────────────────────────
create table public.income_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null,
  source text not null,
  value numeric not null,
  label text,
  occurred_at timestamptz not null default now()
);

alter table public.income_entries enable row level security;

create policy "income_select_own" on public.income_entries
  for select using (auth.uid() = user_id);

create policy "income_insert_own" on public.income_entries
  for insert with check (auth.uid() = user_id);

create policy "income_delete_own" on public.income_entries
  for delete using (auth.uid() = user_id);

-- ─── networth_entries ───────────────────────────────────────
create table public.networth_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  value numeric not null,
  label text,
  occurred_at timestamptz not null default now()
);

alter table public.networth_entries enable row level security;

create policy "networth_select_own" on public.networth_entries
  for select using (auth.uid() = user_id);

create policy "networth_insert_own" on public.networth_entries
  for insert with check (auth.uid() = user_id);

create policy "networth_delete_own" on public.networth_entries
  for delete using (auth.uid() = user_id);

-- ─── chat_memory ────────────────────────────────────────────
create table public.chat_memory (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','prism')),
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.chat_memory enable row level security;

create policy "chat_memory_select_own" on public.chat_memory
  for select using (auth.uid() = user_id);

create policy "chat_memory_insert_own" on public.chat_memory
  for insert with check (auth.uid() = user_id);

create policy "chat_memory_delete_own" on public.chat_memory
  for delete using (auth.uid() = user_id);

-- ─── subscriptions ──────────────────────────────────────────
-- No client write policy at all — only the Stripe webhook handler
-- (using the service-role key, which bypasses RLS) ever writes this table.
create table public.subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  status text not null,
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

-- ─── api_rate_limits ────────────────────────────────────────
-- Server-only table. Deliberately zero policies for anon/authenticated —
-- with RLS enabled and no policy, those roles get no access at all.
-- Only the service-role key (used in api/_lib/rateLimit.js) touches this.
create table public.api_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

alter table public.api_rate_limits enable row level security;

-- ─── new-user provisioning trigger ───────────────────────────
-- Populates profiles/stats/settings with defaults the moment someone signs up.
-- SECURITY DEFINER lets it insert despite RLS; clients are never granted
-- INSERT on these three tables directly, so there's no path for a client
-- to create or claim a row belonging to a different user.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.stats (user_id) values (new.id);
  insert into public.settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
