// Settings: "Features" card (admins and managing directors). Turn optional parts of Kairox Pay on or off for THIS company.
// Off = hidden from the menu, My portal and Pay items; nothing is deleted (phase48-features.sql). Needs js/topbar.js.

(function () {
  const WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const GROUPS = [
    ["Pay", [
      ["loans", "Loans and salary advances", "The Loans page. Loan repayments typed in Pay items still work when this is off."],
      ["expenses", "Expense claims", "Employees claim expenses with receipts; approved claims are paid back through payroll."],
      ["timesheets", "Clock-in and timesheets", "Employees clock in and out in My portal; approved hours fill in overtime in Pay items."],
      ["bank_changes", "Bank details change requests", "Employees ask for a new bank account in My portal; payroll approves it."],
      ["costs", "Payroll costs dashboard", "Employer cost by month and department."]
    ]],
    ["People", [
      ["onboarding", "New-hire checklist", "Paperwork to finish for each new employee."],
      ["announcements", "Announcements", "Messages and policies staff confirm they have read."],
      ["reviews", "Performance reviews", "Ratings, self-reviews and goals."],
      ["signatures", "E-signatures", "Contracts and documents signed in My portal."],
      ["whatsapp", "WhatsApp messages", "Ready-made WhatsApp messages for payslips, leave and expenses."]
    ]]
  ];

  function card() {
    const box = document.createElement("section");
    box.className = "payroll-table-card settings-section";
    box.id = "featuresCard";
    box.innerHTML = `
      <div class="payroll-table-heading"><div><h2>Features</h2>
        <p>Turn off what this company does not use, to keep Kairox Pay simple. Nothing is deleted: turning a feature back on brings everything back.
        Payroll, payslips, compliance, employees, leave and My portal are always on.</p></div></div>
      <div class="settings-body">
        ${GROUPS.map(([title, items]) => `<p style="margin:4px 0 8px;font-weight:800;color:#5f6475;font-size:13px;text-transform:uppercase;letter-spacing:.05em">${esc(title)}</p>
          <div style="display:grid;gap:10px;margin:0 0 16px">${items.map(([key, name, about]) => `
            <label style="display:flex;gap:12px;align-items:flex-start;cursor:pointer">
              <input type="checkbox" data-feature="${esc(key)}" checked style="width:18px;height:18px;margin:2px 0 0;flex:0 0 auto">
              <span><strong>${esc(name)}</strong><small style="display:block;color:#6f7285">${esc(about)}</small></span></label>`).join("")}</div>`).join("")}
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button type="button" id="ftSave" style="padding:10px 18px;border-radius:10px;border:1px solid transparent;font:inherit;font-weight:700;cursor:pointer;color:#fff;background:var(--purple-600,#4b2394)">Save features</button>
          <span id="ftMsg" class="settings-meta" role="status"></span>
        </div>
      </div>`;
    const after = document.getElementById("brandCard") || document.getElementById("companyCard");
    if (after && after.parentNode) after.after(box); else (document.querySelector("main") || document.body).appendChild(box);
  }

  function say(text, ok) { const m = document.getElementById("ftMsg"); m.textContent = text; m.style.color = ok ? "#16a34a" : "#b91c1c"; }

  async function save() {
    const off = [...document.querySelectorAll("#featuresCard [data-feature]")].filter((b) => !b.checked).map((b) => b.dataset.feature);
    const { error } = await supabaseClient.rpc("save_company_features", { p_workspace: WS, p_off: off });
    if (error) return say(/could not find the function/i.test(error.message || "") ? "Run phase48-features.sql in Supabase first." : error.message || "Not saved.", false);
    if (window.KairoxFeatures) window.KairoxFeatures.set(off);
    say(off.length ? `Saved. ${off.length} ${off.length === 1 ? "feature is" : "features are"} off for this company.` : "Saved. Everything is on.", true);
  }

  async function start() {
    if (typeof supabaseClient === "undefined") return;
    const { data } = await supabaseClient.auth.getSession();
    if (!data || !data.session) return;
    const { data: role } = await supabaseClient.rpc("get_my_role", { p_workspace: WS });
    if (!["admin", "director"].includes(role)) return;
    // Wait a moment so the Company colours card (if any) is placed first.
    await new Promise((r) => setTimeout(r, 300));
    card();
    const { data: off, error } = await supabaseClient.rpc("company_features_off", { p_workspace: WS });
    (Array.isArray(off) ? off : []).forEach((k) => { const b = document.querySelector(`#featuresCard [data-feature="${k}"]`); if (b) b.checked = false; });
    if (error) say("Run phase48-features.sql in Supabase to use this.", false);
    document.getElementById("ftSave").addEventListener("click", save);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
