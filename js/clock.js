// My portal: "Clock in / Clock out" card with today's and this week's hours and the last two weeks of entries.
// Shown only when the employer has turned clock-in on (Timesheets page). No location is recorded.

(function () {
  const WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const hm = (mins) => { const m = Math.max(0, Math.round(Number(mins) || 0)); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—");
  const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const STATUS = { open: ["Clocked in", "#6d28d9"], pending: ["Waiting for approval", "#b45309"], approved: ["Approved", "#16a34a"], rejected: ["Not approved", "#b91c1c"] };

  let card = null;
  let state = null;
  let timer = null;

  function makeCard() {
    const main = document.querySelector("main") || document.body;
    card = document.createElement("section");
    card.className = "page-card";
    card.id = "clockCard";
    const first = main.querySelector("section, article, .page-card");
    if (first && first.parentNode) first.parentNode.insertBefore(card, first); else main.appendChild(card);
  }

  function render(entries) {
    const s = state;
    const since = s.open_since ? new Date(s.open_since) : null;
    const running = since ? (Date.now() - since.getTime()) / 60000 : 0;

    card.innerHTML = `
      <div class="page-card-head"><div><h3>Clock in</h3>
        <p>${since ? `You clocked in at <strong>${esc(time(s.open_since))}</strong> (${esc(hm(running))} ago).` : "You are not clocked in."}</p></div></div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
        <div class="field" style="flex:1;min-width:200px;margin:0"><label for="clockNote">Note (optional)</label>
          <input id="clockNote" maxlength="200" placeholder="${since ? "For example: stayed to finish the shipment" : "For example: started at the warehouse"}"></div>
        <button type="button" class="btn primary" id="clockBtn" style="min-width:150px;font-size:16px;padding:12px 18px">${since ? "Clock out" : "Clock in"}</button>
      </div>
      <p style="margin:0 0 10px"><strong>Today:</strong> ${esc(hm(s.today_minutes))} &nbsp; · &nbsp; <strong>This week:</strong> ${esc(hm(s.week_minutes))}</p>
      <div id="clockMsg" class="form-message" role="status"></div>
      <details${entries.length ? "" : " hidden"}><summary style="cursor:pointer;font-weight:700">My hours, last 14 days</summary>
        <div class="table-wrap"><table class="data" style="margin-top:8px"><thead><tr><th>Day</th><th>In</th><th>Out</th><th class="num">Hours</th><th>Status</th></tr></thead>
          <tbody>${entries.map((e) => {
            const st = STATUS[e.status] || [e.status, "inherit"];
            return `<tr><td>${esc(day(e.clock_in))}</td><td>${esc(time(e.clock_in))}</td><td>${esc(time(e.clock_out))}</td><td class="num">${esc(hm(e.minutes))}</td>
              <td><span style="color:${st[1]};font-weight:700">${esc(st[0])}</span>${e.note ? `<small style="display:block;color:#6f7285">${esc(e.note)}</small>` : ""}</td></tr>`;
          }).join("")}</tbody></table></div></details>
      <p class="muted small" style="margin:8px 0 0">Your manager approves your hours before payroll. If you forgot to clock in or out, tell your manager or HR so they can put in the right times.</p>`;
  }

  async function load() {
    const { data, error } = await supabaseClient.rpc("my_clock", { p_workspace: WS });
    if (error || !data || !data[0] || !data[0].enabled) { if (card) card.remove(); card = null; return; }
    state = data[0];
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - 13);
    const list = await supabaseClient.rpc("my_time_entries", { p_workspace: WS, p_from: ymd(from), p_to: ymd(to) });
    if (!card) makeCard();
    render(list.data || []);
    clearInterval(timer);
    if (state.open_since) timer = setInterval(() => render(list.data || []), 60000);
  }

  async function toggle() {
    const btn = document.getElementById("clockBtn");
    btn.disabled = true;
    const note = document.getElementById("clockNote").value.trim();
    const { error } = await supabaseClient.rpc(state.open_since ? "my_clock_out" : "my_clock_in", { p_workspace: WS, p_note: note || null });
    if (error) {
      const msg = document.getElementById("clockMsg");
      msg.textContent = error.message || "That did not work. Please try again.";
      msg.className = "form-message error";
      btn.disabled = false;
      return;
    }
    const wasIn = !!state.open_since;
    await load();
    const msg = document.getElementById("clockMsg");
    if (msg) { msg.textContent = wasIn ? "Clocked out. Thank you!" : "Clocked in. Have a good shift!"; msg.className = "form-message ok"; }
  }

  document.addEventListener("click", (event) => { if (event.target && event.target.id === "clockBtn") toggle(); });

  async function start() {
    if (typeof supabaseClient === "undefined") return;
    const { data } = await supabaseClient.auth.getSession();
    if (!data || !data.session) return;
    await load();
  }

  if (!window.__CLOCK_TEST__) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  }
  window.kxClockLoad = load;
})();
