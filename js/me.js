// Which company the signed-in person is working in. Kairox Exchange by default.
function kairoxWorkspaceId() {
  try {
    return localStorage.getItem("kairoxWorkspace") || "kairox-exchange";
  } catch (error) {
    return "kairox-exchange";
  }
}

const ME_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

let meWorkspace = kairoxWorkspaceId();
let me = null;
let mePayslips = [];
let mePay = null;
let meTypes = [];
let meBalances = [];
let meRequests = [];
const meYearNow = new Date().getFullYear();
let meLeaveYear = meYearNow;
let meTaxYear = meYearNow;

const meEl = (id) => document.getElementById(id);
const meEsc = (value = "") =>
  String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function meParse(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
function meFmt(iso) {
  return iso ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(meParse(iso)) : "";
}
function meMoney(value) {
  return `J$${Number(value || 0).toLocaleString("en-JM", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const meDays = (n) => String(Number(n));
const meToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
function meIso(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function meBanner(html) {
  const banner = meEl("pageBanner");
  banner.innerHTML = html;
  banner.hidden = !html;
}
function meMessage(text, kind) {
  const box = meEl("meMessage");
  box.textContent = text || "";
  box.className = `form-message ${kind || ""}`.trim();
}
const meActive = () => me && me.status !== "inactive";
const meOn = (feature) => me && me.features && me.features[feature] !== false;

/* ---------- access ---------- */
async function meAccess() {
  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData || !sessionData.session) {
    meBanner('You are not signed in. <a href="login.html?next=me.html">Sign in</a> to continue.');
    return false;
  }

  const { data: rows, error } = await supabaseClient.rpc("my_employee", { p_workspace: null });

  if (error) {
    meBanner("The employee portal has not been set up yet. Ask your administrator to run the Phase 9 database update.");
    return false;
  }
  if (!rows || !rows.length) {
    meBanner("Your login is not linked to an employee record yet. Ask your employer to give you access.");
    return false;
  }

  const mine = rows.find((r) => r.workspace === meWorkspace) || rows[0];

  if (mine.workspace !== meWorkspace) {
    try { localStorage.setItem("kairoxWorkspace", mine.workspace); } catch (e) { /* storage can be unavailable */ }
    meWorkspace = mine.workspace;

    // Reload once so the top bar and the page both use the company the employee belongs to.
    try {
      if (!sessionStorage.getItem("kairoxPortalReload")) {
        sessionStorage.setItem("kairoxPortalReload", "1");
        window.location.reload();
        return false;
      }
    } catch (e) { /* storage can be unavailable */ }
  }

  me = mine;
  meBanner("");
  return true;
}

/* ---------- my details ---------- */
function meRenderProfile() {
  const company = me.company || {};
  const facts = [
    ["Name", me.name], ["Employee number", me.employee_number], ["Job title", me.title], ["Department", me.department],
    ["Reports to", me.manager_name], ["Started", meFmt(me.start_date)], ["Company", company.name]
  ];
  const editable = meActive() && meOn("details");
  // Their own monthly gross salary (the database only ever returns the signed-in employee's own figure).
  const salary = mePay
    ? `<div class="me-pay" style="display:inline-flex;flex-direction:column;gap:4px;margin:0 0 20px;padding:16px 22px;border-radius:14px;color:#fff;background:linear-gradient(135deg,#5b2c83,#2cb8b3)"><span style="font-size:13px;font-weight:600;opacity:.85">Monthly gross salary</span><strong style="font-size:26px;letter-spacing:-.02em">${meMoney(mePay.gross)}</strong></div>`
    : "";
  const field = (id, label, value, attrs = "") =>
    `<div class="field" style="margin-bottom:12px"><label for="${id}">${label}</label><input id="${id}" type="text" value="${meEsc(value || "")}" ${attrs}${editable ? "" : " disabled"}></div>`;

  meEl("meProfile").innerHTML =
    salary +
    `<dl style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px 24px;margin:0 0 20px">${facts
      .map(([k, v]) => `<div><dt class="muted small" style="margin:0">${k}</dt><dd style="margin:0;font-weight:700">${meEsc(v || "—")}</dd></div>`)
      .join("")}</dl>` +
    (meOn("details")
      ? `<h3 style="margin:0 0 10px">Contact details</h3>
         <div class="form-grid">${field("meEmail", "Email", me.email, 'maxlength="120" autocomplete="email"')}${field("mePhone", "Phone", me.phone, 'maxlength="30" autocomplete="tel"')}</div>
         ${field("meAddress", "Address", me.address, 'maxlength="200" autocomplete="street-address"')}
         <div class="form-grid">${field("meEmName", "Emergency contact", me.emergency_contact_name, 'maxlength="100"')}${field("meEmPhone", "Emergency contact phone", me.emergency_contact_phone, 'maxlength="30"')}</div>
         ${editable ? '<div class="form-message error" id="meDetailsError" role="alert"></div><button class="btn primary" id="meSaveDetails" type="button">Save my details</button>' : ""}`
      : "");

  const save = meEl("meSaveDetails");
  if (save) save.addEventListener("click", meSaveDetails);
}

async function meSaveDetails() {
  const button = meEl("meSaveDetails");
  meEl("meDetailsError").textContent = "";
  button.disabled = true;

  const { error } = await supabaseClient.rpc("update_my_details", {
    p_workspace: meWorkspace,
    p_data: {
      email: meEl("meEmail").value.trim(), phone: meEl("mePhone").value.trim(), address: meEl("meAddress").value.trim(),
      emergency_contact_name: meEl("meEmName").value.trim(), emergency_contact_phone: meEl("meEmPhone").value.trim()
    }
  });

  button.disabled = false;

  if (error) {
    meEl("meDetailsError").textContent = error.message || "Your details were not saved.";
    return;
  }

  meMessage("Your details were saved.", "ok");
  const { data } = await supabaseClient.rpc("my_employee", { p_workspace: meWorkspace });
  if (data && data[0]) me = data[0];
  meRenderProfile();
}

/* ---------- payslips ---------- */
function meRenderPayslips() {
  const body = meEl("mePayslipsBody");

  body.innerHTML = mePayslips.length
    ? mePayslips
        .map(
          (p) => `<tr>
            <td>${meEsc(meFmt(p.period_start))} to ${meEsc(meFmt(p.period_end))}</td>
            <td>${meEsc(meFmt(p.pay_date))}</td>
            <td class="num">${meMoney(p.gross_pay)}</td>
            <td class="num">${meMoney(p.total_deductions)}</td>
            <td class="num"><strong>${meMoney(p.net_pay)}</strong></td>
            <td><button type="button" class="btn small" data-act="payslip" data-run="${p.run_id}">View</button></td>
          </tr>`
        )
        .join("")
    : '<tr class="empty-row"><td colspan="6">No payslips yet. They appear here once a payroll has been processed.</td></tr>';
}

function mePayslipHtml(p) {
  const company = me.company || {};
  const lines = (label, value, always) => (always || Number(value) ? `<tr><td>${label}</td><td class="num">${meMoney(value)}</td></tr>` : "");
  const logo = company.logo ? `<img src="${meEsc(company.logo)}" alt="" style="max-width:170px;max-height:60px;display:block;margin-bottom:8px">` : "";

  return `
    <div class="me-payslip">
      ${logo}
      <h2 style="margin:0">${meEsc(company.name || "Payslip")}</h2>
      <p class="muted small" style="margin:2px 0 14px">${[company.trn ? "TRN " + company.trn : "", company.nis_number ? "NIS " + company.nis_number : ""].filter(Boolean).map(meEsc).join(" · ")}</p>
      <h3 style="margin:0 0 8px">Payslip: ${meEsc(meFmt(p.period_start))} to ${meEsc(meFmt(p.period_end))}</h3>
      <p style="margin:0 0 14px">${meEsc(me.name)}${me.employee_number ? " · " + meEsc(me.employee_number) : ""}${p.employee_title || me.title ? " · " + meEsc(p.employee_title || me.title) : ""}<br>Paid ${meEsc(meFmt(p.pay_date))}${Number(p.unpaid_days) ? ` · ${meDays(p.unpaid_days)} unpaid day(s)` : ""}</p>
      <table class="data" style="margin-bottom:14px"><thead><tr><th colspan="2">Earnings</th></tr></thead><tbody>
        ${lines("Basic salary", p.basic_salary, true)}${lines("Overtime", p.overtime)}${lines("Bonus", p.bonus)}${lines("Taxable allowances", p.taxable_allowance)}${lines("Adjustments", p.adjustment)}
        <tr><td><strong>Gross pay</strong></td><td class="num"><strong>${meMoney(p.gross_pay)}</strong></td></tr>
        ${lines("Non-taxable allowances", p.exempt_allowance)}
      </tbody></table>
      <table class="data" style="margin-bottom:14px"><thead><tr><th colspan="2">Deductions</th></tr></thead><tbody>
        ${lines("Income tax (PAYE)", p.paye, true)}${lines("NIS", p.nis, true)}${lines("NHT", p.nht, true)}${lines("Education Tax", p.education_tax, true)}${lines("Pension", p.pension)}${lines("Loan repayment", p.loan_deduction)}${lines("Other deductions", p.other_deductions)}
        <tr><td><strong>Total deductions</strong></td><td class="num"><strong>${meMoney(p.total_deductions)}</strong></td></tr>
      </tbody></table>
      <p style="font-size:1.15rem;margin:0"><strong>Net pay ${meMoney(p.net_pay)}</strong></p>
    </div>`;
}

function mePrint(html) {
  let area = meEl("mePrintArea");

  if (!area) {
    area = document.createElement("div");
    area.id = "mePrintArea";
    area.style.display = "none";
    document.body.appendChild(area);

    const style = document.createElement("style");
    style.textContent = "@media print { body > *:not(#mePrintArea) { display: none !important; } #mePrintArea { display: block !important; padding: 24px; } }";
    document.head.appendChild(style);
  }

  area.innerHTML = html;
  window.print();
}

async function meShowPayslip(runId) {
  const { data, error } = await supabaseClient.rpc("my_payslip", { p_workspace: meWorkspace, p_run: runId });

  if (error || !data || !data[0]) {
    meMessage((error && error.message) || "That payslip could not be loaded.", "error");
    return;
  }

  const html = mePayslipHtml(data[0]);
  meDialog({ title: "Payslip", subtitle: "", bodyHtml: html, submitText: "Print or save as PDF", wide: true, onSubmit: async () => { mePrint(html); return "keep"; } });
}

/* ---------- leave ---------- */
function meStatusBadge(r) {
  const map = { pending: ["warn", "Waiting"], approved: ["ok", "Approved"], rejected: ["late", "Declined"], cancelled: ["info", "Cancelled"] };
  const [css, label] = map[r.status] || ["info", r.status];
  return `<span class="badge ${css}">${label}</span>`;
}

function meRenderLeave() {
  meEl("meBalBody").innerHTML = meBalances.length
    ? meBalances
        .map((b) => {
          if (b.remaining === null) return `<tr><td>${meEsc(b.type_name)}</td><td class="num">No limit</td><td class="num">${meDays(b.taken)}</td><td class="num">${meDays(b.pending)}</td><td class="num">—</td></tr>`;
          const total = Number(b.entitlement) + Number(b.adjustments);
          if (total === 0) return `<tr><td>${meEsc(b.type_name)}</td><td class="num muted" colspan="4">${b.eligible_from ? "From " + meEsc(meFmt(b.eligible_from)) : "None"}</td></tr>`;
          return `<tr><td>${meEsc(b.type_name)}</td><td class="num">${meDays(total)}</td><td class="num">${meDays(b.taken)}</td><td class="num">${meDays(b.pending)}</td><td class="num"><strong>${meDays(b.remaining)}</strong></td></tr>`;
        })
        .join("")
    : '<tr class="empty-row"><td colspan="5">No leave types are set up.</td></tr>';

  meEl("meReqBody").innerHTML = meRequests.length
    ? meRequests
        .map(
          (r) => `<tr>
            <td>${meEsc(r.type_name)}</td>
            <td>${meEsc(meFmt(r.start_date))}${r.end_date !== r.start_date ? " to " + meEsc(meFmt(r.end_date)) : ""}${r.half_day ? " (half day)" : ""}${r.note ? `<small>${meEsc(r.note)}</small>` : ""}</td>
            <td class="num">${meDays(r.days)}</td>
            <td>${meStatusBadge(r)}${r.decision_note ? `<small>${meEsc(r.decision_note)}</small>` : ""}</td>
            <td>${r.status === "pending" ? `<button type="button" class="btn small danger" data-act="cancel-leave" data-id="${r.id}">Cancel</button>` : ""}</td>
          </tr>`
        )
        .join("")
    : '<tr class="empty-row"><td colspan="5">You have not asked for any leave.</td></tr>';
}

async function meLoadLeave() {
  const [types, bal, reqs] = await Promise.all([
    supabaseClient.rpc("my_leave_types", { p_workspace: meWorkspace }),
    supabaseClient.rpc("my_leave_balances", { p_workspace: meWorkspace, p_year: meLeaveYear }),
    supabaseClient.rpc("my_leave_requests", { p_workspace: meWorkspace })
  ]);
  meTypes = types.data || [];
  meBalances = bal.data || [];
  meRequests = reqs.data || [];
  meRenderLeave();
}

async function meUpdateSummary() {
  const box = meEl("meLeaveSummary");
  if (!box) return;

  const typeId = meEl("meType").value;
  const start = meEl("meStart").value;
  const half = meEl("meHalf").checked;
  const end = half ? start : meEl("meEnd").value;

  if (!typeId || !start || !end || end < start) {
    box.textContent = "";
    return;
  }

  const { data: days } = await supabaseClient.rpc("leave_working_days", { p_start: start, p_end: end, p_half: half });
  const t = meTypes.find((x) => x.id === typeId) || {};
  const year = Number(start.slice(0, 4));
  let balances = meBalances;

  if (year !== meLeaveYear) {
    const { data } = await supabaseClient.rpc("my_leave_balances", { p_workspace: meWorkspace, p_year: year });
    balances = data || [];
  }

  const b = balances.find((x) => x.leave_type_id === typeId);
  let text = `${meDays(days || 0)} working day${Number(days) === 1 ? "" : "s"} (weekends and public holidays are not counted). `;
  let colour = "#35156f";

  if (!Number(days)) {
    text = "Those dates have no working days.";
    colour = "#b91c1c";
  } else if (b && b.remaining !== null) {
    const after = Number(b.remaining) - Number(days);
    text += `You have ${meDays(b.remaining)} day(s) of ${t.name} left in ${year}${after >= 0 ? `, ${meDays(after)} after this.` : ", so this is more than you have left."}`;
    if (after < 0) colour = "#b91c1c";
  }

  if (t.certificate_after_days && Number(days) > Number(t.certificate_after_days)) {
    text += ` A medical certificate will be needed (more than ${t.certificate_after_days} days).`;
  }

  box.style.color = colour;
  box.textContent = text;
}

function meRequestDialog() {
  const today = meIso(meToday());
  const field = (id, label, control, hint) => `<div class="field" style="margin-bottom:12px"><label for="${id}">${label}</label>${control}${hint ? `<small>${hint}</small>` : ""}</div>`;

  meDialog({
    title: "Request leave",
    subtitle: "Your manager or an HR officer will approve it.",
    bodyHtml:
      field("meType", "Type of leave", `<select id="meType">${meTypes.map((t) => `<option value="${t.id}">${meEsc(t.name)}${t.paid ? "" : " (unpaid)"}</option>`).join("")}</select>`) +
      `<div class="form-grid">${field("meStart", "First day", `<input id="meStart" type="date" value="${today}">`)}${field("meEnd", "Last day", `<input id="meEnd" type="date" value="${today}">`)}</div>` +
      '<label style="display:flex;gap:8px;align-items:center;margin:0 0 12px;font-weight:600"><input id="meHalf" type="checkbox"> Half day (one day only)</label>' +
      field("meNote", "Note (optional)", '<input id="meNote" type="text" maxlength="300" autocomplete="off">', "Please do not enter medical details.") +
      '<div id="meLeaveSummary" role="status" style="min-height:22px;font-size:14px;font-weight:700;margin-bottom:6px"></div>',
    submitText: "Send request",
    onSubmit: async () => {
      const half = meEl("meHalf").checked;
      const start = meEl("meStart").value;
      const { error } = await supabaseClient.rpc("request_my_leave", {
        p_workspace: meWorkspace, p_leave_type: meEl("meType").value, p_start: start, p_end: half ? start : meEl("meEnd").value,
        p_half: half, p_note: meEl("meNote").value.trim()
      });

      if (error) return error.message || "Your request was not sent.";

      meMessage("Your request was sent. It is waiting for approval.", "ok");
      await meLoadLeave();
      return null;
    }
  });

  ["meType", "meStart", "meEnd", "meHalf"].forEach((id) => meEl(id).addEventListener("change", meUpdateSummary));
  meEl("meStart").addEventListener("change", () => { if (meEl("meEnd").value < meEl("meStart").value) meEl("meEnd").value = meEl("meStart").value; meUpdateSummary(); });
  meEl("meHalf").addEventListener("change", () => { meEl("meEnd").disabled = meEl("meHalf").checked; });
  meUpdateSummary();
}

/* ---------- tax totals ---------- */
async function meLoadTax() {
  const { data, error } = await supabaseClient.rpc("my_tax_summary", { p_workspace: meWorkspace, p_year: meTaxYear });
  const f = data && data[0];
  const body = meEl("meTaxBody");

  if (error || !f) {
    body.innerHTML = `<tr class="empty-row"><td>${meEsc((error && error.message) || "No figures.")}</td></tr>`;
    return;
  }

  if (!Number(f.payrolls)) {
    body.innerHTML = `<tr class="empty-row"><td>No payrolls were processed for you in ${meTaxYear}.</td></tr>`;
    return;
  }

  const rows = [
    ["Gross pay (taxable)", f.gross], ["Pension contributions", f.pension], ["NIS deducted", f.nis], ["Statutory income (gross pay less NIS and pension)", f.statutory_income],
    ["Tax-free amount used (threshold)", f.tax_free], ["Income tax (PAYE) deducted", f.paye], ["NHT deducted", f.nht], ["Education Tax deducted", f.education_tax],
    ["Non-taxable allowances (not in gross pay)", f.exempt_allowances]
  ];
  body.innerHTML =
    rows.map(([k, v]) => `<tr><th style="width:60%">${k}</th><td class="num">${meMoney(v)}</td></tr>`).join("") +
    `<tr><th>Payrolls included</th><td class="num">${f.payrolls} (paid ${meEsc(meFmt(f.first_pay))} to ${meEsc(meFmt(f.last_pay))})</td></tr>`;
}

function meTaxPrint() {
  const company = me.company || {};
  mePrint(`<h2 style="margin:0">${meEsc(company.name || "")}</h2><h3>Tax and statutory totals for ${meTaxYear}</h3><p>${meEsc(me.name)}${me.employee_number ? " · " + meEsc(me.employee_number) : ""}</p><table class="data">${meEl("meTaxBody").innerHTML}</table><p class="muted small">From processed payrolls. This is a summary, not TAJ's P24 form.</p>`);
}

