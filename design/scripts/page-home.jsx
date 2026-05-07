/* global React */
const Dh = window.MFC_DATA;
const { navigate: navH } = window.MFC_CHROME;

function HomePage() {
  const featured = Dh.RECIPES.filter(r => r.featured);
  return (
    <>
      {/* Hero */}
      <section className="home-hero">
        <div className="wrap">
          <div className="home-hero-grid">
            <div>
              <div className="pill" style={{ marginBottom: 24 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--orange)", boxShadow: "0 0 0 3px var(--orange-soft)", animation: "pulse-mini 1.6s ease-in-out infinite" }} />
                NEW · MARKER-AWARE RECIPE PICKS
              </div>
              <h1>
                Cook for the body<br />
                <em>you have today.</em>
              </h1>
              <p className="home-hero-sub">
                A kitchen that listens — to your blood markers, your week, your cravings — and tells you what to make for dinner.
              </p>
              <div className="home-hero-cta">
                <button className="btn orange" onClick={() => navH("/recipes")}>
                  Browse 10 recipes →
                </button>
                <button className="btn ghost" onClick={() => navH("/dashboard")}>
                  See your dashboard
                </button>
              </div>
              <div className="home-hero-stats">
                <div><b>10</b><span>recipes ready</span></div>
                <div><b>20</b><span>ingredients</span></div>
                <div><b>16</b><span>blood markers</span></div>
                <div><b>5</b><span>cooked this week</span></div>
              </div>
            </div>

            <div style={{ position: "relative" }}>
              <div className="home-hero-image">
                <img src="assets/lemon-ricotta-spaghetti.jpg" alt="Lemon ricotta spaghetti" />
              </div>
              <span className="home-hero-tag">// tonight: lemon ricotta · 22 min</span>
              <span className="home-hero-scribble">salt the water properly!</span>
            </div>
          </div>
        </div>
      </section>

      {/* Feature row */}
      <div className="wrap">
        <div className="feature-row">
          <div className="feature-cell">
            <span className="feature-num">01</span>
            <h3>Test your <em>markers.</em></h3>
            <p>Upload bloodwork or enter a few numbers. We'll know what your body is asking for — iron, D, B12, the works.</p>
          </div>
          <div className="feature-cell">
            <span className="feature-num">02</span>
            <h3>We pick your <em>recipes.</em></h3>
            <p>Tonight's dinner shouldn't be a debate. Get one sharp recommendation per meal, tailored to where your numbers are this week.</p>
          </div>
          <div className="feature-cell">
            <span className="feature-num">03</span>
            <h3>Cook <em>guided.</em></h3>
            <p>Step-by-step, hands-free, with timers when you need them and silence when you don't. Pause anywhere — pick up later.</p>
          </div>
        </div>
      </div>

      {/* Featured */}
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <div className="section-label">tonight's contenders</div>
              <h2>Three things <em>worth cooking</em></h2>
            </div>
            <button className="btn ghost sm" onClick={() => navH("/recipes")}>
              All recipes →
            </button>
          </div>
          <div className="featured-grid">
            {featured.slice(0, 3).map(r => (
              <a key={r.id} className="featured-card card lift" href={"#/recipe/" + r.id} onClick={(e) => e.preventDefault()}>
                <div className="fc-top" style={{ background: r.colorSoft }}>
                  <img src={r.image} alt={r.name} className="fc-image" />
                  <span className="fc-cuisine">{r.cuisine}</span>
                  <span className="fc-difficulty">{r.difficulty}</span>
                </div>
                <div className="fc-body">
                  <h3 className="fc-name">{r.name}</h3>
                  <p className="fc-tagline">{r.tagline}</p>
                  <div className="fc-meta">
                    <span>⏱ {r.minutes} MIN</span>
                    <span>·</span>
                    <span>👥 {r.servings} SERVINGS</span>
                  </div>
                  <div className="fc-highlight">
                    <span style={{ color: "var(--matcha)" }}>✦</span> {r.highlight}
                  </div>
                </div>
                <div className="fc-cta">
                  <span>Cook it now</span>
                  <span>→</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

window.MFC_PAGES = window.MFC_PAGES || {};
window.MFC_PAGES.HomePage = HomePage;
