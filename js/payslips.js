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

function escapePayslipsHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPayslipsCurrency(value) {
  return new Intl.NumberFormat("en-JM", {
    style: "currency",
    currency: "JMD",
    currencyDisplay: "code",
    minimumFractionDigits: 2
  }).format(Number(value || 0));
}

function setPayslipsText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

function getEmployeeName(employee) {
  return (
    employee.full_name ||
    employee.name ||
    `${employee.first_name || ""} ${employee.last_name || ""}`.trim() ||
    "Unnamed Employee"
  );
}

async function loadPayslipsPage() {
  const selectedPayslipRunId =
  localStorage.getItem(
    "kairoxSelectedPayslipRunId"
  );

  const periodStart =
  localStorage.getItem("kairoxPayrollPeriodStart");

const periodEnd =
  localStorage.getItem("kairoxPayrollPeriodEnd");

let processedPayrollRun = null;

if (selectedPayslipRunId) {
  const {
    data: selectedPayrollRun,
    error: selectedPayrollRunError
  } =
    await supabaseClient
      .from("payroll_runs")
      .select("*")
      .eq("id", selectedPayslipRunId)
      .eq("workspace", kairoxWorkspaceId())
      .eq("status", "processed")
      .maybeSingle();

  if (selectedPayrollRunError) {
    console.error(
      "Could not load selected payslip run:",
      selectedPayrollRunError
    );
  } else if (selectedPayrollRun) {
    processedPayrollRun =
      selectedPayrollRun;
  }
}

if (
  !processedPayrollRun &&
  periodStart &&
  periodEnd
) {

  const {
    data: savedPayrollRun,
    error: savedPayrollRunError
  } =
    await supabaseClient
      .from("payroll_runs")
      .select("*")
      .eq("workspace", kairoxWorkspaceId())
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .neq("status", "reversed")
      .maybeSingle();

  if (savedPayrollRunError) {
    console.error(
      "Could not check processed payroll:",
      savedPayrollRunError
    );
  } else if (
    savedPayrollRun &&
    savedPayrollRun.status === "processed"
  ) {
    processedPayrollRun = savedPayrollRun;
  }
}
  const { data: employees, error } = await supabaseClient
    .from("employees")
    .select("*")
    .eq("workspace", kairoxWorkspaceId())
    .neq("employment_status", "archived");

  if (error) {
    console.error("Could not load payslips:", error);

    const tableBody =
      document.getElementById("payslipsTableBody");

    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="7">
            Unable to load payslips.
          </td>
        </tr>
      `;
    }

    return;
  }

  let payslipRows = [];

if (processedPayrollRun) {
  const {
    data: savedPayslipItems,
    error: savedPayslipItemsError
  } =
    await supabaseClient
      .from("payroll_run_items")
      .select("*")
      .eq(
        "payroll_run_id",
        processedPayrollRun.id
      )
      .order("employee_name", {
        ascending: true
      });

  if (savedPayslipItemsError) {
    console.error(
      "Could not load saved payslips:",
      savedPayslipItemsError
    );

    const tableBody =
      document.getElementById("payslipsTableBody");

    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="7">
            Saved payslips could not be loaded.
          </td>
        </tr>
      `;
    }

    return;
  }

  payslipRows =
    (savedPayslipItems || []).map((item) => ({
      id: item.employee_id,
      employeeName:
        item.employee_name || "Unnamed Employee",
      department:
        item.department || "—",
      grossPay:
        Number(item.gross_pay || 0),
      totalDeductions:
        Number(item.total_deductions || 0),
      netPay:
        Number(item.net_pay || 0),
      payrollRunId:
        processedPayrollRun.id,
      isProcessed: true
    }));
}  else {
  payslipRows = [];
}

  const tableBody =
    document.getElementById("payslipsTableBody");

  if (tableBody) {
    tableBody.innerHTML = payslipRows.length
      ? payslipRows
          .map(
            (row) => `
              <tr>
                <td>
                  <strong>
                    ${escapePayslipsHtml(row.employeeName)}
                  </strong>
                </td>

                <td>
                  ${escapePayslipsHtml(row.department)}
                </td>

                <td>
                  ${formatPayslipsCurrency(row.grossPay)}
                </td>

                <td>
                  ${formatPayslipsCurrency(row.totalDeductions)}
                </td>

                <td>
                  <strong>
                    ${formatPayslipsCurrency(row.netPay)}
                  </strong>
                </td>

                <td>
                  <span class="payslip-status">
                    Generated
                  </span>
                </td>

                <td>
                  <a
                    class="payslip-view-link"
                    href="${
  row.isProcessed && row.payrollRunId
    ? `payslip.html?run=${encodeURIComponent(row.payrollRunId)}&employee=${encodeURIComponent(row.id)}`
    : `payslip.html?id=${encodeURIComponent(row.id)}`
}"
                  >
                    View Payslip
                  </a>
                </td>
              </tr>
            `
          )
          .join("")
      : `
        <tr>
          <td colspan="7">
            No payslips yet. They appear here once a payroll has been processed.
          </td>
        </tr>
      `;
  }

  const grossTotal = payslipRows.reduce(
    (total, row) => total + row.grossPay,
    0
  );

  const netTotal = payslipRows.reduce(
    (total, row) => total + row.netPay,
    0
  );

  setPayslipsText(
    "payslipsEmployeeCount",
    payslipRows.length
  );

  setPayslipsText(
    "payslipsGrossTotal",
    formatPayslipsCurrency(grossTotal)
  );

  setPayslipsText(
    "payslipsNetTotal",
    formatPayslipsCurrency(netTotal)
  );

  enablePayslipSearch(payslipRows);
}

