// My portal: "Bank account for pay" card. Shows where pay goes (last 4 digits only) and lets the employee ask for a change.
// Payroll must approve it, usually after a phone call. Needs js/bank-codes.js on the page for the bank and branch lists.

(function () {
  const WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const BANKS = typeof KX_BANKS !== "undefined" ? KX_BANKS.filter((b) => b[0] !== "999") : [];
  const BRANCHES = typeof KX_BRANCHES !== "undefined" ? KX_BRANCHES : {};
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

  let card = null;
  let info = null;

  function makeCard() {
    const main = document.querySelector("main") || document.body;
    card = document.createElement("section");
    card.className = "page-card";
    card.id = "myBankCard";
    const after = document.getElementById("expenseCard") || document.getElementById("clockCard");
    const before = after ? after.nextSibling : main.querySelector("section, article, .page-card");
    if (before && before.parentNode) before.parentNode.insertBefore(card, before); else main.appendChild(card);
  }

  function render() {
    const i = info;
    const pending = i.request_status === "pending";
    const recent = !pending && i.request_status && i.request_status !== "cancelled";
    card.innerHTML = `
      <div class="page-card-head"><div><h3>Bank account for pay</h3>
        <p>${i.bank_name ? `Your pay goes to <strong>${esc(i.bank_name)}</strong>${i.branch ? `, ${esc(i.branch)}` : ""}, account ending <strong>${esc(i.account_ending)}</strong>.`
          : "We do not have a bank account for you yet."}</p></div>
        ${pending ? "" : `<button type="button" class="btn" id="mbNew">${i.bank_name ? "Change my bank account" : "Add my bank account"}</button>`}</div>
      ${pending ? `<p style="margin:0 0 10px;padding:10px 12px;border-radius:10px;background:#fff7ed;color:#8a4b00">
          <strong>Waiting for approval:</strong> ${esc(i.request_bank)}${i.request_branch ? `, ${esc(i.request_branch)}` : ""}, account ending ${esc(i.request_ending)} (asked ${esc(day(i.request_at))}).
          Payroll may phone you to check. Until it is approved, pay still goes to your current account.
          <button type="button" class="btn small" id="mbCancel" data-id="${esc(i.request_id)}" style="margin-left:6px">Cancel this change</button></p>` : ""}
      ${recent ? `<p class="muted small" style="margin:0 0 10px">Your last change (${esc(i.request_bank)}, ending ${esc(i.request_ending)}) was
          <strong>${i.request_status === "approved" ? "approved" : "not approved"}</strong>${i.request_note && i.request_status === "rejected" ? `: ${esc(i.request_note)}` : "."}</p>` : ""}
      <form id="mbForm" hidden style="border:1px solid #e3e4ec;border-radius:12px;padding:14px;margin:0 0 10px">
        <div class="form-grid">
          <div class="field"><label for="mbBank">Bank</label><select id="mbBank"><option value="">Choose your bank</option>${BANKS.map((b) => `<option value="${esc(b[0])}">${esc(b[1])}</option>`).join("")}</select></div>
          <div class="field"><label for="mbBranch">Branch</label><select id="mbBranch"><option value="">Choose the bank first</option></select></div>
          <div class="field"><label for="mbAcct">Account number</label><input id="mbAcct" inputmode="numeric" autocomplete="off" maxlength="24"></div>
          <div class="field"><label for="mbAcct2">Account number again</label><input id="mbAcct2" inputmode="numeric" autocomplete="off" maxlength="24"></div>
          <div class="field"><label for="mbType">Account type</label><select id="mbType"><option value="savings">Savings</option><option value="chequing">Chequing</option></select></div>
          <div class="field"><label for="mbName">Name on the account (optional)</label><input id="mbName" maxlength="80"></div>
        </div>
        <p class="muted small" style="margin:6px 0 10px">The account must be in your own name. Payroll will check it with you before it is used, and you will get an email.</p>
        <div id="mbFormMsg" class="form-message" role="status"></div>
        <div class="dialog-actions"><button type="button" class="btn" id="mbClose">Cancel</button><button type="submit" class="btn primary" id="mbSend">Send for approval</button></div>
      </form>
      <div id="mbMsg" class="form-message" role="status"></div>`;
  }

  function say(id, text, kind) { const b = document.getElementById(id); if (b) { b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); } }

  async function load(message) {
    const { data, error } = await supabaseClient.rpc("my_bank_details", { p_workspace: WS });
    if (error || !data || !data[0] || !data[0].enabled) { if (card) card.remove(); card = null; return; }
    info = data[0];
    if (!card) makeCard();
    render();
    if (message) say("mbMsg", message, "ok");
  }

  function fillBranches() {
    const code = document.getElementById("mbBank").value;
    const list = (BRANCHES[code] || []).slice().sort((a, b) => a[1].localeCompare(b[1]));
    document.getElementById("mbBranch").innerHTML = code
      ? `<option value="">Choose the branch</option>${list.map((b) => `<option value="${esc(b[0])}">${esc(b[1])}</option>`).join("")}`
      : '<option value="">Choose the bank first</option>';
  }

  async function send(event) {
    event.preventDefault();
    const code = document.getElementById("mbBank").value;
    const branch = document.getElementById("mbBranch").value;
    const acct = document.getElementById("mbAcct").value.replace(/[\s-]/g, "");
    const acct2 = document.getElementById("mbAcct2").value.replace(/[\s-]/g, "");
    if (!code) return say("mbFormMsg", "Choose your bank.", "error");
    if (!branch) return say("mbFormMsg", "Choose your branch.", "error");
    if (!/^\d{4,20}$/.test(acct)) return say("mbFormMsg", "The account number must be 4 to 20 digits.", "error");
    if (acct !== acct2) return say("mbFormMsg", "The two account numbers do not match. Please check them.", "error");
    const btn = document.getElementById("mbSend");
    btn.disabled = true;
    const bankName = (BANKS.find((b) => b[0] === code) || ["", ""])[1];
    const branchName = ((BRANCHES[code] || []).find((b) => b[0] === branch) || ["", ""])[1];
    const { error } = await supabaseClient.rpc("request_bank_change", {
      p_workspace: WS, p_bank: bankName, p_branch: branchName, p_institution: branch + code, p_account: acct,
      p_type: document.getElementById("mbType").value, p_name: document.getElementById("mbName").value.trim() || null
    });
    if (error) { btn.disabled = false; return say("mbFormMsg", error.message || "Not sent.", "error"); }
    await load("Sent. Payroll will check it with you before your pay goes to the new account.");
  }

  document.addEventListener("click", async (event) => {
    const t = event.target;
    if (!t || !card || !card.contains(t)) return;
    if (t.id === "mbNew") { document.getElementById("mbForm").hidden = false; t.hidden = true; return; }
    if (t.id === "mbClose") { document.getElementById("mbForm").hidden = true; const n = document.getElementById("mbNew"); if (n) n.hidden = false; return; }
    if (t.id === "mbCancel") {
      const { error } = await supabaseClient.rpc("cancel_bank_change", { p_workspace: WS, p_id: t.dataset.id });
      if (error) return say("mbMsg", error.message || "Not cancelled.", "error");
      await load("Change cancelled. Your pay still goes to your current account.");
    }
  });
  document.addEventListener("change", (event) => { if (event.target && event.target.id === "mbBank") fillBranches(); });
  document.addEventListener("submit", (event) => { if (event.target && event.target.id === "mbForm") send(event); });

  async function start() {
    if (typeof supabaseClient === "undefined") return;
    const { data } = await supabaseClient.auth.getSession();
    if (!data || !data.session) return;
    await load();
  }

  if (!window.__MB_TEST__) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  }
  window.kxMyBankLoad = load;
})();
