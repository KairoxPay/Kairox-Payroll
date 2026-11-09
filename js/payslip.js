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

const payslipParams =
  new URLSearchParams(window.location.search);

const payslipEmployeeId =
  payslipParams.get("id");

  const payslipRunId =
  payslipParams.get("run");

const historicalEmployeeId =
  payslipParams.get("employee");

  function loadPayslipPayPeriod() {
  const savedPeriod =
    localStorage.getItem("kairoxPayrollPeriod");

  if (!savedPeriod) {
    return;
  }

  setPayslipText(
    "payslipPeriod",
    savedPeriod
  );
}

function setPayslipText(elementId, value) {
  const element =
    document.getElementById(elementId);

  if (element) {
    element.textContent = value;
  }
}

function formatPayslipCurrency(value) {
  return new Intl.NumberFormat("en-JM", {
    style: "currency",
    currency: "JMD",
    minimumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatHistoricalPayslipDate(dateString) {
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

function addPayslipExtraRows(item) {
  document.querySelectorAll(".payslip-extra-row").forEach((el) => el.remove());

  const n = (value) => Number(value || 0);

  const row = (label, value) => `
    <div class="payslip-row payslip-extra-row">
      <span>${label}</span>
      <strong>${formatPayslipCurrency(value)}</strong>
    </div>
  `;

  const earnings = [
    ["Overtime", item.overtime],
    ["Bonus", item.bonus],
    ["Taxable allowances", item.taxable_allowance],
    ["Adjustment", item.adjustment],
    ["Non-taxable allowances", item.exempt_allowance]
  ].filter(([, value]) => n(value) !== 0);

  const deductions = [
    ["Pension", item.pension],
    ["Loan repayment", item.loan_deduction],
    ["Other deductions", item.other_deductions]
  ].filter(([, value]) => n(value) !== 0);

  const earningsAnchor = document
    .getElementById("payslipBasicSalary")
    ?.closest(".payslip-row");

  const deductionAnchor = document
    .getElementById("payslipEducationTax")
    ?.closest(".payslip-row");

  if (earningsAnchor && earnings.length) {
    earningsAnchor.insertAdjacentHTML(
      "afterend",
      earnings.map(([label, value]) => row(label, value)).join("")
    );
  }

  if (deductionAnchor && deductions.length) {
    deductionAnchor.insertAdjacentHTML(
      "afterend",
      deductions.map(([label, value]) => row(label, value)).join("")
    );
  }

  // Total earnings include non-taxable allowances, so earnings minus deductions equals net pay.
  setPayslipText(
    "payslipTotalEarnings",
    formatPayslipCurrency(n(item.gross_pay) + n(item.exempt_allowance))
  );
}

async function loadHistoricalPayslip(
  runId,
  employeeId
) {
  const {
    data: payrollRun,
    error: payrollRunError
  } =
    await supabaseClient
      .from("payroll_runs")
      .select("*")
      .eq("id", runId)
      .single();

  if (payrollRunError) {
    console.error(
      "Could not load historical payroll run:",
      payrollRunError
    );

    setPayslipText(
      "payslipEmployeeName",
      "Historical payslip could not be loaded"
    );

    return;
  }

  const {
    data: payrollItem,
    error: payrollItemError
  } =
    await supabaseClient
      .from("payroll_run_items")
      .select("*")
      .eq("payroll_run_id", runId)
      .eq("employee_id", employeeId)
      .single();

  if (payrollItemError) {
    console.error(
      "Could not load historical payroll item:",
      payrollItemError
    );

    setPayslipText(
      "payslipEmployeeName",
      "Historical employee record could not be loaded"
    );

    return;
  }

  setPayslipText(
    "payslipEmployeeName",
    payrollItem.employee_name || "Employee"
  );

  setPayslipText(
    "payslipEmployeeTitle",
    payrollItem.employee_title || "—"
  );

  setPayslipText(
    "payslipEmployeeDepartment",
    payrollItem.department || "—"
  );

  const historicalPeriod =
    `${formatHistoricalPayslipDate(payrollRun.period_start)} – ` +
    `${formatHistoricalPayslipDate(payrollRun.period_end)}`;

  setPayslipText(
    "payslipPeriod",
    historicalPeriod
  );

  setPayslipText(
  "payslipPayDate",
  payrollRun.pay_date
    ? formatHistoricalPayslipDate(payrollRun.pay_date)
    : "—"
);

  setPayslipText(
    "payslipGrossPay",
    formatPayslipCurrency(payrollItem.gross_pay)
  );

  setPayslipText(
    "payslipBasicSalary",
    formatPayslipCurrency(payrollItem.basic_salary)
  );

  setPayslipText(
    "payslipTotalEarnings",
    formatPayslipCurrency(payrollItem.gross_pay)
  );

  setPayslipText(
    "payslipPaye",
    formatPayslipCurrency(payrollItem.paye)
  );

  setPayslipText(
    "payslipNis",
    formatPayslipCurrency(payrollItem.nis)
  );

  setPayslipText(
    "payslipNht",
    formatPayslipCurrency(payrollItem.nht)
  );

  setPayslipText(
    "payslipEducationTax",
    formatPayslipCurrency(
      payrollItem.education_tax
    )
  );

  setPayslipText(
    "payslipDeductionTotal",
    formatPayslipCurrency(
      payrollItem.total_deductions
    )
  );

  setPayslipText(
    "payslipNetPay",
    formatPayslipCurrency(payrollItem.net_pay)
  );

  addPayslipExtraRows(payrollItem);
}

async function loadPayslip() {
    if (payslipRunId && historicalEmployeeId) {
  await loadHistoricalPayslip(
    payslipRunId,
    historicalEmployeeId
  );

  return;
}
  if (!payslipEmployeeId) {
    setPayslipText(
      "payslipEmployeeName",
      "Employee not selected"
    );

    return;
  }

  const { data: employee, error } =
    await supabaseClient
      .from("employees")
      .select("*")
      .eq("id", payslipEmployeeId)
      .single();

  if (error) {
    console.error(
      "Could not load payslip employee:",
      error
    );

    setPayslipText(
      "payslipEmployeeName",
      "Employee could not be loaded"
    );

    return;
  }

  const employeeName =
    employee.name ||
    `${employee.first_name || ""} ${employee.last_name || ""}`.trim() ||
    "Unnamed Employee";

  await loadPayrollRates();

  const { data: payDefaults } = await supabaseClient
    .from("employee_pay_defaults")
    .select("*")
    .eq("employee_id", employee.id)
    .maybeSingle();

  const employeePay =
    calculateEmployeeRow(employee, inputsFromDefaults(payDefaults));

  const grossPay =
    employeePay.grossPay;

  const calculatedPay = {
    paye: employeePay.paye,
    nis: employeePay.nis,
    nht: employeePay.nht,
    edTax: employeePay.educationTax,
    net: employeePay.netPay
  };

  const paye =
    Number(calculatedPay.paye || 0);

  const nis =
    Number(calculatedPay.nis || 0);

  const nht =
    Number(calculatedPay.nht || 0);

  const educationTax =
    Number(calculatedPay.edTax || 0);

  const totalDeductions =
    employeePay.totalDeductions;

  const netPay =
    Number(calculatedPay.net || 0);

  setPayslipText(
    "payslipEmployeeName",
    employeeName
  );

  setPayslipText(
    "payslipEmployeeTitle",
    employee.title || "—"
  );

  setPayslipText(
    "payslipEmployeeDepartment",
    employee.department || "—"
  );

  setPayslipText(
    "payslipGrossPay",
    formatPayslipCurrency(grossPay)
  );

  setPayslipText(
    "payslipTotalDeductions",
    formatPayslipCurrency(totalDeductions)
  );

  setPayslipText(
    "payslipNetPay",
    formatPayslipCurrency(netPay)
  );

  setPayslipText(
    "payslipBasicSalary",
    formatPayslipCurrency(employeePay.basic)
  );

  setPayslipText(
    "payslipTotalEarnings",
    formatPayslipCurrency(grossPay)
  );

  setPayslipText(
    "payslipPaye",
    formatPayslipCurrency(paye)
  );

  setPayslipText(
    "payslipNis",
    formatPayslipCurrency(nis)
  );

  setPayslipText(
    "payslipNht",
    formatPayslipCurrency(nht)
  );

  setPayslipText(
    "payslipEducationTax",
    formatPayslipCurrency(educationTax)
  );

  setPayslipText(
    "payslipDeductionTotal",
    formatPayslipCurrency(totalDeductions)
  );

  addPayslipExtraRows({
    overtime: employeePay.overtime,
    bonus: employeePay.bonus,
    taxable_allowance: employeePay.taxableAllowance,
    adjustment: employeePay.adjustment,
    exempt_allowance: employeePay.exemptAllowance,
    pension: employeePay.pension,
    loan_deduction: employeePay.loanDeduction,
    other_deductions: employeePay.otherDeductions,
    gross_pay: grossPay
  });
}

function setPayslipDownloadFilename() {
  const employeeName =
    document.getElementById("payslipEmployeeName")
      ?.textContent.trim() || "Employee";

  const payDateText =
    document.getElementById("payslipPayDate")
      ?.textContent.trim() || "";

  const safeName = employeeName
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "-");

  let formattedDate = "Undated";

  if (payDateText && payDateText !== "—") {
    const parsedDate = new Date(payDateText);

    if (!Number.isNaN(parsedDate.getTime())) {
      formattedDate = [
        parsedDate.getFullYear(),
        String(parsedDate.getMonth() + 1).padStart(2, "0"),
        String(parsedDate.getDate()).padStart(2, "0")
      ].join("-");
    }
  }

  document.title =
    `${safeName}-Payslip-${formattedDate}`;
}

/* =====================================================
   REAL PDF DOWNLOAD
   The PDF is drawn from the payslip on the screen, so it always
   matches what you see (including pay-item rows), and downloads
   straight away without the print dialog.
===================================================== */
const JSPDF_URL =
  "https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js";

async function ensureJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) {
    return window.jspdf.jsPDF;
  }

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = JSPDF_URL;
    script.onload = resolve;
    script.onerror = () =>
      reject(new Error("The PDF library could not be loaded."));
    document.head.appendChild(script);
  });

  return window.jspdf.jsPDF;
}