function enablePayslipSearch(payslipRows) {
  const searchInput =
    document.getElementById("payslipSearch");

  const tableBody =
    document.getElementById("payslipsTableBody");

  if (!searchInput || !tableBody) {
    return;
  }

  searchInput.addEventListener("input", () => {
    const searchTerm =
      searchInput.value.trim().toLowerCase();

    const filteredRows =
      payslipRows.filter((row) => {
        const searchableText = `
          ${escapePayslipsHtml(row.employeeName)}
          ${escapePayslipsHtml(row.department)}
        `.toLowerCase();

        return searchableText.includes(searchTerm);
      });

    tableBody.innerHTML = filteredRows.length
      ? filteredRows
          .map(
            (row) => `
              <tr>
                <td>
                  <strong>${escapePayslipsHtml(row.employeeName)}</strong>
                </td>

                <td>${escapePayslipsHtml(row.department)}</td>

                <td>
                  ${formatPayslipsCurrency(row.grossPay)}
                </td>

                <td>
                  ${formatPayslipsCurrency(row.totalDeductions)}
                </td>

                <td>
                  <strong>
                    ${formatPayslipsCurrency(row.netPay)}
                  </strong>
                </td>

                <td>
                  <span class="payslip-status">
                    Generated
                  </span>
                </td>

                <td>
                  <a
                    class="payslip-view-link"
                    href="${
  row.isProcessed && row.payrollRunId
    ? `payslip.html?run=${encodeURIComponent(row.payrollRunId)}&employee=${encodeURIComponent(row.id)}`
    : `payslip.html?id=${encodeURIComponent(row.id)}`
}"
                  >
                    View Payslip
                  </a>
                </td>
              </tr>
            `
          )
          .join("")
      : `
        <tr>
          <td colspan="7">
            No matching payslips found.
          </td>
        </tr>
      `;
  });
}

function setupPayslipPeriodSelector() {
  const periodSelect =
    document.getElementById("payslipsPeriodSelect");

  if (!periodSelect) {
    return;
  }

  periodSelect.addEventListener(
    "change",
    async () => {
      const selectedRunId =
        periodSelect.value;

      if (!selectedRunId) {
        localStorage.removeItem(
          "kairoxSelectedPayslipRunId"
        );
      } else {
        localStorage.setItem(
          "kairoxSelectedPayslipRunId",
          selectedRunId
        );
      }

      try {
        await loadPayslipsPage();
        await loadActivePayrollPeriod();
      } catch (error) {
        console.error("Could not switch the payslip period:", error);
      }

      if (document.getElementById("payslipArchive")) {
        renderPayslipArchive();
      }
    }
  );
}

