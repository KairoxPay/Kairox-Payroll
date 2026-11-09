// Which company the signed-in person is working in (chosen with the company switcher). Kairox Exchange by default.
function kairoxWorkspaceId() {
  try {
    return localStorage.getItem("kairoxWorkspace") || "kairox-exchange";
  } catch (error) {
    return "kairox-exchange";
  }
}

const LV_WORKSPACE = kairoxWorkspaceId();
const LV_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const LV_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

let lvRole = null;
let lvEmployees = [];
let lvTypes = [];
let lvRequests = [];
let lvHolidays = [];
let lvBalances = [];
const lvBalanceCache = {};
let lvYear = new Date().getFullYear();
let lvMonth = { y: new Date().getFullYear(), m: new Date().getMonth() };

const $ = (id) => document.getElementById(id);
const lvEsc = (value = "") =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function lvToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function lvIso(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function lvParse(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
function lvFmt(iso) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(lvParse(iso));
}
function lvRange(r) {
  return r.start_date === r.end_date ? lvFmt(r.start_date) : `${lvFmt(r.start_date)} to ${lvFmt(r.end_date)}`;
}
function lvDays(n) {
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : String(v);
}
const lvCanRecord = () => ["admin", "director", "payroll", "hr", "manager"].includes(lvRole);
const lvCanDecide = () => ["admin", "director", "hr", "manager"].includes(lvRole);   // a manager only ever sees their own team
const lvCanAdjust = () => lvRole === "admin" || lvRole === "director";
const lvIsAdmin = () => lvRole === "admin";   // leave types, holidays and other settings
const lvEmp = (id) => lvEmployees.find((e) => e.id === id);
const lvType = (id) => lvTypes.find((t) => t.id === id);
const lvEmpName = (id) => (lvEmp(id) ? lvEmp(id).name : "Former employee");
const lvActiveEmployees = () => lvEmployees.filter((e) => String(e.employment_status || "").toLowerCase() !== "archived");

function lvBanner(html) {
  const banner = $("pageBanner");
  banner.innerHTML = html;
  banner.hidden = !html;
}
function lvMessage(text, kind) {
  const box = $("leaveMessage");
  box.textContent = text || "";
  box.className = `form-message ${kind || ""}`.trim();
}

/* ---------- access ---------- */
async function lvAccess() {
  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData || !sessionData.session) {
    lvBanner('You are not signed in. <a href="login.html?next=leave.html">Sign in</a> to continue.');
    return false;
  }

  const { data: role, error } = await supabaseClient.rpc("get_my_role", { p_workspace: kairoxWorkspaceId() });

  if (error) {
    lvBanner("The payroll security update has not been applied yet. Run the database updates in Supabase, then refresh.");
    return false;
  }
  if (!role) {
    lvBanner("Your account does not have a payroll role for this company yet. Ask an admin to give you access.");
    return false;
  }

  lvRole = role;
  lvBanner("");
  return true;
}

/* ---------- loading ---------- */
async function lvLoad() {
  const noPayAccess = lvRole === "hr" || lvRole === "manager";
  const [emp, types, reqs, hol] = await Promise.all([
    noPayAccess
      ? supabaseClient.rpc("people_directory", { p_workspace: LV_WORKSPACE })
      : supabaseClient.from("employees").select("id, name, employment_status, start_date, department").eq("workspace", LV_WORKSPACE).order("name", { ascending: true }),
    supabaseClient.from("leave_types").select("*").eq("workspace", LV_WORKSPACE).order("sort_order", { ascending: true }),
    supabaseClient.from("leave_requests").select("*").eq("workspace", LV_WORKSPACE).order("start_date", { ascending: false }),
    supabaseClient.from("public_holidays").select("*").order("holiday_date", { ascending: true })
  ]);

  if (types.error || reqs.error) {
    console.error("Leave could not be loaded:", types.error || reqs.error);
    lvBanner("Leave is not set up yet. Run phase7-leave-migration.sql in Supabase, then refresh.");
    return false;
  }

  lvEmployees = emp.data || [];
  lvTypes = types.data || [];
  lvRequests = reqs.data || [];
  lvHolidays = hol.data || [];
  Object.keys(lvBalanceCache).forEach((k) => delete lvBalanceCache[k]);
  lvBalances = await lvBalancesFor(lvYear);
  return true;
}

