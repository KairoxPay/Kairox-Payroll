// S02 employer's annual return for TAJ. Schedule A is the S01 schedule over the whole year (one line per person, every payroll paid in the year merged),
// and Section B totals it, subtracts what you already paid through the monthly S01 returns recorded in Kairox Pay, and shows the balance.
// Nothing is sent to TAJ: you download the file and file it yourself at jamaicatax.gov.jm.
// Uses helpers from compliance.js (cpRuns, cpFilings, cpEsc, cpMoney, cpCsvCell, cpCanRecord, cpBanner) and s01-schedule.js (s01Aggregate...).

const S02_SHEET = "S02ScheduleA";
const S02_LINES = [["heart", "H.E.A.R.T.", 12], ["nis", "N.I.S.", 13], ["nht", "N.H.T.", 14], ["edTax", "Education Tax", 15], ["paye", "Income Tax (P.A.Y.E.)", 16]];
// Same columns as S01, with "for the month" changed to "for the year".
const S02_HEADERS = S01_HEADERS.map((h, i) => (i === 8 ? "Number of weekly NIS\nand NHT Contributions\nfor the year" : h));

var s02State = null;   // var, so tests can read it

const s02Weeks = () => { try { return localStorage.getItem(`kairoxS02Weeks:${CP_WORKSPACE}`) || ""; } catch (error) { return ""; } };
const s02El = (id) => document.getElementById(id);
const s02Month = (run) => String(run.pay_date || run.period_end).slice(0, 7);

/* ---------- pure helpers ---------- */
// Totals for each line of Section B, from the schedule rows.
function s02Totals(rows) {
  const sum = (k) => s01R(rows.reduce((t, r) => t + s01Num(r[k]), 0));
  return { heart: sum("heart"), nis: sum("nis"), nht: sum("nht"), edTax: sum("edTax"), paye: sum("paye"), cash: sum("cash"), kind: sum("kind"), pension: sum("pension") };
}

// Amount assessed in each pay month, per line (employee and employer shares together, as in S01).
function s02ByMonth(items, runs) {
  const monthOf = new Map((runs || []).map((r) => [r.id, s02Month(r)]));
  const out = {};

  (items || []).forEach((item) => {
    const key = monthOf.get(item.payroll_run_id);
    if (!key) return;
    const er = item.employer_contributions || {};
    const m = (out[key] = out[key] || { heart: 0, nis: 0, nht: 0, edTax: 0, paye: 0 });
    m.heart += s01Num(er.heart);
    m.nis += s01Num(item.nis) + s01Num(er.nis);
    m.nht += s01Num(item.nht) + s01Num(er.nht);
    m.edTax += s01Num(item.education_tax) + s01Num(er.edTax);
    m.paye += s01Num(item.paye);
  });

  return out;
}

// What was already paid through monthly S01 returns: for each month recorded as filed, each line counts in proportion to the amount paid
// (exactly the line itself when the month was paid in full). Months with no S01 recorded count as nothing paid.
function s02Prepaid(byMonth, filings, year) {
  const prepaid = { heart: 0, nis: 0, nht: 0, edTax: 0, paye: 0 };
  const missing = [];

  Object.keys(byMonth).sort().forEach((key) => {
    const f = (filings || []).find((x) => x.filing_type === "S01" && x.period_key === key);
    const due = f ? s01Num(f.amount_due) : 0;
    if (!f || due <= 0) { missing.push(key); return; }
    const ratio = s01Num(f.amount_paid) / due;
    Object.keys(prepaid).forEach((k) => { prepaid[k] += byMonth[key][k] * ratio; });
  });

  Object.keys(prepaid).forEach((k) => { prepaid[k] = s01R(prepaid[k]); });
  return { prepaid, missing };
}

