// Which company the signed-in person is working in (chosen with the company switcher). Kairox Exchange by default.
function kairoxWorkspaceId() {
  try {
    return localStorage.getItem("kairoxWorkspace") || "kairox-exchange";
  } catch (error) {
    return "kairox-exchange";
  }
}

const SUPPORT_EMAIL = "kairoxpay@gmail.com";
const APP_VERSION = "1.0.0";

const FAQ = [
  {
    q: "How do I run payroll?",
    a: `<ol>
      <li>Open <strong>Payroll</strong> and click <strong>Change Period</strong>. Choose your pay frequency, the start and end dates, and the pay date.</li>
      <li>If someone has overtime, a bonus, an allowance, a loan repayment or unpaid leave, click <strong>Pay items</strong> beside their name.</li>
      <li>Click <strong>Save Draft</strong>. A payroll clerk can do this much.</li>
      <li>An <strong>admin</strong> then clicks <strong>Review &amp; Approve</strong>, checks the summary, and approves.</li>
      <li>An admin clicks <strong>Process Payroll</strong>. Payslips and reports are now available.</li>
    </ol>`
  },
  {
    q: "Who can approve, process or reverse a payroll?",
    a: "Only an <strong>admin</strong>. A <strong>payroll clerk</strong> can prepare drafts and enter pay items. A <strong>viewer</strong> can read everything but change nothing. Someone with no role sees nothing."
  },
  {
    q: "I made a mistake after processing. How do I fix it?",
    a: `A processed payroll cannot be edited or deleted. An admin can <strong>reverse</strong> it: open <strong>Payroll</strong>, set the pay period to that payroll, click <strong>Reverse Payroll</strong> and give a reason. The payroll stays in the history marked "reversed", and the period can then be run again with the corrections.`
  },
  {
    q: "An employee is missing from my payroll.",
    a: `<ul><li>People marked <strong>Inactive</strong> or <strong>Archived</strong> are not paid. <strong>On leave</strong> staff are.</li>
      <li>Employees added after you saved a draft are not in that draft. Delete the draft and start again.</li>
      <li>Check the employee's status on the <strong>Employees</strong> page.</li></ul>`
  },
  {
    q: "Where do I find a payslip, and how do I download it?",
    a: "Payslips exist for <strong>processed</strong> payrolls. Open <strong>Payslips</strong>, find the pay period in the <em>Payslip archive</em> (you can search by month, year or date), click <strong>View payslips</strong>, open one, and choose <strong>Download</strong> to save a PDF."
  },
  {
    q: "How do I change the PAYE, NIS, NHT or Education Tax rates?",
    a: "An admin opens <strong>Settings</strong>, edits the statutory rates and saves. Check the figures against TAJ, the NIS and the NHT each April. The change applies to new and unsaved payrolls only. Payrolls already processed keep the rates they were run with."
  },
  {
    q: "How do I add a new user?",
    a: "First create their login in Supabase (<em>Authentication</em>, then <em>Users</em>). Then an admin opens <strong>Settings</strong>, finds them under <strong>Users and roles</strong>, and gives them a role. Until then they can sign in but will see nothing."
  },
  {
    q: "I forgot my password.",
    a: "On the sign-in page, type your email address and click <strong>Forgot password?</strong>. We send a reset link to that address. Check your spam folder if it does not arrive."
  },
  {
    q: "Does Kairox Pay file my returns or pay TAJ for me?",
    a: "No. Kairox Pay works out what you owe and when it is due, and the <strong>Compliance</strong> page keeps a record of what you have filed. You file and pay on the Jamaica Tax Portal yourself, then mark it as filed here. Always confirm forms and due dates with TAJ."
  },
  {
    q: "What are P24 and P45, and when do I give them out?",
    a: `<ul><li><strong>P24</strong> is a certificate of gross emoluments and tax deducted for the year. TAJ's Employers' Guide says every employee must receive one at the end of each year. It gives no fixed date. Kairox Pay shows 31 January as a <em>target</em>, so people have it in time to file their own returns by 15 March.</li>
      <li><strong>P45</strong> is the same kind of certificate for someone who leaves part-way through the year. Record the departure on the <strong>Leavers</strong> page to get their P45 figures.</li>
      <li><strong>S02</strong>, the employer's annual return, is filed online with TAJ by 31 March.</li>
      <li>On the <strong>Compliance</strong> page, the <em>Annual summary for each employee</em> adds up each person's pay and deductions for the year, which is the data you need for both. You can export it. Mark P24 as done once you have given the certificates out.</li></ul>
      Check everything with TAJ before relying on it.`
  },
  {
    q: "Why does a month on the Compliance page say employer shares were not recorded?",
    a: "Payrolls processed before employer contributions were recorded do not carry them, so the amount to remit for that month may be lower than what you actually owe. Check it against your own calculation before paying."
  },
  {
    q: "Who can see the documents I upload?",
    a: "Documents are stored privately. Admins and payroll clerks can add documents, everyone with a role can view and download them, and only admins can delete them. Employee files (such as a contract) stay on that employee's own profile."
  },
  {
    q: "How do I add my company's logo?",
    a: "An admin opens <strong>Settings</strong>, goes to <strong>Company profile</strong>, and chooses a picture under <strong>Company logo</strong> (PNG, JPG or WebP). It is shrunk to fit and saved straight away. Each company has its own logo, so switch company first. The logo then prints on that company's payslips (screen, print and PDF) and at the top of its reports. <strong>Remove logo</strong> takes it off again."
  },
  {
    q: "How do I switch between Kairox Exchange and Kairox Logistics?",
    a: "Use the <strong>Company</strong> box at the top of the sidebar. Each company is completely separate: its own employees, payroll, payslips, reports, filings, documents, settings, pay period and company profile. You only see the companies you have been given access to. If you can open just one, its name is shown instead of a dropdown."
  },
  {
    q: "How do I give someone access to only one company?",
    a: "Switch to that company, open <strong>Settings</strong>, and in <strong>Users and roles</strong> choose their role (viewer, payroll clerk or admin) and press Save. A role applies only to the company you are in, so someone can be a payroll clerk for Kairox Logistics and have no access at all to Kairox Exchange. Each company must always keep at least one admin."
  },
  {
    q: "Where do I enter my company's name, address and TRN?",
    a: "An admin opens <strong>Settings</strong> and fills in the <strong>Company profile</strong>. The name, address, TRN and contact details then appear on every payslip (screen, print and PDF), and the name and TRN head the Excel exports and reports."
  },
  {
    q: "Why does everyone see the same pay period, and who can change it?",
    a: "The pay period (start, end, pay date and frequency) is now kept for the whole company, not in each person's browser. An <strong>admin</strong> or <strong>payroll clerk</strong> changes it with <strong>Change Period</strong> on the Payroll page, and everyone sees the new period the next time they open or refresh a page. Viewing an old payroll from the history only changes what <em>you</em> are looking at."
  },
  {
    q: "Who can approve and process payroll?",
    a: `Payroll is checked by a second person. The <strong>payroll / accounts officer</strong> prepares the payroll and, once it has been approved, <strong>processes</strong> it. An <strong>admin</strong> or a <strong>managing director</strong> <strong>approves</strong> it in between, and only they can send an approved payroll back to draft or reverse a processed one.
      A payroll / accounts officer also sees reports and compliance and records filings. A managing director sees everything and can approve and process payroll, approve leave, record departures and P45s, and edit people. Settings (tax rates, company profile, user roles, leave types and holidays) and permanent deletes stay with the admin.`
  },
  {
    q: "What can HR officers, managers and employees see?",
    a: `<ul><li><strong>HR officer</strong>: everyone's details (never their pay), who reports to whom, all leave, and company documents. They approve anyone's leave and cannot see salaries, payroll or reports.</li>
      <li><strong>Manager</strong>: only the people who report to them. They approve that team's leave and cannot see anyone else, or any pay.</li>
      <li><strong>Employee</strong>: only their own payslips, leave, contact details, tax totals and the documents you share. They sign in to the <strong>My portal</strong> page.</li></ul>
      Nobody except an admin can approve their own leave. The database enforces all of this, not just the screens.`
  },
  {
    q: "How do I give an employee a login?",
    a: `<ol><li>In Supabase, open <strong>Authentication</strong>, then <strong>Users</strong>, then <strong>Invite user</strong>, and enter their email. They get an email to set a password.</li>
      <li>In Kairox Pay, open <strong>People</strong> and click <strong>Give access</strong> next to their name. Type the same email.</li>
      <li>To make someone a manager, set who reports to them on the People page, then give the manager a <strong>Manager</strong> role in Settings. HR officers get the <strong>HR officer</strong> role there.</li></ol>
      Employees do <strong>not</strong> need a role in Settings: leave them on "No staff access". Do not give an employee Viewer, which can read everyone's pay.
      Only an admin can give or remove access. Under Settings, <strong>Employee portal</strong> switches parts of the portal on or off. People who have left can still see their payslips and tax totals, and nothing else.`
  },
  {
    q: "What happens when someone leaves?",
    a: `<ol><li>On <strong>Leavers</strong>, click <strong>Record a departure</strong>: their last day and the reason. They stay on the payroll so their final pay can be processed.</li>
      <li>Open <strong>Final pay</strong> for an estimate of their accrued vacation pay and how many working days of the last month fall after their last day. On the Payroll page, <strong>Pay items</strong> offers those days as a suggestion.</li>
      <li>Run and process their final payroll. Payroll will not approve a pay period that starts after someone's last day.</li>
      <li>An admin clicks <strong>Mark as left</strong>. They become inactive and are no longer paid.</li>
      <li>Open their <strong>P45</strong> figures, prepare the form, and click <strong>Record P45 given</strong>.</li></ol>`
  },
  {
    q: "What is a P45?",
    a: "TAJ's Employers' Guide says that when someone's employment ends, the employer prepares a <strong>P45</strong>, a certificate of gross emoluments and tax deducted to date, in triplicate: one copy for Tax Administration Jamaica and two for the employee, who gives them to a new employer. Kairox Pay shows the figures from your processed payrolls for that year and keeps a record of when you gave it out. The official form is TAJ's: copy the figures onto it. A P45 is not the same as a <strong>P24</strong>, which every employee gets at the end of the year."
  },
  {
    q: "How do I record leave, and who approves it?",
    a: `<ol><li>Open <strong>Leave</strong> and click <strong>Record leave</strong>.</li>
      <li>Choose the employee, the type of leave and the dates. The form counts the working days (weekends and public holidays are never counted) and shows how many days they have left.</li>
      <li>A <strong>payroll clerk</strong> saves it and it waits. An <strong>admin</strong> approves or declines it on the same page, or ticks <em>Approve straight away</em> when recording.</li></ol>
      Approved leave comes off the person's balance and shows on the team calendar. A <strong>viewer</strong> can see everything but change nothing. Employees cannot yet record their own leave.`
  },
  {
    q: "What leave rules does Kairox Pay start with, and can I change them?",
    a: `The defaults follow Jamaican law as published by the Ministry of Labour and the Acts: <strong>vacation</strong> 10 working days a year after one year of service (15 after 10 years); <strong>sick leave</strong> 10 working days, with a medical certificate for more than 3 days; <strong>maternity leave</strong> 12 weeks, the first 8 weeks paid (40 working days paid, 20 unpaid), after 52 weeks of service. There is no statutory paternity leave in the private sector.
      They are only starting points. An admin can change the days, the waiting time, the colours and add your own types under <strong>Leave types and public holidays</strong> at the bottom of the Leave page. Check them against your own policy and the Ministry's guidance.`
  },
  {
    q: "How does unpaid leave affect pay?",
    a: "Approved <strong>unpaid</strong> leave does not change pay by itself. When you open <strong>Pay items</strong> for that person on the Payroll page, you will see \"Approved unpaid leave in this period\" with a <strong>Use this</strong> button that fills in the unpaid days. Paid leave (vacation, sick, paid maternity) needs nothing: they are simply paid as normal."
  },
  {
    q: "How do I get my payroll into Excel?",
    a: "On the <strong>Payroll</strong> page choose <strong>Export Excel</strong> for the payroll you are working on. For a processed payroll, open it in the payroll history and choose <strong>Download Excel</strong> for the register, the statutory remittance summary and the employer cost. The <strong>Reports</strong> page also exports CSV files."
  },
  {
    q: "The page says my account does not have a payroll role.",
    a: "You are signed in, but an admin has not given you a role yet. Ask them to open <strong>Settings</strong> and assign one to your email address."
  }
];