async function lvBalancesFor(year) {
  if (lvBalanceCache[year]) return lvBalanceCache[year];

  const { data, error } = await supabaseClient.rpc("leave_balances", { p_workspace: LV_WORKSPACE, p_year: year });

  if (error) {
    console.error("Balances could not be loaded:", error);
    return [];
  }

  lvBalanceCache[year] = data || [];
  return lvBalanceCache[year];
}

/* ---------- summary cards ---------- */
function lvRenderStats() {
  const today = lvIso(lvToday());
  const approved = lvRequests.filter((r) => r.status === "approved");
  const away = approved.filter((r) => r.start_date <= today && r.end_date >= today);
  const names = [...new Set(away.map((r) => lvEmpName(r.employee_id)))];
  const waiting = lvRequests.filter((r) => r.status === "pending");
  const limit = lvIso(new Date(lvToday().getTime() + 30 * 86400000));
  const soon = [...new Set(approved.filter((r) => r.start_date > today && r.start_date <= limit).map((r) => r.employee_id))];
  const taken = approved.filter((r) => String(r.start_date).startsWith(String(lvYear))).reduce((t, r) => t + Number(r.days), 0);

  $("statToday").textContent = String(names.length);
  $("statTodayDetail").textContent = names.length ? names.slice(0, 3).join(", ") + (names.length > 3 ? ` and ${names.length - 3} more` : "") : "Everyone is in";
  $("statWaiting").textContent = String(waiting.length);
  $("statWaitingDetail").textContent = waiting.length ? (lvCanDecide() ? "Needs your decision" : "Waiting for an approver") : "Nothing waiting";
  $("statWaitingCard").className = `stat-card ${waiting.length ? "warn" : ""}`.trim();
  $("statSoon").textContent = String(soon.length);
  $("statSoonDetail").textContent = soon.length ? `${soon.length} ${soon.length === 1 ? "person" : "people"} going on approved leave` : "No approved leave starting soon";
  $("statTakenLabel").textContent = `Leave days taken in ${lvYear}`;
  $("statTaken").textContent = lvDays(taken);
}

/* ---------- requests ---------- */
function lvStatusBadge(r) {
  const map = { pending: ["warn", "Waiting"], approved: ["ok", "Approved"], rejected: ["late", "Declined"], cancelled: ["info", "Cancelled"] };
  const [css, label] = map[r.status] || ["info", r.status];
  return `<span class="badge ${css}">${label}</span>`;
}

function lvNeedsCertificate(r) {
  const t = lvType(r.leave_type_id);
  return !!(t && t.certificate_after_days && Number(r.days) > Number(t.certificate_after_days) && ["pending", "approved"].includes(r.status));
}

function lvRenderRequests() {
  const body = $("reqBody");
  const filter = $("reqFilter").value;
  const term = $("reqSearch").value.trim().toLowerCase();
  const today = lvIso(lvToday());

  const rows = lvRequests.filter((r) => {
    if (term && !lvEmpName(r.employee_id).toLowerCase().includes(term)) return false;
    if (filter === "pending") return r.status === "pending";
    if (filter === "current") return r.status === "pending" || (r.status === "approved" && r.end_date >= today);
    if (filter === "past") return r.status === "approved" && r.end_date < today;
    if (filter === "declined") return r.status === "rejected" || r.status === "cancelled";
    return true;
  });

  if (!lvRequests.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">No leave has been recorded yet.</td></tr>';
    return;
  }
  if (!rows.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">Nothing matches. Try a different filter.</td></tr>';
    return;
  }

  body.innerHTML = rows
    .map((r) => {
      const t = lvType(r.leave_type_id) || { name: "Leave", color: "#64748b", paid: true };
      let actions = "";

      if (r.status === "pending" && lvCanDecide()) {
        actions += `<button type="button" class="btn small primary" data-act="approve" data-id="${r.id}">Approve</button><button type="button" class="btn small" data-act="reject" data-id="${r.id}">Decline</button>`;
      }
      if ((r.status === "pending" && lvCanRecord()) || (r.status === "approved" && (lvRole === "admin" || lvRole === "director" || lvRole === "hr"))) {
        actions += `<button type="button" class="btn small danger" data-act="cancel" data-id="${r.id}">Cancel</button>`;
      }

      const certificate = lvNeedsCertificate(r)
        ? `<small>Medical certificate: ${r.certificate_received ? "received" : "needed"}${
            lvCanRecord() ? ` <button type="button" class="btn small" data-act="cert" data-id="${r.id}" data-value="${r.certificate_received ? "0" : "1"}">${r.certificate_received ? "Mark as not received" : "Mark as received"}</button>` : ""
          }</small>`
        : "";
      const decided = r.decided_by && r.status !== "pending" ? `<small>${lvEsc(r.decided_by)}${r.decision_note ? ": " + lvEsc(r.decision_note) : ""}</small>` : `<small>Asked by ${lvEsc(r.requested_by)}</small>`;

      return `
        <tr data-id="${r.id}">
          <td><strong>${lvEsc(lvEmpName(r.employee_id))}</strong></td>
          <td><span class="badge" style="background:${lvEsc(t.color)}22;color:#17172f;border:1px solid ${lvEsc(t.color)}">${lvEsc(t.name)}</span><small>${t.paid ? "Paid" : "Unpaid"}</small></td>
          <td>${lvEsc(lvRange(r))}${r.half_day ? " (half day)" : ""}${r.note ? `<small>${lvEsc(r.note)}</small>` : ""}${certificate}</td>
          <td class="num">${lvDays(r.days)}</td>
          <td>${lvStatusBadge(r)}${decided}</td>
          <td><div class="row-actions">${actions}</div></td>
        </tr>`;
    })
    .join("");
}

