create or replace function public.release_platform_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.release_quarter_android (
  version text primary key,
  release_from text,
  release_to text,
  month smallint check (month is null or (month >= 0 and month <= 11)),
  stream text,
  substream text,
  primary_task_key text,
  primary_task_summary text,
  primary_task_url text,
  secondary_tasks jsonb not null default '[]'::jsonb,
  build_time text,
  previous_rollout_percent text,
  planned_hotfix_date text,
  branch_cut_time text,
  actual_send_time text,
  one_percent_date text,
  hotfix_reason text,
  hotfix_details text,
  source_count integer not null default 0,
  row_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.release_quarter_ios (
  version text primary key,
  release_from text,
  release_to text,
  month smallint check (month is null or (month >= 0 and month <= 11)),
  stream text,
  substream text,
  primary_task_key text,
  primary_task_summary text,
  primary_task_url text,
  secondary_tasks jsonb not null default '[]'::jsonb,
  build_time text,
  previous_rollout_percent text,
  planned_hotfix_date text,
  branch_cut_time text,
  actual_send_time text,
  one_percent_date text,
  hotfix_reason text,
  hotfix_details text,
  source_count integer not null default 0,
  row_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists release_quarter_android_touch_updated_at on public.release_quarter_android;
create trigger release_quarter_android_touch_updated_at
before update on public.release_quarter_android
for each row execute function public.release_platform_touch_updated_at();

drop trigger if exists release_quarter_ios_touch_updated_at on public.release_quarter_ios;
create trigger release_quarter_ios_touch_updated_at
before update on public.release_quarter_ios
for each row execute function public.release_platform_touch_updated_at();

alter table public.release_quarter_android enable row level security;
alter table public.release_quarter_ios enable row level security;

drop policy if exists release_quarter_android_read on public.release_quarter_android;
create policy release_quarter_android_read
on public.release_quarter_android for select
to anon, authenticated
using (true);

drop policy if exists release_quarter_android_insert on public.release_quarter_android;
create policy release_quarter_android_insert
on public.release_quarter_android for insert
to anon, authenticated
with check (true);

drop policy if exists release_quarter_android_update on public.release_quarter_android;
create policy release_quarter_android_update
on public.release_quarter_android for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists release_quarter_ios_read on public.release_quarter_ios;
create policy release_quarter_ios_read
on public.release_quarter_ios for select
to anon, authenticated
using (true);

drop policy if exists release_quarter_ios_insert on public.release_quarter_ios;
create policy release_quarter_ios_insert
on public.release_quarter_ios for insert
to anon, authenticated
with check (true);

drop policy if exists release_quarter_ios_update on public.release_quarter_ios;
create policy release_quarter_ios_update
on public.release_quarter_ios for update
to anon, authenticated
using (true)
with check (true);
