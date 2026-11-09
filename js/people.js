// Which company the signed-in person is working in. Kairox Exchange by default.
function kairoxWorkspaceId() {
  try {
    return localStorage.getItem("kairoxWorkspace") || "kairox-exchange";
  } catch (error) {
    return "kairox-exchange";
  }
}

const PD_WORKSPACE = kairoxWorkspaceId();

let pdRole = null;
let pdPeople = [];
let pdLogins = [];

const pdEl = (id) => document.getElementById(id);
const pdEsc = (value = "") =>
  String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function pdFmt(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(y, m - 1, d));
}
const pdCanEdit = () => ["admin", "director", "payroll", "hr"].includes(pdRole);
const pdIsAdmin = () => pdRole === "admin";
const pdSeesLogins = () => ["admin", "director", "payroll", "hr"].includes(pdRole);
const pdStatus = (p) => String(p.employment_status || "active").toLowerCase();
const pdCurrent = (p) => !["inactive", "archived"].includes(pdStatus(p));
const pdLoginOf = (id) => pdLogins.find((l) => l.employee_id === id);

function pdBanner(html) {
  const banner = pdEl("pageBanner");
  banner.innerHTML = html;
  banner.hidden = !html;
}
function pdMessage(text, kind) {
  const box = pdEl("peopleMessage");
  box.textContent = text || "";
  box.className = `form-message ${kind || ""}`.trim();
}

async function pdAccess() {
  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData || !sessionData.session) {
    pdBanner('You are not signed in. <a href="login.html?next=people.html">Sign in</a> to continue.');
    return false;
  }

  const { data: role, error } = await supabaseClient.rpc("get_my_role", { p_workspace: kairoxWorkspaceId() });

  if (error) {
    pdBanner("The payroll security update has not been applied yet. Run the database updates in Supabase, then refresh.");
    return false;
  }
  if (!role || !["admin", "director", "payroll", "viewer", "hr", "manager"].includes(role)) {
    pdBanner("Your account does not have a role for this page in this company. Ask an admin to give you access.");
    return false;
  }

  pdRole = role;
  pdBanner("");
  return true;
}

async function pdLoad() {
  const [dir, logins] = await Promise.all([
    supabaseClient.rpc("people_directory", { p_workspace: PD_WORKSPACE }),
    pdSeesLogins() ? supabaseClient.rpc("employee_logins_list", { p_workspace: PD_WORKSPACE }) : Promise.resolve({ data: [] })
  ]);

  if (dir.error) {
    console.error("People could not be loaded:", dir.error);
    pdBanner("People is not set up yet. Run phase9-people-portal-migration.sql in Supabase, then refresh.");
    return false;
  }

  pdPeople = dir.data || [];
  pdLogins = (logins && logins.data) || [];
  return true;
}

