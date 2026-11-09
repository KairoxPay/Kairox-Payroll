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

function escapeReportHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setReportText(elementId, value) {
  const element = document.getElementById(elementId);

  if (element) {
    element.textContent = value;
  }
}

function formatReportCurrency(value) {
  return new Intl.NumberFormat("en-JM", {
    style: "currency",
    currency: "JMD",
    currencyDisplay: "code",
    minimumFractionDigits: 2
  }).format(Number(value || 0));
}

let reportRunsCache = [];

function injectReportRunSelector() {
  if (document.getElementById("reportRunSelector")) {
    return;
  }

  const wrap = document.createElement("div");
  wrap.id = "reportRunSelector";
  wrap.style.cssText =
    "display:flex;align-items:center;justify-content:flex-end;gap:12px;margin:0 0 18px;";
  wrap.innerHTML = `
    <label for="reportRunSelect" style="color:#5f6274;font-size:.82rem;font-weight:700">Payroll period</label>
    <select id="reportRunSelect" style="min-width:290px;min-height:42px;padding:0 14px;border:1px solid #dedee8;border-radius:10px;background:#fff;font:inherit;font-weight:700"></select>
  `;

  const host =
    document.querySelector(".reports-summary-grid") ||
    document.querySelector(".reports-main") ||
    document.body;

  if (host.classList && host.classList.contains("reports-summary-grid")) {
    host.insertAdjacentElement("beforebegin", wrap);
  } else {
    host.insertBefore(wrap, host.firstChild);
  }

  wrap.querySelector("select").addEventListener("change", (event) => {
    localStorage.setItem("kairoxReportRunId", event.target.value);
    loadReportsDashboard();
  });
}

// Reports are built from SAVED, PROCESSED payroll runs, never from today's salaries.
async function loadSelectedReportRun() {
  const { data, error } = await supabaseClient
    .from("payroll_runs")
    .select("*")
    .eq("workspace", kairoxWorkspaceId())
    .eq("status", "processed")
    .order("period_start", { ascending: false });

  if (error) {
    console.error("Could not load payroll runs for reports:", error);
    return null;
  }

  reportRunsCache = data || [];
  injectReportRunSelector();

  const wanted =
    new URLSearchParams(window.location.search).get("run") ||
    localStorage.getItem("kairoxReportRunId");

  const chosen =
    reportRunsCache.find((run) => run.id === wanted) ||
    reportRunsCache[0] ||
    null;

  const select = document.getElementById("reportRunSelect");

  if (select) {
    select.innerHTML = reportRunsCache.length
      ? reportRunsCache
          .map(
            (run) =>
              `<option value="${escapeReportHtml(run.id)}">${escapeReportHtml(
                formatReportDate(run.period_start)
              )} – ${escapeReportHtml(formatReportDate(run.period_end))}</option>`
          )
          .join("")
      : "<option value=''>No processed payroll yet</option>";

    if (chosen) {
      select.value = chosen.id;
    }
  }

  return chosen;
}

function formatReportDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function renderRemittanceCard(run, items) {
  document.getElementById("statutoryRemittanceSection")?.remove();

  if (!run || typeof statutoryRemittance !== "function") {
    return;
  }

  const rem = statutoryRemittance(items);
  const money = formatReportCurrency;

  const section = document.createElement("section");
  section.id = "statutoryRemittanceSection";
  section.className = "report-detail-card";
  section.innerHTML = `
    <div class="report-detail-header">
      <div>
        <span class="reports-eyebrow">STATUTORY REMITTANCE (S01)</span>
        <h2>Amount to remit to TAJ</h2>
        <p>
          Due by ${escapeReportHtml(remittanceDueText(run.pay_date || run.period_end))}.
          If that is a weekend or holiday, confirm the date with TAJ.
          ${rem.legacy ? "Employer shares were not recorded for some lines of this run." : ""}
        </p>
      </div>
      <div class="report-detail-actions">
        <button type="button" data-remittance-print>Print</button>
        <button type="button" data-remittance-export>Export CSV</button>
      </div>
    </div>
    <div class="report-table-wrap">
      <table class="report-table">
        <thead>
          <tr><th>Item</th><th>Employee</th><th>Employer</th><th>Total</th></tr>
        </thead>
        <tbody>
          <tr><td>PAYE</td><td>${money(rem.paye)}</td><td>—</td><td>${money(rem.paye)}</td></tr>
          <tr><td>NIS</td><td>${money(rem.nis.employee)}</td><td>${money(rem.nis.employer)}</td><td>${money(rem.nis.employee + rem.nis.employer)}</td></tr>
          <tr><td>NHT</td><td>${money(rem.nht.employee)}</td><td>${money(rem.nht.employer)}</td><td>${money(rem.nht.employee + rem.nht.employer)}</td></tr>
          <tr><td>Education Tax</td><td>${money(rem.edTax.employee)}</td><td>${money(rem.edTax.employer)}</td><td>${money(rem.edTax.employee + rem.edTax.employer)}</td></tr>
          <tr><td>HEART/NSTA Trust</td><td>—</td><td>${money(rem.heart)}</td><td>${money(rem.heart)}</td></tr>
        </tbody>
        <tfoot>
          <tr><th>Total to remit</th><th></th><th></th><th>${money(rem.total)}</th></tr>
        </tfoot>
      </table>
    </div>
  `;

  const anchor =
    document.querySelector(".reports-summary-grid") ||
    document.querySelector(".reports-main") ||
    document.body;

  if (anchor.classList && anchor.classList.contains("reports-summary-grid")) {
    anchor.insertAdjacentElement("afterend", section);
  } else {
    anchor.appendChild(section);
  }

  section
    .querySelector("[data-remittance-print]")
    .addEventListener("click", () => window.print());

  section
    .querySelector("[data-remittance-export]")
    .addEventListener("click", () =>
      exportReportTable("statutoryRemittanceSection", "Kairox_Pay_Statutory_Remittance.csv")
    );
}

