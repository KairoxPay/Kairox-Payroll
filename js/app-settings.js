// Which company the signed-in person is working in (chosen with the company switcher). Kairox Exchange by default.
function kairoxWorkspaceId() {
  try {
    return localStorage.getItem("kairoxWorkspace") || "kairox-exchange";
  } catch (error) {
    return "kairox-exchange";
  }
}

const SETTINGS_WORKSPACE = kairoxWorkspaceId();
let settingsRole = null;

const RATE_FIELDS = [
  ["threshold", "rateThreshold"],
  ["payeLower", "ratePayeLower"],
  ["payeHigher", "ratePayeHigher"],
  ["payeBand", "ratePayeBand"],
  ["nis", "rateNis"],
  ["nisCeiling", "rateNisCeiling"],
  ["nht", "rateNht"],
  ["edTax", "rateEdTax"]
];

const ROLE_OPTIONS = [
  ["none", "No access"],
  ["viewer", "Viewer (read only)"],
  ["payroll", "Payroll / accounts officer (prepares and processes payroll)"],
  ["director", "Managing director (everything except Settings)"],
  ["hr", "HR officer (people and leave, no pay)"],
  ["manager", "Manager (their own team's leave)"],
  ["admin", "Admin"]
];

function settingsEscape(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setSettingsMessage(text, kind) {
  const box = document.getElementById("settingsMessage");

  if (box) {
    box.textContent = text || "";
    box.className = kind || "";
  }
}

function showSettingsBanner(html) {
  const banner = document.getElementById("settingsBanner");

  if (banner) {
    banner.innerHTML = html;
    banner.hidden = !html;
  }
}

async function ensureSettingsAccess() {
  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData || !sessionData.session) {
    showSettingsBanner(
      'You are not signed in. <a href="login.html?next=settings.html">Sign in</a> to continue.'
    );
    return false;
  }

  const { data: role, error } = await supabaseClient.rpc("get_my_role", { p_workspace: kairoxWorkspaceId() });

  if (error) {
    showSettingsBanner(
      "The payroll security update has not been applied yet. Run phase2-migration.sql and phase3-migration.sql in Supabase, then refresh."
    );
    return false;
  }

  if (!role) {
    showSettingsBanner(
      "Your account does not have a payroll role yet. Ask an admin to give you access."
    );
    return false;
  }

  settingsRole = role;
  showSettingsBanner("");
  return true;
}

/* ================= COMPANY PROFILE ================= */
const COMPANY_FIELDS = [
  ["company_name", "companyName"],
  ["trading_name", "companyTradingName"],
  ["trn", "companyTrn"],
  ["nis_number", "companyNis"],
  ["address_line1", "companyAddress1"],
  ["address_line2", "companyAddress2"],
  ["parish", "companyParish"],
  ["phone", "companyPhone"],
  ["email", "companyEmail"]
];

function setCompanyMeta(text) {
  document.getElementById("companyMeta").textContent = text || "";
}

async function loadCompanyProfile() {
  const { data, error } = await supabaseClient
    .from("company_profile")
    .select("*")
    .eq("workspace", SETTINGS_WORKSPACE)
    .maybeSingle();

  const editable = settingsRole === "admin";

  COMPANY_FIELDS.forEach(([, id]) => {
    document.getElementById(id).disabled = !editable;
  });
  document.getElementById("saveCompanyButton").hidden = !editable;

  if (error) {
    console.error("Could not load the company profile:", error);
    setCompanyMeta("The company profile is not available yet. Run phase5-migration.sql in Supabase, then refresh.");
    document.getElementById("saveCompanyButton").hidden = true;
    document.getElementById("companyLogoControls").hidden = true;
    return;
  }

  const row = data || {};

  COMPANY_FIELDS.forEach(([key, id]) => {
    document.getElementById(id).value = row[key] || "";
  });

  renderLogoPreview(row.logo_data || null);

  if (row.updated_at) {
    setCompanyMeta(`Last saved ${new Date(row.updated_at).toLocaleDateString("en-JM", { dateStyle: "medium" })} by ${row.updated_by}.`);
  } else {
    setCompanyMeta(
      editable
        ? "Not saved yet. These details will appear on payslips and exports."
        : "An admin has not entered the company details yet."
    );
  }
}

