/* ================= PAYROLL: RATES ================= */
function renderRates() {
  document.getElementById('rateThreshold').value = rates.threshold;
  document.getElementById('ratePayeLower').value = rates.payeLower;
  document.getElementById('ratePayeHigher').value = rates.payeHigher;
  document.getElementById('ratePayeBand').value = rates.payeBand;
  document.getElementById('rateNis').value = rates.nis;
  document.getElementById('rateNisCeiling').value = rates.nisCeiling;
  document.getElementById('rateNht').value = rates.nht;
  document.getElementById('rateEdTax').value = rates.edTax;
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
  if (company.payPeriod === 'weekly') return 52;
  if (company.payPeriod === 'fortnightly') return 26;
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
