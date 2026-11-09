/* =====================================================
   PAYROLL ENGINE: the single source of truth for every
   statutory calculation (payroll page, payslips, reports).
   Do not copy these formulas anywhere else.
===================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PayrollEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  var PERIODS = { weekly: 52, fortnightly: 26, monthly: 12 };

  var DEFAULT_RATES = {
    threshold: 1902360,
    payeLower: 25, payeHigher: 30, payeBand: 6000000,
    nis: 3, nisCeiling: 5000000,
    nht: 2, edTax: 2.25,
    erNis: 3, erNht: 3, erEdTax: 3.5, erHeart: 3
  };

  function num(n) { var v = Number(n); return isFinite(v) ? v : 0; }
  function round2(n) {
    return Math.round((num(n) + Number.EPSILON) * 100) / 100;
  }

  function periodsPerYear(period) {
    var p = PERIODS[period];
    if (!p) throw new Error('Unknown pay period: ' + period);
    return p;
  }

  // Prorated basic pay: basic * (daysPaid / daysInPeriod)
  function prorate(basic, daysInPeriod, unpaidDays) {
    var d = num(daysInPeriod), u = num(unpaidDays);
    if (d <= 0 || u <= 0) return round2(basic);
    if (u > d) u = d;
    return round2(num(basic) * ((d - u) / d));
  }

  /*
    Order of calculation (statutory sequence):
      1. NIS on gross emoluments, capped at the ceiling for the period
      2. Statutory income = gross emoluments - NIS - approved pension
      3. Education Tax on statutory income
      4. NHT on gross emoluments
      5. PAYE on (statutory income - period threshold), 25% up to the band, 30% above
    Non-taxable (exempt) allowances are paid to the employee but excluded from steps 1-5.
    Post-tax deductions (loans, voluntary) come off net pay only.
  */
  function calculate(input, ratesIn) {
    var r = Object.assign({}, DEFAULT_RATES, ratesIn || {});
    var ppy = periodsPerYear(input.period || 'monthly');

    var basic = num(input.basic);
    if (input.daysInPeriod && input.unpaidDays) basic = prorate(basic, input.daysInPeriod, input.unpaidDays);
    basic = round2(basic);

    var overtime = round2(input.overtime);
    var bonus = round2(input.bonus);
    var taxableAllowances = round2(input.taxableAllowances);
    var exemptAllowances = round2(input.exemptAllowances);
    var adjustments = round2(input.adjustments); // can be negative (reversal) or positive
    var pension = round2(input.pension);
    var otherDeductions = round2(input.otherDeductions); // loans, voluntary, etc.
    var payeAdjustment = round2(input.payeAdjustment); // manual +/- correction to PAYE (e.g. a TAJ instruction)
    var ex = input.exempt || {};

    var gross = round2(basic + overtime + bonus + taxableAllowances + adjustments);

    var nisBase = Math.min(gross, r.nisCeiling / ppy);
    var nis = ex.nis ? 0 : round2(Math.max(0, nisBase) * r.nis / 100);

    var statutoryIncome = round2(Math.max(0, gross - nis - pension));
    var edTax = ex.edTax ? 0 : round2(statutoryIncome * r.edTax / 100);
    var nht = ex.nht ? 0 : round2(Math.max(0, gross) * r.nht / 100);

    var thresholdPeriod = r.threshold / ppy;
    var bandPeriod = r.payeBand / ppy;
    var chargeable = Math.max(0, statutoryIncome - thresholdPeriod);
    var paye;
    if (chargeable <= bandPeriod) paye = chargeable * r.payeLower / 100;
    else paye = bandPeriod * r.payeLower / 100 + (chargeable - bandPeriod) * r.payeHigher / 100;
    paye = ex.paye ? 0 : Math.max(0, round2(paye + payeAdjustment));

    var statutoryDeductions = round2(nis + edTax + nht + paye);
    var totalDeductions = round2(statutoryDeductions + pension + otherDeductions);
    var net = round2(gross + exemptAllowances - totalDeductions);

    // Employer-side contributions (not deducted from the employee)
    var erNis = round2(Math.max(0, nisBase) * r.erNis / 100);
    var erNht = round2(Math.max(0, gross) * r.erNht / 100);
    var erEdTax = round2(statutoryIncome * r.erEdTax / 100);
    var erHeart = input.heartApplies === false ? 0 : round2(Math.max(0, gross) * r.erHeart / 100);
    var employerTotal = round2(erNis + erNht + erEdTax + erHeart);

    return {
      period: input.period || 'monthly',
      basic: basic, overtime: overtime, bonus: bonus,
      taxableAllowances: taxableAllowances, exemptAllowances: exemptAllowances,
      adjustments: adjustments, gross: gross,
      nis: nis, statutoryIncome: statutoryIncome, edTax: edTax, nht: nht,
      chargeable: round2(chargeable), paye: paye,
      pension: pension, otherDeductions: otherDeductions, payeAdjustment: payeAdjustment,
      statutoryDeductions: statutoryDeductions,
      totalDeductions: totalDeductions, net: net,
      employer: { nis: erNis, nht: erNht, edTax: erEdTax, heart: erHeart, total: employerTotal },
      totalCostToEmployer: round2(gross + exemptAllowances + employerTotal)
    };
  }

  return { calculate: calculate, round2: round2, prorate: prorate, periodsPerYear: periodsPerYear, DEFAULT_RATES: DEFAULT_RATES };
});


/* ================= PAYROLL SETTINGS ================= */
let currentPayrollRows = [];
let currentProcessedPayrollRunId = null;

// Employee-side statutory rates (verify each April at taj.gov.jm).
// NHT: the employee pays 2%; the employer pays a separate 3%.
const rates = {
  threshold: 1902360,
  payeLower: 25,
  payeHigher: 30,
  payeBand: 6000000,
  nis: 3,
  nisCeiling: 5000000,
  nht: 2,
  edTax: 2.25
};

// Employees with these statuses are not paid. "on-leave" is still paid.
const PAYROLL_EXCLUDED_STATUSES = ["archived", "inactive"];

function isPayrollEligible(employee) {
  const status = String(employee.employment_status || "active")
    .trim()
    .toLowerCase();

  return !PAYROLL_EXCLUDED_STATUSES.includes(status);
}

function getPayrollFrequency() {
  const frequency = (
    localStorage.getItem("kairoxPayrollFrequency") ||
    "Fortnightly"
  ).toLowerCase();

  if (!["weekly", "fortnightly", "monthly"].includes(frequency)) {
    throw new Error("Unsupported payroll frequency: " + frequency);
  }

  return frequency;
}

function periodsPerYear() {
  return PayrollEngine.periodsPerYear(getPayrollFrequency());
}

function roundPayrollAmount(amount) {
  return PayrollEngine.round2(amount);
}

// Salaries are stored per MONTH. This converts one to the gross for the
// current pay period (weekly, fortnightly or monthly).
function periodGrossFromMonthly(monthlySalary) {
  const frequency = getPayrollFrequency();
  const monthly = Number(monthlySalary || 0);

  return roundPayrollAmount(
    frequency === "monthly"
      ? monthly
      : (monthly * 12) / PayrollEngine.periodsPerYear(frequency)
  );
}

// gross = gross pay for ONE pay period
function calculatePayslip(gross) {
  const result = PayrollEngine.calculate(
    { period: getPayrollFrequency(), basic: gross },
    rates
  );

  return {
    gross: result.gross,
    nis: result.nis,
    edTax: result.edTax,
    nht: result.nht,
    paye: result.paye,
    totalDeductions: result.statutoryDeductions,
    net: result.net,
    detail: result
  };
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

function formatPayrollDate(dateString) {
  const date =
    new Date(`${dateString}T00:00:00`);

  return new Intl.DateTimeFormat(
    "en-US",
    {
      month: "long",
      day: "numeric",
      year: "numeric"
    }
  ).format(date);
}

function setupPayrollPeriodChanger() {
  const button =
    document.getElementById("changePayrollPeriodBtn");

  const display =
    document.getElementById("payrollPeriodDisplay");

  const modal =
    document.getElementById("payPeriodModal");

  const closeButton =
    document.getElementById("closePayPeriodModalBtn");

  const cancelButton =
    document.getElementById("cancelPayPeriodBtn");

  const saveButton =
    document.getElementById("savePayPeriodBtn");

  const frequencyInput =
    document.getElementById("payFrequency");

  const startInput =
    document.getElementById("payPeriodStart");

  const endInput =
    document.getElementById("payPeriodEnd");

  const payDateInput =
    document.getElementById("payDate");

  if (
    !button ||
    !display ||
    !modal ||
    !saveButton
  ) {
    return;
  }

  function openModal() {
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add(
      "pay-period-modal-open"
    );
  }

  function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove(
      "pay-period-modal-open"
    );
  }

  button.addEventListener(
    "click",
    openModal
  );

  closeButton?.addEventListener(
    "click",
    closeModal
  );

  cancelButton?.addEventListener(
    "click",
    closeModal
  );

  modal
    .querySelector(".pay-period-modal-backdrop")
    ?.addEventListener(
      "click",
      closeModal
    );

  saveButton.addEventListener(
    "click",
    async () => {
      if (
        payrollDirty &&
        !window.confirm(
          "You have unsaved pay items for the current period. Change the period and discard them?"
        )
      ) {
        return;
      }

      const frequency =
        frequencyInput?.value || "Fortnightly";

      const startDate =
        startInput?.value;

      const endDate =
        endInput?.value;

      const payDate =
        payDateInput?.value;

      if (!startDate || !endDate) {
        alert(
          "Please select both the period start and end dates."
        );

        return;
      }

      if (
        new Date(endDate) <
        new Date(startDate)
      ) {
        alert(
          "The period end date cannot be before the start date."
        );

        return;
      }

      if (window.KairoxCompany) {
        const saved = await window.KairoxCompany.savePeriod({
          frequency,
          start: startDate,
          end: endDate,
          payDate
        });

        if (!saved.ok) {
          alert(saved.message);
          return;
        }
      }

      const formattedPeriod =
        `${formatPayrollDate(startDate)} – ` +
        `${formatPayrollDate(endDate)}`;

      display.textContent =
        formattedPeriod;

      localStorage.setItem(
        "kairoxPayrollPeriod",
        formattedPeriod
      );

      localStorage.setItem(
        "kairoxPayrollPeriodStart",
        startDate
      );

      localStorage.setItem(
        "kairoxPayrollPeriodEnd",
        endDate
      );

      localStorage.setItem(
        "kairoxPayrollFrequency",
        frequency
      );

      if (payDate) {
        localStorage.setItem(
          "kairoxPayrollPayDate",
          payDate
        );
      }

      closeModal();
      loadPayrollDashboard();
    }
  );

  const savedPeriod =
    localStorage.getItem(
      "kairoxPayrollPeriod"
    );

  if (savedPeriod) {
    display.textContent =
      savedPeriod;
  }

  if (frequencyInput) {
    frequencyInput.value =
      localStorage.getItem(
        "kairoxPayrollFrequency"
      ) || "Fortnightly";
  }

  if (startInput) {
    startInput.value =
      localStorage.getItem(
        "kairoxPayrollPeriodStart"
      ) || "";
  }

  if (endInput) {
    endInput.value =
      localStorage.getItem(
        "kairoxPayrollPeriodEnd"
      ) || "";
  }

  if (payDateInput) {
    payDateInput.value =
      localStorage.getItem(
        "kairoxPayrollPayDate"
      ) || "";
  }
}

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

