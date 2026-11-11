import { createClient } from '@supabase/supabase-js';
import seed from './data/seed.json';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isLive = Boolean(url && anon);
export const sb = isLive ? createClient(url, anon) : null;

const pad = (n) => String(n).padStart(2, '0');
const dayNum = (iso) => Number(iso.slice(8, 10));
const n = (v) => (v === null || v === undefined ? null : Number(v));

function monthRange(month) {
  const [y, m] = month.slice(0, 7).split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

// PostgREST caps responses at 1000 rows; page through.
async function fetchAll(build) {
  const size = 1000;
  let out = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < size) return out;
  }
}

/** Months that have data, newest first. */
export async function listMonths() {
  if (!isLive) return [seed.month];
  const { data, error } = await sb.from('monthly_targets').select('month').order('month', { ascending: false });
  if (error) throw error;
  return [...new Set(data.map((r) => r.month))];
}

/** Returns the normalized model for one month. Same shape in live and demo mode. */
export async function loadMonth(month) {
  return isLive ? loadLive(month) : loadDemo();
}

function loadDemo() {
  const branches = seed.branches.map((b) => {
    const t = seed.targets.find((x) => x.branch === b.name);
    return {
      id: b.name, name: b.name, color: b.color, isCallCenter: b.is_call_center,
      target: { cash: t.cash_target, contract: t.contract_target, ivf: t.ivf_deduction || 0, contractInvoices: t.contract_invoices ?? null },
      daily: seed.daily.filter((d) => d.branch === b.name).map((d) => ({
        day: d.day, cash: d.cash, contract: d.contract, avgInvoice: d.avg_invoice, pctCoded: d.pct_coded, avgItems: d.avg_items,
      })),
      employees: seed.employees.filter((e) => e.branch === b.name).map((e) => ({
        name: e.name,
        monthly: { cashNet: e.monthly.cash_net, invoices: e.monthly.invoices, contract: e.monthly.contract, avgInvoice: e.monthly.avg_invoice, avgItems: e.monthly.avg_items, pctCoded: e.monthly.pct_coded, cosmo: e.monthly.cosmo },
        daily: e.daily.map((d) => ({ day: d.day, avgInvoice: d.avg_invoice, pctCoded: d.pct_coded, avgItems: d.avg_items })),
      })),
    };
  });
  return {
    month: seed.month, daysInMonth: seed.days_in_month, branches,
    companyKpis: seed.company_daily_kpis.map((d) => ({ day: d.day, avgInvoice: d.avg_invoice, pctCoded: d.pct_coded, avgItems: d.avg_items })),
  };
}

async function loadLive(month) {
  const { from, to } = monthRange(month);
  const [branchesR, targetsR, daily, kpis, emps, monthly, empDaily] = await Promise.all([
    sb.from('branches').select('*').order('sort_order'),
    sb.from('monthly_targets').select('*').eq('month', month),
    fetchAll(() => sb.from('daily_branch_stats').select('*').gte('day', from).lte('day', to).order('day')),
    fetchAll(() => sb.from('company_daily_kpis').select('*').gte('day', from).lte('day', to).order('day')),
    fetchAll(() => sb.from('employees').select('*').order('name')),
    fetchAll(() => sb.from('employee_monthly_stats').select('*').eq('month', month)),
    fetchAll(() => sb.from('employee_daily_stats').select('*').gte('day', from).lte('day', to).order('day')),
  ]);
  for (const r of [branchesR, targetsR]) if (r.error) throw r.error;

  const targets = Object.fromEntries(targetsR.data.map((t) => [t.branch_id, t]));
  const monthlyBy = Object.fromEntries(monthly.map((m) => [m.employee_id, m]));
  const dailyByEmp = {};
  for (const d of empDaily) (dailyByEmp[d.employee_id] ||= []).push(d);

  const branches = branchesR.data
    .filter((b) => targets[b.id]) // only branches that exist in this month
    .map((b) => {
      const t = targets[b.id];
      return {
        id: b.id, name: b.name, color: b.color, isCallCenter: b.is_call_center,
        target: { cash: n(t.cash_target), contract: n(t.contract_target), ivf: n(t.ivf_deduction) || 0, contractInvoices: n(t.contract_invoices) },
        daily: daily.filter((d) => d.branch_id === b.id).map((d) => ({
          day: dayNum(d.day), cash: n(d.cash), contract: n(d.contract), avgInvoice: n(d.avg_invoice), pctCoded: n(d.pct_coded), avgItems: n(d.avg_items),
        })),
        employees: emps.filter((e) => e.branch_id === b.id && monthlyBy[e.id]).map((e) => {
          const m = monthlyBy[e.id];
          return {
            name: e.name,
            monthly: { cashNet: n(m.cash_net), invoices: n(m.invoices), contract: n(m.contract), avgInvoice: n(m.avg_invoice), avgItems: n(m.avg_items), pctCoded: n(m.pct_coded), cosmo: n(m.cosmo) },
            daily: (dailyByEmp[e.id] || []).map((d) => ({ day: dayNum(d.day), avgInvoice: n(d.avg_invoice), pctCoded: n(d.pct_coded), avgItems: n(d.avg_items) })),
          };
        }),
      };
    });

  const anyTarget = targetsR.data[0];
  return {
    month, daysInMonth: anyTarget ? anyTarget.days_in_month : 30, branches,
    companyKpis: kpis.map((d) => ({ day: dayNum(d.day), avgInvoice: n(d.avg_invoice), pctCoded: n(d.pct_coded), avgItems: n(d.avg_items) })),
  };
}

// ---- auth (live mode only) --------------------------------------------------
export async function getSession() {
  if (!isLive) return { demo: true };
  const { data } = await sb.auth.getSession();
  return data.session;
}
export const signIn = (email, password) => sb.auth.signInWithPassword({ email, password });
export const signOut = () => sb.auth.signOut();
