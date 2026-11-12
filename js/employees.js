// Pages that forgot the <script src="js/topbar.js"> line still get the Company box, the sidebar links and the
// shared pay period: this loads it for them (once), and waits for it.
function kairoxEnsureTopbar() {
  if (window.KairoxCompany) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    try {
      if (/jsdom/i.test(navigator.userAgent) || !document.head) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = "js/topbar.js";
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.head.appendChild(script);
      setTimeout(resolve, 4000);
    } catch (error) {
      resolve();
    }
  });
}

// Which company the signed-in person is working in (chosen with the company switcher). Kairox Exchange by default.
function kairoxWorkspaceId() {
  try {
    return localStorage.getItem("kairoxWorkspace") || "kairox-exchange";
  } catch (error) {
    return "kairox-exchange";
  }
}

function escapeEmployeeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getEmployeeActor() {
  const { data } = await supabaseClient.auth.getUser();
  return data?.user?.email || "Unknown user";
}

const EMPLOYEE_WORKSPACE = kairoxWorkspaceId();

let employeeDirectoryData = [];
let employeeRole = null;

function canEditEmployees() {
  return employeeRole === "admin" || employeeRole === "director" || employeeRole === "payroll";
}

function showEmployeeBanner(html) {
  let banner = document.getElementById("employeeAccessBanner");

  if (!banner) {
    banner = document.createElement("div");
    banner.id = "employeeAccessBanner";
    banner.style.cssText =
      "margin:0 0 18px;padding:14px 18px;border-radius:12px;background:#fff4e5;border:1px solid #f6d9a6;color:#8a4b00;font-weight:700;";

    const host = document.querySelector(".employees-main") || document.body;
    host.insertBefore(banner, host.firstChild);
  }

  banner.innerHTML = html;
  banner.hidden = !html;
}

async function loadEmployeeAccess() {
  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData || !sessionData.session) {
    showEmployeeBanner(
      'You are not signed in. <a href="login.html?next=employees-v2.html">Sign in</a> to continue.'
    );
    return false;
  }

  const { data: role, error } = await supabaseClient.rpc("get_my_role", { p_workspace: kairoxWorkspaceId() });

  if (error) {
    showEmployeeBanner(
      "The payroll security update has not been applied yet. Run phase2-migration.sql in Supabase, then refresh."
    );
    return false;
  }

  if (!role) {
    showEmployeeBanner(
      "Your account does not have a payroll role yet. Ask an admin to give you access."
    );
    return false;
  }

  employeeRole = role;
  showEmployeeBanner("");
  return true;
}

// Viewers can look but not change: hide the controls that would only be refused.
function applyEmployeeRoleUi() {
  if (canEditEmployees()) {
    return;
  }

  document
    .querySelectorAll('a[href="edit-employee.html"], button[data-add-employee]')
    .forEach((control) => {
      control.hidden = true;
    });
}