/* ---------- documents ---------- */
async function meLoadDocs() {
  const { data } = await supabaseClient.rpc("my_documents", { p_workspace: meWorkspace });
  const docs = data || [];

  meEl("meDocsBody").innerHTML = docs.length
    ? docs
        .map(
          (d) => `<tr>
            <td><strong>${meEsc(d.title)}</strong>${d.description ? `<small>${meEsc(d.description)}</small>` : ""}</td>
            <td>${meEsc(d.category)}</td>
            <td>${meEsc(meFmt(String(d.created_at).slice(0, 10)))}</td>
            <td><button type="button" class="btn small" data-act="download" data-path="${meEsc(d.file_path)}">Download</button></td>
          </tr>`
        )
        .join("")
    : '<tr class="empty-row"><td colspan="4">Nothing has been shared with you yet.</td></tr>';
}

async function meDownload(path) {
  const { data, error } = await supabaseClient.storage.from("company-documents").createSignedUrl(path, 60);

  if (error || !data || !data.signedUrl) {
    meMessage("That document could not be opened.", "error");
    return;
  }

  window.open(data.signedUrl, "_blank", "noopener");
}

/* ---------- dialogs ---------- */
function meCloseDialog() {
  meEl("meDialog").hidden = true;
  meEl("meDialogForm").innerHTML = "";
}

