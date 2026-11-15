// Employee profile: makes the "Payroll" button work. It adds a "Pay history" section (every payroll this person was in,
// newest first, with a link to each payslip) and scrolls to it. Only staff who can read payroll see figures: the
// database refuses everyone else, and the section then explains that instead.

(function () {
  const params = new URLSearchParams(window.location.search);
  const employeeId = params.get("id");
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const money = (n) => `JMD ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const day = (iso) => {
    if (!iso) return "—";
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(y, m - 1, d));
  };
  const STATUS = { draft: "Draft", approved: "Approved", processed: "Processed", reversed: "Reversed" };

  function findPayrollButton() {
    return [...document.querySelectorAll(".hero-buttons button, .hero-buttons a")]
      .find((el) => el.textContent.trim().toLowerCase() === "payroll");
  }

  function makeSection() {
    let section = document.getElementById("employeePayrollSection");
    if (section) return section;

    // Look like the other cards on the page: copy the class of the card holding "Employee Photo" (or Documents).
    const heading = [...document.querySelectorAll("h2")].find((h) => /employee photo|employee documents/i.test(h.textContent));
    const card = heading ? heading.closest("article, section") || heading.parentElement : null;

    section = document.createElement(card && card.tagName === "ARTICLE" ? "article" : "section");
    section.id = "employeePayrollSection";
    if (card && card.className) section.className = card.className;
    section.innerHTML = `
      <h2>Pay history</h2>
      <p class="kx-pay-sub" style="margin:4px 0 14px;color:#6f7285">Every payroll this employee was in, newest first.</p>
      <div id="kxPayYtd" style="margin:0 0 12px;font-weight:700"></div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead><tr style="text-align:left;color:#6f7285;font-size:12px;text-transform:uppercase;letter-spacing:.05em">
            <th style="padding:8px 6px">Pay period</th><th style="padding:8px 6px">Pay date</th>
            <th style="padding:8px 6px;text-align:right">Gross pay</th><th style="padding:8px 6px;text-align:right">Deductions</th>
            <th style="padding:8px 6px;text-align:right">Net pay</th><th style="padding:8px 6px">Status</th><th style="padding:8px 6px"></th></tr></thead>
          <tbody id="kxPayBody"><tr><td colspan="7" style="padding:10px 6px">Loading…</td></tr></tbody>
        </table>
      </div>`;

    if (card && card.parentNode) card.parentNode.insertBefore(section, card);
    else (document.querySelector("main") || document.body).appendChild(section);
    return section;
  }

  async function load() {
    const body = document.getElementById("kxPayBody");
    const { data, error } = await supabaseClient
      .from("payroll_run_items")
      .select("payroll_run_id, gross_pay, total_deductions, net_pay, payroll_runs(id, period_start, period_end, pay_date, status)")
      .eq("employee_id", employeeId);

    if (error) {
      body.innerHTML = `<tr><td colspan="7" style="padding:10px 6px">Pay history could not be loaded. Only admins, managing directors, payroll officers and viewers can see pay.</td></tr>`;
      return;
    }

    const rows = (data || [])
      .filter((r) => r.payroll_runs)
      .sort((a, b) => String(b.payroll_runs.pay_date || b.payroll_runs.period_end).localeCompare(String(a.payroll_runs.pay_date || a.payroll_runs.period_end)));

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="7" style="padding:10px 6px">No payrolls yet for this employee.</td></tr>`;
      return;
    }

    const year = String(new Date().getFullYear());
    const ytd = rows.filter((r) => r.payroll_runs.status === "processed" && String(r.payroll_runs.pay_date || r.payroll_runs.period_end).startsWith(year));
    const sum = (k) => ytd.reduce((t, r) => t + Number(r[k] || 0), 0);
    document.getElementById("kxPayYtd").textContent = ytd.length
      ? `${year} so far (processed): gross ${money(sum("gross_pay"))} · net ${money(sum("net_pay"))} · ${ytd.length} ${ytd.length === 1 ? "payslip" : "payslips"}`
      : "";

    body.innerHTML = rows.map((r) => {
      const run = r.payroll_runs;
      const faded = run.status === "reversed" ? "opacity:.55;" : "";
      return `<tr style="border-top:1px solid #eceef4;${faded}">
        <td style="padding:9px 6px">${esc(day(run.period_start))} – ${esc(day(run.period_end))}</td>
        <td style="padding:9px 6px">${esc(day(run.pay_date))}</td>
        <td style="padding:9px 6px;text-align:right">${money(r.gross_pay)}</td>
        <td style="padding:9px 6px;text-align:right">${money(r.total_deductions)}</td>
        <td style="padding:9px 6px;text-align:right;font-weight:700">${money(r.net_pay)}</td>
        <td style="padding:9px 6px">${esc(STATUS[run.status] || run.status)}</td>
        <td style="padding:9px 6px"><a href="payslip.html?run=${encodeURIComponent(run.id)}&employee=${encodeURIComponent(employeeId)}">View payslip</a></td></tr>`;
    }).join("");
  }

  async function start() {
    if (!employeeId || typeof supabaseClient === "undefined") return;
    const button = findPayrollButton();
    const section = makeSection();
    if (button) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    await load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
