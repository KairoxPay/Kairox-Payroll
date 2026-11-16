// My portal: "Announcements" card. Shows messages from the employer, opens any attached document, and lets the employee
// confirm "I have read and understood" when asked. Opening an announcement marks it as read (phase43-announcements.sql).

(function () {
  const WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const day = (iso) => { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };

  let card = null;
  let rows = [];
  let open = null;

  function makeCard() {
    const main = document.querySelector("main") || document.body;
    card = document.createElement("section");
    card.className = "page-card";
    card.id = "announceCard";
    // First on the page: something to confirm matters more than the rest.
    const first = main.querySelector("section, article, .page-card");
    if (first && first.parentNode) first.parentNode.insertBefore(card, first); else main.appendChild(card);
  }

  function render() {
    const todo = rows.filter((a) => a.requires_ack && !a.acknowledged_at).length;
    const unread = rows.filter((a) => !a.read_at).length;
    card.innerHTML = `
      <div class="page-card-head"><div><h3>Announcements${todo ? ` <span style="background:#b91c1c;color:#fff;border-radius:999px;padding:1px 9px;font-size:13px">${todo} to confirm</span>`
        : unread ? ` <span style="background:#4b2394;color:#fff;border-radius:999px;padding:1px 9px;font-size:13px">${unread} new</span>` : ""}</h3>
        <p>Messages and policies from your employer.</p></div></div>
      <div id="anMyMsg" class="form-message" role="status"></div>
      <div style="display:grid;gap:8px">${rows.slice(0, open ? 50 : 5).map((a) => {
        const isOpen = open === a.id;
        const state = a.requires_ack ? (a.acknowledged_at ? ["Confirmed " + day(a.acknowledged_at), "#16a34a"] : ["Please read and confirm" + (a.due_on ? ` by ${day(a.due_on)}` : ""), "#b91c1c"])
          : a.read_at ? ["Read", "#6f7285"] : ["New", "#4b2394"];
        return `<div style="border:1px solid ${isOpen ? "#6f3cc3" : "#e7e9f0"};border-radius:12px;padding:12px 14px">
          <button type="button" data-an-open="${esc(a.id)}" aria-expanded="${isOpen}" style="all:unset;display:flex;gap:10px;justify-content:space-between;align-items:center;width:100%;cursor:pointer">
            <span style="min-width:0"><strong style="display:block">${esc(a.title)}</strong><small style="color:#6f7285">${esc(day(a.created_at))}</small></span>
            <span style="color:${state[1]};font-weight:700;font-size:13px;text-align:right">${esc(state[0])}</span></button>
          ${isOpen ? `<div style="margin-top:10px">
            ${a.body ? `<p style="white-space:pre-line;margin:0 0 10px">${esc(a.body)}</p>` : ""}
            ${a.document_path ? `<p style="margin:0 0 10px"><button type="button" class="btn small" data-an-doc="${esc(a.document_path)}">Open ${esc(a.document_title || "the document")}</button></p>` : ""}
            ${a.requires_ack && !a.acknowledged_at ? `<label style="display:flex;gap:8px;align-items:flex-start;margin:6px 0 10px"><input type="checkbox" id="anMyTick">
                <span>I have read and understood this${a.document_path ? " and the attached document" : ""}.</span></label>
              <button type="button" class="btn primary" data-an-ack="${esc(a.id)}">Confirm</button>` : ""}
            ${a.acknowledged_at ? `<p style="margin:0;color:#16a34a;font-weight:700">You confirmed this on ${esc(day(a.acknowledged_at))}.</p>` : ""}
          </div>` : ""}</div>`;
      }).join("")}</div>
      ${!open && rows.length > 5 ? `<p class="muted small" style="margin:8px 0 0">${rows.length - 5} older announcements: open one to see them all.</p>` : ""}`;
  }

  function say(text, kind) { const b = document.getElementById("anMyMsg"); if (b) { b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); } }

  async function load(message) {
    const { data, error } = await supabaseClient.rpc("my_announcements", { p_workspace: WS });
    if (error || !data || !data.length) { if (card) card.remove(); card = null; return; }
    rows = data;
    if (!card) makeCard();
    render();
    if (message) say(message, "ok");
  }

  async function toggle(id) {
    open = open === id ? null : id;
    render();
    const a = rows.find((x) => x.id === id);
    if (open && a && !a.read_at) {
      const { error } = await supabaseClient.rpc("mark_announcement", { p_workspace: WS, p_id: id, p_acknowledge: false });
      if (!error) { a.read_at = new Date().toISOString(); render(); }
    }
  }

  async function confirmIt(id) {
    if (!document.getElementById("anMyTick").checked) return say("Tick the box to confirm you have read it.", "error");
    const { error } = await supabaseClient.rpc("mark_announcement", { p_workspace: WS, p_id: id, p_acknowledge: true });
    if (error) return say(error.message || "Not saved.", "error");
    await load("Thank you. Your confirmation has been recorded.");
  }

  async function openDoc(path) {
    const win = window.open("", "_blank");
    const { data, error } = await supabaseClient.storage.from("company-documents").createSignedUrl(path, 120);
    if (error || !data) { if (win) win.close(); return say("The document could not be opened. Please ask HR.", "error"); }
    if (win) win.location.href = data.signedUrl; else window.location.href = data.signedUrl;
  }

  document.addEventListener("click", (event) => {
    const t = event.target;
    if (!t || !t.closest || !card || !card.contains(t)) return;
    const o = t.closest("[data-an-open]"); if (o) return toggle(o.dataset.anOpen);
    const k = t.closest("[data-an-ack]"); if (k) return confirmIt(k.dataset.anAck);
    const d = t.closest("[data-an-doc]"); if (d) return openDoc(d.dataset.anDoc);
  });

  async function start() {
    if (typeof supabaseClient === "undefined") return;
    const { data } = await supabaseClient.auth.getSession();
    if (!data || !data.session) return;
    await load();
  }

  if (!window.__ANMY_TEST__) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  }
  window.kxAnnouncementsLoad = load;
})();
