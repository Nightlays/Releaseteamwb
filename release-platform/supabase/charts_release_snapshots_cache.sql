create or replace function public.release_platform_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.charts_release_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id text not null default '7',
  release text not null,
  source text not null default 'charts',
  collected_at timestamptz not null default now(),

  tc_row_payload jsonb not null default '{}'::jsonb,
  coverage_row_payload jsonb not null default '{}'::jsonb,
  selective_row_payload jsonb not null default '{}'::jsonb,
  avg_row_payload jsonb not null default '{}'::jsonb,
  chp_row_payload jsonb not null default '{}'::jsonb,
  timing_payload jsonb not null default '{}'::jsonb,
  task_types_ios_payload jsonb not null default '{}'::jsonb,
  task_types_android_payload jsonb not null default '{}'::jsonb,
  chp_types_payload jsonb not null default '{}'::jsonb,
  chp_types_ios_payload jsonb not null default '{}'::jsonb,
  chp_types_android_payload jsonb not null default '{}'::jsonb,
  chp_quarter_issues_payload jsonb not null default '[]'::jsonb,
  release_markers_payload jsonb not null default '[]'::jsonb,
  tc_stream_counts_payload jsonb not null default '[]'::jsonb,
  hb_stream_counts_payload jsonb not null default '[]'::jsonb,
  selective_stream_counts_payload jsonb not null default '[]'::jsonb,
  uwu_stream_counts_payload jsonb not null default '[]'::jsonb,
  snapshot_payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint charts_release_snapshots_project_release_uidx unique (project_id, release)
);

create index if not exists charts_release_snapshots_project_release_idx
on public.charts_release_snapshots (project_id, release);

create index if not exists charts_release_snapshots_collected_idx
on public.charts_release_snapshots (project_id, collected_at desc);

create index if not exists charts_release_snapshots_payload_gin_idx
on public.charts_release_snapshots using gin (snapshot_payload);

drop trigger if exists charts_release_snapshots_touch_updated_at on public.charts_release_snapshots;
create trigger charts_release_snapshots_touch_updated_at
before update on public.charts_release_snapshots
for each row execute function public.release_platform_touch_updated_at();

alter table public.charts_release_snapshots enable row level security;

drop policy if exists charts_release_snapshots_read on public.charts_release_snapshots;
create policy charts_release_snapshots_read
on public.charts_release_snapshots for select
to anon, authenticated
using (true);

drop policy if exists charts_release_snapshots_insert on public.charts_release_snapshots;
create policy charts_release_snapshots_insert
on public.charts_release_snapshots for insert
to anon, authenticated
with check (true);

drop policy if exists charts_release_snapshots_update on public.charts_release_snapshots;
create policy charts_release_snapshots_update
on public.charts_release_snapshots for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists charts_release_snapshots_delete on public.charts_release_snapshots;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.charts_release_snapshots to anon, authenticated;
