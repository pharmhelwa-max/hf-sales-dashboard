import './style.css';
import { Chart, registerables } from 'chart.js';
import { isLive, listMonths, loadMonth, getSession, signIn, signOut, sb } from './data.js';

Chart.register(...registerables);
Chart.defaults.color = '#93a0bd';
Chart.defaults.borderColor = '#232c42';
Chart.defaults.font.family = "'Segoe UI', Tahoma, Arial, sans-serif";

const app = document.getElementById('app');
const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

// ---- helpers ----------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v) => Math.round(Number(v) || 0).toLocaleString('en-US');
const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
const monthLabel = (m) => `${MONTHS_AR[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
// Achievement vs. pro-rata target for the days elapsed so far.
const achieve = (value, target, elapsed, dim) => (target ? (value / ((target * elapsed) / dim)) * 100 : null);
const pillClass = (p) => (p >= 100 ? 'good' : p >= 75 ? 'warn' : 'bad');
const pill = (p) => (p == null ? '' : `<span class="pill ${pillClass(p)}">% تحقيق حتى اليوم: ${p.toFixed(1)}%</span>`);

// Charts live in three buckets so a tab/employee switch only rebuilds what changed.
const buckets = { main: [], panel: [], emp: [] };
let bucket = 'main';
const killBucket = (name) => { buckets[name].forEach((c) => c.destroy()); buckets[name] = []; };
const killCharts = () => Object.keys(buckets).forEach(killBucket);
function chart(id, config) {
  const el = document.getElementById(id);
  if (!el) return null;
  const c = new Chart(el, config);
  buckets[bucket].push(c);
  return c;
}
const axes = (suffix = '') => ({ x: { grid: { color: '#232c42' } }, y: { grid: { color: '#232c42' }, ticks: { callback: (v) => v + suffix } } });
function sales(id, days, cash, contract) {
  chart(id, {
    type: 'line',
    data: {
      labels: days,
      datasets: [
        { label: 'كاش', data: cash, borderColor: '#4f8ff7', backgroundColor: 'rgba(79,143,247,.1)', tension: .3, fill: true },
        { label: 'تعاقد', data: contract, borderColor: '#f5a623', backgroundColor: 'rgba(245,166,35,.08)', tension: .3, fill: true },
        { label: 'إجمالي', data: cash.map((c, i) => c + contract[i]), borderColor: '#2fbf71', backgroundColor: 'rgba(47,191,113,.06)', tension: .3, fill: true, borderDash: [5, 3] },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#e8ecf5' } } }, scales: { ...axes(), x: { grid: { color: '#232c42' }, title: { display: true, text: 'اليوم' } } } },
  });
}
function kpiTriplet(prefix, color, days, series) {
  const defs = [
    ['avginv', series.avgInvoice, 'متوسط الفاتورة', ''],
    ['coded', series.pctCoded, '% التكويد', '%'],
    ['items', series.avgItems, 'متوسط الأصناف', ''],
  ];
  for (const [key, data, label, suffix] of defs) {
    chart(`${prefix}-${key}`, {
      type: 'line',
      data: { labels: days, datasets: [{ label, data, borderColor: color, backgroundColor: color + '22', tension: .3, fill: true }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.parsed.y + suffix } } }, scales: axes(suffix) },
    });
  }
}
const kpiGrid = (prefix) => `
  <div class="kpi-grid">
    <div><h4>متوسط الفاتورة (جنيه)</h4><div class="chart-wrap"><canvas id="${prefix}-avginv"></canvas></div></div>
    <div><h4>% التكويد (كاش)</h4><div class="chart-wrap"><canvas id="${prefix}-coded"></canvas></div></div>
    <div><h4>متوسط عدد الأصناف / فاتورة</h4><div class="chart-wrap"><canvas id="${prefix}-items"></canvas></div></div>
  </div>`;

// ---- summaries --------------------------------------------------------------
function summarize(branches, elapsed, dim) {
  const gross = sum(branches, (b) => sum(b.daily, (d) => d.cash));
  const ivf = sum(branches, (b) => b.target.ivf);
  const cash = gross - ivf;
  const contract = sum(branches, (b) => sum(b.daily, (d) => d.contract));
  const cashT = sum(branches, (b) => b.target.cash);
  const hasContractT = branches.every((b) => b.target.contract != null);
  const contractT = hasContractT ? sum(branches, (b) => b.target.contract) : null;
  const totalT = hasContractT && cashT ? cashT + contractT : null;
  return {
    cash, contract, total: cash + contract, cashT, contractT, totalT,
    cashPct: achieve(cash, cashT, elapsed, dim),
    totalPct: achieve(cash + contract, totalT, elapsed, dim),
  };
}
function cards(s, elapsed, dim, { company = false, callCenter = false, invoices = null } = {}) {
  const tgt = (t) => (t ? `تارجت شهري: ${fmt(t)}` : 'مالوش تارجت');
  return `
  <div class="cards">
    <div class="card"><div class="label">كاش (بعد IVF)</div><div class="value">${fmt(s.cash)}</div><div class="sub">${tgt(s.cashT)}</div>${pill(s.cashPct)}</div>
    <div class="card"><div class="label">تعاقد (صافي مطالبة)</div><div class="value">${fmt(s.contract)}</div><div class="sub">${callCenter ? `${invoices != null ? fmt(invoices) + ' فاتورة · ' : ''}مالوش تارجت` : tgt(s.contractT)}</div></div>
    <div class="card"><div class="label">إجمالي المبيعات</div><div class="value">${fmt(s.total)}</div><div class="sub">${callCenter ? 'كاش + تعاقدات' : tgt(s.totalT)}</div>${callCenter ? '' : pill(s.totalPct)}</div>
    <div class="card"><div class="label">أيام مضت من الشهر</div><div class="value">${elapsed} / ${dim}</div><div class="sub">${company ? 'إجمالي الشركة — ' : ''}البيانات محدّثة لحد آخر يوم متاح</div></div>
  </div>`;
}

// ---- views ------------------------------------------------------------------
function loginView(message = '') {
  killCharts();
  app.innerHTML = `
    <form class="login" id="login">
      <h1>📊 داشبورد المبيعات — تسجيل الدخول</h1>
      <label for="email">البريد الإلكتروني</label><input id="email" type="email" autocomplete="username" required />
      <label for="pw">كلمة المرور</label><input id="pw" type="password" autocomplete="current-password" required />
      <button type="submit">دخول</button>
      <div class="msg error" id="msg">${esc(message)}</div>
    </form>`;
  document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const { error } = await signIn(document.getElementById('email').value.trim(), document.getElementById('pw').value);
    if (error) { document.getElementById('msg').textContent = 'بيانات الدخول غير صحيحة'; btn.disabled = false; return; }
    start();
  });
}

let state = { model: null, branch: null, months: [], month: null };

async function dashboardView() {
  const { model } = state;
  const { branches, daysInMonth: dim } = model;
  const elapsed = Math.max(0, ...branches.flatMap((b) => b.daily.map((d) => d.day)));
  const core = branches.filter((b) => !b.isCallCenter);
  const days = (arr) => arr.map((d) => d.day);

  killCharts();
  if (!branches.length) {
    app.innerHTML = `<div class="wrap"><div class="empty">لا توجد بيانات لهذا الشهر</div></div>`;
    return;
  }
  if (!state.branch || !branches.some((b) => b.name === state.branch)) state.branch = branches[0].name;

  const monthOptions = state.months.map((m) => `<option value="${esc(m)}" ${m === state.month ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('');
  const cs = summarize(core, elapsed, dim);
  app.innerHTML = `
  <div class="wrap">
    <header>
      <div>
        <h1>📊 داشبورد المبيعات وKPIs — كل الفروع</h1>
        <div class="sub">${esc(monthLabel(model.month))} · حتى يوم ${elapsed} من ${dim} · بيانات كاش وتعاقد وأصناف فقط (بدون حوافز)</div>
      </div>
      <div class="toolbar">
        <span class="mode ${isLive ? 'live' : ''}">${isLive ? 'Supabase' : 'وضع تجريبي (بيانات محلية)'}</span>
        <select id="month">${monthOptions}</select>
        ${isLive ? '<button id="logout">خروج</button>' : ''}
      </div>
    </header>

    ${cards(cs, elapsed, dim, { company: true })}

    <div class="section"><h2>📈 اتجاه المبيعات اليومي — إجمالي الشركة</h2><div class="chart-wrap"><canvas id="chart-company"></canvas></div></div>
    <div class="section"><h2>📊 النمو اليومي للـKPIs — إجمالي الشركة (${core.length} فروع)</h2>${kpiGrid('kpi-company')}</div>
    <div class="section"><h2>🏢 مقارنة الفروع والكول سنتر (كاش مقابل تعاقد)</h2><div class="chart-wrap"><canvas id="chart-branches"></canvas></div></div>

    <div class="section">
      <h2>🗂️ تفاصيل كل فرع والكول سنتر (مبيعات + KPIs)</h2>
      <div class="branch-tabs">${branches.map((b) => `<button data-branch="${esc(b.name)}" class="${b.name === state.branch ? 'active' : ''}" style="border-right:3px solid ${esc(b.color)}">${esc(b.name)}</button>`).join('')}</div>
      <div id="branch-panel"></div>
    </div>
    <footer>H&amp;F Pharmacies · ${isLive ? 'البيانات من Supabase' : 'نسخة تجريبية ببيانات محلية'}</footer>
  </div>`;

  // company charts
  const dayList = [...new Set(core.flatMap((b) => days(b.daily)))].sort((a, b) => a - b);
  const byDay = (f) => dayList.map((d) => sum(core, (b) => (b.daily.find((x) => x.day === d) ? f(b.daily.find((x) => x.day === d)) : 0)));
  sales('chart-company', dayList, byDay((d) => d.cash), byDay((d) => d.contract));
  kpiTriplet('kpi-company', '#4f8ff7', model.companyKpis.map((d) => d.day), {
    avgInvoice: model.companyKpis.map((d) => d.avgInvoice), pctCoded: model.companyKpis.map((d) => d.pctCoded), avgItems: model.companyKpis.map((d) => d.avgItems),
  });
  chart('chart-branches', {
    type: 'bar',
    data: {
      labels: branches.map((b) => b.name),
      datasets: [
        { label: 'كاش', data: branches.map((b) => sum(b.daily, (d) => d.cash)), backgroundColor: '#4f8ff7' },
        { label: 'تعاقد', data: branches.map((b) => sum(b.daily, (d) => d.contract)), backgroundColor: '#f5a623' },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#e8ecf5' } } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#232c42' } } } },
  });

  document.getElementById('month').addEventListener('change', (e) => selectMonth(e.target.value));
  document.getElementById('logout')?.addEventListener('click', async () => { await signOut(); start(); });
  document.querySelectorAll('.branch-tabs button').forEach((btn) => btn.addEventListener('click', () => {
    state.branch = btn.dataset.branch;
    document.querySelectorAll('.branch-tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    branchPanel(elapsed, dim);
  }));
  branchPanel(elapsed, dim);
}

// Branch-specific charts are destroyed/rebuilt on tab switch; company charts stay.
function branchPanel(elapsed, dim) {
  killBucket('panel');
  killBucket('emp');
  bucket = 'panel';

  const b = state.model.branches.find((x) => x.name === state.branch);
  const s = summarize([b], elapsed, dim);
  const callInvoices = b.target.contractInvoices;
  const key = 'b'; // canvas ids are local to the single visible panel
  const rows = b.employees.slice().sort((x, y) => y.monthly.cashNet - x.monthly.cashNet);
  const where = b.isCallCenter ? 'الكول سنتر' : `فرع ${esc(b.name)}`;
  document.getElementById('branch-panel').innerHTML = `
    ${cards(s, elapsed, dim, { callCenter: b.isCallCenter, invoices: callInvoices })}
    <div class="chart-wrap"><canvas id="chart-${key}"></canvas></div>
    <h2 class="sub-h">📊 النمو اليومي للـKPIs — ${where}</h2>${kpiGrid(`kpi-${key}`)}
    ${rows.length ? `
    <h2 class="sub-h">👤 النمو اليومي بالأفراد — ${where}</h2>
    <select class="emp-select" id="emp-select">${rows.map((e) => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join('')}</select>
    ${kpiGrid(`emp-${key}`)}
    <div class="table-scroll" style="margin-top:18px"><table>
      <thead><tr><th>الموظف</th><th>كاش (صافي)</th><th>عدد فواتير</th><th>تعاقد</th><th>متوسط الفاتورة</th><th>متوسط الأصناف</th><th>% تكويد</th><th>Cosmo</th></tr></thead>
      <tbody>${rows.map((e) => `<tr><td>${esc(e.name)}</td><td>${fmt(e.monthly.cashNet)}</td><td>${fmt(e.monthly.invoices)}</td><td>${fmt(e.monthly.contract)}</td><td>${fmt(e.monthly.avgInvoice)}</td><td>${e.monthly.avgItems}</td><td>${e.monthly.pctCoded}%</td><td>${fmt(e.monthly.cosmo)}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}`;

  sales(`chart-${key}`, b.daily.map((d) => d.day), b.daily.map((d) => d.cash), b.daily.map((d) => d.contract));
  kpiTriplet(`kpi-${key}`, b.color, b.daily.map((d) => d.day), {
    avgInvoice: b.daily.map((d) => d.avgInvoice), pctCoded: b.daily.map((d) => d.pctCoded), avgItems: b.daily.map((d) => d.avgItems),
  });

  if (rows.length) {
    const sel = document.getElementById('emp-select');
    const renderEmp = (name) => {
      killBucket('emp');
      bucket = 'emp';
      const e = rows.find((r) => r.name === name);
      kpiTriplet(`emp-${key}`, b.color, e.daily.map((d) => 'يوم ' + d.day), {
        avgInvoice: e.daily.map((d) => d.avgInvoice), pctCoded: e.daily.map((d) => d.pctCoded), avgItems: e.daily.map((d) => d.avgItems),
      });
      bucket = 'main';
    };
    sel.addEventListener('change', () => renderEmp(sel.value));
    renderEmp(rows[0].name);
  }
  bucket = 'main';
}

// ---- boot -------------------------------------------------------------------
async function selectMonth(month) {
  app.innerHTML = '<div class="status">جاري التحميل…</div>';
  try {
    state.month = month;
    state.model = await loadMonth(month);
    await dashboardView();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="status error">تعذر تحميل البيانات: ${esc(err.message || err)}</div>`;
  }
}

async function start() {
  app.innerHTML = '<div class="status">جاري التحميل…</div>';
  try {
    const session = await getSession();
    if (!session) return loginView();
    state.months = await listMonths();
    if (!state.months.length) { app.innerHTML = '<div class="wrap"><div class="empty">لا توجد بيانات بعد — شغّل <code>npm run seed</code></div></div>'; return; }
    await selectMonth(state.month && state.months.includes(state.month) ? state.month : state.months[0]);
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="status error">خطأ: ${esc(err.message || err)}</div>`;
  }
}

if (isLive) sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') loginView(); });
start();
