// Payroll costs: what staff cost the company, month by month, from PROCESSED payrolls only.
// Employer cost = gross pay + non-taxable pay (allowances, expense refunds) + the employer's NIS, NHT, Education Tax and HEART.
// Reads the same records as Reports; nothing is changed. Admins, managing directors, payroll officers and viewers.

const CO_WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
const coEl = (id) => document.getElementById(id);
const coEsc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const coN = (v) => Number(v) || 0;
const coR = (v) => Math.round(v * 100) / 100;
const coMoney = (v) => `J$${Math.round(coN(v)).toLocaleString("en-US")}`;
const coMoney2 = (v) => `J$${coN(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const coMonthLabel = (key) => { const [y, m] = key.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }); };

// Validated with the dataviz palette checker (CVD-safe, fixed order). Contrast is under 3:1 for some, so values are
// always in the tooltip and the table below the chart.
const CO_SERIES = [
  { key: "base", label: "Basic and other pay", color: "#7445c4" },
  { key: "extra", label: "Overtime and bonuses", color: "#1e9e8f" },
  { key: "exempt", label: "Non-taxable pay", color: "#e5951a" },
  { key: "employer", label: "Employer contributions", color: "#d55181" }
];

let coRuns = [];
let coItems = [];
let coChart = null;

/* ---------- pure calculations (tested) ---------- */
function coEmployer(item) {
  const e = item.employer_contributions || {};
  const parts = coN(e.nis) + coN(e.nht) + coN(e.edTax) + coN(e.heart);
  return { nis: coN(e.nis), nht: coN(e.nht), edTax: coN(e.edTax), heart: coN(e.heart), total: e.total !== undefined && e.total !== null ? coN(e.total) : parts };
}

function coMonthOf(run) { return String(run.pay_date || run.period_end || "").slice(0, 7); }

// Range -> [fromMonth, toMonth] inclusive, and the same-length period before it.
function coRange(kind, today) {
  const t = today || new Date();
  const key = (y, m) => { const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  const y = t.getFullYear(), m = t.getMonth();
  if (kind === "year") return { from: key(y, 0), to: key(y, 11), prevFrom: key(y - 1, 0), prevTo: key(y - 1, 11), label: String(y) };
  if (kind === "lastyear") return { from: key(y - 1, 0), to: key(y - 1, 11), prevFrom: key(y - 2, 0), prevTo: key(y - 2, 11), label: String(y - 1) };
  if (kind === "6") return { from: key(y, m - 5), to: key(y, m), prevFrom: key(y, m - 11), prevTo: key(y, m - 6), label: "the last 6 months" };
  return { from: key(y, m - 11), to: key(y, m), prevFrom: key(y, m - 23), prevTo: key(y, m - 12), label: "the last 12 months" };
}

function coSummarise(runs, items, from, to) {
  const runMonth = new Map(runs.filter((r) => r.status === "processed").map((r) => [r.id, coMonthOf(r)]));
  const months = new Map();
  const depts = new Map();
  const people = new Set();
  const t = { base: 0, extra: 0, exempt: 0, employer: 0, gross: 0, cost: 0, paye: 0, nisE: 0, nhtE: 0, edE: 0, nisR: 0, nhtR: 0, edR: 0, heart: 0, overtime: 0, net: 0, runs: new Set() };

  items.forEach((i) => {
    const mk = runMonth.get(i.payroll_run_id);
    if (!mk || mk < from || mk > to) return;
    const er = coEmployer(i);
    const gross = coN(i.gross_pay);
    const extra = coN(i.overtime) + coN(i.bonus);
    const exempt = coN(i.exempt_allowance);
    const cost = gross + exempt + er.total;
    const m = months.get(mk) || { month: mk, base: 0, extra: 0, exempt: 0, employer: 0, cost: 0, people: new Set() };
    m.base += gross - extra; m.extra += extra; m.exempt += exempt; m.employer += er.total; m.cost += cost; m.people.add(i.employee_id);
    months.set(mk, m);

    const dk = (i.department || "").trim() || "No department";
    const d = depts.get(dk) || { name: dk, cost: 0, gross: 0, overtime: 0, people: new Set() };
    d.cost += cost; d.gross += gross; d.overtime += coN(i.overtime); d.people.add(i.employee_id);
    depts.set(dk, d);

    people.add(i.employee_id);
    t.base += gross - extra; t.extra += extra; t.exempt += exempt; t.employer += er.total; t.gross += gross; t.cost += cost;
    t.paye += coN(i.paye); t.nisE += coN(i.nis); t.nhtE += coN(i.nht); t.edE += coN(i.education_tax);
    t.nisR += er.nis; t.nhtR += er.nht; t.edR += er.edTax; t.heart += er.heart; t.overtime += coN(i.overtime); t.net += coN(i.net_pay);
    t.runs.add(i.payroll_run_id);
  });

  const monthList = [...months.values()].sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ ...m, base: coR(m.base), extra: coR(m.extra), exempt: coR(m.exempt), employer: coR(m.employer), cost: coR(m.cost), headcount: m.people.size }));
  const perHead = monthList.length ? monthList.reduce((s, m) => s + (m.headcount ? m.cost / m.headcount : 0), 0) / monthList.length : 0;
  Object.keys(t).forEach((k) => { if (typeof t[k] === "number") t[k] = coR(t[k]); });

  return {
    months: monthList,
    departments: [...depts.values()].map((d) => ({ name: d.name, cost: coR(d.cost), gross: coR(d.gross), overtime: coR(d.overtime), headcount: d.people.size }))
      .sort((a, b) => b.cost - a.cost),
    totals: { ...t, runs: t.runs.size, people: people.size, perHead: coR(perHead), overtimeShare: t.gross ? t.overtime / t.gross : 0, employerShare: t.cost ? t.employer / t.cost : 0 }
  };
}

function coChange(now, before) {
  if (!before) return "";
  const pct = ((now - before) / before) * 100;
  if (!isFinite(pct)) return "";
  const arrow = pct > 0.5 ? "▲" : pct < -0.5 ? "▼" : "■";
  return `${arrow} ${Math.abs(pct).toFixed(1)}% on the period before`;
}

/* ---------- drawing ---------- */
function coRender() {
  const range = coRange(coEl("coRange").value);
  const s = coSummarise(coRuns, coItems, range.from, range.to);
  const p = coSummarise(coRuns, coItems, range.prevFrom, range.prevTo);
  const t = s.totals;

  coEl("coSub").textContent = t.runs
    ? `${t.runs} processed ${t.runs === 1 ? "payroll" : "payrolls"} in ${range.label}, ${t.people} ${t.people === 1 ? "person" : "people"}.`
    : `No processed payrolls in ${range.label}.`;

  const tile = (label, value, note, change) => `<div class="page-card co-tile"><span>${coEsc(label)}</span><strong>${coEsc(value)}</strong>
    <small>${coEsc(note)}</small>${change ? `<small class="co-change">${coEsc(change)}</small>` : ""}</div>`;
  coEl("coTiles").innerHTML =
    tile("Total employer cost", coMoney(t.cost), "Gross pay, non-taxable pay and employer contributions", coChange(t.cost, p.totals.cost)) +
    tile("Gross pay", coMoney(t.gross), `Overtime is ${(t.overtimeShare * 100).toFixed(1)}% of it`, coChange(t.gross, p.totals.gross)) +
    tile("Employer contributions", coMoney(t.employer), `NIS, NHT, Education Tax, HEART: ${(t.employerShare * 100).toFixed(1)}% of cost`, coChange(t.employer, p.totals.employer)) +
    tile("Cost per person, per month", coMoney(t.perHead), "Average over the months with a payroll", coChange(t.perHead, p.totals.perHead));

  // stacked bars by month
  const labels = s.months.map((m) => coMonthLabel(m.month));
  const datasets = CO_SERIES.map((ser, idx) => ({
    label: ser.label, data: s.months.map((m) => m[ser.key]), backgroundColor: ser.color, stack: "cost",
    borderColor: "#ffffff", borderWidth: { top: 2, bottom: 0, left: 0, right: 0 }, borderSkipped: false,
    borderRadius: idx === CO_SERIES.length - 1 ? { topLeft: 4, topRight: 4 } : 0, maxBarThickness: 44
  }));
  const canvas = coEl("coChart");
  coEl("coChartEmpty").hidden = s.months.length > 0;
  canvas.hidden = !s.months.length;
  if (typeof Chart !== "undefined" && s.months.length) {
    if (coChart) coChart.destroy();
    coChart = new Chart(canvas, {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", align: "start", labels: { usePointStyle: true, pointStyle: "rectRounded", boxWidth: 10, color: "#3b3d52", font: { size: 13 } } },
          tooltip: { callbacks: {
            label: (c) => ` ${c.dataset.label}: ${coMoney(c.parsed.y)}`,
            footer: (items) => `Total: ${coMoney(items.reduce((sum, c) => sum + c.parsed.y, 0))} · ${s.months[items[0].dataIndex].headcount} people`
          } }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: "#5f6475" } },
          y: { stacked: true, beginAtZero: true, grid: { color: "#eef0f5" }, border: { display: false },
            ticks: { color: "#5f6475", callback: (v) => (v >= 1e6 ? `J$${(v / 1e6).toFixed(1)}M` : `J$${Math.round(v / 1000)}k`) } }
        }
      }
    });
  }

  // month table (the accessible version of the chart)
  coEl("coMonths").innerHTML = s.months.length ? s.months.map((m) => `<tr><td>${coEsc(coMonthLabel(m.month))}</td><td class="num">${m.headcount}</td>
      <td class="num">${coMoney(m.base)}</td><td class="num">${coMoney(m.extra)}</td><td class="num">${coMoney(m.exempt)}</td><td class="num">${coMoney(m.employer)}</td>
      <td class="num"><strong>${coMoney(m.cost)}</strong></td></tr>`).join("") +
      `<tr class="co-total"><td>Total</td><td class="num">${t.people}</td><td class="num">${coMoney(t.base)}</td><td class="num">${coMoney(t.extra)}</td>
      <td class="num">${coMoney(t.exempt)}</td><td class="num">${coMoney(t.employer)}</td><td class="num"><strong>${coMoney(t.cost)}</strong></td></tr>`
    : '<tr class="empty-row"><td colspan="7">No processed payrolls in this period.</td></tr>';

  // departments: one bar per department (one hue), share of total
  const top = s.departments.length ? s.departments[0].cost : 0;
  coEl("coDepts").innerHTML = s.departments.length ? s.departments.map((d) => {
    const share = t.cost ? (d.cost / t.cost) * 100 : 0;
    return `<tr><td><strong>${coEsc(d.name)}</strong><div class="co-bar" aria-hidden="true"><span style="width:${top ? Math.max(2, (d.cost / top) * 100) : 0}%"></span></div></td>
      <td class="num">${d.headcount}</td><td class="num">${coMoney(d.cost)}</td><td class="num">${share.toFixed(1)}%</td><td class="num">${coMoney(d.overtime)}</td></tr>`;
  }).join("") : '<tr class="empty-row"><td colspan="5">No departments in this period.</td></tr>';

  // statutory: employee vs employer
  const row = (name, emp, er) => `<tr><td>${name}</td><td class="num">${emp === null ? "—" : coMoney2(emp)}</td><td class="num">${er === null ? "—" : coMoney2(er)}</td><td class="num"><strong>${coMoney2(coN(emp) + coN(er))}</strong></td></tr>`;
  coEl("coStat").innerHTML = row("PAYE (income tax)", t.paye, null) + row("NIS", t.nisE, t.nisR) + row("NHT", t.nhtE, t.nhtR) +
    row("Education Tax", t.edE, t.edR) + row("HEART/NSTA Trust", null, t.heart) +
    `<tr class="co-total"><td>Total</td><td class="num">${coMoney2(t.paye + t.nisE + t.nhtE + t.edE)}</td><td class="num">${coMoney2(t.nisR + t.nhtR + t.edR + t.heart)}</td>
      <td class="num"><strong>${coMoney2(t.paye + t.nisE + t.nhtE + t.edE + t.nisR + t.nhtR + t.edR + t.heart)}</strong></td></tr>`;

  coEl("coCsv").onclick = () => coCsv(s, range);
}

function coCsv(s, range) {
  const cell = (v) => { const x = String(v ?? ""); return /[",\n]/.test(x) ? `"${x.replaceAll('"', '""')}"` : x; };
  const lines = [["Month", "People", "Basic and other pay", "Overtime and bonuses", "Non-taxable pay", "Employer contributions", "Total employer cost"]]
    .concat(s.months.map((m) => [m.month, m.headcount, m.base.toFixed(2), m.extra.toFixed(2), m.exempt.toFixed(2), m.employer.toFixed(2), m.cost.toFixed(2)]))
    .concat([[], ["Department", "People", "Employer cost", "Gross pay", "Overtime"]])
    .concat(s.departments.map((d) => [d.name, d.headcount, d.cost.toFixed(2), d.gross.toFixed(2), d.overtime.toFixed(2)]));
  const blob = new Blob(["﻿" + lines.map((l) => l.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `Payroll_costs_${range.from}_to_${range.to}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- loading ---------- */
async function coLoad() {
  const runs = await supabaseClient.from("payroll_runs").select("id, status, period_start, period_end, pay_date").eq("workspace", CO_WS).eq("status", "processed");
  if (runs.error) throw runs.error;
  coRuns = runs.data || [];
  const ids = coRuns.map((r) => r.id);
  coItems = [];
  for (let i = 0; i < ids.length; i += 100) {
    const part = await supabaseClient.from("payroll_run_items")
      .select("payroll_run_id, employee_id, department, gross_pay, overtime, bonus, exempt_allowance, paye, nis, nht, education_tax, net_pay, employer_contributions")
      .in("payroll_run_id", ids.slice(i, i + 100));
    if (part.error) throw part.error;
    coItems.push(...(part.data || []));
  }
}

async function coStart() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data || !data.session) { window.location.href = "login.html?next=costs.html"; return; }
  const { data: role } = await supabaseClient.rpc("get_my_role", { p_workspace: CO_WS });
  if (!["admin", "director", "payroll", "viewer"].includes(role)) {
    coEl("coSub").textContent = "Only admins, managing directors, payroll officers and viewers can see payroll costs.";
    return;
  }
  try {
    await coLoad();
  } catch (error) {
    coEl("coSub").textContent = error.message || "Payroll costs could not be loaded.";
    return;
  }
  coEl("coRange").addEventListener("change", coRender);
  coRender();
}

if (!window.__CO_TEST__) coStart();
