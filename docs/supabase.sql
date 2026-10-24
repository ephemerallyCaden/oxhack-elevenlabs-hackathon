-- Shareable trials (/t/[id]). Run once in Supabase → SQL Editor.
-- Stores the transcript + verdict only: no voices, selfies or profiles.
create table if not exists public.trials (
  id          text primary key,
  created_at  timestamptz not null default now(),
  question    text not null,
  transcript  jsonb not null
);

-- Only the server (service role key) reads/writes; no public access.
alter table public.trials enable row level security;
