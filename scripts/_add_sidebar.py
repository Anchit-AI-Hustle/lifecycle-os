"""
Adds a sticky LHS sidebar with accordions to reports/strategy.html.
Steps:
  1. Inject sidebar + layout CSS
  2. Add IDs to metric accordion rows and question groups
  3. Wrap body content in a flex layout (sidebar + main)
  4. Inject sidebar HTML
  5. Add minimal JS for active-link highlighting and mobile toggle
"""
import re, pathlib

HTML = pathlib.Path(r"c:\Users\Archit Tandon\Desktop\knickgasm-dtc-data-engine\reports\strategy.html")
html = HTML.read_text(encoding="utf-8")

# ── 1. SIDEBAR + LAYOUT CSS ───────────────────────────────────────────────────
SIDEBAR_CSS = """
/* ── LAYOUT ── */
#layout { display:flex; align-items:flex-start; }
#main   { flex:1; min-width:0; overflow:hidden; }

/* ── SIDEBAR ── */
#sidebar {
  position: sticky;
  top: 56px;
  width: 248px;
  min-width: 248px;
  height: calc(100vh - 56px);
  overflow-y: auto;
  overflow-x: hidden;
  flex-shrink: 0;
  background: var(--bg2);
  border-right: 1px solid var(--border);
  padding: 12px 0 48px;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
  z-index: 50;
}
#sidebar::-webkit-scrollbar { width:4px; }
#sidebar::-webkit-scrollbar-thumb { background:var(--border); border-radius:2px; }

.sb-brand {
  padding: 10px 16px 14px;
  font-size: .72rem; font-weight: 800; letter-spacing: .12em;
  text-transform: uppercase; color: var(--text3);
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}
.sb-brand strong { color: var(--amber); }

/* section accordion */
details.sb-sec { }
details.sb-sec > summary {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px;
  cursor: pointer; list-style: none; user-select: none;
  font-size: .78rem; font-weight: 700; color: var(--text);
}
details.sb-sec > summary::-webkit-details-marker { display: none; }
details.sb-sec > summary:hover { background: var(--bg3); }
.sb-sec-icon { font-size: .9rem; flex-shrink:0; }
.sb-sec-label { flex:1; }
.sb-chevron {
  width: 14px; height: 14px; flex-shrink: 0; color: var(--text3);
  transition: transform .18s;
}
details.sb-sec[open] > summary .sb-chevron { transform: rotate(180deg); }

.sb-sec-body { padding: 0 0 6px; }

/* links */
.sb-link {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 16px 5px 32px;
  font-size: .76rem; color: var(--text2); text-decoration: none;
  border-radius: 0; transition: background .12s, color .12s;
  line-height: 1.35;
}
.sb-link:hover { background: var(--bg3); color: var(--text); }
.sb-link.active { color: var(--purple); font-weight: 600; background: var(--purple-light); }
.sb-link.sb-top { padding-left: 16px; font-weight: 600; color: var(--text); }
.sb-link.sb-top:hover { color: var(--purple); }

/* group label inside accordion */
.sb-glabel {
  padding: 8px 16px 3px 20px;
  font-size: .64rem; font-weight: 800; letter-spacing: .1em;
  text-transform: uppercase; color: var(--text3);
  margin-top: 4px;
}
.sb-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink:0;
  display: inline-block; margin-right: 4px;
}
.sb-strat {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 4px;
  font-size: .62rem; font-weight: 800; color: #fff; flex-shrink: 0;
}
.sb-divider { height: 1px; background: var(--border); margin: 6px 12px; }
.sb-standalone {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px;
  font-size: .78rem; font-weight: 700; color: var(--text);
  text-decoration: none; transition: background .12s;
}
.sb-standalone:hover { background: var(--bg3); color: var(--purple); }
.sb-standalone.active { color: var(--purple); background: var(--purple-light); }

/* mobile toggle */
#sb-toggle {
  display: none;
  align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--bg3);
  cursor: pointer; flex-shrink: 0;
  color: var(--text2);
}
#sb-overlay {
  display: none;
  position: fixed; inset: 0; background: rgba(0,0,0,.4);
  z-index: 49;
}

@media (max-width: 960px) {
  #sidebar {
    position: fixed;
    left: -260px;
    top: 56px;
    transition: left .22s cubic-bezier(.4,0,.2,1);
    box-shadow: none;
  }
  #sidebar.sb-open {
    left: 0;
    box-shadow: 4px 0 24px rgba(0,0,0,.18);
  }
  #sb-overlay.sb-open { display: block; }
  #sb-toggle { display: flex; }
  #main { width: 100%; }
}
"""

