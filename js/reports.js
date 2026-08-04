/* ================= ANNUAL RETURN ================= */
function toggleEntityType() {
  const type = document.getElementById('entityType').value;
  document.getElementById('partnersCard').style.display = type === 'partnership' ? 'block' : 'none';
  document.getElementById('seRatesCard').style.display = (type === 'sole' || type === 'partnership') ? 'block' : 'none';
  document.getElementById('limitedRatesCard').style.display = type === 'limited' ? 'block' : 'none';

  const formNames = {
    sole: 'You\u2019re collecting information for Form S04 — Return of Income, Tax Payable and Contributions (Self-Employed).',
    partnership: 'You\u2019re collecting information for Form IT03 — Partnership Return, plus each partner\u2019s individual Form S04/IT01.',
    limited: 'You\u2019re collecting information for Form IT02 — Annual Income Tax Return for Bodies Corporate.'
  };
  document.getElementById('formNameDisplay').textContent = formNames[type];
}
async function addLine(kind) {
  const table = kind === 'income' ? 'income_lines' : 'expense_lines';
  const descId = kind === 'income' ? 'incomeDesc' : 'expenseDesc';
  const amtId = kind === 'income' ? 'incomeAmount' : 'expenseAmount';
  const desc = document.getElementById(descId).value.trim();
  const amt = +document.getElementById(amtId).value;
  if (!desc || !amt) { alert('Enter a description and amount.'); return; }
  const { error } = await supabaseClient.from(table).insert({ description: desc, amt, workspace: currentWorkspace });
  if (error) { alert('Could not save: ' + error.message); return; }
  document.getElementById(descId).value = ''; document.getElementById(amtId).value = '';
  await loadIncomeExpensePartners();
  renderLines(kind);
}
function renderLines(kind) {
  const lines = kind === 'income' ? incomeLines : expenseLines;
  const tbody = document.getElementById(kind === 'income' ? 'incomeTable' : 'expenseTable');
  tbody.innerHTML = '';
  lines.forEach(l => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${l.description}</td><td>$${Number(l.amt).toLocaleString()}</td><td><button class="danger" style="padding:4px 8px;font-size:12px" onclick="removeLine('${kind}','${l.id}')">Remove</button></td>`;
    tbody.appendChild(tr);
  });
}
async function removeLine(kind, id) {
  const table = kind === 'income' ? 'income_lines' : 'expense_lines';
  const { error } = await supabaseClient.from(table).delete().eq('id', id);
  if (error) { alert('Could not remove: ' + error.message); return; }
  await loadIncomeExpensePartners();
  renderLines(kind);
}
async function addPartner() {
  const name = document.getElementById('partnerName').value.trim();
  const trn = document.getElementById('partnerTrn').value.trim();
  const share = +document.getElementById('partnerShare').value;
  if (!name || !share) { alert('Enter a name and share percentage.'); return; }
  const { error } = await supabaseClient.from('partners').insert({ name, trn, share, workspace: currentWorkspace });
  if (error) { alert('Could not save: ' + error.message); return; }
  document.getElementById('partnerName').value = ''; document.getElementById('partnerTrn').value = ''; document.getElementById('partnerShare').value = '';
  await loadIncomeExpensePartners();
  renderPartners();
}
function renderPartners() {
  const tbody = document.getElementById('partnersTable'); tbody.innerHTML = '';
  partners.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.name}</td><td>${p.trn || '—'}</td><td>${p.share}%</td><td><button class="danger" style="padding:4px 8px;font-size:12px" onclick="removePartner('${p.id}')">Remove</button></td>`;
    tbody.appendChild(tr);
  });
}
async function removePartner(id) {
  const { error } = await supabaseClient.from('partners').delete().eq('id', id);
  if (error) { alert('Could not remove: ' + error.message); return; }
  await loadIncomeExpensePartners();
  renderPartners();
}

