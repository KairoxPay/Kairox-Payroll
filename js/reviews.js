// Performance reviews (staff): start reviews, rate each point, write the summary and share it with the employee.
// HR, admins and managing directors see everyone; managers see their own team. Nobody reviews themselves (phase44-performance-reviews.sql).

const RV_WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
const rvEl = (id) => document.getElementById(id);
const rvEsc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const rvDay = (iso) => { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
const RV_SCALE = ["", "Needs improvement", "Developing", "Meets expectations", "Exceeds expectations", "Outstanding"];
const RV_STATUS = { self: ["Waiting for self-review", "#b45309"], manager: ["Ready to rate", "#4b2394"], shared: ["Shared, waiting for employee", "#2563eb"], closed: ["Done", "#16a34a"], cancelled: ["Cancelled", "#6f7285"] };
const RV_DEFAULT_ITEMS = [
  ["skill", "Quality of work", "Accurate, thorough, to the standard expected"],
  ["skill", "Reliability and attendance", "On time, dependable, keeps commitments"],
  ["skill", "Teamwork", "Works well with others and helps the team"],
  ["skill", "Communication", "Clear, polite and timely with colleagues and clients"],
  ["skill", "Customer service", "Puts clients first and solves problems"]
];

let rvRows = [];
let rvOpen = null;

function rvMsg(text, kind) { const b = rvEl("rvMsg"); b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); }

/* ---------- start ---------- */
function rvItemRow(kind, title, desc) {
  const row = document.createElement("div");
  row.className = "rv-item";
  row.innerHTML = `<select aria-label="Kind"><option value="skill"${kind === "skill" ? " selected" : ""}>Skill</option><option value="goal"${kind === "goal" ? " selected" : ""}>Goal</option></select>
    <input aria-label="Point" maxlength="120" placeholder="${kind === "goal" ? "For example: Reduce delivery errors" : "Skill"}" value="${rvEsc(title)}">
    <input aria-label="What good looks like" maxlength="500" placeholder="What good looks like (optional)" value="${rvEsc(desc)}">
    <button type="button" class="btn small" data-rv-remove aria-label="Remove this point">Remove</button>`;
  rvEl("rvItems").appendChild(row);
  return row;
}

function rvCollectItems() {
  return [...document.querySelectorAll("#rvItems .rv-item")].map((r) => {
    const [kind, title, desc] = r.querySelectorAll("select, input");
    return { kind: kind.value, title: title.value.trim(), description: desc.value.trim() };
  }).filter((i) => i.title);
}

async function rvStart(event) {
  event.preventDefault();
  const people = [...document.querySelectorAll("#rvPeople input:checked")].map((b) => b.value);
  const items = rvCollectItems();
  if (rvEl("rvTitle").value.trim().length < 3) return rvMsg('Give the review a name, for example "2026 annual review".', "error");
  if (!people.length) return rvMsg("Tick who to review.", "error");
  if (!items.length) return rvMsg("Add at least one point to rate.", "error");
  const btn = rvEl("rvStart"); btn.disabled = true;
  const { data, error } = await supabaseClient.rpc("start_reviews", {
    p_workspace: RV_WS, p_employees: people, p_title: rvEl("rvTitle").value.trim(), p_start: rvEl("rvFrom").value || null, p_end: rvEl("rvTo").value || null,
    p_due: rvEl("rvDue").value || null, p_self: rvEl("rvSelf").checked, p_items: items
  });
  btn.disabled = false;
  if (error) return rvMsg(error.message || "Not started.", "error");
  rvMsg(`${data} ${data === 1 ? "review" : "reviews"} started.${rvEl("rvSelf").checked ? " Each person rates themselves first in My portal." : ""}`, "ok");
  rvEl("rvForm").hidden = true; rvEl("rvToggle").hidden = false;
  await rvLoad();
}

