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

-- Returning users ("Remember me", opt-in): onboarding profile, their voice clone id, their selfie.
-- "Forget me" deletes the row and the voice clone.
create table if not exists public.users (
  id          text primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  profile     jsonb not null default '{}'::jsonb,
  voice_id    text,
  selfie      text
);
alter table public.users enable row level security;

-- Optional: delete trials older than 7 days every night, even if nobody saves a new one.
-- (The app already hides expired trials and deletes them on each new save.)
-- Enable "pg_cron" first: Database → Extensions → pg_cron.
select cron.schedule(
  'delete-old-trials',
  '0 3 * * *',
  $$delete from public.trials where created_at < now() - interval '7 days'$$
);
