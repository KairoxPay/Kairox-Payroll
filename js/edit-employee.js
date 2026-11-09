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

async function getEditActor() {
  const { data } = await supabaseClient.auth.getUser();
  return data?.user?.email || "Unknown user";
}

const editEmployeeParams =
  new URLSearchParams(window.location.search);

const editEmployeeId =
  editEmployeeParams.get("id");
const isEditMode =
Boolean(editEmployeeId);
const employeeEditForm =
  document.getElementById("employeeEditForm");

const employeeFormMessage =
  document.getElementById("employeeFormMessage");

const saveEmployeeButton =
  document.getElementById("saveEmployeeButton");

  let originalEmployee = null;

async function loadEmployeeForEditing() {
  if (!editEmployeeId) {
    showEmployeeFormMessage(
      "Employee ID is missing.",
      "error"
    );
    return;
  }

  const { data, error } = await supabaseClient
    .from("employees")
    .select("*")
    .eq("id", editEmployeeId)
    .single();

  if (error) {
    console.error("Could not load employee:", error);

    // If access is the problem, the access message (sign in / read-only) is the useful one.
    if (editAccessChecked && !editAccessAllowed) {
      return;
    }

    showEmployeeFormMessage(
      "Could not load the employee record.",
      "error"
    );

    return;
  }

  originalEmployee = data;
  populateEmployeeEditForm(data);
  updateEmployeeEditLinks();
}

function populateEmployeeEditForm(employee) {
  document.getElementById("employeeNameInput").value =
    employee.name || "";

  document.getElementById("employeeNumberInput").value =
    employee.employee_number || "";

  document.getElementById("employeeEmailInput").value =
    employee.email || "";

  document.getElementById("employeePhoneInput").value =
    employee.phone || "";

  document.getElementById("employeeTrnInput").value =
    employee.trn || "";

  document.getElementById("employeeTitleInput").value =
    employee.title || "";

  document.getElementById("employeeDepartmentInput").value =
    employee.department || "";

  document.getElementById("employeeGrossInput").value =
    employee.gross ?? "";

  document.getElementById("employeeStartDateInput").value =
    employee.start_date || "";

  document.getElementById("employeeStatusInput").value =
    employee.employment_status || "active";
}

function updateEmployeeEditLinks() {
  const profileUrl =
    `employee-profile.html?id=${editEmployeeId}`;

  document.getElementById("backToProfile").href =
    profileUrl;

  document.getElementById("cancelEditLink").href =
    profileUrl;
}