// Section B: (c) = (a) - (b);  (e) = (c) - (d). Negative means a refund is due.
function s02SectionB(totals, credit, prepaid) {
  const lines = S02_LINES.map(([k, label, n]) => {
    const a = s01R(totals[k]);
    const b = k === "heart" ? s01R(Math.max(0, s01Num(credit))) : 0;
    const c = s01R(a - b);
    const d = s01R(prepaid[k]);
    return { key: k, label, n, a, b, c, d, e: s01R(c - d) };
  });
  const total = ["a", "b", "c", "d", "e"].reduce((o, f) => ({ ...o, [f]: s01R(lines.reduce((t, l) => t + l[f], 0)) }), {});
  return { lines, total };
}

function s02Sheet(rows, all) {
  return [S02_HEADERS].concat(rows.map((r) => {
    const weeks = String(s01RowWeeks(r, all)).trim();
    return [r.surname, r.first, r.mi, s01Trn(r.trn), String(r.nis_number || "").trim().toUpperCase(),
      r.cash, r.kind, r.pension, weeks !== "" && Number.isFinite(Number(weeks)) ? Number(weeks) : "", r.nis, r.nht, r.edTax, r.paye];
  }));
}

function s02WorkbookBytes(rows, all) {
  const sheet = XLSX.utils.aoa_to_sheet(s02Sheet(rows, all));
  sheet["!cols"] = [15, 15, 9, 15, 13, 24, 24, 26, 22, 22, 22, 24, 24].map((wch) => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, S02_SHEET);
  return XLSX.write(book, { bookType: "biff8", type: "array" });
}

function s02ScheduleCsv(rows, all) {
  const head = S02_HEADERS.map((h) => String(h).replace(/\s*\n+\s*/g, " ").trim());
  return [head].concat(s02Sheet(rows, all).slice(1)).map((r) => r.map(cpCsvCell).join(",")).join("\n");
}

function s02SummaryCsv(s, b) {
  const company = s.profile || {};
  const rows = [
    ["S02 employer's annual return - figures to copy", s.year],
    ["Name of employer", company.company_name || ""], ["TRN", company.trn || ""], ["NIS reference number", company.nis_number || ""],
    ["Return/calendar year", s.year], ["Number of persons employed (9a)", s.rows.length], ["Number of HEART trainees (9b)", s01Num(s.trainees)], [],
    ["Section B", "Line", "(a) Assessed", "(b) HEART trainee credit", "(c) Total payable", "(d) Prepaid", "(e) Balance payable/(refundable)"]
  ].concat(b.lines.map((l) => ["", l.n, l.a, l.b, l.c, l.d, l.e]), [["Total", 17, b.total.a, b.total.b, b.total.c, b.total.d, b.total.e]]);
  return rows.map((r) => r.map(cpCsvCell).join(",")).join("\n");
}

/* ---------- the dialog ---------- */
function s02Close() {
  s02El("s02Dialog").hidden = true;
  s02El("s02Box").innerHTML = "";
  s02State = null;
}

async function s02Open(yearText) {
  const year = Number(yearText);
  const runs = cpRuns.filter((r) => s02Month(r).startsWith(String(year)));
  const [itemsResult, empResult, profileResult] = await Promise.all([
    supabaseClient.from("payroll_run_items").select("*").in("payroll_run_id", runs.map((r) => r.id)),
    supabaseClient.from("employees").select("id, name, trn, nis_number").eq("workspace", CP_WORKSPACE),
    supabaseClient.from("company_profile").select("*").eq("workspace", CP_WORKSPACE).maybeSingle()
  ]);

  let employees = empResult.data;
  const hasNis = !empResult.error;

  if (empResult.error) {
    const retry = await supabaseClient.from("employees").select("id, name, trn").eq("workspace", CP_WORKSPACE);
    employees = retry.data;
  }

  if (itemsResult.error) {
    cpBanner("The payslip lines for that year could not be loaded. Please refresh and try again.");
    return;
  }

  const items = itemsResult.data || [];
  const rows = s01Aggregate(items, employees || []);
  const byMonth = s02ByMonth(items, runs);
  const { prepaid, missing } = s02Prepaid(byMonth, cpFilings, year);
  const legacy = runs.some((r) => { const e = r.employer_totals || {}; return Object.keys(e).length === 0; });

  s02State = { year, rows, byMonth, missing, runs: runs.length, legacy, hasNis, profile: profileResult.data || null,
    all: s02Weeks(), trainees: 0, credit: 0, closed: "", prepaid: { ...prepaid }, prepaidAuto: { ...prepaid } };
  s02Render();
}

