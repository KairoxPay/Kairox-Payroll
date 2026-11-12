// S01 Schedule A for TAJ. One line per employee for a pay month, in the layout of TAJ's own "S01 Schedule A" Excel template.
// Every payroll paid in the month (weekly, fortnightly or monthly) is merged, and the employee's and employer's shares are added together
// the way the template's NIS, NHT and Education Tax columns ask. Nothing is sent to TAJ: you download the file and upload it yourself.
// Uses the helpers in compliance.js (cpRuns, cpMonths, cpEsc, cpMoney, cpCsvCell, cpCanRecord...).

const S01_SHEET = "S01ScheduleA";
// TAJ's column headings, exactly as in their template (S01_Schedule_Template_v3.xls). Do not reword them.
const S01_HEADERS = [
  "Surname",
  "Firstname",
  "Middle Initials",
  "Employee TRN ",
  "Employee NIS",
  "Gross Emoluments Received in Cash\n\nSalaries, Wages, Fees,\nBonuses, Overtime pay,\nCommissions, etc...",
  "Gross Emoluments Received in Kind\n\n",
  "Superannuation / Pension, Agreed Expenses, Employees Share Ownership Plan",
  "Number of weekly NIS\nand NHT Contributions\nfor the month",
  "NIS\n\n(Employee's Rate + Employer's Rate) x (Total Gross Emoluments)",
  "NHT\n\n(Employee's Rate + Employer's Rate) x (Total Gross Emoluments)",
  "Education Tax\n\n(Employee's Rate + Employer's Rate) x (Total Gross Emoluments after Deductions and NIS)",
  "PAYE Income Tax / (Refunds)\n\n(Rate) x (Total Gross\nEmoluments after\nDeductions, NIS and\nNil-Rate (NR))."
];

var s01State = null;   // var, so tests can read it

const s01Num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const s01R = (value) => Math.round(s01Num(value) * 100) / 100;
const s01El = (id) => document.getElementById(id);
const s01Weeks = () => { try { return localStorage.getItem(`kairoxS01Weeks:${CP_WORKSPACE}`) || ""; } catch (error) { return ""; } };

/* ---------- pure helpers (no page needed) ---------- */
// "Keturah-Leah Paisely" gives surname Paisely and first name Keturah-Leah; a middle name gives its first letter. Always editable.
function s01SplitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);

  if (!parts.length) return { surname: "", first: "", mi: "" };
  if (parts.length === 1) return { surname: parts[0], first: "", mi: "" };

  return { surname: parts[parts.length - 1], first: parts[0], mi: parts.length > 2 ? parts[1].charAt(0).toUpperCase() : "" };
}

// TAJ's example is 101-222-333: a nine-digit number is shown in that layout; anything else is left as it was typed.
function s01Trn(value) {
  const text = String(value || "").trim();
  const digits = text.replace(/\D/g, "");
  return digits.length === 9 && /^[\d\s-]+$/.test(text) ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : text;
}

// Merges payslip lines (from every payroll in the month) into one row per employee.
function s01Aggregate(items, employees) {
  const emp = new Map((employees || []).map((e) => [e.id, e]));
  const byKey = new Map();

  (items || []).forEach((item) => {
    const key = item.employee_id || `name:${item.employee_name}`;
    const e = emp.get(item.employee_id) || {};
    const er = item.employer_contributions || {};
    const row = byKey.get(key) || {
      key, employee_id: item.employee_id || null,
      name: e.name || item.employee_name || "",
      trn: String(e.trn || (item.inputs && item.inputs.trn) || "").trim(),
      nis_number: String(e.nis_number || "").trim(),
      cash: 0, kind: 0, pension: 0, nis: 0, nht: 0, edTax: 0, paye: 0, heart: 0, payslips: 0
    };

    row.cash += s01Num(item.gross_pay);
    row.pension += s01Num(item.pension);
    row.nis += s01Num(item.nis) + s01Num(er.nis);
    row.nht += s01Num(item.nht) + s01Num(er.nht);
    row.edTax += s01Num(item.education_tax) + s01Num(er.edTax);
    row.paye += s01Num(item.paye);
    row.heart += s01Num(er.heart);
    row.payslips += 1;
    byKey.set(key, row);
  });

  return [...byKey.values()]
    .map((r) => {
      const n = s01SplitName(r.name);
      return {
        ...r, ...Object.fromEntries(["cash", "kind", "pension", "nis", "nht", "edTax", "paye", "heart"].map((k) => [k, s01R(r[k])])),
        surname: n.surname, first: n.first, mi: n.mi, nis_saved: r.nis_number, weeks: null
      };
    })
    .sort((a, b) => a.surname.localeCompare(b.surname) || a.first.localeCompare(b.first));
}

