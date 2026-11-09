// Which company the signed-in person is working in (chosen with the company switcher). Kairox Exchange by default.
function kairoxWorkspaceId() {
  try {
    return localStorage.getItem("kairoxWorkspace") || "kairox-exchange";
  } catch (error) {
    return "kairox-exchange";
  }
}

const DOC_WORKSPACE = kairoxWorkspaceId();
const DOC_BUCKET = "company-documents";
const DOC_MAX_BYTES = 10 * 1024 * 1024;
const DOC_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg"
};
const DOC_CATEGORIES = ["Policies", "Contracts and templates", "Filing receipts", "Insurance", "Other"];

let docRole = null;
let docRows = [];

const docEsc = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function docSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function docExt(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name));
  return match ? match[1].toLowerCase() : "";
}

function docSafeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-80) || "file";
}

function docNewId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function docMessage(id, text, kind) {
  const box = document.getElementById(id);
  box.textContent = text || "";
  box.className = `form-message ${kind || ""}`.trim();
}

function docBanner(html) {
  const banner = document.getElementById("pageBanner");
  banner.innerHTML = html;
  banner.hidden = !html;
}

function docCanAdd() {
  return docRole === "admin" || docRole === "director" || docRole === "payroll" || docRole === "hr";
}

function docCanShare() {
  return docRole === "admin" || docRole === "director" || docRole === "hr";
}

async function docAccess() {
  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData || !sessionData.session) {
    docBanner('You are not signed in. <a href="login.html?next=documents.html">Sign in</a> to continue.');
    return false;
  }

  const { data: role, error } = await supabaseClient.rpc("get_my_role", { p_workspace: kairoxWorkspaceId() });

  if (error) {
    docBanner("The payroll security update has not been applied yet. Run the Phase 2 and Phase 4 database updates in Supabase, then refresh.");
    return false;
  }

  if (!role) {
    docBanner("Your account does not have a payroll role yet. Ask an admin to give you access.");
    return false;
  }

  docRole = role;
  docBanner("");
  return true;
}

/* ---------- list ---------- */
function docRender() {
  const body = document.getElementById("docBody");
  const filter = document.getElementById("docFilter");
  const term = document.getElementById("docSearch").value.trim().toLowerCase();
  const category = filter.value;

  const used = [...new Set(docRows.map((d) => d.category))];
  filter.innerHTML =
    '<option value="">All categories</option>' +
    used.map((c) => `<option value="${docEsc(c)}">${docEsc(c)}</option>`).join("");
  filter.value = used.includes(category) ? category : "";

  const matches = docRows.filter((d) => {
    if (filter.value && d.category !== filter.value) return false;
    return !term || `${d.title} ${d.file_name} ${d.description || ""}`.toLowerCase().includes(term);
  });

  document.getElementById("docCount").textContent = docRows.length
    ? `Showing ${matches.length} of ${docRows.length} document${docRows.length === 1 ? "" : "s"}.`
    : "";

  if (!docRows.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="5">No documents yet. Add your first one above.</td></tr>';
    return;
  }

  body.innerHTML = matches.length
    ? matches
        .map(
          (d) => `
            <tr>
              <td><strong>${docEsc(d.title)}</strong>${d.description ? `<small>${docEsc(d.description)}</small>` : ""}</td>
              <td><span class="badge info">${docEsc(d.category)}</span>${d.visible_to_employees ? '<small><span class="badge ok">Employees can see this</span></small>' : ""}</td>
              <td>${docEsc(d.file_name)}<small>${docEsc(docSize(d.size_bytes))}</small></td>
              <td>${docEsc(new Date(d.created_at).toLocaleDateString("en-JM", { dateStyle: "medium" }))}<small>${docEsc(d.uploaded_by)}</small></td>
              <td>
                <div class="row-actions">
                  <button type="button" class="btn small" data-download="${docEsc(d.id)}">Download</button>
                  ${docCanShare() ? `<button type="button" class="btn small" data-share="${docEsc(d.id)}" data-value="${d.visible_to_employees ? "0" : "1"}">${d.visible_to_employees ? "Stop sharing" : "Share with employees"}</button>` : ""}
                  ${docRole === "admin" ? `<button type="button" class="btn small danger" data-delete="${docEsc(d.id)}">Delete</button>` : ""}
                </div>
              </td>
            </tr>`
        )
        .join("")
    : '<tr class="empty-row"><td colspan="5">No documents match your search.</td></tr>';
}

// Documents are private to the payroll team until an admin or HR officer shares one with employees.
async function docShare(id, shared) {
  const { error } = await supabaseClient.rpc("set_document_shared", { p_id: id, p_shared: shared });

  if (error) {
    docMessage("listMessage", error.message || "That could not be changed.", "error");
    return;
  }

  docMessage("listMessage", shared ? "Employees can now see this document in their portal." : "Employees can no longer see this document.", "ok");
  await docLoad();
}

async function docLoad() {
  const { data, error } = await supabaseClient
    .from("company_documents")
    .select("*")
    .eq("workspace", DOC_WORKSPACE)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Could not load documents:", error);
    docBanner("Documents are not available yet. Run phase4-migration.sql in Supabase, then refresh.");
    return;
  }

  docRows = data || [];
  docRender();
}