/* ---------- list ---------- */
function rvRender() {
  const open = rvEl("rvFilter").value === "open";
  const list = rvRows.filter((r) => !open || ["self", "manager", "shared"].includes(r.status));
  rvEl("rvBody").innerHTML = list.length ? list.map((r) => {
    const st = RV_STATUS[r.status] || [r.status, "inherit"];
    const late = r.due_on && ["self", "manager"].includes(r.status) && r.due_on < new Date().toISOString().slice(0, 10);
    return `<tr><td><strong>${rvEsc(r.name)}</strong>${r.department ? `<small style="display:block;color:#6f7285">${rvEsc(r.department)}</small>` : ""}</td>
      <td>${rvEsc(r.title)}</td><td><span style="color:${st[1]};font-weight:700">${rvEsc(st[0])}</span></td>
      <td>${rvEsc(rvDay(r.due_on))}${late ? '<small style="display:block;color:#b91c1c;font-weight:700">Late</small>' : ""}</td>
      <td class="num">${r.overall_rating ? `${r.overall_rating} / 5` : ""}</td>
      <td><button type="button" class="btn small${r.status === "manager" ? " primary" : ""}" data-rv-open="${rvEsc(r.id)}">${r.status === "manager" || r.status === "self" ? "Rate" : "View"}</button></td></tr>`;
  }).join("") : `<tr class="empty-row"><td colspan="6">${open ? "No reviews to do." : "No reviews yet."}</td></tr>`;
}

async function rvLoad() {
  const { data, error } = await supabaseClient.rpc("review_list", { p_workspace: RV_WS });
  if (error) {
    const missing = error.code === "PGRST202" || /could not find the function/i.test(error.message || "");
    rvEl("rvBody").innerHTML = `<tr class="empty-row"><td colspan="6">${rvEsc(missing ? "Reviews are not set up yet. Run phase44-performance-reviews.sql in Supabase, then refresh." : error.message || "Could not load.")}</td></tr>`;
    return;
  }
  rvRows = data || [];
  rvRender();
}

/* ---------- one review ---------- */
function rvRate(name, value, disabled) {
  return `<div class="rv-rate" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) =>
    `<label title="${RV_SCALE[n]}"><input type="radio" name="${name}" value="${n}"${Number(value) === n ? " checked" : ""}${disabled ? " disabled" : ""}> ${n} <span class="muted small">${RV_SCALE[n]}</span></label>`).join("")}</div>`;
}