/* ---------- balances ---------- */
function lvRenderBalances() {
  const types = lvTypes.filter((t) => t.active).sort((a, b) => a.sort_order - b.sort_order);
  const head = $("balHead");
  const body = $("balBody");

  head.innerHTML = `<tr><th>Employee</th>${types.map((t) => `<th>${lvEsc(t.name)}</th>`).join("")}${lvCanAdjust() ? "<th></th>" : ""}</tr>`;

  const people = lvActiveEmployees();

  if (!people.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="${types.length + 2}">No employees yet.</td></tr>`;
    return;
  }

  body.innerHTML = people
    .map((e) => {
      const cells = types
        .map((t) => {
          const b = lvBalances.find((x) => x.employee_id === e.id && x.leave_type_id === t.id);
          if (!b) return "<td>—</td>";
          if (b.remaining === null) return `<td>${lvDays(b.taken)} taken<small>${lvDays(b.pending)} waiting</small></td>`;
          const total = Number(b.entitlement) + Number(b.adjustments);
          if (Number(b.entitlement) === 0 && Number(b.adjustments) === 0) {
            return `<td class="muted">${b.eligible_from ? "From " + lvFmt(b.eligible_from) : "None"}</td>`;
          }
          return `<td><strong>${lvDays(b.remaining)} left</strong><small>of ${lvDays(total)}${Number(b.adjustments) ? " (incl. " + (b.adjustments > 0 ? "+" : "") + lvDays(b.adjustments) + " adjusted)" : ""}${Number(b.pending) ? ", " + lvDays(b.pending) + " waiting" : ""}</small></td>`;
        })
        .join("");

      return `<tr><td><strong>${lvEsc(e.name)}</strong></td>${cells}${lvCanAdjust() ? `<td><button type="button" class="btn small" data-act="adjust" data-emp="${e.id}">Adjust</button></td>` : ""}</tr>`;
    })
    .join("");
}

/* ---------- calendar ---------- */
function lvRenderCalendar() {
  const { y, m } = lvMonth;
  const count = new Date(y, m + 1, 0).getDate();
  const holidays = Object.fromEntries(lvHolidays.map((h) => [String(h.holiday_date).slice(0, 10), h.name]));
  $("calLabel").textContent = `${LV_MONTHS[m]} ${y}`;

  const dayInfo = [];
  for (let d = 1; d <= count; d++) {
    const date = new Date(y, m, d);
    const iso = lvIso(date);
    dayInfo.push({ d, iso, weekend: date.getDay() === 0 || date.getDay() === 6, holiday: holidays[iso] || null, letter: LV_WEEKDAYS[date.getDay()][0] });
  }

  $("calHead").innerHTML =
    '<tr><th style="min-width:150px">Employee</th>' +
    dayInfo
      .map((x) => `<th title="${lvEsc(x.holiday || LV_WEEKDAYS[new Date(y, m, x.d).getDay()])}" style="padding:6px 2px;text-align:center;font-size:11px;${x.weekend ? "background:#efeaf8;" : ""}${x.holiday ? "background:#dff5f3;" : ""}">${x.d}<br>${x.letter}</th>`)
      .join("") +
    "</tr>";

  const monthStart = dayInfo[0].iso;
  const monthEnd = dayInfo[count - 1].iso;
  const live = lvRequests.filter((r) => ["approved", "pending"].includes(r.status) && r.start_date <= monthEnd && r.end_date >= monthStart);
  const people = lvEmployees.filter((e) => String(e.employment_status || "").toLowerCase() !== "archived" || live.some((r) => r.employee_id === e.id));

  $("calBody").innerHTML = people.length
    ? people
        .map((e) => {
          const cells = dayInfo
            .map((x) => {
              const hit = live.filter((r) => r.employee_id === e.id && r.start_date <= x.iso && r.end_date >= x.iso).sort((a) => (a.status === "approved" ? -1 : 1))[0];
              if (hit && !x.weekend && !x.holiday) {
                const t = lvType(hit.leave_type_id) || { name: "Leave", color: "#64748b" };
                const style = hit.status === "approved" ? `background:${t.color};` : `background:${t.color}55;outline:1px dashed ${t.color};outline-offset:-2px;`;
                return `<td class="cal-leave" data-status="${hit.status}" title="${lvEsc(t.name)} (${hit.status === "approved" ? "approved" : "waiting"})${hit.half_day ? ", half day" : ""}" style="padding:0;height:28px;${style}"></td>`;
              }
              return `<td style="padding:0;height:28px;${x.weekend ? "background:#efeaf8;" : ""}${x.holiday ? "background:#dff5f3;" : ""}"></td>`;
            })
            .join("");
          return `<tr><td><strong>${lvEsc(e.name)}</strong></td>${cells}</tr>`;
        })
        .join("")
    : `<tr class="empty-row"><td colspan="${count + 1}">No employees yet.</td></tr>`;

  $("calLegend").innerHTML =
    lvTypes.filter((t) => t.active).map((t) => `<span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${lvEsc(t.color)};vertical-align:-1px"></span> ${lvEsc(t.name)}</span>`).join("") +
    '<span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#dff5f3;vertical-align:-1px"></span> Public holiday</span>';
}

/* ---------- settings: leave types and public holidays ---------- */
function lvRenderSettings() {
  const sorted = [...lvTypes].sort((a, b) => a.sort_order - b.sort_order);

  $("typesBody").innerHTML = sorted
    .map((t) => {
      const eligible = t.eligibility_months ? `${t.eligibility_months} months` : "Straight away";
      const days = t.annual_days === null ? "No limit" : lvDays(t.annual_days) + (t.increase_after_years ? ` (${lvDays(t.increased_days)} after ${t.increase_after_years} years)` : "");
      return `
        <tr${t.active ? "" : ' style="opacity:.55"'}>
          <td><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${lvEsc(t.color)};margin-right:6px"></span><strong>${lvEsc(t.name)}</strong>${t.active ? "" : "<small>Turned off</small>"}</td>
          <td>${t.paid ? "Paid" : "Unpaid"}</td>
          <td class="num">${lvEsc(days)}</td>
          <td>${eligible}</td>
          <td><small>${lvEsc(t.note || "")}</small></td>
          <td>${lvIsAdmin() ? `<button type="button" class="btn small" data-act="edit-type" data-id="${t.id}">Edit</button>` : ""}</td>
        </tr>`;
    })
    .join("");

  const year = String(lvYear);
  const list = lvHolidays.filter((h) => String(h.holiday_date).startsWith(year));
  $("holidayNote").textContent = list.length
    ? `Public holidays in ${year}. These are not counted as leave days. Check them against the Government's announcement.`
    : `No public holidays are entered for ${year}, so holidays would be counted as leave days. ${lvIsAdmin() ? "Add them below." : "Ask an admin to add them."}`;
  $("holidayBody").innerHTML = list.length
    ? list
        .map((h) => {
          const iso = String(h.holiday_date).slice(0, 10);
          return `<tr><td>${lvEsc(lvFmt(iso))}</td><td>${LV_WEEKDAYS[lvParse(iso).getDay()]}</td><td>${lvEsc(h.name)}</td><td>${lvIsAdmin() ? `<button type="button" class="btn small danger" data-act="del-holiday" data-date="${iso}">Remove</button>` : ""}</td></tr>`;
        })
        .join("")
    : '<tr class="empty-row"><td colspan="4">None yet.</td></tr>';
}

function lvRenderAll() {
  lvRenderStats();
  lvRenderRequests();
  lvRenderBalances();
  lvRenderCalendar();
  lvRenderSettings();
}

/* ---------- dialogs ---------- */
function lvCloseDialog() {
  $("lvDialog").hidden = true;
  $("lvDialogForm").innerHTML = "";
}

function lvDialog({ title, subtitle, bodyHtml, submitText, onSubmit, danger }) {
  const form = $("lvDialogForm");

  form.innerHTML =
    `<h3 id="lvDialogTitle">${lvEsc(title)}</h3><p>${lvEsc(subtitle || "")}</p>${bodyHtml}` +
    '<div class="form-message error" id="lvDialogError" role="alert"></div>' +
    `<div class="dialog-actions"><button type="button" class="btn" id="lvDialogCancel">Cancel</button><button type="submit" class="btn ${danger ? "danger" : "primary"}" id="lvDialogSubmit">${lvEsc(submitText)}</button></div>`;
  $("lvDialog").hidden = false;

  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = $("lvDialogSubmit");
    button.disabled = true;
    const problem = await onSubmit(form);
    button.disabled = false;

    if (problem) {
      $("lvDialogError").textContent = problem;
    } else {
      lvCloseDialog();
    }
  };

  $("lvDialogCancel").onclick = lvCloseDialog;
  const first = form.querySelector("select, input, textarea");
  if (first) first.focus();
}

