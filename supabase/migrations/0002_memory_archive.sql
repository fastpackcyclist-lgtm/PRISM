-- P.R.I.S.M. — memory archive (long-term layer) and a real ceiling on
-- chat_memory (short-term layer). Run once in the Supabase SQL Editor.
--
-- chat_memory already existed as the working buffer, but grew forever —
-- the app only ever fetched the most recent 40 rows, it never enforced
-- that as an actual limit. This migration adds the long-term layer that
-- makes 40 a real ceiling: once a user's chat_memory crosses it, the
-- oldest exchanges get summarized and moved here, then deleted from the
-- active buffer. Retrieval is semantic (pgvector cosine similarity),
-- scoped to the calling user via auth.uid() — same RLS discipline as
-- every other table in this project.

create extension if not exists vector;

-- ─── memory_archive ─────────────────────────────────────────
-- Voyage AI's voyage-3 model produces 1024-dimension embeddings.
create table public.memory_archive (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  summary text not null,
  embedding vector(1024) not null,
  covers_from timestamptz not null,
  covers_to timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.memory_archive enable row level security;

create policy "memory_archive_select_own" on public.memory_archive
  for select using (auth.uid() = user_id);

create policy "memory_archive_insert_own" on public.memory_archive
  for insert with check (auth.uid() = user_id);

create policy "memory_archive_delete_own" on public.memory_archive
  for delete using (auth.uid() = user_id);

-- Cosine-distance index — ivfflat needs rows to build against, so this
-- is cheap now and earns its keep once real archives accumulate.
create index memory_archive_embedding_idx on public.memory_archive
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ─── match_memory ───────────────────────────────────────────
-- Not SECURITY DEFINER: runs as the calling (authenticated) role, so
-- table RLS still applies. The explicit user_id filter is defense in
-- depth, not a substitute for it.
create function public.match_memory(
  query_embedding vector(1024),
  match_count int default 5
)
returns table (
  id bigint,
  summary text,
  covers_from timestamptz,
  covers_to timestamptz,
  similarity float
)
language sql
stable
as $$
  select
    id,
    summary,
    covers_from,
    covers_to,
    1 - (embedding <=> query_embedding) as similarity
  from public.memory_archive
  where user_id = auth.uid()
  order by embedding <=> query_embedding
  limit match_count;
$$;