async function saveEmployeeChanges(event) {
  event.preventDefault();

  if (editAccessChecked && !editAccessAllowed) {
    showEmployeeFormMessage("You do not have permission to change employee records.", "error");
    return;
  }

  

  saveEmployeeButton.disabled = true;
  saveEmployeeButton.textContent = "Saving...";

  showEmployeeFormMessage("", "");

  const updatedEmployee = {
    name:
      document.getElementById("employeeNameInput")
        .value.trim(),

    employee_number:
      document.getElementById("employeeNumberInput")
        .value.trim() || null,

    email:
      document.getElementById("employeeEmailInput")
        .value.trim() || null,

    phone:
      document.getElementById("employeePhoneInput")
        .value.trim() || null,

    trn:
      document.getElementById("employeeTrnInput")
        .value.trim() || null,

    title:
      document.getElementById("employeeTitleInput")
        .value.trim() || null,

    department:
      document.getElementById("employeeDepartmentInput")
        .value.trim() || null,

    gross:
      Number(
        document.getElementById("employeeGrossInput").value
      ) || 0,

    start_date:
      document.getElementById("employeeStartDateInput")
        .value || null,

    employment_status:
      document.getElementById("employeeStatusInput")
        .value
  };

  let error;
let savedEmployeeId = editEmployeeId;

if (isEditMode) {
  ({ error } = await supabaseClient
    .from("employees")
    .update(updatedEmployee)
    .eq("id", editEmployeeId));
} else {
  const {
    data: createdEmployee,
    error: createError
  } = await supabaseClient
    .from("employees")
    .insert({
      ...updatedEmployee,
      workspace: kairoxWorkspaceId()
    })
    .select("id")
    .single();

  error = createError;
  savedEmployeeId = createdEmployee?.id;
}

  if (error) {
    console.error("Could not save employee:", error);

    showEmployeeFormMessage(
      "Could not save the employee changes.",
      "error"
    );

    saveEmployeeButton.disabled = false;
    saveEmployeeButton.textContent = "Save Changes";

    return;
  }
if (isEditMode) {
  const changes = [];

if (originalEmployee?.title !== updatedEmployee.title) {
  changes.push(
    `Job title changed from "${originalEmployee?.title || "Not assigned"}" to "${updatedEmployee.title || "Not assigned"}".`
  );
}

if (originalEmployee?.department !== updatedEmployee.department) {
  changes.push(
    `Department changed from "${originalEmployee?.department || "Not assigned"}" to "${updatedEmployee.department || "Not assigned"}".`
  );
}

if (
  Number(originalEmployee?.gross || 0) !==
  Number(updatedEmployee.gross || 0)
) {
  changes.push(
    `Gross salary changed from JMD ${Number(originalEmployee?.gross || 0).toLocaleString()} to JMD ${Number(updatedEmployee.gross || 0).toLocaleString()}.`
  );
}

if (
  originalEmployee?.employment_status !==
  updatedEmployee.employment_status
) {
  changes.push(
    `Employment status changed from "${originalEmployee?.employment_status || "Not assigned"}" to "${updatedEmployee.employment_status || "Not assigned"}".`
  );
}

await supabaseClient
  .from("employee_activity")
  .insert({
    employee_id: editEmployeeId,
    workspace: kairoxWorkspaceId(),
    activity_type: "profile_updated",
    activity_title: "Employee profile updated",
    activity_description:
      changes.length
        ? changes.join("\n")
        : "Employee profile updated.",
    created_by: await getEditActor()
  });
}
  if (!isEditMode && savedEmployeeId) {
  await supabaseClient
    .from("employee_activity")
    .insert({
      employee_id: savedEmployeeId,
      workspace: kairoxWorkspaceId(),
      activity_type: "employee_created",
      activity_title: "Employee created",
      activity_description:
        "The employee record was created.",
      created_by: await getEditActor()
    });
}
    showEmployeeFormMessage(
  isEditMode
    ? "Employee updated successfully."
    : "Employee created successfully.",
  "success"
);

  setTimeout(() => {
  if (isEditMode) {
    window.location.href =
      `employee-profile.html?id=${editEmployeeId}`;
  } else {
    window.location.href = "employees-v2.html";
  }
}, 700);
}

function showEmployeeFormMessage(message, type) {
  employeeFormMessage.textContent = message;
  employeeFormMessage.className = "form-message";

  if (type) {
    employeeFormMessage.classList.add(type);
  }
}

if (employeeEditForm) {
  employeeEditForm.addEventListener(
    "submit",
    saveEmployeeChanges
  );
}

let editAccessChecked = false;
let editAccessAllowed = false;

async function applyEditAccess() {
  const lock = (message) => {
    editAccessAllowed = false;
    employeeEditForm
      ?.querySelectorAll("input, select, button")
      .forEach((control) => {
        control.disabled = true;
      });
    showEmployeeFormMessage(message, "error");
  };

  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData || !sessionData.session) {
    editAccessChecked = true;
    lock("You are not signed in. Sign in at login.html, then return to Employees.");
    return;
  }

  const { data: role, error } = await supabaseClient.rpc("get_my_role", { p_workspace: kairoxWorkspaceId() });
  editAccessChecked = true;

  if (error || !role) {
    lock("Your account does not have a payroll role. Ask an admin to give you access.");
    return;
  }

  if (role !== "admin" && role !== "director" && role !== "payroll") {
    lock("You have read-only access. Ask an admin or payroll clerk to change employee records.");
    return;
  }

  editAccessAllowed = true;
}

applyEditAccess();

if (isEditMode) {

    loadEmployeeForEditing();

}
else{

    initialiseCreateMode();

}
function initialiseCreateMode(){

document.getElementById("formTitle")
.textContent="Add Employee";

document.getElementById("saveButtonText")
.textContent="Create Employee";

document.getElementById("backToProfile")
.href="employees-v2.html";

document.getElementById("cancelEditLink")
.href="employees-v2.html";

}

kairoxEnsureTopbar();