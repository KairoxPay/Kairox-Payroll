// Settings: "Company colours" card (admins and managing directors). Choose a main and an accent colour for THIS company,
// show the company logo at the top of the menu, and use the colours on payslips. Changes preview straight away and only
// affect this company (phase45-company-brand.sql). Needs js/topbar.js on the page (window.KairoxBrand).

(function () {
  const WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const PRESETS = [
    ["Kairox purple", "", ""], ["Royal blue", "#1d4ed8", "#f59e0b"], ["Ocean", "#0e7490", "#f97316"], ["Forest green", "#166534", "#eab308"],
    ["Jamaica green and gold", "#007a3d", "#fed100"], ["Crimson", "#b91c1c", "#0ea5e9"], ["Charcoal", "#334155", "#22c55e"], ["Plum", "#86198f", "#14b8a6"]
  ];

  let saved = null;

  function card() {
    const box = document.createElement("section");
    box.className = "payroll-table-card settings-section";
    box.id = "brandCard";
    box.innerHTML = `
      <div class="payroll-table-heading"><div><h2>Company colours</h2>
        <p>Your company's colours in Kairox Pay, for everyone who works here. Only this company changes; the layout stays the same.</p></div></div>
      <div class="settings-body">
        <p style="margin:0 0 8px;font-weight:700">Quick choices</p>
        <div id="brPresets" style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px">${PRESETS.map((p, i) =>
          `<button type="button" data-preset="${i}" style="display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border:1px solid #dfe0e8;border-radius:999px;background:#fff;font:inherit;cursor:pointer">
            <span style="width:16px;height:16px;border-radius:50%;background:${p[1] || "#4b2394"}"></span><span style="width:10px;height:10px;border-radius:50%;background:${p[2] || "#2cb8b3"}"></span>${esc(p[0])}</button>`).join("")}</div>
        <div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-end">
          <label style="display:grid;gap:6px;font-weight:700">Main colour <span style="display:flex;gap:8px;align-items:center"><input type="color" id="brPrimary" value="#4b2394" style="width:52px;height:40px;padding:2px;border:1px solid #dfe0e8;border-radius:8px"><code id="brPrimaryHex">#4b2394</code></span></label>
          <label style="display:grid;gap:6px;font-weight:700">Accent colour <span style="display:flex;gap:8px;align-items:center"><input type="color" id="brAccent" value="#2cb8b3" style="width:52px;height:40px;padding:2px;border:1px solid #dfe0e8;border-radius:8px"><code id="brAccentHex">#2cb8b3</code></span></label>
        </div>
        <p id="brNote" class="settings-meta" style="margin:10px 0 0"></p>
        <div style="display:grid;gap:8px;margin:16px 0">
          <label class="settings-check"><input type="checkbox" id="brMenuLogo"> Show our company logo at the top of the menu (upload it in Company profile above)</label>
          <label class="settings-check"><input type="checkbox" id="brPayslips"> Use these colours on payslips (on screen and in the PDF)</label>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button type="button" class="primary" id="brSave" style="padding:10px 18px;border-radius:10px;border:1px solid transparent;font:inherit;font-weight:700;cursor:pointer;color:#fff;background:var(--purple-600,#4b2394)">Save colours</button>
          <button type="button" id="brReset" style="padding:10px 18px;border-radius:10px;border:1px solid #dfe0e8;background:#fff;font:inherit;font-weight:700;cursor:pointer">Use the Kairox Pay colours</button>
          <span id="brMsg" class="settings-meta" role="status"></span>
        </div>
        <p class="settings-meta" style="margin:12px 0 0">You see the change as you choose. It is only saved, and shown to others, when you press Save. If a colour is too light for white text, Kairox Pay uses a deeper shade of it automatically.</p>
      </div>`;
    const after = document.getElementById("companyCard");
    if (after && after.parentNode) after.after(box); else (document.querySelector("main") || document.body).appendChild(box);
    return box;
  }

  const current = () => ({ primary: document.getElementById("brPrimary").dataset.unset === "1" ? null : document.getElementById("brPrimary").value,
    accent: document.getElementById("brPrimary").dataset.unset === "1" ? null : document.getElementById("brAccent").value,
    menuLogo: document.getElementById("brMenuLogo").checked, payslips: document.getElementById("brPayslips").checked });

  function preview() {
    const b = current();
    document.getElementById("brPrimaryHex").textContent = b.primary || "Kairox purple";
    document.getElementById("brAccentHex").textContent = b.accent || "Kairox teal";
    const s = b.primary && window.KairoxBrand.shades(b);
    document.getElementById("brNote").textContent = s && s.button !== s.primary
      ? "This colour is light, so buttons and the menu use a deeper shade of it to keep white text readable." : "";
    window.KairoxBrand.apply(b, false);
  }

  function fill(b) {
    const p = document.getElementById("brPrimary");
    p.value = (b && b.primary) || "#4b2394"; p.dataset.unset = b && b.primary ? "0" : "1";
    document.getElementById("brAccent").value = (b && b.accent) || "#2cb8b3";
    document.getElementById("brMenuLogo").checked = !!(b && b.menuLogo);
    document.getElementById("brPayslips").checked = !!(b && b.payslips);
    preview();
  }

  function say(text, ok) { const m = document.getElementById("brMsg"); m.textContent = text; m.style.color = ok ? "#16a34a" : "#b91c1c"; }

  async function save() {
    const b = current();
    const { error } = await supabaseClient.rpc("save_company_brand", { p_workspace: WS, p_primary: b.primary, p_accent: b.accent, p_menu_logo: b.menuLogo, p_payslips: b.payslips });
    if (error) return say(/could not find the function/i.test(error.message || "") ? "Run phase45-company-brand.sql in Supabase first." : error.message || "Not saved.", false);
    saved = b;
    window.KairoxBrand.apply(b, true);
    say("Saved. Everyone in this company sees these colours from their next page.", true);
  }

  async function start() {
    if (typeof supabaseClient === "undefined" || !window.KairoxBrand) return;
    const { data } = await supabaseClient.auth.getSession();
    if (!data || !data.session) return;
    const { data: role } = await supabaseClient.rpc("get_my_role", { p_workspace: WS });
    if (!["admin", "director"].includes(role)) return;
    const { data: rows, error } = await supabaseClient.rpc("company_brand", { p_workspace: WS });
    card();
    const row = (!error && rows && rows[0]) || {};
    saved = { primary: row.brand_primary || null, accent: row.brand_accent || null, menuLogo: !!row.brand_menu_logo, payslips: !!row.brand_payslips };
    fill(saved);
    if (error) say("Run phase45-company-brand.sql in Supabase to save colours.", false);

    document.getElementById("brPresets").addEventListener("click", (event) => {
      const b = event.target.closest("[data-preset]"); if (!b) return;
      const p = PRESETS[Number(b.dataset.preset)];
      fill({ primary: p[1] || null, accent: p[2] || null, menuLogo: document.getElementById("brMenuLogo").checked, payslips: document.getElementById("brPayslips").checked });
    });
    ["brPrimary", "brAccent"].forEach((id) => document.getElementById(id).addEventListener("input", () => { document.getElementById("brPrimary").dataset.unset = "0"; preview(); }));
    ["brMenuLogo", "brPayslips"].forEach((id) => document.getElementById(id).addEventListener("change", preview));
    document.getElementById("brSave").addEventListener("click", save);
    document.getElementById("brReset").addEventListener("click", () => fill({ primary: null, accent: null, menuLogo: false, payslips: false }));
    // Leaving without saving: put the saved colours back for the next page.
    window.addEventListener("pagehide", () => { if (saved) window.KairoxBrand.apply(saved, true); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
