/* ================= PAYROLL: RATES ================= */
const rates = {
  threshold: 1902360,
  payeLower: 25,
  payeHigher: 30,
  payeBand: 6000000,
  nis: 3,
  nisCeiling: 5000000,
  nht: 3,
  edTax: 2.25
};
function renderRates() {
  const rateThreshold = document.getElementById("rateThreshold");

  if (!rateThreshold) {
    return;
  }

  document.getElementById("rateThreshold").value = rates.threshold;
  document.getElementById("ratePayeLower").value = rates.payeLower;
  document.getElementById("ratePayeHigher").value = rates.payeHigher;
  document.getElementById("ratePayeBand").value = rates.payeBand;
  document.getElementById("rateNis").value = rates.nis;
  document.getElementById("rateNisCeiling").value = rates.nisCeiling;
  document.getElementById("rateNht").value = rates.nht;
  document.getElementById("rateEdTax").value = rates.edTax;
}

async function saveRates() {
  rates = {
    threshold:+document.getElementById('rateThreshold').value, payeLower:+document.getElementById('ratePayeLower').value,
    payeHigher:+document.getElementById('ratePayeHigher').value, payeBand:+document.getElementById('ratePayeBand').value,
    nis:+document.getElementById('rateNis').value, nisCeiling:+document.getElementById('rateNisCeiling').value,
    nht:+document.getElementById('rateNht').value, edTax:+document.getElementById('rateEdTax').value
  };
  await persistSettings();
}
function periodsPerYear() {
  const payPeriod =
    typeof company !== "undefined" && company?.payPeriod
      ? company.payPeriod
      : "fortnightly";

  if (payPeriod === "weekly") {
    return 52;
  }

  if (payPeriod === "fortnightly") {
    return 26;
  }

  return 12;
}

function calculatePayslip(gross) {
  const ppy = periodsPerYear();
  const nisCeilingPerPeriod = rates.nisCeiling / ppy;
  const nisableGross = Math.min(gross, nisCeilingPerPeriod);
  const nis = nisableGross * (rates.nis / 100);
  const edTax = (gross - nis) * (rates.edTax / 100);
  const nht = gross * (rates.nht / 100);
  const thresholdPerPeriod = rates.threshold / ppy;
  const chargeable = Math.max(0, gross - nis - thresholdPerPeriod);
  const bandPerPeriod = rates.payeBand / ppy;
  let paye;
  if (chargeable <= bandPerPeriod) paye = chargeable * (rates.payeLower / 100);
  else paye = bandPerPeriod * (rates.payeLower / 100) + (chargeable - bandPerPeriod) * (rates.payeHigher / 100);
  const totalDeductions = nis + edTax + nht + paye;
  return { gross, nis, edTax, nht, paye, totalDeductions, net: gross - totalDeductions };
}

function viewPayslip(id) {
  document.getElementById('payslipArea').innerHTML = buildPayslipHTML(id, 'payslipArea');
}
function buildPayslipHTML(id, targetAreaId) {
  const emp = employees.find(e => e.id === id);
  const calc = calculatePayslip(+emp.gross);
  const today = new Date().toLocaleDateString('en-JM', { year:'numeric', month:'long', day:'numeric' });
  return `
    <div class="card">
      <div class="payslip-header">
        <div>
          ${company.logo ? `<img src="${company.logo}" style="max-height:50px; max-width:160px; margin-bottom:8px; display:block">` : ''}
          <h2>${company.name || 'Your Company'}</h2>
          <div class="muted">${company.address || ''}</div>
          <div class="muted">${[company.phone, company.email].filter(Boolean).join(' · ')}</div>
        </div>
        <div style="text-align:right"><div><strong>Payslip</strong></div><div class="muted">Date issued: ${today}</div><div class="muted">Pay period: ${company.payPeriod}</div></div>
      </div>
      <div class="grid">
        <div><span class="muted">Employee</span><br><strong>${emp.name}</strong></div>
        <div><span class="muted">Title</span><br>${emp.title || '—'}</div>
        <div><span class="muted">TRN</span><br>${emp.trn || '—'}</div>
      </div>
      <div class="section-title">Earnings</div>
      <div class="line"><span>Gross pay</span><span>$${calc.gross.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
      <div class="section-title">Statutory deductions</div>
      <div class="line"><span>NIS (${rates.nis}%)</span><span>-$${calc.nis.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
      <div class="line"><span>NHT (${rates.nht}%)</span><span>-$${calc.nht.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
      <div class="line"><span>Education Tax (${rates.edTax}%)</span><span>-$${calc.edTax.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
      <div class="line"><span>PAYE (income tax)</span><span>-$${calc.paye.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
      <div class="line total"><span>Net pay</span><span>$${calc.net.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
      <div class="no-print" style="margin-top:20px">
        <button onclick="downloadPdf('${targetAreaId}', 'Payslip-${emp.name.replace(/\s+/g,'-')}.pdf')">Download as PDF</button>
        <button class="secondary" onclick="printSection('${targetAreaId}')">Print</button>
      </div>
    </div>`;
}
function renderPayslipEmployeeOptions() {
  const select = document.getElementById('payslipEmployeeSelect');
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  if (employees.some(e => e.id === currentValue)) select.value = currentValue;
}
function generatePayslipFromTab() {
  const id = document.getElementById('payslipEmployeeSelect').value;
  if (!id) { alert('Add an employee in the Payroll tab first.'); return; }
  document.getElementById('payslipTabArea').innerHTML = buildPayslipHTML(id, 'payslipTabArea');
}
async function loadPayrollDashboard() {
  const tableBody = document.getElementById("payrollEmployeeTableBody");

  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = `
    <tr>
      <td colspan="9">Loading payroll employees...</td>
    </tr>
  `;

  const { data: employees, error } = await supabaseClient
    .from("employees")
    .select("*")
    .eq("workspace", "kairox-exchange")
    .neq("employment_status", "archived");
    

  if (error) {
    console.error("Could not load payroll employees:", error);

    tableBody.innerHTML = `
      <tr>
        <td colspan="9">
          Payroll employees could not be loaded.
        </td>
      </tr>
    `;

    return;
  }

  const payrollRows = (employees || []).map((employee) => {
    const grossPay = Number(employee.gross || 0);
    const calculatedPay = calculatePayslip(grossPay);

    return {
      employee,
      grossPay,
      paye: Number(calculatedPay.paye || 0),
      nis: Number(calculatedPay.nis || 0),
      nht: Number(calculatedPay.nht || 0),
      educationTax: Number(calculatedPay.edTax || 0),
      netPay: Number(calculatedPay.net || 0)
    };
  });

  renderPayrollSummary(payrollRows);
  renderPayrollEmployeeTable(payrollRows);
  enablePayrollEmployeeSearch(payrollRows);
}

