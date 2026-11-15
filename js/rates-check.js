// Statutory rates check on the Compliance page: shows the rates Kairox Pay uses, compares them with the latest published
// Jamaican rates below, and reminds you to check them after 1 January and 1 April each year (Jamaica's income tax
// threshold has changed on 1 April each year since 2024). Nothing changes automatically: an admin edits the rates in
// Settings > Statutory rates, or confirms they are still correct here.

// The latest published rates known to Kairox Pay. Update this list when TAJ announces new rates.
const KX_RATES_REFERENCE = {
  asOf: "2026-11-15",
  note: "Income tax threshold in force from 1 April 2026. Confirm every figure with TAJ (jamaicatax.gov.jm) before relying on it.",
  employee: [
    ["threshold", "Income tax-free threshold (per year)", 1902360, "money"],
    ["payeLower", "PAYE rate up to the band", 25, "pct"],
    ["payeBand", "PAYE higher band starts at (per year)", 6000000, "money"],
    ["payeHigher", "PAYE rate above the band", 30, "pct"],
    ["nis", "NIS (employee)", 3, "pct"],
    ["nisCeiling", "NIS ceiling (per year)", 5000000, "money"],
    ["nht", "NHT (employee)", 2, "pct"],
    ["edTax", "Education Tax (employee)", 2.25, "pct"]
  ],
  employer: "Employer shares used by Kairox Pay: NIS 3%, NHT 3%, Education Tax 3.5%, HEART/NSTA 3%."
};

// Pure: is a check due, and which rates differ? (tested)
function kxRatesStatus(saved, lastCheckedIso, todayIso) {
  const today = String(todayIso).slice(0, 10);
  const year = Number(today.slice(0, 4));
  const marks = [`${year}-01-01`, `${year}-04-01`].filter((d) => d <= today);
  const since = marks.length ? marks[marks.length - 1] : `${year - 1}-04-01`;
  const last = lastCheckedIso ? String(lastCheckedIso).slice(0, 10) : "";
  const differences = KX_RATES_REFERENCE.employee
    .filter(([key, , value]) => Math.abs(Number(saved && saved[key]) - value) > 0.0001)
    .map(([key]) => key);
  return { due: !last || last < since, since, last, differences };
}

(function () {
  const WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const fmt = (v, kind) => (v == null || v === "" || !isFinite(Number(v)) ? "—"
    : kind === "pct" ? `${Number(v)}%` : `JMD ${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
  const day = (iso) => {
    if (!iso) return "never";
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(y, m - 1, d));
  };
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  let role = null;

  async function load() {
    const card = el("ratesCard");
    if (!card || typeof supabaseClient === "undefined") return;

    const roleResult = await supabaseClient.rpc("get_my_role", { p_workspace: WS });
    role = roleResult.data;
    if (!["admin", "director", "payroll"].includes(role)) return;

    let result = await supabaseClient.from("payroll_rates").select("rates, updated_at, checked_at").eq("workspace", WS).maybeSingle();
    if (result.error) result = await supabaseClient.from("payroll_rates").select("rates, updated_at").eq("workspace", WS).maybeSingle();
    if (result.error) return;

    const row = result.data || {};
    const saved = row.rates || null;
    const lastChecked = [row.checked_at, row.updated_at].filter(Boolean).sort().pop() || "";
    render(saved, lastChecked, row.checked_at === undefined);
    card.hidden = false;
  }

  function render(saved, lastChecked, needsSql) {
    const status = kxRatesStatus(saved || {}, lastChecked, todayIso());
    const ref = KX_RATES_REFERENCE;
    const rows = ref.employee.map(([key, label, value, kind]) => {
      const mine = saved ? saved[key] : null;
      const differs = status.differences.includes(key);
      return `<tr${differs ? ' style="background:#fff7e6"' : ""}><td>${esc(label)}</td>
        <td class="num">${saved ? fmt(mine, kind) : '<span class="muted">built-in</span>'}</td>
        <td class="num">${fmt(value, kind)}</td>
        <td>${!saved ? "Using built-in rates" : differs ? '<strong style="color:#b45309">Different</strong>' : "Matches"}</td></tr>`;
    }).join("");

    const headline = !saved
      ? "No rates are saved for this company, so Kairox Pay uses its built-in rates."
      : status.differences.length
        ? `${status.differences.length} ${status.differences.length === 1 ? "rate differs" : "rates differ"} from the latest published figures. Check them with TAJ and correct them in Settings > Statutory rates.`
        : status.due
          ? `The rates match the latest figures Kairox Pay knows, but they have not been checked since ${day(status.since)}. Rates often change on 1 April: confirm them with TAJ.`
          : `The rates match the latest published figures and were checked on ${day(status.last)}.`;

    const tone = !saved || status.differences.length || status.due ? "border-left:4px solid #d97706" : "border-left:4px solid #16a34a";
    const isAdmin = role === "admin";

    el("ratesBody").innerHTML = `
      <div class="note" style="margin:0 0 12px;${tone}"><strong>${esc(headline)}</strong><br>
        <span class="small">Last checked or changed: ${esc(day(status.last))}. ${esc(ref.note)}</span></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Rate</th><th class="num">Kairox Pay uses</th><th class="num">Latest published</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="muted small" style="margin:8px 0 12px">${esc(ref.employer)} Reference list updated ${esc(day(ref.asOf))}.</p>
      <div id="ratesMsg" class="form-message" role="status"></div>
      <div class="row-actions">
        ${isAdmin ? '<a class="btn" href="settings.html">Change rates in Settings</a>' : ""}
        ${isAdmin && saved && !status.differences.length && !needsSql ? '<button type="button" class="btn primary" id="ratesConfirm">These rates are correct</button>' : ""}
        ${!isAdmin && (status.due || status.differences.length) ? '<span class="muted small">Ask an admin to check the rates.</span>' : ""}
        ${isAdmin && needsSql ? '<span class="muted small">Run phase24-rates-check.sql in Supabase to record checks.</span>' : ""}
      </div>`;
  }

  document.addEventListener("click", async (event) => {
    if (event.target.id !== "ratesConfirm") return;
    event.target.disabled = true;
    const { error } = await supabaseClient.rpc("confirm_payroll_rates", { p_workspace: WS });
    const msg = el("ratesMsg");
    if (error) {
      msg.textContent = error.message || "The check could not be recorded.";
      msg.className = "form-message error";
      event.target.disabled = false;
      return;
    }
    await load();
    const after = el("ratesMsg");
    if (after) { after.textContent = "Recorded: the rates were checked today."; after.className = "form-message ok"; }
  });

  if (!window.__RATES_TEST__) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
  }
  window.kxRatesLoad = load;
})();
