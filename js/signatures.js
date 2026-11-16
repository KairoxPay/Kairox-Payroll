// E-signatures (staff: admins, managing directors, HR officers). Upload a PDF, choose who signs, follow progress, remind on
// WhatsApp, and download the signed copy (original + certificate). Database: phase47-e-signatures.sql. Helpers: js/sign-certificate.js.

const SG_WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
const sgEl = (id) => document.getElementById(id);
const sgEsc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const sgDay = (iso) => { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
const sgUuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

let sgRows = [];
let sgDetail = null;

function sgMsg(text, kind) { const b = sgEl("sgMsg"); b.textContent = text || ""; b.className = `form-message ${kind || ""}`.trim(); }

function sgNumber(raw) {
  const s = String(raw || "").trim(); let d = s.replace(/\D/g, "");
  if (!d) return ""; if (s.startsWith("+")) return d.length >= 8 ? d : "";
  if (d.length === 7) return `1876${d}`; if (d.length === 10) return `1${d}`; if (d.length === 11 && d.startsWith("1")) return d;
  return d.length >= 11 && d.length <= 15 ? d : "";
}

async function sgSend(event) {
  event.preventDefault();
  const title = sgEl("sgTitle").value.trim();
  const file = sgEl("sgFile").files[0];
  const people = [...document.querySelectorAll("#sgPeople input:checked")].map((b) => b.value);
  if (title.length < 3) return sgMsg("Give the document a title.", "error");
  if (!file) return sgMsg("Choose the PDF to send.", "error");
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return sgMsg("Only PDF files can be signed. Save the document as a PDF first.", "error");
  if (file.size > 10 * 1024 * 1024) return sgMsg("The PDF is bigger than 10 MB.", "error");
  if (!people.length) return sgMsg("Tick who must sign.", "error");

  const btn = sgEl("sgSend"); btn.disabled = true; sgMsg("Uploading…");
  try {
    const bytes = await file.arrayBuffer();
    const hash = await KxSign.sha256Hex(bytes);
    const id = sgUuid();
    const safe = file.name.replace(/[^\w.-]+/g, "_").replace(/^_+/, "").slice(-80) || "document.pdf";
    const path = `${SG_WS}/${id}/${safe}`;
    const up = await supabaseClient.storage.from("signature-documents").upload(path, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
    if (up.error) throw new Error(`The PDF could not be uploaded: ${up.error.message || "error"}`);
    const { data, error } = await supabaseClient.rpc("create_signature_request", {
      p_workspace: SG_WS, p_id: id, p_title: title, p_message: sgEl("sgMessage").value.trim() || null, p_path: path, p_name: file.name.slice(0, 120),
      p_hash: hash, p_employees: people, p_due: sgEl("sgDue").value || null, p_email: sgEl("sgEmail").checked
    });
    if (error) throw error;
    sgEl("sgForm").reset(); sgEl("sgForm").hidden = true; sgEl("sgToggle").hidden = false;
    sgMsg(`Sent to ${data} ${data === 1 ? "person" : "people"}. They sign in My portal.`, "ok");
    await sgLoad();
  } catch (e) {
    sgMsg(e.message || "Not sent.", "error");
  } finally { btn.disabled = false; }
}

function sgRender() {
  sgEl("sgBody").innerHTML = sgRows.length ? sgRows.map((r) => {
    const done = r.signed === r.signers;
    return `<tr${r.cancelled ? ' style="opacity:.55"' : ""}><td><strong>${sgEsc(r.title)}</strong><small style="display:block;color:#6f7285">${sgEsc(r.document_name)}${r.cancelled ? " · Withdrawn" : ""}</small></td>
      <td>${sgEsc(sgDay(r.created_at))}<small style="display:block;color:#6f7285">by ${sgEsc(r.created_by)}</small></td>
      <td><strong style="color:${done ? "#16a34a" : "#b45309"}">${r.signed} of ${r.signers}</strong>${r.declined ? `<small style="display:block;color:#b91c1c;font-weight:700">${r.declined} declined</small>` : ""}</td>
      <td>${sgEsc(sgDay(r.due_on))}</td>
      <td><button type="button" class="btn small" data-sg-open="${sgEsc(r.id)}">Details</button></td></tr>`;
  }).join("") : '<tr class="empty-row"><td colspan="5">Nothing sent yet.</td></tr>';
}

async function sgLoad() {
  const { data, error } = await supabaseClient.rpc("signature_requests_list", { p_workspace: SG_WS });
  if (error) {
    const missing = error.code === "PGRST202" || /could not find the function/i.test(error.message || "");
    sgEl("sgBody").innerHTML = `<tr class="empty-row"><td colspan="5">${sgEsc(missing ? "E-signatures are not set up yet. Run phase47-e-signatures.sql in Supabase, then refresh." : error.message || "Could not load.")}</td></tr>`;
    return;
  }
  sgRows = data || [];
  sgRender();
}

async function sgOpen(id) {
  const { data: r, error } = await supabaseClient.rpc("signature_request_detail", { p_workspace: SG_WS, p_id: id });
  if (error) return sgMsg(error.message || "Could not open.", "error");
  sgDetail = r;
  const st = (s) => (s.status === "signed" ? [`Signed ${KxSign.when(s.signed_at)}`, "#16a34a"] : s.status === "declined" ? ["Declined", "#b91c1c"]
    : s.viewed_at ? ["Opened, not signed", "#b45309"] : [s.has_login ? "Not opened" : "No My portal login", "#b91c1c"]);
  sgEl("sgBox").innerHTML = `
    <h3 id="sgDlgTitle" style="margin:0">${sgEsc(r.title)}</h3>
    <p class="muted small" style="margin:4px 0 12px">${sgEsc(r.document_name)} · sent ${sgEsc(sgDay(r.created_at))} by ${sgEsc(r.created_by)}${r.cancelled_at ? " · Withdrawn" : ""}<br>Fingerprint ${sgEsc(r.file_hash.slice(0, 16))}…</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Employee</th><th>Status</th><th></th></tr></thead><tbody>
      ${r.signers.map((s) => { const x = st(s); const n = sgNumber(s.phone);
        const remind = s.status === "pending" && n && !r.cancelled_at
          ? `<a class="btn small" target="_blank" rel="noopener" href="https://wa.me/${n}?text=${encodeURIComponent(`Hi ${String(s.name_on_file).split(" ")[0]}, please open My portal in Kairox Pay and sign "${r.title}"${r.due_on ? ` by ${sgDay(r.due_on)}` : ""}. Thank you.`)}">WhatsApp</a>` : "";
        return `<tr><td><strong>${sgEsc(s.name_on_file)}</strong>${s.status === "signed" ? `<small style="display:block;color:#6f7285">Signed as "${sgEsc(s.signed_name)}"</small>` : ""}</td>
          <td><span style="color:${x[1]};font-weight:700">${sgEsc(x[0])}</span>${s.decline_reason ? `<small style="display:block;color:#6f7285">${sgEsc(s.decline_reason)}</small>` : ""}</td><td>${remind}</td></tr>`; }).join("")}
    </tbody></table></div>
    <div id="sgDlgMsg" class="form-message" role="status"></div>
    <div class="dialog-actions" style="flex-wrap:wrap">
      ${r.cancelled_at ? "" : '<button type="button" class="btn" data-sg="cancel" style="margin-right:auto">Withdraw</button>'}
      <button type="button" class="btn" data-sg="original">Open the PDF</button>
      <button type="button" class="btn" data-sg="close">Close</button>
      <button type="button" class="btn primary" data-sg="copy">Download signed copy</button></div>`;
  sgEl("sgDialog").hidden = false;
}

async function sgSignedCopy() {
  const m = sgEl("sgDlgMsg");
  m.textContent = "Making the signed copy…"; m.className = "form-message";
  try {
    const doc = await KxSign.fetchDocument(sgDetail.document_path);
    if (doc.hash !== sgDetail.file_hash) throw new Error("The stored PDF no longer matches its fingerprint. Do not rely on it; contact support.");
    const bytes = await KxSign.buildSignedCopy(doc.bytes, { title: sgDetail.title, company: sgDetail.company, fileHash: sgDetail.file_hash, documentName: sgDetail.document_name,
      sentBy: sgDetail.created_by, sentAt: sgDetail.created_at, signers: sgDetail.signers });
    KxSign.saveBytes(bytes, `${sgDetail.title.replace(/[^\w -]+/g, "").trim() || "document"} - signed.pdf`);
    m.textContent = "Downloaded. Keep it with the employee's records."; m.className = "form-message ok";
  } catch (e) { m.textContent = e.message || "Could not make the signed copy."; m.className = "form-message error"; }
}

document.addEventListener("click", async (event) => {
  const t = event.target;
  if (!t || !t.closest) return;
  if (t.id === "sgToggle") { sgEl("sgForm").hidden = false; t.hidden = true; sgEl("sgTitle").focus(); return; }
  if (t.id === "sgDialog" || t.closest("[data-sg=close]")) { sgEl("sgDialog").hidden = true; return; }
  const o = t.closest("[data-sg-open]"); if (o) return sgOpen(o.dataset.sgOpen);
  const a = t.closest("[data-sg]");
  if (!a) return;
  if (a.dataset.sg === "copy") return sgSignedCopy();
  if (a.dataset.sg === "original") {
    const win = window.open("", "_blank");
    const { data } = await supabaseClient.storage.from("signature-documents").createSignedUrl(sgDetail.document_path, 300);
    if (data && win) win.location.href = data.signedUrl; else if (win) win.close();
    return;
  }
  if (a.dataset.sg === "cancel") {
    if (!window.confirm("Withdraw this document? Signatures already given are kept; nobody else can sign it.")) return;
    const { error } = await supabaseClient.rpc("cancel_signature_request", { p_workspace: SG_WS, p_id: sgDetail.id });
    if (error) return sgMsg(error.message || "Not withdrawn.", "error");
    sgEl("sgDialog").hidden = true; sgMsg("Withdrawn.", "ok"); await sgLoad();
  }
});
document.addEventListener("submit", (event) => { if (event.target.id === "sgForm") sgSend(event); });

async function sgStart() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data || !data.session) { window.location.href = "login.html?next=signatures.html"; return; }
  const { data: role } = await supabaseClient.rpc("get_my_role", { p_workspace: SG_WS });
  if (!["admin", "director", "hr"].includes(role)) {
    sgEl("sgToggle").hidden = true;
    sgEl("sgBody").innerHTML = '<tr class="empty-row"><td colspan="5">Only admins, managing directors and HR officers can send documents for signature. Employees sign in My portal.</td></tr>';
    return;
  }
  const people = await supabaseClient.rpc("people_directory", { p_workspace: SG_WS });
  const list = (people.data || []).filter((p) => !/archived|terminated/i.test(p.employment_status || ""));
  sgEl("sgPeople").innerHTML = list.length ? list.map((p) => `<label><input type="checkbox" value="${sgEsc(p.id)}"> <span>${sgEsc(p.name)}${p.has_login === false ? ' <span class="muted small">(no login)</span>' : ""}</span></label>`).join("") : '<p class="muted">No employees.</p>';
  await sgLoad();
}

if (!window.__SG_TEST__) sgStart();
