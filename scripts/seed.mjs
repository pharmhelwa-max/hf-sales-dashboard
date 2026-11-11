// Loads a seed JSON (same shape as src/data/seed.json) into Supabase using the SERVICE-ROLE key.
// The service-role key bypasses RLS: keep it in .env.local only, never in Vercel's public vars or the browser.
//
//   node --env-file=.env.local scripts/seed.mjs [path/to/seed.json]
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const file = process.argv[2] || 'src/data/seed.json';
const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
const sb = createClient(url, key, { auth: { persistSession: false } });

const ym = seed.month.slice(0, 7);
const dayDate = (d) => `${ym}-${String(d).padStart(2, '0')}`;
const chunk = (arr, n = 500) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
async function run(label, q) {
  const { error } = await q;
  if (error) { console.error(`✖ ${label}:`, error.message); process.exit(1); }
  console.log(`✔ ${label}`);
}
async function upsert(table, rows, onConflict) {
  for (const part of chunk(rows)) await run(`${table} (${part.length})`, sb.from(table).upsert(part, { onConflict }));
}

// branches
await upsert('branches', seed.branches.map(({ name, color, sort_order, is_call_center }) => ({ name, color, sort_order, is_call_center })), 'name');
const { data: brs, error: be } = await sb.from('branches').select('id,name');
if (be) { console.error(be.message); process.exit(1); }
const branchId = Object.fromEntries(brs.map((b) => [b.name, b.id]));

await upsert('monthly_targets', seed.targets.map((t) => ({
  branch_id: branchId[t.branch], month: seed.month, days_in_month: seed.days_in_month,
  cash_target: t.cash_target, contract_target: t.contract_target, ivf_deduction: t.ivf_deduction ?? 0,
  contract_invoices: t.contract_invoices ?? null,
})), 'branch_id,month');

await upsert('daily_branch_stats', seed.daily.map((d) => ({
  branch_id: branchId[d.branch], day: dayDate(d.day), cash: d.cash, contract: d.contract,
  avg_invoice: d.avg_invoice, pct_coded: d.pct_coded, avg_items: d.avg_items,
})), 'branch_id,day');

await upsert('company_daily_kpis', seed.company_daily_kpis.map((d) => ({ ...d, day: dayDate(d.day) })), 'day');

await upsert('employees', seed.employees.map((e) => ({ branch_id: branchId[e.branch], name: e.name })), 'branch_id,name');
const { data: emps, error: ee } = await sb.from('employees').select('id,branch_id,name');
if (ee) { console.error(ee.message); process.exit(1); }
const empId = Object.fromEntries(emps.map((e) => [`${e.branch_id}|${e.name}`, e.id]));

await upsert('employee_monthly_stats', seed.employees.map((e) => ({
  employee_id: empId[`${branchId[e.branch]}|${e.name}`], month: seed.month, ...e.monthly,
})), 'employee_id,month');

await upsert('employee_daily_stats', seed.employees.flatMap((e) => e.daily.map((d) => ({
  employee_id: empId[`${branchId[e.branch]}|${e.name}`], day: dayDate(d.day),
  avg_invoice: d.avg_invoice, pct_coded: d.pct_coded, avg_items: d.avg_items,
}))), 'employee_id,day');

console.log('Done.');
