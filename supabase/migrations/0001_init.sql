-- H&F Sales Dashboard schema
-- Run in Supabase: SQL Editor -> paste -> Run (or `supabase db push`).

create table if not exists public.branches (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  color          text not null default '#4f8ff7',
  sort_order     int  not null default 0,
  is_call_center boolean not null default false
);

-- One row per branch per month: targets + IVF deduction (cash card = gross cash - ivf).
create table if not exists public.monthly_targets (
  branch_id       uuid not null references public.branches(id) on delete cascade,
  month           date not null check (month = date_trunc('month', month)::date),
  days_in_month   int  not null default 30,
  cash_target     numeric(14,2),
  contract_target numeric(14,2),            -- null = no target (call center)
  ivf_deduction   numeric(14,2) not null default 0,
  contract_invoices int,                    -- shown on the call-center card only
  primary key (branch_id, month)
);

-- Daily branch figures (cash is gross, before IVF deduction).
create table if not exists public.daily_branch_stats (
  branch_id   uuid not null references public.branches(id) on delete cascade,
  day         date not null,
  cash        numeric(14,2) not null default 0,
  contract    numeric(14,2) not null default 0,
  avg_invoice numeric(10,2) not null default 0,
  pct_coded   numeric(5,2)  not null default 0,
  avg_items   numeric(8,4)  not null default 0,
  primary key (branch_id, day)
);

-- Company-level weighted KPIs (cannot be derived from branch rows without invoice counts).
create table if not exists public.company_daily_kpis (
  day         date primary key,
  avg_invoice numeric(10,2) not null default 0,
  pct_coded   numeric(5,2)  not null default 0,
  avg_items   numeric(8,4)  not null default 0
);

create table if not exists public.employees (
  id        uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name      text not null,
  unique (branch_id, name)
);

create table if not exists public.employee_monthly_stats (
  employee_id uuid not null references public.employees(id) on delete cascade,
  month       date not null check (month = date_trunc('month', month)::date),
  cash_net    numeric(14,2) not null default 0,
  invoices    int           not null default 0,
  contract    numeric(14,2) not null default 0,
  avg_invoice numeric(10,2) not null default 0,
  avg_items   numeric(8,4)  not null default 0,
  pct_coded   numeric(5,2)  not null default 0,
  cosmo       numeric(14,2) not null default 0,
  primary key (employee_id, month)
);

create table if not exists public.employee_daily_stats (
  employee_id uuid not null references public.employees(id) on delete cascade,
  day         date not null,
  avg_invoice numeric(10,2) not null default 0,
  pct_coded   numeric(5,2)  not null default 0,
  avg_items   numeric(8,4)  not null default 0,
  primary key (employee_id, day)
);

create index if not exists daily_branch_stats_day_idx on public.daily_branch_stats (day);
create index if not exists employee_daily_stats_day_idx on public.employee_daily_stats (day);

-- Row level security: signed-in users can read everything; nobody can write
-- through the public API. Data is loaded with the service-role key (scripts/seed.mjs),
-- which bypasses RLS and must never be shipped to the browser.
do $$
declare t text;
begin
  foreach t in array array[
    'branches','monthly_targets','daily_branch_stats','company_daily_kpis',
    'employees','employee_monthly_stats','employee_daily_stats'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "authenticated read" on public.%I', t);
    execute format('create policy "authenticated read" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;