html = html.replace("</style>", SIDEBAR_CSS + "\n</style>", 1)

# ── 2. ADD IDs TO METRIC ROWS ─────────────────────────────────────────────────
def add_metric_ids(h):
    mids = ['M1','M2','M3','M4','M5','M6','M7','M8','M9','M10',
            'M11','M12','M13','M14','M15','BONUS']
    for mid in mids:
        pattern = (r'(<details class="m-row")([\s\S]{1,250}?)'
                   r'(<span class="m-badge"[^>]*>)(' + re.escape(mid) + r')(</span>)')
        def make_replacer(m_id):
            def replacer(match):
                if f'id="metric-{m_id.lower()}"' in match.group(0):
                    return match.group(0)  # already has id
                return (f'<details id="metric-{m_id.lower()}" class="m-row"'
                        + match.group(2) + match.group(3) + m_id + match.group(5))
            return replacer
        h = re.sub(pattern, make_replacer(mid), h, count=1)
    return h

html = add_metric_ids(html)

# ── 3. ADD IDs TO QUESTION GROUPS ─────────────────────────────────────────────
Q_GROUP_IDS = {
    "Revenue &amp; Margin":            "qg-revenue",
    "Customer Economics":              "qg-economics",
    "Retention &amp; Churn":           "qg-retention",
    "Channel &amp; Email Efficiency":  "qg-channel",
    "Conversion &amp; Revenue Mix":    "qg-conversion",
}
for title, gid in Q_GROUP_IDS.items():
    old = f'<details class="q-group-wrap" open>\n<summary>\n<div class="q-group-header" style="display:flex;align-items:center">\n  <span class="q-group-icon">'
    # Match by title text
    pattern = (r'(<details class="q-group-wrap"[^>]*>)'
               r'([\s\S]{1,300}?<span class="q-group-title">)'
               + re.escape(title) + r'(</span>)')
    def make_grp_replacer(gid_inner, title_inner):
        def replacer(match):
            if f'id="{gid_inner}"' in match.group(1):
                return match.group(0)
            new_open = match.group(1).replace('<details', f'<details id="{gid_inner}"')
            return new_open + match.group(2) + title_inner + match.group(3)
        return replacer
    html = re.sub(pattern, make_grp_replacer(gid, title), html, count=1)

# ── 4. BUILD SIDEBAR HTML ──────────────────────────────────────────────────────
def chevron():
    return '<svg class="sb-chevron" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3,5 7,9 11,5"/></svg>'

