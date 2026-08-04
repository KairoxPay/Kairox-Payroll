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

    showEmployeeFormMessage(
      "Could not load the employee record.",
      "error"
    );

    originalEmployee = data;

    return;
  }

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
      workspace: "kairox-exchange"
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
    workspace: "kairox-exchange",
    activity_type: "profile_updated",
    activity_title: "Employee profile updated",
    activity_description:
      changes.length
        ? changes.join("\n")
        : "Employee profile updated.",
    created_by: "HR"
  });
}
  if (!isEditMode && savedEmployeeId) {
  await supabaseClient
    .from("employee_activity")
    .insert({
      employee_id: savedEmployeeId,
      workspace: "kairox-exchange",
      activity_type: "employee_created",
      activity_title: "Employee created",
      activity_description:
        "The employee record was created.",
      created_by: "HR"
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