async function loadEmployeeDirectory() {
  const tableBody = document.getElementById("employeeTableBody");

  if (!tableBody) {
    return;
  }

  if (!(await loadEmployeeAccess())) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5">
          <div class="table-message">
            Employee records are not available until you are signed in with a payroll role.
          </div>
        </td>
      </tr>
    `;
    return;
  }

 const { data, error } = await supabaseClient
  .from("employees")
  .select("*")
  .eq("workspace", EMPLOYEE_WORKSPACE)
  .order("name", { ascending: true });

  if (error) {
    console.error("Could not load employees:", error);

    tableBody.innerHTML = `
      <tr>
        <td colspan="5">
          <div class="table-message">
            Could not load employee records.
          </div>
        </td>
      </tr>
    `;

    return;
  }

  employeeDirectoryData = data || [];

  renderEmployeeDirectory(employeeDirectoryData);
  updateEmployeeSummary(employeeDirectoryData);
  populateDepartmentFilter(employeeDirectoryData);
  applyEmployeeRoleUi();
}

function renderEmployeeDirectory(employeeList) {
  const tableBody = document.getElementById("employeeTableBody");

  if (!tableBody) {
    return;
  }

  if (!employeeList.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5">
          <div class="table-message">
            No employee records found.
          </div>
        </td>
      </tr>
    `;

    return;
  }

  tableBody.innerHTML = employeeList
    .map((employee) => {
      const status =
        employee.employment_status || "active";

      const initials = getEmployeeInitials(employee.name);

      const formattedSalary = Number(
        employee.gross || 0
      ).toLocaleString("en-JM", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });

      // Only a normal web address is allowed as a photo, and it is escaped: nothing typed into a record can break out of the page.
      const safePhoto = /^https?:\/\//i.test(String(employee.photo_url || "")) ? escapeEmployeeHtml(employee.photo_url) : "";

      const photoMarkup = safePhoto
        ? `
          <img
            class="employee-avatar"
            src="${safePhoto}"
            alt="${escapeEmployeeHtml(employee.name || "")}"
          >
        `
        : `
          <div class="employee-avatar employee-avatar-fallback">
            ${escapeEmployeeHtml(initials)}
          </div>
        `;

      return `
        <tr>
          <td>
            <div class="employee-name-cell">
              ${photoMarkup}

              <div>
                <strong>${escapeEmployeeHtml(employee.name || "Unnamed employee")}</strong>
                <span>${escapeEmployeeHtml(employee.title || "No job title")}</span>
              </div>
            </div>
          </td>

          <td>${escapeEmployeeHtml(employee.department || "—")}</td>

          
          <td>JMD ${formattedSalary}</td>

          <td>
            <span class="status-pill status-${normaliseStatus(status)}">
              ${formatStatus(status)}
            </span>
          </td>

          <td>
            <div class="employee-actions">
              <a
                class="action-link"
                href="employee-profile.html?id=${employee.id}"
              >
                View
              </a>

${
  !canEditEmployees()
    ? ""
    : `
              <a
  class="action-button"
  href="edit-employee.html?id=${employee.id}"
>
  Edit
</a>

${
  normaliseStatus(status) === "archived"
    ? `
      <button
        class="restore-button"
        type="button"
        data-id="${employee.id}"
      >
        Restore
      </button>
      ${
        employeeRole === "admin"
          ? `<button
        class="delete-button"
        type="button"
        data-id="${employee.id}"
        data-name="${escapeEmployeeHtml(employee.name)}"
        style="margin-left:6px;padding:8px 12px;border:1px solid #f0c4c4;border-radius:10px;background:#fff;color:#b91c1c;font:inherit;font-size:13px;font-weight:700;cursor:pointer"
      >
        Delete
      </button>`
          : ""
      }
    `
    : `
      <button
        class="archive-button"
        type="button"
        data-id="${employee.id}"
      >
        Archive
      </button>
    `
}`
}
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function updateEmployeeSummary(employeeList) {
  const total = employeeList.length;
  const monthlyPayroll = employeeList.reduce(
  (sum, employee) => {
    const status =
      normaliseStatus(employee.employment_status);

    // Archived and inactive people are not paid, so they are not in the monthly payroll figure.
    if (status === "archived" || status === "inactive") {
      return sum;
    }

    return sum + Number(employee.gross || 0);
  },
  0
);

  const active = employeeList.filter(
    (employee) =>
      normaliseStatus(employee.employment_status) === "active"
  ).length;

  const onLeave = employeeList.filter(
    (employee) =>
      normaliseStatus(employee.employment_status) === "on-leave"
  ).length;

  const inactive = employeeList.filter(
    (employee) =>
      normaliseStatus(employee.employment_status) === "inactive"
  ).length;

  document.getElementById("employeeTotalCount").textContent =
    total;

  document.getElementById("employeeActiveCount").textContent =
    active;

  document.getElementById("employeeLeaveCount").textContent =
    onLeave;

  document.getElementById("employeeInactiveCount").textContent =
    inactive;
    const employeePayrollTotal =
  document.getElementById("employeePayrollTotal");

if (employeePayrollTotal) {
  employeePayrollTotal.textContent =
    `JMD ${monthlyPayroll.toLocaleString("en-JM", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
}
}

function populateDepartmentFilter(employeeList) {
  const departmentFilter =
    document.getElementById("departmentFilter");

  if (!departmentFilter) {
    return;
  }

  const departments = [
    ...new Set(
      employeeList
        .map((employee) => employee.department)
        .filter(Boolean)
    )
  ].sort();

  departmentFilter.innerHTML = `
    <option value="">All Departments</option>
    ${departments
      .map(
        (department) =>
          `<option value="${department}">${department}</option>`
      )
      .join("")}
  `;
}

function getEmployeeInitials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "—";
}

