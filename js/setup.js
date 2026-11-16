// Setup checklist: walks a new company through everything Kairox Pay needs before the first payroll, in order, and shows what
// is done. Each step checks the real records, so ticks appear by themselves as the work is done on the other pages.
// On the Home page (dashboard-v2.html) it shows a small "Finish setting up" card until the needed steps are done.

(function () {
  const WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const day = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
  const active = (e) => !/archived|inactive|terminated|left/i.test(e.employment_status || e.status || "");

  // need: "required" (payroll cannot run properly without it), "recommended", or "optional".
  const STEPS = [
    { id: "company", need: "required", title: "Company details", href: "settings.html#companyCard", action: "Open Settings",
      why: "Your legal name, TRN and address are printed on payslips, the S01 and S02, and P24s." },
    { id: "period", need: "required", title: "Pay frequency and first pay period", href: "payroll.html", action: "Open Payroll",
      why: "Weekly, fortnightly or monthly, and the dates of the first period you will pay. Press Change Period on the Payroll page." },
    { id: "rates", need: "required", title: "Check the statutory rates", href: "compliance.html#ratesCard", action: "Open Compliance",
      why: "Confirm the PAYE threshold and the NIS, NHT, Education Tax and HEART rates match what TAJ publishes this year." },
    { id: "employees", need: "required", title: "Add your employees", href: "employees-v2.html", action: "Open Employees",
      why: "Each person needs a monthly salary and their TRN (the TRN is needed for the S02 and P24)." },
    { id: "bank", need: "recommended", title: "Bank details for paying staff", href: "bank.html", action: "Open Bank payments",
      why: "Add each person's bank account, and your NCB Originator ID, to download a bank file instead of paying one by one." },
    { id: "twostep", need: "recommended", title: "Two-step sign-in for payroll staff", href: "security.html", action: "Open Account security",
      why: "Admins, managing directors and payroll officers can see everyone's pay. A code from their phone keeps that safe." },
    { id: "team", need: "optional", title: "Give your team access", href: "people.html", action: "Open Team & access",
      why: "Add a payroll officer, HR officer or managers, and set who each employee reports to (for leave approvals)." },
    { id: "portal", need: "optional", title: "Choose what employees see in My portal", href: "settings.html#portalCard", action: "Open Settings",
      why: "Payslips, leave requests, their details and documents. Clock-in, expenses and bank changes are switched on from their own pages." },
    { id: "email", need: "optional", title: "Email alerts", href: "settings.html#emailCard", action: "Open Settings",
      why: "Lets Kairox Pay email payslips and leave alerts from your Gmail. About 15 minutes, once." },
    { id: "payroll", need: "required", title: "Run and process your first payroll", href: "payroll.html", action: "Open Payroll",
      why: "Save the draft, check it, approve it, then process it. Payslips and the bank file are ready after that." }
  ];

  // Each check returns { done, note }. A check that cannot run (an older database) counts as not done, with a note.
  async function checks() {
    const sb = supabaseClient;
    const [co, period, rates, emps, bank, bankSet, team, portal, email, runs] = await Promise.all([
      sb.from("company_profile").select("*").eq("workspace", WS).maybeSingle(),
      sb.from("pay_period_settings").select("*").eq("workspace", WS).maybeSingle(),
      sb.from("payroll_rates").select("*").eq("workspace", WS).maybeSingle(),
      sb.from("employees").select("*").eq("workspace", WS),
      sb.rpc("bank_accounts_list", { p_workspace: WS }),
      sb.rpc("bank_file_settings_get", { p_workspace: WS }),
      sb.rpc("two_step_report", { p_workspace: WS }),
      sb.from("portal_settings").select("*").eq("workspace", WS).maybeSingle(),
      sb.rpc("email_alert_status", { p_workspace: WS }),
      sb.from("payroll_runs").select("id, status").eq("workspace", WS)
    ]);
    const r = {};

    const c = co.data || {};
    const coMissing = [!c.company_name && "legal name", !/^\d{9}$/.test(c.trn || "") && "TRN", !c.address_line1 && "address", !c.parish && "parish"].filter(Boolean);
    r.company = { done: !coMissing.length, note: coMissing.length ? `Still needed: ${coMissing.join(", ")}.` : c.trading_name || c.company_name };

    const p = period.data || {};
    r.period = { done: !!p.period_start, note: p.period_start ? `${p.pay_frequency || ""} pay. Current period: ${day(p.period_start)} to ${day(p.period_end)}.` : "" };

    const checkedAt = rates.data && rates.data.checked_at;
    const fresh = checkedAt && Date.now() - new Date(checkedAt).getTime() < 330 * 86400000;
    r.rates = { done: !!fresh, note: checkedAt ? (fresh ? `Last checked ${day(checkedAt)}.` : "Last checked over a year ago: check them again.") : "" };

    const staff = (emps.data || []).filter(active);
    const noTrn = staff.filter((e) => !/^\d{9}$/.test(String(e.trn || "").replace(/\D/g, ""))).length;
    const noPay = staff.filter((e) => !(Number(e.gross) > 0)).length;
    r.employees = { done: staff.length > 0 && !noTrn && !noPay,
      note: !staff.length ? "No employees yet." : [`${staff.length} ${staff.length === 1 ? "employee" : "employees"}`,
        noPay && `${noPay} without a salary`, noTrn && `${noTrn} without a TRN`].filter(Boolean).join(", ") + "." };

    if (bank.error) r.bank = { done: false, note: "Bank payments are not set up in the database yet." };
    else {
      const people = (bank.data || []).filter((a) => !/archived|inactive|terminated|left/i.test(a.status || ""));
      const missing = people.filter((a) => !a.account_number || !a.institution_id).length;
      const originator = !bankSet.error && bankSet.data && bankSet.data[0] && bankSet.data[0].originator_id;
      r.bank = { done: people.length > 0 && !missing && !!originator,
        note: [missing ? `${missing} without bank details` : people.length ? "Everyone has bank details" : "", originator ? "" : "NCB Originator ID not added"].filter(Boolean).join(". ") + "." };
    }

    if (team.error) { r.twostep = { done: false, note: "Only an admin can see this." }; r.team = { done: false, note: "" }; }
    else {
      const people = team.data || [];
      const needs = people.filter((x) => ["admin", "director", "payroll"].includes(x.role));
      const off = needs.filter((x) => !x.two_step).length;
      r.twostep = { done: needs.length > 0 && !off, note: off ? `${off} of ${needs.length} still without it.` : "On for everyone who handles pay." };
      r.team = { done: people.length > 1, note: `${people.length} ${people.length === 1 ? "person has" : "people have"} access.` };
    }

    r.portal = { done: !!(portal.data && portal.data.workspace), note: portal.data ? "Saved." : "Not chosen yet (the defaults are used)." };

    const em = !email.error && email.data && email.data[0];
    r.email = { done: !!(em && em.gateway_ready && em.sender_ready), note: em && em.gateway_ready ? "Ready." : "Not set up." };

    const processed = (runs.data || []).filter((x) => x.status === "processed").length;
    const drafts = (runs.data || []).filter((x) => ["draft", "approved"].includes(x.status)).length;
    r.payroll = { done: processed > 0, note: processed ? `${processed} processed so far.` : drafts ? "A payroll is saved but not processed yet." : "" };
    return r;
  }

  function summary(r) {
    const counted = STEPS.filter((s) => s.need !== "optional");
    const done = counted.filter((s) => r[s.id] && r[s.id].done).length;
    const next = STEPS.find((s) => s.need !== "optional" && !(r[s.id] && r[s.id].done)) || STEPS.find((s) => !(r[s.id] && r[s.id].done));
    return { done, total: counted.length, next, complete: done === counted.length };
  }

  const NEED = { required: ["Needed", "#b91c1c"], recommended: ["Recommended", "#b45309"], optional: ["Optional", "#6f7285"] };

  function renderPage(r) {
    const s = summary(r);
    const pct = Math.round((s.done / s.total) * 100);
    document.getElementById("setupProgress").innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
        <strong style="font-size:18px">${s.complete ? "All set. Kairox Pay is ready to use." : `${s.done} of ${s.total} steps done`}</strong>
        <span class="muted small">Optional steps are not counted.</span></div>
      <div style="height:12px;border-radius:999px;background:#ece9f6;margin-top:10px;overflow:hidden" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Setup progress">
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#5b2c83,#2cb8b3);border-radius:999px"></div></div>`;

    document.getElementById("setupList").innerHTML = STEPS.map((st, i) => {
      const res = r[st.id] || { done: false, note: "" };
      const isNext = s.next && s.next.id === st.id;
      const need = NEED[st.need];
      return `<li class="kx-step${res.done ? " done" : ""}${isNext ? " next" : ""}">
        <span class="kx-step-mark" aria-hidden="true">${res.done ? "✓" : i + 1}</span>
        <div class="kx-step-body">
          <div class="kx-step-title"><strong>${esc(st.title)}</strong>
            <span class="kx-step-need" style="color:${res.done ? "#16a34a" : need[1]}">${res.done ? "Done" : need[0]}</span>${isNext ? '<span class="kx-step-next">Next step</span>' : ""}</div>
          <p>${esc(st.why)}</p>
          ${res.note ? `<p class="kx-step-note">${esc(res.note)}</p>` : ""}
        </div>
        <a class="btn small${isNext ? " primary" : ""}" href="${esc(st.href)}">${esc(res.done ? "Review" : st.action)}</a></li>`;
    }).join("");
  }

  function renderBanner(r) {
    const s = summary(r);
    if (s.complete) return;
    const main = document.querySelector("main") || document.body;
    const box = document.createElement("section");
    box.className = "page-card";
    box.id = "setupBanner";
    box.style.cssText = "display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:0 0 20px;padding:18px 20px;border-radius:16px;background:#fff;border:1px solid #e7e9f0;box-shadow:0 8px 24px rgba(30,20,70,.07)";
    box.innerHTML = `<div style="min-width:0"><strong style="font-size:17px">Finish setting up Kairox Pay</strong>
        <p style="margin:4px 0 0;color:#5f6475">${s.done} of ${s.total} steps done. Next: <strong>${esc(s.next.title)}</strong>.</p></div>
      <a href="setup.html" style="padding:10px 16px;border-radius:12px;background:#4b2394;color:#fff;font-weight:700;text-decoration:none">Continue setup</a>`;
    const header = main.querySelector("header");
    if (header && header.parentNode === main) header.after(box); else main.prepend(box);
  }

  async function start() {
    if (typeof supabaseClient === "undefined") return;
    const { data } = await supabaseClient.auth.getSession();
    const page = !!document.getElementById("setupList");
    if (!data || !data.session) { if (page) window.location.href = "login.html?next=setup.html"; return; }
    const { data: role } = await supabaseClient.rpc("get_my_role", { p_workspace: WS });
    if (!["admin", "director"].includes(role)) {
      if (page) document.getElementById("setupList").innerHTML = '<li class="kx-step"><div class="kx-step-body"><p>Only an admin or a managing director can set up the company.</p></div></li>';
      return;
    }
    const r = await checks();
    if (page) renderPage(r); else renderBanner(r);
  }

  window.kxSetup = { STEPS, checks, summary };
  if (!window.__SETUP_TEST__) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  }
})();
