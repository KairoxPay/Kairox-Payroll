// P24: each employee's certificate of pay and tax deducted for the year. Opens a printable page (one certificate per page),
// which can be printed or saved as PDF from the browser's print dialog.
// TAJ's Employers' Guide defines the P24 as a "certificate of gross emoluments and tax deducted" for the year but publishes no
// fixed layout, so this uses the same figures as the S02 Schedule A, with the EMPLOYEE's own deductions only.
// Uses helpers from compliance.js (cpRuns, cpEsc, cpMoney, cpBanner, CP_WORKSPACE) and s01-schedule.js (s01Num, s01R, s01Trn, s01CompanyName).

const p24Iso = (run) => String(run.pay_date || run.period_end).slice(0, 10);

// One row per employee: totals of their own pay and deductions in the year, and the first and last pay dates.
function p24Rows(items, employees, runs) {
  const emp = new Map((employees || []).map((e) => [e.id, e]));
  const when = new Map((runs || []).map((r) => [r.id, p24Iso(r)]));
  const byKey = new Map();

  (items || []).forEach((item) => {
    const date = when.get(item.payroll_run_id);
    if (!date) return;
    const key = item.employee_id || `name:${item.employee_name}`;
    const e = emp.get(item.employee_id) || {};
    const row = byKey.get(key) || {
      key, name: e.name || item.employee_name || "", trn: String(e.trn || (item.inputs && item.inputs.trn) || "").trim(),
      nis_number: String(e.nis_number || "").trim(), employee_number: e.employee_number || "",
      gross: 0, pension: 0, nis: 0, nht: 0, edTax: 0, paye: 0, net: 0, payslips: 0, first: date, last: date
    };
    row.gross += s01Num(item.gross_pay);
    row.pension += s01Num(item.pension);
    row.nis += s01Num(item.nis);
    row.nht += s01Num(item.nht);
    row.edTax += s01Num(item.education_tax);
    row.paye += s01Num(item.paye);
    row.net += s01Num(item.net_pay);
    row.payslips += 1;
    if (date < row.first) row.first = date;
    if (date > row.last) row.last = date;
    byKey.set(key, row);
  });

  return [...byKey.values()].map((r) => {
    const out = { ...r };
    ["gross", "pension", "nis", "nht", "edTax", "paye", "net"].forEach((k) => { out[k] = s01R(r[k]); });
    out.taxable = s01R(Math.max(0, out.gross - out.nis - out.pension));   // statutory income: gross less NIS and approved pension
    return out;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function p24Date(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(y, m - 1, d));
}

function p24Page(row, year, company, issued) {
  const c = company || {};
  const e = (v) => cpEsc(v == null ? "" : String(v));
  const money = (v) => `$${Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const line = (label, value, strong) => `<tr${strong ? ' class="strong"' : ""}><td>${label}</td><td class="num">${money(value)}</td></tr>`;
  const addr = [c.address_line1, c.address_line2, c.parish].filter(Boolean).join(", ");

  return `<section class="cert">
    <header><div><h1>P24</h1><p class="sub">Certificate of gross emoluments and tax deducted</p></div>
      <div class="year">Year ended 31 December ${year}</div></header>
    <div class="grid">
      <div class="box"><h2>Employer</h2>
        <p><strong>${e(c.company_name || company.fallback)}</strong></p>
        <p>TRN: ${e(s01Trn(c.trn)) || "—"}</p><p>NIS reference: ${e(c.nis_number) || "—"}</p>
        ${addr ? `<p>${e(addr)}</p>` : ""}</div>
      <div class="box"><h2>Employee</h2>
        <p><strong>${e(row.name)}</strong>${row.employee_number ? ` (${e(row.employee_number)})` : ""}</p>
        <p>TRN: ${e(s01Trn(row.trn)) || "—"}</p><p>NIS number: ${e(row.nis_number) || "—"}</p>
        <p>Paid from ${e(p24Date(row.first))} to ${e(p24Date(row.last))} (${row.payslips} ${row.payslips === 1 ? "payslip" : "payslips"})</p></div>
    </div>
    <table>
      <tbody>
        ${line("Gross emoluments (pay before deductions)", row.gross, true)}
        ${line("Approved pension / superannuation contributions", row.pension)}
        ${line("National Insurance (NIS) deducted", row.nis)}
        ${line("Statutory income (gross less NIS and pension)", row.taxable, true)}
        ${line("Income tax (PAYE) deducted", row.paye, true)}
        ${line("National Housing Trust (NHT) deducted", row.nht)}
        ${line("Education Tax deducted", row.edTax)}
        ${line("Net pay received", row.net)}
      </tbody>
    </table>
    <p class="note">These are the employee's own deductions. The employer's contributions are not shown. Benefits in kind: none recorded.
      Keep this certificate: you may need it for a tax refund or another TAJ return.</p>
    <div class="sign"><div><span></span>Signature of employer or authorised officer</div><div><span></span>Position</div><div><span>${e(p24Date(issued))}</span>Date issued</div></div>
  </section>`;
}

function p24Document(rows, year, company, issued) {
  const early = Number(String(issued).slice(0, 4)) <= year
    ? `<strong>${year} is not over yet:</strong> these figures cover payrolls processed so far. Print the final certificates after the last payroll of the year. `
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>P24 certificates ${year}</title><style>
    *{box-sizing:border-box} body{margin:0;font:13px/1.45 Arial,Helvetica,sans-serif;color:#111;background:#eee}
    .bar{position:sticky;top:0;background:#24123f;color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    .bar button{font:inherit;font-weight:700;padding:7px 14px;border:0;border-radius:6px;cursor:pointer}
    .cert{background:#fff;width:190mm;min-height:270mm;margin:12px auto;padding:14mm;page-break-after:always}
    header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}
    h1{margin:0;font-size:26px} .sub{margin:2px 0 0;font-weight:700} .year{font-weight:700;font-size:14px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px} .box{border:1px solid #999;border-radius:6px;padding:8px 10px}
    .box h2{margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#444} .box p{margin:2px 0}
    table{width:100%;border-collapse:collapse} td{border-bottom:1px solid #ccc;padding:7px 4px} .num{text-align:right;white-space:nowrap}
    tr.strong td{font-weight:700} .note{font-size:11.5px;color:#333;margin:12px 0 28px}
    .sign{display:grid;grid-template-columns:2fr 1fr 1fr;gap:18px} .sign div{font-size:11px;color:#444} .sign span{display:block;border-bottom:1px solid #111;height:26px;margin-bottom:3px;font-size:13px;color:#111}
    @media print{body{background:#fff}.bar{display:none}.cert{margin:0;width:auto;min-height:0;padding:0}@page{size:A4;margin:14mm}}
  </style></head><body>
  <div class="bar"><button onclick="window.print()">Print or save as PDF</button><span>${early}${rows.length} ${rows.length === 1 ? "certificate" : "certificates"} for ${year}. Give each employee their own page and keep a copy. Someone who left during the year gets a P45 from the Leavers page instead.</span></div>
  ${rows.map((r) => p24Page(r, year, company, issued)).join("")}
  </body></html>`;
}

async function p24Open(yearText) {
  const year = Number(yearText);
  const win = window.open("", "_blank");   // opened straight away, so the browser does not block it
  if (!win) { cpBanner("Your browser blocked the P24 window. Allow pop-ups for this site and try again."); return; }
  win.document.write("<p style='font:14px Arial;padding:20px'>Preparing P24 certificates…</p>");

  const runs = cpRuns.filter((r) => p24Iso(r).startsWith(String(year)));
  if (!runs.length) { win.document.body.innerHTML = `<p style='font:14px Arial;padding:20px'>No processed payrolls were paid in ${year}.</p>`; return; }

  const [itemsResult, empResult, profileResult] = await Promise.all([
    supabaseClient.from("payroll_run_items").select("*").in("payroll_run_id", runs.map((r) => r.id)),
    supabaseClient.from("employees").select("id, name, trn, nis_number, employee_number").eq("workspace", CP_WORKSPACE),
    supabaseClient.from("company_profile").select("*").eq("workspace", CP_WORKSPACE).maybeSingle()
  ]);

  let employees = empResult.data;
  if (empResult.error) employees = (await supabaseClient.from("employees").select("id, name, trn, employee_number").eq("workspace", CP_WORKSPACE)).data;
  if (itemsResult.error) { win.document.body.innerHTML = "<p style='font:14px Arial;padding:20px'>The payslip lines could not be loaded. Close this window and try again.</p>"; return; }

  const rows = p24Rows(itemsResult.data || [], employees || [], runs);
  const company = { ...(profileResult.data || {}), fallback: s01CompanyName() };
  const now = new Date();
  const issued = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  win.document.open();
  win.document.write(p24Document(rows, year, company, issued));
  win.document.close();
}

document.addEventListener("click", (event) => {
  const open = event.target.closest && event.target.closest("[data-p24]");
  if (open) p24Open(open.getAttribute("data-p24"));
});
