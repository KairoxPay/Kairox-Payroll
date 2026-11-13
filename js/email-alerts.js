// Settings > Email alerts (admin only): switch the leave alert on or off, send yourself a test email, and see what was sent.
// The emails themselves are sent by the database through your Google Apps Script (see README-PHASE-16.md); nothing here can send mail.

const emEl = (id) => document.getElementById(id);
const emEsc = (value = "") =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function emWhen(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

// What happened to one email, in words. The script's own short reply (when we have it) is the most reliable clue.
function emResult(row) {
  const reply = String(row.reply || "");

  if (row.status === "not queued") return { text: "Not sent: the web request failed", css: "late" };
  if (/"ok"\s*:\s*true/.test(reply)) return { text: "Sent", css: "ok" };
  if (/not allowed/.test(reply)) return { text: "Refused: the secret does not match the script's SECRET", css: "late" };
  if (/not configured/.test(reply)) return { text: "Refused: the script has no SECRET yet", css: "late" };
  if (/daily limit/.test(reply)) return { text: "Not sent: the daily limit was reached", css: "warn" };
  if (row.http_status === null || row.http_status === undefined) {
    // Supabase only keeps Google's answer for a few hours, so an older email with no answer is not a problem, just an expired record
    const hours = (Date.now() - new Date(row.created_at).getTime()) / 3600000;
    return hours > 6
      ? { text: "Handed to the mail service (Google's answer is only kept for a few hours)", css: "info" }
      : { text: "Waiting for an answer", css: "info" };
  }
  if (row.http_status >= 400) return { text: `The script address answered with error ${row.http_status}`, css: "late" };
  return { text: "Handed to the mail service", css: "info" };
}

const emKinds = { leave_request: "Leave request", test: "Test email" };

function emRenderLog(rows) {
  const box = emEl("emailLog");

  if (!rows.length) {
    box.innerHTML = '<p class="settings-meta">Nothing has been sent yet.</p>';
    return;
  }

  box.innerHTML = `<h3 style="margin:0 0 6px;font-size:15px">Recent emails</h3>
    <div class="payroll-table-wrap"><table style="min-width:560px">
      <thead><tr><th>When</th><th>What</th><th>People</th><th>Result</th></tr></thead>
      <tbody>${rows.map((r) => {
        const result = emResult(r);
        return `<tr><td>${emEsc(emWhen(r.created_at))}</td><td>${emEsc(emKinds[r.kind] || r.kind)}<small style="display:block;color:#6f7285">${emEsc(r.subject)}</small></td><td>${emEsc(r.recipients)}</td><td data-result="${emEsc(result.css)}">${emEsc(result.text)}</td></tr>`;
      }).join("")}</tbody></table></div>`;
}

async function loadEmailAlerts() {
  const [status, log] = await Promise.all([
    supabaseClient.rpc("email_alert_status", { p_workspace: SETTINGS_WORKSPACE }),
    supabaseClient.rpc("email_alert_log", { p_workspace: SETTINGS_WORKSPACE })
  ]);

  const line = emEl("emailStatus");

  if (status.error) {
    line.textContent = "Email alerts are not set up yet. Run phase16-email-alerts.sql in Supabase, then refresh.";
    ["emailLeave", "emailLeaveType", "emailDirectors", "saveEmailButton"].forEach((id) => { emEl(id).disabled = true; });
    emEl("testEmailButton").disabled = true;
    emEl("emailLog").innerHTML = "";
    return;
  }

  const s = (status.data || [])[0] || {};
  const ready = !!s.gateway_ready && !!s.sender_ready;

  line.textContent = !s.sender_ready
    ? "Not ready: switch on pg_net in Supabase (Database, then Extensions)."
    : !s.gateway_ready
      ? "Not ready: finish the Google Apps Script set-up, then run set_email_gateway (see the guide)."
      : "Ready: emails can be sent from your Gmail.";
  line.dataset.ready = ready ? "yes" : "no";

  emEl("emailLeave").checked = !!s.leave_requests;
  emEl("emailLeaveType").checked = s.include_leave_type !== false;   // included unless an admin switched it off
  emEl("emailDirectors").checked = !!s.notify_directors;
  emEl("testEmailButton").disabled = !ready;
  emEl("emailMeta").textContent = s.updated_by ? `Last changed by ${s.updated_by}.` : "Off until you switch it on.";
  emRenderLog(log.error ? [] : log.data || []);
}

async function saveEmailAlerts() {
  const { error } = await supabaseClient.rpc("set_email_alerts", {
    p_workspace: SETTINGS_WORKSPACE,
    p_leave: emEl("emailLeave").checked,
    p_include_type: emEl("emailLeaveType").checked,
    p_include_directors: emEl("emailDirectors").checked
  });

  if (error) {
    setSettingsMessage(error.message || "Email alert settings were not saved.", "error");
    return;
  }

  setSettingsMessage("Email alert settings saved.", "ok");
  await loadEmailAlerts();
}

async function sendTestEmail() {
  const button = emEl("testEmailButton");
  button.disabled = true;

  const { error } = await supabaseClient.rpc("send_test_email", { p_workspace: SETTINGS_WORKSPACE });

  if (error) {
    setSettingsMessage(error.message || "The test email could not be sent.", "error");
    button.disabled = false;
    return;
  }

  setSettingsMessage("Test email queued. It should reach your inbox within a minute (look in spam too). The list below shows what happened.", "ok");
  setTimeout(loadEmailAlerts, 4000);
}

if (emEl("saveEmailButton")) {
  emEl("saveEmailButton").addEventListener("click", saveEmailAlerts);
  emEl("testEmailButton").addEventListener("click", sendTestEmail);
}