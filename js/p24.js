// P24: each employee's certificate of pay and tax deducted for the year. Opens a printable page (one certificate per page),
// which can be printed or saved as PDF from the browser's print dialog.
// Laid out like TAJ's printed P24 ("Certificate of pay and tax deducted"): lines 1 to 6 and "Total taxable pay and tax thereon",
// with an ORIGINAL (for the employee's return) and a DUPLICATE (for the employee to keep) for each person.
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
      nis_number: String(e.nis_number || "").trim(), employee_number: e.employee_number || "", title: e.title || "",
      gross: 0, allowance: 0, pension: 0, nis: 0, nht: 0, edTax: 0, paye: 0, net: 0, payslips: 0, first: date, last: date
    };
    row.gross += s01Num(item.gross_pay);
    row.allowance += s01Num(item.taxable_allowance);
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
    ["gross", "allowance", "pension", "nis", "nht", "edTax", "paye", "net"].forEach((k) => { out[k] = s01R(r[k]); });
    out.basic = s01R(out.gross - out.allowance);                            // line 2: pay other than taxable allowances
    out.taxable = s01R(Math.max(0, out.gross - out.nis - out.pension));   // total taxable pay: gross less NIS and approved pension
    return out;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function p24Date(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(y, m - 1, d));
}

// Money split into dollars and cents columns, as on the printed form.
function p24Split(v) {
  const n = Math.round(Number(v || 0) * 100);
  const neg = n < 0;
  const abs = Math.abs(n);
  return { d: `${neg ? "-" : ""}$${Math.floor(abs / 100).toLocaleString("en-US")}`, c: String(abs % 100).padStart(2, "0") };
}

function p24Page(row, year, company, issued, copy) {
  const c = company || {};
  const e = (v) => cpEsc(v == null ? "" : String(v));
  const amt = (v, blank) => {
    if (blank) return '<td class="d"></td><td class="c"></td>';
    const x = p24Split(v);
    return `<td class="d">${x.d}</td><td class="c">${x.c}</td>`;
  };
  const line = (num, label, pay, tax, opts = {}) => `<tr${opts.cls ? ` class="${opts.cls}"` : ""}>
      <td class="n">${num || ""}</td><td class="l">${label}</td><td class="mini"></td><td class="mini-c"></td>
      ${amt(pay, opts.blankPay)}${amt(tax, opts.blankTax)}</tr>`;
  const sub = (label, pay) => `<tr class="sub"><td class="n"></td><td class="l">${label}</td><td class="mini"></td><td class="mini-c"></td>${amt(pay)}<td class="d"></td><td class="c"></td></tr>`;
  const ded = (label, v) => { const x = p24Split(v); return `<tr class="sub"><td class="n"></td><td class="l">${label}</td><td class="mini">${x.d}</td><td class="mini-c">${x.c}</td><td class="d"></td><td class="c"></td><td class="d"></td><td class="c"></td></tr>`; };
  const empName = c.company_name || company.fallback || "";

  return `<section class="cert">
    <div class="top">
      <div>
        <p class="big">INCOME TAX YEAR: ${year}</p>
        <p class="it">CERTIFICATE OF PAY<br>AND TAX DEDUCTED Y/E 31.12.${year}</p>
        <p>EMPLOYEE'S FULL NAME: <u>${e(String(row.name).toUpperCase())}</u></p>
        <p>DETERMINED RATE $: ________ &nbsp;&nbsp; REFERENCE NO: <u>${e(row.employee_number || "")}</u> <span class="small">(if any)</span></p>
      </div>
      <div class="right">
        <p class="copy">${copy}</p>
        <p class="big">TRN: <u>${e(s01Trn(row.trn)) || "&nbsp;".repeat(14)}</u></p>
        <p>OCCUPATION: ${e(String(row.title || "").toUpperCase())}</p>
        <p>NIS NO: ${e(row.nis_number) || "—"}</p>
      </div>
    </div>
    <table>
      <thead>
        <tr><th colspan="4"></th><th colspan="2">PAY</th><th colspan="2">TAX DEDUCTED</th></tr>
        <tr class="units"><th colspan="4"></th><th>$</th><th>c</th><th>$</th><th>c</th></tr>
      </thead>
      <tbody>
        ${line("1", "<strong>Previous Employment</strong><br>Pay and Tax in respect of previous employment(s) taken into account in arriving at the tax deductions made by me/us", 0, 0)}
        ${line("2", "<strong>This Employment</strong><br>Basic Pay in my/our employment", row.basic, row.paye)}
        ${line("3", "<strong>Allowance Paid</strong>", 0, 0, { blankPay: true, blankTax: true })}
        ${sub("(a) House", 0)}${sub("(b) Entertainment", 0)}${sub("(c) Utilities", 0)}${sub("(d) Travelling", 0)}${sub("(e) Other", row.allowance)}
        ${line("4", "<strong>Benefits in kind</strong>", 0, 0, { blankPay: true, blankTax: true })}
        ${sub("(a) House", 0)}${sub("(b) Motor Car", 0)}${sub("(c) Other", 0)}
        ${line("5", "<strong>Totals 2-4</strong>", row.gross, 0, { blankTax: true, cls: "tot" })}
        ${line("6", "<strong>Deductions in This Employment</strong>", 0, 0, { blankPay: true, blankTax: true })}
        ${ded("(a) NIS", row.nis)}${ded("(b) Superannuation", row.pension)}${ded("(c) Agreed Expenses", 0)}
        <tr class="grand"><td colspan="4"><strong>Total Taxable Pay and Tax Thereon</strong></td>${amt(row.taxable)}${amt(row.paye)}</tr>
      </tbody>
    </table>
    <p class="cert-text">I/We certify that the particulars given above include the total amount of pay (including overtime, bonus,
      commission, etc.) paid to you by me/us (less any refunds) in that year.</p>
    <div class="sign">
      <div><span></span>Signature</div>
      <div><span>${e(empName)}</span>Employer</div>
      <div><span>${e(p24Date(issued))}</span>Date</div>
    </div>
    <p class="foot">TO THE EMPLOYEE: Please keep the duplicate of this form.</p>
    <p class="foot"><strong>P24</strong> &nbsp;&nbsp; <strong>Attach Original to Return</strong></p>
    <p class="note">Paid from ${e(p24Date(row.first))} to ${e(p24Date(row.last))} (${row.payslips} ${row.payslips === 1 ? "payslip" : "payslips"}).
      For your records: NHT deducted ${e(p24Split(row.nht).d)}.${e(p24Split(row.nht).c)}, Education Tax deducted ${e(p24Split(row.edTax).d)}.${e(p24Split(row.edTax).c)}.</p>
  </section>`;
}

