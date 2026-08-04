/* ---------- AUTH ---------- */
let passwordRecoveryMode = false;

function clearAuthMessages() {
  ['loginError','loginMessage','resetPasswordError','resetPasswordMessage'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
}

function showLoginScreen(message = '') {
  passwordRecoveryMode = false;
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('resetPasswordScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'block';
  clearAuthMessages();
  document.getElementById('loginMessage').textContent = message;
}

function showResetPasswordScreen() {
  passwordRecoveryMode = true;
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('resetPasswordScreen').style.display = 'block';
  clearAuthMessages();
}

async function doLogin() {
  clearAuthMessages();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) {
    document.getElementById('loginError').textContent = 'Please enter your email and password.';
    return;
  }
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    document.getElementById('loginError').textContent = error.message;
    return;
  }
  showApp();
}

async function sendPasswordReset() {
  clearAuthMessages();
  const email = document.getElementById('loginEmail').value.trim();
  if (!email) {
    document.getElementById('loginError').textContent = 'Enter your email address first, then click Forgot password.';
    document.getElementById('loginEmail').focus();
    return;
  }

  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    document.getElementById('loginError').textContent = error.message;
    return;
  }
  document.getElementById('loginMessage').textContent = 'Password reset email sent. Check your inbox and spam folder.';
}

async function updatePassword() {
  clearAuthMessages();
  const password = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmNewPassword').value;

  if (password.length < 8) {
    document.getElementById('resetPasswordError').textContent = 'Your password must contain at least 8 characters.';
    return;
  }
  if (password !== confirmPassword) {
    document.getElementById('resetPasswordError').textContent = 'The passwords do not match.';
    return;
  }

  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) {
    document.getElementById('resetPasswordError').textContent = error.message;
    return;
  }

  document.getElementById('newPassword').value = '';
  document.getElementById('confirmNewPassword').value = '';
  await supabaseClient.auth.signOut();
  history.replaceState({}, document.title, window.location.pathname);
  showLoginScreen('Password updated successfully. You can now log in with your new password.');
}

async function doLogout() {
  await supabaseClient.auth.signOut();
  showLoginScreen();
}

async function showApp() {
  if (passwordRecoveryMode) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('resetPasswordScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  document.getElementById('userEmailDisplay').textContent = user.email;

  const wsSelect = document.getElementById('workspaceSelect');
  wsSelect.innerHTML = WORKSPACES.map(w => `<option value="${w.id}">${w.label}</option>`).join('');
  wsSelect.value = currentWorkspace;

  await loadAllData();
  renderCompany(); renderRates(); renderEmployees();
  renderLines('income'); renderLines('expense'); renderPartners(); renderSeRates(); renderLtdRates(); toggleEntityType();
  renderFaq();
  document.getElementById('supportWhatsApp').textContent = SUPPORT_WHATSAPP;
}

// Supabase emits PASSWORD_RECOVERY after the user opens the recovery email link.
supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    showResetPasswordScreen();
  } else if (event === 'SIGNED_IN' && session && !passwordRecoveryMode) {
    showApp();
  } else if (event === 'SIGNED_OUT') {
    showLoginScreen();
  }
});

// If already logged in from a previous visit, skip straight to the app.
// A brief delay allows a password-recovery event to take priority.
setTimeout(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session && !passwordRecoveryMode) showApp();
}, 400);