async function saveCompanyProfile() {
  const fields = {};

  COMPANY_FIELDS.forEach(([key, id]) => {
    fields[key] = document.getElementById(id).value.trim();
  });

  const trn = fields.trn.replace(/[\s-]/g, "");

  if (!fields.company_name) {
    return setSettingsMessage("Please enter the company name.", "error");
  }

  if (trn && !/^[0-9]{9}$/.test(trn)) {
    return setSettingsMessage("A Tax Registration Number (TRN) has 9 digits.", "error");
  }

  if (fields.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email)) {
    return setSettingsMessage("That email address does not look right.", "error");
  }

  fields.trn = trn;
  setSettingsMessage("", "");

  const { error } = await supabaseClient.rpc("save_company_profile", {
    p_workspace: SETTINGS_WORKSPACE,
    p_profile: fields
  });

  if (error) {
    console.error("Company profile was not saved:", error);
    return setSettingsMessage("It was not saved. " + (error.message || ""), "error");
  }

  setSettingsMessage("Company profile saved. It now appears on payslips and exports.", "ok");
  await loadCompanyProfile();
}

/* ================= COMPANY LOGO ================= */
const LOGO_MAX_WIDTH = 600;
const LOGO_MAX_HEIGHT = 240;
const LOGO_MAX_CHARS = 380000;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

function renderLogoPreview(dataUrl) {
  const box = document.getElementById("companyLogoPreview");
  const editable = settingsRole === "admin";

  box.textContent = "";

  if (dataUrl) {
    const image = document.createElement("img");
    image.src = dataUrl;
    image.alt = "Company logo";
    image.style.cssText = "max-width:100%;max-height:100%;";
    box.appendChild(image);
  } else {
    box.textContent = "No logo yet";
  }

  document.getElementById("companyLogoControls").hidden = !editable;
  document.getElementById("removeCompanyLogoButton").hidden = !editable || !dataUrl;
}

