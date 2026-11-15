// Account security: turn two-step sign-in (an authenticator-app code) on or off for your own account, and, for admins,
// see who in the company has it. Uses Supabase Auth's built-in TOTP support; the database enforces it (phase26 SQL).

const SEC_WS = (() => { try { return localStorage.getItem("kairoxWorkspace") || "kairox-exchange"; } catch (e) { return "kairox-exchange"; } })();
const secEl = (id) => document.getElementById(id);
const secEsc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
let secPending = null;   // { id, secret } while setting up

function secMsg(text, kind) {
  const box = secEl("mfaMsg");
  box.textContent = text || "";
  box.className = `form-message ${kind || ""}`.trim();
}

function secCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 6);
}

function secFriendly(error) {
  const text = String((error && error.message) || error || "");
  if (/invalid.*(code|totp)|invalid mfa|verification failed|expired/i.test(text)) return "That code did not work. Codes change every 30 seconds: type the one showing now.";
  if (/aal2|assurance/i.test(text)) return "For your security, sign out and sign in again with your code, then try this again.";
  if (/rate limit|too many/i.test(text)) return "Too many attempts. Wait a minute and try again.";
  return text || "Something went wrong. Please try again.";
}

async function secFactors() {
  const { data, error } = await supabaseClient.auth.mfa.listFactors();
  if (error) throw error;
  return (data && data.all) || [];
}

async function secRender() {
  secPending = null;
  let factors;
  try { factors = await secFactors(); } catch (error) { secEl("mfaBody").innerHTML = `<p>${secEsc(secFriendly(error))}</p>`; return; }

  const on = factors.find((f) => f.factor_type === "totp" && f.status === "verified");
  if (on) {
    secEl("mfaBody").innerHTML = `
      <div class="note" style="border-left:4px solid #16a34a;margin:0 0 12px"><strong>Two-step sign-in is on.</strong>
        Each time you sign in, Kairox Pay will ask for the code from your authenticator app.
        ${on.created_at ? `<span class="small">Turned on ${secEsc(new Date(on.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }))}.</span>` : ""}</div>
      <div class="form-grid"><div class="field"><label for="secOffCode">To turn it off, enter a code from your app</label>
        <input id="secOffCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"></div></div>
      <div class="row-actions"><button type="button" class="btn danger" id="secOff">Turn off two-step sign-in</button></div>`;
    return;
  }

  secEl("mfaBody").innerHTML = `
    <div class="note" style="border-left:4px solid #d97706;margin:0 0 12px"><strong>Two-step sign-in is off.</strong>
      Turn it on to protect the pay and bank details in Kairox Pay. You need a phone with an authenticator app.</div>
    <div class="row-actions"><button type="button" class="btn primary" id="secStart">Turn on two-step sign-in</button></div>`;
}

