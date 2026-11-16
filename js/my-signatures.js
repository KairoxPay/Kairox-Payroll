// My portal: "Documents to sign" card. Open the PDF, type your full name (and draw your signature if you like), agree to
// sign electronically, and sign. The fingerprint of the file you opened is checked against the one your employer sent.
// Needs js/sign-certificate.js on the page. Database: phase47-e-signatures.sql.

(function () {
  const WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const day = (iso) => { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };

  let card = null;
  let rows = [];
  let open = null;
  const seen = {};   // request id -> { hash, bytes } of the file this person opened
  let drawn = false;

  function makeCard() {
    const main = document.querySelector("main") || document.body;
    card = document.createElement("section");
    card.className = "page-card";
    card.id = "signCard";
    const after = document.getElementById("announceCard");
    const before = after ? after.nextSibling : main.querySelector("section, article, .page-card");
    if (before && before.parentNode) before.parentNode.insertBefore(card, before); else main.appendChild(card);
  }

  function panel(r) {
    if (r.status === "signed") {
      return `<p style="margin:0;color:#16a34a;font-weight:700">You signed this on ${esc(day(r.signed_at))} as "${esc(r.signed_name)}".</p>
        <button type="button" class="btn small" data-sg-mine="${esc(r.id)}" style="margin-top:8px">Download my signed copy</button>`;
    }
    if (r.status === "declined") return '<p style="margin:0;color:#b91c1c;font-weight:700">You declined to sign this. Your employer has been told.</p>';
    const opened = !!seen[r.id];
    return `${r.message ? `<p style="margin:0 0 10px;white-space:pre-line">${esc(r.message)}</p>` : ""}
      <p style="margin:0 0 10px"><button type="button" class="btn${opened ? "" : " primary"}" data-sg-view="${esc(r.id)}">${opened ? "Open the document again" : "1. Open and read the document"}</button></p>
      <fieldset ${opened ? "" : "disabled"} style="border:1px solid #e7e9f0;border-radius:12px;padding:12px 14px;margin:0;${opened ? "" : "opacity:.55"}">
        <legend style="font-weight:700;padding:0 6px">2. Sign</legend>
        <div class="field" style="margin:0 0 10px"><label for="sgName">Type your full name</label><input id="sgName" maxlength="120" autocomplete="name" placeholder="${esc(r.name_on_file)}"></div>
        <p style="margin:0 0 6px;font-weight:700;font-size:14px">Draw your signature (optional)</p>
        <canvas id="sgPad" width="560" height="140" style="width:100%;max-width:560px;height:140px;border:1px dashed #b8b3cf;border-radius:10px;background:#fff;touch-action:none" aria-label="Signature pad"></canvas>
        <p style="margin:4px 0 10px"><button type="button" class="btn small" id="sgClear">Clear</button></p>
        <label style="display:flex;gap:8px;align-items:flex-start;margin:0 0 12px"><input type="checkbox" id="sgAgree" style="margin-top:3px">
          <span>I have read "${esc(r.title)}". I agree to sign it electronically, and that my typed name is my signature.</span></label>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn primary" data-sg-sign="${esc(r.id)}">Sign</button>
          <button type="button" class="btn" data-sg-decline="${esc(r.id)}">I cannot sign this</button></div>
      </fieldset>`;
  }

  function render() {
    const todo = rows.filter((r) => r.status === "pending").length;
    card.innerHTML = `<div class="page-card-head"><div><h3>Documents to sign${todo ? ` <span style="background:#b91c1c;color:#fff;border-radius:999px;padding:1px 9px;font-size:13px">${todo}</span>` : ""}</h3>
        <p>Contracts and documents from your employer.</p></div></div>
      <div id="sgMyMsg" class="form-message" role="status"></div>
      <div style="display:grid;gap:8px">${rows.map((r) => {
        const isOpen = open === r.id;
        const st = r.status === "signed" ? ["Signed", "#16a34a"] : r.status === "declined" ? ["Declined", "#6f7285"] : [`Please sign${r.due_on ? ` by ${day(r.due_on)}` : ""}`, "#b91c1c"];
        return `<div style="border:1px solid ${isOpen ? "#6f3cc3" : "#e7e9f0"};border-radius:12px;padding:12px 14px">
          <button type="button" data-sg-toggle="${esc(r.id)}" aria-expanded="${isOpen}" style="all:unset;display:flex;gap:10px;justify-content:space-between;align-items:center;width:100%;cursor:pointer">
            <span><strong style="display:block">${esc(r.title)}</strong><small style="color:#6f7285">${esc(r.document_name)} · ${esc(day(r.created_at))}</small></span>
            <span style="color:${st[1]};font-weight:700;font-size:13px">${esc(st[0])}</span></button>
          ${isOpen ? `<div style="margin-top:10px">${panel(r)}</div>` : ""}</div>`;
      }).join("")}</div>`;
    setUpPad();
  }

  function setUpPad() {
    const pad = document.getElementById("sgPad");
    if (!pad) return;
    drawn = false;
    const ctx = pad.getContext && pad.getContext("2d");
    if (!ctx) { pad.hidden = true; return; }   // very old browsers: typed name only
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#17172f";
    let down = false;
    const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * (pad.width / r.width), (e.clientY - r.top) * (pad.height / r.height)]; };
    pad.addEventListener("pointerdown", (e) => { down = true; pad.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); });
    pad.addEventListener("pointermove", (e) => { if (!down) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); drawn = true; });
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => pad.addEventListener(ev, () => { down = false; }));
  }

  function say(text, kind) { const b = document.getElementById("sgMyMsg"); if (b) { b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); } }

  async function load(message) {
    const { data, error } = await supabaseClient.rpc("my_signature_requests", { p_workspace: WS });
    if (error || !data || !data.length) { if (card) card.remove(); card = null; return; }
    rows = data;
    if (open === null) { const first = rows.find((r) => r.status === "pending"); open = first ? first.id : ""; }
    if (!card) makeCard();
    render();
    if (message) say(message, "ok");
  }

  async function view(id) {
    const r = rows.find((x) => x.id === id);
    const win = window.open("", "_blank");
    try {
      const doc = await KxSign.fetchDocument(r.document_path);
      if (doc.hash !== r.file_hash) throw new Error("This document does not match the one your employer sent. Do not sign it; tell HR.");
      seen[id] = doc;
      const blobUrl = URL.createObjectURL(new Blob([doc.bytes], { type: "application/pdf" }));
      if (win) win.location.href = blobUrl; else window.location.href = blobUrl;
      await supabaseClient.rpc("mark_signature_viewed", { p_workspace: WS, p_id: id });
      render();
      say("Read the whole document, then come back here to sign.", "ok");
    } catch (e) { if (win) win.close(); say(e.message || "The document could not be opened.", "error"); }
  }

  async function sign(id) {
    const name = (document.getElementById("sgName").value || "").trim();
    if (name.length < 3) return say("Type your full name to sign.", "error");
    if (!document.getElementById("sgAgree").checked) return say("Tick the box to agree to sign electronically.", "error");
    const pad = document.getElementById("sgPad");
    const image = drawn && pad ? pad.toDataURL("image/png") : null;
    const { error } = await supabaseClient.rpc("sign_document", { p_workspace: WS, p_id: id, p_signed_name: name, p_signature_image: image, p_hash_seen: seen[id] && seen[id].hash, p_agree: true });
    if (error) return say(error.message || "Not signed.", "error");
    await load("Signed. Thank you. You can download your signed copy here at any time.");
  }

  async function decline(id) {
    const reason = window.prompt("Why can you not sign it? Your employer will see this.");
    if (reason === null) return;
    const { error } = await supabaseClient.rpc("decline_signature", { p_workspace: WS, p_id: id, p_reason: reason });
    if (error) return say(error.message || "Not saved.", "error");
    await load("Your employer has been told you cannot sign it.");
  }

  async function mine(id) {
    const r = rows.find((x) => x.id === id);
    try {
      const doc = seen[id] || await KxSign.fetchDocument(r.document_path);
      const bytes = await KxSign.buildSignedCopy(doc.bytes, { title: r.title, company: "", fileHash: r.file_hash, documentName: r.document_name, sentAt: r.created_at, sentBy: "your employer",
        signers: [{ name_on_file: r.name_on_file, signed_name: r.signed_name, status: r.status, signed_at: r.signed_at }] });
      KxSign.saveBytes(bytes, `${r.title.replace(/[^\w -]+/g, "").trim() || "document"} - signed.pdf`);
    } catch (e) { say(e.message || "Could not make the copy.", "error"); }
  }

  document.addEventListener("click", (event) => {
    const t = event.target;
    if (!t || !t.closest || !card || !card.contains(t)) return;
    const tg = t.closest("[data-sg-toggle]"); if (tg) { open = open === tg.dataset.sgToggle ? "" : tg.dataset.sgToggle; return render(); }
    const v = t.closest("[data-sg-view]"); if (v) return view(v.dataset.sgView);
    const s = t.closest("[data-sg-sign]"); if (s) return sign(s.dataset.sgSign);
    const d = t.closest("[data-sg-decline]"); if (d) return decline(d.dataset.sgDecline);
    const m = t.closest("[data-sg-mine]"); if (m) return mine(m.dataset.sgMine);
    if (t.id === "sgClear") { const pad = document.getElementById("sgPad"); pad.getContext("2d").clearRect(0, 0, pad.width, pad.height); drawn = false; }
  });

  async function start() {
    if (typeof supabaseClient === "undefined" || !window.KxSign) return;
    const { data } = await supabaseClient.auth.getSession();
    if (!data || !data.session) return;
    await load();
  }

  if (!window.__SGMY_TEST__) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  }
  window.kxMySignaturesLoad = load;
})();
