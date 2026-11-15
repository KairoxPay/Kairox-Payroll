// Bank payments: employees' bank accounts and a payment file (CSV) for each processed payroll.
// Everything goes through database functions that check the role first (phase21-bank-payments.sql). Nothing is paid from here.

function kairoxWorkspaceId() {
  try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (error) { return "kairox-exchange"; }
}

const BK_WORKSPACE = kairoxWorkspaceId();
const BK_ROLES = ["admin", "director", "payroll"];
const BK_BANKS = typeof KX_BANKS !== "undefined" ? KX_BANKS : [];        // [code, name] from js/bank-codes.js
const BK_BRANCHES = typeof KX_BRANCHES !== "undefined" ? KX_BRANCHES : {};

let bkAccounts = [];
let bkRuns = [];
let bkEditing = null;
let bkSettings = { originator_id: "", company_account: "" };
let bkFileRun = null;   // the payroll whose file dialog is open

const bkEl = (id) => document.getElementById(id);
const bkEsc = (v = "") => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const bkMoney = (n) => `JMD ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const bkDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(y, m - 1, d));
};
const bkMonth = (iso) => {
  const [y, m] = String(iso).slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
};
const bkPeriod = (s, e) => (String(s).slice(0, 7) === String(e).slice(0, 7) ? bkMonth(s) : `${bkDate(s)} to ${bkDate(e)}`);
const bkMask = (acct) => (acct ? `•••• ${String(acct).slice(-4)}` : "");

function bkBanner(html) { const b = bkEl("pageBanner"); b.innerHTML = html; b.hidden = !html; }
function bkMessage(text, kind) { const b = bkEl("bankMessage"); b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); }

/* ---------- pure helpers (tested) ---------- */
function bkCsvCell(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replaceAll('"', '""')}"` : s;
}

// Lines with complete bank details go in the file; the rest are listed so nobody is paid twice or forgotten.
function bkBuildFile(lines, reference) {
  const ok = lines.filter((l) => l.account_number && l.bank_name && Number(l.amount) > 0);
  const missing = lines.filter((l) => !l.account_number || !l.bank_name);
  const zero = lines.filter((l) => l.account_number && l.bank_name && !(Number(l.amount) > 0));
  const head = ["Employee name", "Employee number", "Bank", "Branch", "Account number", "Account type", "Account name", "Amount (JMD)", "Reference"];
  const rows = ok.map((l) => [l.name, l.employee_number || "", l.bank_name, l.branch || "", l.account_number,
    l.account_type === "chequing" ? "Chequing" : "Savings", l.account_name || l.name, Number(l.amount).toFixed(2), reference]);
  const total = Math.round(ok.reduce((t, l) => t + Number(l.amount), 0) * 100) / 100;
  return { csv: [head].concat(rows).map((r) => r.map(bkCsvCell).join(",")).join("\r\n"), count: ok.length, total, missing, zero };
}

// NCB ACH upload file, exactly as NCB's own "ACH File Creator" writes it: fixed width, 160 characters a line, CRLF.
// H = header (company account, originator ID, description, date, currency); T = one credit per person; C = control totals.
const bkAscii = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "").replace(/\|/g, " ");
const bkLeft = (v, n) => (bkAscii(v).trim() + " ".repeat(n)).slice(0, n);
const bkRight = (v, n) => (" ".repeat(n) + String(v)).slice(-n);
const bkZeros = (v, n) => ("0".repeat(n) + String(v)).slice(-n);
const bkFixed = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

function bkBuildAch({ companyAccount, originatorId, narration, date, lines }) {
  const errors = [];
  if (!/^[0-9]{4,20}$/.test(String(companyAccount || ""))) errors.push("The company account number must be 4 to 20 digits.");
  if (!/^[0-9A-Za-z]{1,10}$/.test(String(originatorId || ""))) errors.push("Enter the Originator ID NCB gave you (up to 10 letters or digits).");
  if (!/^\d{8}$/.test(String(date || ""))) errors.push("Choose the payment date.");

  const ok = lines.filter((l) => l.account_number && /^\d{8}$/.test(l.institution_id || "") && Number(l.amount) > 0);
  ok.forEach((l) => { if (Number(l.amount) >= 10000000) errors.push(`${l.name}: NCB's limit is under $10,000,000 for one payment.`); });
  if (!ok.length) errors.push("Nobody in this payroll has complete bank details (bank, branch and account).");
  if (errors.length) return { errors };

  const words = bkAscii(narration).trim() || "ACH Paymnt";
  const head = "H" + bkLeft(companyAccount, 20) + bkLeft(originatorId, 10) + "PPD" + bkLeft(words, 10) + "00000077" + date + bkLeft("JMD", 100);
  const body = ok.map((l, i) => {
    const pid = l.employee_number || `EMP${String(i + 1).padStart(3, "0")}`;
    return "T" + bkLeft(l.account_number, 17) + (l.account_type === "chequing" ? "C" : "S") + bkRight(bkFixed(l.amount), 18) + l.institution_id
      + bkLeft(pid, 15) + bkLeft(l.account_name || l.name, 22) + "CR" + "0" + "00000077" + bkLeft(bkZeros(i + 1, 7), 7) + " ".repeat(10) + bkLeft("Salary", 50);
  });
  const total = Math.round(ok.reduce((t, l) => t + Number(l.amount), 0) * 100) / 100;
  const foot = "C" + " ".repeat(10) + bkRight("0.00", 18) + bkRight(bkFixed(total), 18) + bkZeros(0, 6) + bkZeros(ok.length, 6) + bkZeros(ok.length, 7) + " ".repeat(94);
  return { text: [head].concat(body, [foot]).join("\r\n") + "\r\n", count: ok.length, total,
    missing: lines.filter((l) => !l.account_number || !/^\d{8}$/.test(l.institution_id || "")), errors: [] };
}

