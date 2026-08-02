"""
Replaces the sidebar HTML with a version that:
1. Shows count badges on every accordion header and group link
2. Collapses 16 metric links into 3 tier group links (reduces sidebar noise)
3. Adds content-type pills to strategy links
4. Adds sb-count CSS
"""
import re, pathlib

HTML = pathlib.Path(r"c:\Users\Archit Tandon\Desktop\knickgasm-dtc-data-engine\reports\strategy.html")
html = HTML.read_text(encoding="utf-8")

# ── 1. CSS ────────────────────────────────────────────────────────────────────
COUNT_CSS = """
/* ── SIDEBAR COUNT BADGES ── */
.sb-count {
  margin-left: auto;
  font-size: .62rem; font-weight: 700;
  color: var(--text3);
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 1px 7px;
  flex-shrink: 0;
  white-space: nowrap;
}
.sb-link .sb-count { margin-left: auto; }

/* content-type pills on strategy links */
.sb-meta {
  font-size: .6rem; font-weight: 600;
  color: var(--text3); margin-left: auto;
  white-space: nowrap; letter-spacing: .02em;
}

/* tier group dividers inside metrics */
.sb-tier-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 16px 4px 20px;
  font-size: .68rem; font-weight: 700;
  color: var(--text2);
  border-top: 1px solid var(--border);
  margin-top: 4px;
}
.sb-tier-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
"""
html = html.replace("</style>", COUNT_CSS + "\n</style>", 1)

# ── 2. BUILD NEW SIDEBAR HTML ─────────────────────────────────────────────────
def chev():
    return '<svg class="sb-chevron" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3,5 7,9 11,5"/></svg>'

NEW_SIDEBAR = f"""<aside id="sidebar">
  <div class="sb-brand">KNICKGASM &nbsp;<strong>DTC Analytics</strong></div>

  <!-- KEY QUESTIONS -->
  <details class="sb-sec" open>
    <summary>
      <span class="sb-sec-icon">❓</span>
      <span class="sb-sec-label">Key Questions</span>
      <span class="sb-count">19 cards</span>
      {chev()}
    </summary>
    <div class="sb-sec-body">
      <a class="sb-link sb-top" href="#questions">All Questions</a>
      <div class="sb-divider"></div>
      <a class="sb-link" href="#qg-revenue">💰 Revenue &amp; Margin <span class="sb-count">4</span></a>
      <a class="sb-link" href="#qg-economics">📐 Customer Economics <span class="sb-count">4</span></a>
      <a class="sb-link" href="#qg-retention">🔁 Retention &amp; Churn <span class="sb-count">5</span></a>
      <a class="sb-link" href="#qg-channel">📧 Channel &amp; Email <span class="sb-count">2</span></a>
      <a class="sb-link" href="#qg-conversion">🛒 Conversion &amp; Mix <span class="sb-count">4</span></a>
    </div>
  </details>

  <!-- METRICS FRAMEWORK — tier groups only (not 16 individual links) -->
  <details class="sb-sec" open>
    <summary>
      <span class="sb-sec-icon">📊</span>
      <span class="sb-sec-label">Metrics Framework</span>
      <span class="sb-count">16 metrics</span>
      {chev()}
    </summary>
    <div class="sb-sec-body">
      <a class="sb-link sb-top" href="#overview">Overview &amp; Pyramid</a>
      <div class="sb-divider"></div>
      <div class="sb-tier-row"><span class="sb-tier-dot" style="background:#d97706"></span>Tier 1 — Business Health<span class="sb-count" style="margin-left:auto">5</span></div>
      <a class="sb-link" href="#metric-m1"><span class="sb-dot" style="background:#d97706"></span>M1 · Net Revenue by Market</a>
      <a class="sb-link" href="#metric-m2"><span class="sb-dot" style="background:#d97706"></span>M2 · New vs Returning</a>
      <a class="sb-link" href="#metric-m3"><span class="sb-dot" style="background:#0d9488"></span>M3 · LTV:CAC by Channel</a>
      <a class="sb-link" href="#metric-m4"><span class="sb-dot" style="background:#7c3aed"></span>M4 · Repeat Rate 90d</a>
      <a class="sb-link" href="#metric-m5"><span class="sb-dot" style="background:#d97706"></span>M5 · Gross Margin %</a>
      <div class="sb-tier-row"><span class="sb-tier-dot" style="background:#0d9488"></span>Tier 2 — Growth Levers<span class="sb-count" style="margin-left:auto">5</span></div>
      <a class="sb-link" href="#metric-m6"><span class="sb-dot" style="background:#0d9488"></span>M6 · CAC by Channel</a>
      <a class="sb-link" href="#metric-m7"><span class="sb-dot" style="background:#7c3aed"></span>M7 · Email Revenue %</a>
      <a class="sb-link" href="#metric-m8"><span class="sb-dot" style="background:#d97706"></span>M8 · AOV Trend MoM</a>
      <a class="sb-link" href="#metric-m9"><span class="sb-dot" style="background:#2563eb"></span>M9 · Checkout Funnel</a>
      <a class="sb-link" href="#metric-m10"><span class="sb-dot" style="background:#e11d48"></span>M10 · Subscription Mix</a>
      <div class="sb-tier-row"><span class="sb-tier-dot" style="background:#7c3aed"></span>Tier 3 — Retention Intel<span class="sb-count" style="margin-left:auto">6</span></div>
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
      <span class="sb-count">5</span>
      {chev()}
    </summary>
    <div class="sb-sec-body">
      <a class="sb-link sb-top" href="#s1"><span class="sb-strat" style="background:#7c3aed">S1</span>Retention Engine<span class="sb-meta">funnel · flow · SQL</span></a>
      <a class="sb-link sb-top" href="#s2"><span class="sb-strat" style="background:#0d9488">S2</span>Channel Efficiency<span class="sb-meta">2 flows · table · SQL</span></a>
      <a class="sb-link sb-top" href="#s3"><span class="sb-strat" style="background:#d97706">S3</span>Geo Expansion<span class="sb-meta">map · decision tree</span></a>
      <a class="sb-link sb-top" href="#s4"><span class="sb-strat" style="background:#e11d48">S4</span>Subscription Flywheel<span class="sb-meta">funnel · 2 flows · SQL</span></a>
      <a class="sb-link sb-top" href="#s5"><span class="sb-strat" style="background:#2563eb">S5</span>Funnel Conversion<span class="sb-meta">funnel · tree · SQL</span></a>
    </div>
  </details>

  <div class="sb-divider"></div>
  <a class="sb-standalone" href="#arch">🏗 &nbsp;Data Architecture<span class="sb-count" style="margin-left:auto">4 stories</span></a>
  <a class="sb-standalone" href="#roadmap">🗓 &nbsp;Roadmap<span class="sb-count" style="margin-left:auto">4 phases</span></a>
</aside>"""

# ── 3. REPLACE EXISTING SIDEBAR ───────────────────────────────────────────────
old = re.search(r'<aside id="sidebar">[\s\S]+?</aside>', html)
if not old:
    print("ERROR: sidebar not found"); exit(1)

html = html[:old.start()] + NEW_SIDEBAR + html[old.end():]

# ── 4. WRITE ──────────────────────────────────────────────────────────────────
HTML.write_text(html, encoding="utf-8")
counts = len(re.findall(r'class="sb-count"', html))
kb     = round(len(html)/1024, 1)
print(f"Done. {counts} count badges. {kb} KB")
