// Companies (Kairox Pay owners only): create a company for a new customer, invite its admin, open it to help, and see
// every company at a glance (phase46-new-companies.sql). Invitation emails go out through the optional "invite-user"
// Supabase function; without it the role still waits for the person, and they are invited in Supabase instead.

const cpEl = (id) => document.getElementById(id);
const cpEsc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const cpDay = (iso) => { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
const CP_ROLES = { admin: "Administrator", director: "Managing director", payroll: "Payroll / accounts officer", hr: "HR officer", manager: "Manager", viewer: "Viewer" };

let cpRows = [];

function cpMsg(text, kind) { const b = cpEl("cpMsg"); b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); }
function cpSignInPage() { return `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}set-password.html`; }

// Send the invitation email through the Supabase function. Returns a sentence for the person using the page.
async function cpInvite(workspace, email, role) {
  try {
    const { data, error } = await supabaseClient.functions.invoke("invite-user", { body: { workspace, email, role, redirectTo: cpSignInPage() } });
    if (!error && data && data.status === "invited") return `Invitation emailed to ${email}. Their role is ready for them when they set their password.`;
    if (!error && data && data.status === "assigned") return `${email} already had a login, so they have their role now.`;
    const status = error && error.context && error.context.status;
    if (error && (status === 404 || /FunctionsFetchError|FunctionsRelayError/.test(error.name || ""))) throw new Error("no function");
    let detail = (data && data.error) || "";
    if (error && error.context && typeof error.context.json === "function") { try { const j = await error.context.json(); detail = j.error || detail; } catch (x) { /* ignore */ } }
    if (status === 403) throw new Error(detail || "You cannot invite people to this company.");
    return `The role is saved for ${email}, but the email could not be sent${detail ? ` (${detail})` : ""}. Invite them in Supabase: Authentication, Users, Invite user.`;
  } catch (e) {
    // No invite-user function yet: record the role directly; it is applied when their login is created.
    const { data, error } = await supabaseClient.rpc("invite_to_company", { p_workspace: workspace, p_email: email, p_role: role });
    if (error) throw error;
    return data === "assigned" ? `${email} already had a login, so they have their role now.`
      : `Role saved for ${email}. Now invite them in Supabase (Authentication, Users, Invite user); they get the role as soon as their login is created.`;
  }
}

function cpRender() {
  cpEl("cpBody").innerHTML = cpRows.length ? cpRows.map((c) => `<tr>
      <td><strong>${cpEsc(c.name)}</strong><small style="display:block;color:#6f7285">Created ${cpEsc(cpDay(c.created_at))}${c.trn_set ? "" : " · No TRN yet"}</small></td>
      <td class="num">${c.employees}</td>
      <td class="num">${c.users}${c.pending ? `<small style="display:block;color:#b45309">${c.pending} invited</small>` : ""}</td>
      <td>${c.last_payroll ? `${cpEsc(cpDay(c.last_payroll))}<small style="display:block;color:#6f7285">${c.payrolls} processed</small>` : '<span class="muted">None yet</span>'}</td>
      <td>${c.my_role ? cpEsc(CP_ROLES[c.my_role] || c.my_role) : '<span class="muted">None</span>'}</td>
      <td style="white-space:nowrap">
        ${c.my_role ? `<button type="button" class="btn small primary" data-cp-open="${cpEsc(c.id)}">Open</button>` : `<button type="button" class="btn small" data-cp-support="${cpEsc(c.id)}">Open to help</button>`}
        <button type="button" class="btn small" data-cp-invite="${cpEsc(c.id)}">Invite</button>
        ${c.my_role ? `<button type="button" class="btn small" data-cp-leave="${cpEsc(c.id)}">Remove my access</button>` : ""}</td></tr>`).join("")
    : '<tr class="empty-row"><td colspan="6">No companies.</td></tr>';
}

async function cpLoad() {
  const { data, error } = await supabaseClient.rpc("companies_overview");
  if (error) {
    const missing = error.code === "PGRST202" || /could not find the function/i.test(error.message || "");
    cpEl("cpBody").innerHTML = `<tr class="empty-row"><td colspan="6">${cpEsc(missing ? "Run phase46-new-companies.sql in Supabase, then refresh." : error.message || "Could not load.")}</td></tr>`;
    return false;
  }
  cpRows = data || [];
  cpRender();
  return true;
}

function cpGo(id, page) {
  try { localStorage.setItem("kairoxWorkspace", id); } catch (e) { /* ignore */ }
  window.location.href = page || "setup.html";
}

async function cpCreate(event) {
  event.preventDefault();
  const name = cpEl("cpName").value.trim();
  const email = cpEl("cpAdmin").value.trim();
  if (name.length < 2) return cpMsg("Enter the company name.", "error");
  const joined = cpEl("cpJoin").checked;
  const btn = cpEl("cpCreate"); btn.disabled = true;
  const { data: id, error } = await supabaseClient.rpc("create_company", {
    p_name: name, p_legal: cpEl("cpLegal").value.trim() || null, p_trn: cpEl("cpTrn").value.trim() || null, p_parish: cpEl("cpParish").value || null,
    p_admin_email: null, p_join: joined
  });
  if (error) { btn.disabled = false; return cpMsg(error.message || "Not created.", "error"); }
  let note = "";
  if (email) {
    try { note = ` ${await cpInvite(id, email, "admin")}`; } catch (e) { note = ` The admin could not be invited: ${e.message || "error"}.`; }
  }
  btn.disabled = false;
  cpEl("cpForm").reset(); cpEl("cpForm").hidden = true; cpEl("cpToggle").hidden = false;
  cpMsg(`${name} created.${note}${joined ? " Open it to go through the Setup checklist." : ""}`, "ok");
  await cpLoad();
}

