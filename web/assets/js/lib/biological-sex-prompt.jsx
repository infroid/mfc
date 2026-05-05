// Mandatory modal that gates content until the user picks a biological-sex
// value. Mounted on /my/markers.html when user.biologicalSex is null. Cannot
// be dismissed without saving — the answer is permanent. Stored in
// auth.users.user_metadata.biological_sex.
//
// Exports on window:
//   MfcBiologicalSexGate({ user, onSaved })
//   MfcSaveBiologicalSex(value) -> Promise<void>
//   MFC_BIOSEX_OPTIONS -> [{ value, label, hint }]
//   MFC_BIOSEX_LABEL_FOR(value) -> string

(function () {
  const STYLE = `
.bsx-overlay {
  position: fixed; inset: 0; z-index: 9100;
  background: rgba(15,12,8,.52);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  animation: bsx-fade 220ms cubic-bezier(.2,.8,.2,1);
}
@keyframes bsx-fade { from { opacity: 0 } to { opacity: 1 } }

.bsx-box {
  position: relative;
  background: var(--paper, #FFFCF3);
  border: 1.5px solid var(--ink, #1F1A14);
  border-radius: 24px;
  box-shadow: 8px 8px 0 var(--orange, #FF6D2E);
  width: 100%; max-width: 480px;
  overflow: hidden;
  animation: bsx-pop 280ms cubic-bezier(.2,.8,.2,1);
}
@keyframes bsx-pop {
  from { transform: translate(8px,8px) scale(.96); opacity: 0 }
  to   { transform: translate(0,0) scale(1); opacity: 1 }
}

.bsx-head {
  padding: 28px 30px 22px;
  border-bottom: 1px dashed var(--rule-strong, rgba(31,26,20,.28));
  position: relative;
}
.bsx-eyebrow {
  font-family: var(--mono, monospace);
  font-size: 12px; letter-spacing: .04em;
  color: var(--ink-muted, #6B6253);
  margin-bottom: 12px;
}
.bsx-eyebrow::before { content: "// "; color: var(--orange, #FF6D2E); }

.bsx-title {
  font-family: var(--sans);
  font-weight: 500; font-size: 28px; line-height: 1.05;
  letter-spacing: -.025em;
  color: var(--ink, #1F1A14);
  margin-bottom: 12px;
}
.bsx-title em {
  font-family: var(--serif);
  font-style: italic; font-weight: 400;
  color: var(--orange, #FF6D2E);
}

.bsx-tag {
  font-family: var(--serif);
  font-style: italic; font-size: 16px;
  line-height: 1.45;
  color: var(--ink-soft, #3A332A);
}
.bsx-tag b {
  font-family: var(--mono, monospace); font-style: normal;
  font-weight: 500; font-size: 13px;
  background: var(--orange-soft, rgba(255,109,46,.14));
  padding: 1px 6px; border-radius: 4px;
  color: var(--orange-deep, #E2531A);
  letter-spacing: .02em;
}

.bsx-body { padding: 22px 30px 24px; }

.bsx-options {
  display: flex; flex-direction: column; gap: 8px;
  margin-bottom: 20px;
}

.bsx-opt {
  display: flex; align-items: center; gap: 14px;
  width: 100%; padding: 14px 16px;
  background: var(--paper, #FFFCF3);
  border: 1.5px solid var(--rule-strong, rgba(31,26,20,.28));
  border-radius: 12px;
  cursor: pointer; text-align: left;
  font: inherit;
  transition: transform 160ms cubic-bezier(.2,.8,.2,1),
              box-shadow 160ms,
              border-color 160ms,
              background 160ms;
}
.bsx-opt:hover {
  border-color: var(--ink, #1F1A14);
  background: var(--cream-soft, #FBF7EC);
}
.bsx-opt.selected {
  background: var(--orange-soft, rgba(255,109,46,.14));
  border-color: var(--ink, #1F1A14);
  box-shadow: 3px 3px 0 var(--ink, #1F1A14);
  transform: translate(-1px, -1px);
}
.bsx-opt:focus-visible {
  outline: 2px solid var(--orange, #FF6D2E);
  outline-offset: 2px;
}

.bsx-radio {
  display: grid; place-items: center;
  width: 20px; height: 20px;
  border: 1.5px solid var(--ink, #1F1A14);
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--paper, #FFFCF3);
}
.bsx-opt.selected .bsx-radio { background: var(--paper, #FFFCF3); }
.bsx-radio-dot {
  width: 10px; height: 10px;
  background: var(--orange, #FF6D2E);
  border-radius: 50%;
  animation: bsx-dot 180ms cubic-bezier(.2,.8,.2,1);
}
@keyframes bsx-dot {
  from { transform: scale(0) }
  to   { transform: scale(1) }
}

.bsx-opt-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.bsx-opt-label {
  font-family: var(--sans); font-size: 15px; font-weight: 500;
  color: var(--ink, #1F1A14); letter-spacing: -.01em;
}
.bsx-opt-hint {
  font-family: var(--mono, monospace); font-size: 11px;
  color: var(--ink-muted, #6B6253); letter-spacing: .02em;
}
.bsx-opt-hint::before { content: "ranges: "; color: var(--ink-faint, #9A8F7C); }

.bsx-actions {
  display: flex; align-items: center; justify-content: flex-end;
  gap: 12px;
}

.bsx-save {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 8px;
  padding: 12px 22px;
  background: var(--ink, #1F1A14); color: var(--paper, #FFFCF3);
  border: 1.5px solid var(--ink, #1F1A14);
  border-radius: 999px;
  font-family: var(--sans); font-size: 14px; font-weight: 500;
  cursor: pointer;
  box-shadow: 4px 4px 0 var(--ink, #1F1A14);
  transition: transform 180ms cubic-bezier(.2,.8,.2,1),
              box-shadow 180ms,
              background 180ms;
}
.bsx-save:hover:not(:disabled) {
  background: var(--orange, #FF6D2E);
  transform: translate(-1px, -1px);
  box-shadow: 5px 5px 0 var(--ink, #1F1A14);
}
.bsx-save:disabled {
  opacity: .4; cursor: not-allowed;
  box-shadow: 2px 2px 0 var(--ink, #1F1A14);
}

.bsx-error {
  margin-top: 12px;
  font-family: var(--mono, monospace); font-size: 12px;
  color: var(--berry, #C84B5A); letter-spacing: .04em;
}

.bsx-fineprint {
  margin-top: 18px;
  font-family: var(--mono, monospace); font-size: 10px;
  color: var(--ink-faint, #9A8F7C);
  letter-spacing: .04em; line-height: 1.5;
}
.bsx-fineprint::before { content: "// "; color: var(--ink-muted, #6B6253); }
.bsx-fineprint a {
  color: var(--orange, #FF6D2E);
  text-decoration: underline; text-underline-offset: 2px;
}
.bsx-fineprint a:hover { color: var(--orange-deep, #E2531A); }

@media (max-width: 540px) {
  .bsx-box { border-radius: 18px; box-shadow: 6px 6px 0 var(--orange, #FF6D2E); }
  .bsx-head { padding: 24px 22px 18px; }
  .bsx-body { padding: 18px 22px 22px; }
  .bsx-title { font-size: 24px; }
  .bsx-actions { flex-direction: column-reverse; align-items: stretch; }
  .bsx-save { width: 100%; }
}
`;

  function ensureStyle() {
    if (document.getElementById('mfc-biosex-style')) return;
    const el = document.createElement('style');
    el.id = 'mfc-biosex-style';
    el.textContent = STYLE;
    document.head.appendChild(el);
  }
  ensureStyle();

  const OPTIONS = [
    { value: 'female', label: 'Female', hint: 'female reference ranges' },
    { value: 'male',   label: 'Male',   hint: 'male reference ranges' },
  ];

  const LABELS = OPTIONS.reduce((acc, o) => { acc[o.value] = o.label; return acc; }, {});

  async function saveBiologicalSex(value) {
    const sb = window.MFC && window.MFC.supabase;
    if (!sb) throw new Error('Supabase client unavailable');
    const { error } = await sb.auth.updateUser({ data: { biological_sex: value } });
    if (error) throw error;
  }

  function MfcBiologicalSexGate({ user, onSaved }) {
    const [choice, setChoice] = React.useState((user && user.biologicalSex) || null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');

    async function save() {
      if (!choice || busy) return;
      setBusy(true); setError('');
      try {
        await saveBiologicalSex(choice);
        if (onSaved) onSaved(choice);
      } catch (e) {
        setError((e && e.message) || 'Failed to save');
        setBusy(false);
      }
    }

    return (
      <div className="bsx-overlay" role="dialog" aria-modal="true" aria-labelledby="bsx-title">
        <div className="bsx-box">
          <div className="bsx-head">
            <div className="bsx-eyebrow">reference calibration</div>
            <h3 id="bsx-title" className="bsx-title">Tune your <em>reference ranges</em></h3>
            <p className="bsx-tag">
              Most blood markers — <b>hemoglobin</b>, <b>ferritin</b>, <b>testosterone</b> — have
              different healthy ranges by biological sex. One quick answer keeps your chart honest.
            </p>
          </div>
          <div className="bsx-body">
            <div className="bsx-options" role="radiogroup" aria-label="Biological sex">
              {OPTIONS.map((o) => {
                const selected = choice === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    className={"bsx-opt" + (selected ? " selected" : "")}
                    onClick={() => setChoice(o.value)}
                    role="radio"
                    aria-checked={selected}
                    disabled={busy}
                  >
                    <span className="bsx-radio" aria-hidden="true">
                      {selected && <span className="bsx-radio-dot" />}
                    </span>
                    <span className="bsx-opt-text">
                      <span className="bsx-opt-label">{o.label}</span>
                      <span className="bsx-opt-hint">{o.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="bsx-actions">
              <button type="button" className="bsx-save" onClick={save} disabled={!choice || busy}>
                {busy ? 'saving…' : 'Save & continue →'}
              </button>
            </div>
            {error && <div className="bsx-error">{error}</div>}
            <p className="bsx-fineprint">
              stored privately in your account · this answer is permanent
            </p>
          </div>
        </div>
      </div>
    );
  }

  window.MfcBiologicalSexGate = MfcBiologicalSexGate;
  window.MfcSaveBiologicalSex = saveBiologicalSex;
  window.MFC_BIOSEX_OPTIONS = OPTIONS;
  window.MFC_BIOSEX_LABEL_FOR = (v) => LABELS[v] || null;
})();