SIDEBAR_HTML = f"""<aside id="sidebar">
  <div class="sb-brand">KNICKGASM &nbsp;<strong>DTC Analytics</strong></div>

  <!-- KEY QUESTIONS -->
  <details class="sb-sec" open>
    <summary>
      <span class="sb-sec-icon">❓</span>
      <span class="sb-sec-label">Key Questions</span>
      {chevron()}
    </summary>
    <div class="sb-sec-body">
      <a class="sb-link sb-top" href="#questions">All 19 Questions</a>
      <div class="sb-divider"></div>
      <a class="sb-link" href="#qg-revenue">💰 Revenue &amp; Margin</a>
      <a class="sb-link" href="#qg-economics">📐 Customer Economics</a>
      <a class="sb-link" href="#qg-retention">🔁 Retention &amp; Churn</a>
      <a class="sb-link" href="#qg-channel">📧 Channel &amp; Email</a>
      <a class="sb-link" href="#qg-conversion">🛒 Conversion &amp; Mix</a>
    </div>
  </details>

  <!-- METRICS FRAMEWORK -->
  <details class="sb-sec" open>
    <summary>
      <span class="sb-sec-icon">📊</span>
      <span class="sb-sec-label">Metrics Framework</span>
      {chevron()}
    </summary>
    <div class="sb-sec-body">
      <a class="sb-link sb-top" href="#overview">Overview &amp; Pyramid</a>
      <div class="sb-glabel">Tier 1 — Business Health</div>
      <a class="sb-link" href="#metric-m1"><span class="sb-dot" style="background:#d97706"></span>M1 · Net Revenue by Market</a>
      <a class="sb-link" href="#metric-m2"><span class="sb-dot" style="background:#d97706"></span>M2 · New vs Returning</a>
      <a class="sb-link" href="#metric-m3"><span class="sb-dot" style="background:#0d9488"></span>M3 · LTV:CAC by Channel</a>
      <a class="sb-link" href="#metric-m4"><span class="sb-dot" style="background:#7c3aed"></span>M4 · Repeat Rate 90d</a>
      <a class="sb-link" href="#metric-m5"><span class="sb-dot" style="background:#d97706"></span>M5 · Gross Margin %</a>
      <div class="sb-glabel">Tier 2 — Growth Levers</div>
      <a class="sb-link" href="#metric-m6"><span class="sb-dot" style="background:#0d9488"></span>M6 · CAC by Channel</a>
      <a class="sb-link" href="#metric-m7"><span class="sb-dot" style="background:#7c3aed"></span>M7 · Email Revenue %</a>
      <a class="sb-link" href="#metric-m8"><span class="sb-dot" style="background:#d97706"></span>M8 · AOV Trend MoM</a>
      <a class="sb-link" href="#metric-m9"><span class="sb-dot" style="background:#2563eb"></span>M9 · Checkout Funnel</a>
      <a class="sb-link" href="#metric-m10"><span class="sb-dot" style="background:#e11d48"></span>M10 · Subscription Mix</a>
      <div class="sb-glabel">Tier 3 — Retention Intel</div>
      <a class="sb-link" href="#metric-m11"><span class="sb-dot" style="background:#7c3aed"></span>M11 · Cohort Retention</a>
      <a class="sb-link" href="#metric-m12"><span class="sb-dot" style="background:#7c3aed"></span>M12 · Time to 2nd Purchase</a>
      <a class="sb-link" href="#metric-m13"><span class="sb-dot" style="background:#7c3aed"></span>M13 · Churn Risk</a>
      <a class="sb-link" href="#metric-m14"><span class="sb-dot" style="background:#e11d48"></span>M14 · At-Risk Revenue</a>
      <a class="sb-link" href="#metric-m15"><span class="sb-dot" style="background:#e11d48"></span>M15 · Product Repeat Rate</a>
      <a class="sb-link" href="#metric-bonus"><span class="sb-dot" style="background:#0d9488"></span>BONUS · LTV by Market</a>
    </div>
  </details>

  <!-- STRATEGIES -->
  <details class="sb-sec" open>
    <summary>
      <span class="sb-sec-icon">🗺</span>
      <span class="sb-sec-label">Strategies</span>
      {chevron()}
    </summary>
    <div class="sb-sec-body">
      <a class="sb-link sb-top" href="#s1"><span class="sb-strat" style="background:#7c3aed">S1</span>Retention Engine</a>
      <a class="sb-link sb-top" href="#s2"><span class="sb-strat" style="background:#0d9488">S2</span>Channel Efficiency</a>
      <a class="sb-link sb-top" href="#s3"><span class="sb-strat" style="background:#d97706">S3</span>Geo Expansion</a>
      <a class="sb-link sb-top" href="#s4"><span class="sb-strat" style="background:#e11d48">S4</span>Subscription Flywheel</a>
      <a class="sb-link sb-top" href="#s5"><span class="sb-strat" style="background:#2563eb">S5</span>Funnel Conversion</a>
    </div>
  </details>

  <div class="sb-divider"></div>
  <a class="sb-standalone" href="#arch">🏗 &nbsp;Data Architecture</a>
  <a class="sb-standalone" href="#roadmap">🗓 &nbsp;Roadmap</a>
</aside>"""