let supportProfile = { email: "", role: "" };

const supEsc = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

function renderFaq() {
  const term = document.getElementById("faqSearch").value.trim().toLowerCase();
  const list = document.getElementById("faqList");
  const matches = FAQ.filter((item) => !term || `${item.q} ${stripTags(item.a)}`.toLowerCase().includes(term));

  list.innerHTML = matches
    .map((item) => `<details class="faq"><summary>${supEsc(item.q)}</summary><div class="answer">${item.a}</div></details>`)
    .join("");

  document.getElementById("faqEmpty").hidden = matches.length > 0;

  // A single result is opened for you.
  if (term && matches.length === 1) {
    list.querySelector("details").open = true;
  }
}

function diagnosticsText() {
  return [
    "Kairox Pay support details",
    `Page: ${window.location.origin}${window.location.pathname}`,
    `Time: ${new Date().toISOString()}`,
    `Version: ${APP_VERSION}`,
    `Signed in as: ${supportProfile.email ? `${supportProfile.email} (${supportProfile.role || "no payroll role"})` : "not signed in"}`,
    `Browser: ${navigator.userAgent}`,
    `Window: ${window.innerWidth} x ${window.innerHeight}`
  ].join("\n");
}

function buildMailto(topic, message, diagnostics) {
  // Many mail programs cut off very long links, so keep the message to a safe length.
  const body = `${String(message).slice(0, 1200)}\n\n---\n${diagnostics}`;

  return (
    `mailto:${SUPPORT_EMAIL}` +
    `?subject=${encodeURIComponent(`Kairox Pay support: ${topic}`)}` +
    `&body=${encodeURIComponent(body)}`
  );
}

