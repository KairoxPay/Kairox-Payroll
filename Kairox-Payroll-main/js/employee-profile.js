const params = new URLSearchParams(window.location.search);

const employeeId = params.get("id");
const editEmployeeLink =
  document.getElementById("editEmployeeLink");

if (editEmployeeLink && employeeId) {
  editEmployeeLink.href =
    `edit-employee.html?id=${employeeId}`;
}
let currentEmployeePhotoUrl = null;
const EMPLOYEE_WORKSPACE = "kairox-exchange";
async function loadEmployeeProfile() {

    if (!employeeId) {
        alert("Employee not found.");
        return;
    }

    const { data, error } = await supabaseClient
        .from("employees")
        .select("*")
        .eq("id", employeeId)
        .single();

    if (error) {
        console.error(error);
        return;
    }

    displayEmployee(data);
loadEmployeeActivity();
}

function displayEmployee(employee) {
    currentEmployeePhotoUrl =
  employee.photo_url || null;
  
  const heroEmployeeName =
  document.getElementById("heroEmployeeName");
  const heroEmployeeDepartment =
  document.getElementById("heroEmployeeDepartment");

const heroEmployeeStartDate =
  document.getElementById("heroEmployeeStartDate");

const heroEmployeePhoto =
  document.getElementById("heroEmployeePhoto");

const heroEmployeeInitials =
  document.getElementById("heroEmployeeInitials");

if (heroEmployeeDepartment) {
  heroEmployeeDepartment.textContent =
    employee.department || "Department not assigned";
}

if (heroEmployeeStartDate) {
  heroEmployeeStartDate.textContent =
    employee.start_date
      ? `Started ${employee.start_date}`
      : "Start date not assigned";
}

if (employee.photo_url && heroEmployeePhoto) {
  heroEmployeePhoto.src = employee.photo_url;
  heroEmployeePhoto.style.display = "block";

  if (heroEmployeeInitials) {
    heroEmployeeInitials.style.display = "none";
  }
} else if (heroEmployeeInitials) {
  heroEmployeeInitials.textContent =
    getInitials(employee.name);
}

const heroEmployeeSubtitle =
  document.getElementById("heroEmployeeSubtitle");

const heroEmployeeStatus =
  document.getElementById("heroEmployeeStatus");

if (heroEmployeeName) {
  heroEmployeeName.textContent =
    employee.name || "Unnamed employee";
}

if (heroEmployeeSubtitle) {
  const title =
    employee.title || "No Job Title";

  const employeeNumber =
    employee.employee_number
      ? `Employee #${employee.employee_number}`
      : "Employee Number Not Assigned";

  heroEmployeeSubtitle.textContent =
    `${title} • ${employeeNumber}`;
}

if (heroEmployeeStatus) {
  heroEmployeeStatus.textContent =
    employee.employment_status || "Active";
}

    
    document.getElementById("employeeEmail").textContent =
        employee.email || "-";

    document.getElementById("employeePhone").textContent =
        employee.phone || "-";

    document.getElementById("employmentTitle").textContent =
        employee.title || "-";

    document.getElementById("employmentDepartment").textContent =
        employee.department || "-";

    document.getElementById("employmentStatus").textContent =
        employee.employment_status || "-";

    document.getElementById("employmentStartDate").textContent =
        employee.start_date || "-";

    document.getElementById("employeeGross").textContent =
        "JMD " +
        Number(employee.gross || 0).toLocaleString();

      
    }


function getInitials(name = "") {

    return name
        .split(" ")
        .map(word => word.charAt(0))
        .join("")
        .toUpperCase();

}

loadEmployeeProfile();
const employeePhotoInput =
  document.getElementById("employeePhotoInput");

const uploadEmployeePhotoButton =
  document.getElementById("uploadEmployeePhotoButton");

const employeePhotoMessage =
  document.getElementById("employeePhotoMessage");
 const employeeNoteInput =
  document.getElementById("employeeNoteInput");

const addEmployeeNoteButton =
  document.getElementById("addEmployeeNoteButton");

const employeeNoteMessage =
  document.getElementById("employeeNoteMessage");

const employeeNotesList =
  document.getElementById("employeeNotesList");