function s02Render() {
  const s = s02State;
  const input = (i, field, value, extra = "") =>
    `<input class="s02in" data-i="${i}" data-field="${field}" value="${cpEsc(value)}" ${extra} style="width:100%;min-width:60px;padding:5px 7px;border:1px solid #c9cad6;border-radius:6px;font:inherit;font-size:13px">`;

  const body = s.rows.map((r, i) => `<tr>
      <td>${input(i, "surname", r.surname, 'aria-label="Surname"')}</td>
      <td>${input(i, "first", r.first, 'aria-label="First name"')}</td>
      <td style="width:54px">${input(i, "mi", r.mi, 'maxlength="3" aria-label="Middle initial"')}</td>
      <td class="num">${cpEsc(s01Trn(r.trn)) || '<span class="muted">missing</span>'}</td>
      <td>${input(i, "nis_number", r.nis_number, 'placeholder="Z123456" aria-label="NIS number"')}</td>
      <td class="num">${cpMoney(r.cash)}</td><td class="num">${cpMoney(r.pension)}</td>
      <td style="width:70px">${input(i, "weeks", s01RowWeeks(r, s.all), 'inputmode="numeric" aria-label="Weekly contributions"')}</td>
      <td class="num">${cpMoney(r.nis)}</td><td class="num">${cpMoney(r.nht)}</td><td class="num">${cpMoney(r.edTax)}</td><td class="num">${cpMoney(r.paye)}</td>
    </tr>`).join("");

  const small = "width:110px;padding:5px 7px;border:1px solid #c9cad6;border-radius:6px;font:inherit;text-align:right";
  const secB = S02_LINES.map(([k, label, n]) => `<tr data-line="${k}"><td><strong>${n}</strong></td><td>${cpEsc(label)}</td>
      <td class="num" data-cell="a"></td>
      <td class="num">${k === "heart" ? `<input id="s02Credit" inputmode="decimal" value="${cpEsc(s.credit)}" style="${small}" aria-label="HEART trainee tax credit">` : "0.00"}</td>
      <td class="num" data-cell="c"></td>
      <td class="num"><input class="s02pre" data-k="${k}" inputmode="decimal" value="${cpEsc(s.prepaid[k])}" style="${small}" aria-label="Prepaid ${cpEsc(label)}"></td>
      <td class="num" data-cell="e"></td></tr>`).join("");

  s02El("s02Box").innerHTML = `
    <h3 id="s02Title">S02 annual return for ${s.year}</h3>
    <p>${s.runs} ${s.runs === 1 ? "payroll" : "payrolls"} paid in ${s.year}, merged into one line per person. Schedule A downloads in the same layout as the S01 schedule. Section A and B below are the figures to type into TAJ's S02 form.</p>
    <div id="s02Warnings"></div>
    <h4 style="margin:0 0 6px">Section A: general information</h4>
    <div id="s02SecA" style="margin-bottom:12px"></div>
    <h4 style="margin:0 0 6px">Section B: summary of taxes and contributions</h4>
    <div class="table-wrap"><table class="data" id="s02SecB">
      <thead><tr><th>Line</th><th>Tax</th><th class="num">(a) Assessed for the year</th><th class="num">(b) HEART trainee credit</th><th class="num">(c) Total payable</th><th class="num">(d) Prepaid</th><th class="num">(e) Balance payable / (refundable)</th></tr></thead>
      <tbody>${secB}</tbody><tfoot id="s02SecBTotal"></tfoot></table></div>
    <p class="muted small" style="margin:6px 0 14px">(d) is worked out from the S01 returns you recorded as filed here, in proportion to the amount paid (exactly the line itself when a month was paid in full). Change it if your receipts show something different. Brackets mean a refund.</p>
    <h4 style="margin:0 0 6px">Schedule A: employee emoluments, deductions and PAYE</h4>
    <div class="form-grid" style="margin-bottom:12px">
      <div class="field"><label for="s02All">Weekly NIS and NHT contributions for the year (column g)</label>
        <input id="s02All" inputmode="numeric" value="${cpEsc(s.all)}" placeholder="for example 52">
        <small>Used for everyone unless you change a row. Check with the NIS office or your accountant what to enter for each person. It is remembered for next time.</small></div>
    </div>
    <div class="table-wrap"><table class="data" id="s02Table">
      <thead><tr><th>Surname</th><th>First name</th><th>MI</th><th>TRN</th><th>NIS number</th><th class="num">Gross (cash)</th><th class="num">Pension</th><th>Weeks</th><th class="num">NIS</th><th class="num">NHT</th><th class="num">Education Tax</th><th class="num">PAYE</th></tr></thead>
      <tbody>${body || '<tr class="empty-row"><td colspan="12">No payslips found for this year.</td></tr>'}</tbody>
      <tfoot id="s02Totals"></tfoot>
    </table></div>
    <p class="muted small" style="margin:6px 0 14px">NIS, NHT and Education Tax are the employee's and employer's shares added together, as TAJ's columns ask. Benefits in kind are left at 0: Kairox Pay does not record them.</p>
    <div id="s02Msg" class="form-message" role="status"></div>
    <div class="dialog-actions" style="flex-wrap:wrap">
      <button type="button" class="btn" data-s02act="close">Close</button>
      ${s.hasNis && cpCanRecord() ? '<button type="button" class="btn" data-s02act="savenis">Save NIS numbers</button>' : ""}
      <button type="button" class="btn" data-s02act="summary">Download Section A and B (CSV)</button>
      <button type="button" class="btn" data-s02act="csv">Schedule A (CSV)</button>
      <button type="button" class="btn primary" data-s02act="xls">Schedule A for TAJ (.xls)</button>
    </div>`;

  s02El("s02Dialog").hidden = false;
  s02Refresh();
}

