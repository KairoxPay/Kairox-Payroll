// WhatsApp messages (staff): ready-made messages for payslips, leave decisions and expense claims, plus a message to staff.
// "Send" opens WhatsApp (app or web) with the text typed in; nothing is sent until the person presses send in WhatsApp.
// Free: it uses wa.me links, so no WhatsApp Business account or provider is needed (phase39-whatsapp-messages.sql).

const WA_WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
const waEl = (id) => document.getElementById(id);
const waEsc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const waDate = (iso, withYear) => {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: withYear === "day" ? "short" : undefined, day: "numeric", month: "short", year: withYear ? "numeric" : undefined });
};
const waWhen = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

let waRows = [];
let waPeople = [];
let waCompany = "";

function waMsg(text, kind) { const b = waEl("waMsg"); b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); }

// Phone number to the digits WhatsApp wants (country code, no +). Jamaican numbers may be written many ways (tested).
function waNumber(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  let d = s.replace(/\D/g, "");
  if (s.startsWith("+")) return d.length >= 8 && d.length <= 15 ? d : "";
  if (d.startsWith("011")) d = d.slice(3);                       // dialled from Jamaica to abroad
  if (d.length === 7) return `1876${d}`;                          // local number
  if (d.length === 10 && /^(876|658)/.test(d)) return `1${d}`;    // 876-555-1234
  if (d.length === 11 && d.startsWith("1")) return d;             // 1-876-..., or a US/Canada number
  if (d.length === 10) return `1${d}`;                            // other North American numbers
  return d.length >= 11 && d.length <= 15 ? d : "";
}

function waFirst(name) { return String(name || "").trim().split(/\s+/)[0] || "there"; }
function waPortal() { return `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}me.html`; }
function waSign() { return waCompany ? `\n\n${waCompany}` : ""; }

// The message for one row (tested). Deliberately no pay figures, leave type or reasons.
function waText(r) {
  const hi = `Hi ${waFirst(r.name)},`;
  const link = waPortal();
  if (r.kind === "payslip") {
    return `${hi} your payslip for ${waDate(r.period_start)} to ${waDate(r.period_end, true)} is ready. You can see it and download it in My portal: ${link}${waSign()}`;
  }
  if (r.kind === "leave") {
    const days = r.period_start === r.period_end ? `on ${waDate(r.period_start, true)}` : `from ${waDate(r.period_start)} to ${waDate(r.period_end, true)}`;
    return r.status === "approved"
      ? `${hi} your leave ${days} has been approved. Details are in My portal: ${link}${waSign()}`
      : `${hi} your leave request ${days} was not approved. Please see My portal for details, or speak with your manager: ${link}${waSign()}`;
  }
  if (r.kind === "expense") {
    const what = `your expense claim for ${String(r.category || "").toLowerCase()} on ${waDate(r.spent_on, true)}`;
    if (r.status === "approved") return `${hi} ${what} has been approved. It will be paid with your next payroll.${waSign()}`;
    if (r.status === "paid") return `${hi} ${what} has been paid with your payroll.${waSign()}`;
    return `${hi} ${what} was not approved. The reason is in My portal: ${link}${waSign()}`;
  }
  return "";
}

function waLabel(r) {
  if (r.kind === "payslip") return `Payslip ready: ${waDate(r.period_start)} – ${waDate(r.period_end, true)}`;
  if (r.kind === "leave") return `Leave ${r.status === "approved" ? "approved" : "not approved"}: ${waDate(r.period_start)}${r.period_end !== r.period_start ? ` – ${waDate(r.period_end, true)}` : ""}`;
  return `Expense claim ${r.status === "rejected" ? "not approved" : r.status}: ${r.category}, ${waDate(r.spent_on)}`;
}

// Expense claims can be messaged more than once (approved, then paid), so the status is part of the reference.
function waRef(r) { return r.kind === "expense" ? `${r.ref}:${r.status}` : r.ref; }

function waLink(number, text) { return `https://wa.me/${number}?text=${encodeURIComponent(text)}`; }

function waRender() {
  const todo = waEl("waFilter").value === "todo";
  const list = waRows.filter((r) => !todo || !r.sent_at);
  waEl("waBody").innerHTML = list.length ? list.map((r, i) => {
    const num = waNumber(r.phone);
    return `<tr><td><strong>${waEsc(r.name)}</strong></td><td>${waEsc(waLabel(r))}</td>
      <td>${num ? waEsc(r.phone) : '<span style="color:#b91c1c;font-weight:700">No phone number</span><small style="display:block;color:#6f7285">Add it on their profile</small>'}</td>
      <td>${r.sent_at ? `<span style="color:#16a34a;font-weight:700">Sent</span><small style="display:block;color:#6f7285">${waEsc(waWhen(r.sent_at))} by ${waEsc(r.sent_by)}</small>` : '<span style="color:#b45309;font-weight:700">Not sent</span>'}</td>
      <td>${num ? `<button type="button" class="btn small ${r.sent_at ? "" : "primary"}" data-wa-row="${waRows.indexOf(r)}">${r.sent_at ? "Send again" : "Send"}</button>` : ""}</td></tr>`;
  }).join("") : `<tr class="empty-row"><td colspan="5">${todo ? "Everyone has been messaged. Nothing new to send." : "Nothing in this period."}</td></tr>`;

  waEl("waPeople").innerHTML = waPeople.length ? waPeople.map((p, i) => {
    const num = waNumber(p.phone);
    return `<tr><td><strong>${waEsc(p.name)}</strong></td><td>${waEsc(p.department || "")}</td>
      <td>${num ? waEsc(p.phone) : '<span class="muted small">No phone number</span>'}</td>
      <td>${num ? `<button type="button" class="btn small" data-wa-person="${i}"${p.sent ? ' style="opacity:.6"' : ""}>${p.sent ? "Sent ✓" : "Send"}</button>` : ""}</td></tr>`;
  }).join("") : '<tr class="empty-row"><td colspan="4">No active employees.</td></tr>';
}