async function uploadEmployeePhoto() {
  if (!employeeId) {
    showPhotoMessage(
      "Employee ID is missing.",
      true
    );
    return;
  }
 
  const selectedFile =
    employeePhotoInput?.files?.[0];

  if (!selectedFile) {
    showPhotoMessage(
      "Choose a photo first.",
      true
    );
    return;
  }

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (!allowedTypes.includes(selectedFile.type)) {
    showPhotoMessage(
      "Use a JPG, PNG or WEBP image.",
      true
    );
    return;
  }

  const maximumFileSize = 5 * 1024 * 1024;

  if (selectedFile.size > maximumFileSize) {
    showPhotoMessage(
      "The photo must be smaller than 5 MB.",
      true
    );
    return;
  }
uploadEmployeePhotoButton.disabled = true;
uploadEmployeePhotoButton.textContent = "Uploading...";

  showPhotoMessage("Uploading photo...", false);

  const fileExtension =
    selectedFile.name.split(".").pop().toLowerCase();

  const filePath =
    `${employeeId}/${crypto.randomUUID()}.${fileExtension}`;

  const { error: uploadError } =
    await supabaseClient.storage
      .from("employee-photos")
      .upload(filePath, selectedFile, {
        cacheControl: "3600",
        upsert: false
      });

  if (uploadError) {
    console.error(
      "Could not upload employee photo:",
      uploadError
    );

    showPhotoMessage(
      "The photo could not be uploaded.",
      true
    );

    resetPhotoUploadButton();
    return;
  }

  const { data: signedUrlData, error: signedUrlError } =
    await supabaseClient.storage
      .from("employee-photos")
      .createSignedUrl(filePath, 60 * 60 * 24 * 365);

  if (signedUrlError) {
    console.error(
      "Could not create photo URL:",
      signedUrlError
    );

    showPhotoMessage(
      "The photo uploaded, but it could not be displayed.",
      true
    );

    resetPhotoUploadButton();
    return;
  }

  const photoUrl = signedUrlData.signedUrl;

  const { error: updateError } = await supabaseClient
    .from("employees")
    .update({
      photo_url: photoUrl
    })
    .eq("id", employeeId);

  if (updateError) {
    console.error(
      "Could not save employee photo URL:",
      updateError
    );

    showPhotoMessage(
      "The photo uploaded, but the employee record could not be updated.",
      true
    );

    resetPhotoUploadButton();
    return;
  }
if (
  currentEmployeePhotoUrl &&
  currentEmployeePhotoUrl !== photoUrl
) {
  try {
    const oldUrl = new URL(currentEmployeePhotoUrl);
    const marker = "/employee-photos/";
    const markerIndex = oldUrl.pathname.indexOf(marker);

    if (markerIndex !== -1) {
      const oldPath = decodeURIComponent(
        oldUrl.pathname.slice(
          markerIndex + marker.length
        )
      );

      const { error: removeOldPhotoError } =
        await supabaseClient.storage
          .from("employee-photos")
          .remove([oldPath]);

      if (removeOldPhotoError) {
        console.error(
          "Could not delete old employee photo:",
          removeOldPhotoError
        );
      } else {
        console.log(
          "Old employee photo deleted:",
          oldPath
        );
      }
    }
  } catch (error) {
    console.error(
      "Could not process the old photo URL:",
      error
    );
  }
}

currentEmployeePhotoUrl = photoUrl;
await recordEmployeeActivity({
    type: "photo_uploaded",
    title: "Employee photo updated",
    description: "The employee profile photo was uploaded or replaced."
});
 const heroPhoto =
  document.getElementById("heroEmployeePhoto");

const heroInitials =
  document.getElementById("heroEmployeeInitials");

if (heroPhoto) {
  heroPhoto.src = photoUrl;
  heroPhoto.style.display = "block";
}

if (heroInitials) {
  heroInitials.style.display = "none";
}

  showPhotoMessage(
    "Employee photo uploaded successfully.",
    false
  );

  resetPhotoUploadButton();
}

function showPhotoMessage(message, isError) {
  if (!employeePhotoMessage) {
    return;
  }

  employeePhotoMessage.textContent = message;
  employeePhotoMessage.style.color =
    isError ? "#b91c1c" : "#087b4d";
    if (!isError) {
    window.setTimeout(() => {
        employeePhotoMessage.textContent = "";
    }, 3000);
}

}

function resetPhotoUploadButton() {
  uploadEmployeePhotoButton.disabled = false;
  uploadEmployeePhotoButton.textContent = "Upload Photo";
}

if (uploadEmployeePhotoButton) {
  uploadEmployeePhotoButton.addEventListener(
    "click",
    uploadEmployeePhoto
  );
}
const employeeDocumentName =
  document.getElementById("employeeDocumentName");