const lvField = (id, label, control, hint) =>
  `<div class="field" style="margin-bottom:12px"><label for="${id}">${lvEsc(label)}</label>${control}${hint ? `<small>${hint}</small>` : ""}</div>`;

async function lvUpdateSummary() {
  const box = $("lvSummary");
  if (!box) return;

  const empId = $("lvEmp").value;
  const typeId = $("lvType").value;
  const start = $("lvStart").value;
  const end = $("lvHalf").checked ? start : $("lvEnd").value;

  if (!empId || !typeId || !start || !end || end < start) {
    box.textContent = "";
    return;
  }

  const { data: days } = await supabaseClient.rpc("leave_working_days", { p_start: start, p_end: end, p_half: $("lvHalf").checked });
  const t = lvType(typeId);
  const year = Number(start.slice(0, 4));
  const balances = await lvBalancesFor(year);
  const b = balances.find((x) => x.employee_id === empId && x.leave_type_id === typeId);
  let text = `${lvDays(days || 0)} working day${Number(days) === 1 ? "" : "s"} (weekends and public holidays are not counted). `;
  let colour = "#35156f";

  if (!Number(days)) {
    text = "Those dates have no working days.";
    colour = "#b91c1c";
  } else if (b && b.remaining !== null) {
    const after = Number(b.remaining) - Number(days);
    text += `${lvEsc(lvEmpName(empId))} has ${lvDays(b.remaining)} day(s) of ${t.name} left in ${year}${after >= 0 ? `, ${lvDays(after)} after this.` : ", so this is more than they have left."}`;
    if (after < 0) colour = "#b91c1c";
  }

  if (t && t.certificate_after_days && Number(days) > Number(t.certificate_after_days)) {
    text += ` A medical certificate will be needed (more than ${t.certificate_after_days} days).`;
  }

  box.style.color = colour;
  box.textContent = text;
}

