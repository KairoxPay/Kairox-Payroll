// Announcements (staff): post a message to everyone or one department, attach a company document, ask for a dated
// "I have read and understood" confirmation, and see who has read and confirmed (phase43-announcements.sql).

const AN_WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
const anEl = (id) => document.getElementById(id);
const anEsc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const anDay = (iso) => { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
const anWhen = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const anToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

let anRows = [];

function anMsg(text, kind) { const b = anEl("anMsg"); b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); }

// Same rules as the WhatsApp page: Jamaican numbers written any common way.
function anNumber(raw) {
  const s = String(raw || "").trim(); let d = s.replace(/\D/g, "");
  if (!d) return "";
  if (s.startsWith("+")) return d.length >= 8 ? d : "";
  if (d.startsWith("011")) d = d.slice(3);
  if (d.length === 7) return `1876${d}`;
  if (d.length === 10) return `1${d}`;
  if (d.length === 11 && d.startsWith("1")) return d;
  return d.length >= 11 && d.length <= 15 ? d : "";
}

function anRender() {
  const showArchived = anEl("anShowArchived").checked;
  const list = anRows.filter((a) => showArchived || !a.archived);
  anEl("anList").innerHTML = list.length ? list.map((a) => {
    const target = a.requires_ack ? a.ack_count : a.read_count;
    const pct = a.audience ? Math.round((target / a.audience) * 100) : 0;
    const overdue = a.requires_ack && a.due_on && a.due_on < anToday() && a.ack_count < a.audience;
    return `<article class="an-item${a.archived ? " archived" : ""}">
      <div class="an-top"><div style="min-width:0"><h4>${anEsc(a.title)}${a.archived ? ' <span class="an-tag">Archived</span>' : ""}</h4>
        <p class="muted small">${anEsc(anDay(a.created_at))} by ${anEsc(a.created_by)} · ${a.department ? `For ${anEsc(a.department)}` : "For everyone"}${a.document_title ? ` · Document: ${anEsc(a.document_title)}` : ""}${a.due_on ? ` · Confirm by ${anEsc(anDay(a.due_on))}` : ""}</p></div>
        <div class="an-actions"><button type="button" class="btn small" data-an-people="${anEsc(a.id)}">See who</button>
          <button type="button" class="btn small" data-an-archive="${anEsc(a.id)}" data-on="${a.archived ? "0" : "1"}">${a.archived ? "Restore" : "Archive"}</button></div></div>
      ${a.body ? `<p class="an-body">${anEsc(a.body)}</p>` : ""}
      <div class="an-progress"><div class="an-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${a.requires_ack ? "Confirmed" : "Read"}"><span style="width:${pct}%"></span></div>
        <strong>${a.requires_ack ? `${a.ack_count} of ${a.audience} confirmed` : `${a.read_count} of ${a.audience} read`}</strong>
        ${overdue ? '<span style="color:#b91c1c;font-weight:700">Past the date</span>' : ""}</div>
    </article>`;
  }).join("") : '<p class="muted">No announcements yet.</p>';
}

async function anLoad() {
  const { data, error } = await supabaseClient.rpc("announcement_list", { p_workspace: AN_WS });
  if (error) {
    const missing = error.code === "PGRST202" || /could not find the function/i.test(error.message || "");
    anEl("anList").innerHTML = `<p class="muted">${anEsc(missing ? "Announcements are not set up yet. Run phase43-announcements.sql in Supabase, then refresh." : error.message || "Could not load.")}</p>`;
    return;
  }
  anRows = data || [];
  anRender();
}

async function anPost(event) {
  event.preventDefault();
  const title = anEl("anTitle").value.trim();
  const body = anEl("anBody").value.trim();
  if (title.length < 3) return anMsg("Give the announcement a title.", "error");
  if (body.length < 3 && !anEl("anDoc").value) return anMsg("Write the message, or attach a document.", "error");
  const btn = anEl("anPost"); btn.disabled = true;
  const { error } = await supabaseClient.rpc("post_announcement", {
    p_workspace: AN_WS, p_title: title, p_body: body, p_document: anEl("anDoc").value || null, p_requires_ack: anEl("anAck").checked,
    p_department: anEl("anAudience").value || null, p_due: anEl("anDue").value || null, p_email: anEl("anEmail").checked
  });
  btn.disabled = false;
  if (error) return anMsg(error.message || "Not posted.", "error");
  anEl("anForm").reset();
  anMsg("Posted. Employees see it the next time they open My portal.", "ok");
  await anLoad();
}

