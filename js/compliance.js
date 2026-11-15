// Which company the signed-in person is working in (chosen with the company switcher). Kairox Exchange by default.
function kairoxWorkspaceId() {
  try {
    return localStorage.getItem("kairoxWorkspace") || "kairox-exchange";
  } catch (error) {
    return "kairox-exchange";
  }
}

const CP_WORKSPACE = kairoxWorkspaceId();
const FILING_NAMES = {
  S01: "S01 monthly remittance",
  P24: "P24 certificates of pay and tax deducted",
  S02: "S02 employer's annual return"
};
const TAJ_GUIDE_URL =
  "https://www.jamaicatax.gov.jm/documents/10194/14559577/Employers_guide_13122019.pdf/9d09b82e-e215-6aaa-72c8-7b8a3dd7f061";

let cpRole = null;
let cpRuns = [];
let cpFilings = [];
let cpDialog = null;
let cpSummaryYear = null;
let cpSummary = { rows: [], totals: null, payrolls: 0 };

const cpEsc = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const cpNum = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const cpRound = (value) => Math.round(cpNum(value) * 100) / 100;

function cpMoney(value) {
  return `JMD ${cpNum(value).toLocaleString("en-JM", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function cpToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function cpIso(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function cpParse(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function cpLong(date) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
}

function cpMonthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
}

function cpAvoidWeekend(date) {
  if (date.getDay() === 6) date.setDate(date.getDate() + 2);
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return date;
}

// S01 for the payroll paid in month M is due by the 14th of the following month.
function cpS01Due(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return cpAvoidWeekend(new Date(y, m, 14));
}

// S02 is due by 31 March of the year after the tax year (TAJ Employers' Guide).
// TAJ gives no fixed date for P24: employers must give each employee one "at the end of each year".
// 31 January is our TARGET so employees have it in time to file their own returns by 15 March.
function cpAnnualDue(type, year) {
  return cpAvoidWeekend(type === "P24" ? new Date(year + 1, 0, 31) : new Date(year + 1, 2, 31));
}

// A target is a reminder, not a legal deadline, so missing it is "past target", never "overdue".
function cpIsSoft(type) {
  return type === "P24";
}

function cpDaysUntil(date) {
  return Math.round((date - cpToday()) / 86400000);
}

function cpWhen(days) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

function cpCanRecord() {
  return cpRole === "admin" || cpRole === "director" || cpRole === "payroll";
}

function cpFiling(type, key) {
  return cpFilings.find((f) => f.filing_type === type && f.period_key === key) || null;
}

function cpStatus(record, due, soft = false) {
  if (record) {
    return { text: `${soft ? "Done" : "Filed"} ${cpLong(cpParse(record.filed_on))}`, css: "ok", filed: true };
  }

  const days = cpDaysUntil(due);

  if (days < 0 && soft) return { text: "Past target date", css: "warn", overdue: false };
  if (days < 0) return { text: "Overdue", css: "late", overdue: true };
  if (days <= 7) return { text: "Due soon", css: "warn" };
  return { text: "Not due yet", css: "info" };
}

function cpMonths() {
  const months = {};

  cpRuns.forEach((run) => {
    const key = String(run.pay_date || run.period_end).slice(0, 7);
    const m = (months[key] = months[key] || { key, runs: 0, employee: 0, employer: 0, legacy: false });
    const employer = run.employer_totals || {};

    const employeeShare = cpNum(run.total_paye) + cpNum(run.total_nis) + cpNum(run.total_nht) + cpNum(run.total_education_tax);
    const employerShare = cpNum(employer.nis) + cpNum(employer.nht) + cpNum(employer.edTax) + cpNum(employer.heart);

    m.runs += 1;
    m.employee += employeeShare;
    m.employer += employerShare;

    // Employer NIS and NHT are never zero on a real payroll, so none recorded means the older payroll lacks them.
    if (Object.keys(employer).length === 0 || (employerShare === 0 && employeeShare > 0)) m.legacy = true;
  });

  return Object.values(months)
    .map((m) => ({ ...m, employee: cpRound(m.employee), employer: cpRound(m.employer), total: cpRound(m.employee + m.employer) }))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
}

function cpYears() {
  return [...new Set(cpRuns.map((run) => Number(String(run.pay_date || run.period_end).slice(0, 4))))]
    .filter((year) => year <= cpToday().getFullYear())
    .sort((a, b) => b - a);
}

function cpActions(type, key, context) {
  if (!cpCanRecord()) return "";

  const data = `data-type="${type}" data-key="${cpEsc(key)}"`;
  const record = cpFiling(type, key);

  if (!record) {
    return `<button type="button" class="btn small primary" data-record ${data}>${type === "P24" ? "Mark as given out" : "Mark as filed"}</button>`;
  }

  return (
    `<div class="row-actions"><button type="button" class="btn small" data-record ${data}>Edit</button>` +
    (cpRole === "admin" || cpRole === "director" ? `<button type="button" class="btn small danger" data-remove="${cpEsc(record.id)}">Remove</button>` : "") +
    "</div>"
  );
}

function cpContext(type, key) {
  if (type === "S01") {
    const month = cpMonths().find((m) => m.key === key);
    return { due: cpS01Due(key), amount: month ? month.total : 0, label: cpMonthLabel(key) };
  }

  return { due: cpAnnualDue(type, Number(key)), amount: 0, label: `Tax year ${key}` };
}

function cpRenderS01() {
  const body = document.getElementById("s01Body");
  const months = cpMonths();

  if (!months.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="8">No payrolls have been processed yet. Each month with a processed payroll appears here.</td></tr>';
    return;
  }

  body.innerHTML = months
    .map((m) => {
      const due = cpS01Due(m.key);
      const record = cpFiling("S01", m.key);
      const status = cpStatus(record, due);
      const differs = record && Math.abs(cpNum(record.amount_paid) - m.total) > 0.005;

      return `
        <tr>
          <td><strong>${cpEsc(cpMonthLabel(m.key))}</strong>${m.legacy ? "<small>Employer shares were not recorded for an older payroll</small>" : ""}</td>
          <td class="num">${m.runs}</td>
          <td class="num">${cpMoney(m.employee)}</td>
          <td class="num">${cpMoney(m.employer)}</td>
          <td class="num"><strong>${cpMoney(m.total)}</strong>${differs ? `<small>Paid ${cpMoney(record.amount_paid)}</small>` : ""}</td>
          <td>${cpEsc(cpLong(due))}</td>
          <td><span class="badge ${status.css}">${cpEsc(status.text)}</span></td>
          <td><div class="row-actions"><button type="button" class="btn small" data-s01="${cpEsc(m.key)}">Schedule</button>${cpActions("S01", m.key)}</div></td>
        </tr>`;
    })
    .join("");
}

function cpRenderAnnual() {
  const body = document.getElementById("annualBody");
  const years = cpYears();

  if (!years.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="5">Annual filings appear here for each year you process payroll.</td></tr>';
    return;
  }

  body.innerHTML = years
    .flatMap((year) => ["S02", "P24"].map((type) => ({ year, type })))
    .map(({ year, type }) => {
      const soft = cpIsSoft(type);
      const due = cpAnnualDue(type, year);
      const status = cpStatus(cpFiling(type, String(year)), due, soft);

      return `
        <tr>
          <td><strong>${cpEsc(FILING_NAMES[type])}</strong>${
            soft ? "<small>Give each employee their certificate after the year ends</small>" : "<small>Filed online with TAJ</small>"
          }</td>
          <td>${year}</td>
          <td>${soft ? "Target: " : ""}${cpEsc(cpLong(due))}</td>
          <td><span class="badge ${status.css}">${cpEsc(status.text)}</span></td>
          <td><div class="row-actions">${type === "S02" ? `<button type="button" class="btn small" data-s02="${year}">Prepare return</button>` : ""}${cpActions(type, String(year))}</div></td>
        </tr>`;
    })
    .join("");
}

function cpUpcoming() {
  const today = cpToday();
  const items = [];
  const months = cpMonths();
  const keys = new Set(months.map((m) => m.key));

  [-1, 0].forEach((offset) => {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    keys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  });

  keys.forEach((key) => {
    const due = cpS01Due(key);
    if (cpFiling("S01", key) || cpDaysUntil(due) < 0) return;
    const month = months.find((m) => m.key === key);

    items.push({ title: `S01 for ${cpMonthLabel(key)}`, due, amount: month ? month.total : null });
  });

  const years = new Set(cpYears());
  years.add(today.getFullYear() - 1);

  [...years].forEach((year) => {
    if (!cpRuns.some((r) => String(r.pay_date || r.period_end).startsWith(String(year)))) return;

    ["P24", "S02"].forEach((type) => {
      const due = cpAnnualDue(type, year);
      if (cpFiling(type, String(year)) || cpDaysUntil(due) < 0 || cpDaysUntil(due) > 400) return;

      items.push({
        title: `${FILING_NAMES[type]}, tax year ${year}${cpIsSoft(type) ? " (target)" : ""}`,
        due,
        amount: null
      });
    });
  });

  return items.sort((a, b) => a.due - b.due).slice(0, 6);
}

function cpOverdue() {
  const list = [];

  cpMonths().forEach((m) => {
    if (!cpFiling("S01", m.key) && cpDaysUntil(cpS01Due(m.key)) < 0) list.push(`S01 for ${cpMonthLabel(m.key)}`);
  });

  cpYears().forEach((year) => {
    if (!cpFiling("S02", String(year)) && cpDaysUntil(cpAnnualDue("S02", year)) < 0) list.push(`S02 for ${year}`);
  });

  return list;
}

function cpPastTarget() {
  return cpYears().filter((year) => !cpFiling("P24", String(year)) && cpDaysUntil(cpAnnualDue("P24", year)) < 0);
}

function cpRenderStats() {
  const setText = (id, value) => { document.getElementById(id).textContent = value; };
  const card = (id, css) => { document.getElementById(id).className = `stat-card ${css || ""}`.trim(); };
  const upcoming = cpUpcoming();
  const overdue = cpOverdue();

  if (upcoming.length) {
    const first = upcoming[0];
    setText("statNextTitle", cpLong(first.due));
    setText("statNextDetail", `${first.title}, ${cpWhen(cpDaysUntil(first.due))}`);
    card("statNext", cpDaysUntil(first.due) <= 7 ? "warn" : "");
  } else {
    setText("statNextTitle", "Nothing due");
    setText("statNextDetail", "No unfiled deadlines coming up");
    card("statNext", "ok");
  }

  const unfiled = cpMonths()
    .filter((m) => !cpFiling("S01", m.key))
    .sort((a, b) => (cpS01Due(a.key) < cpS01Due(b.key) ? -1 : 1))[0];

  if (unfiled) {
    setText("statRemitAmount", cpMoney(unfiled.total));
    setText("statRemitDetail", `S01 for ${cpMonthLabel(unfiled.key)}, due ${cpLong(cpS01Due(unfiled.key))}`);
    card("statRemit", cpDaysUntil(cpS01Due(unfiled.key)) < 0 ? "late" : "");
  } else {
    setText("statRemitAmount", cpMoney(0));
    setText("statRemitDetail", "Every processed month has been recorded as filed");
    card("statRemit", "ok");
  }

  setText("statOverdueCount", String(overdue.length));
  const late24 = cpPastTarget();
  setText(
    "statOverdueDetail",
    overdue.length
      ? overdue.slice(0, 2).join(", ") + (overdue.length > 2 ? "…" : "")
      : late24.length
        ? `Nothing overdue. P24 for ${late24.join(", ")} is past its target date`
        : "Nothing is overdue"
  );
  card("statOverdue", overdue.length ? "late" : "ok");

  const year = String(cpToday().getFullYear());
  setText("statFiledCount", String(cpFilings.filter((f) => String(f.filed_on).startsWith(year)).length));
}

function cpRenderUpcoming() {
  const body = document.getElementById("upcomingBody");
  const items = cpUpcoming();

  body.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <tr>
              <td><strong>${cpEsc(item.title)}</strong></td>
              <td>${cpEsc(cpLong(item.due))}</td>
              <td>${cpEsc(cpWhen(cpDaysUntil(item.due)))}</td>
              <td class="num">${item.amount === null ? "Known once processed" : cpMoney(item.amount)}</td>
            </tr>`
        )
        .join("")
    : '<tr class="empty-row"><td colspan="4">Nothing is coming up. Every recorded deadline is filed.</td></tr>';
}

