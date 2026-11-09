// Which company the signed-in person is working in (chosen with the company switcher). Kairox Exchange by default.
function kairoxWorkspaceId() {
  try {
    return localStorage.getItem("kairoxWorkspace") || "kairox-exchange";
  } catch (error) {
    return "kairox-exchange";
  }
}

const LD_WORKSPACE = kairoxWorkspaceId();
const LD_REASONS = {
  resignation: "Resignation", dismissal: "Dismissal", redundancy: "Redundancy", end_of_contract: "End of contract",
  retirement: "Retirement", death: "Death", other: "Other"
};

let ldRole = null;
let ldEmployees = [];
let ldDepartures = [];

const ldEl = (id) => document.getElementById(id);
const ldEsc = (value = "") =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function ldToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function ldIso(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function ldParse(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
function ldFmt(iso) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(ldParse(iso));
}
function ldMoney(value) {
  return `J$${Number(value || 0).toLocaleString("en-JM", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const ldDaysFrom = (iso) => Math.round((ldParse(iso) - ldToday()) / 86400000);
const ldCanRecord = () => ldRole === "admin" || ldRole === "director" || ldRole === "payroll";
const ldIsAdmin = () => ldRole === "admin" || ldRole === "director";   // marking someone as left, and undoing a departure
const ldEmp = (id) => ldEmployees.find((e) => e.id === id);

function ldBanner(html) {
  const banner = ldEl("pageBanner");
  banner.innerHTML = html;
  banner.hidden = !html;
}
function ldMessage(text, kind) {
  const box = ldEl("leaverMessage");
  box.textContent = text || "";
  box.className = `form-message ${kind || ""}`.trim();
}

async function ldAccess() {
  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData || !sessionData.session) {
    ldBanner('You are not signed in. <a href="login.html?next=leavers.html">Sign in</a> to continue.');
    return false;
  }

  const { data: role, error } = await supabaseClient.rpc("get_my_role", { p_workspace: kairoxWorkspaceId() });

  if (error) {
    ldBanner("The payroll security update has not been applied yet. Run the database updates in Supabase, then refresh.");
    return false;
  }
  if (!role) {
    ldBanner("Your account does not have a payroll role for this company yet. Ask an admin to give you access.");
    return false;
  }

  ldRole = role;
  ldBanner("");
  return true;
}

async function ldLoad() {
  const [emp, dep] = await Promise.all([
    supabaseClient.from("employees").select("id, name, trn, gross, employment_status, start_date, department, title, employee_number").eq("workspace", LD_WORKSPACE).order("name", { ascending: true }),
    supabaseClient.from("employee_departures").select("*").eq("workspace", LD_WORKSPACE).order("leaving_date", { ascending: false })
  ]);

  if (dep.error) {
    console.error("Departures could not be loaded:", dep.error);
    ldBanner("Leavers is not set up yet. Run phase8-leavers-migration.sql in Supabase, then refresh.");
    return false;
  }

  ldEmployees = emp.data || [];
  ldDepartures = dep.data || [];
  return true;
}

/* ---------- display ---------- */
function ldRender() {
  const today = ldIso(ldToday());
  const year = String(ldToday().getFullYear());
  const soonLimit = ldIso(new Date(ldToday().getTime() + 30 * 86400000));
  const thisYear = ldDepartures.filter((d) => String(d.leaving_date).startsWith(year));
  const soon = ldDepartures.filter((d) => d.leaving_date >= today && d.leaving_date <= soonLimit);
  const noP45 = ldDepartures.filter((d) => d.leaving_date <= today && !d.p45_prepared_on);
  const stillPaid = ldDepartures.filter((d) => d.status === "recorded" && d.leaving_date <= today);

  ldEl("statYearLabel").textContent = `Left in ${year}`;
  ldEl("statYear").textContent = String(thisYear.length);
  ldEl("statSoon").textContent = String(soon.length);
  ldEl("statSoonDetail").textContent = soon.length ? soon.map((d) => (ldEmp(d.employee_id) || {}).name).filter(Boolean).slice(0, 3).join(", ") : "Nobody is leaving soon";
  ldEl("statP45").textContent = String(noP45.length);
  ldEl("statP45Detail").textContent = noP45.length ? "Prepare and give them out" : "All recorded";
  ldEl("statP45Card").className = `stat-card ${noP45.length ? "warn" : ""}`.trim();
  ldEl("statPaid").textContent = String(stillPaid.length);
  ldEl("statPaidDetail").textContent = stillPaid.length ? "Past their last day: mark as left once final pay is processed" : "Nobody past their last day";
  ldEl("statPaidCard").className = `stat-card ${stillPaid.length ? "warn" : ""}`.trim();

  const body = ldEl("leaverBody");

  if (!ldDepartures.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">Nobody has been recorded as leaving.</td></tr>';
    return;
  }

  body.innerHTML = ldDepartures
    .map((d) => {
      const e = ldEmp(d.employee_id) || { name: "Former employee" };
      const days = ldDaysFrom(d.leaving_date);
      const when = days === 0 ? "today" : days > 0 ? `in ${days} day${days === 1 ? "" : "s"}` : `${-days} day${days === -1 ? "" : "s"} ago`;
      const pay =
        d.status === "completed"
          ? `<span class="badge ok">Marked as left</span><small>${ldEsc(ldFmt(d.completed_on))}</small>`
          : d.leaving_date > today
            ? '<span class="badge info">Working until their last day</span>'
            : '<span class="badge warn">Still on the payroll</span>';
      const p45 = d.p45_prepared_on
        ? `<span class="badge ok">Given ${ldEsc(ldFmt(d.p45_prepared_on))}</span>${d.p45_reference ? `<small>${ldEsc(d.p45_reference)}</small>` : ""}`
        : d.leaving_date <= today
          ? '<span class="badge warn">Not yet recorded</span>'
          : '<span class="badge info">After their last day</span>';

      let actions = `<button type="button" class="btn small" data-act="final" data-emp="${d.employee_id}">Final pay</button><button type="button" class="btn small" data-act="p45" data-emp="${d.employee_id}">P45</button>`;
      if (ldCanRecord() && !d.p45_prepared_on) actions += `<button type="button" class="btn small" data-act="p45given" data-emp="${d.employee_id}">Record P45 given</button>`;
      if (ldIsAdmin() && d.status === "recorded" && d.leaving_date <= today) actions += `<button type="button" class="btn small primary" data-act="complete" data-emp="${d.employee_id}">Mark as left</button>`;
      if (ldCanRecord() && d.status === "recorded" && !d.p45_prepared_on) actions += `<button type="button" class="btn small" data-act="edit" data-emp="${d.employee_id}">Change</button>`;
      if (ldIsAdmin() && !d.p45_prepared_on) actions += `<button type="button" class="btn small danger" data-act="undo" data-emp="${d.employee_id}">Undo</button>`;

      return `
        <tr data-emp="${d.employee_id}">
          <td><strong>${ldEsc(e.name)}</strong><small>${e.trn ? "TRN " + ldEsc(e.trn) : "No TRN on record"}${e.department ? " · " + ldEsc(e.department) : ""}</small></td>
          <td>${ldEsc(ldFmt(d.leaving_date))}<small>${when}</small></td>
          <td>${ldEsc(LD_REASONS[d.reason] || d.reason)}${d.note ? `<small>${ldEsc(d.note)}</small>` : ""}</td>
          <td>${pay}</td>
          <td>${p45}</td>
          <td><div class="row-actions">${actions}</div></td>
        </tr>`;
    })
    .join("");
}

/* ---------- dialogs ---------- */
function ldCloseDialog() {
  ldEl("ldDialog").hidden = true;
  ldEl("ldDialogForm").innerHTML = "";
}

function ldDialog({ title, subtitle, bodyHtml, submitText, onSubmit, danger, wide }) {
  const form = ldEl("ldDialogForm");
  form.style.width = wide ? "min(640px, 100%)" : "";
  form.innerHTML =
    `<h3 id="ldDialogTitle">${ldEsc(title)}</h3><p>${ldEsc(subtitle || "")}</p>${bodyHtml}` +
    '<div class="form-message error" id="ldDialogError" role="alert"></div>' +
    `<div class="dialog-actions"><button type="button" class="btn" id="ldDialogCancel">Cancel</button><button type="submit" class="btn ${danger ? "danger" : "primary"}" id="ldDialogSubmit">${ldEsc(submitText)}</button></div>`;
  ldEl("ldDialog").hidden = false;

  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = ldEl("ldDialogSubmit");
    button.disabled = true;
    const problem = await onSubmit(form);
    button.disabled = false;
    if (problem) ldEl("ldDialogError").textContent = problem;
    else ldCloseDialog();
  };
  ldEl("ldDialogCancel").onclick = ldCloseDialog;
  const first = form.querySelector("select, input, textarea");
  if (first) first.focus();
}

const ldField = (id, label, control, hint) =>
  `<div class="field" style="margin-bottom:12px"><label for="${id}">${ldEsc(label)}</label>${control}${hint ? `<small>${hint}</small>` : ""}</div>`;

function ldRecordDialog(presetEmployee) {
  const existing = presetEmployee ? ldDepartures.find((d) => d.employee_id === presetEmployee) : null;
  const taken = new Set(ldDepartures.map((d) => d.employee_id));
  const candidates = ldEmployees.filter((e) => String(e.employment_status || "").toLowerCase() !== "archived" && (e.id === presetEmployee || !taken.has(e.id)));

  if (!candidates.length) return ldMessage("Everyone has already been recorded as leaving, or there are no employees.", "error");

  ldDialog({
    title: existing ? "Change the departure" : "Record a departure",
    subtitle: "Their last day of employment, and why.",
    bodyHtml:
      ldField("ldEmp", "Employee", `<select id="ldEmp"${existing ? " disabled" : ""}>${candidates.map((e) => `<option value="${e.id}"${e.id === presetEmployee ? " selected" : ""}>${ldEsc(e.name)}</option>`).join("")}</select>`) +
      ldField("ldDate", "Last day of employment", `<input id="ldDate" type="date" value="${existing ? ldEsc(existing.leaving_date) : ldIso(ldToday())}">`, "They are paid until you mark them as left, so their final payroll can include them.") +
      ldField("ldReason", "Reason", `<select id="ldReason">${Object.entries(LD_REASONS).map(([k, v]) => `<option value="${k}"${existing && existing.reason === k ? " selected" : ""}>${v}</option>`).join("")}</select>`) +
      ldField("ldNote", "Note (optional)", `<input id="ldNote" type="text" maxlength="300" autocomplete="off" value="${existing ? ldEsc(existing.note || "") : ""}">`),
    submitText: "Save",
    onSubmit: async () => {
      const { error } = await supabaseClient.rpc("record_departure", {
        p_workspace: LD_WORKSPACE, p_employee: ldEl("ldEmp").value, p_date: ldEl("ldDate").value, p_reason: ldEl("ldReason").value, p_note: ldEl("ldNote").value.trim()
      });
      if (error) return error.message || "That could not be saved.";
      ldMessage("Departure recorded. They stay on the payroll until you mark them as left.", "ok");
      await ldRefresh();
      return null;
    }
  });
}

function ldConfirmDialog({ title, subtitle, submitText, danger, run, success }) {
  ldDialog({
    title, subtitle, bodyHtml: "", submitText, danger,
    onSubmit: async () => {
      const { error } = await run();
      if (error) return error.message || "That could not be done.";
      ldMessage(success, "ok");
      await ldRefresh();
      return null;
    }
  });
}

function ldP45GivenDialog(empId) {
  ldDialog({
    title: "Record the P45 as given",
    subtitle: `${(ldEmp(empId) || {}).name}. Prepare three copies: one for Tax Administration Jamaica and two for the employee.`,
    bodyHtml:
      ldField("ldP45Date", "Date prepared and given", `<input id="ldP45Date" type="date" value="${ldIso(ldToday())}" max="${ldIso(ldToday())}">`) +
      ldField("ldP45Ref", "Reference (optional)", '<input id="ldP45Ref" type="text" maxlength="100" autocomplete="off">'),
    submitText: "Save",
    onSubmit: async () => {
      const { error } = await supabaseClient.rpc("mark_p45_prepared", { p_employee: empId, p_date: ldEl("ldP45Date").value, p_reference: ldEl("ldP45Ref").value.trim() });
      if (error) return error.message || "That could not be saved.";
      ldMessage("P45 recorded.", "ok");
      await ldRefresh();
      return null;
    }
  });
}

/* ---------- the final pay helper (it only calculates; it changes nothing) ---------- */
async function ldFinalPayDialog(empId) {
  const e = ldEmp(empId) || {};
  const d = ldDepartures.find((x) => x.employee_id === empId);
  const { data } = await supabaseClient.rpc("accrued_vacation", { p_workspace: LD_WORKSPACE, p_employee: empId, p_date: d.leaving_date });
  const v = (data && data[0]) || { entitlement: 0, accrued: 0, adjustments: 0, taken: 0, pending: 0, available: 0, daily_rate: Number(e.gross || 0) * 12 / 260 };

  let monthText = "Open the Payroll page and set the pay period that contains their last day.";
  const start = localStorage.getItem("kairoxPayrollPeriodStart");
  const end = localStorage.getItem("kairoxPayrollPeriodEnd");

  if (start && end) {
    const { data: rows } = await supabaseClient.rpc("departure_days_in_period", { p_workspace: LD_WORKSPACE, p_employee: empId, p_start: start, p_end: end });
    const row = rows && rows[0];
    monthText = row && Number(row.days_after) > 0
      ? `In the current pay period (${ldFmt(start)} to ${ldFmt(end)}), ${Number(row.days_after)} working day(s) fall after their last day. On the Payroll page, Pay items for them offers these as unpaid days.`
      : "Their last day is not inside the current pay period, or no working days fall after it.";
  }

  const years = d.leaving_date && e.start_date ? Math.max(0, (ldParse(d.leaving_date) - ldParse(e.start_date)) / (365.25 * 86400000)) : 0;

  ldDialog({
    title: "Final pay",
    subtitle: `${e.name}, last day ${ldFmt(d.leaving_date)}. This only helps you calculate: nothing is saved or paid from here.`,
    wide: true,
    bodyHtml: `
      <h4 style="margin:6px 0">1. Accrued vacation pay</h4>
      <p class="muted small" style="margin:0 0 10px">Estimate: this year's entitlement (${Number(v.entitlement)} days) shared by the part of the year worked = ${Number(v.accrued)} days${Number(v.adjustments) ? `, adjusted by ${Number(v.adjustments)}` : ""}, less ${Number(v.taken)} taken${Number(v.pending) ? ` and ${Number(v.pending)} waiting` : ""}. Change the days if your records differ.</p>
      <div class="form-grid">${ldField("fpDays", "Unused vacation days", `<input id="fpDays" type="number" min="0" step="0.5" value="${Number(v.available)}">`)}${ldField("fpRate", "Pay for one day (J$)", `<input id="fpRate" type="number" min="0" step="0.01" value="${Number(v.daily_rate)}">`, "Starts at yearly pay divided by 260 working days.")}</div>
      <div id="fpVacation" style="font-weight:800;margin:0 0 6px"></div>
      <p class="muted small" style="margin:0 0 16px">Accrued vacation pay is taxed like normal pay. On the Payroll page, enter it in <strong>Pay items</strong> under <em>Adjustment</em> for their final payroll, with a note.</p>

      <h4 style="margin:6px 0">2. Their last month</h4>
      <p class="muted small" style="margin:0 0 16px">${ldEsc(monthText)}</p>

      <h4 style="margin:6px 0">3. Redundancy or other termination payment (optional)</h4>
      <p class="muted small" style="margin:0 0 10px">TAJ's Employers' Guide: part of a lump sum for loss of office is tax-free by this formula, and the rest is taxable. Pay in lieu of notice, sick pay and accrued vacation pay are <strong>not</strong> part of it: they are taxed like normal pay. The conditions of the Income Tax (Termination of Employment Payments) Order 1971 apply, so check with TAJ or your attorney.</p>
      <div class="form-grid">${ldField("fpTotal", "Lump sum paid (J$)", '<input id="fpTotal" type="number" min="0" step="0.01" value="0">')}${ldField("fpAvg", "Average yearly salary, last 3 years (J$)", `<input id="fpAvg" type="number" min="0" step="0.01" value="${Number(e.gross || 0) * 12}">`)}${ldField("fpYears", "Years of service", `<input id="fpYears" type="number" min="0" step="0.01" value="${years.toFixed(2)}">`)}</div>
      <div id="fpTax" style="font-weight:800;margin:0 0 6px"></div>`,
    submitText: "Done",
    onSubmit: async () => null
  });

  const update = () => {
    const days = Number(ldEl("fpDays").value) || 0;
    const rate = Number(ldEl("fpRate").value) || 0;
    ldEl("fpVacation").textContent = `${days} day(s) × ${ldMoney(rate)} = ${ldMoney(days * rate)}`;

    const total = Number(ldEl("fpTotal").value) || 0;
    const avg = Number(ldEl("fpAvg").value) || 0;
    const yrs = Number(ldEl("fpYears").value) || 0;
    const free = Math.min(total, (2.25 * avg * yrs) / (100 / 3));   // 2 1/4 x average salary x years / 33 1/3 (TAJ Employers' Guide)
    ldEl("fpTax").textContent = total
      ? `Tax-free portion ${ldMoney(free)}; taxable portion ${ldMoney(total - free)} (statutory deductions apply to the taxable part).`
      : "Enter the lump sum to see how much is tax-free.";
  };

  ["fpDays", "fpRate", "fpTotal", "fpAvg", "fpYears"].forEach((id) => ldEl(id).addEventListener("input", update));
  update();
}

/* ---------- wiring ---------- */
async function ldRefresh() {
  if (await ldLoad()) ldRender();
}

async function ldStart() {
  ldEl("recordDepartureButton").addEventListener("click", () => ldRecordDialog());
  ldEl("ldDialog").addEventListener("click", (event) => { if (event.target.id === "ldDialog") ldCloseDialog(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !ldEl("ldDialog").hidden) ldCloseDialog(); });

  document.addEventListener("click", (event) => {
    const button = event.target.closest && event.target.closest("[data-act]");
    if (!button) return;

    const empId = button.dataset.emp;
    const name = (ldEmp(empId) || {}).name || "this person";

    if (button.dataset.act === "final") ldFinalPayDialog(empId);
    if (button.dataset.act === "p45") window.open(`p45.html?employee=${encodeURIComponent(empId)}`, "_blank", "noopener");
    if (button.dataset.act === "p45given") ldP45GivenDialog(empId);
    if (button.dataset.act === "edit") ldRecordDialog(empId);
    if (button.dataset.act === "complete") {
      ldConfirmDialog({
        title: "Mark as left?", subtitle: `${name} will be made inactive and will no longer be paid. Check that their final payroll has been processed first.`,
        submitText: "Mark as left", run: () => supabaseClient.rpc("complete_departure", { p_employee: empId }), success: `${name} is marked as left.`
      });
    }
    if (button.dataset.act === "undo") {
      ldConfirmDialog({
        title: "Undo this departure?", subtitle: `${name} will be treated as still employed (and made active again if they were marked as left).`, submitText: "Undo", danger: true,
        run: () => supabaseClient.rpc("cancel_departure", { p_employee: empId }), success: "Departure undone."
      });
    }
  });

  if (!(await ldAccess())) {
    ldEl("leaverBody").innerHTML = '<tr class="empty-row"><td colspan="6">Sign in with a payroll role to see this.</td></tr>';
    ["statYear", "statSoon", "statP45", "statPaid"].forEach((id) => { ldEl(id).textContent = "—"; });
    ["statSoonDetail", "statP45Detail", "statPaidDetail"].forEach((id) => { ldEl(id).textContent = "Sign in to see this"; });
    return;
  }

  ldEl("recordDepartureButton").hidden = !ldCanRecord();
  await ldRefresh();
}

ldStart();