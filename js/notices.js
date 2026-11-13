// Email payslips: prepares a "your payslip is ready" email for a processed payroll. It never sends anything itself:
// it opens your own Gmail (or mail app) with the message and every address already filled in, and you press Send.
// No pay figures are ever put in the email, and the list of recipients always comes from the database.

// Which company the signed-in person is working in (chosen with the company switcher). Kairox Exchange by default.
function kairoxWorkspaceId() {
  try {
    return localStorage.getItem("kairoxWorkspace") || "kairox-exchange";
  } catch (error) {
    return "kairox-exchange";
  }
}

const NT_WORKSPACE = kairoxWorkspaceId();
const NT_ROLES = ["admin", "director", "payroll"];
const NT_MAX_LINK = 7000;   // the longest compose link we will try to open; beyond this the addresses are copied instead

let ntRuns = [];
let ntCurrent = null;       // the notice being prepared in the dialog
let ntAutoReady = false;    // true when the database can send the emails itself (the email set-up is finished)

const ntEl = (id) => document.getElementById(id);
const ntEsc = (value = "") =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function ntParse(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
function ntFmt(iso) {
  return iso ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(ntParse(iso)) : "—";
}
function ntMonthYear(iso) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(ntParse(iso));
}
// "October 2026" when the payroll sits inside one month, otherwise "Oct 26, 2026 to Nov 8, 2026"
function ntPeriodLabel(start, end) {
  if (String(start).slice(0, 7) === String(end).slice(0, 7)) return ntMonthYear(start);
  return `${ntFmt(start)} to ${ntFmt(end)}`;
}

function ntBanner(html) {
  const banner = ntEl("pageBanner");
  banner.innerHTML = html;
  banner.hidden = !html;
}
function ntMessage(text, kind) {
  const box = ntEl("noticeMessage");
  box.textContent = text || "";
  box.className = `form-message ${kind || ""}`.trim();
}

/* ---------- the email itself (pure functions) ---------- */
function ntBuildMessage({ company, label, loginUrl, extra }) {
  const subject = `Your payslip for ${label} is ready`;
  const lines = [
    "Hello,",
    "",
    `Your payslip for ${label} is ready.`,
    "",
    "To see it:",
    `1. Go to ${loginUrl}`,
    "2. Sign in with the email address this message was sent to.",
    '3. Open "My payslips".',
    "",
    "For your privacy, no pay figures are included in this email."
  ];

  if (extra && extra.trim()) lines.push("", extra.trim());
  lines.push("", "If you cannot sign in, reply to this email and we will help.", "", company);

  return { subject, body: lines.join("\n") };
}