function cpRenderHistory() {
  const body = document.getElementById("historyBody");
  const rows = [...cpFilings].sort((a, b) => (a.filed_on < b.filed_on ? 1 : -1));

  body.innerHTML = rows.length
    ? rows
        .map(
          (f) => `
            <tr>
              <td><strong>${cpEsc(FILING_NAMES[f.filing_type] || f.filing_type)}</strong></td>
              <td>${cpEsc(f.filing_type === "S01" ? cpMonthLabel(f.period_key) : `Tax year ${f.period_key}`)}</td>
              <td>${f.due_date ? cpEsc(cpLong(cpParse(f.due_date))) : "—"}</td>
              <td>${cpEsc(cpLong(cpParse(f.filed_on)))}</td>
              <td class="num">${f.filing_type === "S01" ? cpMoney(f.amount_paid) : "—"}</td>
              <td>${cpEsc(f.reference || "—")}${f.notes ? `<small>${cpEsc(f.notes)}</small>` : ""}</td>
              <td>${cpEsc(f.recorded_by)}</td>
            </tr>`
        )
        .join("")
    : '<tr class="empty-row"><td colspan="7">Nothing has been recorded yet. Use "Mark as filed" above after you file with TAJ.</td></tr>';
}

function cpRenderAll() {
  cpRenderStats();
  cpRenderS01();
  cpRenderAnnual();
  cpRenderUpcoming();
  cpRenderHistory();
}