// The figures for lines 10 to 19 of the S01 form itself.
function s01Figures(rows, trainees) {
  const sum = (k) => s01R(rows.reduce((t, r) => t + s01Num(r[k]), 0));
  const heart = sum("heart"), nis = sum("nis"), nht = sum("nht"), paye = sum("paye"), edTax = sum("edTax");

  return {
    persons: rows.length,
    contributors: rows.filter((r) => r.nis > 0 || r.nht > 0).length,
    trainees: Math.max(0, Math.floor(s01Num(trainees))),
    gross: s01R(sum("cash") + sum("kind")),
    heart, nis, nht, paye, edTax,
    total: s01R(heart + nis + nht + paye + edTax)
  };
}

const s01RowWeeks = (row, all) => (row.weeks !== null && row.weeks !== undefined ? row.weeks : all);

// The rows of TAJ's template, header first. TRN and NIS are text; amounts are numbers; a blank stays blank.
function s01Sheet(rows, all) {
  return [S01_HEADERS].concat(rows.map((r) => {
    const weeks = String(s01RowWeeks(r, all)).trim();
    return [r.surname, r.first, r.mi, s01Trn(r.trn), String(r.nis_number || "").trim().toUpperCase(),
      r.cash, r.kind, r.pension, weeks !== "" && Number.isFinite(Number(weeks)) ? Number(weeks) : "", r.nis, r.nht, r.edTax, r.paye];
  }));
}

function s01WorkbookBytes(rows, all) {
  const sheet = XLSX.utils.aoa_to_sheet(s01Sheet(rows, all));
  sheet["!cols"] = [15, 15, 9, 15, 13, 24, 24, 26, 22, 22, 22, 24, 24].map((wch) => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, S01_SHEET);
  return XLSX.write(book, { bookType: "biff8", type: "array" });
}

function s01CsvText(rows, all) {
  const head = S01_HEADERS.map((h) => String(h).replace(/\s*\n+\s*/g, " ").trim());
  return [head].concat(s01Sheet(rows, all).slice(1)).map((r) => r.map(cpCsvCell).join(",")).join("\n");
}