function cpInviteDialog(id) {
  const c = cpRows.find((x) => x.id === id);
  cpEl("cpBox").innerHTML = `
    <h3 id="cpDlgTitle">Invite someone to ${cpEsc(c.name)}</h3>
    <div class="form-grid">
      <div class="field"><label for="cpInvEmail">Email</label><input id="cpInvEmail" type="email" maxlength="120"></div>
      <div class="field"><label for="cpInvRole">Role</label><select id="cpInvRole">${Object.entries(CP_ROLES).map(([k, v]) => `<option value="${k}">${cpEsc(v)}</option>`).join("")}</select></div>
    </div>
    <p class="muted small">Employees who only need My portal are linked on the company's Team & access page instead.</p>
    <div id="cpPending"></div>
    <div id="cpDlgMsg" class="form-message" role="status"></div>
    <div class="dialog-actions"><button type="button" class="btn" data-cp="close">Close</button><button type="button" class="btn primary" data-cp="send" data-id="${cpEsc(id)}">Invite</button></div>`;
  cpEl("cpDialog").hidden = false;
  cpShowPending(id);
}

async function cpShowPending(id) {
  const { data } = await supabaseClient.rpc("pending_invites", { p_workspace: id });
  const box = cpEl("cpPending");
  if (!box) return;
  box.innerHTML = (data || []).length ? `<p style="margin:10px 0 6px;font-weight:700">Waiting for their first sign-in</p>${data.map((p) =>
    `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:4px 0">${cpEsc(p.email)} · ${cpEsc(CP_ROLES[p.role] || p.role)}
      <button type="button" class="btn small" data-cp-cancel="${cpEsc(p.email)}" data-id="${cpEsc(id)}">Cancel</button></div>`).join("")}` : "";
}

document.addEventListener("click", async (event) => {
  const t = event.target;
  if (!t || !t.closest) return;
  if (t.id === "cpToggle") { cpEl("cpForm").hidden = false; t.hidden = true; cpEl("cpName").focus(); return; }
  if (t.id === "cpDialog" || t.closest("[data-cp=close]")) { cpEl("cpDialog").hidden = true; return; }
  const open = t.closest("[data-cp-open]"); if (open) return cpGo(open.dataset.cpOpen, "dashboard-v2.html");
  const sup = t.closest("[data-cp-support]");
  if (sup) {
    const { error } = await supabaseClient.rpc("owner_access", { p_workspace: sup.dataset.cpSupport, p_on: true });
    if (error) return cpMsg(error.message || "Not opened.", "error");
    return cpGo(sup.dataset.cpSupport, "dashboard-v2.html");
  }
  const leave = t.closest("[data-cp-leave]");
  if (leave) {
    const { error } = await supabaseClient.rpc("owner_access", { p_workspace: leave.dataset.cpLeave, p_on: false });
    if (error) return cpMsg(error.message || "Not changed.", "error");
    cpMsg("Your access to that company has been removed. It is recorded in their audit trail.", "ok");
    return cpLoad();
  }
  const inv = t.closest("[data-cp-invite]"); if (inv) return cpInviteDialog(inv.dataset.cpInvite);
  const cancel = t.closest("[data-cp-cancel]");
  if (cancel) { await supabaseClient.rpc("cancel_invite", { p_workspace: cancel.dataset.id, p_email: cancel.dataset.cpCancel }); await cpShowPending(cancel.dataset.id); return cpLoad(); }
  const send = t.closest("[data-cp=send]");
  if (send) {
    const m = cpEl("cpDlgMsg");
    const email = cpEl("cpInvEmail").value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { m.textContent = "Enter a valid email address."; m.className = "form-message error"; return; }
    send.disabled = true;
    try {
      const text = await cpInvite(send.dataset.id, email, cpEl("cpInvRole").value);
      m.textContent = text; m.className = "form-message ok"; cpEl("cpInvEmail").value = "";
      await cpShowPending(send.dataset.id); await cpLoad();
    } catch (e) { m.textContent = e.message || "Not invited."; m.className = "form-message error"; }
    send.disabled = false;
  }
});
document.addEventListener("submit", (event) => { if (event.target.id === "cpForm") cpCreate(event); });

async function cpStart() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data || !data.session) { window.location.href = "login.html?next=companies.html"; return; }
  const { data: owner } = await supabaseClient.rpc("is_platform_owner");
  if (owner !== true) {
    cpEl("cpToggle").hidden = true;
    cpEl("cpBody").innerHTML = '<tr class="empty-row"><td colspan="6">Only the Kairox Pay owner can see this page.</td></tr>';
    return;
  }
  await cpLoad();
}

if (!window.__CP_TEST__) cpStart();
