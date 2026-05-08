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

create table if not exists public.charts_reports (
  id uuid primary key default gen_random_uuid(),
  project_id text not null default '7',
  release_from text not null,
  release_to text not null,
  compare_mode text not null default 'mean',
  source text not null default 'charts',
  collected_at timestamptz not null default now(),

  releases text[] not null default '{}'::text[],
  release_count integer not null default 0,
  current_release text,
  previous_release text,
  base_releases text[] not null default '{}'::text[],

  tc_total integer not null default 0,
  tc_manual integer not null default 0,
  tc_auto integer not null default 0,
  coverage_total integer not null default 0,
  coverage_swat_count integer not null default 0,
  coverage_stream_count integer not null default 0,
  selective_total integer not null default 0,
  selective_swat_count integer not null default 0,
  selective_stream_count integer not null default 0,
  avg_total_ms numeric(14,4),
  avg_weighted_ms numeric(14,4),
  chp_ios integer not null default 0,
  chp_android integer not null default 0,
  chp_total integer not null default 0,
  dev_downtime_ios_minutes numeric(14,4) not null default 0,
  dev_downtime_android_minutes numeric(14,4) not null default 0,
  dev_downtime_total_minutes numeric(14,4) not null default 0,

  ml_engine text,
  ml_risk_pct numeric(6,2),
  ml_linear_probability numeric(8,6),
  ml_catboost_probability numeric(8,6),
  ml_labeled_samples integer not null default 0,
  ml_dataset_quality text,
  ml_helper_online boolean,
  ml_helper_busy boolean,

  anomaly_score numeric(10,4) not null default 0,
  anomaly_release_count integer not null default 0,
  anomaly_type_count integer not null default 0,
  anomaly_platform_count integer not null default 0,

  metrics_payload jsonb not null default '[]'::jsonb,
  tc_rows_payload jsonb not null default '[]'::jsonb,
  coverage_rows_payload jsonb not null default '[]'::jsonb,
  selective_rows_payload jsonb not null default '[]'::jsonb,
  avg_rows_payload jsonb not null default '[]'::jsonb,
  chp_rows_payload jsonb not null default '[]'::jsonb,
  dev_downtime_payload jsonb not null default '{}'::jsonb,
  timings_payload jsonb not null default '[]'::jsonb,
  task_types_payload jsonb not null default '{}'::jsonb,
  chp_types_payload jsonb not null default '{}'::jsonb,
  chp_quarter_stats_payload jsonb,
  stream_insights_payload jsonb not null default '{}'::jsonb,
  stream_delta_rows_payload jsonb not null default '[]'::jsonb,
  anomalies_payload jsonb not null default '{}'::jsonb,
  ml_payload jsonb not null default '{}'::jsonb,
  ai_context_payload jsonb not null default '{}'::jsonb,
  report_payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint charts_reports_compare_mode_check check (compare_mode in ('mean', 'prev')),
  constraint charts_reports_ml_engine_check check (ml_engine is null or ml_engine in ('catboost', 'linear', 'none')),
  constraint charts_reports_ml_quality_check check (ml_dataset_quality is null or ml_dataset_quality in ('low', 'medium', 'high')),
  constraint charts_reports_ml_risk_pct_check check (ml_risk_pct is null or (ml_risk_pct >= 0 and ml_risk_pct <= 100)),
  constraint charts_reports_linear_prob_check check (ml_linear_probability is null or (ml_linear_probability >= 0 and ml_linear_probability <= 1)),
  constraint charts_reports_catboost_prob_check check (ml_catboost_probability is null or (ml_catboost_probability >= 0 and ml_catboost_probability <= 1))
);

create table if not exists public.charts_release_metrics (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.charts_reports(id) on delete cascade,
  project_id text not null default '7',
  release text not null,
  release_index integer not null default 0,

  tc_total integer not null default 0,
  tc_manual integer not null default 0,
  tc_auto integer not null default 0,
  tc_total_delta integer not null default 0,
  tc_total_delta_pct numeric(10,4) not null default 0,
  tc_volatility numeric(10,4) not null default 0,
  tc_slope_pct numeric(10,4) not null default 0,

  cov_swat integer not null default 0,
  cov_stream integer not null default 0,
  cov_swat_delta_pct numeric(10,4) not null default 0,
  cov_stream_delta_pct numeric(10,4) not null default 0,
  sel_swat integer not null default 0,
  sel_stream integer not null default 0,
  sel_swat_delta_pct numeric(10,4) not null default 0,
  sel_stream_delta_pct numeric(10,4) not null default 0,

  avg_total_delta numeric(14,4) not null default 0,
  avg_total numeric(14,4) not null default 0,
  avg_weighted numeric(14,4) not null default 0,

  chp_total integer not null default 0,
  chp_prod integer not null default 0,
  chp_bug integer not null default 0,
  chp_crash integer not null default 0,
  chp_vlet integer not null default 0,
  chp_total_delta integer not null default 0,
  chp_ios integer not null default 0,
  chp_android integer not null default 0,
  chp_ios_delta_pct numeric(10,4) not null default 0,
  chp_android_delta_pct numeric(10,4) not null default 0,

  anom_score numeric(10,4) not null default 0,
  release_anoms integer not null default 0,
  type_anoms integer not null default 0,
  platform_anoms integer not null default 0,
  ml_risk_pct numeric(6,2),

  row_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint charts_release_metrics_risk_check check (ml_risk_pct is null or (ml_risk_pct >= 0 and ml_risk_pct <= 100)),
  constraint charts_release_metrics_report_release_uidx unique (report_id, release)
);

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