async function rvOpenReview(id) {
  const { data: r, error } = await supabaseClient.rpc("review_get", { p_workspace: RV_WS, p_id: id });
  if (error) return rvMsg(error.message || "Could not open.", "error");
  rvOpen = r;
  const locked = !["self", "manager"].includes(r.status);
  const st = RV_STATUS[r.status] || [r.status, "inherit"];
  rvEl("rvBox").innerHTML = `
    <div class="rv-box" id="rvPrintable">
    <h3 id="rvDlgTitle" style="margin:0">${rvEsc(r.name)}: ${rvEsc(r.title)}</h3>
    <p class="muted small" style="margin:4px 0 0">${r.period_start ? `${rvEsc(rvDay(r.period_start))} to ${rvEsc(rvDay(r.period_end))} · ` : ""}<span style="color:${st[1]};font-weight:700">${rvEsc(st[0])}</span>${r.reviewer ? ` · Reviewer: ${rvEsc(r.reviewer)}` : ""}</p>
    ${r.status === "self" ? '<p class="rv-self" style="margin-top:12px">The employee has not sent their self-review yet. You can start your ratings now; they cannot see them until you share.</p>' : ""}
    ${r.items.map((i) => `<div class="rv-point" data-item="${rvEsc(i.id)}">
      <h4>${rvEsc(i.title)} <span class="muted small">${i.kind === "goal" ? "Goal" : "Skill"}</span></h4>${i.description ? `<p class="muted small">${rvEsc(i.description)}</p>` : ""}
      ${r.self_review ? `<div class="rv-self"><strong>Their rating:</strong> ${i.self_rating ? `${i.self_rating} (${rvEsc(RV_SCALE[i.self_rating])})` : "not given yet"}${i.self_comment ? `<br>${rvEsc(i.self_comment)}` : ""}</div>` : ""}
      <strong style="font-size:14px">Your rating</strong>${rvRate(`rate_${i.id}`, i.manager_rating, locked)}
      <textarea aria-label="Your comment on ${rvEsc(i.title)}" maxlength="1000" placeholder="Comment (optional)"${locked ? " disabled" : ""}>${rvEsc(i.manager_comment || "")}</textarea></div>`).join("")}
    <div class="rv-point"><h4>Summary</h4><textarea id="rvSummary" maxlength="4000" placeholder="Strengths, what to work on, and anything agreed."${locked ? " disabled" : ""}>${rvEsc(r.summary || "")}</textarea>
      <h4 style="margin-top:12px">Overall rating</h4>${rvRate("rvOverall", r.overall_rating, locked)}
      <h4 style="margin-top:12px">Goals for next time</h4><textarea id="rvNext" maxlength="4000" placeholder="One per line"${locked ? " disabled" : ""}>${rvEsc(r.next_goals || "")}</textarea></div>
    ${r.status === "closed" ? `<p class="rv-self"><strong>Seen by the employee</strong> on ${rvEsc(rvDay(r.acknowledged_at))}.${r.employee_comment ? `<br>Their comment: ${rvEsc(r.employee_comment)}` : ""}</p>` : ""}
    </div>
    <div id="rvDlgMsg" class="form-message" role="status"></div>
    <div class="dialog-actions" style="flex-wrap:wrap">
      ${locked ? "" : '<button type="button" class="btn" data-rv="cancel" style="margin-right:auto">Cancel review</button>'}
      <button type="button" class="btn" data-rv="print">Print</button>
      <button type="button" class="btn" data-rv="close">Close</button>
      ${locked ? "" : '<button type="button" class="btn" data-rv="save">Save</button><button type="button" class="btn primary" data-rv="share">Share with employee</button>'}
    </div>`;
  rvEl("rvDialog").hidden = false;
}

function rvClose() { rvEl("rvDialog").hidden = true; rvEl("rvBox").innerHTML = ""; rvOpen = null; }

async function rvSave(share) {
  const m = rvEl("rvDlgMsg");
  const items = [...document.querySelectorAll("#rvBox [data-item]")].map((box) => {
    const picked = box.querySelector("input[type=radio]:checked");
    return { id: box.dataset.item, rating: picked ? Number(picked.value) : null, comment: box.querySelector("textarea").value.trim() };
  });
  const overall = document.querySelector("input[name=rvOverall]:checked");
  if (share && !window.confirm("Share this review with the employee? You cannot change it afterwards.")) return;
  const { error } = await supabaseClient.rpc("save_manager_review", {
    p_workspace: RV_WS, p_id: rvOpen.id, p_items: items, p_summary: rvEl("rvSummary").value.trim(), p_overall: overall ? Number(overall.value) : null,
    p_next: rvEl("rvNext").value.trim(), p_share: !!share
  });
  if (error) { m.textContent = error.message || "Not saved."; m.className = "form-message error"; return; }
  const name = rvOpen.name;
  rvClose();
  rvMsg(share ? `Shared with ${name}. They can read it in My portal and confirm they have seen it.` : "Saved. Nothing is shown to the employee until you share it.", "ok");
  await rvLoad();
}

