// Chef auth gate. Renders the page only when the signed-in user has
// app_metadata.role in {chef, admin}. Otherwise replaces #root with a sign-in
// / not-authorized panel. RLS still protects writes regardless — this just
// keeps the UI honest for non-chefs. Admin is allowed because the chef portal
// is the recipe-management home for everyone with write access.
//
// Usage in a chef page:
//   window.MFC.chefGate.guard().then((ok) => { if (ok) ReactDOM.createRoot(...) });
window.MFC = window.MFC || {};
window.MFC.chefGate = (function () {
  const sb = () => window.MFC.supabase;

  async function getRole() {
    const client = sb();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data?.session?.user?.app_metadata?.role ?? null;
  }

  function panel(title, body, actions) {
    const root = document.getElementById('root');
    if (!root) return;
    root.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'min-height:100vh;display:grid;place-items:center;padding:40px;background:var(--cream-deep,#EFE6CF);';
    const card = document.createElement('div');
    card.style.cssText = 'max-width:520px;background:var(--paper,#FFFCF3);border:1.5px solid var(--ink,#1F1A14);border-radius:18px;box-shadow:0 4px 0 var(--ink,#1F1A14);padding:36px 32px;text-align:center;';
    card.innerHTML = `
      <div style="font-family:var(--mono,monospace);font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:var(--orange,#FF6D2E);margin-bottom:14px;">myfoodcraving · chef</div>
      <h1 style="font-family:var(--sans,sans-serif);font-weight:500;font-size:32px;letter-spacing:-0.02em;line-height:1.05;margin-bottom:10px;">${title}</h1>
      <p style="color:var(--ink-soft,#3A332A);font-size:15px;line-height:1.55;margin-bottom:22px;">${body}</p>
      <div id="chef-gate-actions" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;"></div>
    `;
    wrap.appendChild(card);
    root.appendChild(wrap);
    const actionsHost = card.querySelector('#chef-gate-actions');
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.style.cssText = 'padding:10px 18px;border-radius:999px;font-size:14px;font-weight:500;border:1.5px solid var(--ink,#1F1A14);cursor:pointer;font-family:inherit;' + (a.primary ? 'background:var(--orange,#FF6D2E);color:var(--paper,#FFFCF3);border-color:var(--orange,#FF6D2E);' : 'background:var(--paper,#FFFCF3);color:var(--ink,#1F1A14);');
      btn.addEventListener('click', a.onClick);
      actionsHost.appendChild(btn);
    }
  }

  async function signInWithGoogle() {
    await sb().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href } });
  }

  async function signInWithEmail() {
    const email = prompt('Chef email — we’ll send a magic link.');
    if (!email) return;
    const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } });
    if (error) { alert('Sign-in failed: ' + error.message); return; }
    alert(`Magic link sent to ${email}. Click it from this browser.`);
  }

  async function signOut() {
    await sb().auth.signOut();
    location.reload();
  }

  async function guard() {
    if (!sb()) {
      panel('Supabase not configured',
        'The <code>mfc-supabase-url</code> / <code>mfc-supabase-publishable-key</code> meta tags are empty. Fill them in (see docs/USER-TODO.md §4) and reload.',
        []);
      return false;
    }

    const { data } = await sb().auth.getSession();
    const user = data?.session?.user;

    if (!user) {
      panel('Sign in to chef portal',
        'These pages are restricted to chef accounts. Sign in with the email or Google account that has the <b>chef</b> (or <b>admin</b>) role.',
        [
          { label: 'Continue with Google', primary: true, onClick: signInWithGoogle },
          { label: 'Email magic link', onClick: signInWithEmail },
        ]);
      return false;
    }

    const role = await getRole();
    if (role !== 'chef' && role !== 'admin') {
      panel('Not authorized',
        `Signed in as <b>${user.email || user.id}</b>, but this account doesn’t have the <code>chef</code> role. You need chef access. Ask an admin to grant it.`,
        [
          { label: 'Sign out', onClick: signOut },
          { label: 'Back to site', primary: true, onClick: () => { location.href = '../index.html'; } },
        ]);
      return false;
    }

    return true;
  }

  return { guard, getRole };
})();
