-- 领路人 Mentor — Supabase schema (DoubleMi Product 002 candidate)
-- Shares the DoubleMi Supabase project; users/profiles/waitlist come from dream-atlas schema.
-- Run once: Supabase Dashboard → SQL Editor, or management API.

-- ---------- arc docs: one living document per user; the product's soul ----------
create table if not exists public.mentor_arcs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  doc text not null,
  updated_at timestamptz not null default now()
);

-- ---------- sessions: interview / weekly calibration / urgent ----------
create table if not exists public.mentor_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'calibration' check (kind in ('interview','calibration','urgent')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  log text                              -- distilled log entry, written at session close
);
create index if not exists mentor_sessions_user on public.mentor_sessions (user_id, started_at desc);

-- ---------- messages ----------
create table if not exists public.mentor_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.mentor_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists mentor_messages_session on public.mentor_messages (session_id, id);
create index if not exists mentor_messages_user_day on public.mentor_messages (user_id, created_at desc);

-- ---------- row-level security: everything owner-only ----------
alter table public.mentor_arcs     enable row level security;
alter table public.mentor_sessions enable row level security;
alter table public.mentor_messages enable row level security;

create policy "own arc" on public.mentor_arcs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own sessions" on public.mentor_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own messages" on public.mentor_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
