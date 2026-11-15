// New hires: a checklist per employee. "On record" items are worked out from the employee's details (they tick themselves);
// paperwork items are ticked by hand and stored with who did it and when (phase27-new-hire-checklist.sql).

const OB_WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
const obEl = (id) => document.getElementById(id);
const obEsc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

const OB_RECORD = [
  ["has_trn", "TRN on record", "employee"],
  ["has_nis", "NIS number on record", "employee"],
  ["has_job", "Job title and department", "employee"],
  ["has_start", "Start date", "employee"],
  ["has_pay", "Pay set up", "employee"],
  ["has_emergency", "Emergency contact", "employee"],
  ["has_bank", "Bank account for salary", "bank"],
  ["has_login", "My portal sign-in linked", "people"]
];

const OB_PAPERS = [
  ["contract", "Employment contract signed"],
  ["id_copy", "Copy of photo ID (passport, driver's licence or voter ID)"],
  ["trn_card", "Copy of TRN card"],
  ["nis_card", "Copy of NIS card"],
  ["policies", "Workplace policies and handbook given"],
  ["induction", "Induction / orientation done"],
  ["probation", "Probation review date set"]
];

let obRows = [];
let obRole = null;

// Pure: how many of the items are done (tested)
function obProgress(row) {
  const record = OB_RECORD.filter(([k]) => row[k]).length;
  const papers = OB_PAPERS.filter(([k]) => row.ticked && row.ticked[k]).length;
  return { done: record + papers, total: OB_RECORD.length + OB_PAPERS.length };
}

function obShown(row, filter, todayIso) {
  const p = obProgress(row);
  if (filter === "all") return true;
  if (filter === "open") return p.done < p.total;
  if (!row.start_date) return p.done < p.total;
  const t = new Date(`${todayIso}T00:00:00`);
  const cutoff = new Date(t.getFullYear(), t.getMonth() - 6, t.getDate());
  return new Date(`${row.start_date}T00:00:00`) >= cutoff;
}

function obDate(iso) {
  if (!iso) return "";
  const d = new Date(String(iso).length > 10 ? iso : `${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function obMsg(text, kind) {
  const box = obEl("obMsg");
  box.textContent = text || "";
  box.className = `form-message ${kind || ""}`.trim();
}

function obLink(where, row) {
  if (where === "bank") return ["admin", "director", "payroll"].includes(obRole) ? `<a href="bank.html">Add in Bank payments</a>` : "";
  if (where === "people") return `<a href="people.html">Link in Team &amp; access</a>`;
  return ["admin", "director", "payroll"].includes(obRole) ? `<a href="edit-employee.html?id=${encodeURIComponent(row.employee_id)}">Add on profile</a>` : "";
}

function obRender() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const filter = obEl("obFilter").value;
  const shown = obRows.filter((r) => obShown(r, filter, today));

  if (!shown.length) {
    obEl("obList").innerHTML = `<p class="muted">${filter === "new" ? "Nobody started in the last 6 months. Choose another option above to see everyone." : "Nothing outstanding."}</p>`;
    return;
  }

  obEl("obList").innerHTML = shown.map((r) => {
    const p = obProgress(r);
    const pct = Math.round((p.done / p.total) * 100);
    const record = OB_RECORD.map(([k, label, where]) => `<li style="display:flex;gap:8px;align-items:baseline;padding:3px 0">
        <span aria-hidden="true" style="color:${r[k] ? "#16a34a" : "#b45309"};font-weight:800">${r[k] ? "✓" : "•"}</span>
        <span>${obEsc(label)}${r[k] ? "" : ` <span class="small" style="color:#b45309">missing</span> ${obLink(where, r)}`}</span></li>`).join("");
    const papers = OB_PAPERS.map(([k, label]) => {
      const t = r.ticked && r.ticked[k];
      return `<li style="padding:3px 0"><label style="display:flex;gap:8px;align-items:baseline;cursor:pointer">
          <input type="checkbox" data-emp="${obEsc(r.employee_id)}" data-item="${k}"${t ? " checked" : ""}>
          <span>${obEsc(label)}${t ? ` <span class="small muted">· ${obEsc(t.by || "")} ${obEsc(obDate(t.at))}</span>` : ""}</span></label></li>`;
    }).join("");

    return `<article style="border:1px solid #e3e4ec;border-radius:12px;padding:14px 16px;margin:0 0 14px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
        <div><strong style="font-size:16px">${obEsc(r.name)}</strong>
          <span class="small muted">${r.employee_number ? ` · ${obEsc(r.employee_number)}` : ""}${r.start_date ? ` · started ${obEsc(obDate(r.start_date))}` : ""}</span></div>
        <div class="small" style="min-width:180px"><strong>${p.done} of ${p.total} done</strong>
          <div style="height:6px;background:#eceef4;border-radius:4px;margin-top:4px" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Checklist progress">
            <div style="height:6px;width:${pct}%;background:${pct === 100 ? "#16a34a" : "#6d28d9"};border-radius:4px"></div></div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:6px 24px;margin-top:10px">
        <div><p class="small muted" style="margin:0 0 2px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">On record</p><ul style="list-style:none;margin:0;padding:0">${record}</ul></div>
        <div><p class="small muted" style="margin:0 0 2px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Paperwork</p><ul style="list-style:none;margin:0;padding:0">${papers}</ul></div>
      </div>
    </article>`;
  }).join("");
}

async function obLoad() {
  const { data, error } = await supabaseClient.rpc("onboarding_list", { p_workspace: OB_WS });
  if (error) {
    const missing = error.code === "PGRST202" || /could not find the function/i.test(error.message || "");
    obEl("obList").innerHTML = `<p>${obEsc(missing ? "The checklist is not set up yet. Run phase27-new-hire-checklist.sql in Supabase, then refresh." : error.message || "The checklist could not be loaded.")}</p>`;
    return;
  }
  obRows = data || [];
  obRender();
}

document.addEventListener("change", async (event) => {
  const t = event.target;
  if (t.id === "obFilter") return obRender();
  if (!t.dataset || !t.dataset.item) return;

  t.disabled = true;
  const { error } = await supabaseClient.rpc("set_onboarding_item", {
    p_workspace: OB_WS, p_employee: t.dataset.emp, p_item: t.dataset.item, p_done: t.checked
  });
  if (error) {
    t.checked = !t.checked;
    t.disabled = false;
    return obMsg(error.message || "The checklist was not updated.", "error");
  }
  obMsg("");
  await obLoad();
});

async function obStart() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data || !data.session) { window.location.href = "login.html?next=onboarding.html"; return; }
  const { data: role } = await supabaseClient.rpc("get_my_role", { p_workspace: OB_WS });
  obRole = role;
  if (!["admin", "director", "payroll", "hr"].includes(role)) {
    obEl("obList").innerHTML = "<p>Only admins, managing directors, payroll officers and HR officers can use the new-hire checklist.</p>";
    return;
  }
  await obLoad();
}

if (!window.__OB_TEST__) obStart();