function lvRecordDialog(preset = {}) {
  const emps = lvActiveEmployees();
  const types = lvTypes.filter((t) => t.active).sort((a, b) => a.sort_order - b.sort_order);

  if (!emps.length) return lvMessage("Add an employee first.", "error");

  const today = lvIso(lvToday());
  const body =
    lvField("lvEmp", "Employee", `<select id="lvEmp">${emps.map((e) => `<option value="${e.id}"${e.id === preset.emp ? " selected" : ""}>${lvEsc(e.name)}</option>`).join("")}</select>`) +
    lvField("lvType", "Type of leave", `<select id="lvType">${types.map((t) => `<option value="${t.id}">${lvEsc(t.name)}${t.paid ? "" : " (unpaid)"}</option>`).join("")}</select>`) +
    `<div class="form-grid">${lvField("lvStart", "First day", `<input id="lvStart" type="date" value="${today}">`)}${lvField("lvEnd", "Last day", `<input id="lvEnd" type="date" value="${today}">`)}</div>` +
    '<label style="display:flex;gap:8px;align-items:center;margin:0 0 12px;font-weight:600"><input id="lvHalf" type="checkbox"> Half day (one day only)</label>' +
    lvField("lvNote", "Note (optional)", '<input id="lvNote" type="text" maxlength="300" autocomplete="off">', "Please do not enter medical details.") +
    (lvCanDecide() ? '<label style="display:flex;gap:8px;align-items:center;margin:0 0 12px;font-weight:600"><input id="lvApprove" type="checkbox"> Approve straight away</label>' : "") +
    '<div id="lvSummary" role="status" style="min-height:22px;font-size:14px;font-weight:700;margin-bottom:6px"></div>';

  lvDialog({
    title: "Record leave",
    subtitle: lvCanDecide() ? "It waits for approval unless you tick the box." : "It will wait for an approver.",
    bodyHtml: body,
    submitText: "Save",
    onSubmit: async () => {
      const half = $("lvHalf").checked;
      const start = $("lvStart").value;
      const { error } = await supabaseClient.rpc("request_leave", {
        p_workspace: LV_WORKSPACE,
        p_employee: $("lvEmp").value,
        p_leave_type: $("lvType").value,
        p_start: start,
        p_end: half ? start : $("lvEnd").value,
        p_half: half,
        p_note: $("lvNote").value.trim(),
        p_approve: lvCanDecide() && $("lvApprove") ? $("lvApprove").checked : false
      });

      if (error) return error.message || "The leave was not saved.";

      lvMessage(lvCanDecide() && $("lvApprove") && $("lvApprove").checked ? "Leave recorded and approved." : "Leave recorded. It is waiting for approval.", "ok");
      await lvRefresh();
      return null;
    }
  });

  ["lvEmp", "lvType", "lvStart", "lvEnd", "lvHalf"].forEach((id) => $(id).addEventListener("change", lvUpdateSummary));
  $("lvStart").addEventListener("change", () => { if ($("lvEnd").value < $("lvStart").value) $("lvEnd").value = $("lvStart").value; lvUpdateSummary(); });
  $("lvHalf").addEventListener("change", () => { $("lvEnd").disabled = $("lvHalf").checked; });
  lvUpdateSummary();
}