const employeeDocumentType =
  document.getElementById("employeeDocumentType");

const employeeDocumentInput =
  document.getElementById("employeeDocumentInput");

const uploadEmployeeDocumentButton =
  document.getElementById("uploadEmployeeDocumentButton");

const employeeDocumentMessage =
  document.getElementById("employeeDocumentMessage");

const employeeDocumentList =
  document.getElementById("employeeDocumentList");
  async function loadEmployeeNotes() {
  if (!employeeNotesList || !employeeId) {
    return;
  }

  employeeNotesList.innerHTML = `
    <p class="muted">
      Loading employee notes...
    </p>
  `;

  const { data, error } = await supabaseClient
    .from("employee_notes")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("workspace", EMPLOYEE_WORKSPACE)
    .order("created_at", {
      ascending: false
    });

  if (error) {
    console.error(
      "Could not load employee notes:",
      error
    );

    employeeNotesList.innerHTML = `
      <div class="empty-notes">
        Employee notes could not be loaded.
      </div>
    `;

    return;
  }

  if (!data || data.length === 0) {
    employeeNotesList.innerHTML = `
      <div class="empty-notes">
        No employee notes have been added yet.
      </div>
    `;

    return;
  }

  employeeNotesList.innerHTML = data
    .map((noteRecord) => {
      const createdDate = new Date(
        noteRecord.created_at
      ).toLocaleString("en-JM", {
        dateStyle: "medium",
        timeStyle: "short"
      });

      return `
        <div class="employee-note-card">
          <p>${noteRecord.note}</p>

          <div class="employee-note-meta">
            <span>
              ${noteRecord.created_by || "HR"}
            </span>

            <span>
              ${createdDate}
            </span>
          </div>
        </div>
      `;
    })
    .join("");
}
async function addEmployeeNote() {
  if (!employeeId) {
    return;
  }

  const noteText =
    employeeNoteInput?.value.trim();

  if (!noteText) {
    if (employeeNoteMessage) {
      employeeNoteMessage.textContent =
        "Enter a note before saving.";

      employeeNoteMessage.style.color =
        "#b91c1c";
    }

    return;
  }

  if (addEmployeeNoteButton) {
    addEmployeeNoteButton.disabled = true;
    addEmployeeNoteButton.textContent =
      "Saving...";
  }

  const { error } = await supabaseClient
    .from("employee_notes")
    .insert({
      employee_id: employeeId,
      workspace: EMPLOYEE_WORKSPACE,
      note: noteText,
      created_by: "HR"
    });

  if (error) {
    console.error(
      "Could not save employee note:",
      error
    );

    if (employeeNoteMessage) {
      employeeNoteMessage.textContent =
        "The employee note could not be saved.";

      employeeNoteMessage.style.color =
        "#b91c1c";
    }

    if (addEmployeeNoteButton) {
      addEmployeeNoteButton.disabled = false;
      addEmployeeNoteButton.textContent =
        "Add Note";
    }

    return;
  }

  if (employeeNoteInput) {
    employeeNoteInput.value = "";
  }

  if (employeeNoteMessage) {
    employeeNoteMessage.textContent =
      "Employee note added successfully.";

    employeeNoteMessage.style.color =
      "#087b4d";

    window.setTimeout(() => {
      employeeNoteMessage.textContent = "";
    }, 3000);
  }

  if (addEmployeeNoteButton) {
    addEmployeeNoteButton.disabled = false;
    addEmployeeNoteButton.textContent =
      "Add Note";
  }
await recordEmployeeActivity({
  type: "note",
  title: "HR note added",
  description: noteText
});

  await loadEmployeeNotes();
}
if (addEmployeeNoteButton) {
  addEmployeeNoteButton.addEventListener(
    "click",
    addEmployeeNote
  );
}
async function uploadEmployeeDocument() {
  if (!employeeId) {
    showDocumentMessage(
      "Employee ID is missing.",
      true
    );
    return;
  }

  const documentName =
    employeeDocumentName?.value.trim();

  const documentType =
    employeeDocumentType?.value;

  const selectedFile =
    employeeDocumentInput?.files?.[0];

  if (!documentName) {
    showDocumentMessage(
      "Enter a document name.",
      true
    );
    return;
  }

  if (!selectedFile) {
    showDocumentMessage(
      "Choose a file first.",
      true
    );
    return;
  }

  const maximumFileSize =
    10 * 1024 * 1024;

  if (selectedFile.size > maximumFileSize) {
    showDocumentMessage(
      "The document must be smaller than 10 MB.",
      true
    );
    return;
  }

  uploadEmployeeDocumentButton.disabled = true;
  uploadEmployeeDocumentButton.textContent =
    "Uploading...";

  showDocumentMessage(
    "Uploading document...",
    false
  );

  const safeFileName =
    selectedFile.name.replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );

  const filePath =
    `${employeeId}/${crypto.randomUUID()}-${safeFileName}`;

  const { error: uploadError } =
    await supabaseClient.storage
      .from("employee-documents")
      .upload(filePath, selectedFile, {
        cacheControl: "3600",
        upsert: false
      });

  if (uploadError) {
    console.error(
      "Could not upload employee document:",
      uploadError
    );

    showDocumentMessage(
      "The document could not be uploaded.",
      true
    );

    resetDocumentUploadButton();
    return;
  }

  const { error: recordError } =
    await supabaseClient
      .from("employee_documents")
      .insert({
        employee_id: employeeId,
        workspace: "kairox-exchange",
        document_name: documentName,
        document_type: documentType || null,
        file_path: filePath
      });

  if (recordError) {
    console.error(
      "Could not save document record:",
      recordError
    );

    showDocumentMessage(
      "The file uploaded, but the document record could not be saved.",
      true
    );

    resetDocumentUploadButton();
    return;
  }

  employeeDocumentName.value = "";
  employeeDocumentType.value = "";
  employeeDocumentInput.value = "";

  showDocumentMessage(
    "Document uploaded successfully.",
    false
  );

  resetDocumentUploadButton();
