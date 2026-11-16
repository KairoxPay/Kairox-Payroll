// My portal: "Expense claims" card. The employee claims money they spent for work, with a photo or PDF of the receipt.
// Shown only when the employer has turned expense claims on (Expenses page). Approved claims are paid with payroll.

(function () {
  const WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
  const BUCKET = "expense-receipts";
  const MAX = 5 * 1024 * 1024;
  const CATEGORIES = ["Travel", "Fuel", "Meals", "Supplies", "Phone and internet", "Courier and postage", "Other"];
  const STATUS = {
    pending: ["Waiting for approval", "#b45309"], approved: ["Approved: paid with the next payroll", "#16a34a"],
    rejected: ["Not approved", "#b91c1c"], paid: ["Paid", "#2563eb"], cancelled: ["Cancelled", "#6f7285"]
  };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const money = (n) => `J$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const day = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  let card = null;
  let me = null;
  let claims = [];

  function makeCard() {
    const main = document.querySelector("main") || document.body;
    card = document.createElement("section");
    card.className = "page-card";
    card.id = "expenseCard";
    const clock = document.getElementById("clockCard");
    const first = main.querySelector("section, article, .page-card");
    const before = clock ? clock.nextSibling : first;
    if (before && before.parentNode) before.parentNode.insertBefore(card, before); else main.appendChild(card);
  }

  function render() {
    const waiting = claims.filter((c) => c.status === "pending" || c.status === "approved").reduce((t, c) => t + Number(c.amount), 0);
    card.innerHTML = `
      <div class="page-card-head"><div><h3>Expense claims</h3>
        <p>Spent your own money for work? Claim it here with a photo of the receipt. Approved claims are paid with your next payroll.</p></div>
        <button type="button" class="btn primary" id="expNew">New claim</button></div>
      <form id="expForm" hidden style="border:1px solid #e3e4ec;border-radius:12px;padding:14px;margin:0 0 14px">
        <div class="form-grid">
          <div class="field"><label for="expDate">Date spent</label><input id="expDate" type="date" max="${today()}" value="${today()}" required></div>
          <div class="field"><label for="expCat">What for</label><select id="expCat">${CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>
          <div class="field"><label for="expAmt">Amount (J$)</label><input id="expAmt" type="number" min="0.01" step="0.01" inputmode="decimal" required></div>
          <div class="field"><label for="expDesc">Description</label><input id="expDesc" maxlength="200" placeholder="For example: taxi to the bank for the deposit" required></div>
          <div class="field"><label for="expFile">Receipt (photo or PDF)</label><input id="expFile" type="file" accept="image/*,application/pdf" capture="environment"></div>
        </div>
        <p class="muted small" style="margin:6px 0 10px">Large photos are made smaller before they are sent. Only you and the people who approve or pay claims can open your receipt.</p>
        <div id="expFormMsg" class="form-message" role="status"></div>
        <div class="dialog-actions"><button type="button" class="btn" id="expCancelForm">Cancel</button><button type="submit" class="btn primary" id="expSend">Send claim</button></div>
      </form>
      <div id="expMsg" class="form-message" role="status"></div>
      ${waiting ? `<p style="margin:0 0 10px"><strong>Still to be paid to you:</strong> ${esc(money(waiting))}</p>` : ""}
      ${claims.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>What for</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
        <tbody>${claims.map((c) => {
          const st = STATUS[c.status] || [c.status, "inherit"];
          return `<tr><td>${esc(day(c.spent_on))}</td><td><strong>${esc(c.category)}</strong><small style="display:block;color:#6f7285">${esc(c.description)}</small></td>
            <td class="num">${esc(money(c.amount))}</td>
            <td><span style="color:${st[1]};font-weight:700">${esc(st[0])}</span>${c.decision_note ? `<small style="display:block;color:#6f7285">${esc(c.decision_note)}</small>` : ""}</td>
            <td style="white-space:nowrap">${c.receipt_path ? `<button type="button" class="btn small" data-exp-receipt="${esc(c.receipt_path)}">Receipt</button>` : ""}
              ${c.status === "pending" ? `<button type="button" class="btn small" data-exp-cancel="${esc(c.id)}">Cancel</button>` : ""}</td></tr>`;
        }).join("")}</tbody></table></div>` : '<p class="muted small" style="margin:0">No claims yet.</p>'}`;
  }

  async function load() {
    const { data, error } = await supabaseClient.rpc("my_expense_claims", { p_workspace: WS });
    if (error || !data || !data[0] || !data[0].enabled) { if (card) card.remove(); card = null; return; }
    me = data[0].me;
    claims = data.filter((r) => r.id);
    if (!card) makeCard();
    render();
  }

  function say(id, text, kind) { const b = document.getElementById(id); if (b) { b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); } }

  // Phone photos are often 3–10 MB: redraw big images at most 1600 px wide as JPEG. PDFs and small files go as they are.
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5 * 1024 * 1024) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.8));
      return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
    } catch (e) {
      return file;
    }
  }

  async function send(event) {
    event.preventDefault();
    const btn = document.getElementById("expSend");
    const amount = Number(document.getElementById("expAmt").value);
    const desc = document.getElementById("expDesc").value.trim();
    const spent = document.getElementById("expDate").value;
    const picked = document.getElementById("expFile").files[0];
    if (!spent) return say("expFormMsg", "Enter the date you spent the money.", "error");
    if (!(amount > 0)) return say("expFormMsg", "Enter the amount on the receipt.", "error");
    if (desc.length < 3) return say("expFormMsg", "Say briefly what it was for.", "error");
    if (!picked) return say("expFormMsg", "Add a photo or PDF of the receipt.", "error");

    btn.disabled = true;
    say("expFormMsg", "Sending…");
    let path = null;
    const file = await shrink(picked);
    if (file.size > MAX) { btn.disabled = false; return say("expFormMsg", "The receipt is bigger than 5 MB. Take a smaller photo or send a PDF.", "error"); }
    const safe = (file.name || "receipt").replace(/[^\w.-]+/g, "_").slice(-60);
    path = `${WS}/${me}/${Date.now()}-${safe}`;
    const up = await supabaseClient.storage.from(BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (up.error) { btn.disabled = false; return say("expFormMsg", `The receipt could not be sent: ${up.error.message || "error"}`, "error"); }

    const { error } = await supabaseClient.rpc("submit_expense", {
      p_workspace: WS, p_spent: spent, p_category: document.getElementById("expCat").value, p_description: desc, p_amount: amount, p_receipt: path
    });
    if (error) { btn.disabled = false; return say("expFormMsg", error.message || "The claim was not sent.", "error"); }
    await load();
    say("expMsg", "Claim sent. Your manager will look at it.", "ok");
  }

  async function openReceipt(path) {
    const win = window.open("", "_blank");
    const { data, error } = await supabaseClient.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error || !data) { if (win) win.close(); return say("expMsg", "The receipt could not be opened.", "error"); }
    if (win) win.location.href = data.signedUrl; else window.location.href = data.signedUrl;
  }

  document.addEventListener("click", async (event) => {
    const t = event.target;
    if (!t || !t.closest || !card || !card.contains(t)) return;
    if (t.id === "expNew") { document.getElementById("expForm").hidden = false; document.getElementById("expAmt").focus(); return; }
    if (t.id === "expCancelForm") { document.getElementById("expForm").hidden = true; return; }
    const r = t.closest("[data-exp-receipt]"); if (r) return openReceipt(r.dataset.expReceipt);
    const c = t.closest("[data-exp-cancel]");
    if (c) {
      const { error } = await supabaseClient.rpc("cancel_my_expense", { p_workspace: WS, p_id: c.dataset.expCancel });
      if (error) return say("expMsg", error.message || "Not cancelled.", "error");
      await load();
      say("expMsg", "Claim cancelled.", "ok");
    }
  });
  document.addEventListener("submit", (event) => { if (event.target && event.target.id === "expForm") send(event); });

  async function start() {
    if (typeof supabaseClient === "undefined") return;
    const { data } = await supabaseClient.auth.getSession();
    if (!data || !data.session) return;
    await load();
  }

  if (!window.__EXP_TEST__) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  }
  window.kxExpensesLoad = load;
})();