/* ---------- loading ---------- */
async function bkAllowed() {
  const { data: s } = await supabaseClient.auth.getSession();
  if (!s || !s.session) { bkBanner('You are not signed in. <a href="login.html?next=bank.html">Sign in</a> to continue.'); return false; }
  const { data: role, error } = await supabaseClient.rpc("get_my_role", { p_workspace: BK_WORKSPACE });
  if (error) { bkBanner("Your role could not be checked. Refresh the page."); return false; }
  if (!BK_ROLES.includes(role)) { bkBanner("Only an admin, a managing director or a payroll officer can use bank payments."); return false; }
  return true;
}

function bkMissingSetup(error) {
  return error && (error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message || ""));
}

async function bkLoad() {
  const [accts, runs, settings] = await Promise.all([
    supabaseClient.rpc("bank_accounts_list", { p_workspace: BK_WORKSPACE }),
    supabaseClient.rpc("bank_payment_runs", { p_workspace: BK_WORKSPACE }),
    supabaseClient.rpc("bank_file_settings_get", { p_workspace: BK_WORKSPACE })
  ]);

  if (accts.error || runs.error) {
    const error = accts.error || runs.error;
    console.error("Bank payments could not be loaded:", error);
    bkBanner(bkMissingSetup(error) ? "Bank payments are not set up yet. Run phase21-bank-payments.sql in Supabase, then refresh." : bkEsc(error.message || "Bank payments could not be loaded."));
    return;
  }

  bkAccounts = accts.data || [];
  bkRuns = runs.data || [];
  bkSettings = (!settings.error && (settings.data || [])[0]) || { originator_id: "", company_account: "" };
  bkRender();
}

function bkRender() {
  bkEl("acctBody").innerHTML = bkAccounts.length ? bkAccounts.map((a) => `<tr>
      <td><strong>${bkEsc(a.name)}</strong>${a.employee_number ? `<small style="display:block;color:#6f7285">${bkEsc(a.employee_number)}</small>` : ""}</td>
      <td>${a.bank_name ? bkEsc(a.bank_name) : '<span class="muted">Not added</span>'}${a.account_number && !a.institution_id ? '<small style="display:block;color:#b45309;font-weight:700">Choose the branch again</small>' : ""}</td>
      <td>${bkEsc(a.branch || "")}</td>
      <td>${bkEsc(bkMask(a.account_number))}</td>
      <td>${a.account_number ? (a.account_type === "chequing" ? "Chequing" : "Savings") : ""}</td>
      <td><button type="button" class="btn small" data-edit="${bkEsc(a.employee_id)}">${a.account_number ? "Edit" : "Add"}</button></td>
    </tr>`).join("") : '<tr class="empty-row"><td colspan="6">No current employees.</td></tr>';

  bkEl("runBody").innerHTML = bkRuns.length ? bkRuns.map((r) => `<tr>
      <td><strong>${bkEsc(bkPeriod(r.period_start, r.period_end))}</strong></td>
      <td>${bkEsc(bkDate(r.pay_date))}</td>
      <td class="num">${r.people}</td>
      <td class="num">${bkMoney(r.total_net)}</td>
      <td>${r.missing ? `<span style="color:#b45309;font-weight:700">${r.missing} missing</span>` : "Complete"}</td>
      <td><button type="button" class="btn small primary" data-file="${bkEsc(r.run_id)}">Download file</button></td>
    </tr>`).join("") : '<tr class="empty-row"><td colspan="6">No processed payrolls yet. Process a payroll first.</td></tr>';
}