/* =====================================================
   PHASE 2: PAY INPUTS, DRAFT > APPROVE > PROCESS > REVERSE,
   HISTORY, RECONCILIATION AND EXCEL EXPORT
===================================================== */
let payrollRole = null;
let payrollWorkflowRun = null; // the live (not reversed) run for the chosen period, or null
let payrollInputs = {};        // employee id -> this run's pay inputs
let payrollDefaults = {};      // employee id -> saved recurring pay items
let payrollDirty = false;      // edits not yet saved to the draft
let payrollBusy = false;
let payrollMissingFromDraft = 0;
let payrollViewedRun = null;
let payrollViewedItems = [];

function payrollNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function defaultWorkingDays(frequency) {
  return { weekly: 5, fortnightly: 10, monthly: 22 }[frequency] || 10;
}

function blankPayrollInputs() {
  return {
    overtime: 0,
    bonus: 0,
    taxableAllowance: 0,
    exemptAllowance: 0,
    adjustment: 0,
    unpaidDays: 0,
    workingDays: defaultWorkingDays(getPayrollFrequency()),
    pension: 0,
    loanDeduction: 0,
    otherDeductions: 0,
    payeAdjustment: 0,
    notes: "",
    exempt: { nis: false, nht: false, edTax: false, paye: false }
  };
}

function normaliseInputs(raw) {
  const inputs = blankPayrollInputs();
  const source = raw || {};

  [
    "overtime", "bonus", "taxableAllowance", "exemptAllowance",
    "adjustment", "unpaidDays", "workingDays", "pension",
    "loanDeduction", "otherDeductions", "payeAdjustment"
  ].forEach((key) => {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      inputs[key] = payrollNumber(source[key]);
    }
  });

  if (!(inputs.workingDays > 0)) {
    inputs.workingDays = defaultWorkingDays(getPayrollFrequency());
  }

  inputs.notes = String(source.notes || "");

  const exempt = source.exempt || {};
  inputs.exempt = {
    nis: !!exempt.nis,
    nht: !!exempt.nht,
    edTax: !!exempt.edTax,
    paye: !!exempt.paye
  };

  return inputs;
}

function inputsFromDefaults(defaults) {
  const inputs = blankPayrollInputs();

  if (!defaults) {
    return inputs;
  }

  inputs.pension = payrollNumber(defaults.pension);
  inputs.taxableAllowance = payrollNumber(defaults.taxable_allowance);
  inputs.exemptAllowance = payrollNumber(defaults.exempt_allowance);
  inputs.loanDeduction = Math.min(
    payrollNumber(defaults.loan_deduction),
    payrollNumber(defaults.loan_balance)
  );
  inputs.exempt = {
    nis: !!defaults.exempt_nis,
    nht: !!defaults.exempt_nht,
    edTax: !!defaults.exempt_edtax,
    paye: !!defaults.exempt_paye
  };

  return inputs;
}

function employeeDisplayName(employee) {
  return (
    employee.full_name ||
    employee.name ||
    `${employee.first_name || ""} ${employee.last_name || ""}`.trim() ||
    "Unnamed Employee"
  );
}

// The one place a payroll row is calculated. employee.gross is the MONTHLY salary.
function calculateEmployeeRow(employee, rawInputs) {
  const inputs = normaliseInputs(rawInputs);
  const frequency = getPayrollFrequency();
  const round = PayrollEngine.round2;

  const baseGross = periodGrossFromMonthly(employee.gross);
  const basic = PayrollEngine.prorate(
    baseGross,
    inputs.workingDays,
    inputs.unpaidDays
  );

  const loanDeduction = round(inputs.loanDeduction);
  const otherDeductions = round(inputs.otherDeductions);

  const calc = PayrollEngine.calculate(
    {
      period: frequency,
      basic,
      overtime: inputs.overtime,
      bonus: inputs.bonus,
      taxableAllowances: inputs.taxableAllowance,
      exemptAllowances: inputs.exemptAllowance,
      adjustments: inputs.adjustment,
      pension: inputs.pension,
      otherDeductions: round(loanDeduction + otherDeductions),
      payeAdjustment: inputs.payeAdjustment,
      exempt: inputs.exempt
    },
    rates
  );

  return {
    employee,
    inputs,
    basic: calc.basic,
    overtime: calc.overtime,
    bonus: calc.bonus,
    taxableAllowance: calc.taxableAllowances,
    exemptAllowance: calc.exemptAllowances,
    adjustment: calc.adjustments,
    grossPay: calc.gross,
    paye: calc.paye,
    nis: calc.nis,
    nht: calc.nht,
    educationTax: calc.edTax,
    pension: calc.pension,
    loanDeduction,
    otherDeductions,
    totalDeductions: calc.totalDeductions,
    netPay: calc.net,
    calc
  };
}

// Used by the payslip preview and reports when no saved run exists yet.
function calculateEmployeePay(employee) {
  return calculateEmployeeRow(employee, blankPayrollInputs());
}

function rowToItem(row, heartApplies = true) {
  const employee = row.employee;
  // Rows reopened from a saved draft carry their stored employer shares (no fresh calculation).
  const employer = { ...(row.calc ? row.calc.employer : row.employer || {}) };

  if (!heartApplies && employer.heart) {
    employer.total = PayrollEngine.round2(employer.total - employer.heart);
    employer.heart = 0;
  }

  return {
    employee_id: employee.id,
    employee_name: employeeDisplayName(employee),
    employee_title: employee.title || "",
    department: employee.department || "",
    basic_salary: row.basic,
    overtime: row.overtime,
    bonus: row.bonus,
    taxable_allowance: row.taxableAllowance,
    adjustment: row.adjustment,
    exempt_allowance: row.exemptAllowance,
    gross_pay: row.grossPay,
    paye: row.paye,
    nis: row.nis,
    nht: row.nht,
    education_tax: row.educationTax,
    pension: row.pension,
    loan_deduction: row.loanDeduction,
    other_deductions: row.otherDeductions,
    total_deductions: row.totalDeductions,
    net_pay: row.netPay,
    unpaid_days: row.inputs.unpaidDays,
    notes: row.inputs.notes,
    inputs: {
      ...row.inputs,
      monthlySalary: payrollNumber(employee.gross),
      frequency: getPayrollFrequency(),
      periodsPerYear: periodsPerYear(),
      trn: employee.trn || null
    },
    employer_contributions: employer
  };
}

// Rebuilds a display row from a saved line, using exactly the stored amounts.
function rowFromItem(item) {
  const stored = item.inputs || {};
  const n = payrollNumber;

  return {
    employee: {
      id: item.employee_id,
      name: item.employee_name,
      full_name: item.employee_name,
      title: item.employee_title,
      department: item.department,
      trn: stored.trn || null,
      gross: n(stored.monthlySalary)
    },
    inputs: normaliseInputs(stored),
    basic: n(item.basic_salary),
    overtime: n(item.overtime),
    bonus: n(item.bonus),
    taxableAllowance: n(item.taxable_allowance),
    exemptAllowance: n(item.exempt_allowance),
    adjustment: n(item.adjustment),
    grossPay: n(item.gross_pay),
    paye: n(item.paye),
    nis: n(item.nis),
    nht: n(item.nht),
    educationTax: n(item.education_tax),
    pension: n(item.pension),
    loanDeduction: n(item.loan_deduction),
    otherDeductions: n(item.other_deductions),
    totalDeductions: n(item.total_deductions),
    netPay: n(item.net_pay),
    employer: item.employer_contributions || {},
    calc: null
  };
}

function summarisePayrollRows(rows) {
  const sum = (key) =>
    PayrollEngine.round2(
      rows.reduce((total, row) => total + payrollNumber(row[key]), 0)
    );

  return {
    count: rows.length,
    gross: sum("grossPay"),
    paye: sum("paye"),
    nis: sum("nis"),
    nht: sum("nht"),
    educationTax: sum("educationTax"),
    pension: sum("pension"),
    loan: sum("loanDeduction"),
    other: sum("otherDeductions"),
    exempt: sum("exemptAllowance"),
    deductions: sum("totalDeductions"),
    net: sum("netPay")
  };
}

// Blocking errors stop approval. Warnings are shown for review.
function validatePayrollRows(rows) {
  const errors = [];
  const warnings = [];
  const seen = new Set();

  rows.forEach((row) => {
    const employee = row.employee || {};
    const name = employeeDisplayName(employee);

    if (!employee.id) {
      errors.push(`${name}: missing employee record ID.`);
    } else if (seen.has(employee.id)) {
      errors.push(`${name}: appears more than once.`);
    } else {
      seen.add(employee.id);
    }

    if (!(row.grossPay > 0)) {
      errors.push(`${name}: gross pay is zero. Check the salary.`);
    }

    if (!(row.netPay > 0)) {
      errors.push(`${name}: net pay is not positive.`);
    }

    if (row.inputs && row.inputs.unpaidDays > row.inputs.workingDays) {
      errors.push(`${name}: unpaid days are more than the working days.`);
    }

    const defaults = payrollDefaults[employee.id];

    if (
      defaults &&
      row.loanDeduction > payrollNumber(defaults.loan_balance) + 0.005
    ) {
      errors.push(`${name}: loan deduction is more than the remaining loan balance.`);
    }

    if (!employee.trn) {
      warnings.push(`${name}: no TRN on record.`);
    }
  });

  return { errors, warnings };
}

function payrollRowIsAdjusted(row) {
  return (
    row.overtime || row.bonus || row.taxableAllowance || row.exemptAllowance ||
    row.adjustment || row.pension || row.loanDeduction || row.otherDeductions ||
    (row.inputs && (
      row.inputs.unpaidDays || row.inputs.payeAdjustment ||
      Object.values(row.inputs.exempt || {}).some(Boolean)
    ))
  );
}

