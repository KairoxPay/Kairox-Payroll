// Bank payments page: "Bank details change requests" card. Employees ask in My portal; an admin, managing director or payroll
// officer approves after phoning the employee on a number already on file. Nothing changes until it is approved
// (phase40-bank-change-requests.sql). Admins and managing directors also get the on/off switch here.

(function () {
  const WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const mask = (n) => (n ? `•••• ${String(n).slice(-4)}` : "None");
  const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  const STATUS = { pending: ["Waiting", "#b45309"], approved: ["Approved", "#16a34a"], rejected: ["Not approved", "#b91c1c"], cancelled: ["Cancelled by employee", "#6f7285"] };

  let card = null;
  let rows = [];
  let role = null;

  function makeCard() {
    const main = document.querySelector("main") || document.body;
    card = document.createElement("section");
    card.className = "page-card";
    card.id = "bankRequestsCard";
    const first = main.querySelector("section.page-card");
    if (first && first.parentNode) first.parentNode.insertBefore(card, first); else main.appendChild(card);
  }

  function render(enabled) {
    const pending = rows.filter((r) => r.status === "pending");
    const done = rows.filter((r) => r.status !== "pending").slice(0, 10);
    const canSwitch = ["admin", "director"].includes(role);
    card.innerHTML = `
      <div class="page-card-head"><div><h3>Bank details change requests${pending.length ? ` <span style="background:#b45309;color:#fff;border-radius:999px;padding:1px 9px;font-size:13px">${pending.length}</span>` : ""}</h3>
        <p>Employees ask for their pay to go to a new account in My portal. Nothing changes until it is approved here.</p></div>
        ${canSwitch ? `<label class="settings-check" style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" id="brEnabled" ${enabled ? "checked" : ""}> Employees can request changes</label>` : ""}</div>
      <div id="brMsg" class="form-message" role="status"></div>
      ${pending.length ? `<p style="margin:0 0 10px;padding:10px 12px;border-radius:10px;background:#fff7ed;color:#8a4b00;font-weight:700">
          Before approving, phone the employee on the number you already have for them (not one in a message or email) and check the new account with them.
          Changing someone's account is the most common payroll fraud.</p>` : ""}
      <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th>Now</th><th>Change to</th><th>Asked</th><th>Status</th><th></th></tr></thead>
        <tbody>${pending.concat(done).map((r) => {
          const st = STATUS[r.status] || [r.status, "inherit"];
          return `<tr>
            <td><strong>${esc(r.name)}</strong>${r.phone ? `<small style="display:block;color:#6f7285">On file: ${esc(r.phone)}</small>` : '<small style="display:block;color:#b91c1c">No phone on file</small>'}</td>
            <td>${r.old_bank ? `${esc(r.old_bank)}<small style="display:block;color:#6f7285">${esc(r.old_branch || "")} ${esc(mask(r.old_account))}</small>` : '<span class="muted">No account yet</span>'}</td>
            <td><strong>${esc(r.new_bank)}</strong><small style="display:block;color:#6f7285">${esc(r.new_branch || "")} · ${r.account_type === "chequing" ? "Chequing" : "Savings"}</small>
              <span style="font-family:monospace;font-size:14px">${r.status === "pending" ? esc(r.new_account) : esc(mask(r.new_account))}</span>
              ${r.account_name ? `<small style="display:block;color:#6f7285">Name on account: ${esc(r.account_name)}</small>` : ""}</td>
            <td>${esc(when(r.requested_at))}</td>
            <td><span style="color:${st[1]};font-weight:700">${esc(st[0])}</span>${r.decided_by ? `<small style="display:block;color:#6f7285">by ${esc(r.decided_by)}</small>` : ""}${r.decision_note ? `<small style="display:block;color:#6f7285">${esc(r.decision_note)}</small>` : ""}</td>
            <td style="white-space:nowrap">${r.status === "pending" ? (r.own ? '<span class="muted small">Your own: someone else approves it</span>'
              : `<button type="button" class="btn small" data-br-no="${esc(r.id)}">Not approved</button> <button type="button" class="btn small primary" data-br-yes="${esc(r.id)}">Approve</button>`) : ""}</td></tr>`;
        }).join("") || `<tr class="empty-row"><td colspan="6">${enabled ? "No requests." : "No requests. Turn this on so employees can ask in My portal."}</td></tr>`}</tbody></table></div>`;
  }

  function say(text, kind) { const b = document.getElementById("brMsg"); if (b) { b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); } }

  async function load(message) {
    const [list, on] = await Promise.all([
      supabaseClient.rpc("bank_change_list", { p_workspace: WS }),
      supabaseClient.rpc("bank_changes_enabled", { p_workspace: WS })
    ]);
    if (list.error) {
      if (/could not find the function/i.test(list.error.message || "") || list.error.code === "PGRST202") { if (card) card.remove(); card = null; }
      return;
    }
    rows = list.data || [];
    if (!card) makeCard();
    render(!on.error && on.data === true);
    if (message) say(message, "ok");
  }

  function confirmBox(r, approve) {
    const back = document.createElement("div");
    back.className = "dialog-backdrop";
    back.id = "brDialog";
    back.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="brTitle" style="width:min(500px,100%)">
      <h3 id="brTitle">${approve ? "Approve" : "Do not approve"} the change for ${esc(r.name)}?</h3>
      ${approve ? `<p>Pay will go to <strong>${esc(r.new_bank)}</strong>${r.new_branch ? `, ${esc(r.new_branch)}` : ""}, account <strong style="font-family:monospace">${esc(r.new_account)}</strong> (${r.account_type === "chequing" ? "chequing" : "savings"}) from the next bank file.</p>
        <label class="pay-items-check" style="display:flex;gap:8px;align-items:flex-start;margin:10px 0"><input type="checkbox" id="brCalled">
          <span>I phoned ${esc(r.name.split(" ")[0])} on the number on file${r.phone ? ` (${esc(r.phone)})` : ""} and they confirmed this account.</span></label>` : ""}
      <div class="field"><label for="brNote">${approve ? "Note (optional)" : "Reason (the employee sees this)"}</label><input id="brNote" maxlength="200" placeholder="${approve ? "For example: confirmed by phone" : "For example: we could not reach you to confirm"}"></div>
      <div id="brDialogMsg" class="form-message" role="status"></div>
      <div class="dialog-actions"><button type="button" class="btn" data-br="close">Cancel</button><button type="button" class="btn primary" data-br="save">${approve ? "Approve" : "Save"}</button></div></div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener("click", async (event) => {
      const t = event.target;
      if (t === back || (t.closest && t.closest("[data-br=close]"))) return close();
      if (!(t.closest && t.closest("[data-br=save]"))) return;
      const m = back.querySelector("#brDialogMsg");
      const fail = (x) => { m.textContent = x; m.className = "form-message error"; };
      if (approve && !back.querySelector("#brCalled").checked) return fail("Tick the box once you have confirmed with the employee by phone.");
      const note = back.querySelector("#brNote").value.trim();
      if (!approve && note.length < 3) return fail("Say why, so the employee knows.");
      const { error } = await supabaseClient.rpc("decide_bank_change", { p_workspace: WS, p_id: r.id, p_approve: approve, p_note: note || (approve ? "Confirmed by phone" : null) });
      if (error) return fail(error.message || "Not saved.");
      close();
      await load(approve ? `Approved. ${r.name}'s pay goes to the new account from the next bank file.` : "Saved. The employee can see the reason in My portal.");
      if (approve && typeof bkLoad === "function") bkLoad();
    });
  }

  document.addEventListener("click", (event) => {
    const t = event.target;
    if (!t || !t.closest) return;
    const yes = t.closest("[data-br-yes]"); if (yes) return confirmBox(rows.find((r) => r.id === yes.dataset.brYes), true);
    const no = t.closest("[data-br-no]"); if (no) return confirmBox(rows.find((r) => r.id === no.dataset.brNo), false);
  });

  document.addEventListener("change", async (event) => {
    if (!event.target || event.target.id !== "brEnabled") return;
    const box = event.target;
    const { error } = await supabaseClient.rpc("set_bank_changes_enabled", { p_workspace: WS, p_on: box.checked });
    if (error) { box.checked = !box.checked; return say(error.message || "Not saved.", "error"); }
    await load(box.checked ? "Employees can now request bank changes in My portal. They still need approval here." : "Turned off. Requests already made stay here.");
  });

  async function start() {
    if (typeof supabaseClient === "undefined") return;
    const { data } = await supabaseClient.auth.getSession();
    if (!data || !data.session) return;
    const r = await supabaseClient.rpc("get_my_role", { p_workspace: WS });
    role = r.data;
    if (!["admin", "director", "payroll"].includes(role)) return;
    await load();
  }

  if (!window.__BR_TEST__) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  }
  window.kxBankRequestsLoad = load;
})();