/* ---------- editing ---------- */
function bkOpen(id) {
  const a = bkAccounts.find((x) => x.employee_id === id);
  if (!a) return;
  bkEditing = a;
  const field = (fid, label, value, extra = "") => `<div class="field"><label for="${fid}">${label}</label><input id="${fid}" value="${bkEsc(value || "")}" ${extra}></div>`;

  const bankCode = a.institution_id ? a.institution_id.slice(5) : (BK_BANKS.find((b) => b[1] === a.bank_name) || [""])[0];
  bkEl("bankDialogBox").innerHTML = `
    <h3 id="bankDialogTitle">Bank account for ${bkEsc(a.name)}</h3>
    <div class="form-grid">
      <div class="field"><label for="bkBank">Bank</label><select id="bkBank"><option value="">Choose the bank</option>
        ${BK_BANKS.map(([code, name]) => `<option value="${code}"${code === bankCode ? " selected" : ""}>${bkEsc(name)}</option>`).join("")}</select></div>
      <div class="field"><label for="bkBranch">Branch</label><select id="bkBranch"></select></div>
      ${field("bkAcct", "Account number", a.account_number, 'inputmode="numeric" maxlength="24" autocomplete="off"')}
      <div class="field"><label for="bkType">Account type</label><select id="bkType">
        <option value="savings"${a.account_type !== "chequing" ? " selected" : ""}>Savings</option>
        <option value="chequing"${a.account_type === "chequing" ? " selected" : ""}>Chequing</option></select></div>
      ${field("bkName", "Name on the account (if different)", a.account_name, 'maxlength="80" autocomplete="off"')}
    </div>
    <p class="muted small">Copy the details from the employee's bank letter or a void cheque, and check every digit. The bank and branch lists are NCB's official ACH codes. To remove the details, choose "Choose the bank", clear the account number and save.</p>
    <div id="bkDialogMsg" class="form-message" role="status"></div>
    <div class="dialog-actions">
      <button type="button" class="btn" data-bk="close">Cancel</button>
      <button type="button" class="btn primary" data-bk="save">Save</button>
    </div>`;
  bkFillBranches(a.institution_id ? a.institution_id.slice(0, 5) : "");
  bkEl("bankDialog").hidden = false;
  bkEl("bkBank").focus();
}

function bkFillBranches(selected) {
  const code = bkEl("bkBank").value;
  const list = BK_BRANCHES[code] || [];
  bkEl("bkBranch").innerHTML = code
    ? `<option value="">Choose the branch</option>` + list.map(([br, name]) => `<option value="${br}"${br === selected ? " selected" : ""}>${bkEsc(name)}</option>`).join("")
    : '<option value="">Choose the bank first</option>';
}

function bkClose() { bkEl("bankDialog").hidden = true; bkEl("bankDialogBox").innerHTML = ""; bkEditing = null; }

async function bkSave() {
  const msg = bkEl("bkDialogMsg");
  const acct = bkEl("bkAcct").value.replace(/[\s-]/g, "");
  const code = bkEl("bkBank").value;
  const branch = bkEl("bkBranch").value;
  const bank = code ? (BK_BANKS.find((b) => b[0] === code) || ["", ""])[1] : "";
  const branchName = branch ? ((BK_BRANCHES[code] || []).find((b) => b[0] === branch) || ["", ""])[1] : "";

  if ((bank || acct) && !/^[0-9]{4,20}$/.test(acct)) { msg.textContent = "The account number must be 4 to 20 digits."; msg.className = "form-message error"; return; }
  if (acct && !bank) { msg.textContent = "Choose the bank."; msg.className = "form-message error"; return; }
  if (bank && !branch) { msg.textContent = "Choose the branch."; msg.className = "form-message error"; return; }

  const { error } = await supabaseClient.rpc("set_bank_account", {
    p_workspace: BK_WORKSPACE, p_employee: bkEditing.employee_id, p_bank: bank, p_branch: branchName,
    p_account: acct, p_type: bkEl("bkType").value, p_name: bkEl("bkName").value.trim(), p_institution: bank ? branch + code : null
  });

  if (error) { msg.textContent = error.message || "The bank details were not saved."; msg.className = "form-message error"; return; }
  bkClose();
  bkMessage("Bank details saved.", "ok");
  await bkLoad();
}