/* ================= PAGE FURNITURE: styles, notices, dialogs ================= */
function injectPayrollStyles() {
  if (document.getElementById("payrollPhase2Styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "payrollPhase2Styles";
  style.textContent = `
    .payroll-workflow{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:14px 0 4px}
    .payroll-workflow button{min-height:42px;padding:9px 16px;border:1px solid #dedfe8;border-radius:9px;background:#fff;color:#35156f;font:inherit;font-weight:800;cursor:pointer}
    .payroll-workflow button.danger{color:#b91c1c;border-color:#f0c4c4}
    .payroll-workflow button:disabled{opacity:.55;cursor:not-allowed}
    .payroll-workflow .payroll-note{color:#6f7285;font-size:.85rem}
    .payroll-banner{margin:0 0 18px;padding:14px 18px;border-radius:12px;background:#fff4e5;border:1px solid #f6d9a6;color:#8a4b00;font-weight:700}
    .payroll-banner a{color:#35156f}
    .payroll-status-approved{color:#7a4b00;background:#fff1d6}
    .payroll-status-reversed{color:#b91c1c;background:#feecec}
    .payroll-history-status[data-status="draft"]{background:#e7f2ff;color:#1765bd}
    .payroll-history-status[data-status="approved"]{background:#fff1d6;color:#7a4b00}
    .payroll-history-status[data-status="reversed"]{background:#feecec;color:#b91c1c}
    .payroll-adjusted-tag{display:inline-block;margin-left:6px;padding:2px 7px;border-radius:999px;background:#f3ecff;color:#5b2c83;font-size:.7rem;font-weight:800}
    .payroll-row-button{margin-left:6px;padding:7px 11px;border:1px solid #ddd7ea;border-radius:8px;background:#fff;color:#35156f;font:inherit;font-size:.82rem;font-weight:800;cursor:pointer}
    .pay-period-modal-dialog.wide{width:min(760px,100%)}
    .pay-period-modal-body{max-height:68vh;overflow:auto}
    .pay-items-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .pay-items-check{display:flex;align-items:center;gap:8px;font-size:.86rem}
    .pay-items-check input{width:auto;min-height:0}
    .pay-items-preview{margin-top:14px;padding:12px 14px;border-radius:10px;background:#f6f2fb;color:#35156f;font-weight:700}
    .pay-items-error{margin-top:10px;color:#b91c1c;font-weight:700}
    .payroll-review-list{margin:8px 0 0;padding-left:18px}
    .payroll-review-list li{margin:4px 0}
    .payroll-review-error{color:#b91c1c;font-weight:700}
    .payroll-review-warning{color:#8a4b00}
    .payroll-extras{padding:16px 22px;border-bottom:1px solid #ececf2}
    .payroll-extras table{width:100%;border-collapse:collapse;margin-top:8px}
    .payroll-extras th,.payroll-extras td{padding:8px 10px;border-bottom:1px solid #efeff4;text-align:left;font-size:.85rem}
    .payroll-extras button{margin-right:8px;padding:8px 14px;border:1px solid #ddd7ea;border-radius:9px;background:#fff;color:#35156f;font:inherit;font-weight:800;cursor:pointer}
    @media (max-width:620px){.pay-items-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function payrollNotify(type, message, title) {
  if (window.KairoxUI && typeof window.KairoxUI[type] === "function") {
    window.KairoxUI[type](message, title);
    return;
  }

  window.alert(message);
}

function showPayrollBanner(html) {
  let banner = document.getElementById("payrollAccessBanner");

  if (!banner) {
    banner = document.createElement("div");
    banner.id = "payrollAccessBanner";
    banner.className = "payroll-banner";

    const host =
      document.querySelector(".payroll-main") || document.body;

    host.insertBefore(banner, host.firstChild);
  }

  banner.innerHTML = html;
}

function clearPayrollBanner() {
  document.getElementById("payrollAccessBanner")?.remove();
}

function openPayrollDialog({ title, subtitle = "", bodyHtml = "", wide = false, buttons = [] }) {
  closePayrollDialog();

  const modal = document.createElement("div");
  modal.id = "payrollDialog";
  modal.className = "pay-period-modal is-open";
  modal.innerHTML = `
    <div class="pay-period-modal-backdrop"></div>
    <div class="pay-period-modal-dialog${wide ? " wide" : ""}" role="dialog" aria-modal="true">
      <div class="pay-period-modal-header">
        <div>
          <h2>${escapePayrollHtml(title)}</h2>
          ${subtitle ? `<p>${escapePayrollHtml(subtitle)}</p>` : ""}
        </div>
        <button type="button" class="pay-period-modal-close" data-dialog-close aria-label="Close">×</button>
      </div>
      <div class="pay-period-modal-body">${bodyHtml}</div>
      <div class="pay-period-modal-actions"></div>
    </div>
  `;

  const actions = modal.querySelector(".pay-period-modal-actions");

  buttons.forEach((definition) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = definition.label;
    button.dataset.action = definition.id || definition.label;

    if (definition.primary) {
      button.classList.add("primary");
    }

    if (definition.disabled) {
      button.disabled = true;
    }

    button.addEventListener("click", () => definition.onClick(modal));
    actions.appendChild(button);
  });

  modal
    .querySelector("[data-dialog-close]")
    .addEventListener("click", closePayrollDialog);

  modal
    .querySelector(".pay-period-modal-backdrop")
    .addEventListener("click", closePayrollDialog);

  document.body.appendChild(modal);
  document.body.classList.add("pay-period-modal-open");

  return modal;
}

function closePayrollDialog() {
  document.getElementById("payrollDialog")?.remove();
  document.body.classList.remove("pay-period-modal-open");
}

/* ================= ACCESS AND LOADING ================= */
async function ensurePayrollAccess() {
  const { data: sessionData } = await supabaseClient.auth.getSession();

  if (!sessionData || !sessionData.session) {
    showPayrollBanner(
      'You are not signed in. <a href="login.html?next=payroll.html">Sign in</a> to continue.'
    );
    return false;
  }

  const { data: role, error } = await supabaseClient.rpc("get_my_role", { p_workspace: kairoxWorkspaceId() });

  if (error) {
    console.error("Could not read the payroll role:", error);
    showPayrollBanner(
      "The payroll security update has not been applied yet. Run phase2-migration.sql in Supabase, then refresh. (" +
        escapePayrollHtml(error.message || "unknown error") + ")"
    );
    return false;
  }

  if (!role) {
    showPayrollBanner(
      "Your account does not have a payroll role yet. Ask an admin to give you access."
    );
    return false;
  }

  payrollRole = role;
  clearPayrollBanner();
  return true;
}

function payrollState() {
  return payrollWorkflowRun ? payrollWorkflowRun.status : "new";
}

function payrollCanPrepare() {
  return payrollRole === "admin" || payrollRole === "director" || payrollRole === "payroll";
}

// Approving, sending back and reversing payroll belong to an admin or a managing director (a second person checks the
// work of the payroll / accounts officer). Processing an approved payroll is also open to the payroll / accounts officer.
function payrollIsApprover() {
  return payrollRole === "admin" || payrollRole === "director";
}

function payrollCanProcess() {
  return payrollRole === "admin" || payrollRole === "director" || payrollRole === "payroll";
}

function payrollIsEditable() {
  const state = payrollState();
  return payrollCanPrepare() && (state === "new" || state === "draft");
}

// Statutory rates are set on the Settings page and stored in the database. If none are saved yet,
// the built-in rates at the top of this file stay in use.
async function loadPayrollRates() {
  const { data, error } = await supabaseClient
    .from("payroll_rates")
    .select("rates")
    .eq("workspace", kairoxWorkspaceId())
    .maybeSingle();

  if (error || !data || !data.rates) {
    return false;
  }

  Object.assign(rates, data.rates);
  return true;
}

// payroll.html has "Fortnightly payroll" typed into the page. Keep it in step with the chosen frequency.
function updatePayrollFrequencyLabel() {
  const raw = localStorage.getItem("kairoxPayrollFrequency") || "Fortnightly";
  const frequency = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  const display = document.getElementById("payrollPeriodDisplay");

  const label =
    document.getElementById("payrollFrequencyDisplay") ||
    (display && display.nextElementSibling);

  if (label && /payroll$/i.test(label.textContent.trim())) {
    label.textContent = `${frequency} payroll`;
  }
}

async function loadPayrollDashboard() {
  const tableBody = document.getElementById("payrollEmployeeTableBody");

  if (!tableBody) {
    return;
  }

  injectPayrollStyles();
  updatePayrollFrequencyLabel();

  tableBody.innerHTML = `
    <tr>
      <td colspan="10">Loading payroll employees...</td>
    </tr>
  `;

  if (!(await ensurePayrollAccess())) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="10">Payroll is not available until you are signed in with a payroll role.</td>
      </tr>
    `;
    return;
  }

  await loadPayrollRates();

  const { data: employees, error } = await supabaseClient
    .from("employees")
    .select("*")
    .eq("workspace", kairoxWorkspaceId())
    .neq("employment_status", "archived");

  if (error) {
    console.error("Could not load payroll employees:", error);
    tableBody.innerHTML = `
      <tr>
        <td colspan="10">Payroll employees could not be loaded.</td>
      </tr>
    `;
    return;
  }

  const { data: defaultRows, error: defaultsError } = await supabaseClient
    .from("employee_pay_defaults")
    .select("*")
    .eq("workspace", kairoxWorkspaceId());

  if (defaultsError) {
    console.error("Could not load pay defaults:", defaultsError);
    showPayrollBanner(
      "The payroll update (phase2-migration.sql) has not been applied yet, so pay items are unavailable."
    );
    tableBody.innerHTML = `
      <tr>
        <td colspan="10">Payroll could not be loaded.</td>
      </tr>
    `;
    return;
  }

  payrollDefaults = {};
  (defaultRows || []).forEach((row) => {
    payrollDefaults[row.employee_id] = row;
  });

  const periodStart = localStorage.getItem("kairoxPayrollPeriodStart");
  const periodEnd = localStorage.getItem("kairoxPayrollPeriodEnd");

  payrollWorkflowRun = null;
  currentProcessedPayrollRunId = null;
  payrollDirty = false;
  payrollMissingFromDraft = 0;

  const eligible = (employees || []).filter(isPayrollEligible);

  if (periodStart && periodEnd) {
    const { data: liveRun, error: runError } = await supabaseClient
      .from("payroll_runs")
      .select("*")
      .eq("workspace", kairoxWorkspaceId())
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .neq("status", "reversed")
      .maybeSingle();

    if (runError) {
      console.error("Could not check payroll period status:", runError);
      tableBody.innerHTML = `
        <tr>
          <td colspan="10">The payroll period status could not be checked.</td>
        </tr>
      `;
      return;
    }

    payrollWorkflowRun = liveRun || null;
  }

  if (payrollWorkflowRun) {
    const { data: savedItems, error: itemsError } = await supabaseClient
      .from("payroll_run_items")
      .select("*")
      .eq("payroll_run_id", payrollWorkflowRun.id)
      .order("employee_name", { ascending: true });

    if (itemsError) {
      console.error("Could not load saved payroll employees:", itemsError);
      tableBody.innerHTML = `
        <tr>
          <td colspan="10">Saved payroll records could not be loaded.</td>
        </tr>
      `;
      return;
    }

    currentPayrollRows = (savedItems || []).map(rowFromItem);
    payrollInputs = {};
    currentPayrollRows.forEach((row) => {
      payrollInputs[row.employee.id] = row.inputs;
    });

    if (payrollWorkflowRun.status === "processed") {
      currentProcessedPayrollRunId = payrollWorkflowRun.id;
    }

    const inRun = new Set(currentPayrollRows.map((row) => row.employee.id));
    payrollMissingFromDraft = eligible.filter((e) => !inRun.has(e.id)).length;
  } else {
    payrollInputs = {};
    currentPayrollRows = eligible.map((employee) => {
      payrollInputs[employee.id] = inputsFromDefaults(payrollDefaults[employee.id]);
      return calculateEmployeeRow(employee, payrollInputs[employee.id]);
    });
  }

  renderPayrollAll();
  await loadPayrollHistory();
  await loadPayrollAudit();
}

function renderPayrollAll() {
  renderPayrollSummary(currentPayrollRows);
  renderPayrollEmployeeTable();
  updateWorkflowControls();
}

function recalculateRow(employeeId) {
  const index = currentPayrollRows.findIndex(
    (row) => row.employee.id === employeeId
  );

  if (index < 0) {
    return;
  }

  currentPayrollRows[index] = calculateEmployeeRow(
    currentPayrollRows[index].employee,
    payrollInputs[employeeId]
  );
}

/* ================= TABLE, SUMMARY AND WORKFLOW BAR ================= */
function renderPayrollSummary(rows) {
  const summary = summarisePayrollRows(rows);

  setPayrollText("payrollEmployeeCount", summary.count);
  setPayrollText("payrollGrossTotal", formatPayrollCurrency(summary.gross));
  setPayrollText("payrollDeductionTotal", formatPayrollCurrency(summary.deductions));
  setPayrollText("payrollNetTotal", formatPayrollCurrency(summary.net));
}

function payrollStatusLabel(state) {
  return {
    new: "Draft (not saved)",
    draft: "Draft",
    approved: "Approved",
    processed: "Processed",
    reversed: "Reversed"
  }[state] || state;
}

function renderPayrollEmployeeTable() {
  const tableBody = document.getElementById("payrollEmployeeTableBody");

  if (!tableBody) {
    return;
  }

  const searchInput = document.getElementById("payrollEmployeeSearch");
  const term = (searchInput ? searchInput.value : "").trim().toLowerCase();

  const rows = currentPayrollRows.filter(({ employee }) => {
    if (!term) {
      return true;
    }

    return [employeeDisplayName(employee), employee.department, employee.title]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(term);
  });

  if (rows.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="10">${
          currentPayrollRows.length
            ? "No employees match your search."
            : "No employees are available for payroll."
        }</td>
      </tr>
    `;
    return;
  }

  const state = payrollState();
  const editable = payrollIsEditable();

  tableBody.innerHTML = rows
    .map((row) => {
      const { employee } = row;
      const name = employeeDisplayName(employee);

      const payslipUrl = payrollWorkflowRun
        ? `payslip.html?run=${encodeURIComponent(payrollWorkflowRun.id)}&employee=${encodeURIComponent(employee.id)}`
        : `payslip.html?id=${encodeURIComponent(employee.id)}`;

      return `
        <tr>
          <td>
            <strong>${escapePayrollHtml(name)}</strong>
            ${payrollRowIsAdjusted(row) ? '<span class="payroll-adjusted-tag">Pay items</span>' : ""}
          </td>
          <td>${escapePayrollHtml(employee.department || "Not assigned")}</td>
          <td>${formatPayrollCurrency(row.grossPay)}</td>
          <td>${formatPayrollCurrency(row.paye)}</td>
          <td>${formatPayrollCurrency(row.nis)}</td>
          <td>${formatPayrollCurrency(row.nht)}</td>
          <td>${formatPayrollCurrency(row.educationTax)}</td>
          <td><strong>${formatPayrollCurrency(row.netPay)}</strong></td>
          <td>
            <span class="payroll-row-status">${escapePayrollHtml(payrollStatusLabel(state))}</span>
          </td>
          <td>
            <a class="payroll-view-link" href="${payslipUrl}">View Payslip</a>
            ${
              editable
                ? `<button type="button" class="payroll-row-button" data-pay-items="${escapePayrollHtml(employee.id)}">Pay items</button>`
                : ""
            }
          </td>
        </tr>
      `;
    })
    .join("");
}

function ensureWorkflowBar() {
  let bar = document.getElementById("payrollWorkflowBar");

  if (bar) {
    return bar;
  }

  const runButton = document.getElementById("runPayrollBtn");

  if (!runButton) {
    return null;
  }

  bar = document.createElement("div");
  bar.id = "payrollWorkflowBar";
  bar.className = "payroll-workflow";
  bar.innerHTML = `
    <button type="button" id="payrollSaveDraftBtn" hidden>Save Changes</button>
    <button type="button" id="payrollReopenBtn" hidden>Send Back to Draft</button>
    <button type="button" id="payrollReverseBtn" class="danger" hidden>Reverse Payroll</button>
    <button type="button" id="payrollDeleteDraftBtn" class="danger" hidden>Delete Draft</button>
    <span id="payrollWorkflowNote" class="payroll-note"></span>
  `;

  runButton.insertAdjacentElement("afterend", bar);

  bar.querySelector("#payrollSaveDraftBtn").addEventListener("click", () => savePayrollDraft());
  bar.querySelector("#payrollReopenBtn").addEventListener("click", reopenPayroll);
  bar.querySelector("#payrollReverseBtn").addEventListener("click", reversePayroll);
  bar.querySelector("#payrollDeleteDraftBtn").addEventListener("click", deletePayrollDraft);

  return bar;
}

function updateWorkflowControls() {
  const state = payrollState();
  const isAdmin = payrollIsApprover();
  const canProcess = payrollCanProcess();
  const canPrepare = payrollCanPrepare();
  const hasRows = currentPayrollRows.length > 0;

  const badge = document.getElementById("payrollStatus");
  const runButton = document.getElementById("runPayrollBtn");

  if (badge) {
    badge.textContent = payrollStatusLabel(state === "new" ? "draft" : state);
    badge.className = `payroll-status payroll-status-${state === "new" ? "draft" : state}`;
  }

  let label = "Save Draft";
  let enabled = canPrepare && hasRows;

  if (state === "draft") {
    label = isAdmin ? "Review & Approve" : "Awaiting Approval";
    enabled = isAdmin;
  } else if (state === "approved") {
    label = canProcess ? "Process Payroll" : "Approved: Awaiting Processing";
    enabled = canProcess;
  } else if (state === "processed") {
    label = "Payroll Processed";
    enabled = false;
  }

  if (runButton) {
    runButton.textContent = label;
    runButton.disabled = !enabled || payrollBusy;
  }

  const bar = ensureWorkflowBar();

  if (!bar) {
    return;
  }

  const show = (id, visible) => {
    const element = bar.querySelector(id);
    if (element) {
      element.hidden = !visible;
    }
  };

  show("#payrollSaveDraftBtn", state === "draft" && canPrepare);
  bar.querySelector("#payrollSaveDraftBtn").disabled = !payrollDirty;
  show("#payrollReopenBtn", state === "approved" && isAdmin);
  show("#payrollReverseBtn", state === "processed" && isAdmin);
  show("#payrollDeleteDraftBtn", state === "draft" && canPrepare);

  const notes = [];

  if (payrollDirty) {
    notes.push("You have unsaved changes.");
  }

  if (state === "draft" && payrollMissingFromDraft > 0) {
    notes.push(
      `${payrollMissingFromDraft} active employee(s) are not in this draft. Delete it and start again to include them.`
    );
  }

  if (payrollRole === "viewer") {
    notes.push("You have read-only access.");
  } else if (payrollRole === "payroll" && state === "draft") {
    notes.push("An admin or managing director approves this payroll. Then you can process it.");
  } else if (payrollRole === "payroll" && state === "processed") {
    notes.push("Only an admin or managing director can reverse payroll.");
  } else if (payrollRole === "payroll" && state === "approved") {
    notes.push("Only an admin or managing director can send an approved payroll back to draft.");
  }

  const note = bar.querySelector("#payrollWorkflowNote");
  if (note) {
    note.textContent = notes.join(" ");
  }
}

/* ================= PAY ITEMS (per employee, this run) ================= */
function payItemField(id, label, value, options = {}) {
  const min = options.min === undefined ? "0" : options.min;
  const step = options.step || "0.01";

  return `
    <div class="pay-period-field">
      <label for="${id}">${escapePayrollHtml(label)}</label>
      <input id="${id}" type="number" step="${step}"
        ${min === null ? "" : `min="${min}"`}
        value="${escapePayrollHtml(value)}">
    </div>
  `;
}

function collectPayItems(modal) {
  const read = (id) => payrollNumber(modal.querySelector(id).value);
  const checked = (id) => modal.querySelector(id).checked;

  return {
    inputs: {
      overtime: read("#pi_overtime"),
      bonus: read("#pi_bonus"),
      taxableAllowance: read("#pi_taxable"),
      exemptAllowance: read("#pi_exempt"),
      adjustment: read("#pi_adjustment"),
      unpaidDays: read("#pi_unpaid"),
      workingDays: read("#pi_working"),
      pension: read("#pi_pension"),
      loanDeduction: read("#pi_loan"),
      otherDeductions: read("#pi_other"),
      payeAdjustment: read("#pi_payeadj"),
      notes: modal.querySelector("#pi_notes").value.trim(),
      exempt: {
        nis: checked("#pi_ex_nis"),
        nht: checked("#pi_ex_nht"),
        edTax: checked("#pi_ex_edtax"),
        paye: checked("#pi_ex_paye")
      }
    },
    loanBalance: read("#pi_loanbalance"),
    saveDefault: checked("#pi_savedefault")
  };
}

function validatePayItems(collected, employeeId) {
  const i = collected.inputs;

  const nonNegative = [
    ["Overtime", i.overtime], ["Bonus", i.bonus],
    ["Taxable allowance", i.taxableAllowance],
    ["Non-taxable allowance", i.exemptAllowance],
    ["Unpaid days", i.unpaidDays], ["Pension", i.pension],
    ["Loan repayment", i.loanDeduction], ["Other deductions", i.otherDeductions]
  ];

  for (const [label, value] of nonNegative) {
    if (value < 0) {
      return `${label} cannot be negative.`;
    }
  }

  if (!(i.workingDays > 0)) {
    return "Working days in the period must be more than zero.";
  }

  if (i.unpaidDays > i.workingDays) {
    return "Unpaid days cannot be more than the working days.";
  }

  const savedBalance = payrollDefaults[employeeId]
    ? payrollNumber(payrollDefaults[employeeId].loan_balance)
    : null;

  const balance = collected.saveDefault ? collected.loanBalance : savedBalance;

  if (balance !== null && i.loanDeduction > balance + 0.005) {
    return "The loan repayment is more than the remaining loan balance.";
  }

  return "";
}

function openPayItemsDialog(employeeId) {
  if (!payrollIsEditable()) {
    return;
  }

  const row = currentPayrollRows.find((r) => r.employee.id === employeeId);

  if (!row) {
    return;
  }

  const employee = row.employee;
  const inputs = normaliseInputs(payrollInputs[employeeId]);
  const defaults = payrollDefaults[employeeId] || {};

  const body = `
    <div class="pay-items-grid">
      ${payItemField("pi_overtime", "Overtime pay (J$)", inputs.overtime)}
      ${payItemField("pi_bonus", "Bonus (J$)", inputs.bonus)}
      ${payItemField("pi_taxable", "Taxable allowances (J$)", inputs.taxableAllowance)}
      ${payItemField("pi_exempt", "Non-taxable allowances (J$)", inputs.exemptAllowance)}
      ${payItemField("pi_adjustment", "Adjustment, + or − (J$)", inputs.adjustment, { min: null })}
      ${payItemField("pi_payeadj", "PAYE adjustment, + or − (J$)", inputs.payeAdjustment, { min: null })}
      ${payItemField("pi_unpaid", "Unpaid leave (days)", inputs.unpaidDays, { step: "0.5" })}
      ${payItemField("pi_working", "Working days in this period", inputs.workingDays, { step: "0.5" })}
      ${payItemField("pi_pension", "Approved pension contribution (J$)", inputs.pension)}
      ${payItemField("pi_loan", "Loan repayment this period (J$)", inputs.loanDeduction)}
      ${payItemField("pi_other", "Other deductions (J$)", inputs.otherDeductions)}
      ${payItemField("pi_loanbalance", "Loan balance remaining (J$)", payrollNumber(defaults.loan_balance))}
    </div>
    <div class="pay-period-field" style="margin-top:14px">
      <label for="pi_notes">Note (shown in the payroll record)</label>
      <input id="pi_notes" type="text" maxlength="200" value="${escapePayrollHtml(inputs.notes)}">
    </div>
    <div class="pay-period-field">
      <label>Statutory exemptions (employee side only)</label>
      <label class="pay-items-check"><input type="checkbox" id="pi_ex_nis" ${inputs.exempt.nis ? "checked" : ""}> Exempt from NIS</label>
      <label class="pay-items-check"><input type="checkbox" id="pi_ex_nht" ${inputs.exempt.nht ? "checked" : ""}> Exempt from NHT</label>
      <label class="pay-items-check"><input type="checkbox" id="pi_ex_edtax" ${inputs.exempt.edTax ? "checked" : ""}> Exempt from Education Tax</label>
      <label class="pay-items-check"><input type="checkbox" id="pi_ex_paye" ${inputs.exempt.paye ? "checked" : ""}> Exempt from PAYE</label>
    </div>
    <label class="pay-items-check">
      <input type="checkbox" id="pi_savedefault">
      Also save pension, allowances, loan and exemptions as this employee's defaults for future payrolls
    </label>
    <div class="pay-items-preview" id="pi_preview"></div>
    <div class="pay-items-error" id="pi_error"></div>
  `;

  const modal = openPayrollDialog({
    title: "Pay items",
    subtitle: employeeDisplayName(employee),
    bodyHtml: body,
    wide: true,
    buttons: [
      { id: "cancel", label: "Cancel", onClick: closePayrollDialog },
      { id: "save", label: "Apply to this payroll", primary: true, onClick: (m) => applyPayItems(m, employeeId) }
    ]
  });

  const refreshPreview = () => {
    const collected = collectPayItems(modal);
    const preview = calculateEmployeeRow(employee, collected.inputs);

    modal.querySelector("#pi_preview").textContent =
      `Gross ${formatPayrollCurrency(preview.grossPay)}  ·  ` +
      `Deductions ${formatPayrollCurrency(preview.totalDeductions)}  ·  ` +
      `Net pay ${formatPayrollCurrency(preview.netPay)}`;
  };

  modal.addEventListener("input", refreshPreview);
  modal.addEventListener("change", refreshPreview);
  refreshPreview();

  loadUnpaidLeaveHint(modal, employeeId);
  loadDepartureHint(modal, employeeId);
}

// If the person has a recorded last day inside this pay period, say how many working days fall after it, and let the
// clerk add them to the unpaid days. It is only a suggestion.
async function loadDepartureHint(modal, employeeId) {
  try {
    const start = localStorage.getItem("kairoxPayrollPeriodStart");
    const end = localStorage.getItem("kairoxPayrollPeriodEnd");

    if (!start || !end) {
      return;
    }

    const { data, error } = await supabaseClient.rpc("departure_days_in_period", {
      p_workspace: kairoxWorkspaceId(),
      p_employee: employeeId,
      p_start: start,
      p_end: end
    });

    const row = data && data[0];
    const days = row ? Number(row.days_after) : 0;
    const field = modal.querySelector("#pi_unpaid");

    if (error || !row || !(days > 0) || !field || !field.parentNode) {
      return;
    }

    const hint = document.createElement("div");
    hint.className = "pay-items-leaver-hint";
    hint.style.cssText = "margin-top:4px;font-size:12px;font-weight:700;color:#8a4b00";
    hint.textContent = `Their last day was ${row.leaving_date}: ${days} working day(s) of this period come after it. `;

    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "Add to unpaid days";
    add.style.cssText = "margin-left:4px;padding:2px 8px;border:1px solid #f0d2a0;border-radius:8px;background:#fff;color:#8a4b00;font:inherit;font-size:12px;font-weight:800;cursor:pointer";
    add.addEventListener("click", () => {
      field.value = String((Number(field.value) || 0) + days);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      hint.remove();
    });

    hint.appendChild(add);
    field.parentNode.appendChild(hint);
  } catch (error) {
    console.error("Could not look up the last day:", error);
  }
}

// Approved UNPAID leave in this pay period (from the Leave page). It is only a suggestion: the clerk presses
// "Use this" to put it in the box, so nothing changes pay by itself.
async function loadUnpaidLeaveHint(modal, employeeId) {
  try {
    const start = localStorage.getItem("kairoxPayrollPeriodStart");
    const end = localStorage.getItem("kairoxPayrollPeriodEnd");

    if (!start || !end) {
      return;
    }

    const { data, error } = await supabaseClient.rpc("leave_unpaid_days", {
      p_workspace: kairoxWorkspaceId(),
      p_employee: employeeId,
      p_start: start,
      p_end: end
    });

    const days = Number(data);
    const field = modal.querySelector("#pi_unpaid");

    if (error || !(days > 0) || !field || !field.parentNode) {
      return;
    }

    const hint = document.createElement("div");
    hint.className = "pay-items-leave-hint";
    hint.style.cssText = "margin-top:4px;font-size:12px;font-weight:700;color:#5b2c83";
    hint.textContent = `Approved unpaid leave in this period: ${days} day(s). `;

    const use = document.createElement("button");
    use.type = "button";
    use.textContent = "Use this";
    use.style.cssText = "margin-left:4px;padding:2px 8px;border:1px solid #c9b8e6;border-radius:8px;background:#fff;color:#35156f;font:inherit;font-size:12px;font-weight:800;cursor:pointer";
    use.addEventListener("click", () => {
      field.value = String(days);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      hint.remove();
    });

    hint.appendChild(use);
    field.parentNode.appendChild(hint);
  } catch (error) {
    console.error("Could not look up approved unpaid leave:", error);
  }
}

async function applyPayItems(modal, employeeId) {
  const collected = collectPayItems(modal);
  const errorBox = modal.querySelector("#pi_error");
  const problem = validatePayItems(collected, employeeId);

  if (problem) {
    errorBox.textContent = problem;
    return;
  }

  if (collected.saveDefault) {
    const i = collected.inputs;

    const { error } = await supabaseClient
      .from("employee_pay_defaults")
      .upsert(
        {
          employee_id: employeeId,
          workspace: kairoxWorkspaceId(),
          pension: i.pension,
          taxable_allowance: i.taxableAllowance,
          exempt_allowance: i.exemptAllowance,
          loan_deduction: i.loanDeduction,
          loan_balance: collected.loanBalance,
          exempt_nis: i.exempt.nis,
          exempt_nht: i.exempt.nht,
          exempt_edtax: i.exempt.edTax,
          exempt_paye: i.exempt.paye
        },
        { onConflict: "employee_id" }
      );

    if (error) {
      console.error("Could not save pay defaults:", error);
      errorBox.textContent =
        "The defaults could not be saved: " + (error.message || "unknown error");
      return;
    }

    payrollDefaults[employeeId] = {
      ...(payrollDefaults[employeeId] || {}),
      employee_id: employeeId,
      pension: i.pension,
      taxable_allowance: i.taxableAllowance,
      exempt_allowance: i.exemptAllowance,
      loan_deduction: i.loanDeduction,
      loan_balance: collected.loanBalance,
      exempt_nis: i.exempt.nis,
      exempt_nht: i.exempt.nht,
      exempt_edtax: i.exempt.edTax,
      exempt_paye: i.exempt.paye
    };
  }

  payrollInputs[employeeId] = normaliseInputs(collected.inputs);
  recalculateRow(employeeId);
  payrollDirty = true;
  closePayrollDialog();
  renderPayrollAll();
}

/* ================= WORKFLOW: draft > approve > process > reverse ================= */
async function withPayrollBusy(task) {
  if (payrollBusy) {
    return undefined;
  }

  payrollBusy = true;
  updateWorkflowControls();

  try {
    return await task();
  } finally {
    payrollBusy = false;
    updateWorkflowControls();
  }
}

function payrollPeriodSettings() {
  return {
    periodStart: localStorage.getItem("kairoxPayrollPeriodStart"),
    periodEnd: localStorage.getItem("kairoxPayrollPeriodEnd"),
    payDate: localStorage.getItem("kairoxPayrollPayDate"),
    payFrequency: localStorage.getItem("kairoxPayrollFrequency") || "Fortnightly"
  };
}

async function savePayrollDraft({ quiet = false } = {}) {
  const { periodStart, periodEnd, payDate, payFrequency } = payrollPeriodSettings();

  if (!periodStart || !periodEnd) {
    payrollNotify("error", "Please set the payroll period before saving.");
    return false;
  }

  if (!payDate) {
    payrollNotify("error", "Please set a pay date before saving.");
    return false;
  }

  if (!currentPayrollRows.length) {
    payrollNotify("error", "There are no payroll employees to save.");
    return false;
  }

  // HEART/NSTA is paid by the employer only, once monthly payroll passes J$14,444.
  const monthlyPayroll = currentPayrollRows.reduce(
    (total, row) => total + payrollNumber(row.employee.gross),
    0
  );

  const items = currentPayrollRows.map((row) =>
    rowToItem(row, monthlyPayroll > 14444)
  );

  const { error } = await supabaseClient.rpc("save_payroll_draft", {
    p_run_id: payrollWorkflowRun ? payrollWorkflowRun.id : null,
    p_workspace: kairoxWorkspaceId(),
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_pay_date: payDate,
    p_pay_frequency: payFrequency,
    p_rates: rates,
    p_items: items
  });

  if (error) {
    console.error("Draft was not saved:", error);
    payrollNotify(
      "error",
      "The draft was not saved. Nothing was changed.\n\n" +
        (error.message || "Unknown error")
    );
    return false;
  }

  payrollDirty = false;
  await loadPayrollDashboard();

  if (!quiet) {
    payrollNotify("success", "Draft saved.");
  }

  return true;
}

async function buildPriorComparison(rows) {
  const { periodStart } = payrollPeriodSettings();

  const { data: runs } = await supabaseClient
    .from("payroll_runs")
    .select("*")
    .eq("workspace", kairoxWorkspaceId())
    .eq("status", "processed");

  const prior = (runs || [])
    .filter((run) => run.period_end < periodStart)
    .sort((a, b) => (a.period_start < b.period_start ? 1 : -1))[0];

  if (!prior) {
    return { label: "", flags: [] };
  }

  const { data: items } = await supabaseClient
    .from("payroll_run_items")
    .select("*")
    .eq("payroll_run_id", prior.id);

  const before = {};
  (items || []).forEach((item) => {
    before[item.employee_id] = item;
  });

  const flags = [];
  const seen = new Set();

  rows.forEach((row) => {
    const id = row.employee.id;
    const name = employeeDisplayName(row.employee);
    const previous = before[id];
    seen.add(id);

    if (!previous) {
      flags.push(`${name}: new this period (not paid last period).`);
      return;
    }

    const previousNet = payrollNumber(previous.net_pay);

    if (previousNet > 0) {
      const change = (row.netPay - previousNet) / previousNet;

      if (Math.abs(change) > 0.25) {
        flags.push(
          `${name}: net pay changed ${change > 0 ? "+" : ""}${Math.round(change * 100)}% ` +
            `(${formatPayrollCurrency(previousNet)} to ${formatPayrollCurrency(row.netPay)}).`
        );
      }
    }
  });

  (items || []).forEach((item) => {
    if (!seen.has(item.employee_id)) {
      flags.push(`${item.employee_name}: was paid last period but is not in this payroll.`);
    }
  });

  return {
    label: `${formatPayrollDate(prior.period_start)} to ${formatPayrollDate(prior.period_end)}`,
    flags
  };
}

async function reviewAndApprovePayroll() {
  if (payrollDirty) {
    const saved = await savePayrollDraft({ quiet: true });

    if (!saved) {
      return;
    }
  }

  if (!payrollWorkflowRun || payrollWorkflowRun.status !== "draft") {
    return;
  }

  const rows = currentPayrollRows;
  const { errors, warnings } = validatePayrollRows(rows);
  const summary = summarisePayrollRows(rows);
  const comparison = await buildPriorComparison(rows);

  const statutory = PayrollEngine.round2(
    summary.paye + summary.nis + summary.nht + summary.educationTax
  );

  const list = (items, cssClass) =>
    items.length
      ? `<ul class="payroll-review-list">${items
          .map((text) => `<li class="${cssClass}">${escapePayrollHtml(text)}</li>`)
          .join("")}</ul>`
      : "";

  const adjusted = rows.filter(payrollRowIsAdjusted).length;

  const body = `
    <table class="payroll-history-table" style="min-width:0">
      <tbody>
        <tr><td>Employees</td><td><strong>${summary.count}</strong></td></tr>
        <tr><td>Gross pay</td><td><strong>${formatPayrollCurrency(summary.gross)}</strong></td></tr>
        <tr><td>Statutory deductions (PAYE, NIS, NHT, Education Tax)</td><td>${formatPayrollCurrency(statutory)}</td></tr>
        <tr><td>Other deductions (pension, loans, other)</td><td>${formatPayrollCurrency(summary.pension + summary.loan + summary.other)}</td></tr>
        <tr><td>Net pay</td><td><strong>${formatPayrollCurrency(summary.net)}</strong></td></tr>
        <tr><td>Employees with pay items</td><td>${adjusted}</td></tr>
      </tbody>
    </table>
    ${errors.length ? `<p class="payroll-review-error">Fix these before approving:</p>${list(errors, "payroll-review-error")}` : ""}
    ${comparison.flags.length ? `<p>Compared with ${escapePayrollHtml(comparison.label)}:</p>${list(comparison.flags, "payroll-review-warning")}` : ""}
    ${warnings.length ? `<p>Check:</p>${list(warnings, "payroll-review-warning")}` : ""}
    ${!errors.length && !comparison.flags.length && !warnings.length ? "<p>No problems found.</p>" : ""}
  `;

  openPayrollDialog({
    title: "Review payroll",
    subtitle: `${formatPayrollDate(payrollWorkflowRun.period_start)} to ${formatPayrollDate(payrollWorkflowRun.period_end)}`,
    bodyHtml: body,
    wide: true,
    buttons: [
      { id: "cancel", label: "Cancel", onClick: closePayrollDialog },
      {
        id: "approve",
        label: "Approve payroll",
        primary: true,
        disabled: errors.length > 0,
        onClick: () => withPayrollBusy(approvePayroll)
      }
    ]
  });
}

async function approvePayroll() {
  const { error } = await supabaseClient.rpc("approve_payroll_run", {
    p_run: payrollWorkflowRun.id
  });

  closePayrollDialog();

  if (error) {
    console.error("Payroll was not approved:", error);
    payrollNotify("error", "Payroll was not approved.\n\n" + (error.message || "Unknown error"));
    return;
  }

  await loadPayrollDashboard();
  payrollNotify("success", "Payroll approved. It can now be processed.");
}

function processApprovedPayroll() {
  if (!payrollWorkflowRun || payrollWorkflowRun.status !== "approved") {
    return;
  }

  const summary = summarisePayrollRows(currentPayrollRows);

  openPayrollDialog({
    title: "Process payroll",
    subtitle: `${formatPayrollDate(payrollWorkflowRun.period_start)} to ${formatPayrollDate(payrollWorkflowRun.period_end)}`,
    bodyHtml: `
      <p>${summary.count} employees. Net pay <strong>${formatPayrollCurrency(summary.net)}</strong>.</p>
      <p>A processed payroll cannot be edited. If something is wrong it can only be reversed, and the reason is recorded.</p>
    `,
    buttons: [
      { id: "cancel", label: "Cancel", onClick: closePayrollDialog },
      { id: "process", label: "Process payroll", primary: true, onClick: () => withPayrollBusy(processPayroll) }
    ]
  });
}

async function processPayroll() {
  const { error } = await supabaseClient.rpc("process_payroll_run", {
    p_run: payrollWorkflowRun.id
  });

  closePayrollDialog();

  if (error) {
    console.error("Payroll was not processed:", error);
    payrollNotify("error", "Payroll was not processed. Nothing was changed.\n\n" + (error.message || "Unknown error"));
    return;
  }

  await loadPayrollDashboard();
  payrollNotify("success", "Payroll processed successfully.");
}

async function reopenPayroll() {
  if (!window.confirm("Send this approved payroll back to draft so it can be edited?")) {
    return;
  }

  await withPayrollBusy(async () => {
    const { error } = await supabaseClient.rpc("reopen_payroll_run", {
      p_run: payrollWorkflowRun.id
    });

    if (error) {
      payrollNotify("error", "Could not send the payroll back to draft.\n\n" + (error.message || "Unknown error"));
      return;
    }

    await loadPayrollDashboard();
    payrollNotify("success", "Payroll is a draft again.");
  });
}

function reversePayroll() {
  if (!payrollWorkflowRun || payrollWorkflowRun.status !== "processed") {
    return;
  }

  openPayrollDialog({
    title: "Reverse payroll",
    subtitle: `${formatPayrollDate(payrollWorkflowRun.period_start)} to ${formatPayrollDate(payrollWorkflowRun.period_end)}`,
    bodyHtml: `
      <p>The payroll is kept in history as reversed, loan balances are restored, and the period can be run again.</p>
      <div class="pay-period-field">
        <label for="reverseReason">Reason (required)</label>
        <input id="reverseReason" type="text" maxlength="300">
      </div>
      <div class="pay-items-error" id="reverseError"></div>
    `,
    buttons: [
      { id: "cancel", label: "Cancel", onClick: closePayrollDialog },
      {
        id: "reverse",
        label: "Reverse payroll",
        primary: true,
        onClick: (modal) => {
          const reason = modal.querySelector("#reverseReason").value.trim();

          if (reason.length < 5) {
            modal.querySelector("#reverseError").textContent =
              "Please give a reason of at least 5 characters.";
            return;
          }

          withPayrollBusy(async () => {
            const { error } = await supabaseClient.rpc("reverse_payroll_run", {
              p_run: payrollWorkflowRun.id,
              p_reason: reason
            });

            closePayrollDialog();

            if (error) {
              payrollNotify("error", "Payroll was not reversed.\n\n" + (error.message || "Unknown error"));
              return;
            }

            await loadPayrollDashboard();
            payrollNotify("success", "Payroll reversed. You can now run this period again.");
          });
        }
      }
    ]
  });
}

async function deletePayrollDraft() {
  if (!window.confirm("Delete this draft? This cannot be undone.")) {
    return;
  }

  await withPayrollBusy(async () => {
    const { error } = await supabaseClient.rpc("delete_payroll_draft", {
      p_run: payrollWorkflowRun.id
    });

    if (error) {
      payrollNotify("error", "The draft was not deleted.\n\n" + (error.message || "Unknown error"));
      return;
    }

    await loadPayrollDashboard();
    payrollNotify("success", "Draft deleted.");
  });
}

// The "Run Payroll" button in the page calls this. What it does depends on the stage.
async function runPayroll() {
  await withPayrollBusy(async () => {
    const state = payrollState();

    if (state === "new") {
      await savePayrollDraft();
    } else if (state === "draft") {
      await reviewAndApprovePayroll();
    } else if (state === "approved") {
      processApprovedPayroll();
    }
  });
}

/* ================= HISTORY, RUN DETAIL, STATUTORY SUMMARY, CHECKS ================= */
let payrollHistoryCache = [];

function payrollCompanyName() {
  const company = window.KairoxCompany;
  return (company && company.companyName()) || "Kairox Exchange";
}

// Name plus the employer's TRN (when the company profile has one), for the headings on exports.
function payrollCompanyHeading() {
  const company = window.KairoxCompany;
  return (company && company.companyHeading()) || payrollCompanyName();
}

function statutoryRemittance(items) {
  const round = PayrollEngine.round2;
  const sum = (pick) =>
    round(items.reduce((total, item) => total + payrollNumber(pick(item)), 0));
  const employer = (item, key) => (item.employer_contributions || {})[key];

  const result = {
    paye: sum((i) => i.paye),
    nis: { employee: sum((i) => i.nis), employer: sum((i) => employer(i, "nis")) },
    nht: { employee: sum((i) => i.nht), employer: sum((i) => employer(i, "nht")) },
    edTax: { employee: sum((i) => i.education_tax), employer: sum((i) => employer(i, "edTax")) },
    heart: sum((i) => employer(i, "heart")),
    legacy: items.some(
      (i) => !i.employer_contributions || Object.keys(i.employer_contributions).length === 0
    )
  };

  result.total = round(
    result.paye +
      result.nis.employee + result.nis.employer +
      result.nht.employee + result.nht.employer +
      result.edTax.employee + result.edTax.employer +
      result.heart
  );

  return result;
}

// Statutory deductions are due by the 14th of the month after the pay date.
function remittanceDueText(dateString) {
  const parts = String(dateString || "").split("-").map(Number);

  if (parts.length < 3 || parts.some((p) => !p)) {
    return "the 14th of the following month";
  }

  const due = new Date(parts[0], parts[1], 14);

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(due);
}

async function loadPayrollHistory() {
  const tableBody = document.getElementById("payrollHistoryBody");

  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = `
    <tr>
      <td colspan="8">Loading payroll history...</td>
    </tr>
  `;

  const { data, error } = await supabaseClient
    .from("payroll_runs")
    .select("*")
    .eq("workspace", kairoxWorkspaceId())
    .order("period_start", { ascending: false });

  if (error) {
    console.error("Could not load payroll history:", error);
    tableBody.innerHTML = `
      <tr>
        <td colspan="8">Payroll history could not be loaded.</td>
      </tr>
    `;
    return;
  }

  payrollHistoryCache = data || [];

  if (payrollHistoryCache.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8">No payroll runs have been saved yet.</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = payrollHistoryCache
    .map((run) => {
      const status = run.status || "processed";
      const canOpen =
        (status === "draft" || status === "approved") && payrollCanPrepare();

      return `
        <tr>
          <td>${formatPayrollDate(run.period_start)} – ${formatPayrollDate(run.period_end)}</td>
          <td>${run.pay_date ? formatPayrollDate(run.pay_date) : "—"}</td>
          <td>${run.employee_count ?? 0}</td>
          <td>${formatPayrollCurrency(run.gross_payroll)}</td>
          <td>${formatPayrollCurrency(run.total_deductions)}</td>
          <td><strong>${formatPayrollCurrency(run.net_payroll)}</strong></td>
          <td>
            <span class="payroll-history-status" data-status="${escapePayrollHtml(status)}">
              ${escapePayrollHtml(status)}
            </span>
          </td>
          <td>
            <button type="button" class="payroll-history-view" data-run-view="${escapePayrollHtml(run.id)}">View</button>
            ${
              canOpen
                ? `<button type="button" class="payroll-history-view" data-run-open="${escapePayrollHtml(run.id)}">Open</button>`
                : ""
            }
          </td>
        </tr>
      `;
    })
    .join("");
}

async function openPayrollRunForEditing(runId) {
  const run = payrollHistoryCache.find((r) => r.id === runId);

  if (!run) {
    return;
  }

  if (
    payrollDirty &&
    !window.confirm("You have unsaved pay items. Open this payroll and discard them?")
  ) {
    return;
  }

  localStorage.setItem("kairoxPayrollPeriodStart", run.period_start);
  localStorage.setItem("kairoxPayrollPeriodEnd", run.period_end);

  if (run.pay_date) {
    localStorage.setItem("kairoxPayrollPayDate", run.pay_date);
  }

  if (run.pay_frequency) {
    localStorage.setItem("kairoxPayrollFrequency", run.pay_frequency);
  }

  const periodText =
    `${formatPayrollDate(run.period_start)} – ${formatPayrollDate(run.period_end)}`;

  localStorage.setItem("kairoxPayrollPeriod", periodText);
  setPayrollText("payrollPeriodDisplay", periodText);

  await loadPayrollDashboard();
  window.scrollTo?.({ top: 0, behavior: "smooth" });
}

function runDetailMeta(run) {
  const bits = [
    `${run.pay_frequency || "Payroll"}`,
    `Pay date: ${run.pay_date ? formatPayrollDate(run.pay_date) : "Not specified"}`,
    `Status: ${run.status || "processed"}`
  ];

  if (run.created_by) bits.push(`Prepared by ${run.created_by}`);
  if (run.approved_by) bits.push(`Approved by ${run.approved_by}`);
  if (run.processed_by) bits.push(`Processed by ${run.processed_by}`);
  if (run.status === "reversed") {
    bits.push(`Reversed by ${run.reversed_by || "unknown"}: ${run.reversal_reason || "no reason recorded"}`);
  }

  return bits.join(" · ");
}

async function viewPayrollRun(runId) {
  const detailSection = document.getElementById("payrollHistoryDetailSection");
  const detailBody = document.getElementById("payrollHistoryDetailBody");

  if (!detailSection || !detailBody) {
    return;
  }

  detailBody.innerHTML = `
    <tr>
      <td colspan="10">Loading payroll run details...</td>
    </tr>
  `;

  const { data: run, error: runError } = await supabaseClient
    .from("payroll_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (runError) {
    console.error("Could not load payroll run:", runError);
    detailBody.innerHTML = `
      <tr>
        <td colspan="10">Payroll run could not be loaded.</td>
      </tr>
    `;
    return;
  }

  const { data: items, error: itemsError } = await supabaseClient
    .from("payroll_run_items")
    .select("*")
    .eq("payroll_run_id", runId)
    .order("employee_name", { ascending: true });

  if (itemsError) {
    console.error("Could not load payroll run items:", itemsError);
    detailBody.innerHTML = `
      <tr>
        <td colspan="10">Employee payroll records could not be loaded.</td>
      </tr>
    `;
    return;
  }

  payrollViewedRun = run;
  payrollViewedItems = items || [];

  setPayrollText(
    "payrollHistoryDetailPeriod",
    `${formatPayrollDate(run.period_start)} – ${formatPayrollDate(run.period_end)}`
  );
  setPayrollText("payrollHistoryDetailMeta", runDetailMeta(run));
  setPayrollText("historyEmployeeCount", run.employee_count ?? 0);
  setPayrollText("historyGrossPayroll", formatPayrollCurrency(run.gross_payroll));
  setPayrollText("historyTotalDeductions", formatPayrollCurrency(run.total_deductions));
  setPayrollText("historyNetPayroll", formatPayrollCurrency(run.net_payroll));

  if (payrollViewedItems.length === 0) {
    detailBody.innerHTML = `
      <tr>
        <td colspan="10">No employee records were saved for this payroll run.</td>
      </tr>
    `;
  } else {
    detailBody.innerHTML = payrollViewedItems
      .map(
        (item) => `
          <tr>
            <td><strong>${escapePayrollHtml(item.employee_name)}</strong></td>
            <td>${escapePayrollHtml(item.department || "—")}</td>
            <td>${formatPayrollCurrency(item.gross_pay)}</td>
            <td>${formatPayrollCurrency(item.paye)}</td>
            <td>${formatPayrollCurrency(item.nis)}</td>
            <td>${formatPayrollCurrency(item.nht)}</td>
            <td>${formatPayrollCurrency(item.education_tax)}</td>
            <td>${formatPayrollCurrency(item.total_deductions)}</td>
            <td><strong>${formatPayrollCurrency(item.net_pay)}</strong></td>
            <td>
              <a class="payroll-history-view"
                 href="payslip.html?run=${encodeURIComponent(runId)}&employee=${encodeURIComponent(item.employee_id || "")}">
                Payslip
              </a>
            </td>
          </tr>
        `
      )
      .join("");
  }

  renderRunExtras(run, payrollViewedItems);

  detailSection.hidden = false;
  detailSection.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

function renderRunExtras(run, items) {
  const section = document.getElementById("payrollHistoryDetailSection");

  if (!section) {
    return;
  }

  let extras = document.getElementById("payrollRunExtras");

  if (!extras) {
    extras = document.createElement("div");
    extras.id = "payrollRunExtras";
    extras.className = "payroll-extras";

    const summary = section.querySelector(".payroll-history-detail-summary");

    if (summary) {
      summary.insertAdjacentElement("afterend", extras);
    } else {
      section.insertBefore(extras, section.firstChild);
    }
  }

  const rem = statutoryRemittance(items);
  const money = formatPayrollCurrency;

  extras.innerHTML = `
    <div>
      <button type="button" data-run-excel="${escapePayrollHtml(run.id)}">Download Excel</button>
      <button type="button" data-run-reconcile="${escapePayrollHtml(run.id)}">Check figures</button>
    </div>
    <h3 style="margin:16px 0 4px">Statutory remittance (S01)</h3>
    <p style="margin:0;color:#6f7285;font-size:.85rem">
      Due by ${escapePayrollHtml(remittanceDueText(run.pay_date || run.period_end))}.
      If that is a weekend or holiday, confirm the date with TAJ.
      ${rem.legacy ? " Employer shares were not recorded for some lines of this run." : ""}
    </p>
    <table>
      <thead><tr><th>Item</th><th>Employee</th><th>Employer</th><th>Total</th></tr></thead>
      <tbody>
        <tr><td>PAYE</td><td>${money(rem.paye)}</td><td>—</td><td>${money(rem.paye)}</td></tr>
        <tr><td>NIS</td><td>${money(rem.nis.employee)}</td><td>${money(rem.nis.employer)}</td><td>${money(rem.nis.employee + rem.nis.employer)}</td></tr>
        <tr><td>NHT</td><td>${money(rem.nht.employee)}</td><td>${money(rem.nht.employer)}</td><td>${money(rem.nht.employee + rem.nht.employer)}</td></tr>
        <tr><td>Education Tax</td><td>${money(rem.edTax.employee)}</td><td>${money(rem.edTax.employer)}</td><td>${money(rem.edTax.employee + rem.edTax.employer)}</td></tr>
        <tr><td>HEART/NSTA Trust</td><td>—</td><td>${money(rem.heart)}</td><td>${money(rem.heart)}</td></tr>
        <tr><td><strong>Total to remit</strong></td><td></td><td></td><td><strong>${money(rem.total)}</strong></td></tr>
      </tbody>
    </table>
    <div id="payrollReconcileResult"></div>
  `;
}

// Recomputes every saved line from its own stored inputs and compares with what was saved.
function reconcilePayrollRun(runId) {
  const box = document.getElementById("payrollReconcileResult");
  const run = payrollViewedRun;

  if (!box || !run || run.id !== runId) {
    return;
  }

  const round = PayrollEngine.round2;
  const n = payrollNumber;
  const problems = [];
  const hasSnapshot = run.rates_snapshot && Object.keys(run.rates_snapshot).length > 0;
  const runRates = hasSnapshot ? { ...rates, ...run.rates_snapshot } : rates;

  payrollViewedItems.forEach((item) => {
    const stored = item.inputs || {};
    const frequency = String(stored.frequency || run.pay_frequency || "").toLowerCase();

    if (!["weekly", "fortnightly", "monthly"].includes(frequency)) {
      problems.push(`${item.employee_name}: pay frequency is unknown, so it cannot be rechecked.`);
      return;
    }

    const calc = PayrollEngine.calculate(
      {
        period: frequency,
        basic: n(item.basic_salary),
        overtime: n(item.overtime),
        bonus: n(item.bonus),
        taxableAllowances: n(item.taxable_allowance),
        exemptAllowances: n(item.exempt_allowance),
        adjustments: n(item.adjustment),
        pension: n(item.pension),
        otherDeductions: round(n(item.loan_deduction) + n(item.other_deductions)),
        payeAdjustment: n(stored.payeAdjustment),
        exempt: stored.exempt
      },
      runRates
    );

    [
      ["gross pay", item.gross_pay, calc.gross],
      ["PAYE", item.paye, calc.paye],
      ["NIS", item.nis, calc.nis],
      ["NHT", item.nht, calc.nht],
      ["Education Tax", item.education_tax, calc.edTax],
      ["total deductions", item.total_deductions, calc.totalDeductions],
      ["net pay", item.net_pay, calc.net]
    ].forEach(([label, saved, expected]) => {
      if (Math.abs(n(saved) - expected) > 0.011) {
        problems.push(
          `${item.employee_name}: ${label} is saved as ${formatPayrollCurrency(saved)} but recalculates to ${formatPayrollCurrency(expected)}.`
        );
      }
    });
  });

  const total = (key) => round(payrollViewedItems.reduce((t, i) => t + n(i[key]), 0));

  [
    ["gross", run.gross_payroll, total("gross_pay")],
    ["PAYE", run.total_paye, total("paye")],
    ["NIS", run.total_nis, total("nis")],
    ["NHT", run.total_nht, total("nht")],
    ["Education Tax", run.total_education_tax, total("education_tax")],
    ["deductions", run.total_deductions, total("total_deductions")],
    ["net pay", run.net_payroll, total("net_pay")]
  ].forEach(([label, saved, summed]) => {
    if (Math.abs(n(saved) - summed) > 0.011) {
      problems.push(
        `Run total for ${label} is ${formatPayrollCurrency(saved)} but the lines add up to ${formatPayrollCurrency(summed)}.`
      );
    }
  });

  if (n(run.employee_count) !== payrollViewedItems.length) {
    problems.push(
      `The run says ${run.employee_count} employees but ${payrollViewedItems.length} lines are saved.`
    );
  }

  const note = hasSnapshot
    ? ""
    : " This run has no saved rates, so it was checked against the current rates.";

  box.innerHTML = problems.length
    ? `<p class="payroll-review-error">${problems.length} problem(s) found.${escapePayrollHtml(note)}</p>
       <ul class="payroll-review-list">${problems.map((p) => `<li class="payroll-review-error">${escapePayrollHtml(p)}</li>`).join("")}</ul>`
    : `<p style="color:#087b4d;font-weight:800">All ${payrollViewedItems.length} employees and the run totals reconcile.${escapePayrollHtml(note)}</p>`;

  return problems;
}

async function loadPayrollAudit() {
  if (payrollRole !== "admin" && payrollRole !== "director") {
    document.getElementById("payrollAuditSection")?.remove();
    return;
  }

  const { data, error } = await supabaseClient
    .from("activity_logs")
    .select("*")
    .eq("workspace", kairoxWorkspaceId())
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Could not load the audit trail:", error);
    return;
  }

  let section = document.getElementById("payrollAuditSection");

  if (!section) {
    section = document.createElement("section");
    section.id = "payrollAuditSection";
    section.className = "payroll-history-section";

    const anchor =
      document.getElementById("payrollHistoryDetailSection") ||
      document.querySelector(".payroll-history-section");

    if (anchor) {
      anchor.insertAdjacentElement("afterend", section);
    } else {
      (document.querySelector(".payroll-main") || document.body).appendChild(section);
    }
  }

  const rows = (data || []).slice(0, 30);

  section.innerHTML = `
    <div class="payroll-history-header">
      <div>
        <span class="payroll-history-eyebrow">AUDIT TRAIL</span>
        <h2>Recent payroll activity</h2>
        <p>Every save, approval, processing and reversal is recorded and cannot be edited.</p>
      </div>
    </div>
    <div class="payroll-history-table-wrapper">
      <table class="payroll-history-table">
        <thead><tr><th>When</th><th>Action</th><th>Details</th></tr></thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (entry) => `
                      <tr>
                        <td>${escapePayrollHtml(new Date(entry.created_at).toLocaleString("en-JM"))}</td>
                        <td>${escapePayrollHtml(entry.action)}</td>
                        <td>${escapePayrollHtml(entry.details || "")}</td>
                      </tr>
                    `
                  )
                  .join("")
              : '<tr><td colspan="3">No activity recorded yet.</td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;
}

/* ================= EXCEL EXPORT ================= */
function buildPayrollWorkbook(items, meta) {
  if (typeof XLSX === "undefined") {
    throw new Error("The Excel library did not load. Check your internet connection and try again.");
  }

  const n = payrollNumber;
  const round = PayrollEngine.round2;
  const workbook = XLSX.utils.book_new();
  const money = "#,##0.00";

  const columnLetter = (index) => XLSX.utils.encode_col(index);

  const finishSheet = (sheet, aoa, widths, moneyColumns, headerRow, totalRow) => {
    sheet["!cols"] = widths.map((wch) => ({ wch }));
    sheet["!ref"] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: aoa.length - 1, c: widths.length - 1 }
    });

    for (let r = headerRow + 1; r < aoa.length; r += 1) {
      moneyColumns.forEach((c) => {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === "number") {
          cell.z = money;
        }
      });
    }

    if (totalRow !== null) {
      const first = headerRow + 2; // spreadsheet rows are 1-based
      const last = totalRow;       // last data row (1-based) is totalRow because totalRow (0-based) = last+1 - 1
      moneyColumns.forEach((c) => {
        const address = XLSX.utils.encode_cell({ r: totalRow, c });
        const value = sheet[address] ? sheet[address].v : 0;
        sheet[address] = {
          t: "n",
          v: value,
          f: `SUM(${columnLetter(c)}${first}:${columnLetter(c)}${last})`,
          z: money
        };
      });
    }
  };

  /* ----- Sheet 1: payroll register ----- */
  const registerHeader = [
    "Employee", "TRN", "Department", "Basic pay", "Overtime", "Bonus",
    "Taxable allowances", "Adjustments", "Gross pay", "PAYE", "NIS", "NHT",
    "Education Tax", "Pension", "Loan repayment", "Other deductions",
    "Non-taxable allowances", "Total deductions", "Net pay"
  ];

  const registerTitle = [
    [meta.company],
    ["Payroll register"],
    [meta.periodText],
    [`Status: ${meta.status}${meta.payDate ? `  ·  Pay date: ${meta.payDate}` : ""}`],
    []
  ];

  const registerRows = items.map((i) => [
    i.employee_name,
    (i.inputs || {}).trn || "",
    i.department || "",
    n(i.basic_salary), n(i.overtime), n(i.bonus), n(i.taxable_allowance), n(i.adjustment),
    n(i.gross_pay), n(i.paye), n(i.nis), n(i.nht), n(i.education_tax),
    n(i.pension), n(i.loan_deduction), n(i.other_deductions),
    n(i.exempt_allowance), n(i.total_deductions), n(i.net_pay)
  ]);

  const totals = registerHeader.map((_, c) =>
    c < 3 ? "" : round(registerRows.reduce((t, row) => t + row[c], 0))
  );
  totals[0] = "TOTAL";

  const registerAoa = [...registerTitle, registerHeader, ...registerRows, totals];
  const registerSheet = XLSX.utils.aoa_to_sheet(registerAoa);
  const registerHeaderRow = registerTitle.length;
  const registerMoneyColumns = registerHeader.map((_, c) => c).filter((c) => c >= 3);

  finishSheet(
    registerSheet,
    registerAoa,
    [26, 14, 18, 13, 12, 12, 16, 13, 13, 12, 12, 12, 14, 12, 14, 15, 20, 15, 14],
    registerMoneyColumns,
    registerHeaderRow,
    registerAoa.length - 1
  );
  XLSX.utils.book_append_sheet(workbook, registerSheet, "Payroll Register");

  /* ----- Sheet 2: statutory remittance ----- */
  const rem = statutoryRemittance(items);

  const remitAoa = [
    [meta.company],
    ["Statutory remittance summary (S01)"],
    [meta.periodText],
    [`Due by ${remittanceDueText(meta.payDateRaw || meta.periodEnd)}. If that is a weekend or holiday, confirm the date with TAJ.`],
    rem.legacy ? ["Employer shares were not recorded for some lines of this run."] : [],
    [],
    ["Item", "Employee share", "Employer share", "Total to remit"],
    ["PAYE", rem.paye, 0, rem.paye],
    ["NIS", rem.nis.employee, rem.nis.employer, round(rem.nis.employee + rem.nis.employer)],
    ["NHT", rem.nht.employee, rem.nht.employer, round(rem.nht.employee + rem.nht.employer)],
    ["Education Tax", rem.edTax.employee, rem.edTax.employer, round(rem.edTax.employee + rem.edTax.employer)],
    ["HEART/NSTA Trust", 0, rem.heart, rem.heart],
    ["TOTAL TO REMIT", "", "", rem.total]
  ];
  const remitSheet = XLSX.utils.aoa_to_sheet(remitAoa);
  finishSheet(remitSheet, remitAoa, [26, 18, 18, 18], [1, 2, 3], 6, null);
  XLSX.utils.book_append_sheet(workbook, remitSheet, "Statutory Remittance");

  /* ----- Sheet 3: employer cost ----- */
  const costHeader = [
    "Employee", "Gross pay", "Non-taxable allowances", "Employer NIS", "Employer NHT",
    "Employer Education Tax", "Employer HEART/NSTA", "Total employer contributions", "Total cost to employer"
  ];
  const costRows = items.map((i) => {
    const e = i.employer_contributions || {};
    const contributions = round(n(e.nis) + n(e.nht) + n(e.edTax) + n(e.heart));
    return [
      i.employee_name, n(i.gross_pay), n(i.exempt_allowance), n(e.nis), n(e.nht),
      n(e.edTax), n(e.heart), contributions, round(n(i.gross_pay) + n(i.exempt_allowance) + contributions)
    ];
  });
  const costTotals = costHeader.map((_, c) =>
    c === 0 ? "TOTAL" : round(costRows.reduce((t, row) => t + row[c], 0))
  );
  const costTitle = [[meta.company], ["Employer cost"], [meta.periodText], []];
  const costAoa = [...costTitle, costHeader, ...costRows, costTotals];
  const costSheet = XLSX.utils.aoa_to_sheet(costAoa);
  finishSheet(
    costSheet, costAoa, [26, 14, 20, 14, 14, 20, 18, 26, 22],
    [1, 2, 3, 4, 5, 6, 7, 8], costTitle.length, costAoa.length - 1
  );
  XLSX.utils.book_append_sheet(workbook, costSheet, "Employer Cost");

  return workbook;
}

