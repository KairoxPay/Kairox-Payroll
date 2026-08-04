/* ================= SUPPORT CONTACT (edit these once before distributing) ================= */
const SUPPORT_EMAIL = 'support@yourbusiness.com'; // <-- replace with your real support email
const SUPPORT_WHATSAPP = '+1 876 000 0000';        // <-- replace with your real WhatsApp number
const FAQ_ITEMS = [
  { q: 'Why did my employee\u2019s NIS look different this month?', a: 'NIS is capped at an annual ceiling — once an employee\u2019s year-to-date pay crosses it, NIS stops being deducted for the rest of the year. Check the Payroll tab\u2019s rate settings to confirm the ceiling is current.' },
  { q: 'Can this app submit my return to TAJ for me?', a: 'No — no software can do this on your behalf. This app calculates the correct figures and tells you which form they belong on; you file through the Jamaica Tax Portal or a tax office yourself.' },
  { q: 'How do I update statutory rates for a new tax year?', a: 'Go to the rates section in the Payroll or Annual Return tab and edit the numbers directly — check taj.gov.jm, nis.gov.jm, or nht.gov.jm for the current year\u2019s figures.' },
  { q: 'I lost my data — can you recover it?', a: 'Data is stored in your browser only. If you\u2019ve been exporting backups (the Export Data button), import the most recent one. If not, unfortunately it can\u2019t be recovered — this is a good reminder to export regularly.' },
  { q: 'Can multiple people at my company use this at once?', a: 'The version you have stores data in your browser only, so it\u2019s single-device. Ask us about the multi-user version if your team needs shared access.' }
];

/* ================= SUPABASE CONNECTION (paste your own project's values — see the setup guide) ================= */

/* ================= WORKSPACES (Kairox Exchange / Kairox Logistics) ================= */
const WORKSPACES = [
  { id: 'kairox-exchange', label: 'Kairox Exchange' },
  { id: 'kairox-logistics', label: 'Kairox Logistics' }
];
let currentWorkspace = localStorage.getItem('currentWorkspace') || WORKSPACES[0].id;
// currentWorkspace is just a UI preference (which tab you're viewing) — the data itself
// lives in Supabase, scoped by a "workspace" column, so it's the same for everyone who logs in.

let employees = [], company = {}, rates = {}, incomeLines = [], expenseLines = [], partners = [], seRates = {}, ltdRates = {};

const DEFAULT_COMPANY = { name:'', address:'', phone:'', email:'', payPeriod:'monthly', logo:'', theme:'#1e5631' };
const DEFAULT_RATES = { threshold:1902360, payeLower:25, payeHigher:30, payeBand:6000000, nis:3, nisCeiling:5000000, nht:2, edTax:2.25 };
const DEFAULT_SE_RATES = { threshold:1902360, payeLower:25, payeHigher:30, payeBand:6000000, nis:6, nisCeiling:5000000, nht:3, edTax:2.25 };
const DEFAULT_LTD_RATES = { standard:25, regulated:33.33, choice:'standard' };

/* ================= LOAD / SAVE (all scoped to currentWorkspace) ================= */
async function loadSettings() {
  const { data, error } = await supabaseClient.from('settings').select('data').eq('workspace', currentWorkspace).maybeSingle();
  if (error) { console.error(error); }
  if (data && data.data) {
    company = { ...DEFAULT_COMPANY, ...data.data.company };
    rates = { ...DEFAULT_RATES, ...data.data.rates };
    seRates = { ...DEFAULT_SE_RATES, ...data.data.seRates };
    ltdRates = { ...DEFAULT_LTD_RATES, ...data.data.ltdRates };
  } else {
    company = { ...DEFAULT_COMPANY };
    rates = { ...DEFAULT_RATES };
    seRates = { ...DEFAULT_SE_RATES };
    ltdRates = { ...DEFAULT_LTD_RATES };
    await persistSettings();
  }
}
async function persistSettings() {
  const { error } = await supabaseClient.from('settings').upsert({
    workspace: currentWorkspace,
    data: { company, rates, seRates, ltdRates }
  });
  if (error) alert('Could not save to the database: ' + error.message);
}
async function loadEmployees() {
  const { data, error } = await supabaseClient.from('employees').select('*').eq('workspace', currentWorkspace).order('created_at');
  if (error) { console.error(error); return; }
  employees = data || [];
}
async function loadIncomeExpensePartners() {
  const [inc, exp, par] = await Promise.all([
    supabaseClient.from('income_lines').select('*').eq('workspace', currentWorkspace).order('created_at'),
    supabaseClient.from('expense_lines').select('*').eq('workspace', currentWorkspace).order('created_at'),
    supabaseClient.from('partners').select('*').eq('workspace', currentWorkspace).order('created_at')
  ]);
  incomeLines = inc.data || [];
  expenseLines = exp.data || [];
  partners = par.data || [];
}
async function loadAllData() {
  await loadSettings();
  await loadEmployees();
  await loadIncomeExpensePartners();
}
async function switchWorkspace(id) {
  currentWorkspace = id;
  localStorage.setItem('currentWorkspace', id);
  await loadAllData();
  renderCompany(); renderRates(); renderEmployees();
  renderLines('income'); renderLines('expense'); renderPartners(); renderSeRates(); renderLtdRates(); toggleEntityType();
  document.getElementById('payslipArea').innerHTML = '';
  document.getElementById('payslipTabArea').innerHTML = '';
  document.getElementById('returnResultsArea').innerHTML = '';
}