async function loadReportsDashboard() {
  const run = await loadSelectedReportRun();

  let items = [];

  if (run) {
    const { data, error } = await supabaseClient
      .from("payroll_run_items")
      .select("*")
      .eq("payroll_run_id", run.id)
      .order("employee_name", { ascending: true });

    if (error) {
      console.error("Could not load report data:", error);
      return;
    }

    items = data || [];
  }

  const amount = (value) => Number(value || 0);

  const payrollRows = items.map((item) => ({
    employeeName: item.employee_name || "Unnamed Employee",
    department: item.department || "—",
    grossPay: amount(item.gross_pay),
    paye: amount(item.paye),
    nis: amount(item.nis),
    nht: amount(item.nht),
    educationTax: amount(item.education_tax),
    totalDeductions: amount(item.total_deductions),
    netPay: amount(item.net_pay)
  }));

  setReportText(
    "reportsPayPeriod",
    run
      ? `${formatReportDate(run.period_start)} – ${formatReportDate(run.period_end)}`
      : "No processed payroll yet"
  );

  renderRemittanceCard(run, items);

const payrollRegisterBody = document.getElementById("payrollRegisterBody");

if (payrollRegisterBody) {
  payrollRegisterBody.innerHTML = payrollRows.length
    ? payrollRows
        .map(
          (row) => `
            <tr>
              <td><strong>${escapeReportHtml(row.employeeName)}</strong></td>
              <td>${escapeReportHtml(row.department)}</td>
              <td>${formatReportCurrency(row.grossPay)}</td>
              <td>${formatReportCurrency(row.paye)}</td>
              <td>${formatReportCurrency(row.nis)}</td>
              <td>${formatReportCurrency(row.nht)}</td>
              <td>${formatReportCurrency(row.educationTax)}</td>
              <td><strong>${formatReportCurrency(row.netPay)}</strong></td>
            </tr>
          `
        )
        .join("")
    : `
      <tr>
        <td colspan="8" style="text-align:center;padding:24px;">
          No payroll data found.
        </td>
      </tr>
    `;
}

const grossTotal = payrollRows.reduce(
  (total, row) => total + row.grossPay,
  0
);

const deductionTotal = payrollRows.reduce(
  (total, row) =>
    total +
    row.totalDeductions,
  0
);

const netTotal = payrollRows.reduce(
  (total, row) => total + row.netPay,
  0
);


  setReportText(
    "reportsGrossPayroll",
    formatReportCurrency(grossTotal)
  );

  setReportText(
    "reportsTotalDeductions",
    formatReportCurrency(deductionTotal)
  );

  setReportText(
    "reportsNetPayroll",
    formatReportCurrency(netTotal)
  );

  setReportText(
    "reportsEmployeeCount",
    payrollRows.length
  );
  const payeReportBody =
  document.getElementById("payeReportBody");

const payeReportTotal =
  document.getElementById("payeReportTotal");

if (payeReportBody) {
  payeReportBody.innerHTML = payrollRows.length
    ? payrollRows
        .map(
          (row) => `
            <tr>
              <td><strong>${escapeReportHtml(row.employeeName)}</strong></td>
              <td>${formatReportCurrency(row.grossPay)}</td>
              <td>${formatReportCurrency(row.paye)}</td>
            </tr>
          `
        )
        .join("")
    : `
      <tr>
        <td colspan="3">
          No PAYE data found.
        </td>
      </tr>
    `;
}
const totalPaye = payrollRows.reduce(
  (total, row) => total + row.paye,
  0
);

if (payeReportTotal) {
  payeReportTotal.textContent =
    formatReportCurrency(totalPaye);
}
const nisReportBody =
  document.getElementById("nisReportBody");

const nisReportTotal =
  document.getElementById("nisReportTotal");

if (nisReportBody) {
  nisReportBody.innerHTML = payrollRows.length
    ? payrollRows
        .map(
          (row) => `
            <tr>
              <td><strong>${escapeReportHtml(row.employeeName)}</strong></td>
              <td>${formatReportCurrency(row.grossPay)}</td>
              <td>${formatReportCurrency(row.nis)}</td>
            </tr>
          `
        )
        .join("")
    : `
      <tr>
        <td colspan="3">
          No NIS data found.
        </td>
      </tr>
    `;
}

const totalNis = payrollRows.reduce(
  (total, row) => total + row.nis,
  0
);

if (nisReportTotal) {
  nisReportTotal.textContent =
    formatReportCurrency(totalNis);
}

const nhtReportBody =
  document.getElementById("nhtReportBody");

const nhtReportTotal =
  document.getElementById("nhtReportTotal");

if (nhtReportBody) {
  nhtReportBody.innerHTML = payrollRows.length
    ? payrollRows
        .map(
          (row) => `
            <tr>
              <td><strong>${escapeReportHtml(row.employeeName)}</strong></td>
              <td>${formatReportCurrency(row.grossPay)}</td>
              <td>${formatReportCurrency(row.nht)}</td>
            </tr>
          `
        )
        .join("")
    : `
      <tr>
        <td colspan="3">No NHT data found.</td>
      </tr>
    `;
}

const totalNht = payrollRows.reduce(
  (total, row) => total + row.nht,
  0
);

if (nhtReportTotal) {
  nhtReportTotal.textContent =
    formatReportCurrency(totalNht);
}
const educationTaxReportBody =
  document.getElementById("educationTaxReportBody");

const educationTaxReportTotal =
  document.getElementById("educationTaxReportTotal");

if (educationTaxReportBody) {
  educationTaxReportBody.innerHTML = payrollRows.length
    ? payrollRows
        .map(
          (row) => `
            <tr>
              <td><strong>${escapeReportHtml(row.employeeName)}</strong></td>
              <td>${formatReportCurrency(row.grossPay)}</td>
              <td>${formatReportCurrency(row.educationTax)}</td>
            </tr>
          `
        )
        .join("")
    : `
      <tr>
        <td colspan="3">
          No Education Tax data found.
        </td>
      </tr>
    `;
}

const totalEducationTax = payrollRows.reduce(
  (total, row) => total + row.educationTax,
  0
);

if (educationTaxReportTotal) {
  educationTaxReportTotal.textContent =
    formatReportCurrency(totalEducationTax);
}
const employeeCostReportBody =
  document.getElementById("employeeCostReportBody");

const employeeCostGrossTotal =
  document.getElementById("employeeCostGrossTotal");

const employeeCostDeductionTotal =
  document.getElementById("employeeCostDeductionTotal");

const employeeCostNetTotal =
  document.getElementById("employeeCostNetTotal");

if (employeeCostReportBody) {
  employeeCostReportBody.innerHTML = payrollRows.length
    ? payrollRows
        .map((row) => {
          const totalDeductions = row.totalDeductions;

          return `
            <tr>
              <td><strong>${escapeReportHtml(row.employeeName)}</strong></td>
              <td>${formatReportCurrency(row.grossPay)}</td>
              <td>${formatReportCurrency(totalDeductions)}</td>
              <td><strong>${formatReportCurrency(row.netPay)}</strong></td>
            </tr>
          `;
        })
        .join("")
    : `
      <tr>
        <td colspan="4">
          No employee cost data found.
        </td>
      </tr>
    `;
}

if (employeeCostGrossTotal) {
  employeeCostGrossTotal.textContent =
    formatReportCurrency(grossTotal);
}

if (employeeCostDeductionTotal) {
  employeeCostDeductionTotal.textContent =
    formatReportCurrency(deductionTotal);
}

if (employeeCostNetTotal) {
  employeeCostNetTotal.textContent =
    formatReportCurrency(netTotal);
}
}

  if (window.lucide) {
    lucide.createIcons();
  }

