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

-- Returning users ("Remember me", opt-in, signed in with Google via Supabase Auth): onboarding
-- profile, their voice clone id, their head cut-outs (`selfie`: a data URL, or JSON with both heads).
-- `id` is the Supabase Auth user id; /api/users* verify the caller's session token and only touch
-- their own row. Rows from before sign-in (random ids) are unreachable: delete them with
--   delete from public.users where id !~ '^[0-9a-f]{8}-';
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