// Standard PDF fonts only cover Western characters, so swap or drop the rest.
function pdfSafe(text) {
  return String(text || "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022/g, "-")
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function payslipTextOf(element) {
  return element ? pdfSafe(element.textContent) : "";
}

function payslipLogoDataUrl() {
  try {
    const image = document.querySelector(".payslip-brand img");

    if (!image || !image.complete || !image.naturalWidth) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);

    return {
      data: canvas.toDataURL("image/png"),
      ratio: image.naturalWidth / image.naturalHeight
    };
  } catch (error) {
    return null;
  }
}

// A company logo is saved as a PNG data URL; its width and height are in the PNG header, so the PDF can keep its shape.
function payslipCompanyLogo() {
  const company = window.KairoxCompany;
  const url = company && typeof company.logo === "function" ? company.logo() : null;

  if (!url) {
    return null;
  }

  let ratio = 1;

  try {
    const start = url.indexOf(",") + 1;
    const bytes = atob(url.slice(start, start + 44));
    const read = (i) =>
      ((bytes.charCodeAt(i) << 24) | (bytes.charCodeAt(i + 1) << 16) | (bytes.charCodeAt(i + 2) << 8) | bytes.charCodeAt(i + 3)) >>> 0;
    const width = read(16);
    const height = read(20);

    if (width > 0 && height > 0) {
      ratio = width / height;
    }
  } catch (error) {
    ratio = 1;
  }

  return { data: url, ratio };
}

function collectPayslipForPdf() {
  const text = payslipTextOf;
  const query = (selector, root = document) => root.querySelector(selector);

  return {
    brand: text(query(".payslip-brand-text h1")) || "Kairox Pay",
    tagline: text(query(".payslip-brand-text p")),
    title: text(query(".payslip-meta h2")) || "Payslip",
    meta: [...document.querySelectorAll(".payslip-meta p")].map(text).filter(Boolean),
    companyLogo: payslipCompanyLogo(),
    company: text(query(".payslip-company h3")),
    companyLines: [...document.querySelectorAll(".payslip-company p")].map(text).filter(Boolean),
    employee: [...document.querySelectorAll(".payslip-employee-info > div")].map((box) => ({
      label: text(query("span", box)),
      value: text(query("strong", box))
    })),
    sections: [...document.querySelectorAll(".payslip-section")].map((section) => ({
      heading: text(query("h4", section)),
      rows: [...section.querySelectorAll(".payslip-row")].map((row) => ({
        label: text(query("span", row)),
        value: text(query("strong", row)),
        total: row.classList.contains("total-row")
      }))
    })),
    netLabel: text(query(".payslip-net-pay span")) || "Net pay",
    netValue: text(query(".payslip-net-pay strong")),
    footer: [...document.querySelectorAll(".payslip-footer p, .payslip-footer strong")]
      .map(text)
      .filter(Boolean)
  };
}

function drawPayslipPdf(JsPdf, data, logo) {
  const doc = new JsPdf({ unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 40;
  const right = width - margin;
  const purple = [43, 15, 95];
  const teal = [22, 166, 161];
  const muted = [118, 121, 138];
  const ink = [27, 29, 47];
  let y = 0;

  const ensureSpace = (needed) => {
    if (y + needed > height - 50) {
      doc.addPage();
      y = margin;
    }
  };

  // Header band
  doc.setFillColor(...purple);
  doc.rect(0, 0, width, 96, "F");

  let textLeft = margin;

  if (logo) {
    const logoHeight = 40;
    const logoWidth = Math.min(logoHeight * logo.ratio, 130);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin, 28, logoWidth + 16, logoHeight + 12, 6, 6, "F");

    try {
      doc.addImage(logo.data, "PNG", margin + 8, 34, logoWidth, logoHeight);
      textLeft = margin + logoWidth + 32;
    } catch (error) {
      textLeft = margin;
    }
  }

  if (textLeft === margin) {
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(pdfSafe(data.brand).toUpperCase(), margin, 52);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    if (data.tagline) doc.text(pdfSafe(data.tagline).toUpperCase(), margin, 68);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(pdfSafe(data.title), right, 44, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  data.meta.slice(0, 3).forEach((line, index) => {
    doc.text(line, right, 60 + index * 12, { align: "right" });
  });

  y = 124;

  // Company, with its own logo to the left when it has one
  let companyLeft = margin;
  const companyTop = y;

  if (data.companyLogo) {
    const logoHeight = 46;
    const logoWidth = Math.min(logoHeight * data.companyLogo.ratio, 150);

    try {
      doc.addImage(data.companyLogo.data, "PNG", margin, y - 14, logoWidth, logoHeight);
      companyLeft = margin + logoWidth + 14;
    } catch (error) {
      companyLeft = margin;
    }
  }

  if (data.company) {
    doc.setTextColor(...ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(data.company, companyLeft, y);
    y += 16;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  data.companyLines.forEach((line) => {
    doc.text(line, companyLeft, y);
    y += 12;
  });

  if (companyLeft !== margin) {
    y = Math.max(y, companyTop + 36);   // leave room for the logo
  }

  y += 10;
  doc.setDrawColor(230, 231, 238);
  doc.line(margin, y, right, y);
  y += 20;

  // Employee details (three per row)
  const columnWidth = (right - margin) / 3;

  data.employee.forEach((item, index) => {
    const column = index % 3;

    if (column === 0 && index > 0) {
      y += 34;
    }

    ensureSpace(34);
    const x = margin + column * columnWidth;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...muted);
    doc.text(item.label.toUpperCase(), x, y);
    doc.setFontSize(10);
    doc.setTextColor(...ink);
    doc.text(item.value || "-", x, y + 13);
  });

  y += 40;

  // Sections
  data.sections.forEach((section) => {
    ensureSpace(40);
    doc.setDrawColor(230, 231, 238);
    doc.line(margin, y, right, y);
    y += 18;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...purple);
    doc.text(section.heading.toUpperCase(), margin, y);
    y += 14;

    section.rows.forEach((row) => {
      ensureSpace(22);

      if (row.total) {
        doc.setDrawColor(...purple);
        doc.setLineWidth(1.2);
        doc.line(margin, y - 4, right, y - 4);
        doc.setLineWidth(0.5);
        y += 8;
      }

      doc.setFont("helvetica", row.total ? "bold" : "normal");
      doc.setFontSize(10);
      doc.setTextColor(...(row.total ? purple : ink));
      doc.text(row.label, margin, y);
      doc.setFont("helvetica", "bold");
      doc.text(row.value, right, y, { align: "right" });

      if (!row.total) {
        doc.setDrawColor(240, 240, 244);
        doc.line(margin, y + 7, right, y + 7);
      }

      y += 20;
    });

    y += 6;
  });

  // Net pay
  ensureSpace(60);
  doc.setDrawColor(...ink);
  doc.setLineWidth(1.6);
  doc.line(margin, y, right, y);
  doc.setLineWidth(0.5);
  y += 26;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...ink);
  doc.text(data.netLabel, margin, y);
  doc.setFontSize(17);
  doc.setTextColor(...teal);
  doc.text(data.netValue, right, y, { align: "right" });
  y += 40;

  // Footer
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  data.footer.forEach((line, index) => {
    ensureSpace(14);
    doc.text(line, width / 2, y + index * 12, { align: "center" });
  });

  return doc;
}

function payslipPdfFilename() {
  const employeeName =
    document.getElementById("payslipEmployeeName")?.textContent.trim() ||
    "Employee";

  const payDateText =
    document.getElementById("payslipPayDate")?.textContent.trim() || "";

  const safeName = employeeName
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "-") || "Employee";

  let formattedDate = "Undated";
  const parsed = new Date(payDateText);

  if (payDateText && payDateText !== "—" && !Number.isNaN(parsed.getTime())) {
    formattedDate = [
      parsed.getFullYear(),
      String(parsed.getMonth() + 1).padStart(2, "0"),
      String(parsed.getDate()).padStart(2, "0")
    ].join("-");
  }

  return `${safeName}-Payslip-${formattedDate}.pdf`;
}

async function downloadPayslipPdf() {
  try {
    const JsPdf = await ensureJsPdf();
    const doc = drawPayslipPdf(JsPdf, collectPayslipForPdf(), payslipLogoDataUrl());
    doc.save(payslipPdfFilename());
  } catch (error) {
    console.error("Could not create the PDF directly:", error);
    window.alert(
      "The PDF could not be created directly, so the print window will open. Choose 'Save as PDF' as the destination."
    );
    setPayslipDownloadFilename();
    window.print();
  }
}

document
  .getElementById("printPayslipBtn")
  ?.addEventListener(
    "click",
    () => window.print()
  );

  document
  .getElementById("downloadPayslipBtn")
  ?.addEventListener(
    "click",
    downloadPayslipPdf
  );

// Put the company profile (name, address, TRN, contact) on the payslip, so the screen, print and PDF all match.
function applyCompanyProfileToPayslip() {
  const company = window.KairoxCompany;
  const box = document.querySelector(".payslip-company");

  if (!company || !box) {
    return;
  }

  if (!company.profile()) {
    // No profile saved yet: another company must not print Kairox Exchange's name and address.
    if (company.workspace() !== "kairox-exchange") {
      const heading = box.querySelector("h3");
      if (heading) heading.textContent = company.companyName();
      box.querySelectorAll("p").forEach((line) => line.remove());
    }

    return;
  }

  const name = box.querySelector("h3");

  if (name) {
    name.textContent = company.companyName();
  }

  box.querySelectorAll("p").forEach((line) => line.remove());
  box.querySelectorAll("img.payslip-company-logo").forEach((image) => image.remove());

  company.companyLines().forEach((line) => {
    const p = document.createElement("p");
    p.textContent = line;
    box.appendChild(p);
  });

  const logo = typeof company.logo === "function" ? company.logo() : null;

  if (logo) {
    const image = document.createElement("img");
    image.className = "payslip-company-logo";
    image.alt = "";
    image.src = logo;
    image.style.cssText = "display:block;max-width:180px;max-height:56px;margin:0 0 8px;";
    box.insertBefore(image, box.firstChild);
  }
}

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    await kairoxEnsureTopbar();

    if (window.KairoxCompany) {
      await window.KairoxCompany.ready();
      applyCompanyProfileToPayslip();
    }

    loadPayslip();
    loadPayslipPayPeriod();
  }
);