# ── 5. ADD MOBILE TOGGLE BUTTON TO NAV ───────────────────────────────────────
TOGGLE_BTN = """<button id="sb-toggle" aria-label="Toggle menu" onclick="toggleSidebar()">
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="2" y1="5"  x2="16" y2="5"/>
    <line x1="2" y1="9"  x2="16" y2="9"/>
    <line x1="2" y1="13" x2="16" y2="13"/>
  </svg>
</button>"""

# Insert toggle as first child of nav
html = html.replace(
    '<nav id="nav">',
    '<nav id="nav">' + TOGGLE_BTN,
    1
)

# ── 6. WRAP BODY CONTENT IN LAYOUT ───────────────────────────────────────────
# Everything after </nav> and before </body> goes into #layout > #main
NAV_END   = "</nav>"
BODY_END  = "</body>"

nav_pos   = html.index(NAV_END) + len(NAV_END)
body_pos  = html.rindex(BODY_END)

before_layout = html[:nav_pos]
content       = html[nav_pos:body_pos].strip()
after_layout  = html[body_pos:]

# overlay div for mobile
OVERLAY = '<div id="sb-overlay" onclick="toggleSidebar()"></div>'

html = (before_layout
        + f"\n\n{OVERLAY}\n<div id=\"layout\">\n{SIDEBAR_HTML}\n<div id=\"main\">\n"
        + content
        + "\n</div><!-- #main -->\n</div><!-- #layout -->\n"
        + after_layout)

# ── 7. ACTIVE-LINK JS ─────────────────────────────────────────────────────────
JS = """
<script>
// Mobile sidebar toggle
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sb-overlay');
  sb.classList.toggle('sb-open');
  ov.classList.toggle('sb-open');
}

// Active link via IntersectionObserver
(function() {
  const links = document.querySelectorAll('#sidebar a[href^="#"]');
  const targets = new Map();
  links.forEach(l => {
    const id = l.getAttribute('href').slice(1);
    const el = document.getElementById(id);
    if (el) targets.set(id, l);
  });

  let lastActive = null;
  const activate = (id) => {
    if (id === lastActive) return;
    links.forEach(l => l.classList.remove('active'));
    const link = targets.get(id);
    if (link) {
      link.classList.add('active');
      // scroll link into view inside sidebar
      link.scrollIntoView({ block: 'nearest' });
    }
    lastActive = id;
  };

  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) activate(e.target.id);
    });
  }, { rootMargin: '-10% 0px -75% 0px', threshold: 0 });

  targets.forEach((_, id) => {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  });
})();
</script>
"""

html = html.replace("</body>", JS + "\n</body>", 1)

# ── 8. WRITE + VERIFY ─────────────────────────────────────────────────────────
HTML.write_text(html, encoding="utf-8")

sb_links  = len(re.findall(r'class="sb-link"', html))
m_ids     = len(re.findall(r'id="metric-m', html))
qg_ids    = len(re.findall(r'id="qg-', html))
kb        = round(len(html) / 1024, 1)

print(f"Done.")
print(f"  Sidebar links : {sb_links}")
print(f"  Metric IDs    : {m_ids}")
print(f"  Q-group IDs   : {qg_ids}")
print(f"  Final size    : {kb} KB")