function renderSeRates() {
  document.getElementById('seRateThreshold').value = seRates.threshold;
  document.getElementById('seRatePayeLower').value = seRates.payeLower;
  document.getElementById('seRatePayeHigher').value = seRates.payeHigher;
  document.getElementById('seRatePayeBand').value = seRates.payeBand;
  document.getElementById('seRateNis').value = seRates.nis;
  document.getElementById('seRateNisCeiling').value = seRates.nisCeiling;
  document.getElementById('seRateNht').value = seRates.nht;
  document.getElementById('seRateEdTax').value = seRates.edTax;
}
async function readSeRates() {
  seRates = {
    threshold:+document.getElementById('seRateThreshold').value, payeLower:+document.getElementById('seRatePayeLower').value,
    payeHigher:+document.getElementById('seRatePayeHigher').value, payeBand:+document.getElementById('seRatePayeBand').value,
    nis:+document.getElementById('seRateNis').value, nisCeiling:+document.getElementById('seRateNisCeiling').value,
    nht:+document.getElementById('seRateNht').value, edTax:+document.getElementById('seRateEdTax').value
  };
  await persistSettings();
  return seRates;
}
function renderLtdRates() {
  document.getElementById('ltdRateStandard').value = ltdRates.standard;
  document.getElementById('ltdRateRegulated').value = ltdRates.regulated;
  document.getElementById('ltdRateChoice').value = ltdRates.choice;
}
async function readLtdRates() {
  ltdRates = {
    standard: +document.getElementById('ltdRateStandard').value,
    regulated: +document.getElementById('ltdRateRegulated').value,
    choice: document.getElementById('ltdRateChoice').value
  };
  await persistSettings();
  return ltdRates;
}
function calcLimitedCompany(profit, r) {
  const rate = r.choice === 'regulated' ? r.regulated : r.standard;
  const corporateTax = Math.max(0, profit) * (rate / 100);
  return { profit, rate, corporateTax, net: profit - corporateTax };
}
function calcSelfEmployed(profit, r) {
  const nisable = Math.min(profit, r.nisCeiling);
  const nis = nisable * (r.nis / 100);
  const edTax = (profit - nis) * (r.edTax / 100);
  const nht = profit * (r.nht / 100);
  const chargeable = Math.max(0, profit - nis - r.threshold);
  let incomeTax;
  if (chargeable <= r.payeBand) incomeTax = chargeable * (r.payeLower / 100);
  else incomeTax = r.payeBand * (r.payeLower / 100) + (chargeable - r.payeBand) * (r.payeHigher / 100);
  const totalPayable = nis + edTax + nht + incomeTax;
  return { profit, nis, edTax, nht, incomeTax, totalPayable, net: profit - totalPayable };
}
async function calculateReturn() {
  const entityType = document.getElementById('entityType').value;
  const taxYear = document.getElementById('taxYear').value;
  const businessName = company.name || 'Your business';
  const totalIncome = incomeLines.reduce((s,l) => s + Number(l.amt), 0);
  const totalExpenses = expenseLines.reduce((s,l) => s + Number(l.amt), 0);
  const netProfit = totalIncome - totalExpenses;

  let html = `<div class="card">
    <h2>Results for ${businessName} — Year of Assessment ${taxYear}</h2>
    <div class="section-title">Business summary</div>
    <div class="line"><span>Total income</span><span>$${totalIncome.toLocaleString()}</span></div>
    <div class="line"><span>Total allowable expenses</span><span>-$${totalExpenses.toLocaleString()}</span></div>
    <div class="line total"><span>Net profit</span><span>$${netProfit.toLocaleString()}</span></div>
  </div>`;

  if (entityType === 'sole') {
    const r = await readSeRates();
    html += renderPersonResult('Sole trader — Form S04', calcSelfEmployed(netProfit, r), r);
  } else if (entityType === 'partnership') {
    if (partners.length === 0) { alert('Add at least one partner first.'); return; }
    const r = await readSeRates();
    const totalShare = partners.reduce((s,p) => s + Number(p.share), 0);
    html += `<div class="card"><p class="muted">Partnership total profit of $${netProfit.toLocaleString()} reported on Form IT03, split as follows (shares total ${totalShare}%):</p></div>`;
    partners.forEach(p => {
      const allocated = netProfit * (Number(p.share) / 100);
      html += renderPersonResult(`${p.name} (${p.share}% share) — Form S04/IT01`, calcSelfEmployed(allocated, r), r);
    });
  } else if (entityType === 'limited') {
    const ltdR = await readLtdRates();
    html += renderCompanyResult('Limited Company — Form IT02', calcLimitedCompany(netProfit, ltdR));
  }
  document.getElementById('returnResultsArea').innerHTML = html;
}
function renderPersonResult(title, c, r) {
  return `<div class="card">
    <h2>${title}</h2>
    <div class="section-title">Statutory income</div>
    <div class="line"><span>Profit / allocated share</span><span>$${c.profit.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
    <div class="section-title">Contributions &amp; taxes payable</div>
    <div class="line"><span>NIS (${r.nis}%, capped at $${r.nisCeiling.toLocaleString()}/yr)</span><span>$${c.nis.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
    <div class="line"><span>NHT (${r.nht}%)</span><span>$${c.nht.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
    <div class="line"><span>Education Tax (${r.edTax}%)</span><span>$${c.edTax.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
    <div class="line"><span>Income Tax (after $${r.threshold.toLocaleString()} threshold)</span><span>$${c.incomeTax.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
    <div class="line total"><span>Total payable to TAJ</span><span>$${c.totalPayable.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
    <div class="line"><span class="muted">Estimated after-tax income</span><span class="muted">$${c.net.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
    <p class="muted" style="margin-top:14px">File Form S04 (and next year's estimate, S04A) by March 15, via the Jamaica Tax Portal or a TAJ office. Quarterly estimated payments are due March 15, June 15, September 15, and December 15.</p>
    <div class="no-print" style="margin-top:10px">
      <button onclick="downloadPdf('returnResultsArea', 'Annual-Return.pdf')">Download as PDF</button>
      <button class="secondary" onclick="printSection('returnResultsArea')">Print</button>
    </div>
  </div>`;
}

function renderCompanyResult(title, c) {
  return `<div class="card">
    <h2>${title}</h2>
    <div class="section-title">Taxable profit</div>
    <div class="line"><span>Net profit for the year</span><span>$${c.profit.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
    <div class="section-title">Corporate income tax</div>
    <div class="line"><span>Corporate income tax (${c.rate}%)</span><span>$${c.corporateTax.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
    <div class="line total"><span>Total payable to TAJ</span><span>$${c.corporateTax.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
    <div class="line"><span class="muted">Retained profit after tax</span><span class="muted">$${c.net.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
    <p class="muted" style="margin-top:14px">File Form IT02 (Annual Income Tax Return for Bodies Corporate), due <strong>April 15</strong> of the following year — TAJ moved this from March 15 starting with the 2025 year of assessment (announced February 2026). The estimated return (Form IT07) and quarterly estimated payments are still due March 15, June 15, September 15, and December 15. This is separate from any Annual Return owed to the Companies Office of Jamaica under company law, and separate from monthly payroll remittances (S01) if the company has employees — see the Payroll tab and Filing Reminders tab for those.</p>
    <div class="no-print" style="margin-top:10px">
      <button onclick="downloadPdf('returnResultsArea', 'Annual-Return.pdf')">Download as PDF</button>
      <button class="secondary" onclick="printSection('returnResultsArea')">Print</button>
    </div>
  </div>`;
}
