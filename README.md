# H&F Sales Dashboard

Web app version of `داشبورد_شامل_كل_الفروع.html`: Vite + vanilla JS + Chart.js, data in **Supabase**, hosted on **Vercel**.

Without Supabase env vars it runs in **demo mode** on the bundled `src/data/seed.json` (the data from the original HTML), so you can try it immediately:

```bash
npm install
npm run dev
```

## 1. Supabase (cloud)

1. Create a project at https://supabase.com/dashboard.
2. SQL Editor → paste `supabase/migrations/0001_init.sql` → Run. (Creates 7 tables, read-only RLS for signed-in users.)
3. Authentication → Users → **Add user** (email + password) for each person who may view the dashboard.
   Authentication → Providers → Email → turn **off** "Allow new users to sign up", so only users you add can log in.
4. Project Settings → API: copy the **Project URL**, the **anon/publishable key**, and the **service_role key**.
5. `copy .env.example .env.local` and fill in all three values.
6. Load the data: `npm run seed` (uses the service-role key; safe to re-run, it upserts).

Run `npm run dev` again: it now shows a login screen and reads from Supabase (badge: "Supabase").

## 2. Vercel (hosting)

1. Push this folder to a GitHub repo (`.env.local` is git-ignored).
2. https://vercel.com/new → import the repo. Framework preset: **Vite** (also set in `vercel.json`).
3. Environment Variables: add **only** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
   **Never add `SUPABASE_SERVICE_ROLE_KEY` to Vercel** – it bypasses RLS and would be a data-leak risk if exposed.
4. Deploy. Every `git push` redeploys.
5. Supabase → Authentication → URL Configuration: set Site URL to your Vercel URL.

CLI alternative: `npm i -g vercel`, then `vercel` and `vercel --prod`.

## Loading a new month

The schema is month-aware (month picker in the header). Produce a JSON in the same shape as `src/data/seed.json`
(`month`, `days_in_month`, `branches`, `targets`, `daily`, `company_daily_kpis`, `employees`) and run:

```bash
npm run seed -- path/to/new-month.json
```

Re-running for the same month updates it in place (daily refresh). Or regenerate from a new dashboard HTML:
`node scripts/extract-seed.mjs "<file.html>" src/data/november.json`.

## Data model

| Table | Purpose |
|---|---|
| `branches` | 3 branches + call center, colour, order |
| `monthly_targets` | cash/contract targets, IVF deduction, days in month |
| `daily_branch_stats` | gross cash, contract, avg invoice, % coded, avg items per day |
| `company_daily_kpis` | weighted company KPIs (can't be derived from branch rows) |
| `employees`, `employee_monthly_stats`, `employee_daily_stats` | per-employee table + daily KPIs |

Company totals = the 3 branches (call center excluded), exactly as in the original dashboard.
Displayed cash = gross daily cash − IVF deduction. Achievement % = value ÷ (target × days elapsed ÷ days in month);
colour: ≥100% green, ≥75% amber, otherwise red (thresholds inferred from the original; edit `pillClass` in `src/main.js`).