function renderPayrollSummary(payrollRows) {
  const employeeCount = payrollRows.length;

  const grossTotal = payrollRows.reduce(
    (total, row) => total + row.grossPay,
    0
  );

  const deductionTotal = payrollRows.reduce(
    (total, row) =>
      total +
      row.paye +
      row.nis +
      row.nht +
      row.educationTax,
    0
  );

  const netTotal = payrollRows.reduce(
    (total, row) => total + row.netPay,
    0
  );

  setPayrollText("payrollEmployeeCount", employeeCount);
  setPayrollText("payrollGrossTotal", formatPayrollCurrency(grossTotal));
  setPayrollText(
    "payrollDeductionTotal",
    formatPayrollCurrency(deductionTotal)
  );
  setPayrollText("payrollNetTotal", formatPayrollCurrency(netTotal));
}

function renderPayrollEmployeeTable(payrollRows) {
  const tableBody = document.getElementById("payrollEmployeeTableBody");

  if (!tableBody) {
    return;
  }

  if (payrollRows.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="9">No employees are available for payroll.</td>
      </tr>
    `;

    return;
  }

  tableBody.innerHTML = payrollRows
    .map(
  ({
    employee,
    grossPay,
    paye,
    nis,
    nht,
    educationTax,
    netPay
  }) => {
      const employeeName =
        employee.full_name ||
employee.name ||
        `${employee.first_name || ""} ${employee.last_name || ""}`.trim() ||
        "Unnamed Employee";

      const department = employee.department || "Not assigned";

      return `
        <tr>
          <td>
            <strong>${escapePayrollHtml(employeeName)}</strong>
          </td>

          <td>${escapePayrollHtml(department)}</td>

          <td>${formatPayrollCurrency(grossPay)}</td>

          <td>${formatPayrollCurrency(paye)}</td>

          <td>${formatPayrollCurrency(nis)}</td>

          <td>${formatPayrollCurrency(nht)}</td>

<td>${formatPayrollCurrency(educationTax)}</td>

<td>
  <strong>${formatPayrollCurrency(netPay)}</strong>
</td>

          <td>
            <span class="payroll-row-status">
              Ready
            </span>
          </td>

          <td>
            <a
              class="payroll-view-link"
              href="employee-profile.html?id=${encodeURIComponent(employee.id)}"
            >
              View
            </a>
          </td>
        </tr>
      `;
    })
    .join("");
}

function enablePayrollEmployeeSearch(payrollRows) {
  const searchInput = document.getElementById("payrollEmployeeSearch");

  if (!searchInput) {
    return;
  }

  searchInput.addEventListener("input", () => {
    const searchTerm = searchInput.value.trim().toLowerCase();

    const filteredRows = payrollRows.filter(({ employee }) => {
      const employeeName =
        employee.full_name ||
employee.name ||
        `${employee.first_name || ""} ${employee.last_name || ""}`;

      const searchableText = [
        employeeName,
        employee.department,
        employee.job_title
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(searchTerm);
    });

    renderPayrollEmployeeTable(filteredRows);
  });
}

function setPayrollText(elementId, value) {
  const element = document.getElementById(elementId);

  if (element) {
    element.textContent = value;
  }
}

function formatPayrollCurrency(value) {
  return new Intl.NumberFormat("en-JM", {
    style: "currency",
    currency: "JMD",
    minimumFractionDigits: 2
  }).format(Number(value || 0));
}

function escapePayrollHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener("DOMContentLoaded", loadPayrollDashboard);
async function runPayroll() {
  const confirmed = window.confirm(
    "Process payroll for this pay period?"
  );

  if (!confirmed) {
    return;
  }

  const statusBadge = document.getElementById("payrollStatus");
  const runButton = document.getElementById("runPayrollBtn");

  if (runButton) {
    runButton.disabled = true;
    runButton.textContent = "Processing...";
  }

  if (statusBadge) {
    statusBadge.textContent = "Processed";
    statusBadge.className =
      "payroll-status payroll-status-processed";
  }

  await loadPayrollDashboard();

  if (runButton) {
    runButton.disabled = false;
    runButton.textContent = "Run Payroll";
  }

  window.alert("Payroll processed successfully.");
}