/* ---------- annual summary per employee (the data behind P24 certificates and the S02 return) ---------- */
async function cpLoadSummary() {
  const select = document.getElementById("summaryYear");
  const years = cpYears();
  const thisYear = cpToday().getFullYear();

  select.innerHTML = years.map((y) => `<option value="${y}">${y}${y === thisYear ? " (so far)" : ""}</option>`).join("");

  if (!years.length) {
    cpSummary = { rows: [], totals: null, payrolls: 0 };
    return cpRenderSummary();
  }

  if (!years.includes(Number(cpSummaryYear))) cpSummaryYear = years[0];
  select.value = String(cpSummaryYear);

  const runs = cpRuns.filter((r) => String(r.pay_date || r.period_end).startsWith(String(cpSummaryYear)));
  const { data, error } = await supabaseClient
    .from("payroll_run_items")
    .select("*")
    .in("payroll_run_id", runs.map((r) => r.id));

  if (error) {
    console.error("Could not load the annual summary:", error);
    document.getElementById("summaryBody").innerHTML = '<tr class="empty-row"><td colspan="10">The summary could not be loaded.</td></tr>';
    return;
  }

  const people = {};

  (data || []).forEach((item) => {
    const key = item.employee_id || item.employee_name;
    const p = (people[key] = people[key] || {
      name: item.employee_name, trn: "", gross: 0, paye: 0, nis: 0, nht: 0, edTax: 0, erNis: 0, erNht: 0, erEdTax: 0, erHeart: 0
    });
    const er = item.employer_contributions || {};

    p.name = item.employee_name || p.name;
    p.trn = (item.inputs && item.inputs.trn) || p.trn;
    p.gross += cpNum(item.gross_pay);
    p.paye += cpNum(item.paye);
    p.nis += cpNum(item.nis);
    p.nht += cpNum(item.nht);
    p.edTax += cpNum(item.education_tax);
    p.erNis += cpNum(er.nis);
    p.erNht += cpNum(er.nht);
    p.erEdTax += cpNum(er.edTax);
    p.erHeart += cpNum(er.heart);
  });

  const rows = Object.values(people)
    .map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "number" ? cpRound(v) : v])))
    .sort((a, b) => a.name.localeCompare(b.name));

  const totals = {};
  ["gross", "paye", "nis", "nht", "edTax", "erNis", "erNht", "erEdTax", "erHeart"].forEach((k) => {
    totals[k] = cpRound(rows.reduce((t, r) => t + r[k], 0));
  });

  cpSummary = { rows, totals, payrolls: runs.length };
  cpRenderSummary();
}