function lvDecideDialog(request, decision) {
  const approve = decision === "approve";
  lvDialog({
    title: approve ? "Approve leave" : "Decline leave",
    subtitle: `${lvEmpName(request.employee_id)}: ${(lvType(request.leave_type_id) || {}).name || "Leave"}, ${lvRange(request)} (${lvDays(request.days)} day${Number(request.days) === 1 ? "" : "s"})`,
    bodyHtml: lvField("lvDecisionNote", "Note (optional)", '<input id="lvDecisionNote" type="text" maxlength="300" autocomplete="off">'),
    submitText: approve ? "Approve" : "Decline",
    danger: !approve,
    onSubmit: async () => {
      const { error } = await supabaseClient.rpc("decide_leave", { p_request: request.id, p_decision: decision, p_note: $("lvDecisionNote").value.trim() });
      if (error) return error.message || "That could not be saved.";
      lvMessage(approve ? "Leave approved." : "Leave declined.", "ok");
      await lvRefresh();
      return null;
    }
  });
}

function lvCancelDialog(request) {
  lvDialog({
    title: "Cancel this leave?",
    subtitle: `${lvEmpName(request.employee_id)}: ${lvRange(request)}. The days go back to their balance.`,
    bodyHtml: lvField("lvCancelNote", "Reason (optional)", '<input id="lvCancelNote" type="text" maxlength="300" autocomplete="off">'),
    submitText: "Cancel the leave",
    danger: true,
    onSubmit: async () => {
      const { error } = await supabaseClient.rpc("cancel_leave", { p_request: request.id, p_note: $("lvCancelNote").value.trim() });
      if (error) return error.message || "That could not be cancelled.";
      lvMessage("Leave cancelled.", "ok");
      await lvRefresh();
      return null;
    }
  });
}

