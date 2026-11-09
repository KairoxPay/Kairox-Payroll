/* =====================================================
   KAIROX PAY TOP BAR
   Makes the initials circle (profile menu) and the bell
   (notifications) work on any page that has them.
   Needs js/supabase.js to be loaded first.
===================================================== */
(function () {
  // Which company the person is working in (chosen with the company switcher). Kairox Exchange by default.
  function workspaceId() {
    try {
      return localStorage.getItem("kairoxWorkspace") || "kairox-exchange";
    } catch (error) {
      return "kairox-exchange";
    }
  }
  const ROLE_LABELS = { admin: "Administrator", director: "Managing director", payroll: "Payroll / accounts officer", viewer: "Viewer", hr: "HR officer", manager: "Manager" };
  const BELL =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

  let profile = { signedIn: false, name: "", initials: "?", email: "", role: null, metaName: "" };
  let notifications = [];
  let openPanel = null;

  const esc = (value = "") =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  /* ---------- company profile and the shared pay period ---------- */
  // Everyone now sees the same pay period (it used to live in each person's own browser). The pages still read
  // the browser copy, so once ready() finishes we mirror the shared period into it.
  const PERIOD_STORE = {
    start: "kairoxPayrollPeriodStart", end: "kairoxPayrollPeriodEnd", payDate: "kairoxPayrollPayDate",
    frequency: "kairoxPayrollFrequency", text: "kairoxPayrollPeriod"
  };
  const company = { profile: null, period: null, role: null, workspaces: [] };
  const OWNER_KEY = "kairoxPeriodWorkspace";

  async function getMyRole() {
    let result = await supabaseClient.rpc("get_my_role", { p_workspace: workspaceId() });

    if (result.error && /could not find|does not exist|schema cache/i.test(result.error.message || "")) {
      result = await supabaseClient.rpc("get_my_role");   // the Phase 6 database update has not been run yet
    }

    return result;
  }

  // The period copy kept in this browser belongs to one company. Switching company must not carry it across.
  function resetPeriodForOtherCompany() {
    try {
      const owner = localStorage.getItem(OWNER_KEY) || "kairox-exchange";   // older browsers have no owner: their period is Kairox Exchange's

      if (owner !== workspaceId()) {
        Object.values(PERIOD_STORE).forEach((key) => localStorage.removeItem(key));
        ["kairoxSelectedPayslipRunId", "kairoxReportRunId"].forEach((key) => localStorage.removeItem(key));
      }

      localStorage.setItem(OWNER_KEY, workspaceId());
    } catch (error) {
      /* storage can be unavailable */
    }
  }
  let companyLoad = null;

  function isoToLong(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(y, m - 1, d));
  }

  function mirrorPeriod(p) {
    try {
      localStorage.setItem(PERIOD_STORE.start, p.period_start);
      localStorage.setItem(PERIOD_STORE.end, p.period_end);
      localStorage.setItem(PERIOD_STORE.frequency, p.pay_frequency);
      localStorage.setItem(PERIOD_STORE.text, `${isoToLong(p.period_start)} – ${isoToLong(p.period_end)}`);
      if (p.pay_date) localStorage.setItem(PERIOD_STORE.payDate, p.pay_date);
      else localStorage.removeItem(PERIOD_STORE.payDate);
    } catch (error) {
      /* storage can be unavailable; the pages then simply use the shared copy on each load */
    }
  }

  async function savePeriod({ frequency, start, end, payDate, reason }) {
    if (typeof supabaseClient === "undefined") return { ok: true, local: true };

    const { error } = await supabaseClient.rpc("save_pay_period", {
      p_workspace: workspaceId(), p_frequency: frequency, p_start: start, p_end: end,
      p_pay_date: payDate || null, p_reason: reason || null
    });

    if (error) {
      // The Phase 5 database update has not been run yet: keep working in this browser, as before.
      if (/could not find|does not exist|schema cache/i.test(error.message || "")) return { ok: true, local: true };
      return { ok: false, message: error.message || "The pay period could not be saved." };
    }

    company.period = { workspace: workspaceId(), pay_frequency: frequency, period_start: start, period_end: end, pay_date: payDate || null };
    mirrorPeriod(company.period);
    return { ok: true };
  }

  async function loadCompany() {
    resetPeriodForOtherCompany();

    try {
      if (typeof supabaseClient === "undefined") return;

      const { data } = await supabaseClient.auth.getSession();
      if (!data || !data.session) return;

      const [profile, period, role, spaces] = await Promise.all([
        supabaseClient.from("company_profile").select("*").eq("workspace", workspaceId()).maybeSingle(),
        supabaseClient.from("pay_period_settings").select("*").eq("workspace", workspaceId()).maybeSingle(),
        getMyRole(),
        supabaseClient.rpc("my_workspaces")
      ]);

      company.workspaces = (spaces.data || []).map((w) => ({ id: w.workspace, name: w.name, role: w.role }));

      // The company saved in this browser is one this person can no longer open: move them to one they can.
      if (company.workspaces.length && !company.workspaces.some((w) => w.id === workspaceId())) {
        try { localStorage.setItem("kairoxWorkspace", company.workspaces[0].id); } catch (error) { /* ignore */ }
        window.location.reload();
        return;
      }

      company.role = role.data || null;
      if (profile.data) company.profile = profile.data;

      // An employee cannot read the company profile table: their company's name and logo come with their own record.
      if (!company.profile && !company.role) {
        const mine = await supabaseClient.rpc("my_employee", { p_workspace: workspaceId() });
        const row = mine.data && mine.data[0];
        const c = row && row.company;

        if (c && c.name) {
          company.profile = {
            trading_name: c.name, company_name: c.legal_name || c.name, trn: c.trn, nis_number: c.nis_number, address_line1: c.address_line1,
            address_line2: c.address_line2, parish: c.parish, country: c.country, phone: c.phone, email: c.email, logo_data: c.logo
          };
        }
      }

      if (period.data) {
        company.period = period.data;
        mirrorPeriod(period.data);
      } else if (!period.error && company.role === "admin") {
        // First time: move the period this browser already has into the shared settings (admin only).
        const start = localStorage.getItem(PERIOD_STORE.start);
        const end = localStorage.getItem(PERIOD_STORE.end);

        if (start && end) {
          await savePeriod({
            frequency: localStorage.getItem(PERIOD_STORE.frequency) || "Monthly", start, end,
            payDate: localStorage.getItem(PERIOD_STORE.payDate), reason: "moved from this browser"
          });
        }
      }
    } catch (error) {
      console.error("Company settings could not be loaded:", error);
    }
  }

  // The company logo is a small PNG (a data URL) saved in the company profile. Admins change it in Settings.
  function companyLogo() {
    const p = company.profile;
    return (p && p.logo_data) || null;
  }

  async function saveProfile(fields) {
    const { error } = await supabaseClient.rpc("save_company_profile", { p_workspace: workspaceId(), p_profile: fields });
    if (error) return { ok: false, message: error.message || "The company profile could not be saved." };

    const { data } = await supabaseClient.from("company_profile").select("*").eq("workspace", workspaceId()).maybeSingle();
    company.profile = data || null;
    return { ok: true };
  }

  function workspaceName() {
    const found = company.workspaces.find((w) => w.id === workspaceId());
    return found ? found.name : workspaceId() === "kairox-exchange" ? "Kairox Exchange" : workspaceId();
  }

  function companyName() {
    const p = company.profile;
    return (p && (p.trading_name || p.company_name)) || workspaceName();
  }

  // Name plus the employer's TRN, for the headings on exports.
  function companyHeading() {
    const p = company.profile;
    return p && p.trn ? `${companyName()} · TRN ${p.trn}` : companyName();
  }

  // The lines printed under the company name on a payslip.
  function companyLines() {
    const p = company.profile;
    if (!p) return [];

    const lines = [];
    if (p.trading_name && p.company_name && p.trading_name !== p.company_name) lines.push(p.company_name);
    if (p.address_line1) lines.push(p.address_line1);
    if (p.address_line2) lines.push(p.address_line2);
    const place = [p.parish, p.country].filter(Boolean).join(", ");
    if (place) lines.push(place);
    if (p.trn) lines.push(`TRN: ${p.trn}`);
    if (p.nis_number) lines.push(`NIS: ${p.nis_number}`);
    if (p.phone) lines.push(p.phone);
    if (p.email) lines.push(p.email);
    return lines;
  }

  function switchCompany(id) {
    if (!id || id === workspaceId()) return;

    try { localStorage.setItem("kairoxWorkspace", id); } catch (error) { /* ignore */ }
    window.location.reload();
  }

  // A small company picker at the top of the sidebar: a dropdown when the person can open more than one company,
  // otherwise just the company's name so it is always clear which one they are in.
  function mountCompanySwitcher() {
    const list = company.workspaces;
    const aside = document.querySelector("aside");

    if (!aside || !list.length || document.getElementById("kxCompany")) return;

    injectStyles();

    const box = document.createElement("div");
    box.id = "kxCompany";
    box.className = "kx-company";

    if (list.length === 1) {
      box.innerHTML = `<span class="kx-company-label">Company</span><strong class="kx-company-name">${esc(list[0].name)}</strong>`;
    } else {
      box.innerHTML =
        '<label class="kx-company-label" for="kxCompanySelect">Company</label>' +
        '<select id="kxCompanySelect" aria-label="Switch company">' +
        list.map((w) => `<option value="${esc(w.id)}"${w.id === workspaceId() ? " selected" : ""}>${esc(w.name)}</option>`).join("") +
        "</select>";
      box.querySelector("select").addEventListener("change", (event) => switchCompany(event.target.value));
    }

    const brand = aside.querySelector(".brand");
    const nav = aside.querySelector("nav, .sidebar-nav, .payroll-navigation");

    if (brand && brand.parentNode === aside) brand.after(box);
    else if (nav && nav.parentNode) nav.parentNode.insertBefore(box, nav);
    else aside.insertBefore(box, aside.firstChild);
  }

  window.KairoxCompany = {
    ready() {
      if (!companyLoad) companyLoad = loadCompany();
      return companyLoad;
    },
    profile: () => company.profile,
    period: () => company.period,
    role: () => company.role,
    workspace: workspaceId,
    workspaces: () => company.workspaces.slice(),
    workspaceName,
    switchCompany,
    companyName, companyHeading, companyLines, savePeriod, saveProfile,
    logo: companyLogo
  };

  /* ---------- who is signed in ---------- */
  function prettyName(email) {
    const local = String(email || "").split("@")[0].replace(/[0-9]+/g, " ");
    const words = local.split(/[._\-\s]+/).filter(Boolean);
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "User";
  }

  function initialsOf(name) {
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return (words[0] || "?").slice(0, 2).toUpperCase();
  }

  async function loadProfile() {
    const { data } = await supabaseClient.auth.getSession();
    const session = data && data.session;

    if (!session) {
      profile = { signedIn: false, name: "", initials: "?", email: "", role: null, metaName: "" };
      return;
    }

    const user = session.user || {};
    const meta = user.user_metadata || {};
    const metaName = String(meta.full_name || meta.name || "").trim();
    const name = metaName || prettyName(user.email);

    let role = null;
    try {
      const result = await getMyRole();
      role = result.data || null;
    } catch (error) {
      role = null;
    }

    let employee = null;
    try {
      const mine = await supabaseClient.rpc("my_employee", { p_workspace: null });
      const rows = mine.data || [];
      employee = rows.find((r) => r.workspace === workspaceId()) || (role ? null : rows[0]) || null;
    } catch (error) {
      employee = null;   // the Phase 9 database update has not been run yet
    }

    profile = { signedIn: true, name, initials: initialsOf(name), email: user.email || "", role, metaName, employee };
  }

  function applyProfile() {
    document.querySelectorAll(".topbar-avatar, .user-avatar").forEach((el) => {
      el.textContent = profile.initials;
    });

    document.querySelectorAll(".user-details strong").forEach((el) => {
      el.textContent = profile.signedIn ? profile.name : "Not signed in";
    });

    document.dispatchEvent(new CustomEvent("kairox:profile", { detail: { ...profile, firstName: profile.name.split(" ")[0] || "" } }));
  }

  /* ---------- styles ---------- */
  function injectStyles() {
    if (document.getElementById("kxTopbarStyles")) return;

    const style = document.createElement("style");
    style.id = "kxTopbarStyles";
    style.textContent = `
      .topbar-avatar[role="button"], .notification-button { cursor: pointer; }
      .topbar-avatar[role="button"]:focus-visible, .notification-button:focus-visible { outline: 3px solid #7a4cc9; outline-offset: 3px; }
      .kx-panel { position: fixed; z-index: 10000; width: min(360px, calc(100vw - 24px)); max-height: min(70vh, 520px); overflow: auto;
        background: #fff; color: #17172f; border: 1px solid #e7e9f0; border-radius: 16px; box-shadow: 0 18px 44px rgba(31, 18, 65, .22);
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
      .kx-panel h3 { margin: 0; padding: 16px 18px 10px; font-size: 15px; }
      .kx-empty { padding: 6px 18px 20px; color: #5f6475; }
      .kx-list { margin: 0; padding: 0 8px 8px; list-style: none; }
      .kx-item { display: flex; gap: 12px; align-items: flex-start; padding: 11px 10px; border-radius: 12px; color: inherit; text-decoration: none; }
      .kx-item:hover, .kx-item:focus-visible { background: #f4f0fc; outline: none; }
      .kx-dot { flex: 0 0 auto; width: 10px; height: 10px; margin-top: 5px; border-radius: 50%; background: #16a34a; }
      .kx-dot.high { background: #5b2c83; } .kx-dot.medium { background: #f97316; }
      .kx-item strong { display: block; font-size: 14px; }
      .kx-item span { display: block; margin-top: 2px; color: #5f6475; font-size: 13px; }
      .kx-who { display: flex; gap: 12px; align-items: center; padding: 16px 18px; border-bottom: 1px solid #eceef3; }
      .kx-who-avatar { display: grid; place-items: center; flex: 0 0 auto; width: 44px; height: 44px; border-radius: 50%; color: #fff; font-weight: 700;
        background: linear-gradient(135deg, #2cb8b3, #1a8da0); }
      .kx-who strong { display: block; } .kx-who span { display: block; color: #5f6475; font-size: 13px; word-break: break-all; }
      .kx-menu { list-style: none; margin: 0; padding: 8px; }
      .kx-menu a, .kx-menu button { display: block; width: 100%; padding: 11px 12px; border: 0; border-radius: 10px; background: none; color: inherit;
        font: inherit; text-align: left; text-decoration: none; cursor: pointer; }
      .kx-menu a:hover, .kx-menu button:hover, .kx-menu a:focus-visible, .kx-menu button:focus-visible { background: #f4f0fc; outline: none; }
      .kx-menu .kx-danger { color: #b91c1c; }
      .kx-form { padding: 14px 18px 18px; }
      .kx-form label { display: block; margin-bottom: 6px; font-weight: 700; }
      .kx-form input { width: 100%; min-height: 42px; padding: 9px 12px; border: 1px solid #c9cad6; border-radius: 10px; font: inherit; }
      .kx-form input:focus { outline: 3px solid rgba(91,44,131,.3); border-color: #5b2c83; }
      .kx-actions { display: flex; gap: 8px; margin-top: 12px; }
      .kx-actions button { flex: 1; min-height: 40px; border-radius: 10px; font: inherit; font-weight: 700; cursor: pointer; border: 1px solid #d8cee8; background: #fff; color: #35156f; }
      .kx-actions button.kx-primary { background: #5b2c83; border-color: #5b2c83; color: #fff; }
      .kx-company { display: grid; gap: 6px; margin: 4px 20px 16px; }
      .kx-company-label { color: rgba(255,255,255,.65); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .kx-company-name { color: #fff; font-size: 15px; }
      .kx-company select { width: 100%; min-height: 40px; padding: 8px 10px; border: 1px solid rgba(255,255,255,.3); border-radius: 10px;
        background: rgba(255,255,255,.12); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
      .kx-company select option { color: #17172f; background: #fff; }
      .kx-company select:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
      .kx-error { min-height: 18px; margin-top: 8px; color: #b91c1c; font-weight: 700; font-size: 13px; }
    `;
    document.head.appendChild(style);
  }

  /* ---------- panel plumbing ---------- */
  function closePanel(returnFocus) {
    if (!openPanel) return;
    const { element, trigger } = openPanel;
    element.remove();
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onOutside, true);
    window.removeEventListener("resize", onResize);
    openPanel = null;
    if (returnFocus) trigger.focus();
  }

  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel(true);
    }
  }

  function onOutside(event) {
    if (openPanel && !openPanel.element.contains(event.target) && !openPanel.trigger.contains(event.target)) {
      closePanel(false);
    }
  }

  function onResize() {
    closePanel(false);
  }

  function showPanel(trigger, label, html) {
    const wasThis = openPanel && openPanel.trigger === trigger;
    closePanel(false);
    if (wasThis) return null;

    const element = document.createElement("div");
    element.className = "kx-panel";
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", label);
    element.innerHTML = html;
    document.body.appendChild(element);

    const rect = trigger.getBoundingClientRect();
    element.style.top = `${Math.round(rect.bottom + 8)}px`;
    element.style.right = `${Math.max(12, Math.round(window.innerWidth - rect.right))}px`;

    trigger.setAttribute("aria-expanded", "true");
    openPanel = { element, trigger };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onOutside, true);
    window.addEventListener("resize", onResize);

    const first = element.querySelector("a, button, input");
    if (first) first.focus();
    return element;
  }

  /* ---------- profile menu ---------- */
  function profileMenuHtml() {
    if (!profile.signedIn) {
      return `
        <div class="kx-who"><div><strong>You are not signed in</strong></div></div>
        <ul class="kx-menu"><li><a href="login.html">Sign in</a></li></ul>`;
    }

    return `
      <div class="kx-who">
        <div class="kx-who-avatar">${esc(profile.initials)}</div>
        <div><strong>${esc(profile.name)}</strong><span>${esc(profile.email)}</span><span>${esc(ROLE_LABELS[profile.role] || (profile.employee ? "Employee" : "No payroll role"))} · ${esc(workspaceName())}</span></div>
      </div>
      <ul class="kx-menu">
        <li><button type="button" data-kx="edit-name">Edit my name</button></li>
        <li><a href="settings.html">Settings</a></li>
        <li><button type="button" class="kx-danger" data-kx="sign-out">Sign out</button></li>
      </ul>`;
  }

  function openProfileMenu(trigger) {
    const panel = showPanel(trigger, "Your profile", profileMenuHtml());
    if (!panel) return;

    panel.addEventListener("click", (event) => {
      const action = event.target.closest("[data-kx]");
      if (!action) return;

      if (action.dataset.kx === "sign-out") signOut();
      if (action.dataset.kx === "edit-name") showNameForm(panel);
    });
  }

  function showNameForm(panel) {
    panel.innerHTML = `
      <h3>Edit my name</h3>
      <form class="kx-form" novalidate>
        <label for="kxName">Your name</label>
        <input id="kxName" type="text" maxlength="60" autocomplete="name" value="${esc(profile.metaName || profile.name)}">
        <div class="kx-error" role="alert"></div>
        <div class="kx-actions">
          <button type="button" data-kx="cancel">Cancel</button>
          <button type="submit" class="kx-primary">Save</button>
        </div>
      </form>`;

    const form = panel.querySelector("form");
    const input = panel.querySelector("#kxName");
    input.focus();
    input.select();

    panel.querySelector('[data-kx="cancel"]').addEventListener("click", () => closePanel(true));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = input.value.trim().replace(/\s+/g, " ");
      const error = panel.querySelector(".kx-error");

      if (!name) { error.textContent = "Please enter your name."; return; }
      if (name.length > 60) { error.textContent = "Please keep your name under 60 characters."; return; }

      const { error: saveError } = await supabaseClient.auth.updateUser({ data: { full_name: name } });

      if (saveError) {
        error.textContent = "Your name could not be saved. " + (saveError.message || "");
        return;
      }

      profile = { ...profile, name, metaName: name, initials: initialsOf(name) };
      applyProfile();
      closePanel(true);
    });
  }

  async function signOut() {
    if (!window.confirm("Sign out of Kairox Pay?")) return;
    closePanel(false);
    await supabaseClient.auth.signOut();
    window.location.href = "login.html";
  }

  /* ---------- notifications ---------- */
  function nextMonthly(day, today) {
    let date = new Date(today.getFullYear(), today.getMonth(), day);
    if (date < today) date = new Date(today.getFullYear(), today.getMonth() + 1, day);
    return avoidWeekend(date);
  }

  function nextAnnual(month, day, today) {
    let date = new Date(today.getFullYear(), month - 1, day);
    if (date < today) date = new Date(today.getFullYear() + 1, month - 1, day);
    return avoidWeekend(date);
  }

  function avoidWeekend(date) {
    if (date.getDay() === 6) date.setDate(date.getDate() + 2);
    if (date.getDay() === 0) date.setDate(date.getDate() + 1);
    return date;
  }

  function longDate(date) {
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
  }

  function daysText(days) {
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    return `in ${days} days`;
  }

  async function computeNotifications() {
    if (!profile.signedIn || !profile.role) return [];

    // HR officers and managers only see leave waiting for them (a manager's list is just their own team).
    if (profile.role === "hr" || profile.role === "manager") {
      const waiting = await supabaseClient.from("leave_requests").select("id").eq("workspace", workspaceId()).eq("status", "pending");
      const count = waiting.error ? 0 : (waiting.data || []).length;

      return count
        ? [{ title: `${count} leave request${count === 1 ? "" : "s"} waiting for approval`, detail: profile.role === "manager" ? "From your team" : "Open Leave to approve or decline", href: "leave.html", level: "medium" }]
        : [];
    }

    await window.KairoxCompany.ready();   // so the pay period below is the shared one

    const [employeesResult, runsResult, filingsResult, leaveResult, departuresResult] = await Promise.all([
      supabaseClient.from("employees").select("id, employment_status, trn").eq("workspace", workspaceId()),
      supabaseClient.from("payroll_runs").select("*").eq("workspace", workspaceId()),
      supabaseClient.from("filing_records").select("filing_type, period_key").eq("workspace", workspaceId()),
      supabaseClient.from("leave_requests").select("id").eq("workspace", workspaceId()).eq("status", "pending"),
      supabaseClient.from("employee_departures").select("leaving_date, p45_prepared_on").eq("workspace", workspaceId())
    ]);
    const filed = new Set((filingsResult.data || []).map((f) => `${f.filing_type}|${f.period_key}`));

    const employees = (employeesResult.data || []).filter(
      (e) => String(e.employment_status || "active").toLowerCase() !== "archived"
    );
    const runs = runsResult.data || [];
    const items = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = localStorage.getItem("kairoxPayrollPeriodStart");
    const end = localStorage.getItem("kairoxPayrollPeriodEnd");
    const payDate = localStorage.getItem("kairoxPayrollPayDate");
    const run = runs.find((r) => r.period_start === start && r.period_end === end && r.status !== "reversed");

    if (!start || !end) {
      items.push({ title: "Set the pay period", detail: "Open the Payroll page to choose dates", href: "payroll.html", level: "high" });
    } else if (!run) {
      items.push({ title: "Start current payroll", detail: payDate ? `Pay date ${longDate(new Date(payDate + "T00:00:00"))}` : "Set a pay date", href: "payroll.html", level: "high" });
    } else if (run.status === "draft") {
      items.push(
        ["admin", "director"].includes(profile.role)
          ? { title: "Review and approve payroll", detail: "The draft is waiting for approval", href: "payroll.html", level: "high" }
          : { title: "Payroll is waiting for approval", detail: "An admin or managing director approves it, then you can process it", href: "payroll.html", level: "medium" }
      );
    } else if (run.status === "approved") {
      if (["admin", "director", "payroll"].includes(profile.role)) {
        items.push({ title: "Process approved payroll", detail: "Approved, not yet processed", href: "payroll.html", level: "high" });
      }
    }

    if (payDate && (!run || run.status !== "processed")) {
      const days = Math.round((new Date(payDate + "T00:00:00") - today) / 86400000);
      if (days < 0) {
        items.unshift({ title: "Payroll is overdue", detail: `The pay date was ${longDate(new Date(payDate + "T00:00:00"))}`, href: "payroll.html", level: "high" });
      }
    }

    if (employees.length > 0) {
      const filings = [];

      // The next S01 not yet recorded as filed (it covers the payroll paid in the month before its due month).
      for (let n = 0; n < 3; n++) {
        const due = avoidWeekend(new Date(today.getFullYear(), today.getMonth() + n, 14));
        const month = due.getMonth();
        const key = month === 0 ? `${due.getFullYear() - 1}-12` : `${due.getFullYear()}-${String(month).padStart(2, "0")}`;

        if (due < today || filed.has(`S01|${key}`)) continue;

        filings.push({ name: "S01 statutory deductions return", date: due });
        break;
      }

      // P24 has no fixed TAJ date (31 January is only our target). S02 is due 31 March.
      [
        ["P24", "P24 certificates to employees (target)", 0],
        ["S02", "S02 employer annual return", 2]
      ].forEach(([type, name, monthIndex]) => {
        for (let year = today.getFullYear(); year <= today.getFullYear() + 1; year++) {
          const due = avoidWeekend(new Date(year, monthIndex, 31));

          if (due < today || filed.has(`${type}|${year - 1}`)) continue;

          filings.push({ name, date: due });
          break;
        }
      });

      filings
        .map((f) => ({ ...f, days: Math.round((f.date - today) / 86400000) }))
        .filter((f) => f.days <= 14)
        .sort((a, b) => a.days - b.days)
        .forEach((f) =>
          items.push({ title: `${f.name} is due ${daysText(f.days)}`, detail: longDate(f.date), href: "compliance.html", level: f.days <= 3 ? "high" : "medium" })
        );
    }

    // Admins decide leave, so they are told when requests are waiting.
    const waitingLeave = ["admin", "director"].includes(profile.role) && !leaveResult.error ? (leaveResult.data || []).length : 0;
    if (waitingLeave > 0) {
      items.push({
        title: `${waitingLeave} leave request${waitingLeave === 1 ? "" : "s"} waiting for approval`,
        detail: "Open Leave to approve or decline",
        href: "leave.html",
        level: "medium"
      });
    }

    // Someone has left and nobody has recorded their P45 yet.
    const pad2 = (n) => String(n).padStart(2, "0");
    const todayIso = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
    const noP45 = departuresResult.error ? [] : (departuresResult.data || []).filter((d) => !d.p45_prepared_on && String(d.leaving_date) <= todayIso);
    if (["admin", "director", "payroll"].includes(profile.role) && noP45.length > 0) {
      items.push({
        title: `${noP45.length} leaver${noP45.length === 1 ? "" : "s"} without a P45 recorded`,
        detail: "Open Leavers to prepare it",
        href: "leavers.html",
        level: "medium"
      });
    }

    const missingTrn = employees.filter((e) => !e.trn).length;
    if (missingTrn > 0) {
      items.push({ title: "Employees without a TRN", detail: `${missingTrn} employee${missingTrn === 1 ? "" : "s"} need one`, href: "employees-v2.html", level: "medium" });
    }

    return items;
  }

  function updateBadge() {
    document.querySelectorAll(".notification-count").forEach((badge) => {
      badge.textContent = String(notifications.length);
      badge.hidden = notifications.length === 0;
    });
  }

  function notificationsHtml() {
    if (!profile.signedIn) {
      return '<h3>Notifications</h3><p class="kx-empty">Sign in to see your notifications.</p>';
    }

    if (notifications.length === 0) {
      return "<h3>Notifications</h3><p class=\"kx-empty\">You're all caught up. Nothing needs attention right now.</p>";
    }

    return `<h3>Notifications</h3><ul class="kx-list">${notifications
      .map(
        (n) => `<li><a class="kx-item" href="${esc(n.href)}"><span class="kx-dot ${esc(n.level)}"></span><div><strong>${esc(n.title)}</strong><span>${esc(n.detail)}</span></div></a></li>`
      )
      .join("")}</ul>`;
  }

  /* ---------- wire it up ---------- */
  function makeInteractive(el, label, onActivate) {
    el.setAttribute("aria-haspopup", "dialog");
    el.setAttribute("aria-expanded", "false");
    el.setAttribute("aria-label", label);
    el.addEventListener("click", (event) => { event.preventDefault(); onActivate(el); });

    if (el.tagName !== "BUTTON") {
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(el); }
      });
    }
  }

  async function refresh() {
    await loadProfile();
    applyProfile();
    applyRoleNavigation();
    notifications = await computeNotifications();
    updateBadge();
  }

  /* ---------- sidebar links ---------- */
  // Pages written earlier have sidebars without Compliance, Documents or Support, or with dead links.
  // This makes every sidebar point at the real pages and adds the missing ones.
  const NAV_PAGES = {
    home: "dashboard-v2.html", dashboard: "dashboard-v2.html", employees: "employees-v2.html", people: "people.html", leave: "leave.html", leavers: "leavers.html", payroll: "payroll.html",
    payslips: "payslips.html", compliance: "compliance.html", reports: "reports.html", documents: "documents.html",
    settings: "settings.html", support: "support.html", "my portal": "me.html"
  };
  const NAV_ICONS = { people: "users-round", "my portal": "circle-user", leave: "calendar-days", leavers: "user-minus", compliance: "shield-check", documents: "folder", support: "circle-help", settings: "settings" };
  const NAV_LABELS = { people: "People", "my portal": "My portal", leave: "Leave", leavers: "Leavers", compliance: "Compliance", documents: "Documents", support: "Support", settings: "Settings" };

  function navKey(el) {
    return String(el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function fixNavigation(extra = []) {
    try {
      document.querySelectorAll("aside").forEach((aside) => {
        const found = {};
        const controls = [...aside.querySelectorAll("a, button")].filter((el) => !el.matches("[data-logout], .sidebar-brand, .payroll-brand"));

        controls.forEach((el) => {
          const key = navKey(el);
          const page = NAV_PAGES[key];
          if (!page) return;

          found[key] = el;

          if (el.tagName === "A") {
            if (el.getAttribute("href") !== page) el.setAttribute("href", page);
          } else {
            el.removeAttribute("disabled");
            el.removeAttribute("aria-disabled");
            el.removeAttribute("title");
            if (!el.dataset.kxNav) {
              el.dataset.kxNav = page;
              el.addEventListener("click", () => { window.location.href = page; });
            }
          }
        });

        const anchor = Object.values(found).find((el) => el.tagName === "A");
        if (!anchor) return;

        const links = () => [...aside.querySelectorAll("a")].filter((el) => !el.matches("[data-logout], .sidebar-brand, .payroll-brand"));
        const lastLink = () => links().pop();

        // Where each added link goes: Compliance before Reports, Documents after Reports, Support after Settings.
        const insertion = {
          people: () => (found.employees ? { ref: found.employees, side: "after" } : { ref: lastLink(), side: "after" }),
          leave: () => (found.people ? { ref: found.people, side: "after" } : found.employees ? { ref: found.employees, side: "after" } : { ref: lastLink(), side: "after" }),
          leavers: () => (found.leave ? { ref: found.leave, side: "after" } : found.employees ? { ref: found.employees, side: "after" } : { ref: lastLink(), side: "after" }),
          "my portal": () => ({ ref: found.support || lastLink(), side: "after" }),
          compliance: () => (found.reports ? { ref: found.reports, side: "before" } : { ref: lastLink(), side: "after" }),
          documents: () => ({ ref: found.reports || found.compliance || lastLink(), side: "after" }),
          support: () => ({ ref: found.settings || found.documents || lastLink(), side: "after" })
        };

        ["people", "leave", "leavers", "compliance", "documents", "support", ...extra].forEach((key) => {
          if (found[key]) return;

          const clone = anchor.cloneNode(true);
          clone.setAttribute("href", NAV_PAGES[key]);
          clone.classList.remove("active");
          clone.removeAttribute("aria-current");

          const icon = clone.querySelector("[data-lucide]");
          if (icon) icon.setAttribute("data-lucide", NAV_ICONS[key]);

          const label = clone.querySelector("span:last-of-type") || clone;
          if (label === clone) {
            [...clone.childNodes].forEach((node) => { if (node.nodeType === 3) node.textContent = ""; });
            clone.appendChild(document.createTextNode(NAV_LABELS[key]));
          } else {
            label.textContent = NAV_LABELS[key];
          }

          const { ref, side } = insertion[key]();
          ref.parentNode.insertBefore(clone, side === "before" ? ref : ref.nextSibling);
          found[key] = clone;
        });

        if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
      });
    } catch (error) {
      console.error("Sidebar links could not be updated:", error);
    }
  }

  /* ---------- what each kind of person may open ---------- */
  // HR officers, managers and employees never see pay screens. This tidies the sidebar and explains the page; the real
  // protection is in the database, which refuses them the data whatever the page does.
  const APP_PAGES = [
    "dashboard-v2.html", "employees-v2.html", "employee-profile.html", "edit-employee.html", "add-employee.html", "payroll.html", "payslips.html",
    "payslip.html", "compliance.html", "reports.html", "documents.html", "settings.html", "leave.html", "leavers.html", "people.html", "me.html", "support.html"
  ];
  const ROLE_PAGES = {
    hr: ["people.html", "leave.html", "documents.html", "support.html", "me.html"],
    manager: ["people.html", "leave.html", "support.html", "me.html"],
    employee: ["me.html", "support.html"]
  };

  function roleKind() {
    if (["admin", "director", "payroll", "viewer"].includes(profile.role)) return "staff";
    if (profile.role === "hr" || profile.role === "manager") return profile.role;
    if (profile.employee) return "employee";
    return null;
  }

  function applyRoleNavigation() {
    try {
      const kind = roleKind();
      if (!kind) return;

      fixNavigation(profile.employee ? ["my portal"] : []);
      if (kind === "staff") return;

      const allowed = ROLE_PAGES[kind];

      document.querySelectorAll("aside").forEach((aside) => {
        [...aside.querySelectorAll("a, button")]
          .filter((el) => !el.matches("[data-logout], .sidebar-brand, .payroll-brand"))
          .forEach((el) => {
            const page = NAV_PAGES[navKey(el)];
            if (!page || !allowed.includes(page)) el.style.display = "none";
          });
      });

      const here = (window.location.pathname.split("/").pop() || "").toLowerCase();

      if (APP_PAGES.includes(here) && !allowed.includes(here)) {
        const main = document.querySelector("main");
        const home = kind === "employee" ? "me.html" : "people.html";

        if (main) {
          main.innerHTML = `<section class="page-card" data-role-guard="${esc(kind)}" style="max-width:560px;margin:40px auto;text-align:center"><h2 style="margin:0 0 8px">This page is not part of your role</h2><p style="margin:0 0 16px">Your account is for ${kind === "employee" ? "the employee portal" : kind === "hr" ? "people and leave" : "your team's leave"}. Pay and payroll screens are not shown to it.</p><a class="btn primary" href="${home}" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#5b2c83;color:#fff;font-weight:700;text-decoration:none">Go to ${kind === "employee" ? "My portal" : "People"}</a></section>`;
        }
      }
    } catch (error) {
      console.error("Role navigation could not be applied:", error);
    }
  }

  async function init() {
    const avatar = document.querySelector(".topbar-avatar");
    const bell = document.querySelector(".notification-button");

    fixNavigation();

    if (typeof supabaseClient !== "undefined") {
      window.KairoxCompany.ready().then(mountCompanySwitcher);
    }

    if (!avatar && !bell) return;
    if (typeof supabaseClient === "undefined") return;

    injectStyles();

    if (bell) {
      const badge = bell.querySelector(".notification-count");
      bell.innerHTML = BELL;
      bell.appendChild(badge || Object.assign(document.createElement("span"), { className: "notification-count", textContent: "0" }));
      makeInteractive(bell, "Notifications", (el) => {
        showPanel(el, "Notifications", notificationsHtml());
      });
    }

    if (avatar) {
      makeInteractive(avatar, "Open your profile menu", openProfileMenu);
    }

    try {
      await refresh();
    } catch (error) {
      console.error("Top bar could not load:", error);
    }
  }

  window.KairoxTopbar = { refresh, notifications: () => notifications.slice(), profile: () => ({ ...profile }) };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();