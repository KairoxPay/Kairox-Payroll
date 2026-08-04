/* ================= TABS ================= */
function switchTab(tab) {
  document.getElementById('viewPayroll').classList.toggle('active', tab === 'payroll');
  document.getElementById('viewPayslips').classList.toggle('active', tab === 'payslips');
  document.getElementById('viewReturn').classList.toggle('active', tab === 'return');
  document.getElementById('viewReminders').classList.toggle('active', tab === 'reminders');
  document.getElementById('viewSupport').classList.toggle('active', tab === 'support');
  document.getElementById('tabBtnPayroll').classList.toggle('active', tab === 'payroll');
  document.getElementById('tabBtnPayslips').classList.toggle('active', tab === 'payslips');
  document.getElementById('tabBtnReturn').classList.toggle('active', tab === 'return');
  document.getElementById('tabBtnReminders').classList.toggle('active', tab === 'reminders');
  document.getElementById('tabBtnSupport').classList.toggle('active', tab === 'support');
}

/* ================= FILING REMINDERS ================= */
// Finds the next occurrence of a given month/day from today, pushing to next
// business day if it lands on a Saturday or Sunday, and rolling to next year
// if that date has already passed this year.
function nextOccurrence(month, day) {
  const today = new Date();
  today.setHours(0,0,0,0);
  let candidate = new Date(today.getFullYear(), month - 1, day);
  if (candidate < today) candidate = new Date(today.getFullYear() + 1, month - 1, day);
  const dow = candidate.getDay();
  if (dow === 6) candidate.setDate(candidate.getDate() + 2); // Saturday -> Monday
  if (dow === 0) candidate.setDate(candidate.getDate() + 1); // Sunday -> Monday
  return candidate;
}
// Monthly deadlines (like the 14th of every month) always show the very next one.
function nextMonthly(day) {
  const today = new Date(); today.setHours(0,0,0,0);
  let candidate = new Date(today.getFullYear(), today.getMonth(), day);
  if (candidate < today) candidate = new Date(today.getFullYear(), today.getMonth() + 1, day);
  const dow = candidate.getDay();
  if (dow === 6) candidate.setDate(candidate.getDate() + 2);
  if (dow === 0) candidate.setDate(candidate.getDate() + 1);
  return candidate;
}
function daysUntil(d) {
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((d - today) / (1000*60*60*24));
}
function fmtDate(d) {
  return d.toLocaleDateString('en-JM', { year:'numeric', month:'long', day:'numeric' });
}
function renderReminders() {
  const hasEmployees = document.getElementById('remHasEmployees').checked || employees.length > 0;
  const includeEntity = document.getElementById('remIncludeEntity').checked;
  const entityType = document.getElementById('entityType').value;

  let items = [];

  if (hasEmployees) {
    items.push({ label: 'S01 — Monthly Statutory Remittance (PAYE, NIS, NHT, Ed Tax, HEART for last month\u2019s payroll)', date: nextMonthly(14) });
    items.push({ label: 'S02 — Employer\u2019s Annual Return', date: nextOccurrence(3, 31) });
    items.push({ label: 'P2A — Statement of Earnings issued to each employee', date: nextOccurrence(2, 15) });
  }

  if (includeEntity) {
    if (entityType === 'sole') {
      items.push({ label: 'S04 — Annual Return (sole trader)', date: nextOccurrence(3, 15) });
      items.push({ label: 'S04A — Estimated Return for next year', date: nextOccurrence(3, 15) });
      items.push({ label: 'Quarterly estimated tax payment', date: nextOccurrence(3, 15) });
      items.push({ label: 'Quarterly estimated tax payment', date: nextOccurrence(6, 15) });
      items.push({ label: 'Quarterly estimated tax payment', date: nextOccurrence(9, 15) });
      items.push({ label: 'Quarterly estimated tax payment', date: nextOccurrence(12, 15) });
    } else if (entityType === 'partnership') {
      items.push({ label: 'IT03 — Partnership Return (then each partner files their own S04/IT01)', date: nextOccurrence(3, 15) });
      items.push({ label: 'Quarterly estimated tax payment (per partner)', date: nextOccurrence(3, 15) });
      items.push({ label: 'Quarterly estimated tax payment (per partner)', date: nextOccurrence(6, 15) });
      items.push({ label: 'Quarterly estimated tax payment (per partner)', date: nextOccurrence(9, 15) });
      items.push({ label: 'Quarterly estimated tax payment (per partner)', date: nextOccurrence(12, 15) });
    } else if (entityType === 'limited') {
      items.push({ label: 'IT02 — Corporate Income Tax Return (moved to April 15 starting YA2025)', date: nextOccurrence(4, 15) });
      items.push({ label: 'IT07 — Corporate Estimated Return', date: nextOccurrence(3, 15) });
      items.push({ label: 'Quarterly estimated tax payment', date: nextOccurrence(3, 15) });
      items.push({ label: 'Quarterly estimated tax payment', date: nextOccurrence(6, 15) });
      items.push({ label: 'Quarterly estimated tax payment', date: nextOccurrence(9, 15) });
      items.push({ label: 'Quarterly estimated tax payment', date: nextOccurrence(12, 15) });
      items.push({ label: 'Companies Office of Jamaica — Annual Return (company law filing, not tax; date depends on your incorporation anniversary — confirm with the Companies Office)', date: null });
    }
  }

  items = items.filter(i => i.date).sort((a,b) => a.date - b.date);

  let html = `<div class="card"><h2>Upcoming filing dates</h2><table><thead><tr><th>Filing</th><th>Due date</th><th>Days away</th></tr></thead><tbody>`;
  items.forEach(i => {
    const days = daysUntil(i.date);
    const urgent = days <= 14;
    html += `<tr><td>${i.label}</td><td>${fmtDate(i.date)}</td><td style="${urgent ? 'color:var(--danger); font-weight:600' : ''}">${days} day${days === 1 ? '' : 's'}</td></tr>`;
  });
  html += `</tbody></table>`;
  html += `</div>`;

  if (entityType === 'limited') {
    html += `<div class="card"><p class="muted">Also file the Companies Office of Jamaica Annual Return — this is a company-law filing (confirming directors, shareholders, registered address), separate from anything TAJ handles. Its due date is tied to your incorporation anniversary; check with the Companies Office of Jamaica directly for your specific date.</p></div>`;
  }

  document.getElementById('remindersResultsArea').innerHTML = html;
}