async function anPeople(id) {
  const a = anRows.find((x) => x.id === id);
  const { data, error } = await supabaseClient.rpc("announcement_people", { p_workspace: AN_WS, p_id: id });
  if (error) return anMsg(error.message || "Could not load.", "error");
  const rows = data || [];
  const status = (p) => (p.acknowledged_at ? ["Confirmed", "#16a34a", anWhen(p.acknowledged_at)] : p.read_at ? [a.requires_ack ? "Read, not confirmed" : "Read", a.requires_ack ? "#b45309" : "#16a34a", anWhen(p.read_at)]
    : [p.has_login ? "Not opened yet" : "No My portal login", "#b91c1c", ""]);
  const remind = (p) => {
    const n = anNumber(p.phone);
    if (!n || p.acknowledged_at || (!a.requires_ack && p.read_at)) return "";
    const text = `Hi ${String(p.name || "").split(" ")[0]}, please open My portal in Kairox Pay and ${a.requires_ack ? "confirm you have read" : "read"} "${a.title}"${a.due_on ? ` by ${anDay(a.due_on)}` : ""}. Thank you.`;
    return `<a class="btn small" href="https://wa.me/${n}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp</a>`;
  };
  anEl("anBox").innerHTML = `
    <h3 id="anDlgTitle">${anEsc(a.title)}</h3>
    <p class="muted small">${a.requires_ack ? `${a.ack_count} of ${a.audience} confirmed` : `${a.read_count} of ${a.audience} read`}. People without a My portal login cannot confirm online.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th>Status</th><th>When</th><th></th></tr></thead><tbody>
      ${rows.map((p) => { const s = status(p); return `<tr><td><strong>${anEsc(p.name)}</strong>${p.department ? `<small style="display:block;color:#6f7285">${anEsc(p.department)}</small>` : ""}</td>
        <td><span style="color:${s[1]};font-weight:700">${anEsc(s[0])}</span></td><td>${anEsc(s[2])}</td><td>${remind(p)}</td></tr>`; }).join("") || '<tr class="empty-row"><td colspan="4">Nobody.</td></tr>'}
    </tbody></table></div>
    <div class="dialog-actions"><button type="button" class="btn" data-an="csv">Export CSV</button><button type="button" class="btn primary" data-an="close">Close</button></div>`;
  anEl("anDialog").hidden = false;
  anEl("anBox").querySelector("[data-an=csv]").onclick = () => {
    const cell = (v) => { const x = String(v ?? ""); return /[",\n]/.test(x) ? `"${x.replaceAll('"', '""')}"` : x; };
    const lines = [["Announcement", a.title], ["Posted", anWhen(a.created_at)], [], ["Employee", "Department", "Status", "Read", "Confirmed"]]
      .concat(rows.map((p) => [p.name, p.department || "", status(p)[0], anWhen(p.read_at), anWhen(p.acknowledged_at)]));
    const blob = new Blob(["﻿" + lines.map((l) => l.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `Confirmations_${a.title.replace(/[^\w]+/g, "_").slice(0, 40)}.csv`; document.body.appendChild(link); link.click(); link.remove();
  };
}

function anClose() { anEl("anDialog").hidden = true; anEl("anBox").innerHTML = ""; }

document.addEventListener("click", async (event) => {
  const t = event.target;
  if (!t || !t.closest) return;
  if (t.id === "anDialog" || t.closest("[data-an=close]")) return anClose();
  const p = t.closest("[data-an-people]"); if (p) return anPeople(p.dataset.anPeople);
  const ar = t.closest("[data-an-archive]");
  if (ar) {
    const { error } = await supabaseClient.rpc("archive_announcement", { p_workspace: AN_WS, p_id: ar.dataset.anArchive, p_archive: ar.dataset.on === "1" });
    if (error) return anMsg(error.message || "Not saved.", "error");
    anMsg(ar.dataset.on === "1" ? "Archived. Employees no longer see it; confirmations are kept." : "Restored.", "ok");
    await anLoad();
  }
});
document.addEventListener("change", (event) => { if (event.target.id === "anShowArchived") anRender(); });
document.addEventListener("submit", (event) => { if (event.target.id === "anForm") anPost(event); });

async function anStart() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data || !data.session) { window.location.href = "login.html?next=announcements.html"; return; }
  const { data: role } = await supabaseClient.rpc("get_my_role", { p_workspace: AN_WS });
  if (!["admin", "director", "hr", "payroll"].includes(role)) {
    anEl("anList").innerHTML = '<p class="muted">Only admins, managing directors, HR and payroll officers can post announcements. Employees see them in My portal.</p>';
    anEl("anForm").hidden = true;
    return;
  }
  anEl("anDue").min = anToday();
  const [docs, emps] = await Promise.all([
    supabaseClient.from("company_documents").select("id, title, category").eq("workspace", AN_WS).order("title"),
    supabaseClient.from("employees").select("department, employment_status").eq("workspace", AN_WS)
  ]);
  anEl("anDoc").innerHTML += (docs.data || []).map((d) => `<option value="${anEsc(d.id)}">${anEsc(d.title)} (${anEsc(d.category)})</option>`).join("");
  const depts = [...new Set((emps.data || []).filter((e) => !/archived|inactive|terminated/i.test(e.employment_status || ""))
    .map((e) => String(e.department || "").trim()).filter(Boolean))].sort();
  anEl("anAudience").innerHTML += depts.map((d) => `<option value="${anEsc(d)}">${anEsc(d)} only</option>`).join("");
  await anLoad();
}

if (!window.__AN_TEST__) anStart();
