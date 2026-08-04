const EMPLOYEE_WORKSPACE = "kairox-exchange";

let employeeDirectoryData = [];

async function loadEmployeeDirectory() {
  const tableBody = document.getElementById("employeeTableBody");

  if (!tableBody) {
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

      const photoMarkup = employee.photo_url
        ? `
          <img
            class="employee-avatar"
            src="${employee.photo_url}"
            alt="${employee.name}"
          >
        `
        : `
          <div class="employee-avatar employee-avatar-fallback">
            ${initials}
          </div>
        `;

      return `
        <tr>
          <td>
            <div class="employee-name-cell">
              ${photoMarkup}

              <div>
                <strong>${employee.name || "Unnamed employee"}</strong>
                <span>${employee.title || "No job title"}</span>
              </div>
            </div>
          </td>

          <td>${employee.department || "—"}</td>

          
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
}
  Archive
</button>
              </button>
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

    if (status === "archived") {
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
  .select("first_name,last_name")
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
      ? `${employee.first_name} ${employee.last_name} was archived.`
      : "Employee archived.",
    created_by: "HR"
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
    created_by: "HR"
  });

  KairoxUI.success(
    "Employee restored successfully.",
    "Employee Restored"
  );
}
document.addEventListener("click", (event) => {
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