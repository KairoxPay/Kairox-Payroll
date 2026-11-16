// Expenses (staff): approve or turn down expense claims, open receipts, export CSV, turn claims on (admin).
// Managers see only their own team; payroll, HR and viewers can see but not approve (phase38-expense-claims.sql).

const EX_WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
const exEl = (id) => document.getElementById(id);
const exEsc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const exYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const exMoney = (n) => `J$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const exDay = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
const EX_STATUS = { pending: ["Waiting", "#b45309"], approved: ["Approved", "#16a34a"], rejected: ["Not approved", "#b91c1c"], paid: ["Paid", "#2563eb"], cancelled: ["Cancelled", "#6f7285"] };

let exRows = [];
let exCanDecide = false;

function exMsg(text, kind) { const b = exEl("exMsg"); b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); }

// Totals by status (tested)
function exTotals(rows) {
  const t = { pending: 0, approved: 0, paid: 0, count: { pending: 0, approved: 0, paid: 0 } };
  rows.forEach((r) => { if (t[r.status] !== undefined) { t[r.status] += Number(r.amount) || 0; t.count[r.status] += 1; } });
  Object.keys(t).forEach((k) => { if (k !== "count") t[k] = Math.round(t[k] * 100) / 100; });
  return t;
}

function exRender() {
  const t = exTotals(exRows);
  exEl("exTotals").innerHTML = `<span style="color:#b45309">Waiting: ${exEsc(exMoney(t.pending))} (${t.count.pending})</span>
    <span style="color:#16a34a">Approved, to pay: ${exEsc(exMoney(t.approved))} (${t.count.approved})</span>
    <span style="color:#2563eb">Paid: ${exEsc(exMoney(t.paid))} (${t.count.paid})</span>`;

  const filter = exEl("exFilter").value;
  const list = exRows.filter((r) => filter === "all" || r.status === filter);
  exEl("exBody").innerHTML = list.length ? list.map((r) => {
    const st = EX_STATUS[r.status] || [r.status, "inherit"];
    const tick = r.status === "pending" && r.can_decide;
    const own = r.status === "pending" && !r.can_decide && exCanDecide;
    return `<tr>
      <td>${tick ? `<input type="checkbox" class="exTick" value="${exEsc(r.id)}" aria-label="Tick">` : ""}</td>
      <td><strong>${exEsc(r.name)}</strong>${r.employee_number ? `<small style="display:block;color:#6f7285">${exEsc(r.employee_number)}</small>` : ""}</td>
      <td>${exEsc(exDay(r.spent_on))}</td>
      <td><strong>${exEsc(r.category)}</strong><small style="display:block;color:#6f7285">${exEsc(r.description)}</small></td>
      <td class="num">${exEsc(exMoney(r.amount))}</td>
      <td><span style="color:${st[1]};font-weight:700">${exEsc(st[0])}</span>
        ${r.decided_by && r.status !== "pending" ? `<small style="display:block;color:#6f7285">by ${exEsc(r.decided_by)}</small>` : ""}
        ${r.paid_in ? `<small style="display:block;color:#6f7285">in payroll ${exEsc(r.paid_in)}</small>` : ""}
        ${r.decision_note ? `<small style="display:block;color:#6f7285">${exEsc(r.decision_note)}</small>` : ""}
        ${own ? '<small style="display:block;color:#6f7285">Your own claim: someone else approves it</small>' : ""}</td>
      <td>${r.receipt_path ? `<button type="button" class="btn small" data-receipt="${exEsc(r.receipt_path)}">Open</button>` : '<span class="muted small">None</span>'}</td></tr>`;
  }).join("") : `<tr class="empty-row"><td colspan="7">${filter === "pending" ? "Nothing is waiting for approval." : "No claims in these dates."}</td></tr>`;
  exEl("exAll").checked = false;
}

async function exLoad() {
  const { data, error } = await supabaseClient.rpc("expense_list", { p_workspace: EX_WS, p_from: exEl("exFrom").value, p_to: exEl("exTo").value });
  if (error) {
    const missing = error.code === "PGRST202" || /could not find the function/i.test(error.message || "");
    exEl("exBody").innerHTML = `<tr class="empty-row"><td colspan="7">${exEsc(missing ? "Expense claims are not set up yet. Run phase38-expense-claims.sql in Supabase, then refresh." : error.message || "Claims could not be loaded.")}</td></tr>`;
    return;
  }
  exRows = data || [];
  exRender();
}

function exTicked() { return [...document.querySelectorAll(".exTick:checked")].map((b) => b.value); }

async function exApprove() {
  const ids = exTicked();
  if (!ids.length) return exMsg("Tick the claims first.", "error");
  const { data, error } = await supabaseClient.rpc("decide_expenses", { p_workspace: EX_WS, p_ids: ids, p_approve: true, p_note: null });
  if (error) return exMsg(error.message || "Not saved.", "error");
  exMsg(`${data} ${data === 1 ? "claim" : "claims"} approved. Payroll adds them from each person's Pay items.`, "ok");
  await exLoad();
}