create table if not exists public.charts_ml_dataset (
  id text primary key,
  project_id text not null default '7',
  release text,
  export_at timestamptz not null default now(),
  label text,
  labeled_at timestamptz,

  predicted_risk_pct numeric(6,2),
  linear_probability numeric(8,6),
  catboost_probability numeric(8,6),

  tc_total numeric(14,4) not null default 0,
  tc_total_delta numeric(14,4) not null default 0,
  tc_total_delta_pct numeric(14,4) not null default 0,
  tc_volatility numeric(14,4) not null default 0,
  tc_slope_pct numeric(14,4) not null default 0,
  cov_swat_delta_pct numeric(14,4) not null default 0,
  cov_stream_delta_pct numeric(14,4) not null default 0,
  sel_swat_delta_pct numeric(14,4) not null default 0,
  sel_stream_delta_pct numeric(14,4) not null default 0,
  avg_total_delta numeric(14,4) not null default 0,
  chp_total_delta_pct numeric(14,4) not null default 0,
  chp_ios_delta_pct numeric(14,4) not null default 0,
  chp_android_delta_pct numeric(14,4) not null default 0,
  release_anoms numeric(14,4) not null default 0,
  type_anoms numeric(14,4) not null default 0,
  platform_anoms numeric(14,4) not null default 0,
  anom_score numeric(14,4) not null default 0,

  features jsonb not null default '{}'::jsonb,
  row_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint charts_ml_dataset_label_check check (label is null or label in ('ok', 'fail')),
  constraint charts_ml_dataset_risk_check check (predicted_risk_pct is null or (predicted_risk_pct >= 0 and predicted_risk_pct <= 100)),
  constraint charts_ml_dataset_linear_prob_check check (linear_probability is null or (linear_probability >= 0 and linear_probability <= 1)),
  constraint charts_ml_dataset_catboost_prob_check check (catboost_probability is null or (catboost_probability >= 0 and catboost_probability <= 1))
);

create index if not exists charts_reports_project_collected_idx
on public.charts_reports (project_id, collected_at desc);

create index if not exists charts_reports_range_collected_idx
on public.charts_reports (project_id, release_from, release_to, compare_mode, collected_at desc);

create index if not exists charts_reports_current_release_idx
on public.charts_reports (project_id, current_release, collected_at desc);

create index if not exists charts_reports_releases_gin_idx
on public.charts_reports using gin (releases);

create index if not exists charts_reports_report_payload_gin_idx
on public.charts_reports using gin (report_payload);

create index if not exists charts_reports_ai_context_gin_idx
on public.charts_reports using gin (ai_context_payload);

create index if not exists charts_release_metrics_report_idx
on public.charts_release_metrics (report_id, release_index);

create index if not exists charts_release_metrics_release_idx
on public.charts_release_metrics (project_id, release);

create index if not exists charts_release_metrics_payload_gin_idx
on public.charts_release_metrics using gin (row_payload);

create index if not exists charts_release_snapshots_project_release_idx
on public.charts_release_snapshots (project_id, release);

create index if not exists charts_release_snapshots_collected_idx
on public.charts_release_snapshots (project_id, collected_at desc);

create index if not exists charts_release_snapshots_payload_gin_idx
on public.charts_release_snapshots using gin (snapshot_payload);

create index if not exists charts_ml_dataset_project_export_idx
on public.charts_ml_dataset (project_id, export_at desc);

create index if not exists charts_ml_dataset_release_idx
on public.charts_ml_dataset (project_id, release);

create index if not exists charts_ml_dataset_label_idx
on public.charts_ml_dataset (project_id, label, labeled_at desc);

create index if not exists charts_ml_dataset_features_gin_idx
on public.charts_ml_dataset using gin (features);

drop trigger if exists charts_reports_touch_updated_at on public.charts_reports;
create trigger charts_reports_touch_updated_at
before update on public.charts_reports
for each row execute function public.release_platform_touch_updated_at();

