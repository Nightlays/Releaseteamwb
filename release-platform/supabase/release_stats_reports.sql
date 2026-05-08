create or replace function public.release_platform_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.uvu_release_reports (
  id uuid primary key default gen_random_uuid(),
  project_id text not null default '7',
  release text not null,
  source text not null default 'uvu',
  collected_at timestamptz not null default now(),

  include_high_blocker boolean not null default true,
  include_selective boolean not null default false,
  launch_count integer not null default 0,
  leaf_count integer not null default 0,
  swat_case_count integer not null default 0,
  people_count integer not null default 0,
  stream_count integer not null default 0,
  total_uwu numeric(14,4) not null default 0,
  total_uwu_present integer not null default 0,
  total_duration_ms bigint not null default 0,
  report_payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uvu_release_reports_project_release_uidx unique (project_id, release)
);

create table if not exists public.swat_release_reports (
  id uuid primary key default gen_random_uuid(),
  project_id text not null default '7',
  release text not null,
  source text not null default 'swat_release',
  collected_at timestamptz not null default now(),

  swat_count integer not null default 0,
  launches_count integer not null default 0,
  total_cases integer not null default 0,
  total_cases_android integer not null default 0,
  total_cases_ios integer not null default 0,
  total_uwu numeric(14,4) not null default 0,
  total_worked_hours numeric(14,4) not null default 0,
  overall_avg_mmss text,
  report_payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint swat_release_reports_project_release_uidx unique (project_id, release)
);

create index if not exists uvu_release_reports_project_release_idx
on public.uvu_release_reports (project_id, release);

create index if not exists uvu_release_reports_collected_idx
on public.uvu_release_reports (project_id, collected_at desc);

create index if not exists uvu_release_reports_payload_gin_idx
on public.uvu_release_reports using gin (report_payload);

create index if not exists swat_release_reports_project_release_idx
on public.swat_release_reports (project_id, release);

create index if not exists swat_release_reports_collected_idx
on public.swat_release_reports (project_id, collected_at desc);

create index if not exists swat_release_reports_payload_gin_idx
on public.swat_release_reports using gin (report_payload);

drop trigger if exists uvu_release_reports_touch_updated_at on public.uvu_release_reports;
create trigger uvu_release_reports_touch_updated_at
before update on public.uvu_release_reports
for each row execute function public.release_platform_touch_updated_at();

drop trigger if exists swat_release_reports_touch_updated_at on public.swat_release_reports;
create trigger swat_release_reports_touch_updated_at
before update on public.swat_release_reports
for each row execute function public.release_platform_touch_updated_at();

alter table public.uvu_release_reports enable row level security;
alter table public.swat_release_reports enable row level security;

drop policy if exists uvu_release_reports_read on public.uvu_release_reports;
create policy uvu_release_reports_read
on public.uvu_release_reports for select
to anon, authenticated
using (true);

drop policy if exists uvu_release_reports_insert on public.uvu_release_reports;
create policy uvu_release_reports_insert
on public.uvu_release_reports for insert
to anon, authenticated
with check (true);

drop policy if exists uvu_release_reports_update on public.uvu_release_reports;
create policy uvu_release_reports_update
on public.uvu_release_reports for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists uvu_release_reports_delete on public.uvu_release_reports;

drop policy if exists swat_release_reports_read on public.swat_release_reports;
create policy swat_release_reports_read
on public.swat_release_reports for select
to anon, authenticated
using (true);

drop policy if exists swat_release_reports_insert on public.swat_release_reports;
create policy swat_release_reports_insert
on public.swat_release_reports for insert
to anon, authenticated
with check (true);

drop policy if exists swat_release_reports_update on public.swat_release_reports;
create policy swat_release_reports_update
on public.swat_release_reports for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists swat_release_reports_delete on public.swat_release_reports;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.uvu_release_reports to anon, authenticated;
grant select, insert, update on public.swat_release_reports to anon, authenticated;