await recordEmployeeActivity({
  type: "document_uploaded",
  title: "Employee document uploaded",
  description:
    `${documentName} (${documentType}) was uploaded.`
});
  await loadEmployeeDocuments();
}

async function loadEmployeeDocuments() {
  if (!employeeDocumentList || !employeeId) {
    return;
  }
  const { data, error } = await supabaseClient
    .from("employee_documents")
    .select(
      "id, document_name, document_type, file_path, created_at"
    )
    .eq("employee_id", employeeId)
    .order("created_at", {
      ascending: false
    });

  if (error) {
    console.error(
      "Could not load employee documents:",
      error
    );

    employeeDocumentList.innerHTML = `
      <p class="muted">
        Could not load employee documents.
      </p>
    `;

    return;
  }

  if (!data || data.length === 0) {
  if (!data || data.length === 0) {
  employeeDocumentList.innerHTML = `
    <div class="empty-documents">
      <div class="empty-documents-icon">📂</div>

      <strong>No employee documents</strong>

      <p>
        Upload contracts, identification, bank details,
        qualifications or other employee records.
      </p>
    </div>
  `;

  return;
}

    return;
  }

  const documentItems = await Promise.all(
  data.map(async (documentRecord) => {
    const { data: signedUrlData, error: signedUrlError } =
      await supabaseClient.storage
        .from("employee-documents")
        .createSignedUrl(
          documentRecord.file_path,
          60 * 60
        );

    if (signedUrlError) {
      console.error(
        "Could not create document URL:",
        signedUrlError
      );
    }

    const documentUrl =
      signedUrlData?.signedUrl || "#";

    const uploadedDate =
      new Date(
        documentRecord.created_at
      ).toLocaleDateString("en-JM", {
        year: "numeric",
        month: "short",
        day: "numeric"
      });

    return `
      <div class="document-card">

        <div class="document-card-main">

          <div class="document-file-icon">
            📄
          </div>

          <div class="document-info">
            <h4>
              ${
                documentRecord.document_name ||
                "Unnamed Document"
              }
            </h4>

            <p>
              ${
                documentRecord.document_type ||
                "Other document"
              }
              • Uploaded ${uploadedDate}
            </p>
          </div>

        </div>

        <div class="document-actions">

          <a
            class="document-button document-view-button"
            href="${documentUrl}"
            target="_blank"
            rel="noopener"
          >
            View
          </a>

          <a
            class="document-button document-download-button"
            href="${documentUrl}"
            download
          >
            Download
          </a>

          <button
            type="button"
            class="delete-document-button"
            data-document-id="${documentRecord.id}"
            data-file-path="${documentRecord.file_path}"
            data-document-name="${documentRecord.document_name}"
          >
            Delete
          </button>

        </div>

      </div>
    `;
  })
);

employeeDocumentList.innerHTML =
  documentItems.join("");
}

