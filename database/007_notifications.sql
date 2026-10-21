-- Per-admin notification read/clear state. Notifications are derived from bugflow.activity (last 10 days).
create table if not exists bugflow.notification_state (
  user_id uuid primary key references bugflow.users(id) on delete cascade,
  read_at timestamptz not null default 'epoch',
  cleared_at timestamptz not null default 'epoch'
);
create index if not exists activity_created_at_idx on bugflow.activity(created_at desc);
alter table bugflow.portals add column if not exists last_seen_at timestamptz;
