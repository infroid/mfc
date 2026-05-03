// Supabase bootstrap. Reads `<meta name="mfc-supabase-url">` and
// `<meta name="mfc-supabase-anon-key">` from the host page, creates the
// client once, and exposes it as `window.MFC.supabase`.
window.MFC = window.MFC || {};

(function () {
  const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.content?.trim() || null;
  const url = meta('mfc-supabase-url');
  const key = meta('mfc-supabase-anon-key');

  if (!url || !key) {
    console.error('[mfc] mfc-supabase-url / mfc-supabase-anon-key meta tags are missing — auth and data calls will fail.');
    window.MFC.supabase = null;
    return;
  }
  if (typeof window.supabase?.createClient !== 'function') {
    console.error('[mfc] @supabase/supabase-js bundle is not loaded (check the CDN <script> tag).');
    window.MFC.supabase = null;
    return;
  }

  window.MFC.supabase = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
})();