function normaliseStatus(status = "active") {
  return status
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function formatStatus(status = "active") {
  return status
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function applyEmployeeFilters() {
  const searchValue =
    document.getElementById("employeeSearch")
      .value
      .trim()
      .toLowerCase();

  const departmentValue =
    document.getElementById("departmentFilter").value;

  const statusValue =
    document.getElementById("statusFilter").value;

  const filteredEmployees = employeeDirectoryData.filter(
    (employee) => {
      const searchableText = [
        employee.name,
        employee.title,
        employee.department
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !searchValue ||
        searchableText.includes(searchValue);

      const matchesDepartment =
        !departmentValue ||
        employee.department === departmentValue;

      const matchesStatus =
        !statusValue ||
        normaliseStatus(employee.employment_status) ===
          normaliseStatus(statusValue);

      return (
        matchesSearch &&
        matchesDepartment &&
        matchesStatus
      );
    }
  );

  renderEmployeeDirectory(filteredEmployees);
}

const employeeSearch =
  document.getElementById("employeeSearch");

const departmentFilter =
  document.getElementById("departmentFilter");

const statusFilter =
  document.getElementById("statusFilter");

if (employeeSearch) {
  employeeSearch.addEventListener(
    "input",
    applyEmployeeFilters
  );
}

if (departmentFilter) {
  departmentFilter.addEventListener(
    "change",
    applyEmployeeFilters
  );
}

if (statusFilter) {
  statusFilter.addEventListener(
    "change",
    applyEmployeeFilters
  );
}
async function archiveEmployee(employeeId) {
  const confirmed = await KairoxUI.confirm({
    title: "Archive Employee",
    message:
        "Archive this employee? Their payroll history will be preserved.",
    confirmText: "Archive",
    cancelText: "Cancel"
});

  if (!confirmed) {
    return;
  }

  const { error } = await supabaseClient
    .from("employees")
    .update({
      employment_status: "archived"
    })
    .eq("id", employeeId);

  if (error) {
    console.error("Could not archive employee:", error);
    KairoxUI.error(
  "The employee could not be archived."
);
    return;
  }

  await loadEmployeeDirectory();
  const { data: employee } = await supabaseClient
  .from("employees")
  .select("name")
  .eq("id", employeeId)
  .single();

await supabaseClient
  .from("employee_activity")
  .insert({
    employee_id: employeeId,
    workspace: EMPLOYEE_WORKSPACE,
    activity_type: "archive",
    activity_title: "Employee archived",
    activity_description: employee
      ? `${employee.name} was archived.`
      : "Employee archived.",
    created_by: await getEmployeeActor()
  });

  KairoxUI.success(
  "Employee archived successfully.",
  "Employee Archived"
);
}
async function restoreEmployee(employeeId) {
  const confirmed = await KairoxUI.confirm({
    title: "Restore Employee",
    message:
      "Restore this employee to active status? They will become available for payroll processing again.",
    confirmText: "Restore",
    cancelText: "Cancel"
  });

  if (!confirmed) {
    return;
  }

  const { error } = await supabaseClient
    .from("employees")
    .update({
      employment_status: "active"
    })
    .eq("id", employeeId);

  if (error) {
    console.error(
      "Could not restore employee:",
      error
    );

    KairoxUI.error(
      "The employee could not be restored."
    );

    return;
  }

  await loadEmployeeDirectory();
  const { data: employee } = await supabaseClient
  .from("employees")
  .select("name")
  .eq("id", employeeId)
  .single();

await supabaseClient
  .from("employee_activity")
  .insert({
    employee_id: employeeId,
    workspace: EMPLOYEE_WORKSPACE,
    activity_type: "restore",
    activity_title: "Employee restored",
    activity_description: employee
      ? `${employee.name} was restored to active status.`
      : "Employee restored to active status.",
    created_by: await getEmployeeActor()
  });

  KairoxUI.success(
    "Employee restored successfully.",
    "Employee Restored"
  );
}
// Permanently removes an archived employee who has no payroll history (a duplicate or a mistake).
// The database refuses anyone else, and says why.
async function deleteEmployee(employeeId, name) {
  const message =
    `Permanently delete ${name || "this employee"}? This removes their record, notes and recurring pay items and cannot be undone. ` +
    "It is for duplicates and mistakes: anyone who appears in a draft, approved or processed payroll cannot be deleted.";

  const confirmed =
    window.KairoxUI && typeof KairoxUI.confirm === "function"
      ? await KairoxUI.confirm({
          title: "Delete Employee",
          message,
          confirmText: "Delete permanently",
          cancelText: "Cancel"
        })
      : window.confirm(message);

  if (!confirmed) {
    return;
  }

  const { error } = await supabaseClient.rpc("delete_employee", { p_id: employeeId });

  if (error) {
    console.error("Could not delete employee:", error);

    const text = error.message || "The employee could not be deleted.";

    if (window.KairoxUI && typeof KairoxUI.error === "function") {
      KairoxUI.error(text);
    } else {
      window.alert(text);
    }

    return;
  }

  await loadEmployeeDirectory();

  if (window.KairoxUI && typeof KairoxUI.success === "function") {
    KairoxUI.success("The employee was deleted.", "Employee Deleted");
  }
}

document.addEventListener("click", (event) => {
  const deleteButton =
    event.target.closest(".delete-button");

  if (deleteButton) {
    deleteEmployee(deleteButton.dataset.id, deleteButton.dataset.name);
    return;
  }

  const archiveButton =
    event.target.closest(".archive-button");

  if (archiveButton) {
    archiveEmployee(archiveButton.dataset.id);
    return;
  }

  const restoreButton =
    event.target.closest(".restore-button");

  if (restoreButton) {
    restoreEmployee(restoreButton.dataset.id);
    return;
  }
});
loadEmployeeDirectory();

kairoxEnsureTopbar();