async function deleteEmployeeDocument(
    documentId,
    filePath,
    documentName
) {
  const confirmed = window.confirm(
    "Delete this document?"
  );

  if (!confirmed) {
    return;
  }

  const { error: storageError } =
    await supabaseClient.storage
      .from("employee-documents")
      .remove([filePath]);

  if (storageError) {
    console.error(
      "Could not delete document file:",
      storageError
    );

    alert(
      "The document file could not be deleted."
    );
    return;
  }

  const { error: recordError } =
    await supabaseClient
      .from("employee_documents")
      .delete()
      .eq("id", documentId);

  if (recordError) {
    console.error(
      "Could not delete document record:",
      recordError
    );

    alert(
      "The document record could not be deleted."
    );
    return;
  }

  await recordEmployeeActivity({
  type: "document_deleted",
  title: "Employee document deleted",
  description:
    `${documentName || "Employee document"} was deleted.`
});

  await loadEmployeeDocuments();
}

function showDocumentMessage(
  message,
  isError
) {
  if (!employeeDocumentMessage) {
    return;
  }

  employeeDocumentMessage.textContent =
    message;

  employeeDocumentMessage.style.color =
    isError ? "#b91c1c" : "#087b4d";
}


function resetDocumentUploadButton() {
  uploadEmployeeDocumentButton.disabled =
    false;

  uploadEmployeeDocumentButton.textContent =
    "Upload Document";
}

if (uploadEmployeeDocumentButton) {
  uploadEmployeeDocumentButton.addEventListener(
    "click",
    uploadEmployeeDocument
  );
}

document.addEventListener(
  "click",
  (event) => {
    const deleteButton =
      event.target.closest(
        ".delete-document-button"
      );

    if (!deleteButton) {
      return;
    }

    deleteEmployeeDocument(
  deleteButton.dataset.documentId,
  deleteButton.dataset.filePath,
  deleteButton.dataset.documentName
);
  }
);

loadEmployeeDocuments();
async function recordEmployeeActivity({
  type,
  title,
  description = "",
  createdBy = "HR"
}) {
  if (!employeeId) {
    return;
  }

  const { error } = await supabaseClient
    .from("employee_activity")
    .insert({
      employee_id: employeeId,
      workspace: EMPLOYEE_WORKSPACE,
      activity_type: type,
      activity_title: title,
      activity_description: description,
      created_by: createdBy
    });

  if (error) {
    console.error(
      "Could not record employee activity:",
      error
    );

    return;
  }

  await loadEmployeeActivity();
}

function getActivityIcon(type) {
  switch (type) {
    case "employee_created":
      return "🟢";

    case "profile_updated":
      return "✏️";

    case "note":
      return "📝";

    case "photo_updated":
      return "📷";

    case "document_uploaded":
      return "📄";

    case "document_deleted":
      return "🗑️";

    case "employee_archived":
      return "🔒";

    case "employee_restored":
      return "↩️";

    default:
      return "✓";
  }
}
async function loadEmployeeActivity() {
    const activityList =
        document.getElementById("employeeActivityList");

    if (!activityList || !employeeId) return;

    activityList.innerHTML =
        "<p class='muted'>Loading activity...</p>";

    const { data, error } = await supabaseClient
        .from("employee_activity")
        .select("*")
        .eq("employee_id", employeeId)
        .order("created_at", { ascending: false });

    if (error) {
        console.error(error);

        activityList.innerHTML = `
            <div class="empty-activity">
                Could not load activity history.
            </div>
        `;

        return;
    }

    if (!data || data.length === 0) {
      
        activityList.innerHTML = `
            <div class="empty-activity">
                No activity recorded yet.
            </div>
        `;

        return;
    }

    activityList.innerHTML = data.map(activity => `
        <div class="employee-activity-item">

            <div class="employee-activity-icon">
    ${getActivityIcon(activity.activity_type)}
</div>
            <div class="employee-activity-content">

                <h4 class="employee-activity-title">
                    ${activity.activity_title}
                </h4>

                <p class="employee-activity-description">
                    ${activity.activity_description || ""}
                </p>

                <div class="employee-activity-meta">
                    <span>${new Date(activity.created_at).toLocaleString()}</span>
                </div>

            </div>

        </div>
    `).join("");
}