drop trigger if exists charts_release_metrics_touch_updated_at on public.charts_release_metrics;
create trigger charts_release_metrics_touch_updated_at
before update on public.charts_release_metrics
for each row execute function public.release_platform_touch_updated_at();

drop trigger if exists charts_release_snapshots_touch_updated_at on public.charts_release_snapshots;
create trigger charts_release_snapshots_touch_updated_at
before update on public.charts_release_snapshots
for each row execute function public.release_platform_touch_updated_at();

drop trigger if exists charts_ml_dataset_touch_updated_at on public.charts_ml_dataset;
create trigger charts_ml_dataset_touch_updated_at
before update on public.charts_ml_dataset
for each row execute function public.release_platform_touch_updated_at();

alter table public.charts_reports enable row level security;
alter table public.charts_release_metrics enable row level security;
alter table public.charts_release_snapshots enable row level security;
alter table public.charts_ml_dataset enable row level security;

drop policy if exists charts_reports_read on public.charts_reports;
create policy charts_reports_read
on public.charts_reports for select
to anon, authenticated
using (true);

drop policy if exists charts_reports_insert on public.charts_reports;
create policy charts_reports_insert
on public.charts_reports for insert
to anon, authenticated
with check (true);

drop policy if exists charts_reports_update on public.charts_reports;
create policy charts_reports_update
on public.charts_reports for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists charts_reports_delete on public.charts_reports;

drop policy if exists charts_release_metrics_read on public.charts_release_metrics;
create policy charts_release_metrics_read
on public.charts_release_metrics for select
to anon, authenticated
using (true);

drop policy if exists charts_release_metrics_insert on public.charts_release_metrics;
create policy charts_release_metrics_insert
on public.charts_release_metrics for insert
to anon, authenticated
with check (true);

drop policy if exists charts_release_metrics_update on public.charts_release_metrics;
create policy charts_release_metrics_update
on public.charts_release_metrics for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists charts_release_metrics_delete on public.charts_release_metrics;

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

drop policy if exists charts_ml_dataset_read on public.charts_ml_dataset;
create policy charts_ml_dataset_read
on public.charts_ml_dataset for select
to anon, authenticated
using (true);

drop policy if exists charts_ml_dataset_insert on public.charts_ml_dataset;
create policy charts_ml_dataset_insert
on public.charts_ml_dataset for insert
to anon, authenticated
with check (true);

drop policy if exists charts_ml_dataset_update on public.charts_ml_dataset;
create policy charts_ml_dataset_update
on public.charts_ml_dataset for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists charts_ml_dataset_delete on public.charts_ml_dataset;

create or replace view public.charts_latest_reports
with (security_invoker = true)
as
select *
from (
  select
    report.*,
    row_number() over (
      partition by report.project_id, report.release_from, report.release_to, report.compare_mode
      order by report.collected_at desc, report.created_at desc
    ) as latest_rank
  from public.charts_reports report
) ranked
where ranked.latest_rank = 1;

create or replace view public.charts_latest_release_metrics
with (security_invoker = true)
as
select
  report.project_id,
  report.release_from,
  report.release_to,
  report.compare_mode,
  report.collected_at,
  metric.id as metric_id,
  metric.report_id,
  metric.release,
  metric.release_index,
  metric.tc_total,
  metric.tc_manual,
  metric.tc_auto,
  metric.tc_total_delta,
  metric.tc_total_delta_pct,
  metric.tc_volatility,
  metric.tc_slope_pct,
  metric.cov_swat,
  metric.cov_stream,
  metric.cov_swat_delta_pct,
  metric.cov_stream_delta_pct,
  metric.sel_swat,
  metric.sel_stream,
  metric.sel_swat_delta_pct,
  metric.sel_stream_delta_pct,
  metric.avg_total_delta,
  metric.avg_total,
  metric.avg_weighted,
  metric.chp_total,
  metric.chp_prod,
  metric.chp_bug,
  metric.chp_crash,
  metric.chp_vlet,
  metric.chp_total_delta,
  metric.chp_ios,
  metric.chp_android,
  metric.chp_ios_delta_pct,
  metric.chp_android_delta_pct,
  metric.anom_score,
  metric.release_anoms,
  metric.type_anoms,
  metric.platform_anoms,
  metric.ml_risk_pct,
  metric.row_payload,
  metric.created_at,
  metric.updated_at
from public.charts_latest_reports report
join public.charts_release_metrics metric on metric.report_id = report.id;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.charts_reports to anon, authenticated;
grant select, insert, update on public.charts_release_metrics to anon, authenticated;
grant select, insert, update on public.charts_release_snapshots to anon, authenticated;
grant select, insert, update on public.charts_ml_dataset to anon, authenticated;
grant select on public.charts_latest_reports to anon, authenticated;
grant select on public.charts_latest_release_metrics to anon, authenticated;