function p24Document(rows, year, company, issued) {
  const early = Number(String(issued).slice(0, 4)) <= year
    ? `<strong>${year} is not over yet:</strong> these figures cover payrolls processed so far. Print the final certificates after the last payroll of the year. `
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>P24 certificates ${year}</title><style>
    *{box-sizing:border-box} body{margin:0;font:12.5px/1.35 Arial,Helvetica,sans-serif;color:#000;background:#e9e9e9}
    .bar{position:sticky;top:0;background:#24123f;color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;z-index:2}
    .bar button{font:inherit;font-weight:700;padding:7px 14px;border:0;border-radius:6px;cursor:pointer}
    .cert{background:#fff;width:8.5in;min-height:11in;margin:12px auto;padding:0.55in 0.6in;page-break-after:always}
    .top{display:flex;justify-content:space-between;gap:20px;margin-bottom:12px} .top p{margin:3px 0} .right{text-align:left;min-width:2.6in}
    .big{font-weight:700;font-size:14px} .it{font-style:italic} .copy{font-weight:700;font-size:15px;text-align:right;letter-spacing:.05em}
    .small{font-size:10px}
    table{width:100%;border-collapse:collapse;border:1.5px solid #000}
    th,td{border:1px solid #000;padding:3px 5px;vertical-align:top}
    thead th{text-align:center;font-weight:700} tr.units th{font-weight:400;font-size:11px}
    td.n{width:22px;font-weight:700;border-right:0} td.l{border-left:0} td.d{width:1.15in;text-align:right;border-right:0} td.c{width:0.35in;text-align:right;border-left:0}
    td.mini{width:0.85in;text-align:right;border-right:0} td.mini-c{width:0.3in;border-left:0}
    tr.sub td{border-top:0;border-bottom:0;padding-top:1px;padding-bottom:1px} tr.sub td.l{padding-left:16px}
    tr.tot td,tr.grand td{font-weight:700} tr.grand td{border-top:2px solid #000}
    .cert-text{margin:10px 0 26px} .sign{display:grid;grid-template-columns:1.3fr 1.2fr 0.9fr;gap:18px;margin-bottom:14px}
    .sign div{font-size:11px;text-align:center} .sign span{display:block;border-bottom:1px solid #000;min-height:22px;margin-bottom:3px;font-size:12.5px}
    .foot{margin:3px 0} .note{margin-top:14px;font-size:10.5px;color:#444;border-top:1px dashed #999;padding-top:6px}
    @media print{body{background:#fff}.bar{display:none}.cert{margin:0;width:auto;min-height:0;padding:0}@page{size:letter;margin:0.55in}}
  </style></head><body>
  <div class="bar"><button onclick="window.print()">Print or save as PDF</button><span>${early}${rows.length} ${rows.length === 1 ? "employee" : "employees"} for ${year}, each with an ORIGINAL and a DUPLICATE. Sign both; the employee attaches the original to their return and keeps the duplicate. Someone who left during the year gets a P45 from the Leavers page instead.</span></div>
  ${rows.map((r) => p24Page(r, year, company, issued, "ORIGINAL") + p24Page(r, year, company, issued, "DUPLICATE")).join("")}
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
    supabaseClient.from("employees").select("id, name, trn, nis_number, employee_number, title").eq("workspace", CP_WORKSPACE),
    supabaseClient.from("company_profile").select("*").eq("workspace", CP_WORKSPACE).maybeSingle()
  ]);

  let employees = empResult.data;
  if (empResult.error) employees = (await supabaseClient.from("employees").select("id, name, trn, employee_number, title").eq("workspace", CP_WORKSPACE)).data;
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