// Hands a file to the browser. Kept in one place so the page can be tested without downloading anything.
function s01Save(name, blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/* ---------- the dialog ---------- */
function s01Close() {
  s01El("s01Dialog").hidden = true;
  s01El("s01Box").innerHTML = "";
  s01State = null;
}

function s01CompanyName() {
  try { return window.KairoxCompany.companyName() || CP_WORKSPACE; } catch (error) { return CP_WORKSPACE; }
}

async function s01Open(key) {
  const month = cpMonths().find((m) => m.key === key);
  if (!month) return;

  const runs = cpRuns.filter((r) => String(r.pay_date || r.period_end).slice(0, 7) === key);
  const [itemsResult, empResult] = await Promise.all([
    supabaseClient.from("payroll_run_items").select("*").in("payroll_run_id", runs.map((r) => r.id)),
    supabaseClient.from("employees").select("id, name, trn, nis_number").eq("workspace", CP_WORKSPACE)
  ]);

  let employees = empResult.data;
  let hasNis = !empResult.error;

  if (empResult.error) {
    // the NIS column does not exist yet (phase15-nis-numbers.sql has not been run): carry on without it
    const retry = await supabaseClient.from("employees").select("id, name, trn").eq("workspace", CP_WORKSPACE);
    employees = retry.data;
  }

  if (itemsResult.error) {
    cpBanner("The payslip lines for that month could not be loaded. Please refresh and try again.");
    return;
  }

  s01State = { key, label: cpMonthLabel(key), month, rows: s01Aggregate(itemsResult.data, employees || []), all: s01Weeks(), trainees: 0, hasNis, runs: runs.length };
  s01Render();
}

function s01Render() {
  const s = s01State;
  const input = (cls, i, field, value, extra = "") =>
    `<input class="s01in ${cls}" data-i="${i}" data-field="${field}" value="${cpEsc(value)}" ${extra} style="width:100%;min-width:60px;padding:5px 7px;border:1px solid #c9cad6;border-radius:6px;font:inherit;font-size:13px">`;

  const body = s.rows.map((r, i) => `<tr>
      <td>${input("", i, "surname", r.surname, 'aria-label="Surname"')}</td>
      <td>${input("", i, "first", r.first, 'aria-label="First name"')}</td>
      <td style="width:54px">${input("", i, "mi", r.mi, 'maxlength="3" aria-label="Middle initial"')}</td>
      <td class="num">${cpEsc(s01Trn(r.trn)) || '<span class="muted">missing</span>'}</td>
      <td>${input("", i, "nis_number", r.nis_number, 'placeholder="Z123456" aria-label="NIS number"')}</td>
      <td class="num">${cpMoney(r.cash)}</td>
      <td class="num">${cpMoney(r.pension)}</td>
      <td style="width:70px">${input("", i, "weeks", s01RowWeeks(r, s.all), 'inputmode="numeric" aria-label="Weekly contributions"')}</td>
      <td class="num">${cpMoney(r.nis)}</td><td class="num">${cpMoney(r.nht)}</td><td class="num">${cpMoney(r.edTax)}</td><td class="num">${cpMoney(r.paye)}</td>
    </tr>`).join("");

  s01El("s01Box").innerHTML = `
    <h3 id="s01Title">S01 schedule for ${cpEsc(s.label)}</h3>
    <p>${s.runs} ${s.runs === 1 ? "payroll" : "payrolls"} paid in ${cpEsc(s.label)}, merged into one line per employee. The file matches TAJ's S01 Schedule A template, so you can upload it, or paste its rows into TAJ's own template.</p>
    <div id="s01Warnings"></div>
    <div class="form-grid" style="margin-bottom:12px">
      <div class="field"><label for="s01All">Weekly NIS and NHT contributions for the month (column g)</label>
        <input id="s01All" inputmode="numeric" value="${cpEsc(s.all)}" placeholder="for example 4">
        <small>Used for everyone unless you change a row. Ask the NIS office, TAJ or your accountant which number to use for monthly-paid staff. It is remembered for next time.</small></div>
    </div>
    <div class="table-wrap"><table class="data" id="s01Table">
      <thead><tr><th>Surname</th><th>First name</th><th>MI</th><th>TRN</th><th>NIS number</th><th class="num">Gross (cash)</th><th class="num">Pension</th><th>Weeks</th><th class="num">NIS</th><th class="num">NHT</th><th class="num">Education Tax</th><th class="num">PAYE</th></tr></thead>
      <tbody>${body || '<tr class="empty-row"><td colspan="12">No payslips found for this month.</td></tr>'}</tbody>
      <tfoot id="s01Totals"></tfoot>
    </table></div>
    <p class="muted small" style="margin:6px 0 14px">NIS, NHT and Education Tax are the employee's and employer's shares added together, as TAJ's columns ask. Benefits in kind are left at 0: Kairox Pay does not record them.</p>
    <h4 style="margin:0 0 6px">Figures for the S01 form itself</h4>
    <div id="s01Figures" style="margin-bottom:12px"></div>
    <div id="s01Msg" class="form-message" role="status"></div>
    <div class="dialog-actions" style="flex-wrap:wrap">
      <button type="button" class="btn" data-s01act="close">Close</button>
      ${s.hasNis && cpCanRecord() ? '<button type="button" class="btn" data-s01act="savenis">Save NIS numbers</button>' : ""}
      <button type="button" class="btn" data-s01act="csv">Download CSV</button>
      <button type="button" class="btn primary" data-s01act="xls">Download for TAJ (.xls)</button>
    </div>`;

  s01El("s01Dialog").hidden = false;
  s01Refresh();
}

function s01Msg(text, kind) {
  const box = s01El("s01Msg");
  if (!box) return;
  box.textContent = text || "";
  box.className = `form-message ${kind || ""}`.trim();
}

// Recomputes the totals, the form figures and the warnings (the fields are left alone, so typing is never interrupted).
function s01Refresh() {
  const s = s01State;
  if (!s) return;

  const f = s01Figures(s.rows, s.trainees);
  s01El("s01Totals").innerHTML = `<tr><th colspan="5">Totals</th><th class="num">${cpMoney(f.gross)}</th><th class="num">${cpMoney(s.rows.reduce((t, r) => t + r.pension, 0))}</th><th></th><th class="num">${cpMoney(f.nis)}</th><th class="num">${cpMoney(f.nht)}</th><th class="num">${cpMoney(f.edTax)}</th><th class="num">${cpMoney(f.paye)}</th></tr>`;

  const line = (n, label, value, hint = "") => `<tr><td style="width:44px"><strong>${n}</strong></td><td>${cpEsc(label)}${hint ? `<small>${cpEsc(hint)}</small>` : ""}</td><td class="num"><strong>${value}</strong></td></tr>`;
  s01El("s01Figures").innerHTML = `<div class="table-wrap"><table class="data"><tbody>
      ${line(10, "Number of persons employed for the month", f.persons)}
      ${line(11, "Number of NHT and NIS contributors", f.contributors)}
      <tr><td><strong>12</strong></td><td>Number of HEART trainees</td><td class="num"><input id="s01Trainees" inputmode="numeric" value="${cpEsc(s.trainees)}" style="width:70px;padding:5px 7px;border:1px solid #c9cad6;border-radius:6px;font:inherit;text-align:right" aria-label="Number of HEART trainees"></td></tr>
      ${line(13, "Gross emoluments (monthly)", cpMoney(f.gross), "TAJ's rule: leave out anyone under 18 or over 65. Kairox Pay does not know ages, so check this yourself.")}
      ${line(14, "H.E.A.R.T.", cpMoney(f.heart), "Employer only")}
      ${line(15, "NIS (employer's plus employees' contribution)", cpMoney(f.nis))}
      ${line(16, "NHT (employer's plus employees' contribution)", cpMoney(f.nht))}
      ${line(17, "Income tax (P.A.Y.E.)", cpMoney(f.paye))}
      ${line(18, "Education Tax (employer's plus employees' contribution)", cpMoney(f.edTax))}
      ${line(19, "TOTALS (lines 14 to 18)", cpMoney(f.total))}
    </tbody></table></div>`;

  const names = (list) => list.map((r) => `${r.first} ${r.surname}`.trim()).join(", ");
  const warnings = [];
  if (s.month.legacy) warnings.push("An older payroll in this month has no employer shares recorded, so NIS, NHT and Education Tax below are the employees' shares only.");
  if (Math.abs(f.total - s.month.total) > 0.01) warnings.push(`Line 19 here (${cpMoney(f.total)}) differs from the amount to remit on this page (${cpMoney(s.month.total)}). Check before you file.`);
  const noTrn = s.rows.filter((r) => !String(r.trn).trim());
  const noNis = s.rows.filter((r) => !String(r.nis_number).trim());
  const noWeeks = s.rows.filter((r) => String(s01RowWeeks(r, s.all)).trim() === "");
  const oddName = s.rows.filter((r) => r.surname.length < 2 || !r.first);
  if (noTrn.length) warnings.push(`No TRN for: ${names(noTrn)}. Add it on the employee's profile.`);
  if (noNis.length) warnings.push(`No NIS number for: ${names(noNis)}. Type it in the NIS column${s.hasNis ? ", then click Save NIS numbers so it is remembered" : ""}.`);
  if (noWeeks.length) warnings.push("The weekly contributions (column g) are blank. TAJ's template has this column, so fill it in.");
  if (oddName.length) warnings.push(`Check how the name is split for: ${names(oddName)}.`);
  if (!s.hasNis) warnings.push("NIS numbers cannot be remembered yet: run phase15-nis-numbers.sql in Supabase. You can still type them in for this download.");

  s01El("s01Warnings").innerHTML = warnings.length
    ? `<div class="note" style="margin:0 0 12px"><strong>Before you upload:</strong><ul style="margin:6px 0 0;padding-left:20px">${warnings.map((w) => `<li>${cpEsc(w)}</li>`).join("")}</ul></div>`
    : '<div class="note" style="margin:0 0 12px">Everything the schedule needs is filled in.</div>';
}

async function s01SaveNis() {
  const s = s01State;
  const changed = s.rows.filter((r) => r.employee_id && String(r.nis_number).trim().toUpperCase() !== String(r.nis_saved).trim().toUpperCase());

  if (!changed.length) return s01Msg("There are no new NIS numbers to save.", "");

  let failed = 0;

  for (const r of changed) {
    const value = String(r.nis_number).trim().toUpperCase();
    const { error } = await supabaseClient.from("employees").update({ nis_number: value || null }).eq("id", r.employee_id).eq("workspace", CP_WORKSPACE);
    if (error) { failed += 1; console.error("NIS number was not saved:", error); } else { r.nis_number = value; r.nis_saved = value; }
  }

  s01Msg(failed ? `${failed} could not be saved. You may not have permission to edit employees.` : `Saved NIS numbers for ${changed.length} ${changed.length === 1 ? "employee" : "employees"}.`, failed ? "error" : "ok");
  s01Refresh();
}

function s01Download(kind) {
  const s = s01State;
  const stem = `S01_Schedule_A_${s01CompanyName().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}_${s.key}`;

  try { localStorage.setItem(`kairoxS01Weeks:${CP_WORKSPACE}`, String(s.all)); } catch (error) { /* storage can be unavailable */ }

  if (kind === "csv") {
    s01Save(`${stem}.csv`, new Blob(["\ufeff" + s01CsvText(s.rows, s.all)], { type: "text/csv;charset=utf-8;" }));
    return s01Msg("CSV downloaded.", "ok");
  }

  if (typeof XLSX === "undefined") return s01Msg("The Excel file could not be built because the spreadsheet library did not load. Check your internet connection and refresh, or download the CSV.", "error");

  s01Save(`${stem}.xls`, new Blob([s01WorkbookBytes(s.rows, s.all)], { type: "application/vnd.ms-excel" }));
  s01Msg("Downloaded. Upload it on TAJ's S01 declaration page, or paste its rows into TAJ's own template.", "ok");
}

/* ---------- wiring ---------- */
document.addEventListener("click", (event) => {
  const open = event.target.closest && event.target.closest("[data-s01]");
  if (open) return s01Open(open.getAttribute("data-s01"));

  const act = event.target.closest && event.target.closest("[data-s01act]");
  if (act) {
    const name = act.getAttribute("data-s01act");
    if (name === "close") return s01Close();
    if (name === "savenis") return s01SaveNis();
    if (name === "csv" || name === "xls") return s01Download(name);
  }

  if (event.target.id === "s01Dialog") s01Close();
});

document.addEventListener("input", (event) => {
  if (!s01State) return;
  const t = event.target;

  if (t.id === "s01All") { s01State.all = t.value.trim(); s01State.rows.forEach((r, i) => { if (r.weeks === null) { const cell = document.querySelector(`[data-i="${i}"][data-field="weeks"]`); if (cell) cell.value = s01State.all; } }); }
  else if (t.id === "s01Trainees") s01State.trainees = t.value;
  else if (t.dataset && t.dataset.field) {
    const row = s01State.rows[Number(t.dataset.i)];
    if (!row) return;
    if (t.dataset.field === "weeks") row.weeks = t.value.trim();
    else row[t.dataset.field] = t.value;
  } else return;

  s01Refresh();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && s01State) s01Close();
});
