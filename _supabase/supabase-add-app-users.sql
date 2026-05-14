-- ─────────────────────────────────────────────
-- app_users: PIN 기반 사용자 관리
-- 한 번만 실행
-- ─────────────────────────────────────────────

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pin text not null check (char_length(pin) = 4 and pin ~ '^[0-9]+$'),
  role text not null default 'staff' check (role in ('admin', 'staff')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 시드: 첫 관리자 (함기호 / PIN 5555)
insert into app_users (name, pin, role)
values ('함기호', '5555', 'admin')
on conflict do nothing;

-- 익명 (브라우저)에서 SELECT/INSERT/UPDATE/DELETE 다 허용
-- (PIN 게이트가 클라이언트 사이드 소프트 락이라 RLS도 가볍게 둠)
alter table app_users enable row level security;

drop policy if exists "anon_all_app_users" on app_users;
create policy "anon_all_app_users" on app_users
  for all
  using (true)
  with check (true);

-- updated_at 자동 갱신
create or replace function trigger_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_app_users_updated_at on app_users;
create trigger set_app_users_updated_at
  before update on app_users
  for each row execute function trigger_set_updated_at();