async function secStart() {
  secMsg("");
  try {
    // remove any half-finished set-up first, so a new QR code can be made
    for (const f of await secFactors()) {
      if (f.status !== "verified") await supabaseClient.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabaseClient.auth.mfa.enroll({ factorType: "totp", friendlyName: `Kairox Pay ${Date.now()}` });
    if (error) throw error;
    secPending = { id: data.id, secret: data.totp.secret };

    secEl("mfaBody").innerHTML = `
      <ol style="margin:0 0 12px;padding-left:20px;line-height:1.6">
        <li>Open your authenticator app and add an account (often a <strong>+</strong> button).</li>
        <li>Scan this code with your phone's camera. If you cannot scan it, choose "enter a setup key" and type the key below.</li>
        <li>Type the 6-digit code the app shows, then click <strong>Turn on</strong>.</li>
      </ol>
      <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
        <img src="${secEsc(data.totp.qr_code)}" alt="QR code for your authenticator app" width="190" height="190" style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:6px">
        <div style="flex:1;min-width:220px">
          <p class="small muted" style="margin:0 0 4px">Setup key</p>
          <p style="font-family:monospace;font-size:15px;word-break:break-all;margin:0 0 14px">${secEsc(data.totp.secret)}</p>
          <div class="field"><label for="secOnCode">Code from the app</label>
            <input id="secOnCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"></div>
          <div class="row-actions"><button type="button" class="btn" id="secCancel">Cancel</button>
            <button type="button" class="btn primary" id="secConfirm">Turn on</button></div>
        </div>
      </div>
      <p class="small muted" style="margin-top:12px">Do not share this QR code or key with anyone.</p>`;
    secEl("secOnCode").focus();
  } catch (error) {
    secMsg(secFriendly(error), "error");
  }
}

async function secConfirm() {
  const code = secCode(secEl("secOnCode").value);
  if (code.length !== 6) return secMsg("Enter the 6-digit code from your app.", "error");
  const { error } = await supabaseClient.auth.mfa.challengeAndVerify({ factorId: secPending.id, code });
  if (error) return secMsg(secFriendly(error), "error");
  secMsg("Two-step sign-in is on. Next time you sign in, have your phone ready.", "ok");
  await secRender();
  await secTeam();
}

async function secCancel() {
  if (secPending) { try { await supabaseClient.auth.mfa.unenroll({ factorId: secPending.id }); } catch (e) { /* ignore */ } }
  secMsg("");
  await secRender();
}

async function secOff() {
  const code = secCode(secEl("secOffCode").value);
  if (code.length !== 6) return secMsg("Enter the 6-digit code from your app to turn it off.", "error");
  try {
    const on = (await secFactors()).find((f) => f.factor_type === "totp" && f.status === "verified");
    if (!on) return secRender();
    const verify = await supabaseClient.auth.mfa.challengeAndVerify({ factorId: on.id, code });
    if (verify.error) throw verify.error;
    const { error } = await supabaseClient.auth.mfa.unenroll({ factorId: on.id });
    if (error) throw error;
    await supabaseClient.auth.refreshSession();
    secMsg("Two-step sign-in is off. Your account is now protected by your password only.", "ok");
    await secRender();
    await secTeam();
  } catch (error) {
    secMsg(secFriendly(error), "error");
  }
}

async function secTeam() {
  const { data: role } = await supabaseClient.rpc("get_my_role", { p_workspace: SEC_WS });
  if (role !== "admin") return;
  const { data, error } = await supabaseClient.rpc("two_step_report", { p_workspace: SEC_WS });
  if (error) return;   // phase26 SQL not run yet
  const names = { admin: "Administrator", director: "Managing director", payroll: "Payroll / accounts officer", viewer: "Viewer", hr: "HR officer", manager: "Manager" };
  secEl("teamBody").innerHTML = (data || []).map((p) => `<tr>
      <td>${secEsc(p.email)}</td><td>${secEsc(names[p.role] || p.role)}</td>
      <td>${p.two_step ? '<strong style="color:#16a34a">On</strong>' : `<span style="color:${["admin", "director", "payroll"].includes(p.role) ? "#b45309;font-weight:700" : "inherit"}">Off</span>`}</td>
      <td>${p.last_sign_in ? secEsc(new Date(p.last_sign_in).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })) : "—"}</td></tr>`).join("")
    || '<tr class="empty-row"><td colspan="4">Nobody has a role in this company.</td></tr>';
  secEl("teamCard").hidden = false;
}

document.addEventListener("click", (event) => {
  const id = event.target && event.target.id;
  if (id === "secStart") secStart();
  else if (id === "secConfirm") secConfirm();
  else if (id === "secCancel") secCancel();
  else if (id === "secOff") secOff();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  if (event.target.id === "secOnCode") secConfirm();
  if (event.target.id === "secOffCode") secOff();
});

async function secStartPage() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data || !data.session) { window.location.href = "login.html?next=security.html"; return; }
  await secRender();
  await secTeam();
}

if (!window.__SEC_TEST__) secStartPage();