function showPayeReport() {
  const section =
    document.getElementById("payeReportSection");

  if (!section) {
    return;
  }

  section.style.display = "block";

  section.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function showNisReport() {
  const section =
    document.getElementById("nisReportSection");

  if (!section) {
    return;
  }

  section.style.display = "block";

  section.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function showNhtReport() {
  const section =
    document.getElementById("nhtReportSection");

  if (!section) {
    return;
  }

  section.style.display = "block";

  section.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

}
function showEmployeeCostReport() {
  const section =
    document.getElementById("employeeCostReportSection");

  if (!section) {
    return;
  }

  section.style.display = "block";

  section.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function exportPayrollReport() {
  const table = document.querySelector(
    "#payrollRegisterSection .report-table"
  );

  if (!table) {
    alert("Payroll report is not available.");
    return;
  }

  const rows = Array.from(
    table.querySelectorAll("tr")
  );

  const csv = rows
    .map((row) => {
      const cells = Array.from(
        row.querySelectorAll("th, td")
      );

      return cells
        .map((cell) => {
          const text = cell.textContent
            .trim()
            .replace(/"/g, '""');

          return `"${text}"`;
        })
        .join(",");
    })
    .join("\n");

  const blob = new Blob(
    [csv],
    {
      type: "text/csv;charset=utf-8;"
    }
  );

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.download =
    "Kairox_Pay_Payroll_Register.csv";

  document.body.appendChild(link);

  link.click();

  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
function exportReportTable(sectionId, filename) {
  const section = document.getElementById(sectionId);

  if (!section) {
    alert("Report section not found.");
    return;
  }

  const table = section.querySelector("table");

  if (!table) {
    alert("No report table found.");
    return;
  }

  const rows = Array.from(table.querySelectorAll("tr"));

  const csv = rows.map(row => {
    const cells = Array.from(row.querySelectorAll("th, td"));

    return cells.map(cell => {
      const text = cell.innerText.replace(/"/g, '""');
      return `"${text}"`;
    }).join(",");
  }).join("\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

function loadReportsPayPeriod() {
  const savedPeriod =
    localStorage.getItem("kairoxPayrollPeriod");

  if (!savedPeriod) {
    return;
  }

  const periodDisplay =
    document.getElementById("reportsPayPeriod");

  if (periodDisplay) {
    periodDisplay.textContent = savedPeriod;
  }
}

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    await kairoxEnsureTopbar();

    if (window.KairoxCompany) {
      await window.KairoxCompany.ready();

      // Company name above the report, when the page has a place for it (it prints with the report).
      const heading = document.getElementById("reportsCompanyName");
      if (heading) {
        heading.textContent = window.KairoxCompany.companyHeading();
      }

      const logo = document.getElementById("reportsLogo");
      const logoUrl = typeof window.KairoxCompany.logo === "function" ? window.KairoxCompany.logo() : null;
      if (logo && logoUrl) {
        logo.src = logoUrl;
        logo.hidden = false;
      }
    }

    loadReportsDashboard();
  }
);

function showEducationTaxReport() {
  const section = document.getElementById(
    "educationTaxReportSection"
  );

  if (section) {
    section.style.display = "block";
    section.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}
function showEmployeeCostReport() {
  const section =
    document.getElementById("employeeCostReportSection");

  if (!section) {
    return;
  }

  section.style.display = "block";

  section.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}