function rvPrint() {
  const box = rvEl("rvPrintable").cloneNode(true);
  box.querySelectorAll("textarea").forEach((t) => { const p = document.createElement("p"); p.style.whiteSpace = "pre-line"; p.textContent = t.value || "—"; t.replaceWith(p); });
  box.querySelectorAll(".rv-rate").forEach((g) => { const c = g.querySelector("input:checked"); const p = document.createElement("p"); p.innerHTML = `<strong>${c ? `${c.value} / 5 (${RV_SCALE[c.value]})` : "Not rated"}</strong>`; g.replaceWith(p); });
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Performance review</title><style>body{font-family:Arial,sans-serif;max-width:760px;margin:24px auto;color:#17172f}
    .rv-point{border-top:1px solid #ddd;padding:10px 0}.rv-self{background:#f4f4f8;padding:8px;border-radius:6px}.muted{color:#666}h3{margin:0 0 4px}h4{margin:0 0 4px}</style></head>
    <body>${box.innerHTML}<p style="margin-top:30px">Employee signature: ____________________ &nbsp; Date: __________</p>
    <p>Reviewer signature: ____________________ &nbsp; Date: __________</p></body></html>`);
  win.document.close(); win.focus(); win.print();
}

/* ---------- events ---------- */
document.addEventListener("click", async (event) => {
  const t = event.target;
  if (!t || !t.closest) return;
  if (t.id === "rvToggle") { rvEl("rvForm").hidden = false; t.hidden = true; rvEl("rvTitle").focus(); return; }
  if (t.id === "rvAddSkill") return void rvItemRow("skill", "", "").querySelector("input").focus();
  if (t.id === "rvAddGoal") return void rvItemRow("goal", "", "").querySelector("input").focus();
  if (t.closest("[data-rv-remove]")) return t.closest(".rv-item").remove();
  if (t.id === "rvDialog") return rvClose();
  const o = t.closest("[data-rv-open]"); if (o) return rvOpenReview(o.dataset.rvOpen);
  const a = t.closest("[data-rv]");
  if (a) {
    const act = a.dataset.rv;
    if (act === "close") return rvClose();
    if (act === "print") return rvPrint();
    if (act === "save") return rvSave(false);
    if (act === "share") return rvSave(true);
    if (act === "cancel") {
      if (!window.confirm("Cancel this review? It is kept in the records as cancelled.")) return;
      const { error } = await supabaseClient.rpc("cancel_review", { p_workspace: RV_WS, p_id: rvOpen.id });
      if (error) return rvMsg(error.message || "Not cancelled.", "error");
      rvClose(); rvMsg("Review cancelled.", "ok"); await rvLoad();
    }
  }
});
document.addEventListener("change", (event) => { if (event.target.id === "rvFilter") rvRender(); });
document.addEventListener("submit", (event) => { if (event.target.id === "rvForm") rvStart(event); });

async function rvStartPage() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data || !data.session) { window.location.href = "login.html?next=reviews.html"; return; }
  const { data: role } = await supabaseClient.rpc("get_my_role", { p_workspace: RV_WS });
  if (!["admin", "director", "hr", "manager"].includes(role)) {
    rvEl("rvStartCard").hidden = true;
    rvEl("rvBody").innerHTML = '<tr class="empty-row"><td colspan="6">Only HR, admins, managing directors and managers can see performance reviews. Employees see theirs in My portal.</td></tr>';
    return;
  }
  RV_DEFAULT_ITEMS.forEach(([k, t, d]) => rvItemRow(k, t, d));
  const year = new Date().getFullYear();
  rvEl("rvTitle").value = `${year} annual review`;
  rvEl("rvFrom").value = `${year}-01-01`; rvEl("rvTo").value = `${year}-12-31`;
  const people = await supabaseClient.rpc("people_directory", { p_workspace: RV_WS });
  const list = (people.data || []).filter((p) => !/archived|inactive|terminated/i.test(p.employment_status || ""));
  rvEl("rvPeople").innerHTML = list.length ? list.map((p) => `<label><input type="checkbox" value="${rvEsc(p.id)}"> <span>${rvEsc(p.name)}${p.department ? ` <span class="muted small">${rvEsc(p.department)}</span>` : ""}</span></label>`).join("")
    : '<p class="muted">Nobody to review.</p>';
  await rvLoad();
}

if (!window.__RV_TEST__) rvStartPage();
