// Shared sign-in modal. Self-mounts; opens on `mfc:open-auth` event.
// Trigger from anywhere: window.dispatchEvent(new CustomEvent('mfc:open-auth'))

(function () {
  const { useState, useEffect } = React;
  const _BASE = window.MFC_BASE || '';

  const STYLE = `
.mfc-auth-overlay{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:20px;animation:mfc-auth-fade 200ms cubic-bezier(.2,.8,.2,1)}
@keyframes mfc-auth-fade{from{opacity:0}to{opacity:1}}
.mfc-auth-box{position:relative;background:var(--paper,#FFFCF3);border:1.5px solid var(--ink,#1F1A14);border-radius:24px;box-shadow:8px 8px 0 var(--orange,#FF6D2E);width:100%;max-width:440px;overflow:hidden;animation:mfc-auth-pop 240ms cubic-bezier(.2,.8,.2,1)}
@keyframes mfc-auth-pop{from{transform:translate(8px,8px) scale(.96);opacity:0}to{transform:translate(0,0) scale(1);opacity:1}}
.mfc-auth-head{padding:28px 28px 22px;border-bottom:1px dashed var(--rule-strong,rgba(31,26,20,.28))}
.mfc-auth-eyebrow{font-family:var(--mono,monospace);font-size:12px;color:var(--ink-muted,#6B6253);letter-spacing:.04em;margin-bottom:10px}
.mfc-auth-eyebrow::before{content:"// ";color:var(--orange,#FF6D2E)}
.mfc-auth-title{font-family:var(--sans);font-weight:500;font-size:26px;line-height:1.1;letter-spacing:-.025em;color:var(--ink);margin-bottom:10px}
.mfc-auth-title em{font-family:var(--serif);font-style:italic;font-weight:400;color:var(--orange,#FF6D2E)}
.mfc-auth-brand{display:inline-flex;align-items:center;gap:8px;vertical-align:middle}
.mfc-auth-brand-mark{display:inline-block;width:32px;height:32px;border-radius:50%;object-fit:cover;background:var(--paper,#FFFCF3);flex-shrink:0}
.mfc-auth-brand-name{font-family:var(--sans);font-weight:600;letter-spacing:-.02em;color:var(--ink)}
.mfc-auth-brand-name em{font-family:var(--serif);font-weight:400;font-style:italic;color:var(--ink)}
.mfc-auth-tag{font-family:var(--serif);font-style:italic;font-size:16px;color:var(--ink-soft,#3A332A);line-height:1.4}
.mfc-auth-body{padding:22px 28px 26px}
.mfc-auth-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px 18px;border:1.5px solid var(--ink,#1F1A14);border-radius:999px;background:var(--paper,#FFFCF3);color:var(--ink,#1F1A14);font:inherit;font-size:14px;font-weight:500;cursor:pointer;box-shadow:4px 4px 0 var(--ink,#1F1A14);transition:transform 180ms cubic-bezier(.2,.8,.2,1),box-shadow 180ms cubic-bezier(.2,.8,.2,1),background 180ms;margin-bottom:10px}
.mfc-auth-btn:hover:not(:disabled){transform:translate(-1px,-1px);box-shadow:5px 5px 0 var(--ink,#1F1A14)}
.mfc-auth-btn:disabled{opacity:.5;cursor:not-allowed}
.mfc-auth-btn.primary{background:var(--ink,#1F1A14);color:var(--paper,#FFFCF3)}
.mfc-auth-btn.primary:hover:not(:disabled){background:var(--orange,#FF6D2E)}
.mfc-auth-btn.provider{background:#fff;color:#1F1F1F;border-color:#747775}
.mfc-auth-btn.provider:hover:not(:disabled){background:#fff}
.mfc-auth-provider-icon{display:block;width:20px;height:20px;flex:0 0 auto;object-fit:contain}
.mfc-auth-provider-icon.apple{width:30px;height:30px;margin:-5px -3px -5px -2px}
.mfc-auth-divider{display:flex;align-items:center;gap:10px;margin:18px 0 14px}
.mfc-auth-divider hr{flex:1;border:none;border-top:1px dashed var(--rule-strong,rgba(31,26,20,.28))}
.mfc-auth-divider span{font-family:var(--mono,monospace);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-muted,#6B6253)}
.mfc-auth-input{width:100%;padding:12px 14px;background:var(--cream-soft,#FBF7EC);border:1.5px solid var(--rule-strong,rgba(31,26,20,.28));border-radius:12px;font:inherit;font-size:15px;color:var(--ink,#1F1A14);outline:none;transition:border-color 180ms,box-shadow 180ms,background 180ms}
.mfc-auth-input:focus{border-color:var(--orange,#FF6D2E);box-shadow:0 0 0 3px rgba(255,109,46,.14);background:var(--paper,#FFFCF3)}
.mfc-auth-input::placeholder{color:var(--ink-faint,#9A8F7C)}
.mfc-auth-magic{display:flex;flex-direction:column;gap:10px}
.mfc-auth-error{color:var(--berry,#C84B5A);font-size:12px;font-family:var(--mono,monospace);margin-top:12px;letter-spacing:.04em}
.mfc-auth-close{position:absolute;top:14px;right:14px;width:32px;height:32px;display:grid;place-items:center;border:none;background:transparent;color:var(--ink-muted,#6B6253);font-size:16px;cursor:pointer;border-radius:999px;transition:background 150ms,color 150ms}
.mfc-auth-close:hover{background:var(--cream-deep,#EFE6CF);color:var(--ink,#1F1A14)}
.mfc-auth-sent{padding:36px 28px 32px;text-align:center}
.mfc-auth-sent .scribble{font-family:var(--hand,cursive);font-size:42px;color:var(--orange,#FF6D2E);transform:rotate(-4deg);display:inline-block;line-height:1;margin-bottom:6px}
.mfc-auth-sent .lede{font-family:var(--serif,serif);font-style:italic;font-size:18px;color:var(--ink-soft,#3A332A);line-height:1.4}
.mfc-auth-sent .tip{font-family:var(--mono,monospace);font-size:11px;color:var(--ink-faint,#9A8F7C);margin-top:14px;letter-spacing:.06em}
`;

  function AuthModal({ onClose }) {
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    async function handleSubmit(e) {
      e.preventDefault();
      setError('');
      if (!email.trim()) return;
      setBusy(true);
      try {
        await window.MFC.auth.signIn({ email: email.trim() });
        setSent(true);
      } catch (err) { setError(err.message || 'Failed to send link'); }
      setBusy(false);
    }
    async function handleGoogle() {
      setError(''); setBusy(true);
      try { await window.MFC.auth.signIn({ provider: 'google' }); }
      catch (err) { setError(err.message || 'Google sign-in failed'); setBusy(false); }
    }
    useEffect(() => {
      const onKey = (e) => { if (e.key === 'Escape') onClose(); };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
      <div className="mfc-auth-overlay" onClick={onClose}>
        <div className="mfc-auth-box" onClick={e => e.stopPropagation()}>
          <button className="mfc-auth-close" onClick={onClose} aria-label="Close">✕</button>
          <div className="mfc-auth-head">
            <div className="mfc-auth-eyebrow">welcome back</div>
            <h3 className="mfc-auth-title">
              Sign in to{' '}
              <span className="mfc-auth-brand">
                <img className="mfc-auth-brand-mark" src="/assets/img/brand/mfc.png" alt="MyFoodCraving" />
                <span className="mfc-auth-brand-name">MyFood<em>Craving</em></span>
              </span>
            </h3>
            <p className="mfc-auth-tag">Sync your health markers, get food recommendations tuned to your bloodwork, and pick up cooking right where you left off.</p>
          </div>
          {sent ? (
            <div className="mfc-auth-sent">
              <div className="scribble">✎</div>
              <p className="lede">Check <b>{email}</b> for a sign-in link.</p>
              <p className="tip">// link expires in 1 hour</p>
            </div>
          ) : (
            <div className="mfc-auth-body">
              <button type="button" className="mfc-auth-btn provider" onClick={handleGoogle} disabled={busy}>
                <img className="mfc-auth-provider-icon" src={_BASE + "assets/img/brand/google-g.svg"} alt="" aria-hidden="true" draggable="false" />
                Continue with Google
              </button>
              <button type="button" className="mfc-auth-btn provider" disabled title="Coming soon">
                <img className="mfc-auth-provider-icon apple" src={_BASE + "assets/img/brand/apple-logo.png"} alt="" aria-hidden="true" draggable="false" />
                Continue with Apple
              </button>
              <div className="mfc-auth-divider"><hr /><span>or magic link</span><hr /></div>
              <form onSubmit={handleSubmit} className="mfc-auth-magic">
                <input className="mfc-auth-input" type="email" required
                  placeholder="you@kitchen.com"
                  value={email} onChange={e => setEmail(e.target.value)} autoFocus />
                <button type="submit" className="mfc-auth-btn primary" disabled={busy} style={{ marginBottom: 0 }}>
                  {busy ? 'sending…' : 'Send sign-in link →'}
                </button>
              </form>
              {error && <div className="mfc-auth-error">{error}</div>}
            </div>
          )}
        </div>
      </div>
    );
  }

  function AuthHost() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
      const handler = () => setOpen(true);
      window.addEventListener('mfc:open-auth', handler);
      return () => window.removeEventListener('mfc:open-auth', handler);
    }, []);
    if (!open) return null;
    return <AuthModal onClose={() => setOpen(false)} />;
  }

  function mount() {
    if (document.getElementById('mfc-auth-modal-root')) return;
    const styleEl = document.createElement('style');
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);
    const div = document.createElement('div');
    div.id = 'mfc-auth-modal-root';
    document.body.appendChild(div);
    ReactDOM.createRoot(div).render(<AuthHost />);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
