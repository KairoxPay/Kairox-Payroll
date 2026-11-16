// Timesheets (staff): approve or reject clocked hours, add or correct entries, turn clock-in on (admin), export CSV.
// Managers see only their own team; the database decides who sees what (phase37-timesheets.sql).

const TS_WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
const tsEl = (id) => document.getElementById(id);
const tsEsc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const tsYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tsHours = (mins) => (Math.round((Number(mins) || 0) / 6) / 10).toFixed(1);
const tsTime = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—");
const tsDay = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const TS_STATUS = { open: ["Clocked in", "#6d28d9"], pending: ["Waiting", "#b45309"], approved: ["Approved", "#16a34a"], rejected: ["Rejected", "#b91c1c"] };

let tsRows = [];
let tsPeople = [];
let tsRole = null;

function tsMsg(text, kind) { const b = tsEl("tsMsg"); b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); }

// Monday of the week containing d (tested)
function tsMonday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

function tsSetWeek(monday) {
  const end = new Date(monday); end.setDate(end.getDate() + 6);
  tsEl("tsFrom").value = tsYmd(monday);
  tsEl("tsTo").value = tsYmd(end);
}

// Summary per employee (tested)
function tsSummarise(rows) {
  const by = new Map();
  rows.forEach((r) => {
    const s = by.get(r.employee_id) || { name: r.name, approved: 0, pending: 0, open: 0 };
    if (r.status === "approved") s.approved += r.minutes;
    if (r.status === "pending") s.pending += r.minutes;
    if (r.status === "open") s.open += 1;
    by.set(r.employee_id, s);
  });
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function tsRender() {
  const from = tsEl("tsFrom").value;
  const to = tsEl("tsTo").value;
  const thisMon = tsYmd(tsMonday(new Date()));
  tsEl("tsRangeTitle").textContent = from === thisMon ? "This week" : `${tsDay(`${from}T12:00:00`)} to ${tsDay(`${to}T12:00:00`)}`;
  tsEl("tsRangeSub").textContent = `${tsRows.length} ${tsRows.length === 1 ? "entry" : "entries"}. Hours shown to one decimal place.`;

  const sum = tsSummarise(tsRows);
  tsEl("tsSummary").innerHTML = sum.length ? sum.map((s) => `<tr><td><strong>${tsEsc(s.name)}</strong></td>
      <td class="num">${tsHours(s.approved)}</td><td class="num">${s.pending ? `<strong style="color:#b45309">${tsHours(s.pending)}</strong>` : "0.0"}</td>
      <td class="num">${s.open ? "Yes" : ""}</td></tr>`).join("") : '<tr class="empty-row"><td colspan="4">No hours in these dates.</td></tr>';

  const filter = tsEl("tsFilter").value;
  const list = tsRows.filter((r) => filter === "all" || r.status === "pending");
  tsEl("tsBody").innerHTML = list.length ? list.map((r) => {
    const st = TS_STATUS[r.status] || [r.status, "inherit"];
    const d = new Date(r.clock_in);
    const special = d.getDay() === 0 ? "Sunday" : r.holiday || "";
    return `<tr>
      <td>${r.status === "open" ? "" : `<input type="checkbox" class="tsTick" value="${tsEsc(r.id)}" aria-label="Tick">`}</td>
      <td><strong>${tsEsc(r.name)}</strong></td>
      <td>${tsEsc(tsDay(r.clock_in))}${special ? `<small style="display:block;color:#6d28d9;font-weight:700">${tsEsc(special)}: double time</small>` : ""}</td>
      <td>${tsEsc(tsTime(r.clock_in))}</td><td>${tsEsc(tsTime(r.clock_out))}</td>
      <td class="num">${tsHours(r.minutes)}</td>
      <td><span style="color:${st[1]};font-weight:700">${st[0]}</span>${r.source === "manual" ? '<small style="display:block;color:#6f7285">Added by staff</small>' : ""}${r.note ? `<small style="display:block;color:#6f7285">${tsEsc(r.note)}</small>` : ""}</td>
      <td><button type="button" class="btn small" data-edit="${tsEsc(r.id)}">Correct</button></td></tr>`;
  }).join("") : `<tr class="empty-row"><td colspan="8">${filter === "pending" ? "Nothing is waiting for approval." : "No entries."}</td></tr>`;
  tsEl("tsAll").checked = false;
}

async function tsLoad() {
  const { data, error } = await supabaseClient.rpc("timesheet_entries", { p_workspace: TS_WS, p_from: tsEl("tsFrom").value, p_to: tsEl("tsTo").value });
  if (error) {
    const missing = error.code === "PGRST202" || /could not find the function/i.test(error.message || "");
    tsEl("tsBody").innerHTML = `<tr class="empty-row"><td colspan="8">${tsEsc(missing ? "Timesheets are not set up yet. Run phase37-timesheets.sql in Supabase, then refresh." : error.message || "Timesheets could not be loaded.")}</td></tr>`;
    return;
  }
  tsRows = data || [];
  tsRender();
}

async function tsDecide(approve) {
  const ids = [...document.querySelectorAll(".tsTick:checked")].map((b) => b.value);
  if (!ids.length) return tsMsg("Tick the entries first.", "error");
  const { data, error } = await supabaseClient.rpc("decide_time_entries", { p_workspace: TS_WS, p_ids: ids, p_approve: approve });
  if (error) return tsMsg(error.message || "Not saved.", "error");
  tsMsg(`${data} ${data === 1 ? "entry" : "entries"} ${approve ? "approved" : "rejected"}.`, "ok");
  await tsLoad();
}

/* ---------- add / correct ---------- */
const tsLocal = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function tsOpen(entry) {
  const people = tsPeople.map((p) => `<option value="${tsEsc(p.id)}">${tsEsc(p.name)}</option>`).join("");
  tsEl("tsBox").innerHTML = `
    <h3 id="tsTitle">${entry ? `Correct hours for ${tsEsc(entry.name)}` : "Add hours"}</h3>
    <div class="form-grid">
      ${entry ? "" : `<div class="field"><label for="tsEmp">Employee</label><select id="tsEmp"><option value="">Choose</option>${people}</select></div>`}
      <div class="field"><label for="tsIn">Started</label><input id="tsIn" type="datetime-local" value="${entry ? tsLocal(entry.clock_in) : ""}"></div>
      <div class="field"><label for="tsOut">Finished</label><input id="tsOut" type="datetime-local" value="${entry && entry.clock_out ? tsLocal(entry.clock_out) : ""}"></div>
      <div class="field"><label for="tsNote">Note</label><input id="tsNote" maxlength="200" value="${tsEsc(entry ? entry.note || "" : "")}" placeholder="For example: forgot to clock out"></div>
    </div>
    <p class="muted small">Saving approves these hours. The change is recorded in the audit trail.</p>
    <div id="tsDialogMsg" class="form-message" role="status"></div>
    <div class="dialog-actions"><button type="button" class="btn" data-ts="close">Cancel</button>
      <button type="button" class="btn primary" data-ts="save" data-id="${entry ? tsEsc(entry.id) : ""}">Save</button></div>`;
  tsEl("tsDialog").hidden = false;
}

function tsClose() { tsEl("tsDialog").hidden = true; tsEl("tsBox").innerHTML = ""; }

async function tsSave(id) {
  const msg = tsEl("tsDialogMsg");
  const fail = (t) => { msg.textContent = t; msg.className = "form-message error"; };
  const emp = id ? null : tsEl("tsEmp").value;
  const inV = tsEl("tsIn").value;
  const outV = tsEl("tsOut").value;
  if (!id && !emp) return fail("Choose the employee.");
  if (!inV || !outV) return fail("Enter when the shift started and finished.");
  if (new Date(outV) <= new Date(inV)) return fail("The finish must be after the start.");
  const { error } = await supabaseClient.rpc("save_time_entry", {
    p_workspace: TS_WS, p_id: id || null, p_employee: emp, p_in: new Date(inV).toISOString(), p_out: new Date(outV).toISOString(), p_note: tsEl("tsNote").value.trim()
  });
  if (error) return fail(error.message || "Not saved.");
  tsClose();
  tsMsg("Saved and approved.", "ok");
  await tsLoad();
}

function tsCsv() {
  const cell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  const lines = [["Employee", "Employee number", "Date", "In", "Out", "Hours", "Status", "Sunday or public holiday", "Note"]].concat(
    tsRows.map((r) => [r.name, r.employee_number || "", tsYmd(new Date(r.clock_in)), tsTime(r.clock_in), tsTime(r.clock_out), tsHours(r.minutes),
      (TS_STATUS[r.status] || [r.status])[0], new Date(r.clock_in).getDay() === 0 ? "Sunday" : r.holiday || "", r.note || ""]));
  const blob = new Blob(["﻿" + lines.map((l) => l.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `Timesheets_${tsEl("tsFrom").value}_to_${tsEl("tsTo").value}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- start ---------- */
document.addEventListener("click", (event) => {
  const t = event.target;
  if (!t.closest) return;
  const shift = (days) => { const d = new Date(`${tsEl("tsFrom").value}T12:00:00`); d.setDate(d.getDate() + days); tsSetWeek(tsMonday(d)); tsLoad(); };
  if (t.id === "tsPrev") return shift(-7);
  if (t.id === "tsNext") return shift(7);
  if (t.id === "tsThis") { tsSetWeek(tsMonday(new Date())); return tsLoad(); }
  if (t.id === "tsApprove") return tsDecide(true);
  if (t.id === "tsReject") return tsDecide(false);
  if (t.id === "tsAdd") return tsOpen(null);
  if (t.id === "tsCsv") return tsCsv();
  if (t.id === "tsDialog") return tsClose();
  const edit = t.closest("[data-edit]"); if (edit) return tsOpen(tsRows.find((r) => r.id === edit.dataset.edit));
  const act = t.closest("[data-ts]"); if (act) return act.dataset.ts === "save" ? tsSave(act.dataset.id) : tsClose();
});

document.addEventListener("change", async (event) => {
  const t = event.target;
  if (t.id === "tsFrom" || t.id === "tsTo") { if (tsEl("tsFrom").value && tsEl("tsTo").value) tsLoad(); return; }
  if (t.id === "tsFilter") return tsRender();
  if (t.id === "tsAll") { document.querySelectorAll(".tsTick").forEach((b) => { b.checked = t.checked; }); return; }
  if (t.id === "tsEnabled") {
    const { error } = await supabaseClient.rpc("set_timesheets_enabled", { p_workspace: TS_WS, p_on: t.checked });
    if (error) { t.checked = !t.checked; return tsMsg(error.message || "Not saved.", "error"); }
    tsMsg(t.checked ? "Employees can now clock in from My portal." : "Clock-in is off. Hours already recorded are kept.", "ok");
  }
});

async function tsStart() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data || !data.session) { window.location.href = "login.html?next=timesheets.html"; return; }
  const { data: role } = await supabaseClient.rpc("get_my_role", { p_workspace: TS_WS });
  tsRole = role;
  if (!["admin", "director", "payroll", "hr", "manager"].includes(role)) {
    tsEl("tsBody").innerHTML = '<tr class="empty-row"><td colspan="8">Only admins, managing directors, payroll and HR officers and managers can see timesheets.</td></tr>';
    return;
  }
  if (role === "admin") {
    tsEl("tsSwitchCard").hidden = false;
    const on = await supabaseClient.rpc("timesheets_enabled", { p_workspace: TS_WS });
    tsEl("tsEnabled").checked = !on.error && on.data === true;
  }
  const people = await supabaseClient.rpc("people_directory", { p_workspace: TS_WS });
  tsPeople = (people.data || []).filter((p) => !/archived|terminated|left/i.test(p.employment_status || ""));
  tsSetWeek(tsMonday(new Date()));
  await tsLoad();
}

if (!window.__TS_TEST__) tsStart();