function lvAdjustDialog(empId) {
  const types = lvTypes.filter((t) => t.active && t.annual_days !== null).sort((a, b) => a.sort_order - b.sort_order);
  lvDialog({
    title: "Adjust leave balance",
    subtitle: `${lvEmpName(empId)}, ${lvYear}. Use a negative number to take days off.`,
    bodyHtml:
      lvField("lvAdjType", "Type of leave", `<select id="lvAdjType">${types.map((t) => `<option value="${t.id}">${lvEsc(t.name)}</option>`).join("")}</select>`) +
      lvField("lvAdjDays", "Days to add (or take off)", '<input id="lvAdjDays" type="number" step="0.5" min="-365" max="365">') +
      lvField("lvAdjReason", "Reason", '<input id="lvAdjReason" type="text" maxlength="200" autocomplete="off">', "For example: carried over from last year, or leave earned in their first year."),
    submitText: "Save adjustment",
    onSubmit: async () => {
      const days = Number($("lvAdjDays").value);
      if (!days) return "Please enter the number of days to add or take off.";

      const { error } = await supabaseClient.rpc("adjust_leave_balance", {
        p_workspace: LV_WORKSPACE, p_employee: empId, p_leave_type: $("lvAdjType").value, p_year: lvYear, p_days: days, p_reason: $("lvAdjReason").value.trim()
      });
      if (error) return error.message || "That could not be saved.";
      lvMessage("Balance adjusted.", "ok");
      await lvRefresh();
      return null;
    }
  });
}

function lvTypeDialog(type) {
  const t = type || { name: "", paid: true, annual_days: 5, eligibility_months: 0, increase_after_years: null, increased_days: null, certificate_after_days: null, color: "#5b2c83", active: true, note: "" };
  const num = (v) => (v === null || v === undefined ? "" : v);
  lvDialog({
    title: type ? "Edit leave type" : "Add a leave type",
    subtitle: "Changes apply to everyone in this company from now on.",
    bodyHtml:
      lvField("tName", "Name", `<input id="tName" type="text" maxlength="60" value="${lvEsc(t.name)}">`) +
      `<div class="form-grid">${lvField("tPaid", "Pay", `<select id="tPaid"><option value="true"${t.paid ? " selected" : ""}>Paid</option><option value="false"${t.paid ? "" : " selected"}>Unpaid</option></select>`)}` +
      lvField("tDays", "Days a year", `<input id="tDays" type="number" min="0" max="365" step="0.5" value="${num(t.annual_days)}">`, "Leave empty for no limit.") + "</div>" +
      `<div class="form-grid">${lvField("tElig", "Months of service before it starts", `<input id="tElig" type="number" min="0" max="120" value="${num(t.eligibility_months)}">`)}` +
      lvField("tCert", "Medical certificate after (days)", `<input id="tCert" type="number" min="1" max="365" value="${num(t.certificate_after_days)}">`) + "</div>" +
      `<div class="form-grid">${lvField("tIncYears", "Higher entitlement after (years)", `<input id="tIncYears" type="number" min="1" max="60" value="${num(t.increase_after_years)}">`)}` +
      lvField("tIncDays", "Higher number of days", `<input id="tIncDays" type="number" min="0" max="365" step="0.5" value="${num(t.increased_days)}">`) + "</div>" +
      lvField("tNote", "Note", `<input id="tNote" type="text" maxlength="300" value="${lvEsc(t.note || "")}">`) +
      `<div class="form-grid">${lvField("tColor", "Colour in the calendar", `<input id="tColor" type="color" value="${lvEsc(t.color)}">`)}` +
      lvField("tActive", "In use", `<select id="tActive"><option value="true"${t.active ? " selected" : ""}>Yes</option><option value="false"${t.active ? "" : " selected"}>Turned off</option></select>`) + "</div>",
    submitText: "Save",
    onSubmit: async () => {
      const blank = (id) => ($(id).value === "" ? null : Number($(id).value));
      const { error } = await supabaseClient.rpc("save_leave_type", {
        p_workspace: LV_WORKSPACE,
        p_id: type ? type.id : null,
        p_data: {
          name: $("tName").value.trim(), paid: $("tPaid").value === "true", annual_days: blank("tDays"), eligibility_months: blank("tElig") ?? 0,
          increase_after_years: blank("tIncYears"), increased_days: blank("tIncDays"), certificate_after_days: blank("tCert"),
          color: $("tColor").value, active: $("tActive").value === "true", note: $("tNote").value.trim()
        }
      });
      if (error) return error.message || "That could not be saved.";
      lvMessage("Leave type saved.", "ok");
      await lvRefresh();
      return null;
    }
  });
}

function lvHolidayDialog() {
  lvDialog({
    title: "Add a public holiday",
    subtitle: "Public holidays are shared by both companies and are never counted as leave days.",
    bodyHtml: lvField("hDate", "Date", `<input id="hDate" type="date" value="${lvYear}-01-01">`) + lvField("hName", "Name", '<input id="hName" type="text" maxlength="80" autocomplete="off">'),
    submitText: "Save",
    onSubmit: async () => {
      const { error } = await supabaseClient.rpc("save_public_holiday", { p_date: $("hDate").value, p_name: $("hName").value.trim() });
      if (error) return error.message || "That could not be saved.";
      lvMessage("Public holiday saved.", "ok");
      await lvRefresh();
      return null;
    }
  });
}