function supportNote(text, kind) {
  const box = document.getElementById("supportMessageNote");
  box.textContent = text || "";
  box.className = `form-message ${kind || ""}`.trim();
}

async function loadSupportProfile() {
  try {
    const { data } = await supabaseClient.auth.getSession();
    const session = data && data.session;

    if (session) {
      const { data: role } = await supabaseClient.rpc("get_my_role", { p_workspace: kairoxWorkspaceId() });
      supportProfile = { email: (session.user && session.user.email) || "", role: role || "" };
    }
  } catch (error) {
    console.error("Could not read the signed-in user:", error);
  }

  document.getElementById("diagnostics").textContent = diagnosticsText();
}

async function copyDetails() {
  const text = diagnosticsText();

  try {
    await navigator.clipboard.writeText(text);
    supportNote("Copied. You can paste it into an email or message.", "ok");
  } catch (error) {
    const box = document.getElementById("diagnostics");
    const range = document.createRange();
    range.selectNodeContents(box);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    supportNote("Your browser would not copy it automatically. The details are selected, so press Ctrl+C.", "error");
  }
}

function sendSupport(event) {
  event.preventDefault();

  const topic = document.getElementById("supportTopic").value;
  const message = document.getElementById("supportMessage").value.trim();

  if (message.length < 10) {
    return supportNote("Please tell us a little more, at least a sentence.", "error");
  }

  supportNote(
    message.length > 1200
      ? "Opening your email. Your message was long, so it was shortened in the email: please paste the rest."
      : "Opening your email program…",
    "ok"
  );

  window.location.href = buildMailto(topic, message, diagnosticsText());
}

document.getElementById("faqSearch").addEventListener("input", renderFaq);
document.getElementById("supportForm").addEventListener("submit", sendSupport);
document.getElementById("copyDetails").addEventListener("click", copyDetails);

renderFaq();
document.getElementById("diagnostics").textContent = diagnosticsText();
loadSupportProfile();