function s02Msg(text, kind) {
  const box = s02El("s02Msg");
  if (!box) return;
  box.textContent = text || "";
  box.className = `form-message ${kind || ""}`.trim();
}

function s02Refresh() {
  const s = s02State;
  if (!s) return;

  const t = s02Totals(s.rows);
  const b = s02SectionB(t, s.credit, s.prepaid);
  const p = s.profile || {};

  s02El("s02Totals").innerHTML = `<tr><th colspan="5">Totals</th><th class="num">${cpMoney(t.cash)}</th><th class="num">${cpMoney(t.pension)}</th><th></th><th class="num">${cpMoney(t.nis)}</th><th class="num">${cpMoney(t.nht)}</th><th class="num">${cpMoney(t.edTax)}</th><th class="num">${cpMoney(t.paye)}</th></tr>`;

  b.lines.forEach((l) => {
    const tr = document.querySelector(`#s02SecB tr[data-line="${l.key}"]`);
    if (!tr) return;
    tr.querySelector('[data-cell="a"]').textContent = cpMoney(l.a);
    tr.querySelector('[data-cell="c"]').textContent = cpMoney(l.c);
    tr.querySelector('[data-cell="e"]').textContent = l.e < 0 ? `(${cpMoney(-l.e)})` : cpMoney(l.e);
  });
  s02El("s02SecBTotal").innerHTML = `<tr><th>17</th><th>Total</th><th class="num">${cpMoney(b.total.a)}</th><th class="num">${cpMoney(b.total.b)}</th><th class="num">${cpMoney(b.total.c)}</th><th class="num">${cpMoney(b.total.d)}</th><th class="num">${b.total.e < 0 ? `(${cpMoney(-b.total.e)})` : cpMoney(b.total.e)}</th></tr>`;

  const addr = [p.address_line1, p.address_line2, p.parish].filter(Boolean).join(", ");
  const field = (n, label, value) => `<tr><td style="width:44px"><strong>${n}</strong></td><td>${cpEsc(label)}</td><td>${value || '<span class="muted">not set (Settings > Company profile)</span>'}</td></tr>`;
  s02El("s02SecA").innerHTML = `<div class="table-wrap"><table class="data"><tbody>
      ${field(1, "Name of employer", cpEsc(p.company_name || ""))}
      ${field(2, "Taxpayer Registration Number (TRN)", cpEsc(p.trn || ""))}
      ${field(3, "NIS reference number", cpEsc(p.nis_number || ""))}
      ${field(4, "Return/calendar year", s.year)}
      ${field(5, "Telephone number", cpEsc(p.phone || ""))}
      ${field(6, "Email address", cpEsc(p.email || ""))}
      ${field(7, "Business address", cpEsc(addr))}
      <tr><td><strong>9a</strong></td><td>Number of persons employed during the year</td><td><strong>${s.rows.length}</strong></td></tr>
      <tr><td><strong>9b</strong></td><td>Number of HEART trainees employed during the year</td><td><input id="s02Trainees" inputmode="numeric" value="${cpEsc(s.trainees)}" style="width:70px;padding:5px 7px;border:1px solid #c9cad6;border-radius:6px;font:inherit;text-align:right" aria-label="Number of HEART trainees"></td></tr>
      <tr><td><strong>10</strong></td><td>If the business closed during the year, the date of closure<small>Only for your own notes: leave it empty if you are still trading.</small></td><td><input id="s02Closed" value="${cpEsc(s.closed)}" placeholder="month / day" style="width:120px;padding:5px 7px;border:1px solid #c9cad6;border-radius:6px;font:inherit"></td></tr>
    </tbody></table></div>`;

  const names = (list) => list.map((r) => `${r.first} ${r.surname}`.trim()).join(", ");
  const warnings = [];
  const now = cpToday();
  if (s.year === now.getFullYear()) warnings.push(`${s.year} is not over yet. The figures cover payrolls processed so far; file after 31 December.`);
  if (s.legacy) warnings.push("An older payroll this year has no employer shares recorded, so NIS, NHT and Education Tax are the employees' shares only for that payroll.");
  if (s.missing.length) warnings.push(`No S01 is recorded as filed for: ${s.missing.map(cpMonthLabel).join(", ")}. Nothing is counted as prepaid for those months, so the balance in (e) includes them. Record them on this page if they were filed and paid, then reopen this return.`);
  const noTrn = s.rows.filter((r) => !String(r.trn).trim());
  const noNis = s.rows.filter((r) => !String(r.nis_number).trim());
  const noWeeks = s.rows.filter((r) => String(s01RowWeeks(r, s.all)).trim() === "");
  const oddName = s.rows.filter((r) => r.surname.length < 2 || !r.first);
  if (!p.trn || !p.company_name) warnings.push("Your company name and TRN are not both set in Settings > Company profile.");
  if (noTrn.length) warnings.push(`No TRN for: ${names(noTrn)}. Add it on the employee's profile.`);
  if (noNis.length) warnings.push(`No NIS number for: ${names(noNis)}. Type it in the NIS column${s.hasNis ? ", then click Save NIS numbers so it is remembered" : ""}.`);
  if (noWeeks.length) warnings.push("The weekly contributions (column g) are blank. TAJ's schedule has this column, so fill it in.");
  if (oddName.length) warnings.push(`Check how the name is split for: ${names(oddName)}.`);
  if (!s.hasNis) warnings.push("NIS numbers cannot be remembered yet: run phase15-nis-numbers.sql in Supabase.");

  s02El("s02Warnings").innerHTML = warnings.length
    ? `<div class="note" style="margin:0 0 12px"><strong>Before you file:</strong><ul style="margin:6px 0 0;padding-left:20px">${warnings.map((w) => `<li>${cpEsc(w)}</li>`).join("")}</ul></div>`
    : '<div class="note" style="margin:0 0 12px">Everything the return needs is filled in.</div>';
}

