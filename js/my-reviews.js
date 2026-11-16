// My portal: "Performance reviews" card. The employee rates themselves (when asked), then reads the shared review,
// can add a comment and confirms they have seen it (phase44-performance-reviews.sql). Shown only when they have a review.

(function () {
  const WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const day = (iso) => { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
  const SCALE = ["", "Needs improvement", "Developing", "Meets expectations", "Exceeds expectations", "Outstanding"];
  const STATE = { self: ["Please rate yourself", "#b91c1c"], manager: ["With your manager", "#6f7285"], shared: ["Ready for you to read", "#b91c1c"], closed: ["Done", "#16a34a"] };

  let card = null;
  let rows = [];
  let open = null;

  function makeCard() {
    const main = document.querySelector("main") || document.body;
    card = document.createElement("section");
    card.className = "page-card";
    card.id = "reviewCard";
    const after = document.getElementById("announceCard");
    const before = after ? after.nextSibling : main.querySelector("section, article, .page-card");
    if (before && before.parentNode) before.parentNode.insertBefore(card, before); else main.appendChild(card);
  }

  const rate = (name, value, locked) => `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0">${[1, 2, 3, 4, 5].map((n) =>
    `<label title="${SCALE[n]}" style="display:inline-flex;gap:5px;align-items:center;padding:6px 10px;border:1px solid ${Number(value) === n ? "#4b2394" : "#dfe0e8"};border-radius:999px;font-size:14px;${Number(value) === n ? "background:#ece6f8;font-weight:700" : ""}">
      <input type="radio" name="${name}" value="${n}"${Number(value) === n ? " checked" : ""}${locked ? " disabled" : ""} style="margin:0"> ${n}</label>`).join("")}</div>`;

  function body(r) {
    if (r.status === "self") {
      return `<p class="muted small" style="margin:0 0 8px">Rate yourself on each point from 1 (needs improvement) to 5 (outstanding) and add a comment if you like. Your manager sees this before writing theirs.${r.due_on ? ` Please send it by <strong>${esc(day(r.due_on))}</strong>.` : ""}</p>
        ${r.items.map((i) => `<div data-item="${esc(i.id)}" style="padding:10px 0;border-top:1px solid #eceef4"><strong>${esc(i.title)}</strong>${i.description ? `<small style="display:block;color:#6f7285">${esc(i.description)}</small>` : ""}
          ${rate(`self_${i.id}`, i.self_rating, false)}<textarea maxlength="1000" aria-label="Comment on ${esc(i.title)}" placeholder="Comment (optional)" style="width:100%;min-height:56px;padding:8px 10px;border:1px solid #dfe0e8;border-radius:10px;font:inherit">${esc(i.self_comment || "")}</textarea></div>`).join("")}
        <div class="dialog-actions"><button type="button" class="btn" data-rv-save="${esc(r.id)}">Save for later</button><button type="button" class="btn primary" data-rv-send="${esc(r.id)}">Send to my manager</button></div>`;
    }
    if (r.status === "manager") {
      return `<p style="margin:0">${r.self_submitted_at ? `You sent your self-review on ${esc(day(r.self_submitted_at))}. ` : ""}Your manager is completing the review. You will see it here once it is shared.</p>`;
    }
    const shared = r.status === "shared";
    return `${r.items.map((i) => `<div style="padding:10px 0;border-top:1px solid #eceef4"><strong>${esc(i.title)}</strong>
        <p style="margin:4px 0 0">Your manager: <strong>${esc(i.manager_rating)} / 5</strong> (${esc(SCALE[i.manager_rating] || "")})${i.self_rating ? ` · You: ${esc(i.self_rating)} / 5` : ""}</p>
        ${i.manager_comment ? `<p style="margin:4px 0 0;color:#303145">${esc(i.manager_comment)}</p>` : ""}</div>`).join("")}
      <div style="padding:10px 0;border-top:1px solid #eceef4"><strong>Overall: ${esc(r.overall_rating)} / 5 (${esc(SCALE[r.overall_rating] || "")})</strong>
        ${r.summary ? `<p style="white-space:pre-line;margin:6px 0 0">${esc(r.summary)}</p>` : ""}
        ${r.next_goals ? `<p style="margin:10px 0 0"><strong>Goals for next time</strong></p><p style="white-space:pre-line;margin:4px 0 0">${esc(r.next_goals)}</p>` : ""}
        ${r.reviewer ? `<small style="display:block;color:#6f7285;margin-top:6px">Reviewed by ${esc(r.reviewer)}, shared ${esc(day(r.shared_at))}</small>` : ""}</div>
      ${shared ? `<div class="field" style="margin-top:8px"><label for="rvMyComment">Your comment (optional)</label><textarea id="rvMyComment" maxlength="2000" style="width:100%;min-height:60px;padding:8px 10px;border:1px solid #dfe0e8;border-radius:10px;font:inherit"></textarea></div>
        <button type="button" class="btn primary" data-rv-ack="${esc(r.id)}">I have seen this review</button>
        <p class="muted small" style="margin:6px 0 0">Confirming means you have seen it, not that you agree with every point. Use the comment to say if you do not.</p>`
        : `<p style="margin:8px 0 0;color:#16a34a;font-weight:700">You confirmed you saw this on ${esc(day(r.acknowledged_at))}.</p>${r.employee_comment ? `<p class="muted small" style="margin:4px 0 0">Your comment: ${esc(r.employee_comment)}</p>` : ""}`}`;
  }

  function render() {
    const todo = rows.filter((r) => r.status === "self" || r.status === "shared").length;
    card.innerHTML = `<div class="page-card-head"><div><h3>Performance reviews${todo ? ` <span style="background:#b91c1c;color:#fff;border-radius:999px;padding:1px 9px;font-size:13px">${todo} for you</span>` : ""}</h3>
        <p>Your reviews, and anything waiting for you.</p></div></div>
      <div id="rvMyMsg" class="form-message" role="status"></div>
      <div style="display:grid;gap:8px">${rows.map((r) => {
        const st = STATE[r.status] || [r.status, "inherit"];
        const isOpen = open === r.id;
        return `<div style="border:1px solid ${isOpen ? "#6f3cc3" : "#e7e9f0"};border-radius:12px;padding:12px 14px">
          <button type="button" data-rv-open="${esc(r.id)}" aria-expanded="${isOpen}" style="all:unset;display:flex;gap:10px;justify-content:space-between;align-items:center;width:100%;cursor:pointer">
            <span><strong style="display:block">${esc(r.title)}</strong>${r.period_start ? `<small style="color:#6f7285">${esc(day(r.period_start))} to ${esc(day(r.period_end))}</small>` : ""}</span>
            <span style="color:${st[1]};font-weight:700;font-size:13px">${esc(st[0])}</span></button>
          ${isOpen ? `<div style="margin-top:10px">${body(r)}</div>` : ""}</div>`;
      }).join("")}</div>`;
  }

  function say(text, kind) { const b = document.getElementById("rvMyMsg"); if (b) { b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); } }

  async function load(message) {
    const { data, error } = await supabaseClient.rpc("my_reviews", { p_workspace: WS });
    if (error || !Array.isArray(data) || !data.length) { if (card) card.remove(); card = null; return; }
    rows = data;
    if (open === null) { const first = rows.find((r) => r.status === "self" || r.status === "shared"); open = first ? first.id : null; }
    if (!card) makeCard();
    render();
    if (message) say(message, "ok");
  }

  async function saveSelf(id, submit) {
    const items = [...card.querySelectorAll("[data-item]")].map((box) => {
      const picked = box.querySelector("input[type=radio]:checked");
      return { id: box.dataset.item, rating: picked ? Number(picked.value) : null, comment: box.querySelector("textarea").value.trim() };
    });
    if (submit && items.some((i) => !i.rating)) return say("Rate every point before sending.", "error");
    const { error } = await supabaseClient.rpc("save_self_review", { p_workspace: WS, p_id: id, p_items: items, p_submit: submit });
    if (error) return say(error.message || "Not saved.", "error");
    await load(submit ? "Sent to your manager. Thank you." : "Saved. You can finish it later.");
  }

  async function ack(id) {
    const { error } = await supabaseClient.rpc("acknowledge_review", { p_workspace: WS, p_id: id, p_comment: (document.getElementById("rvMyComment") || {}).value || null });
    if (error) return say(error.message || "Not saved.", "error");
    await load("Thank you. Your review is complete.");
  }

  document.addEventListener("click", (event) => {
    const t = event.target;
    if (!t || !t.closest || !card || !card.contains(t)) return;
    const o = t.closest("[data-rv-open]"); if (o) { open = open === o.dataset.rvOpen ? "" : o.dataset.rvOpen; return render(); }
    const s = t.closest("[data-rv-save]"); if (s) return saveSelf(s.dataset.rvSave, false);
    const n = t.closest("[data-rv-send]"); if (n) return saveSelf(n.dataset.rvSend, true);
    const a = t.closest("[data-rv-ack]"); if (a) return ack(a.dataset.rvAck);
  });
  // Show the chosen rating straight away.
  document.addEventListener("change", (event) => {
    const t = event.target;
    if (!card || !card.contains(t) || t.type !== "radio") return;
    t.closest("div").querySelectorAll("label").forEach((l) => { const on = l.querySelector("input").checked; l.style.borderColor = on ? "#4b2394" : "#dfe0e8"; l.style.background = on ? "#ece6f8" : ""; l.style.fontWeight = on ? "700" : ""; });
  });

  async function start() {
    if (typeof supabaseClient === "undefined") return;
    const { data } = await supabaseClient.auth.getSession();
    if (!data || !data.session) return;
    await load();
  }

  if (!window.__RVMY_TEST__) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  }
  window.kxMyReviewsLoad = load;
})();