/* ================= REAL ONE-CLICK PDF DOWNLOAD (not the print dialog) ================= */
async function downloadPdf(elementId, filename) {
  const el = document.getElementById(elementId);
  if (!el) { alert('Generate it first, then download.'); return; }
  try {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth - 40;
    const imgHeight = canvas.height * (imgWidth / canvas.width);
    let heightLeft = imgHeight;
    let position = 20;
    pdf.addImage(imgData, 'PNG', 20, position, imgWidth, imgHeight);
    heightLeft -= (pageHeight - 40);
    while (heightLeft > 0) {
      position = heightLeft - imgHeight + 20;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 20, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    pdf.save(filename);
  } catch (err) {
    console.error(err);
    alert('Could not generate the PDF directly. Use "Print / Save as PDF" below as a fallback \u2014 choose "Save as PDF" as the destination in the print dialog.');
  }
}

/* ================= PRINT HELPER (prints only the active tab's result area) ================= */
function printSection(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('printing'));
  document.getElementById(id).closest('.view').classList.add('printing');
  window.print();
}

/* ================= SUPPORT TAB ================= */
function renderFaq() {
  const list = document.getElementById('faqList');
  if (!list) return;
  list.innerHTML = FAQ_ITEMS.map((item, i) => `
    <div style="border-bottom:1px solid var(--border); padding:10px 0">
      <div style="font-weight:600; cursor:pointer" onclick="toggleFaq(${i})">${item.q}</div>
      <div id="faqAnswer${i}" class="muted" style="display:none; margin-top:6px">${item.a}</div>
    </div>`).join('');
}
function toggleFaq(i) {
  const el = document.getElementById('faqAnswer' + i);
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
function sendSupportMessage() {
  const name = document.getElementById('supportName').value.trim();
  const email = document.getElementById('supportEmail').value.trim();
  const subject = document.getElementById('supportSubject').value.trim() || 'Support request';
  const message = document.getElementById('supportMessage').value.trim();
  if (!name || !email || !message) { alert('Please fill in your name, email, and message.'); return; }
  const body = `From: ${name} (${email})\n\n${message}`;
  const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailtoUrl;
}

/* Everything else initializes inside showApp(), once login is confirmed
   (see the AUTH section near the top of this script). */