function exAskReason() {
  const ids = exTicked();
  if (!ids.length) return exMsg("Tick the claims first.", "error");
  exEl("exBox").innerHTML = `
    <h3 id="exTitle">Not approving ${ids.length} ${ids.length === 1 ? "claim" : "claims"}</h3>
    <div class="field"><label for="exReason">Reason (the employee sees this)</label>
      <input id="exReason" maxlength="200" placeholder="For example: no receipt, or not a work expense"></div>
    <div id="exDialogMsg" class="form-message" role="status"></div>
    <div class="dialog-actions"><button type="button" class="btn" data-ex="close">Cancel</button>
      <button type="button" class="btn primary" data-ex="reject">Save</button></div>`;
  exEl("exDialog").hidden = false;
  exEl("exReason").focus();
}

function exClose() { exEl("exDialog").hidden = true; exEl("exBox").innerHTML = ""; }

async function exReject() {
  const note = exEl("exReason").value.trim();
  const m = exEl("exDialogMsg");
  if (note.length < 3) { m.textContent = "Say why, so the employee knows."; m.className = "form-message error"; return; }
  const { data, error } = await supabaseClient.rpc("decide_expenses", { p_workspace: EX_WS, p_ids: exTicked(), p_approve: false, p_note: note });
  if (error) { m.textContent = error.message || "Not saved."; m.className = "form-message error"; return; }
  exClose();
  exMsg(`${data} ${data === 1 ? "claim" : "claims"} not approved. The employee can see the reason in My portal.`, "ok");
  await exLoad();
}

async function exOpenReceipt(path) {
  const win = window.open("", "_blank");
  const { data, error } = await supabaseClient.storage.from("expense-receipts").createSignedUrl(path, 300);
  if (error || !data) { if (win) win.close(); return exMsg("The receipt could not be opened.", "error"); }
  if (win) win.location.href = data.signedUrl; else window.location.href = data.signedUrl;
}

function exCsv() {
  const cell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  const lines = [["Employee", "Employee number", "Date spent", "Category", "Description", "Amount", "Status", "Decided by", "Reason", "Paid in payroll", "Claimed on"]].concat(
    exRows.map((r) => [r.name, r.employee_number || "", String(r.spent_on).slice(0, 10), r.category, r.description, Number(r.amount).toFixed(2),
      (EX_STATUS[r.status] || [r.status])[0], r.decided_by || "", r.decision_note || "", r.paid_in || "", exYmd(new Date(r.created_at))]));
  const blob = new Blob(["﻿" + lines.map((l) => l.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `Expense_claims_${exEl("exFrom").value}_to_${exEl("exTo").value}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}

document.addEventListener("click", (event) => {
  const t = event.target;
  if (!t || !t.closest) return;
  if (t.id === "exApprove") return exApprove();
  if (t.id === "exReject") return exAskReason();
  if (t.id === "exCsv") return exCsv();
  if (t.id === "exDialog") return exClose();
  const r = t.closest("[data-receipt]"); if (r) return exOpenReceipt(r.dataset.receipt);
  const act = t.closest("[data-ex]"); if (act) return act.dataset.ex === "reject" ? exReject() : exClose();
});

document.addEventListener("change", async (event) => {
  const t = event.target;
  if (t.id === "exFrom" || t.id === "exTo") { if (exEl("exFrom").value && exEl("exTo").value) exLoad(); return; }
  if (t.id === "exFilter") return exRender();
  if (t.id === "exAll") { document.querySelectorAll(".exTick").forEach((b) => { b.checked = t.checked; }); return; }
  if (t.id === "exEnabled") {
    const { error } = await supabaseClient.rpc("set_expenses_enabled", { p_workspace: EX_WS, p_on: t.checked });
    if (error) { t.checked = !t.checked; return exMsg(error.message || "Not saved.", "error"); }
    exMsg(t.checked ? "Employees can now claim expenses in My portal." : "Expense claims are off. Claims already sent are kept.", "ok");
  }
});

async function exStart() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data || !data.session) { window.location.href = "login.html?next=expenses.html"; return; }
  const { data: role } = await supabaseClient.rpc("get_my_role", { p_workspace: EX_WS });
  if (!["admin", "director", "payroll", "hr", "manager", "viewer"].includes(role)) {
    exEl("exBody").innerHTML = '<tr class="empty-row"><td colspan="7">Only staff can see expense claims. Employees claim theirs in My portal.</td></tr>';
    return;
  }
  exCanDecide = ["admin", "director", "manager"].includes(role);
  if (!exCanDecide) document.querySelectorAll("[data-decide]").forEach((b) => { b.hidden = true; });
  if (role === "admin") {
    exEl("exSwitchCard").hidden = false;
    const on = await supabaseClient.rpc("expenses_enabled", { p_workspace: EX_WS });
    exEl("exEnabled").checked = !on.error && on.data === true;
  }
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth() - 2, 1);
  exEl("exFrom").value = exYmd(from);
  exEl("exTo").value = exYmd(to);
  await exLoad();
}

if (!window.__EX_TEST__) exStart();