async function loadPayslipPeriodOptions() {
  const periodSelect =
    document.getElementById("payslipsPeriodSelect");

  if (!periodSelect) {
    return;
  }

  const {
    data: payrollRuns,
    error
  } =
    await supabaseClient
      .from("payroll_runs")
      .select("id, period_start, period_end, status")
      .eq("workspace", kairoxWorkspaceId())
      .eq("status", "processed")
      .order("period_start", {
        ascending: false
      });

  if (error) {
    console.error(
      "Could not load payslip periods:",
      error
    );

    return;
  }

  periodSelect.innerHTML = `
    <option value="">
      Current Pay Period
    </option>
  `;

  (payrollRuns || []).forEach((run) => {
    const option =
      document.createElement("option");

    option.value = run.id;

    option.textContent =
      `${formatPayslipsDate(run.period_start)} – ` +
      `${formatPayslipsDate(run.period_end)}`;

    periodSelect.appendChild(option);
  });

  if (!payrollRuns || payrollRuns.length === 0) {
    const note = document.createElement("option");
    note.value = "";
    note.disabled = true;
    note.textContent = "No processed payrolls yet";
    periodSelect.appendChild(note);
  }

  const savedSelectedRunId =
    localStorage.getItem(
      "kairoxSelectedPayslipRunId"
    );

  if (savedSelectedRunId) {
    if ((payrollRuns || []).some((run) => run.id === savedSelectedRunId)) {
      periodSelect.value = savedSelectedRunId;
    } else {
      // That payroll was reversed or removed, so stop remembering it.
      localStorage.removeItem("kairoxSelectedPayslipRunId");
    }
  }
}

// The pay period and company details are shared; load them before the page reads them.
async function waitForCompany() {
  await kairoxEnsureTopbar();

  if (window.KairoxCompany) {
    await window.KairoxCompany.ready();
  }
}

/* =====================================================
   PAYSLIP ARCHIVE: find any processed payroll by period
===================================================== */
let payslipArchiveRuns = [];

function archiveWhen(run) {
  return run.pay_date || run.period_end;
}

function archiveRunText(run) {
  return `${formatPayslipsDate(run.period_start)} – ${formatPayslipsDate(run.period_end)}`;
}

function ensurePayslipArchiveCard() {
  let card = document.getElementById("payslipArchive");

  if (card) {
    return card;
  }

  card = document.createElement("section");
  card.id = "payslipArchive";
  card.className = "report-detail-card";
  card.innerHTML = `
    <div class="report-detail-header">
      <div>
        <span class="reports-eyebrow">PAYSLIP ARCHIVE</span>
        <h2>Processed payrolls</h2>
        <p>Search for a pay period, then open its payslips.</p>
      </div>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-bottom:16px">
      <div style="flex:1 1 220px">
        <label for="archiveSearch" style="display:block;margin-bottom:6px;font-size:.8rem;font-weight:800;color:#303145">Search period</label>
        <input id="archiveSearch" type="search" placeholder="for example: October 2026" style="width:100%;min-height:42px;padding:9px 12px;border:1px solid #dfe0e8;border-radius:10px;font:inherit">
      </div>
      <div>
        <label for="archiveYear" style="display:block;margin-bottom:6px;font-size:.8rem;font-weight:800;color:#303145">Year</label>
        <select id="archiveYear" style="min-height:42px;padding:9px 12px;border:1px solid #dfe0e8;border-radius:10px;font:inherit;background:#fff"></select>
      </div>
      <div>
        <label for="archiveFrom" style="display:block;margin-bottom:6px;font-size:.8rem;font-weight:800;color:#303145">Paid from</label>
        <input id="archiveFrom" type="date" style="min-height:42px;padding:9px 12px;border:1px solid #dfe0e8;border-radius:10px;font:inherit">
      </div>
      <div>
        <label for="archiveTo" style="display:block;margin-bottom:6px;font-size:.8rem;font-weight:800;color:#303145">Paid to</label>
        <input id="archiveTo" type="date" style="min-height:42px;padding:9px 12px;border:1px solid #dfe0e8;border-radius:10px;font:inherit">
      </div>
      <button id="archiveClear" type="button" style="min-height:42px;padding:9px 16px;border:1px solid #dfe0e8;border-radius:10px;background:#fff;color:#35156f;font:inherit;font-weight:800;cursor:pointer">Clear</button>
    </div>

    <p id="archiveCount" style="margin:0 0 10px;color:#6f7285;font-size:.86rem"></p>

    <div class="report-table-wrap">
      <table class="report-table">
        <thead>
          <tr><th>Pay period</th><th>Pay date</th><th>Employees</th><th>Net payroll</th><th></th></tr>
        </thead>
        <tbody id="archiveBody"></tbody>
      </table>
    </div>
  `;

  const table = document.getElementById("payslipsTableBody")?.closest("table");
  const anchor =
    (table && (table.closest(".report-detail-card") || table.parentElement)) ||
    document.querySelector("main") ||
    document.body;

  anchor.parentElement
    ? anchor.parentElement.insertBefore(card, anchor)
    : document.body.appendChild(card);

  card.querySelector("#archiveSearch").addEventListener("input", renderPayslipArchive);
  card.querySelector("#archiveYear").addEventListener("change", renderPayslipArchive);
  card.querySelector("#archiveFrom").addEventListener("change", renderPayslipArchive);
  card.querySelector("#archiveTo").addEventListener("change", renderPayslipArchive);

  card.querySelector("#archiveClear").addEventListener("click", () => {
    card.querySelector("#archiveSearch").value = "";
    card.querySelector("#archiveYear").value = "";
    card.querySelector("#archiveFrom").value = "";
    card.querySelector("#archiveTo").value = "";
    renderPayslipArchive();
  });

  card.addEventListener("click", (event) => {
    const button = event.target.closest("[data-archive-open]");

    if (button) {
      openArchivedPayroll(button.getAttribute("data-archive-open"));
    }
  });

  return card;
}

