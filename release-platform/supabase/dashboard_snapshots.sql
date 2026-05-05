create extension if not exists pgcrypto;

create or replace function public.release_platform_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.dashboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  version text not null,
  snapshot_at timestamptz not null,
  source text not null default 'dashboard',

  total_cases integer not null default 0,
  finished_cases integer not null default 0,
  manual_finished_cases integer not null default 0,
  manual_timed_finished_cases integer not null default 0,
  remaining_cases integer not null default 0,
  assigned_cases integer not null default 0,
  in_progress_cases integer not null default 0,
  launches_count integer not null default 0,
  active_people_count integer not null default 0,
  active_people_logins text[] not null default '{}'::text[],

  readiness_android numeric(6,2) not null default 0,
  readiness_ios numeric(6,2) not null default 0,
  critical_total integer not null default 0,
  critical_finished integer not null default 0,
  selective_total integer not null default 0,
  selective_finished integer not null default 0,
  uwu_total integer not null default 0,
  uwu_left integer not null default 0,
  empty_alerts integer not null default 0,
  no_passed_alerts integer not null default 0,

  completion_pct numeric(6,2) not null default 0,
  manual_completion_pct numeric(6,2) not null default 0,
  critical_completion_pct numeric(6,2) not null default 0,
  selective_completion_pct numeric(6,2) not null default 0,
  readiness_min_pct numeric(6,2) not null default 0,
  readiness_gap_pct numeric(6,2) not null default 0,

  prediction_status text,
  prediction_risk numeric(6,4),
  prediction_confidence numeric(6,4),
  eta_at timestamptz,
  deadline_at timestamptz,

  history_point jsonb not null default '{}'::jsonb,
  aggregate_payload jsonb not null default '{}'::jsonb,
  uwu_payload jsonb not null default '{}'::jsonb,
  readiness_payload jsonb not null default '[]'::jsonb,
  launches_payload jsonb not null default '[]'::jsonb,
  alerts_payload jsonb not null default '[]'::jsonb,
  prediction_payload jsonb not null default '{}'::jsonb,
  enrichment_payload jsonb not null default '{}'::jsonb,
  tracking_payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint dashboard_snapshots_completion_pct_check check (completion_pct >= 0 and completion_pct <= 100),
  constraint dashboard_snapshots_manual_completion_pct_check check (manual_completion_pct >= 0 and manual_completion_pct <= 100),
  constraint dashboard_snapshots_critical_completion_pct_check check (critical_completion_pct >= 0 and critical_completion_pct <= 100),
  constraint dashboard_snapshots_selective_completion_pct_check check (selective_completion_pct >= 0 and selective_completion_pct <= 100),
  constraint dashboard_snapshots_readiness_android_check check (readiness_android >= 0 and readiness_android <= 100),
  constraint dashboard_snapshots_readiness_ios_check check (readiness_ios >= 0 and readiness_ios <= 100)
);

create unique index if not exists dashboard_snapshots_project_version_snapshot_uidx
on public.dashboard_snapshots (project_id, version, snapshot_at);

create index if not exists dashboard_snapshots_version_snapshot_idx
on public.dashboard_snapshots (version, snapshot_at desc);

create index if not exists dashboard_snapshots_project_version_snapshot_idx
on public.dashboard_snapshots (project_id, version, snapshot_at desc);

create index if not exists dashboard_snapshots_tracking_gin_idx
on public.dashboard_snapshots using gin (tracking_payload);

drop trigger if exists dashboard_snapshots_touch_updated_at on public.dashboard_snapshots;
create trigger dashboard_snapshots_touch_updated_at
before update on public.dashboard_snapshots
for each row execute function public.release_platform_touch_updated_at();

alter table public.dashboard_snapshots enable row level security;

drop policy if exists dashboard_snapshots_read on public.dashboard_snapshots;
create policy dashboard_snapshots_read
on public.dashboard_snapshots for select
to anon, authenticated
using (true);

drop policy if exists dashboard_snapshots_insert on public.dashboard_snapshots;
create policy dashboard_snapshots_insert
on public.dashboard_snapshots for insert
to anon, authenticated
with check (true);

drop policy if exists dashboard_snapshots_update on public.dashboard_snapshots;
create policy dashboard_snapshots_update
on public.dashboard_snapshots for update
to anon, authenticated
using (true)
with check (true);