function payrollExcelFilename(start, end) {
  return `Kairox_Pay_Payroll_${start || "period"}_to_${end || "period"}.xlsx`;
}

function exportPayrollExcel() {
  if (!currentPayrollRows.length) {
    payrollNotify("error", "There is no payroll data to export.");
    return;
  }

  const { periodStart, periodEnd, payDate } = payrollPeriodSettings();
  const monthlyPayroll = currentPayrollRows.reduce(
    (total, row) => total + payrollNumber(row.employee.gross),
    0
  );

  const items = currentPayrollRows.map((row) => rowToItem(row, monthlyPayroll > 14444));
  const state = payrollState();

  try {
    const workbook = buildPayrollWorkbook(items, {
      company: payrollCompanyHeading(),
      periodText: `${formatPayrollDate(periodStart)} – ${formatPayrollDate(periodEnd)}`,
      status: payrollStatusLabel(state),
      payDate: payDate ? formatPayrollDate(payDate) : "",
      payDateRaw: payDate,
      periodEnd
    });

    XLSX.writeFile(workbook, payrollExcelFilename(periodStart, periodEnd));
  } catch (error) {
    console.error("Excel export failed:", error);
    payrollNotify("error", error.message || "The Excel file could not be created.");
  }
}

function exportPayrollRun(runId) {
  const run = payrollViewedRun;

  if (!run || run.id !== runId) {
    return;
  }

  try {
    const workbook = buildPayrollWorkbook(payrollViewedItems, {
      company: payrollCompanyHeading(),
      periodText: `${formatPayrollDate(run.period_start)} – ${formatPayrollDate(run.period_end)}`,
      status: run.status,
      payDate: run.pay_date ? formatPayrollDate(run.pay_date) : "",
      payDateRaw: run.pay_date,
      periodEnd: run.period_end
    });

    XLSX.writeFile(workbook, payrollExcelFilename(run.period_start, run.period_end));
  } catch (error) {
    console.error("Excel export failed:", error);
    payrollNotify("error", error.message || "The Excel file could not be created.");
  }
}

