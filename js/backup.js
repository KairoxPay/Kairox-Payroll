// Backup: downloads this company's records (everything the signed-in admin or managing director can read) as an Excel
// workbook with one sheet per kind of record, or as one complete JSON file. Nothing is changed in the database.

const BKP_WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
const bkpEl = (id) => document.getElementById(id);
const bkpEsc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

// [sheet name, table, how to filter by company]. "runs" = rows whose payroll run belongs to this company.
const BKP_TABLES = [
  ["Company profile", "company_profile", "workspace"],
  ["Employees", "employees", "workspace"],
  ["Pay items", "employee_pay_defaults", "workspace"],
  ["Payrolls", "payroll_runs", "workspace"],
  ["Payslip lines", "payroll_run_items", "runs"],
  ["Leave types", "leave_types", "workspace"],
  ["Leave requests", "leave_requests", "workspace"],
  ["Leave adjustments", "leave_adjustments", "workspace"],
  ["Public holidays", "public_holidays", "workspace"],
  ["Departures", "employee_departures", "workspace"],
  ["Filings", "filing_records", "workspace"],
  ["Statutory rates", "payroll_rates", "workspace"],
  ["Pay period settings", "pay_period_settings", "workspace"],
  ["Portal settings", "portal_settings", "workspace"],
  ["Employee activity", "employee_activity", "workspace"],
  ["Audit trail", "activity_logs", "workspace"]
];
// Kept behind role-checked functions, so they are read through those.
const BKP_RPCS = [
  ["Bank accounts", "bank_accounts_list"],
  ["New-hire checklist", "onboarding_list"]
];

function bkpMsg(text, kind) { const b = bkpEl("bkpMsg"); b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); }

// Pure: turn rows into flat sheet rows (objects and lists become JSON text; Excel cells hold at most 32,767 characters).
function bkpFlatten(rows) {
  return (rows || []).map((r) => {
    const out = {};
    Object.entries(r || {}).forEach(([k, v]) => {
      const cell = v !== null && typeof v === "object" ? JSON.stringify(v) : v;
      out[k] = typeof cell === "string" && cell.length > 32000 ? `${cell.slice(0, 32000)}… (cut: see the JSON copy)` : cell;
    });
    return out;
  });
}

async function bkpReadAll(table, filterCol, ids) {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    let q = supabaseClient.from(table).select("*").range(from, from + size - 1);
    if (filterCol === "workspace") q = q.eq("workspace", BKP_WS);
    if (filterCol === "runs") q = q.in("payroll_run_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

async function bkpCollect() {
  const results = [];
  let runIds = [];

  for (const [sheet, table, filter] of BKP_TABLES) {
    bkpMsg(`Reading ${sheet.toLowerCase()}…`);
    try {
      const rows = await bkpReadAll(table, filter, runIds);
      if (table === "payroll_runs") runIds = rows.map((r) => r.id);
      results.push({ sheet, source: table, rows, note: "" });
    } catch (error) {
      results.push({ sheet, source: table, rows: [], note: /does not exist|could not find|schema cache/i.test(error.message || "") ? "Not used in this project" : `Could not read: ${error.message || "error"}` });
    }
  }

  for (const [sheet, fn] of BKP_RPCS) {
    const { data, error } = await supabaseClient.rpc(fn, { p_workspace: BKP_WS });
    results.push({ sheet, source: fn, rows: error ? [] : data || [], note: error ? "Not set up, or not allowed for your role" : "" });
  }

  bkpEl("bkpBody").innerHTML = results.map((r) =>
    `<tr><td>${bkpEsc(r.sheet)}</td><td class="num">${r.rows.length}</td><td class="muted small">${bkpEsc(r.note)}</td></tr>`).join("");
  return results;
}

function bkpStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function bkpSave(name, blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 3000);
}

async function bkpDownload(kind) {
  ["bkpXlsx", "bkpJson"].forEach((id) => { bkpEl(id).disabled = true; });
  try {
    const results = await bkpCollect();
    const total = results.reduce((t, r) => t + r.rows.length, 0);
    const name = `KairoxPay_backup_${BKP_WS}_${bkpStamp()}`;

    if (kind === "json") {
      const payload = { app: "Kairox Pay", company: BKP_WS, created: new Date().toISOString(), tables: Object.fromEntries(results.map((r) => [r.source, r.rows])) };
      bkpSave(`${name}.json`, new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" }));
    } else {
      if (typeof XLSX === "undefined") throw new Error("The spreadsheet library did not load. Refresh, or use the JSON copy.");
      const book = XLSX.utils.book_new();
      const about = [["Kairox Pay backup"], ["Company", BKP_WS], ["Created", new Date().toLocaleString()], [],
        ["Sheet", "Rows", "Note"]].concat(results.map((r) => [r.sheet, r.rows.length, r.note]));
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(about), "About");
      results.forEach((r) => {
        const sheet = r.rows.length ? XLSX.utils.json_to_sheet(bkpFlatten(r.rows)) : XLSX.utils.aoa_to_sheet([[r.note || "No records"]]);
        XLSX.utils.book_append_sheet(book, sheet, r.sheet.slice(0, 31));
      });
      bkpSave(`${name}.xlsx`, new Blob([XLSX.write(book, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    }

    bkpMsg(`Backup downloaded: ${total.toLocaleString()} records. Keep the file somewhere private.`, "ok");
  } catch (error) {
    bkpMsg(error.message || "The backup could not be made.", "error");
  } finally {
    ["bkpXlsx", "bkpJson"].forEach((id) => { bkpEl(id).disabled = false; });
  }
}

async function bkpStart() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data || !data.session) { window.location.href = "login.html?next=backup.html"; return; }
  const { data: role } = await supabaseClient.rpc("get_my_role", { p_workspace: BKP_WS });
  if (!["admin", "director"].includes(role)) {
    bkpEl("bkpXlsx").disabled = true; bkpEl("bkpJson").disabled = true;
    bkpMsg("Only an admin or a managing director can download a backup.", "error");
    return;
  }
  bkpEl("bkpXlsx").addEventListener("click", () => bkpDownload("xlsx"));
  bkpEl("bkpJson").addEventListener("click", () => bkpDownload("json"));
}

if (!window.__BKP_TEST__) bkpStart();