// Shrinks the chosen picture to a PNG that fits the payslip, and keeps it small enough to store.
function resizeLogoFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("That picture could not be read."));
    reader.onload = () => {
      const image = new Image();

      image.onerror = () => reject(new Error("That file is not a picture this browser can open."));
      image.onload = () => {
        let scale = Math.min(1, LOGO_MAX_WIDTH / image.naturalWidth, LOGO_MAX_HEIGHT / image.naturalHeight);

        for (let attempt = 0; attempt < 5; attempt++) {
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

          const url = canvas.toDataURL("image/png");

          if (url.length <= LOGO_MAX_CHARS) {
            return resolve(url);
          }

          scale *= 0.7;
        }

        reject(new Error("That picture is too detailed to shrink enough. Try a simpler or smaller logo."));
      };
      image.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

async function uploadCompanyLogo(event) {
  const input = event.target;
  const file = input.files && input.files[0];

  if (!file) return;

  setSettingsMessage("", "");

  if (!LOGO_TYPES.includes(file.type)) {
    input.value = "";
    return setSettingsMessage("Please choose a PNG, JPG or WebP picture.", "error");
  }

  if (file.size > 8 * 1024 * 1024) {
    input.value = "";
    return setSettingsMessage("That file is over 8 MB. Please choose a smaller picture.", "error");
  }

  let dataUrl;

  try {
    dataUrl = await (window.resizeLogoFile || resizeLogoFile)(file);
  } catch (error) {
    input.value = "";
    return setSettingsMessage(error.message || "That picture could not be used.", "error");
  }

  const { error } = await supabaseClient.rpc("save_company_logo", {
    p_workspace: SETTINGS_WORKSPACE,
    p_logo: dataUrl
  });

  input.value = "";

  if (error) {
    console.error("Logo was not saved:", error);
    return setSettingsMessage("The logo was not saved. " + (error.message || ""), "error");
  }

  setSettingsMessage("Logo saved. It now appears on this company's payslips and reports.", "ok");
  await loadCompanyProfile();
}

async function removeCompanyLogo() {
  if (!window.confirm("Remove the logo from this company's payslips and reports?")) return;

  setSettingsMessage("", "");

  const { error } = await supabaseClient.rpc("save_company_logo", {
    p_workspace: SETTINGS_WORKSPACE,
    p_logo: null
  });

  if (error) {
    return setSettingsMessage("The logo was not removed. " + (error.message || ""), "error");
  }

  setSettingsMessage("Logo removed.", "ok");
  await loadCompanyProfile();
}

/* ================= STATUTORY RATES ================= */
async function loadSettingsRates() {
  const { data, error } = await supabaseClient
    .from("payroll_rates")
    .select("*")
    .eq("workspace", SETTINGS_WORKSPACE)
    .maybeSingle();

  if (error) {
    console.error("Could not load the rates:", error);
    setSettingsMessage(
      "The rates could not be loaded. Has phase3-migration.sql been run in Supabase?",
      "error"
    );
    return;
  }

  const rates = (data && data.rates) || {};

  RATE_FIELDS.forEach(([key, id]) => {
    const input = document.getElementById(id);
    input.value = rates[key] ?? "";
    input.disabled = settingsRole !== "admin";
  });

  document.getElementById("saveRatesButton").disabled = settingsRole !== "admin";

  const meta = document.getElementById("ratesMeta");

  if (settingsRole !== "admin") {
    meta.textContent = "Only an admin can change these.";
  } else if (data && data.updated_by) {
    meta.textContent =
      `Last changed by ${data.updated_by} on ` +
      new Date(data.updated_at).toLocaleString("en-JM", { dateStyle: "medium", timeStyle: "short" });
  } else {
    meta.textContent = "No saved rates yet. The built-in 2026/27 rates are in use.";
  }
}

function readRatesFromForm() {
  const rates = {};

  for (const [key, id] of RATE_FIELDS) {
    const raw = document.getElementById(id).value.trim();
    const value = Number(raw);

    if (raw === "" || !Number.isFinite(value)) {
      return { error: "Every rate needs a number." };
    }

    rates[key] = value;
  }

  if (rates.threshold <= 0 || rates.payeBand <= 0 || rates.nisCeiling <= 0) {
    return { error: "The threshold, the PAYE band and the NIS ceiling must be above zero." };
  }

  for (const key of ["payeLower", "payeHigher", "nis", "nht", "edTax"]) {
    if (rates[key] < 0 || rates[key] > 100) {
      return { error: "Percentages must be between 0 and 100." };
    }
  }

  if (rates.payeHigher < rates.payeLower) {
    return { error: "The higher PAYE rate cannot be lower than the lower PAYE rate." };
  }

  return { rates };
}

async function saveSettingsRates() {
  setSettingsMessage("", "");

  const { rates, error: formError } = readRatesFromForm();

  if (formError) {
    setSettingsMessage(formError, "error");
    return;
  }

  const button = document.getElementById("saveRatesButton");
  button.disabled = true;

  const { error } = await supabaseClient.rpc("save_payroll_rates", {
    p_workspace: SETTINGS_WORKSPACE,
    p_rates: rates
  });

  button.disabled = settingsRole !== "admin";

  if (error) {
    console.error("Rates were not saved:", error);
    setSettingsMessage("The rates were not saved. " + (error.message || ""), "error");
    return;
  }

  await loadSettingsRates();
  setSettingsMessage("Rates saved. New and unsaved payrolls will use them.", "ok");
}

/* ================= USERS AND ROLES ================= */
async function loadSettingsUsers() {
  const body = document.getElementById("usersTableBody");

  const { data, error } = await supabaseClient.rpc("list_user_roles", { p_workspace: SETTINGS_WORKSPACE });

  if (error) {
    console.error("Could not load users:", error);
    body.innerHTML = `<tr><td colspan="4">Users could not be loaded. ${settingsEscape(error.message || "")}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    body.innerHTML = '<tr><td colspan="4">No logins found.</td></tr>';
    return;
  }

  body.innerHTML = data
    .map((user) => {
      const current = user.role || "none";
      const when = user.last_sign_in_at
        ? new Date(user.last_sign_in_at).toLocaleDateString("en-JM", { dateStyle: "medium" })
        : "Never";

      return `
        <tr data-email="${settingsEscape(user.email)}">
          <td><strong>${settingsEscape(user.email)}</strong></td>
          <td>
            <select data-role-select>
              ${ROLE_OPTIONS.map(
                ([value, label]) =>
                  `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`
              ).join("")}
            </select>
          </td>
          <td>${settingsEscape(when)}</td>
          <td><button type="button" class="settings-button small" data-save-role>Save</button></td>
        </tr>
      `;
    })
    .join("");
}

async function saveUserRole(email, role) {
  setSettingsMessage("", "");

  const { error } = await supabaseClient.rpc("set_user_role", {
    p_email: email,
    p_role: role,
    p_workspace: SETTINGS_WORKSPACE
  });

  if (error) {
    console.error("Role was not changed:", error);
    setSettingsMessage("The role was not changed. " + (error.message || ""), "error");
    await loadSettingsUsers();
    return;
  }

  await loadSettingsUsers();
  setSettingsMessage(`Saved. ${email} now has: ${role === "none" ? "no access" : role}.`, "ok");
}

async function startSettingsPage() {
  if (!(await ensureSettingsAccess())) {
    return;
  }

  // Say which company these settings are for.
  const { data: company } = await supabaseClient.from("workspaces").select("name").eq("id", SETTINGS_WORKSPACE).maybeSingle();
  const label = document.getElementById("settingsCompanyName");
  if (label) {
    label.textContent = (company && company.name) || (SETTINGS_WORKSPACE === "kairox-exchange" ? "Kairox Exchange" : SETTINGS_WORKSPACE);
  }

  document.getElementById("companyCard").hidden = false;
  await loadCompanyProfile();

  document.getElementById("ratesCard").hidden = false;
  await loadSettingsRates();

  if (settingsRole === "admin") {
    document.getElementById("usersCard").hidden = false;
    await loadSettingsUsers();

    document.getElementById("portalCard").hidden = false;
    await loadPortalSettings();
  }
}

/* ================= EMPLOYEE PORTAL ================= */
const PORTAL_FIELDS = [["payslips", "portalPayslips"], ["leave", "portalLeave"], ["details", "portalDetails"], ["tax", "portalTax"], ["documents", "portalDocuments"]];

async function loadPortalSettings() {
  const { data } = await supabaseClient.from("portal_settings").select("*").eq("workspace", SETTINGS_WORKSPACE).maybeSingle();

  PORTAL_FIELDS.forEach(([key, id]) => {
    document.getElementById(id).checked = !data || data[key] !== false;   // everything is on until switched off
  });

  document.getElementById("portalMeta").textContent = data && data.updated_by ? `Last saved by ${data.updated_by}.` : "Everything is on.";
}

async function savePortalSettings() {
  const payload = Object.fromEntries(PORTAL_FIELDS.map(([key, id]) => [key, document.getElementById(id).checked]));
  const { error } = await supabaseClient.rpc("save_portal_settings", { p_workspace: SETTINGS_WORKSPACE, p_data: payload });

  if (error) {
    setSettingsMessage(error.message || "The employee portal settings were not saved.", "error");
    return;
  }

  setSettingsMessage("Employee portal settings saved.", "ok");
  await loadPortalSettings();
}

document.getElementById("saveRatesButton").addEventListener("click", saveSettingsRates);
document.getElementById("savePortalButton").addEventListener("click", savePortalSettings);
document.getElementById("saveCompanyButton").addEventListener("click", saveCompanyProfile);
document.getElementById("companyLogoFile").addEventListener("change", uploadCompanyLogo);
document.getElementById("removeCompanyLogoButton").addEventListener("click", removeCompanyLogo);

document.addEventListener("click", (event) => {
  const button = event.target.closest && event.target.closest("[data-save-role]");

  if (!button) {
    return;
  }

  const row = button.closest("tr");
  saveUserRole(row.getAttribute("data-email"), row.querySelector("[data-role-select]").value);
});

startSettingsPage();