/* ================= PAGE START-UP ================= */
async function initPayrollPage() {
  // reports.html and payslip.html also load this file for the calculation functions.
  if (!document.getElementById("payrollEmployeeTableBody")) {
    return;
  }

  // Load the shared pay period and company profile before anything reads them.
  if (!window.KairoxCompany && typeof kairoxEnsureTopbar === "function") {
    await kairoxEnsureTopbar();
  }

  if (window.KairoxCompany) {
    await window.KairoxCompany.ready();
  }

  setupPayrollPeriodChanger();
  loadPayrollDashboard();

  document
    .getElementById("payrollEmployeeSearch")
    ?.addEventListener("input", renderPayrollEmployeeTable);

  document
    .getElementById("exportPayrollExcelBtn")
    ?.addEventListener("click", exportPayrollExcel);

  document
    .getElementById("closePayrollHistoryDetailBtn")
    ?.addEventListener("click", () => {
      const section = document.getElementById("payrollHistoryDetailSection");
      if (section) {
        section.hidden = true;
      }
    });

  document.addEventListener("click", (event) => {
    const target = event.target;
    const find = (attribute) => target.closest && target.closest(`[${attribute}]`);

    const payItems = find("data-pay-items");
    if (payItems) {
      openPayItemsDialog(payItems.getAttribute("data-pay-items"));
      return;
    }

    const view = find("data-run-view");
    if (view) {
      viewPayrollRun(view.getAttribute("data-run-view"));
      return;
    }

    const open = find("data-run-open");
    if (open) {
      openPayrollRunForEditing(open.getAttribute("data-run-open"));
      return;
    }

    const excel = find("data-run-excel");
    if (excel) {
      exportPayrollRun(excel.getAttribute("data-run-excel"));
      return;
    }

    const reconcile = find("data-run-reconcile");
    if (reconcile) {
      reconcilePayrollRun(reconcile.getAttribute("data-run-reconcile"));
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPayrollPage);
} else {
  initPayrollPage();
}