function meDialog({ title, subtitle, bodyHtml, submitText, onSubmit, wide }) {
  const form = meEl("meDialogForm");
  form.style.width = wide ? "min(680px, 100%)" : "";
  form.innerHTML =
    `<h3 id="meDialogTitle">${meEsc(title)}</h3>${subtitle ? `<p>${meEsc(subtitle)}</p>` : ""}${bodyHtml}` +
    '<div class="form-message error" id="meDialogError" role="alert"></div>' +
    `<div class="dialog-actions"><button type="button" class="btn" id="meDialogCancel">Close</button><button type="submit" class="btn primary" id="meDialogSubmit">${meEsc(submitText)}</button></div>`;
  meEl("meDialog").hidden = false;

  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = meEl("meDialogSubmit");
    button.disabled = true;
    const problem = await onSubmit(form);
    button.disabled = false;

    if (problem === "keep") return;
    if (problem) meEl("meDialogError").textContent = problem;
    else meCloseDialog();
  };
  meEl("meDialogCancel").onclick = meCloseDialog;
}

/* ---------- start ---------- */
function meFillYears(selectId, current) {
  const years = [];
  for (let y = meYearNow + 1; y >= meYearNow - 6; y--) years.push(y);
  meEl(selectId).innerHTML = years.map((y) => `<option value="${y}"${y === current ? " selected" : ""}>${y}</option>`).join("");
}

