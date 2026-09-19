-- P.R.I.S.M. — Schedule panel: personal events/tasks, manually entered.
-- No calendar sync, no recurrence, no reminders in v1 — deliberately scoped
-- down to match the same "manual entry, real infra later" shape income and
-- net worth started with.

create table public.schedule_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  scheduled_at timestamptz not null,
  notes text,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.schedule_entries enable row level security;

create policy "schedule_select_own" on public.schedule_entries
  for select using (auth.uid() = user_id);

create policy "schedule_insert_own" on public.schedule_entries
  for insert with check (auth.uid() = user_id);

create policy "schedule_update_own" on public.schedule_entries
  for update using (auth.uid() = user_id);

create policy "schedule_delete_own" on public.schedule_entries
  for delete using (auth.uid() = user_id);

create index schedule_entries_user_time_idx on public.schedule_entries (user_id, scheduled_at);
