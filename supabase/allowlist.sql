-- 领路人 — 内测白名单。仅 service role 可读（Edge Function 内检查），无公共策略。
-- 放行一个人 = 在 Table Editor 给 mentor_allowlist 加一行 email。
create table if not exists public.mentor_allowlist (
  email text primary key,
  added_at timestamptz not null default now()
);
alter table public.mentor_allowlist enable row level security;

insert into public.mentor_allowlist (email)
values ('doctor.michen@gmail.com')
on conflict do nothing;
