-- ─────────────────────────────────────────────
-- 변경 이력 로그 (audit log)
-- 누가 / 언제 / 무엇을 했는지 기록 — 위험 작업 추적용
-- 한 번만 실행 (멱등)
-- ─────────────────────────────────────────────

create table if not exists activity_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_name   text,                    -- 사용자 이름 (PinGate에서 받음)
  actor_id     uuid,                    -- app_users.id
  action       text not null,           -- 'create' | 'update' | 'delete' | 'merge' | 'import' | 'restore' | 'hard_delete' | 'convert'
  entity_type  text not null,           -- 'vendor' | 'product' | 'invoice' | 'incoming' | 'quotation' | 'supplier_invoice' | 'cost_item' ...
  entity_id    uuid,                    -- 대상의 id (nullable — 일괄 작업)
  entity_label text,                    -- 사람이 읽을 수 있는 식별자 (예: "마요네즈", "심볼티")
  summary      text,                    -- 한 줄 설명 (예: "단델(마요네즈)을 마요네즈로 병합 (45건 이동)")
  details      jsonb,                   -- 추가 메타 (변경 전/후 값 등)
  created_at   timestamptz default now()
);

create index if not exists idx_activity_logs_created on activity_logs(created_at desc);
create index if not exists idx_activity_logs_entity  on activity_logs(entity_type, entity_id);
create index if not exists idx_activity_logs_actor   on activity_logs(actor_id);

alter table activity_logs enable row level security;
drop policy if exists "anon_all_activity_logs" on activity_logs;
create policy "anon_all_activity_logs" on activity_logs for all using (true) with check (true);