/* ---------- display ---------- */
function pdRender() {
  const isTeam = pdRole === "manager";
  const current = pdPeople.filter(pdCurrent);

  pdEl("statPeopleLabel").textContent = isTeam ? "In my team" : "Current employees";
  pdEl("statPeople").textContent = String(current.length);
  pdEl("statPeopleDetail").textContent = isTeam ? "People who report to you" : `${pdPeople.length} on record`;
  pdEl("statAccess").textContent = String(current.filter((p) => p.has_login).length);
  const noMgr = current.filter((p) => !p.manager_id);
  pdEl("statNoMgr").textContent = String(noMgr.length);
  pdEl("statNoMgrCard").className = `stat-card ${noMgr.length && !isTeam ? "warn" : ""}`.trim();
  pdEl("statManagers").textContent = String(new Set(pdPeople.filter((p) => p.manager_id).map((p) => p.manager_id)).size);

  pdEl("peopleCard").querySelector("h2, h3").textContent = isTeam ? "My team" : "People";
  pdEl("peopleCard").querySelector(".page-card-head p").textContent = isTeam
    ? "The people who report to you. You approve their leave on the Leave page."
    : pdCanEdit()
      ? "Everyone's details (never their pay), who they report to, and who can sign in to the employee portal."
      : "Everyone's details, who they report to, and who can sign in to the employee portal.";
  pdEl("accessHead").textContent = isTeam ? "" : "Portal access";
  pdEl("peopleNote").textContent = isTeam
    ? ""
    : "Pay is never shown here. To give someone portal access: invite them in Supabase (Authentication, then Users, then Invite user), then choose Give access and type the same email. Only admins can give or remove access.";

  const filter = pdEl("pplFilter").value;
  const term = pdEl("pplSearch").value.trim().toLowerCase();
  const rows = pdPeople.filter((p) => {
    if (filter === "active" && !pdCurrent(p)) return false;
    if (filter === "left" && pdCurrent(p)) return false;
    if (term && ![p.name, p.department, p.title, p.employee_number].some((v) => String(v || "").toLowerCase().includes(term))) return false;
    return true;
  });

  const body = pdEl("peopleBody");

  if (!pdPeople.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="6">${isTeam ? "Nobody reports to you yet. An admin or HR officer assigns managers." : "No employees yet."}</td></tr>`;
    return;
  }
  if (!rows.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">Nothing matches. Try a different filter.</td></tr>';
    return;
  }

  body.innerHTML = rows
    .map((p) => {
      const login = pdLoginOf(p.id);
      const access = isTeam
        ? ""
        : p.has_login
          ? `<span class="badge ok">Has a login</span>${login ? `<small>${pdEsc(login.email)}</small>` : ""}<small>${p.last_sign_in ? "Last signed in " + pdEsc(pdFmt(p.last_sign_in)) : pdSeesLogins() && pdRole !== "payroll" ? "Has not signed in yet" : ""}</small>`
          : '<span class="badge info">No login</span>';
      let actions = "";
      if (pdCanEdit()) actions += `<button type="button" class="btn small" data-act="edit" data-id="${p.id}">Edit</button>`;
      if (pdIsAdmin() && pdCurrent(p)) actions += p.has_login ? `<button type="button" class="btn small danger" data-act="unlink" data-id="${p.id}">Remove access</button>` : `<button type="button" class="btn small primary" data-act="link" data-id="${p.id}">Give access</button>`;

      return `
        <tr data-id="${p.id}">
          <td><strong>${pdEsc(p.name)}</strong><small>${[p.employee_number, p.email].filter(Boolean).map(pdEsc).join(" · ")}</small></td>
          <td>${pdEsc(p.title || "—")}<small>${pdEsc(p.department || "")}${p.start_date ? " · started " + pdEsc(pdFmt(p.start_date)) : ""}</small></td>
          <td>${p.manager_name ? pdEsc(p.manager_name) : '<span class="muted">None</span>'}</td>
          <td><span class="badge ${pdStatus(p) === "active" ? "ok" : "info"}">${pdEsc(pdStatus(p))}</span></td>
          <td>${access}</td>
          <td><div class="row-actions">${actions}</div></td>
        </tr>`;
    })
    .join("");
}

/* ---------- dialogs ---------- */
function pdCloseDialog() {
  pdEl("pdDialog").hidden = true;
  pdEl("pdDialogForm").innerHTML = "";
}

function pdDialog({ title, subtitle, bodyHtml, submitText, onSubmit, danger }) {
  const form = pdEl("pdDialogForm");
  form.innerHTML =
    `<h3 id="pdDialogTitle">${pdEsc(title)}</h3><p>${pdEsc(subtitle || "")}</p>${bodyHtml}` +
    '<div class="form-message error" id="pdDialogError" role="alert"></div>' +
    `<div class="dialog-actions"><button type="button" class="btn" id="pdDialogCancel">Cancel</button><button type="submit" class="btn ${danger ? "danger" : "primary"}" id="pdDialogSubmit">${pdEsc(submitText)}</button></div>`;
  pdEl("pdDialog").hidden = false;

  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = pdEl("pdDialogSubmit");
    button.disabled = true;
    const problem = await onSubmit(form);
    button.disabled = false;
    if (problem) pdEl("pdDialogError").textContent = problem;
    else pdCloseDialog();
  };
  pdEl("pdDialogCancel").onclick = pdCloseDialog;
  const first = form.querySelector("select, input, textarea");
  if (first) first.focus();
}

const pdField = (id, label, control, hint) =>
  `<div class="field" style="margin-bottom:12px"><label for="${id}">${pdEsc(label)}</label>${control}${hint ? `<small>${hint}</small>` : ""}</div>`;
const pdInput = (id, value, attrs = "") => `<input id="${id}" type="text" value="${pdEsc(value || "")}" autocomplete="off" ${attrs}>`;

function pdEditDialog(id) {
  const p = pdPeople.find((x) => x.id === id);
  if (!p) return;
  const managers = pdPeople.filter((x) => x.id !== id && pdStatus(x) !== "archived");

  pdDialog({
    title: `Edit ${p.name}`,
    subtitle: "Details and who they report to. Pay is not shown or changed here.",
    bodyHtml:
      pdField("edName", "Name", pdInput("edName", p.name, 'maxlength="120"')) +
      `<div class="form-grid">${pdField("edNumber", "Employee number", pdInput("edNumber", p.employee_number, 'maxlength="30"'))}${pdField("edStart", "Started", `<input id="edStart" type="date" value="${pdEsc(p.start_date || "")}">`)}</div>` +
      `<div class="form-grid">${pdField("edTitle", "Job title", pdInput("edTitle", p.title, 'maxlength="80"'))}${pdField("edDept", "Department", pdInput("edDept", p.department, 'maxlength="80"'))}</div>` +
      pdField("edManager", "Reports to", `<select id="edManager"><option value="">Nobody</option>${managers.map((m) => `<option value="${m.id}"${m.id === p.manager_id ? " selected" : ""}>${pdEsc(m.name)}</option>`).join("")}</select>`) +
      `<div class="form-grid">${pdField("edEmail", "Email", pdInput("edEmail", p.email, 'maxlength="120"'))}${pdField("edPhone", "Phone", pdInput("edPhone", p.phone, 'maxlength="30"'))}</div>` +
      pdField("edAddress", "Address", pdInput("edAddress", p.address, 'maxlength="200"')) +
      `<div class="form-grid">${pdField("edEmName", "Emergency contact", pdInput("edEmName", p.emergency_contact_name, 'maxlength="100"'))}${pdField("edEmPhone", "Emergency contact phone", pdInput("edEmPhone", p.emergency_contact_phone, 'maxlength="30"'))}</div>`,
    submitText: "Save",
    onSubmit: async () => {
      const values = {
        name: pdEl("edName").value.trim(), employee_number: pdEl("edNumber").value.trim(), department: pdEl("edDept").value.trim(), title: pdEl("edTitle").value.trim(),
        start_date: pdEl("edStart").value, email: pdEl("edEmail").value.trim(), phone: pdEl("edPhone").value.trim(), address: pdEl("edAddress").value.trim(),
        emergency_contact_name: pdEl("edEmName").value.trim(), emergency_contact_phone: pdEl("edEmPhone").value.trim()
      };
      const before = {
        name: p.name || "", employee_number: p.employee_number || "", department: p.department || "", title: p.title || "", start_date: p.start_date ? String(p.start_date).slice(0, 10) : "",
        email: p.email || "", phone: p.phone || "", address: p.address || "", emergency_contact_name: p.emergency_contact_name || "", emergency_contact_phone: p.emergency_contact_phone || ""
      };
      const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== before[k]));
      const newManager = pdEl("edManager").value || null;

      if (!Object.keys(changed).length && newManager === (p.manager_id || null)) return "Nothing was changed.";

      if (Object.keys(changed).length) {
        const { error } = await supabaseClient.rpc("update_person_details", { p_workspace: PD_WORKSPACE, p_employee: id, p_data: changed });
        if (error) return error.message || "Their details were not saved.";
      }
      if (newManager !== (p.manager_id || null)) {
        const { error } = await supabaseClient.rpc("set_employee_manager", { p_workspace: PD_WORKSPACE, p_employee: id, p_manager: newManager });
        if (error) return error.message || "The manager was not saved.";
      }

      pdMessage(`${values.name || p.name} was updated.`, "ok");
      await pdRefresh();
      return null;
    }
  });
}

function pdLinkDialog(id) {
  const p = pdPeople.find((x) => x.id === id);
  pdDialog({
    title: `Give ${p.name} portal access`,
    subtitle: "They will see only their own payslips, leave, details and the documents you share.",
    bodyHtml:
      pdField("lkEmail", "Their login email", '<input id="lkEmail" type="email" autocomplete="off" maxlength="120">', "Invite them first in Supabase: Authentication, then Users, then Invite user. Then type the same email here.") ,
    submitText: "Give access",
    onSubmit: async () => {
      const { error } = await supabaseClient.rpc("link_employee_login", { p_workspace: PD_WORKSPACE, p_employee: id, p_email: pdEl("lkEmail").value.trim() });
      if (error) return error.message || "Access was not given.";
      pdMessage(`${p.name} can now sign in to the employee portal.`, "ok");
      await pdRefresh();
      return null;
    }
  });
}

function pdUnlinkDialog(id) {
  const p = pdPeople.find((x) => x.id === id);
  pdDialog({
    title: `Remove ${p.name}'s portal access?`,
    subtitle: "Their login will no longer open their payslips, leave or details. The login itself stays in Supabase.",
    bodyHtml: "",
    submitText: "Remove access",
    danger: true,
    onSubmit: async () => {
      const { error } = await supabaseClient.rpc("unlink_employee_login", { p_employee: id });
      if (error) return error.message || "Access was not removed.";
      pdMessage(`${p.name}'s portal access was removed.`, "ok");
      await pdRefresh();
      return null;
    }
  });
}

