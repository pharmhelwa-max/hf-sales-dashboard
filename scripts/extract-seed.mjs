// One-off: extracts the data embedded in the original static dashboard HTML into seed.json.
// Usage: node scripts/extract-seed.mjs "<path-to-html>" [outfile]
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
const out = process.argv[3] || 'src/data/seed.json';
if (!src) { console.error('usage: node scripts/extract-seed.mjs <html> [out]'); process.exit(1); }

const html = fs.readFileSync(src, 'utf8');
const num = (s) => Number(String(s).replace(/[,%\s]/g, '')) || 0;

// --- month / days -----------------------------------------------------------
const title = html.match(/<title>(.*?)<\/title>/s)[1];
const monthNames = { 'يناير':1,'فبراير':2,'مارس':3,'أبريل':4,'ابريل':4,'مايو':5,'يونيو':6,'يوليو':7,'أغسطس':8,'اغسطس':8,'سبتمبر':9,'أكتوبر':10,'اكتوبر':10,'نوفمبر':11,'ديسمبر':12 };
const ym = title.match(/(\S+)\s+(\d{4})/);
const monthNum = monthNames[ym[1]];
const year = Number(ym[2]);
const month = `${year}-${String(monthNum).padStart(2, '0')}-01`;
const daysInMonth = Number(html.match(/(\d+)\s*\/\s*(\d+)/)[2]);

// --- branch list + colours from tab buttons ---------------------------------
const branches = [...html.matchAll(/data-branch="([^"]+)" style="border-right:3px solid (#[0-9A-Fa-f]{6})"/g)]
  .map((m, i) => ({ name: m[1], color: m[2], sort_order: i + 1, is_call_center: m[1].includes('كول') }));

// --- chart series -----------------------------------------------------------
const scriptStart = html.indexOf('<script>');
const script = html.slice(scriptStart);
const chartBlocks = {};
{
  const re = /new Chart\(document\.getElementById\('([^']+)'\)/g;
  const marks = [...script.matchAll(re)];
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : script.length;
    chartBlocks[m[1]] = script.slice(m.index, end);
  });
}
function series(id) {
  const block = chartBlocks[id];
  if (!block) return null;
  const res = {};
  for (const m of block.matchAll(/label:'([^']+)',\s*data:\[([^\]]*)\]/g)) {
    res[m[1]] = m[2].split(',').map((x) => Number(x.trim()));
  }
  return res;
}
function kpis(prefix) {
  const a = series(`${prefix}-avginv`), c = series(`${prefix}-coded`), i = series(`${prefix}-items`);
  return {
    avg_invoice: a['متوسط الفاتورة'],
    pct_coded: c['% التكويد'],
    avg_items: i['متوسط الأصناف'],
  };
}

// --- panels (per branch) ----------------------------------------------------
const panelRe = /<div class="branch-panel[^"]*" id="panel-([^"]+)">/g;
const panelMarks = [...html.matchAll(panelRe)];
const panels = {};
panelMarks.forEach((m, i) => {
  const end = i + 1 < panelMarks.length ? panelMarks[i + 1].index : html.indexOf('<footer');
  panels[m[1]] = html.slice(m.index, end > m.index ? end : html.indexOf('<script>'));
});

// One `const EDATA = {...}` per branch, immediately followed by that branch's emp-<branch>-select lookup.
const employeeDaily = {};
for (const m of script.matchAll(/const EDATA = (\{.*?\});\s*\n\s*const names = Object\.keys\(EDATA\);\s*\n\s*const sel = document\.getElementById\('emp-([^']+)-select'\)/gs)) {
  employeeDaily[m[2]] = JSON.parse(m[1]);
}

const daily = [];               // branch daily rows
const targets = [];             // monthly targets
const employees = [];           // employee master + monthly + daily
let dayCount = 0;

for (const b of branches) {
  const s = series(`chart-${b.name}`);
  const k = kpis(`kpi-${b.name}`);
  const n = s['كاش'].length;
  dayCount = Math.max(dayCount, n);
  for (let d = 0; d < n; d++) {
    daily.push({
      branch: b.name, day: d + 1,
      cash: s['كاش'][d], contract: s['تعاقد'][d],
      avg_invoice: k.avg_invoice[d], pct_coded: k.pct_coded[d], avg_items: k.avg_items[d],
    });
  }

  const panel = panels[b.name];
  const t = [...panel.slice(0, panel.indexOf('<canvas')).matchAll(/تارجت شهري:\s*([\d,]+)/g)].map((x) => num(x[1]));
  // The cash card is "after IVF": daily chart series is gross, card value = gross - IVF deduction.
  const cardCash = num(panel.match(/<div class="value">([\d,]+)<\/div>/)[1]);
  const grossCash = s['كاش'].reduce((a, v) => a + v, 0);
  const rawIvf = grossCash - cardCash;
  const ivf = rawIvf < 1 ? 0 : Math.round(rawIvf * 100) / 100; // <1 EGP is card rounding, not IVF
  // Cards order: cash, contract, total. Call-centre contract has no target ("مالوش تارجت").
  targets.push({ branch: b.name, cash_target: t[0] ?? null, contract_target: b.is_call_center ? null : (t[1] ?? null), ivf_deduction: ivf,
    // only the call-centre card states its contract invoice count ("487 فاتورة")
    contract_invoices: b.is_call_center ? num((panel.match(/>\s*([\d,]+)\s*فاتورة/) || [])[1]) || null : null });

  // employee daily data (lives in the <script>, not the panel HTML)
  const edata = employeeDaily[b.name] || {};

  // employee monthly rows
  const tbody = panel.match(/<tbody>(.*?)<\/tbody>/s)[1];
  for (const row of tbody.matchAll(/<tr>(.*?)<\/tr>/gs)) {
    const tds = [...row[1].matchAll(/<td>(.*?)<\/td>/gs)].map((x) => x[1].trim());
    const name = tds[0];
    employees.push({
      branch: b.name, name,
      monthly: {
        cash_net: num(tds[1]), invoices: num(tds[2]), contract: num(tds[3]),
        avg_invoice: num(tds[4]), avg_items: num(tds[5]), pct_coded: num(tds[6]), cosmo: num(tds[7]),
      },
      // the source pads every employee to 31 days with zeros; keep only days that have branch data
      daily: (edata[name] || []).filter((x) => x.day <= n).map((x) => ({ day: x.day, avg_invoice: x.avg_invoice, pct_coded: x.pct_coded, avg_items: x.avg_items })),
    });
  }
}

// --- company-level KPI series (weighted; cannot be derived from branch rows) -
const ck = kpis('kpi-company');
const company_daily_kpis = ck.avg_invoice.map((_, i) => ({
  day: i + 1, avg_invoice: ck.avg_invoice[i], pct_coded: ck.pct_coded[i], avg_items: ck.avg_items[i],
}));

const seed = { month, days_in_month: daysInMonth, branches, targets, daily, company_daily_kpis, employees };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(seed, null, 1), 'utf8');
console.log(`month=${month} days=${dayCount}/${daysInMonth} branches=${branches.length} daily=${daily.length} employees=${employees.length}`);
for (const b of branches) {
  const rows = daily.filter((d) => d.branch === b.name);
  const cash = rows.reduce((a, r) => a + r.cash, 0), con = rows.reduce((a, r) => a + r.contract, 0);
  console.log(b.name.padEnd(10), 'cash', Math.round(cash), 'contract', Math.round(con), 'targets', JSON.stringify(targets.find((t) => t.branch === b.name)));
}