async function meStart() {
  meEl("meDialog").addEventListener("click", (event) => { if (event.target.id === "meDialog") meCloseDialog(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !meEl("meDialog").hidden) meCloseDialog(); });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest && event.target.closest("[data-act]");
    if (!button) return;

    if (button.dataset.act === "payslip") meShowPayslip(button.dataset.run);
    if (button.dataset.act === "download") meDownload(button.dataset.path);
    if (button.dataset.act === "cancel-leave") {
      const { error } = await supabaseClient.rpc("cancel_my_leave", { p_workspace: meWorkspace, p_request: button.dataset.id });
      if (error) meMessage(error.message || "That could not be cancelled.", "error");
      else { meMessage("Your request was cancelled.", "ok"); await meLoadLeave(); }
    }
  });

  if (!(await meAccess())) {
    ["meProfileCard"].forEach((id) => { meEl(id).hidden = true; });
    return;
  }

  if (meOn("payslips") && meActive()) {
    const { data } = await supabaseClient.rpc("my_pay", { p_workspace: meWorkspace });
    mePay = data && data[0] ? data[0] : null;
  }

  meRenderProfile();

  if (me.status === "inactive") {
    meEl("meEnded").textContent = "Your employment has ended. You can still see your payslips and tax totals.";
    meEl("meEnded").hidden = false;
  }

  if (meOn("payslips")) {
    const { data } = await supabaseClient.rpc("my_payslips", { p_workspace: meWorkspace });
    mePayslips = data || [];
    meRenderPayslips();
    meEl("mePayslipsCard").hidden = false;
  }

  if (meOn("leave") && meActive()) {
    meFillYears("meLeaveYear", meLeaveYear);
    meEl("meLeaveYear").addEventListener("change", async (event) => { meLeaveYear = Number(event.target.value); await meLoadLeave(); });
    meEl("meRequestLeave").addEventListener("click", meRequestDialog);
    await meLoadLeave();
    meEl("meLeaveCard").hidden = false;
  }

  if (meOn("tax")) {
    meFillYears("meTaxYear", meTaxYear);
    meEl("meTaxYear").addEventListener("change", async (event) => { meTaxYear = Number(event.target.value); await meLoadTax(); });
    meEl("meTaxPrint").addEventListener("click", meTaxPrint);
    await meLoadTax();
    meEl("meTaxCard").hidden = false;
  }

  if (meOn("documents") && meActive()) {
    await meLoadDocs();
    meEl("meDocsCard").hidden = false;
  }
}

meStart();