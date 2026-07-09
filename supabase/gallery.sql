-- 领路人 — 回音廊 The Echo Gallery
-- Users voluntarily share a written moment from their journey (never the arc
-- document itself). Moderation flow mirrors 觅梦: shares land with
-- approved=false; the curator flips `approved` in Table Editor.

create table if not exists public.mentor_gallery (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  pen_name text,
  content text not null check (char_length(content) between 20 and 2000),
  lang text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists mentor_gallery_approved_time
  on public.mentor_gallery (approved, created_at desc);

alter table public.mentor_gallery enable row level security;

-- anyone may view APPROVED echoes
create policy "public may view approved" on public.mentor_gallery
  for select to anon, authenticated using (approved);

-- owners may always see their own (incl. pending)
create policy "owner may view own" on public.mentor_gallery
  for select to authenticated using (auth.uid() = user_id);

-- signed-in users may share; shares always enter unapproved
create policy "owner may share unapproved" on public.mentor_gallery
  for insert to authenticated with check (auth.uid() = user_id and approved = false);

-- owners may withdraw their echo at any time
create policy "owner may delete own" on public.mentor_gallery
  for delete to authenticated using (auth.uid() = user_id);

-- 共鸣「同路」— one per visitor per echo
create table if not exists public.mentor_gallery_resonance (
  gallery_id uuid not null references public.mentor_gallery(id) on delete cascade,
  anon_id text not null,
  created_at timestamptz not null default now(),
  primary key (gallery_id, anon_id)
);

alter table public.mentor_gallery_resonance enable row level security;

create policy "public may view resonance" on public.mentor_gallery_resonance
  for select to anon, authenticated using (true);

create policy "anyone may resonate" on public.mentor_gallery_resonance
  for insert to anon, authenticated with check (true);