async function s02SaveNis() {
  const s = s02State;
  const changed = s.rows.filter((r) => r.employee_id && String(r.nis_number).trim().toUpperCase() !== String(r.nis_saved).trim().toUpperCase());
  if (!changed.length) return s02Msg("There are no new NIS numbers to save.", "");

  let failed = 0;
  for (const r of changed) {
    const value = String(r.nis_number).trim().toUpperCase();
    const { error } = await supabaseClient.from("employees").update({ nis_number: value || null }).eq("id", r.employee_id).eq("workspace", CP_WORKSPACE);
    if (error) { failed += 1; console.error("NIS number was not saved:", error); } else { r.nis_number = value; r.nis_saved = value; }
  }

  s02Msg(failed ? `${failed} could not be saved. You may not have permission to edit employees.` : `Saved NIS numbers for ${changed.length} ${changed.length === 1 ? "employee" : "employees"}.`, failed ? "error" : "ok");
  s02Refresh();
}

function s02Download(kind) {
  const s = s02State;
  const company = s01CompanyName().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  try { localStorage.setItem(`kairoxS02Weeks:${CP_WORKSPACE}`, String(s.all)); } catch (error) { /* storage can be unavailable */ }

  if (kind === "csv") {
    s01Save(`S02_Schedule_A_${company}_${s.year}.csv`, new Blob(["﻿" + s02ScheduleCsv(s.rows, s.all)], { type: "text/csv;charset=utf-8;" }));
    return s02Msg("CSV downloaded.", "ok");
  }
  if (kind === "summary") {
    s01Save(`S02_Section_A_B_${company}_${s.year}.csv`, new Blob(["﻿" + s02SummaryCsv(s, s02SectionB(s02Totals(s.rows), s.credit, s.prepaid))], { type: "text/csv;charset=utf-8;" }));
    return s02Msg("Section A and B figures downloaded.", "ok");
  }
  if (typeof XLSX === "undefined") return s02Msg("The Excel file could not be built because the spreadsheet library did not load. Refresh, or download the CSV.", "error");

  s01Save(`S02_Schedule_A_${company}_${s.year}.xls`, new Blob([s02WorkbookBytes(s.rows, s.all)], { type: "application/vnd.ms-excel" }));
  s02Msg("Downloaded. Upload it with your S02 on TAJ's site, or paste its rows into TAJ's own template. File by 31 March.", "ok");
}