function cpRenderSummary() {
  const body = document.getElementById("summaryBody");
  const note = document.getElementById("summaryNote");
  const { rows, totals, payrolls } = cpSummary;

  if (!rows.length) {
    note.textContent = "";
    body.innerHTML = '<tr class="empty-row"><td colspan="10">No processed payrolls yet, so there is nothing to total.</td></tr>';
    return;
  }

  note.textContent = `${rows.length} employee${rows.length === 1 ? "" : "s"} across ${payrolls} processed payroll${payrolls === 1 ? "" : "s"} paid in ${cpSummaryYear}.`;

  const cells = (r) =>
    ["gross", "paye", "nis", "nht", "edTax", "erNis", "erNht", "erEdTax", "erHeart"]
      .map((k) => `<td class="num">${cpMoney(r[k])}</td>`)
      .join("");

  body.innerHTML =
    rows
      .map((r) => `<tr><td><strong>${cpEsc(r.name)}</strong><small>${r.trn ? "TRN " + cpEsc(r.trn) : "No TRN on record"}</small></td>${cells(r)}</tr>`)
      .join("") +
    `<tr style="background:#f8f5ff;font-weight:800"><td>Total</td>${cells(totals)}</tr>`;
}

function cpExportSummary() {
  if (!cpSummary.rows.length) return;

  const rows = [[
    "Employee", "TRN", "Gross pay", "PAYE (income tax)", "NIS (employee)", "NHT (employee)", "Education Tax (employee)",
    "NIS (employer)", "NHT (employer)", "Education Tax (employer)", "HEART (employer)"
  ]];

  const line = (name, trn, r) => [name, trn, ...["gross", "paye", "nis", "nht", "edTax", "erNis", "erNht", "erEdTax", "erHeart"].map((k) => r[k].toFixed(2))];

  cpSummary.rows.forEach((r) => rows.push(line(r.name, r.trn, r)));
  rows.push(line("TOTAL", "", cpSummary.totals));

  const blob = new Blob([rows.map((r) => r.map(cpCsvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Kairox_Pay_Annual_Summary_${cpSummaryYear}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ---------- record a filing ---------- */
function cpOpenDialog(type, key) {
  const context = cpContext(type, key);
  const existing = cpFiling(type, key);

  cpDialog = { type, key, due: context.due, amountDue: context.amount };

  document.getElementById("filingTitle").textContent = existing ? "Edit filing record" : "Record filing";
  document.getElementById("filingSubtitle").textContent =
    `${FILING_NAMES[type]} · ${context.label} · ${cpIsSoft(type) ? "target" : "due"} ${cpLong(context.due)}`;

  const dateInput = document.getElementById("filingDate");
  dateInput.max = cpIso(cpToday());
  dateInput.value = existing ? existing.filed_on : cpIso(cpToday());

  const amountField = document.getElementById("amountField");
  amountField.hidden = type !== "S01";
  document.getElementById("filingPaid").value = existing ? cpNum(existing.amount_paid) : context.amount;
  document.getElementById("amountHint").textContent = type === "S01" ? `Amount due: ${cpMoney(context.amount)}` : "";
  document.getElementById("dateLabel").textContent = type === "P24" ? "Date certificates were given out" : "Date filed";
  document.getElementById("filingRef").value = existing ? existing.reference || "" : "";
  document.getElementById("filingNotes").value = existing ? existing.notes || "" : "";
  document.getElementById("filingMessage").textContent = "";
  document.getElementById("filingMessage").className = "form-message";

  document.getElementById("filingDialog").hidden = false;
  dateInput.focus();
}

function cpCloseDialog() {
  document.getElementById("filingDialog").hidden = true;
  cpDialog = null;
}

function cpFormError(text) {
  const box = document.getElementById("filingMessage");
  box.textContent = text;
  box.className = "form-message error";
}

async function cpSaveFiling(event) {
  event.preventDefault();

  if (!cpDialog) return;

  const filedOn = document.getElementById("filingDate").value;
  const isS01 = cpDialog.type === "S01";
  const paid = isS01 ? cpRound(document.getElementById("filingPaid").value) : 0;
  const reference = document.getElementById("filingRef").value.trim();
  const notes = document.getElementById("filingNotes").value.trim();

  if (!filedOn) return cpFormError("Please enter the date.");
  if (filedOn > cpIso(cpToday())) return cpFormError("The date cannot be in the future.");
  if (isS01 && !(paid >= 0)) return cpFormError("The amount paid cannot be negative.");
  if (reference.length > 100) return cpFormError("The reference is too long (100 characters at most).");
  if (notes.length > 500) return cpFormError("The notes are too long (500 characters at most).");

  if (isS01 && Math.abs(paid - cpDialog.amountDue) > 0.005 && !notes) {
    return cpFormError(
      `The amount paid (${cpMoney(paid)}) differs from the amount due (${cpMoney(cpDialog.amountDue)}). Please add a note to explain why.`
    );
  }

  const button = document.getElementById("filingSave");
  button.disabled = true;

  const { error } = await supabaseClient.rpc("save_filing_record", {
    p_workspace: CP_WORKSPACE,
    p_type: cpDialog.type,
    p_period_key: cpDialog.key,
    p_due_date: cpIso(cpDialog.due),
    p_amount_due: cpDialog.amountDue,
    p_amount_paid: paid,
    p_filed_on: filedOn,
    p_reference: reference,
    p_notes: notes
  });

  button.disabled = false;

  if (error) {
    console.error("Filing was not saved:", error);
    return cpFormError("It was not saved. " + (error.message || ""));
  }

  cpCloseDialog();
  await cpLoad();
}

async function cpRemoveFiling(id) {
  if (!window.confirm("Remove this filing record? The deadline will show as not filed again. The removal is kept in the audit trail.")) {
    return;
  }

  const { error } = await supabaseClient.rpc("delete_filing_record", { p_id: id });

  if (error) {
    cpBanner("The record was not removed. " + (error.message || ""));
    return;
  }

  await cpLoad();
}

/* ---------- export ---------- */
function cpCsvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

function cpExport() {
  const rows = [["Filing", "Period", "Due date", "Filed on", "Amount due", "Amount paid", "Reference", "Notes", "Recorded by"]];

  [...cpFilings]
    .sort((a, b) => (a.filed_on < b.filed_on ? 1 : -1))
    .forEach((f) =>
      rows.push([
        FILING_NAMES[f.filing_type] || f.filing_type, f.period_key, f.due_date || "", f.filed_on,
        cpNum(f.amount_due).toFixed(2), cpNum(f.amount_paid).toFixed(2), f.reference || "", f.notes || "", f.recorded_by
      ])
    );

  const blob = new Blob([rows.map((r) => r.map(cpCsvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "Kairox_Pay_Filing_History.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ---------- loading ---------- */
function cpBanner(html) {
  const banner = document.getElementById("pageBanner");
  banner.innerHTML = html;
  banner.hidden = !html;
}

async function cpAccess() {
  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData || !sessionData.session) {
    cpBanner('You are not signed in. <a href="login.html?next=compliance.html">Sign in</a> to continue.');
    return false;
  }

  const { data: role, error } = await supabaseClient.rpc("get_my_role", { p_workspace: kairoxWorkspaceId() });

  if (error) {
    cpBanner("The payroll security update has not been applied yet. Run the Phase 2 and Phase 4 database updates in Supabase, then refresh.");
    return false;
  }

  if (!role) {
    cpBanner("Your account does not have a payroll role yet. Ask an admin to give you access.");
    return false;
  }

  cpRole = role;
  cpBanner("");
  return true;
}

async function cpLoad() {
  const [runs, filings] = await Promise.all([
    supabaseClient.from("payroll_runs").select("*").eq("workspace", CP_WORKSPACE).eq("status", "processed"),
    supabaseClient.from("filing_records").select("*").eq("workspace", CP_WORKSPACE)
  ]);

  if (runs.error) console.error("Could not load payrolls:", runs.error);

  if (filings.error) {
    console.error("Could not load filing records:", filings.error);
    cpBanner("Filing records are not available yet. Run phase4-migration.sql in Supabase, then refresh.");
  }

  cpRuns = runs.data || [];
  cpFilings = filings.data || [];
  cpRenderAll();
  await cpLoadSummary();
}

async function cpStart() {
  document.getElementById("exportFilings").addEventListener("click", cpExport);
  document.getElementById("exportSummary").addEventListener("click", cpExportSummary);
  document.getElementById("summaryYear").addEventListener("change", (event) => {
    cpSummaryYear = Number(event.target.value);
    cpLoadSummary();
  });
  document.getElementById("filingForm").addEventListener("submit", cpSaveFiling);
  document.getElementById("filingCancel").addEventListener("click", cpCloseDialog);

  document.getElementById("filingDialog").addEventListener("click", (event) => {
    if (event.target.id === "filingDialog") cpCloseDialog();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && cpDialog) cpCloseDialog();
  });

  document.addEventListener("click", (event) => {
    const record = event.target.closest && event.target.closest("[data-record]");
    if (record) return cpOpenDialog(record.getAttribute("data-type"), record.getAttribute("data-key"));

    const remove = event.target.closest && event.target.closest("[data-remove]");
    if (remove) cpRemoveFiling(remove.getAttribute("data-remove"));
  });

  if (!(await cpAccess())) {
    ["s01Body", "annualBody", "upcomingBody", "historyBody"].forEach((id) => {
      document.getElementById(id).innerHTML = '<tr class="empty-row"><td colspan="8">Sign in with a payroll role to see this.</td></tr>';
    });
    ["statNextTitle", "statRemitAmount", "statOverdueCount", "statFiledCount"].forEach((id) => { document.getElementById(id).textContent = "—"; });
    ["statNextDetail", "statRemitDetail", "statOverdueDetail"].forEach((id) => { document.getElementById(id).textContent = "Sign in to see this"; });
    return;
  }

  await cpLoad();
}

cpStart();