function lvRemoveHolidayDialog(date) {
  const h = lvHolidays.find((x) => String(x.holiday_date).slice(0, 10) === date);
  lvDialog({
    title: "Remove this public holiday?",
    subtitle: `${h ? h.name : "Holiday"}, ${lvFmt(date)}. That day would then count as a normal working day.`,
    bodyHtml: "",
    submitText: "Remove",
    danger: true,
    onSubmit: async () => {
      const { error } = await supabaseClient.rpc("delete_public_holiday", { p_date: date });
      if (error) return error.message || "That could not be removed.";
      lvMessage("Public holiday removed.", "ok");
      await lvRefresh();
      return null;
    }
  });
}

/* ---------- wiring ---------- */
async function lvRefresh() {
  if (await lvLoad()) lvRenderAll();
}

function lvFillYears() {
  const now = new Date().getFullYear();
  const years = [];
  for (let y = now - 1; y <= now + 2; y++) years.push(y);
  $("yearSelect").innerHTML = years.map((y) => `<option value="${y}"${y === lvYear ? " selected" : ""}>${y}</option>`).join("");
}

async function lvStart() {
  lvFillYears();

  $("reqFilter").addEventListener("change", lvRenderRequests);
  $("reqSearch").addEventListener("input", lvRenderRequests);
  $("yearSelect").addEventListener("change", async (event) => {
    lvYear = Number(event.target.value);
    lvBalances = await lvBalancesFor(lvYear);
    lvRenderStats();
    lvRenderBalances();
    lvRenderSettings();
  });
  $("calPrev").addEventListener("click", () => { lvMonth = lvMonth.m === 0 ? { y: lvMonth.y - 1, m: 11 } : { y: lvMonth.y, m: lvMonth.m - 1 }; lvRenderCalendar(); });
  $("calNext").addEventListener("click", () => { lvMonth = lvMonth.m === 11 ? { y: lvMonth.y + 1, m: 0 } : { y: lvMonth.y, m: lvMonth.m + 1 }; lvRenderCalendar(); });
  $("recordLeaveButton").addEventListener("click", () => lvRecordDialog());
  $("addTypeButton").addEventListener("click", () => lvTypeDialog(null));
  $("addHolidayButton").addEventListener("click", lvHolidayDialog);
  $("lvDialog").addEventListener("click", (event) => { if (event.target.id === "lvDialog") lvCloseDialog(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("lvDialog").hidden) lvCloseDialog(); });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest && event.target.closest("[data-act]");
    if (!button) return;

    const act = button.dataset.act;
    const request = lvRequests.find((r) => r.id === button.dataset.id);

    if (act === "approve" && request) lvDecideDialog(request, "approve");
    if (act === "reject" && request) lvDecideDialog(request, "reject");
    if (act === "cancel" && request) lvCancelDialog(request);
    if (act === "adjust") lvAdjustDialog(button.dataset.emp);
    if (act === "edit-type") lvTypeDialog(lvType(button.dataset.id));
    if (act === "del-holiday") lvRemoveHolidayDialog(button.dataset.date);
    if (act === "cert" && request) {
      const { error } = await supabaseClient.rpc("set_leave_certificate", { p_request: request.id, p_received: button.dataset.value === "1" });
      if (error) lvMessage(error.message || "That could not be saved.", "error");
      else await lvRefresh();
    }
  });

  if (!(await lvAccess())) {
    ["reqBody", "balBody", "calBody", "typesBody", "holidayBody"].forEach((id) => { $(id).innerHTML = '<tr class="empty-row"><td colspan="8">Sign in with a payroll role to see this.</td></tr>'; });
    ["statToday", "statWaiting", "statSoon", "statTaken"].forEach((id) => { $(id).textContent = "—"; });
    ["statTodayDetail", "statWaitingDetail"].forEach((id) => { $(id).textContent = "Sign in to see this"; });
    return;
  }

  $("recordLeaveButton").hidden = !lvCanRecord();
  $("addTypeButton").hidden = !lvIsAdmin();
  $("addHolidayButton").hidden = !lvIsAdmin();

  await lvRefresh();
}

lvStart();