function renderPayslipArchive() {
  const card = ensurePayslipArchiveCard();
  const body = card.querySelector("#archiveBody");
  const count = card.querySelector("#archiveCount");
  const yearSelect = card.querySelector("#archiveYear");

  // Year choices come from the payrolls that actually exist.
  const years = [...new Set(payslipArchiveRuns.map((run) => archiveWhen(run).slice(0, 4)))]
    .sort()
    .reverse();
  const chosenYear = yearSelect.value;

  yearSelect.innerHTML =
    '<option value="">All years</option>' +
    years.map((year) => `<option value="${year}">${year}</option>`).join("");
  yearSelect.value = years.includes(chosenYear) ? chosenYear : "";

  if (payslipArchiveRuns.length === 0) {
    count.textContent = "";
    body.innerHTML =
      '<tr><td colspan="5">No payrolls have been processed yet. They appear here once you process one.</td></tr>';
    return;
  }

  const term = card.querySelector("#archiveSearch").value.trim().toLowerCase();
  const year = yearSelect.value;
  const from = card.querySelector("#archiveFrom").value;
  const to = card.querySelector("#archiveTo").value;

  const matches = payslipArchiveRuns.filter((run) => {
    const when = archiveWhen(run);

    if (year && !when.startsWith(year)) return false;
    if (from && when < from) return false;
    if (to && when > to) return false;

    if (term) {
      const haystack = [
        archiveRunText(run),
        formatPayslipsDate(archiveWhen(run)),
        run.period_start,
        run.period_end
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(term);
    }

    return true;
  });

  count.textContent = `Showing ${matches.length} of ${payslipArchiveRuns.length} processed payroll${
    payslipArchiveRuns.length === 1 ? "" : "s"
  }.`;

  const selectedId = localStorage.getItem("kairoxSelectedPayslipRunId");

  body.innerHTML = matches.length
    ? matches
        .map(
          (run) => `
            <tr${run.id === selectedId ? ' style="background:#f6f2fb"' : ""}>
              <td><strong>${escapePayslipsHtml(archiveRunText(run))}</strong></td>
              <td>${run.pay_date ? escapePayslipsHtml(formatPayslipsDate(run.pay_date)) : "—"}</td>
              <td>${run.employee_count ?? 0}</td>
              <td>${formatPayslipsCurrency(run.net_payroll)}</td>
              <td>
                <button type="button" class="payslip-view-link" data-archive-open="${escapePayslipsHtml(run.id)}">
                  ${run.id === selectedId ? "Showing" : "View payslips"}
                </button>
              </td>
            </tr>
          `
        )
        .join("")
    : '<tr><td colspan="5">No pay periods match your search. Try a different month or clear the filters.</td></tr>';
}

async function loadPayslipArchive() {
  const { data, error } = await supabaseClient
    .from("payroll_runs")
    .select("*")
    .eq("workspace", kairoxWorkspaceId())
    .eq("status", "processed")
    .order("period_start", { ascending: false });

  if (error) {
    console.error("Could not load the payslip archive:", error);
    return;
  }

  payslipArchiveRuns = data || [];
  renderPayslipArchive();
}

async function openArchivedPayroll(runId) {
  localStorage.setItem("kairoxSelectedPayslipRunId", runId);

  const select = document.getElementById("payslipsPeriodSelect");

  if (select) {
    select.value = runId;
  }

  try {
    await loadPayslipsPage();
    await loadActivePayrollPeriod();
  } catch (error) {
    console.error("Could not open that payroll:", error);
  }

  renderPayslipArchive();

  document
    .getElementById("payslipsTableBody")
    ?.closest("table")
    ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    // Wire the dropdown first, so it still works if a later step has a problem.
    setupPayslipPeriodSelector();

    for (const step of [
      waitForCompany,
      loadPayslipsPage,
      loadActivePayrollPeriod,
      loadPayslipPeriodOptions,
      loadPayslipArchive
    ]) {
      try {
        await step();
      } catch (error) {
        console.error(`Payslips page step failed (${step.name}):`, error);
      }
    }
  }
);