/* ---------- upload ---------- */
async function docUpload(event) {
  event.preventDefault();
  docMessage("uploadMessage", "", "");

  const input = document.getElementById("docFile");
  const file = input.files && input.files[0];
  const category = document.getElementById("docCategory").value;
  const description = document.getElementById("docDescription").value.trim();
  let title = document.getElementById("docTitle").value.trim();

  if (!file) return docMessage("uploadMessage", "Please choose a file.", "error");

  const ext = docExt(file.name);

  if (!DOC_TYPES[ext]) {
    return docMessage("uploadMessage", "That type of file is not allowed. Use PDF, Word, Excel, CSV, text, PNG or JPG.", "error");
  }
  if (file.size <= 0) return docMessage("uploadMessage", "That file is empty.", "error");
  if (file.size > DOC_MAX_BYTES) return docMessage("uploadMessage", `That file is ${docSize(file.size)}. The limit is 10 MB.`, "error");

  if (!title) title = file.name.replace(/\.[^.]+$/, "").slice(0, 120);
  if (title.length > 120) return docMessage("uploadMessage", "Please keep the title under 120 characters.", "error");
  if (!DOC_CATEGORIES.includes(category)) return docMessage("uploadMessage", "Please choose a category.", "error");
  if (description.length > 500) return docMessage("uploadMessage", "Please keep the description under 500 characters.", "error");

  const button = document.getElementById("uploadButton");
  button.disabled = true;
  docMessage("uploadMessage", "Uploading…", "");

  const path = `${DOC_WORKSPACE}/${docNewId()}-${docSafeName(file.name)}`;
  const mime = DOC_TYPES[ext];

  const { error: uploadError } = await supabaseClient.storage
    .from(DOC_BUCKET)
    .upload(path, file, { contentType: mime, upsert: false });

  if (uploadError) {
    button.disabled = false;
    console.error("Upload failed:", uploadError);
    return docMessage("uploadMessage", "The file could not be uploaded. " + (uploadError.message || ""), "error");
  }

  const { error: registerError } = await supabaseClient.rpc("add_company_document", {
    p_workspace: DOC_WORKSPACE,
    p_title: title,
    p_category: category,
    p_description: description,
    p_file_path: path,
    p_file_name: file.name,
    p_mime_type: mime,
    p_size_bytes: file.size
  });

  button.disabled = false;

  if (registerError) {
    console.error("Document was not registered:", registerError);
    await supabaseClient.storage.from(DOC_BUCKET).remove([path]);   // do not leave an orphan file behind
    return docMessage("uploadMessage", "The document was not saved. " + (registerError.message || ""), "error");
  }

  document.getElementById("uploadForm").reset();
  docMessage("uploadMessage", "Uploaded.", "ok");
  await docLoad();
}

/* ---------- download and delete ---------- */
async function docDownload(id) {
  const row = docRows.find((d) => d.id === id);
  if (!row) return;

  docMessage("listMessage", "", "");

  const { data, error } = await supabaseClient.storage
    .from(DOC_BUCKET)
    .createSignedUrl(row.file_path, 60, { download: row.file_name });

  if (error || !data || !data.signedUrl) {
    console.error("Could not create a download link:", error);
    return docMessage("listMessage", "The file could not be opened. " + ((error && error.message) || ""), "error");
  }

  window.open(data.signedUrl, "_blank", "noopener");
}

async function docDelete(id) {
  const row = docRows.find((d) => d.id === id);
  if (!row) return;

  if (!window.confirm(`Delete "${row.title}"? This removes the file for everyone and cannot be undone.`)) return;

  docMessage("listMessage", "", "");

  const { data: path, error } = await supabaseClient.rpc("delete_company_document", { p_id: id });

  if (error) {
    console.error("Document was not deleted:", error);
    return docMessage("listMessage", "It was not deleted. " + (error.message || ""), "error");
  }

  const { error: removeError } = await supabaseClient.storage.from(DOC_BUCKET).remove([path || row.file_path]);

  if (removeError) {
    console.error("The file could not be removed from storage:", removeError);
    docMessage("listMessage", "The document was removed from the list, but its file could not be deleted from storage.", "error");
  }

  await docLoad();
}

async function docStart() {
  document.getElementById("uploadForm").addEventListener("submit", docUpload);
  document.getElementById("docSearch").addEventListener("input", docRender);
  document.getElementById("docFilter").addEventListener("change", docRender);

  document.getElementById("docFile").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    const titleInput = document.getElementById("docTitle");

    if (file && !titleInput.value.trim()) {
      titleInput.value = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 120);
    }
  });

  document.addEventListener("click", (event) => {
    const download = event.target.closest && event.target.closest("[data-download]");
    if (download) return docDownload(download.getAttribute("data-download"));

    const share = event.target.closest && event.target.closest("[data-share]");
    if (share) return docShare(share.getAttribute("data-share"), share.getAttribute("data-value") === "1");

    const remove = event.target.closest && event.target.closest("[data-delete]");
    if (remove) docDelete(remove.getAttribute("data-delete"));
  });

  if (!(await docAccess())) {
    document.getElementById("docBody").innerHTML = '<tr class="empty-row"><td colspan="5">Sign in with a payroll role to see documents.</td></tr>';
    return;
  }

  document.getElementById("uploadCard").hidden = !docCanAdd();
  await docLoad();
}

docStart();