/* ---------- wiring ---------- */
document.addEventListener("click", (event) => {
  const open = event.target.closest && event.target.closest("[data-s02]");
  if (open) return s02Open(open.getAttribute("data-s02"));

  const act = event.target.closest && event.target.closest("[data-s02act]");
  if (act) {
    const name = act.getAttribute("data-s02act");
    if (name === "close") return s02Close();
    if (name === "savenis") return s02SaveNis();
    if (name === "csv" || name === "xls" || name === "summary") return s02Download(name);
  }
  if (event.target.id === "s02Dialog") s02Close();
});

document.addEventListener("input", (event) => {
  if (!s02State) return;
  const t = event.target;

  if (t.id === "s02All") { s02State.all = t.value.trim(); s02State.rows.forEach((r, i) => { if (r.weeks === null) { const cell = document.querySelector(`.s02in[data-i="${i}"][data-field="weeks"]`); if (cell) cell.value = s02State.all; } }); }
  else if (t.id === "s02Trainees") s02State.trainees = t.value;
  else if (t.id === "s02Closed") s02State.closed = t.value;
  else if (t.id === "s02Credit") s02State.credit = t.value;
  else if (t.classList && t.classList.contains("s02pre")) s02State.prepaid[t.dataset.k] = t.value;
  else if (t.classList && t.classList.contains("s02in")) {
    const row = s02State.rows[Number(t.dataset.i)];
    if (!row) return;
    if (t.dataset.field === "weeks") row.weeks = t.value.trim(); else row[t.dataset.field] = t.value;
  } else return;

  s02Refresh();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && s02State) s02Close();
});