if (window.lucide) {
  lucide.createIcons();
}

function formatPayslipsDate(dateString) {
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

async function loadActivePayrollPeriod() {
  const selectedPayslipRunId =
  localStorage.getItem(
    "kairoxSelectedPayslipRunId"
  );

  const periodStart =
    localStorage.getItem("kairoxPayrollPeriodStart");

  const periodEnd =
    localStorage.getItem("kairoxPayrollPeriodEnd");

  const periodDisplay =
    document.getElementById("payslipsPayPeriod");

  if (!periodDisplay) {
    return;
  }

 if (selectedPayslipRunId) {
  const {
    data: selectedPayrollRun,
    error: selectedPayrollRunError
  } =
    await supabaseClient
      .from("payroll_runs")
      .select(
        "period_start, period_end, status"
      )
      .eq("id", selectedPayslipRunId)
      .eq("workspace", kairoxWorkspaceId())
      .eq("status", "processed")
      .maybeSingle();

  if (selectedPayrollRunError) {
    console.error(
      "Could not load selected payroll period:",
      selectedPayrollRunError
    );
  } else if (selectedPayrollRun) {
    periodDisplay.textContent =
      `${formatPayslipsDate(
        selectedPayrollRun.period_start
      )} – ${formatPayslipsDate(
        selectedPayrollRun.period_end
      )}`;

    return;
  }

    const {
      data: savedPayrollRun,
      error: savedPayrollRunError
    } =
      await supabaseClient
        .from("payroll_runs")
        .select(
          "period_start, period_end, status"
        )
        .eq("workspace", kairoxWorkspaceId())
        .eq("period_start", periodStart)
        .eq("period_end", periodEnd)
        .neq("status", "reversed")
        .maybeSingle();

    if (savedPayrollRunError) {
      console.error(
        "Could not load active payroll period:",
        savedPayrollRunError
      );
    } else if (
      savedPayrollRun &&
      savedPayrollRun.status === "processed"
    ) {
      periodDisplay.textContent =
        `${formatPayslipsDate(
          savedPayrollRun.period_start
        )} – ${formatPayslipsDate(
          savedPayrollRun.period_end
        )}`;

      return;
    }
  }

  const savedPeriod =
    localStorage.getItem("kairoxPayrollPeriod");

  if (savedPeriod) {
    periodDisplay.textContent = savedPeriod;
  }
}