/* ================= COMPANY ================= */
function renderCompany() {
  document.getElementById('companyName').value = company.name || '';
  document.getElementById('companyAddress').value = company.address || '';
  document.getElementById('companyPhone').value = company.phone || '';
  document.getElementById('companyEmail').value = company.email || '';
  document.getElementById('payPeriod').value = company.payPeriod || 'monthly';
  document.getElementById('companyNameDisplay').textContent = company.name || 'Jamaica Payroll & Tax App';
  document.getElementById('themeColor').value = company.theme || '#1e5631';
  applyTheme();
  updateLogoDisplays();
}
async function saveCompany() {
  company = {
    ...company,
    name: document.getElementById('companyName').value,
    address: document.getElementById('companyAddress').value,
    phone: document.getElementById('companyPhone').value,
    email: document.getElementById('companyEmail').value,
    payPeriod: document.getElementById('payPeriod').value
  };
  await persistSettings(); renderCompany();
}
async function applyTheme() {
  const color = document.getElementById('themeColor').value;
  company.theme = color;
  await persistSettings();
  document.documentElement.style.setProperty('--brand', color);
}
function handleLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('Please choose an image file (PNG, JPG, etc).'); return; }

  const reader = new FileReader();
  reader.onerror = () => alert('Could not read that image file. Try a different file.');
  reader.onload = e => {
    // Resize down to a max width/height before storing, so logos stay small
    // regardless of the original file size (they're stored as text in the database).
    const img = new Image();
    img.onerror = () => alert('That file couldn\u2019t be read as an image.');
    img.onload = async () => {
      const maxDim = 300;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const compressed = canvas.toDataURL('image/png');

      company.logo = compressed;
      await persistSettings();
      updateLogoDisplays();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
async function removeLogo() {
  company.logo = '';
  await persistSettings();
  updateLogoDisplays();
}
function updateLogoDisplays() {
  const has = !!company.logo;
  const headerLogo = document.getElementById('headerLogo');
  headerLogo.src = company.logo || '';
  headerLogo.style.display = has ? 'inline-block' : 'none';
  document.getElementById('logoPreviewWrap').style.display = has ? 'block' : 'none';
  if (has) document.getElementById('logoPreview').src = company.logo;
}

/* ================= IMPORT / EXPORT ================= */
function exportData() {
  const blob = new Blob([JSON.stringify({ company, rates, employees, incomeLines, expenseLines, partners, seRates, ltdRates }, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `payroll-and-tax-data-${currentWorkspace}.json`; a.click();
  URL.revokeObjectURL(url);
}
function importData(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);

      if (data.company || data.rates || data.seRates || data.ltdRates) {
        if (data.company) company = { ...company, ...data.company };
        if (data.rates) rates = { ...rates, ...data.rates };
        if (data.seRates) seRates = { ...seRates, ...data.seRates };
        if (data.ltdRates) ltdRates = { ...ltdRates, ...data.ltdRates };
        await persistSettings();
      }
      // Employees, income/expense lines, and partners are appended as new rows
      // (their old ids came from the local version, not this database).
      if (data.employees && data.employees.length) {
        await supabaseClient.from('employees').insert(data.employees.map(({id, ...rest}) => ({ ...rest, workspace: currentWorkspace })));
      }
      if (data.incomeLines && data.incomeLines.length) {
        await supabaseClient.from('income_lines').insert(data.incomeLines.map(({id, desc, ...rest}) => ({ ...rest, description: desc, workspace: currentWorkspace })));
      }
      if (data.expenseLines && data.expenseLines.length) {
        await supabaseClient.from('expense_lines').insert(data.expenseLines.map(({id, desc, ...rest}) => ({ ...rest, description: desc, workspace: currentWorkspace })));
      }
      if (data.partners && data.partners.length) {
        await supabaseClient.from('partners').insert(data.partners.map(({id, ...rest}) => ({ ...rest, workspace: currentWorkspace })));
      }

      await loadAllData();
      renderCompany(); renderRates(); renderEmployees(); renderLines('income'); renderLines('expense'); renderPartners(); renderSeRates(); renderLtdRates(); toggleEntityType();
      alert('Data imported successfully into ' + WORKSPACES.find(w => w.id === currentWorkspace).label + '.');
    } catch (err) {
      console.error(err);
      alert('Could not import that file. Make sure it is a JSON export from this app.');
    }
  };
  reader.readAsText(file);
}