function waOpen(item) {
  waEl("waBox").innerHTML = `
    <h3 id="waTitle">WhatsApp to ${waEsc(item.name)}</h3>
    <div class="field"><label for="waEdit">Message (you can change it)</label><textarea id="waEdit" rows="6" maxlength="1500" style="width:100%">${waEsc(item.text)}</textarea></div>
    <p class="muted small">To ${waEsc(item.phone)}. WhatsApp opens in a new tab or the app; press send there. If the number is not on WhatsApp, WhatsApp will say so.</p>
    <div class="dialog-actions"><button type="button" class="btn" data-wa="close">Cancel</button>
      <a class="btn primary" id="waGo" href="${waEsc(waLink(item.number, item.text))}" target="_blank" rel="noopener">Open WhatsApp</a></div>`;
  waEl("waDialog").hidden = false;
  const go = waEl("waGo");
  waEl("waEdit").addEventListener("input", (e) => { go.href = waLink(item.number, e.target.value); });
  go.addEventListener("click", async () => {
    const { error } = await supabaseClient.rpc("whatsapp_mark_sent", { p_workspace: WA_WS, p_kind: item.kind, p_ref: item.ref, p_employee: item.employee_id });
    waClose();
    if (error) return waMsg(`WhatsApp opened, but it could not be marked as sent: ${error.message || "error"}`, "error");
    waMsg(`Opened WhatsApp for ${item.name}. Marked as sent.`, "ok");
    if (item.onSent) item.onSent();
    else await waLoad();
  });
}

function waClose() { waEl("waDialog").hidden = true; waEl("waBox").innerHTML = ""; }

async function waLoad() {
  const { data, error } = await supabaseClient.rpc("whatsapp_queue", { p_workspace: WA_WS, p_days: Number(waEl("waDays").value) });
  if (error) {
    const missing = error.code === "PGRST202" || /could not find the function/i.test(error.message || "");
    waEl("waBody").innerHTML = `<tr class="empty-row"><td colspan="5">${waEsc(missing ? "WhatsApp messages are not set up yet. Run phase39-whatsapp-messages.sql in Supabase, then refresh." : error.message || "Could not load.")}</td></tr>`;
    return;
  }
  waRows = data || [];
  waRender();
}

document.addEventListener("click", (event) => {
  const t = event.target;
  if (!t || !t.closest) return;
  if (t.id === "waDialog") return waClose();
  if (t.closest("[data-wa=close]")) return waClose();
  const row = t.closest("[data-wa-row]");
  if (row) {
    const r = waRows[Number(row.dataset.waRow)];
    return waOpen({ kind: r.kind, ref: waRef(r), employee_id: r.employee_id, name: r.name, phone: r.phone, number: waNumber(r.phone), text: waText(r) });
  }
  const person = t.closest("[data-wa-person]");
  if (person) {
    const p = waPeople[Number(person.dataset.waPerson)];
    const body = waEl("waText").value.trim();
    if (body.length < 3) { waMsg("Write the message first.", "error"); waEl("waText").focus(); return; }
    return waOpen({
      kind: "message", ref: `message:${new Date().toISOString().slice(0, 10)}`, employee_id: p.employee_id, name: p.name, phone: p.phone, number: waNumber(p.phone),
      text: body.replaceAll("{name}", waFirst(p.name)) + waSign(), onSent: () => { p.sent = true; waRender(); }
    });
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "waFilter") waRender();
  if (event.target.id === "waDays") waLoad();
});

async function waStart() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data || !data.session) { window.location.href = "login.html?next=whatsapp.html"; return; }
  const { data: role } = await supabaseClient.rpc("get_my_role", { p_workspace: WA_WS });
  if (!["admin", "director", "payroll", "hr"].includes(role)) {
    waEl("waBody").innerHTML = '<tr class="empty-row"><td colspan="5">Only admins, managing directors, payroll and HR officers can send WhatsApp messages.</td></tr>';
    waEl("waPeople").innerHTML = "";
    return;
  }
  const co = await supabaseClient.from("company_profile").select("company_name, trading_name").eq("workspace", WA_WS).maybeSingle();
  if (co && co.data) waCompany = co.data.trading_name || co.data.company_name || "";
  const people = await supabaseClient.rpc("whatsapp_people", { p_workspace: WA_WS });
  waPeople = people.data || [];
  await waLoad();
}

if (!window.__WA_TEST__) waStart();