function ntComposeLinks({ bcc, subject, body, from }) {
  const list = bcc.join(",");
  const isGoogle = /@(gmail|googlemail)\.com$/i.test(String(from || "").trim());
  let gmail = "https://mail.google.com/mail/?view=cm&fs=1&tf=1";

  if (isGoogle) gmail += `&authuser=${encodeURIComponent(from.trim())}`;
  gmail += `&bcc=${encodeURIComponent(list)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const mailto = `mailto:?bcc=${encodeURIComponent(list)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\n/g, "\r\n"))}`;

  return { gmail, mailto, tooLong: Math.max(gmail.length, mailto.length) > NT_MAX_LINK };
}

// The extra line is only allowed in automatic emails if it is short and has no links or addresses (the database enforces this too).
function ntExtraProblem(text) {
  const t = String(text || "").trim();
  if (t.length > 200) return "The extra line is too long: 200 characters at most.";
  if (/(https?:|www\.|:\/\/|@)/i.test(t)) return "For automatic emails the extra line cannot contain web links or email addresses.";
  return "";
}

// Hands a link to the browser. Kept in one place so the page can be tested without leaving it.
function ntOpen(url, newTab) {
  if (newTab) window.open(url, "_blank", "noopener");
  else window.location.href = url;
}

async function ntCopy(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    /* fall through to the older way */
  }

  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    return ok;
  } catch (error) {
    return false;
  }
}

/* ---------- access and data ---------- */
async function ntAccess() {
  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData || !sessionData.session) {
    ntBanner('You are not signed in. <a href="login.html?next=notices.html">Sign in</a> to continue.');
    return false;
  }

  const { data: role, error } = await supabaseClient.rpc("get_my_role", { p_workspace: NT_WORKSPACE });

  if (error) {
    ntBanner("The payroll security update has not been applied yet. Run the database updates in Supabase, then refresh.");
    return false;
  }
  if (!NT_ROLES.includes(role)) {
    ntBanner("Only an admin, a managing director or a payroll officer can email payslip notices.");
    return false;
  }

  ntBanner("");
  return true;
}

async function ntCheckSender() {
  const { data, error } = await supabaseClient.rpc("payslip_notice_sender_ready", { p_workspace: NT_WORKSPACE });
  return !error && data === true;
}

async function ntLoad() {
  const { data, error } = await supabaseClient.rpc("payslip_notice_runs", { p_workspace: NT_WORKSPACE });

  if (error) {
    console.error("Payslip notices could not be loaded:", error);
    const missing = error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message || "");
    ntBanner(missing
      ? "Email payslips is not set up yet. Run phase14-payslip-notices.sql in Supabase, then refresh."
      : ntEsc(error.message || "The payrolls could not be loaded."));
    return false;
  }

  ntRuns = data || [];
  return true;
}

/* ---------- the list ---------- */
function ntRender() {
  const body = ntEl("noticeBody");

  if (!ntRuns.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="5">No processed payrolls yet. Process a payroll, then come back here.</td></tr>';
    return;
  }

  body.innerHTML = ntRuns.map((run) => {
    const sent = Number(run.notices) > 0;
    const status = sent
      ? `<span class="badge ok">Sent</span><small>${ntEsc(ntFmt(run.last_sent_at))} by ${ntEsc(run.last_sent_by || "")}${run.notices > 1 ? ` (${ntEsc(run.notices)} times)` : ""}</small>`
      : '<span class="badge warn">Not sent yet</span>';

    return `<tr>
      <td><strong>${ntEsc(ntPeriodLabel(run.period_start, run.period_end))}</strong></td>
      <td>${ntEsc(ntFmt(run.pay_date))}</td>
      <td class="num">${ntEsc(run.employees)}</td>
      <td>${status}</td>
      <td class="num"><button type="button" class="btn small ${sent ? "" : "primary"}" data-act="prepare" data-run="${ntEsc(run.run_id)}">${sent ? "Email again" : "Prepare email"}</button></td>
    </tr>`;
  }).join("");
}

async function ntRefresh() {
  if (await ntLoad()) ntRender();
}

/* ---------- the dialog ---------- */
function ntCloseDialog() {
  ntEl("ntDialog").hidden = true;
  ntEl("ntDialogBox").innerHTML = "";
  ntCurrent = null;
}

function ntFromDefault() {
  try {
    const saved = localStorage.getItem("kairoxNoticeFrom");
    if (saved) return saved;
  } catch (error) { /* storage can be unavailable */ }

  try {
    const email = (window.KairoxCompany && window.KairoxCompany.profile() || {}).email || "";
    return /@(gmail|googlemail)\.com$/i.test(email) ? email : "";
  } catch (error) {
    return "";
  }
}

function ntUniqueEmails(rows) {
  return [...new Set(rows.map((r) => String(r.login_email || "").trim().toLowerCase()).filter(Boolean))];
}

async function ntPrepare(runId) {
  const run = ntRuns.find((r) => r.run_id === runId);
  if (!run) return;

  ntMessage("", "");
  const { data, error } = await supabaseClient.rpc("payslip_notice_recipients", { p_workspace: NT_WORKSPACE, p_run: runId });

  if (error) {
    ntMessage(error.message || "The notice could not be prepared.", "error");
    return;
  }

  const rows = data || [];
  let company = "Kairox Pay";

  try {
    await window.KairoxCompany.ready();
    company = window.KairoxCompany.companyName() || company;
  } catch (error) { /* the company name is only for the signature */ }

  ntCurrent = {
    run, company,
    label: ntPeriodLabel(run.period_start, run.period_end),
    sendable: rows.filter((r) => r.login_email),
    skipped: rows.filter((r) => !r.login_email),
    extra: "",
    from: ntFromDefault(),
    used: false,
    saving: false
  };

  ntRenderDialog();
}

function ntCurrentMessage() {
  const loginUrl = new URL("login.html", window.location.href).href;
  return ntBuildMessage({ company: ntCurrent.company, label: ntCurrent.label, loginUrl, extra: ntCurrent.extra });
}

function ntRenderDialog() {
  const c = ntCurrent;
  const emails = ntUniqueEmails(c.sendable);
  const sentBefore = Number(c.run.notices) > 0;

  const recipients = emails.length
    ? `<p style="margin:0 0 6px"><strong>${emails.length} ${emails.length === 1 ? "employee" : "employees"}</strong> will get this email. ${ntAutoReady ? "Each gets their own copy," : "Their addresses go in BCC,"} so nobody sees anyone else's address.</p>
       <ul style="margin:0 0 12px;padding-left:20px;font-size:14px">${c.sendable.map((r) => `<li>${ntEsc(r.employee_name)} <span class="muted">(${ntEsc(r.login_email)})</span></li>`).join("")}</ul>`
    : '<div class="note" style="margin:0 0 12px">Nobody in this payroll can sign in to My portal yet, so there is nobody to email. Give people access under <strong>Team &amp; access</strong> first.</div>';

  const skipped = c.skipped.length
    ? `<p class="muted small" style="margin:0 0 12px">Not included, because they cannot sign in yet: ${c.skipped.map((r) => ntEsc(r.employee_name)).join(", ")}. Give them access under Team &amp; access, then prepare this again.</p>`
    : "";

  const earlier = sentBefore
    ? `<div class="note" style="margin:0 0 12px">A notice for this payroll was already recorded on ${ntEsc(ntFmt(c.run.last_sent_at))} by ${ntEsc(c.run.last_sent_by || "someone")}. Only send another if you need to.</div>`
    : "";

  ntEl("ntDialogBox").innerHTML = `
    <h3 id="ntDialogTitle">Email payslip-ready notice</h3>
    <p>Payroll for ${ntEsc(c.label)}, paid ${ntEsc(ntFmt(c.run.pay_date))}</p>
    ${earlier}${recipients}${skipped}
    <div class="form-grid" style="margin-bottom:12px">
      <div class="field"><label for="ntFrom">Send from your Gmail address (optional)</label>
        <input id="ntFrom" type="email" autocomplete="off" placeholder="for example kairoxpay@gmail.com" value="${ntEsc(c.from)}">
        <small>So Gmail opens the right account. Leave it blank to use the one you are already signed in to.</small></div>
      <div class="field"><label for="ntExtra">Add a line to the message (optional)</label>
        <textarea id="ntExtra" maxlength="200" rows="3" placeholder="for example: Payday is Friday.">${ntEsc(c.extra)}</textarea>
        <div id="ntExtraWarn" class="form-message error" style="min-height:0"></div></div>
    </div>
    <div class="muted small" style="margin:0 0 4px">What they will receive:</div>
    <div class="note" id="ntPreview" style="margin:0 0 12px;white-space:pre-wrap"></div>
    <div id="ntTooLong" class="note" style="margin:0 0 12px;display:none"></div>
    ${ntAutoReady ? `<div class="row-actions" style="margin-bottom:10px"><button type="button" class="btn primary" data-nt="send">Send emails now</button></div>
    <div class="muted small" style="margin:0 0 4px">Or send it yourself:</div>` : ""}
    <div class="row-actions" style="margin-bottom:6px">
      <button type="button" class="btn ${ntAutoReady ? "" : "primary"}" data-nt="gmail">Open in Gmail</button>
      <button type="button" class="btn" data-nt="mailto">Open in my mail app</button>
      <button type="button" class="btn" data-nt="copyto">Copy addresses</button>
      <button type="button" class="btn" data-nt="copymsg">Copy message</button>
    </div>
    <div id="ntDialogMsg" class="form-message" role="status"></div>
    <div class="dialog-actions">
      <button type="button" class="btn" data-nt="close">Close</button>
      <button type="button" class="btn ${ntAutoReady ? "" : "primary"}" data-nt="record">${ntAutoReady ? "I sent it myself" : "I've sent it"}</button>
    </div>`;

  ntEl("ntDialog").hidden = false;
  ntRefreshPreview();
}

// Updates the preview and the buttons without redrawing the fields (so typing is never interrupted).
function ntRefreshPreview() {
  if (!ntCurrent) return;

  const emails = ntUniqueEmails(ntCurrent.sendable);
  const message = ntCurrentMessage();
  const links = ntComposeLinks({ bcc: emails, subject: message.subject, body: message.body, from: ntCurrent.from });

  ntEl("ntPreview").textContent = `Subject: ${message.subject}\n\n${message.body}`;

  const tooLong = ntEl("ntTooLong");
  tooLong.style.display = links.tooLong && emails.length ? "block" : "none";
  tooLong.textContent = links.tooLong
    ? "That is too many addresses to put in a link. Click Copy addresses and Copy message, then open Gmail, and paste them into the BCC box and the message."
    : "";

  const box = ntEl("ntDialogBox");
  const set = (name, disabled) => { const b = box.querySelector(`[data-nt="${name}"]`); if (b) b.disabled = disabled; };
  set("gmail", !emails.length || links.tooLong);
  set("mailto", !emails.length || links.tooLong);
  set("copyto", !emails.length);
  set("copymsg", !emails.length);
  set("record", !emails.length || ntCurrent.saving);

  const problem = ntExtraProblem(ntCurrent.extra);
  const warn = ntEl("ntExtraWarn");
  if (warn) warn.textContent = ntAutoReady ? problem : "";
  set("send", !emails.length || ntCurrent.saving || !!problem);

  ntCurrent.links = links;
  ntCurrent.emails = emails;
  ntCurrent.message = message;
}

function ntDialogMessage(text, kind) {
  const box = ntEl("ntDialogMsg");
  if (!box) return;
  box.textContent = text || "";
  box.className = `form-message ${kind || ""}`.trim();
}

async function ntRecord() {
  const c = ntCurrent;
  if (!c || c.saving || !c.emails.length) return;

  if (!c.used && !window.confirm("You have not opened or copied the email yet. Record it as sent anyway?")) return;

  c.saving = true;
  ntRefreshPreview();

  const { error } = await supabaseClient.rpc("record_payslip_notice", { p_workspace: NT_WORKSPACE, p_run: c.run.run_id, p_recipients: c.emails.length });

  if (error) {
    c.saving = false;
    ntRefreshPreview();
    ntDialogMessage(error.message || "It could not be recorded. Please try again.", "error");
    return;
  }

  const label = c.label;
  const count = c.emails.length;
  ntCloseDialog();
  ntMessage(`Recorded: the notice for ${label} went to ${count} ${count === 1 ? "employee" : "employees"}.`, "ok");
  await ntRefresh();
}

// The database sends the emails itself, through your Google script. It records them too, so there is no "I've sent it" step.
async function ntSendNow() {
  const c = ntCurrent;
  if (!c || c.saving || !c.emails.length || ntExtraProblem(c.extra)) return;

  const n = c.emails.length;
  const again = Number(c.run.notices) > 0;
  const question = `Send the payslip-ready email to ${n} ${n === 1 ? "employee" : "employees"} now?` +
    (again ? "\n\nA notice for this payroll was already recorded, so this will send another." : "");

  if (!window.confirm(question)) return;

  c.saving = true;
  ntRefreshPreview();
  ntDialogMessage("Sending…", "");

  const { data, error } = await supabaseClient.rpc("send_payslip_notices", {
    p_workspace: NT_WORKSPACE, p_run: c.run.run_id, p_extra: c.extra.trim(), p_again: again
  });

  if (error) {
    c.saving = false;
    ntRefreshPreview();
    ntDialogMessage(error.message || "The emails could not be sent.", "error");
    return;
  }

  const queued = Number(data && data.queued) || 0;
  const failed = Number(data && data.failed) || 0;
  const label = c.label;

  ntCloseDialog();
  ntMessage(failed
    ? `${queued} ${queued === 1 ? "email was" : "emails were"} sent for ${label}, but ${failed} could not be sent. Check Settings, Email alerts, then use Email again, or open Gmail for the rest.`
    : `Sent: the notice for ${label} went to ${queued} ${queued === 1 ? "employee" : "employees"}. It can take a minute to arrive, and it is recorded below.`,
    failed ? "error" : "ok");
  await ntRefresh();
}

async function ntDialogAction(name) {
  const c = ntCurrent;
  if (!c) return;

  if (name === "close") return ntCloseDialog();
  if (name === "record") return ntRecord();
  if (name === "send") return ntSendNow();

  if (name === "gmail") {
    c.used = true;
    try { localStorage.setItem("kairoxNoticeFrom", c.from || ""); } catch (error) { /* ignore */ }
    ntOpen(c.links.gmail, true);
    ntDialogMessage("Gmail should have opened in a new tab. Press Send there, then come back and click I've sent it.", "ok");
  }
  if (name === "mailto") {
    c.used = true;
    ntOpen(c.links.mailto, false);
    ntDialogMessage("Your mail app should have opened. Press Send there, then come back and click I've sent it.", "ok");
  }
  if (name === "copyto") {
    const ok = await ntCopy(c.emails.join(", "));
    if (ok) c.used = true;
    ntDialogMessage(ok ? "Addresses copied. Paste them into the BCC box." : "Could not copy. Select the addresses above and copy them by hand.", ok ? "ok" : "error");
  }
  if (name === "copymsg") {
    const ok = await ntCopy(`Subject: ${c.message.subject}\n\n${c.message.body}`);
    if (ok) c.used = true;
    ntDialogMessage(ok ? "Message copied." : "Could not copy the message.", ok ? "ok" : "error");
  }
}

/* ---------- start ---------- */
async function ntStart() {
  document.addEventListener("click", (event) => {
    const prepare = event.target.closest && event.target.closest('[data-act="prepare"]');
    if (prepare) return ntPrepare(prepare.dataset.run);

    const action = event.target.closest && event.target.closest("[data-nt]");
    if (action) return ntDialogAction(action.dataset.nt);

    if (event.target.id === "ntDialog") ntCloseDialog();
  });

  document.addEventListener("input", (event) => {
    if (!ntCurrent) return;
    if (event.target.id === "ntFrom") ntCurrent.from = event.target.value.trim();
    if (event.target.id === "ntExtra") ntCurrent.extra = event.target.value;
    if (event.target.id === "ntFrom" || event.target.id === "ntExtra") ntRefreshPreview();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && ntCurrent) ntCloseDialog();
  });

  if (!(await ntAccess())) {
    ntEl("noticeBody").innerHTML = '<tr class="empty-row"><td colspan="5">Sign in with a payroll role to see this.</td></tr>';
    return;
  }

  ntAutoReady = await ntCheckSender();
  await ntRefresh();
}

ntStart();