/* ---------- start ---------- */
async function pdRefresh() {
  if (await pdLoad()) pdRender();
}

async function pdStart() {
  pdEl("pplFilter").addEventListener("change", pdRender);
  pdEl("pplSearch").addEventListener("input", pdRender);
  pdEl("pdDialog").addEventListener("click", (event) => { if (event.target.id === "pdDialog") pdCloseDialog(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !pdEl("pdDialog").hidden) pdCloseDialog(); });

  document.addEventListener("click", (event) => {
    const button = event.target.closest && event.target.closest("[data-act]");
    if (!button) return;
    if (button.dataset.act === "edit") pdEditDialog(button.dataset.id);
    if (button.dataset.act === "link") pdLinkDialog(button.dataset.id);
    if (button.dataset.act === "unlink") pdUnlinkDialog(button.dataset.id);
  });

  if (!(await pdAccess())) {
    pdEl("peopleBody").innerHTML = '<tr class="empty-row"><td colspan="6">Sign in with a role for this company to see this.</td></tr>';
    ["statPeople", "statAccess", "statNoMgr", "statManagers"].forEach((id) => { pdEl(id).textContent = "—"; });
    pdEl("statPeopleDetail").textContent = "Sign in to see this";
    return;
  }

  await pdRefresh();
}

pdStart();