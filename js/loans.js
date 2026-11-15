// Loans and advances: records, repayment history and statements. The arithmetic (who owes what, which payroll paid
// which loan) is done by the database (phase34-loans.sql); this page shows it and records new loans.

const LN_WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
const lnEl = (id) => document.getElementById(id);
const lnEsc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const lnMoney = (n) => `JMD ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lnDay = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(y, m - 1, d));
};
const lnToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

let lnRows = [];
let lnPeople = [];
let lnCanWrite = false;
let lnCompany = "";

function lnMsg(text, kind) { const b = lnEl("lnMsg"); b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); }

// Pure: the status words for a row (tested).
function lnStatus(r) {
  if (r.status === "legacy") return { text: "Before loan records", tone: "#6f7285" };
  if (r.status === "cancelled") return { text: "Cancelled", tone: "#6f7285" };
  if (Number(r.outstanding) <= 0) return { text: "Paid off", tone: "#16a34a" };
  return { text: "Being repaid", tone: "#6d28d9" };
}

function lnRender() {
  const showDone = lnEl("lnShowDone").checked;
  const rows = lnRows.filter((r) => showDone || r.status === "legacy" || (r.status === "open" && Number(r.outstanding) > 0));

  lnEl("lnBody").innerHTML = rows.length ? rows.map((r) => {
    const st = lnStatus(r);
    const kind = r.status === "legacy" ? "" : r.kind === "advance" ? "Salary advance" : "Loan";
    const actions = r.status === "legacy"
      ? (lnCanWrite ? `<button type="button" class="btn small" data-legacy="${lnEsc(r.employee_id)}">Record as a loan</button>` : "")
      : `<button type="button" class="btn small" data-history="${lnEsc(r.loan_id)}">History</button>
         ${lnCanWrite && r.status === "open" && Number(r.outstanding) > 0 ? `<button type="button" class="btn small" data-change="${lnEsc(r.loan_id)}">Change</button>` : ""}`;
    return `<tr>
      <td><strong>${lnEsc(r.name)}</strong>${r.employee_number ? `<small style="display:block;color:#6f7285">${lnEsc(r.employee_number)}</small>` : ""}</td>
      <td>${lnEsc(kind)}${r.description ? `<small style="display:block;color:#6f7285">${lnEsc(r.description)}</small>` : ""}</td>
      <td>${lnEsc(lnDay(r.issued_on))}</td>
      <td class="num">${lnMoney(r.amount)}</td>
      <td class="num">${r.status === "legacy" ? "—" : lnMoney(r.repaid)}</td>
      <td class="num"><strong>${lnMoney(r.outstanding)}</strong></td>
      <td class="num">${lnMoney(r.installment)}</td>
      <td><span style="color:${st.tone};font-weight:700">${st.text}</span>${r.cancel_reason ? `<small style="display:block;color:#6f7285">${lnEsc(r.cancel_reason)}</small>` : ""}</td>
      <td><div class="row-actions">${actions}</div></td></tr>`;
  }).join("") : `<tr class="empty-row"><td colspan="9">${lnRows.length ? "Nothing is owed. Tick \"Show paid off and cancelled\" to see older loans." : "No loans or advances yet."}</td></tr>`;

  const owed = rows.reduce((t, r) => t + Number(r.outstanding || 0), 0);
  lnEl("lnFoot").innerHTML = rows.length ? `<tr><th colspan="5">Total still owed</th><th class="num">${lnMoney(owed)}</th><th colspan="3"></th></tr>` : "";
}

async function lnLoad() {
  const { data, error } = await supabaseClient.rpc("loans_overview", { p_workspace: LN_WS });
  if (error) {
    const missing = error.code === "PGRST202" || /could not find the function/i.test(error.message || "");
    lnEl("lnBody").innerHTML = `<tr class="empty-row"><td colspan="9">${lnEsc(missing ? "Loans are not set up yet. Run phase34-loans.sql in Supabase, then refresh." : error.message || "Loans could not be loaded.")}</td></tr>`;
    return;
  }
  lnRows = (data || []).sort((a, b) => a.name.localeCompare(b.name) || String(a.issued_on || "").localeCompare(String(b.issued_on || "")));
  lnRender();
}

/* ---------- dialogs ---------- */
function lnOpen(html) { lnEl("lnBox").innerHTML = html; lnEl("lnDialog").hidden = false; }
function lnClose() { lnEl("lnDialog").hidden = true; lnEl("lnBox").innerHTML = ""; }
function lnDialogMsg(text) { const b = lnEl("lnDialogMsg"); if (b) { b.textContent = text; b.className = "form-message error"; } }

function lnAddDialog(prefill = {}) {
  const people = lnPeople.map((p) => `<option value="${lnEsc(p.id)}"${p.id === prefill.employee_id ? " selected" : ""}>${lnEsc(p.name)}</option>`).join("");
  lnOpen(`
    <h3 id="lnTitle">${prefill.legacy ? "Record the existing balance as a loan" : "Add a loan or salary advance"}</h3>
    <div class="form-grid">
      <div class="field"><label for="lnEmp">Employee</label><select id="lnEmp"${prefill.legacy ? " disabled" : ""}><option value="">Choose</option>${people}</select></div>
      <div class="field"><label for="lnKind">Type</label><select id="lnKind"><option value="loan">Loan</option><option value="advance">Salary advance</option></select></div>
      <div class="field"><label for="lnDesc">What it is for (optional)</label><input id="lnDesc" maxlength="120" value="${lnEsc(prefill.description || "")}"></div>
      <div class="field"><label for="lnIssued">Date given</label><input id="lnIssued" type="date" value="${lnEsc(prefill.issued_on || lnToday())}"></div>
      <div class="field"><label for="lnAmount">Amount still owed today (J$)</label><input id="lnAmount" inputmode="decimal" value="${lnEsc(prefill.amount || "")}"></div>
      <div class="field"><label for="lnInst">Repayment from each payroll (J$)</label><input id="lnInst" inputmode="decimal" value="${lnEsc(prefill.installment || "")}"></div>
    </div>
    <p class="muted small">Enter what is still owed today. Only payrolls processed from now on count as repayments, so an older loan that has
      already had some repayments should be entered with its remaining balance. A draft payroll that is already open keeps its old loan figure:
      open its Pay items to update it.</p>
    <div id="lnDialogMsg" class="form-message" role="status"></div>
    <div class="dialog-actions"><button type="button" class="btn" data-ln="close">Cancel</button>
      <button type="button" class="btn primary" data-ln="save">Save</button></div>`);
}

async function lnSave() {
  const num = (id) => Number(String(lnEl(id).value).replace(/[,\s]/g, ""));
  const emp = lnEl("lnEmp").value;
  const amount = num("lnAmount");
  const inst = num("lnInst");
  if (!emp) return lnDialogMsg("Choose the employee.");
  if (!(amount > 0)) return lnDialogMsg("Enter the amount still owed.");
  if (!(inst > 0)) return lnDialogMsg("Enter the repayment from each payroll.");
  if (inst > amount) return lnDialogMsg("The repayment cannot be more than the amount owed.");

  const { error } = await supabaseClient.rpc("save_loan", {
    p_workspace: LN_WS, p_employee: emp, p_kind: lnEl("lnKind").value, p_description: lnEl("lnDesc").value.trim(),
    p_issued: lnEl("lnIssued").value || null, p_amount: amount, p_installment: inst
  });
  if (error) return lnDialogMsg(error.message || "The loan was not saved.");
  lnClose();
  lnMsg("Saved. The repayment will come out of the next payroll prepared for this employee.", "ok");
  await lnLoad();
}

function lnChangeDialog(id) {
  const r = lnRows.find((x) => x.loan_id === id);
  if (!r) return;
  lnOpen(`
    <h3 id="lnTitle">${r.kind === "advance" ? "Salary advance" : "Loan"} for ${lnEsc(r.name)}</h3>
    <p>Still owed <strong>${lnMoney(r.outstanding)}</strong> of ${lnMoney(r.amount)}.</p>
    <div class="form-grid">
      <div class="field"><label for="lnDesc">What it is for</label><input id="lnDesc" maxlength="120" value="${lnEsc(r.description || "")}"></div>
      <div class="field"><label for="lnInst">Repayment from each payroll (J$)</label><input id="lnInst" inputmode="decimal" value="${lnEsc(r.installment)}"></div>
    </div>
    <details style="margin:8px 0 12px"><summary style="cursor:pointer;font-weight:700">Cancel or write off what is still owed</summary>
      <div class="field" style="margin-top:8px"><label for="lnReason">Reason (kept in the audit trail)</label><input id="lnReason" maxlength="200" placeholder="For example: written off by the managing director"></div>
      <button type="button" class="btn danger" data-ln="cancel" data-id="${lnEsc(id)}">Cancel the rest of this loan</button>
    </details>
    <div id="lnDialogMsg" class="form-message" role="status"></div>
    <div class="dialog-actions"><button type="button" class="btn" data-ln="close">Close</button>
      <button type="button" class="btn primary" data-ln="update" data-id="${lnEsc(id)}">Save changes</button></div>`);
}

async function lnUpdate(id, cancel) {
  const inst = Number(String(lnEl("lnInst").value).replace(/[,\s]/g, ""));
  const reason = cancel ? lnEl("lnReason").value.trim() : "";
  if (cancel && reason.length < 5) return lnDialogMsg("Give a reason (at least 5 characters).");
  if (!cancel && !(inst > 0)) return lnDialogMsg("Enter the repayment from each payroll.");
  const { error } = await supabaseClient.rpc("update_loan", {
    p_workspace: LN_WS, p_loan: id, p_description: lnEl("lnDesc").value.trim(), p_installment: cancel ? null : inst, p_cancel: cancel, p_reason: reason
  });
  if (error) return lnDialogMsg(error.message || "The change was not saved.");
  lnClose();
  lnMsg(cancel ? "Cancelled. Nothing more will be deducted for it." : "Saved.", "ok");
  await lnLoad();
}

async function lnHistory(id) {
  const r = lnRows.find((x) => x.loan_id === id);
  if (!r) return;
  const { data, error } = await supabaseClient.rpc("loan_repayments", { p_workspace: LN_WS, p_loan: id });
  if (error) return lnMsg(error.message || "The history could not be loaded.", "error");

  let left = Number(r.amount);
  const rows = (data || []).map((p) => {
    left = Math.round((left - Number(p.amount)) * 100) / 100;
    return `<tr><td>${lnEsc(lnDay(p.pay_date))}</td><td>${lnEsc(lnDay(p.period_start))} – ${lnEsc(lnDay(p.period_end))}</td><td class="num">${lnMoney(p.amount)}</td><td class="num">${lnMoney(Math.max(0, left))}</td></tr>`;
  }).join("");

  const statement = `
    <h3 id="lnTitle">${r.kind === "advance" ? "Salary advance" : "Loan"} statement</h3>
    <p style="margin:0 0 10px"><strong>${lnEsc(r.name)}</strong>${r.employee_number ? ` (${lnEsc(r.employee_number)})` : ""} · ${lnEsc(lnCompany)}<br>
      ${r.description ? `${lnEsc(r.description)} · ` : ""}given ${lnEsc(lnDay(r.issued_on))} · ${lnMoney(r.amount)} · ${lnMoney(r.installment)} each payroll</p>
    <table class="data" style="width:100%"><thead><tr><th>Paid</th><th>Payroll</th><th class="num">Repaid</th><th class="num">Still owed</th></tr></thead>
      <tbody>${rows || '<tr class="empty-row"><td colspan="4">No repayments yet. The first comes out of the next processed payroll.</td></tr>'}</tbody>
      <tfoot><tr><th colspan="2">Total</th><th class="num">${lnMoney(r.repaid)}</th><th class="num">${lnMoney(r.outstanding)}</th></tr></tfoot></table>
    ${r.status === "cancelled" ? `<p class="small" style="margin-top:8px">Cancelled: ${lnEsc(r.cancel_reason || "")}</p>` : ""}
    <p class="small muted" style="margin-top:8px">Printed ${lnEsc(lnDay(lnToday()))}.</p>`;

  lnOpen(`${statement}
    <div class="dialog-actions"><button type="button" class="btn" data-ln="close">Close</button>
      <button type="button" class="btn primary" data-ln="print">Print statement</button></div>`);
  lnEl("lnBox").dataset.statement = statement;
}

function lnPrint() {
  const html = lnEl("lnBox").dataset.statement || "";
  const win = window.open("", "_blank");
  if (!win) return lnMsg("Allow pop-ups for this site to print the statement.", "error");
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Loan statement</title><style>
    body{font:13px/1.45 Arial,Helvetica,sans-serif;margin:24px;color:#111} table{border-collapse:collapse;width:100%}
    th,td{border-bottom:1px solid #ccc;padding:6px 4px;text-align:left} .num{text-align:right} .small{font-size:11px} .muted{color:#555}
  </style></head><body>${html}<script>window.onload=()=>window.print()<\/script></body></html>`);
  win.document.close();
}

