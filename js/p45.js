// Which company the signed-in person is working in (chosen with the company switcher). Kairox Exchange by default.
function kairoxWorkspaceId() {
  try {
    return localStorage.getItem("kairoxWorkspace") || "kairox-exchange";
  } catch (error) {
    return "kairox-exchange";
  }
}

const P45_WORKSPACE = kairoxWorkspaceId();
const P45_REASONS = {
  resignation: "Resignation", dismissal: "Dismissal", redundancy: "Redundancy", end_of_contract: "End of contract",
  retirement: "Retirement", death: "Death", other: "Other"
};

const p45El = (id) => document.getElementById(id);
const p45Esc = (value = "") =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function p45Fmt(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(y, m - 1, d));
}
function p45Money(value) {
  return `J$${Number(value || 0).toLocaleString("en-JM", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function p45Banner(text) {
  const box = p45El("p45Banner");
  box.innerHTML = text;
  box.hidden = !text;
}
function p45Csv(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

let p45Rows = [];

async function p45Start() {
  const employeeId = new URLSearchParams(window.location.search).get("employee");

  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (!sessionData || !sessionData.session) {
    return p45Banner(`You are not signed in. <a href="login.html?next=${encodeURIComponent("p45.html" + window.location.search)}">Sign in</a> to continue.`);
  }

  const { data: role, error: roleError } = await supabaseClient.rpc("get_my_role", { p_workspace: P45_WORKSPACE });
  if (roleError || !role) {
    return p45Banner("Your account does not have a payroll role for this company, so these figures cannot be shown.");
  }
  if (!employeeId) {
    return p45Banner('No employee was chosen. Open this page from <a href="leavers.html">Leavers</a>.');
  }

  if (window.KairoxCompany) await window.KairoxCompany.ready();

  const [emp, dep, fig] = await Promise.all([
    supabaseClient.from("employees").select("*").eq("id", employeeId).eq("workspace", P45_WORKSPACE).maybeSingle(),
    supabaseClient.from("employee_departures").select("*").eq("employee_id", employeeId).eq("workspace", P45_WORKSPACE).maybeSingle(),
    supabaseClient.rpc("p45_figures", { p_workspace: P45_WORKSPACE, p_employee: employeeId })
  ]);

  if (!emp.data || !dep.data) {
    return p45Banner('That person has no departure recorded in this company. Record it on <a href="leavers.html">Leavers</a> first.');
  }
  if (fig.error || !fig.data || !fig.data[0]) {
    return p45Banner("The figures could not be loaded. " + p45Esc((fig.error && fig.error.message) || ""));
  }

  const e = emp.data;
  const d = dep.data;
  const f = fig.data[0];
  const company = window.KairoxCompany;

  p45El("p45Company").textContent = company ? company.companyName() : "Kairox Exchange";
  p45El("p45CompanyLines").innerHTML = company ? company.companyLines().map(p45Esc).join("<br>") : "";
  const logo = company && typeof company.logo === "function" ? company.logo() : null;
  if (logo) {
    p45El("p45Logo").src = logo;
    p45El("p45Logo").hidden = false;
  }
  p45El("p45Printed").textContent = `Prepared ${p45Fmt(new Date().toISOString().slice(0, 10))}`;

  const warnings = [];
  if (Number(f.open_runs) > 0) warnings.push(`${e.name} is in ${f.open_runs} draft or approved payroll(s) that are not processed yet. Process them first, then print this, or the figures will be too low.`);
  if (!Number(f.payrolls)) warnings.push(`No processed payrolls were found for ${f.tax_year}, so every figure is zero.`);
  p45El("p45Warning").innerHTML = warnings.map(p45Esc).join("<br>");
  p45El("p45Warning").hidden = !warnings.length;

  const employeeRows = [
    ["Employee", e.name], ["TRN", e.trn || ""], ["Employee number", e.employee_number || ""], ["Job title", e.title || ""], ["Department", e.department || ""],
    ["Started", p45Fmt(e.start_date)], ["Last day of employment", p45Fmt(f.leaving_date)], ["Reason", P45_REASONS[d.reason] || d.reason], ["Year of the payments", String(f.tax_year)]
  ];
  p45El("p45Employee").querySelector("tbody").innerHTML = employeeRows.map(([k, v]) => `<tr><th>${p45Esc(k)}</th><td>${p45Esc(v)}</td></tr>`).join("");

  const figureRows = [
    ["Gross pay (taxable emoluments before deductions)", f.gross],
    ["Pension contributions deducted", f.pension],
    ["NIS deducted", f.nis],
    ["Statutory income (gross pay less NIS and pension)", f.statutory_income],
    ["Tax-free amount (nil-rate threshold used)", f.tax_free],
    ["Income tax (PAYE) deducted to date", f.paye],
    ["NHT deducted", f.nht],
    ["Education Tax deducted", f.education_tax],
    ["Non-taxable allowances paid (not included in gross pay)", f.exempt_allowances]
  ];
  p45Rows = [...employeeRows, ...figureRows.map(([k, v]) => [k, Number(v).toFixed(2)]),
    ["Payrolls included", `${f.payrolls}${f.first_pay ? " (" + f.first_pay + " to " + f.last_pay + ")" : ""}`]];

  p45El("p45Figures").querySelector("tbody").innerHTML =
    figureRows.map(([k, v]) => `<tr><th>${p45Esc(k)}</th><td class="num">${p45Money(v)}</td></tr>`).join("") +
    `<tr><th>Payrolls included</th><td>${p45Esc(String(f.payrolls))}${f.first_pay ? ` (paid ${p45Esc(p45Fmt(f.first_pay))} to ${p45Esc(p45Fmt(f.last_pay))})` : ""}</td></tr>`;

  p45El("p45Footnote").innerHTML =
    (d.reason === "death" ? "<strong>The employee has died:</strong> give this statement to their personal representative. Tax on any emoluments still due is deducted at the rate in force on the date of payment (TAJ Employers' Guide).<br><br>" : "") +
    `These figures add up the <strong>processed</strong> payrolls paid in ${p45Esc(String(f.tax_year))}. They are not TAJ's form: copy them onto it and check them against your own records. Keep payroll records for at least seven years.`;

  p45El("p45Sheet").hidden = false;
  p45El("p45Toolbar").hidden = false;
}

document.getElementById("p45Print").addEventListener("click", () => window.print());
document.getElementById("p45Csv").addEventListener("click", () => {
  const blob = new Blob([p45Rows.map((r) => r.map(p45Csv).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "Kairox_Pay_P45_figures.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

p45Start();