/* ---------- the payment file ---------- */
const bkToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function bkFileOpen(runId) {
  const run = bkRuns.find((r) => r.run_id === runId);
  if (!run) return;
  bkFileRun = run;
  const pay = String(run.pay_date || run.period_end).slice(0, 10);
  const when = pay > bkToday() ? pay : bkToday();

  bkEl("bankDialogBox").innerHTML = `
    <h3 id="bankDialogTitle">Pay ${bkEsc(bkPeriod(run.period_start, run.period_end))}</h3>
    <p>${run.people} ${run.people === 1 ? "person" : "people"}, total net pay <strong>${bkMoney(run.total_net)}</strong>.${run.missing ? ` <span style="color:#b45309;font-weight:700">${run.missing} without complete bank details will be left out.</span>` : ""}</p>
    <div class="form-grid">
      <div class="field"><label for="bkOrig">NCB Originator ID</label><input id="bkOrig" value="${bkEsc(bkSettings.originator_id || "")}" maxlength="10" autocomplete="off">
        <small>The ACH code NCB gave your company. Ask your NCB business banker if you do not have it.</small></div>
      <div class="field"><label for="bkCo">Company account number (pays the salaries)</label><input id="bkCo" value="${bkEsc(bkSettings.company_account || "")}" inputmode="numeric" maxlength="24" autocomplete="off"></div>
      <div class="field"><label for="bkWhen">Payment date</label><input id="bkWhen" type="date" value="${when}"></div>
      <div class="field"><label for="bkWords">Description (10 characters)</label><input id="bkWords" value="Salary Pay" maxlength="10"></div>
    </div>
    <div id="bkDialogMsg" class="form-message" role="status"></div>
    <div class="dialog-actions" style="flex-wrap:wrap">
      <button type="button" class="btn" data-bk="close">Cancel</button>
      <button type="button" class="btn" data-bk="csv">CSV summary</button>
      <button type="button" class="btn primary" data-bk="ach">Download NCB ACH file (.txt)</button>
    </div>`;
  bkEl("bankDialog").hidden = false;
  bkEditing = { file: true };
}

function bkSaveBlob(name, text, type) {
  const blob = new Blob([text], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

async function bkFileDownload(kind) {
  const run = bkFileRun;
  const msg = bkEl("bkDialogMsg");
  const fail = (text) => { msg.textContent = text; msg.className = "form-message error"; };
  const { data, error } = await supabaseClient.rpc("bank_payment_lines", { p_workspace: BK_WORKSPACE, p_run: run.run_id });
  if (error) return fail(error.message || "The payment file could not be made.");

  const label = bkPeriod(run.period_start, run.period_end);
  const lines = data || [];
  const stamp = String(run.period_end).slice(0, 7).replace("-", "");
  let note;

  if (kind === "csv") {
    const file = bkBuildFile(lines, `Salary ${label}`.slice(0, 30));
    if (!file.count) return fail("Nobody in this payroll has bank details yet.");
    bkSaveBlob(`Bank_payments_${stamp}.csv`, file.csv, "text/csv;charset=utf-8;");
    note = `CSV downloaded: ${file.count} ${file.count === 1 ? "payment" : "payments"}, total ${bkMoney(file.total)}.`;
  } else {
    const orig = bkEl("bkOrig").value.trim();
    const co = bkEl("bkCo").value.replace(/[\s-]/g, "");
    const date = bkEl("bkWhen").value.replaceAll("-", "");
    const file = bkBuildAch({ companyAccount: co, originatorId: orig, narration: bkEl("bkWords").value, date, lines });
    if (file.errors.length) return fail(file.errors.join(" "));

    if (orig !== (bkSettings.originator_id || "") || co !== (bkSettings.company_account || "")) {
      const saved = await supabaseClient.rpc("bank_file_settings_set", { p_workspace: BK_WORKSPACE, p_originator: orig, p_account: co });
      if (saved.error) return fail(saved.error.message || "The NCB details could not be saved.");
      bkSettings = { originator_id: orig, company_account: co };
    }

    bkSaveBlob(`ACHFilePayments_${date}.txt`, file.text, "text/plain;charset=us-ascii");
    note = `NCB ACH file downloaded: ${file.count} ${file.count === 1 ? "payment" : "payments"}, total ${bkMoney(file.total)}. Upload it in NCB Business Online Banking as an ACH file and check this total before approving.`;
    if (file.missing.length) note += ` Not in the file (no complete bank details): ${file.missing.map((l) => l.name).join(", ")}. Pay them another way.`;
  }

  bkClose();
  bkMessage(note, "ok");
}

/* ---------- start ---------- */
async function bkStart() {
  document.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target : null;
    if (!t) return;
    const edit = t.closest("[data-edit]"); if (edit) return bkOpen(edit.dataset.edit);
    const file = t.closest("[data-file]"); if (file) return bkFileOpen(file.dataset.file);
    const act = t.closest("[data-bk]");
    if (act) {
      const a = act.dataset.bk;
      if (a === "save") return bkSave();
      if (a === "ach" || a === "csv") return bkFileDownload(a);
      return bkClose();
    }
    if (t.id === "bankDialog") bkClose();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && bkEditing) bkClose(); });
  document.addEventListener("change", (e) => { if (e.target.id === "bkBank") bkFillBranches(""); });

  if (await bkAllowed()) await bkLoad();
}

if (typeof window !== "undefined" && !window.__BK_TEST__) bkStart();