/* ---------- start ---------- */
document.addEventListener("click", (event) => {
  const t = event.target;
  if (!t.closest) return;
  if (t.id === "lnAdd") return lnAddDialog();
  if (t.id === "lnDialog") return lnClose();
  const legacy = t.closest("[data-legacy]");
  if (legacy) {
    const r = lnRows.find((x) => x.status === "legacy" && x.employee_id === legacy.dataset.legacy);
    return lnAddDialog({ employee_id: r.employee_id, amount: r.legacy_balance, installment: r.legacy_installment, description: "Balance from before loan records", legacy: true });
  }
  const hist = t.closest("[data-history]"); if (hist) return lnHistory(hist.dataset.history);
  const chg = t.closest("[data-change]"); if (chg) return lnChangeDialog(chg.dataset.change);
  const act = t.closest("[data-ln]");
  if (act) {
    const a = act.dataset.ln;
    if (a === "close") return lnClose();
    if (a === "save") return lnSave();
    if (a === "update") return lnUpdate(act.dataset.id, false);
    if (a === "cancel") return lnUpdate(act.dataset.id, true);
    if (a === "print") return lnPrint();
  }
});
document.addEventListener("change", (event) => { if (event.target.id === "lnShowDone") lnRender(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !lnEl("lnDialog").hidden) lnClose(); });

async function lnStart() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data || !data.session) { window.location.href = "login.html?next=loans.html"; return; }
  const { data: role } = await supabaseClient.rpc("get_my_role", { p_workspace: LN_WS });
  if (!["admin", "director", "payroll", "viewer"].includes(role)) {
    lnEl("lnBody").innerHTML = '<tr class="empty-row"><td colspan="9">Only admins, managing directors, payroll officers and viewers can see loans.</td></tr>';
    return;
  }
  lnCanWrite = ["admin", "director", "payroll"].includes(role);
  lnEl("lnAdd").hidden = !lnCanWrite;

  const [people, profile] = await Promise.all([
    supabaseClient.from("employees").select("id, name, employment_status").eq("workspace", LN_WS).order("name"),
    supabaseClient.from("company_profile").select("company_name").eq("workspace", LN_WS).maybeSingle()
  ]);
  lnPeople = (people.data || []).filter((p) => !/archived|terminated|left/i.test(p.employment_status || ""));
  lnCompany = (profile.data && profile.data.company_name) || "";
  await lnLoad();
}

if (!window.__LN_TEST__) lnStart();
