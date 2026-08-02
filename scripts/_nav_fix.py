"""
Navigation fixes:
1. Floating back-to-top button (fixed, bottom-right)
2. Section breadcrumb bar at top of every S1–S5 + arch + roadmap
3. "↑ Back" anchor next to every outbound q-card redirect link
4. JS: back-to-top visibility on scroll
"""
import re, pathlib

HTML = pathlib.Path(r"c:\Users\Archit Tandon\Desktop\knickgasm-dtc-data-engine\reports\strategy.html")
html = HTML.read_text(encoding="utf-8")

# ── 1. CSS ────────────────────────────────────────────────────────────────────
NAV_CSS = """
/* ── BACK TO TOP ── */
#back-top {
  position: fixed; bottom: 28px; right: 28px; z-index: 200;
  width: 42px; height: 42px; border-radius: 50%;
  background: var(--purple); color: #fff;
  display: flex; align-items: center; justify-content: center;
  text-decoration: none; box-shadow: 0 4px 16px rgba(124,58,237,.4);
  opacity: 0; pointer-events: none;
  transition: opacity .2s, transform .2s;
  font-size: 18px; font-weight: 700;
}
#back-top.visible { opacity: 1; pointer-events: auto; }
#back-top:hover   { transform: translateY(-3px); }

/* ── SECTION BREADCRUMB ── */
.sec-breadcrumb {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  padding: 10px 0 20px;
  font-size: .76rem; color: var(--text3);
}
.sec-breadcrumb a {
  color: var(--text2); text-decoration: none; font-weight: 600;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--bg3);
  transition: all .14s;
}
.sec-breadcrumb a:hover { color: var(--purple); border-color: var(--purple); background: var(--purple-light); }
.sec-breadcrumb .crumb-sep { color: var(--text3); font-size: .7rem; }

/* ── Q-CARD BACK LINK ── */
.q-back-link {
  font-size: .74rem; color: var(--text3); text-decoration: none;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: 999px;
  border: 1px dashed var(--border);
  transition: all .14s;
}
.q-back-link:hover { color: var(--text2); border-color: var(--text3); }
"""
html = html.replace("</style>", NAV_CSS + "\n</style>", 1)

# ── 2. FLOATING BACK-TO-TOP BUTTON ───────────────────────────────────────────
BTN = '\n<a id="back-top" href="#" title="Back to top" aria-label="Back to top">↑</a>\n'
html = html.replace("</body>", BTN + "</body>", 1)

# ── 3. JS: back-to-top + close sidebar on nav ─────────────────────────────────
JS_EXTRA = """
// Back to top visibility
window.addEventListener('scroll', function() {
  document.getElementById('back-top').classList.toggle('visible', window.scrollY > 500);
});
"""
html = html.replace("// Back to tip visibility", JS_EXTRA, 1)
# Append to existing script block
html = html.replace(
    "// Active link via IntersectionObserver",
    JS_EXTRA + "\n// Active link via IntersectionObserver",
    1
)

# ── 4. BREADCRUMB at top of each strategy section ────────────────────────────
SECTION_META = {
    "s1": ("Strategy 1",  "Retention Engine",        "var(--purple)"),
    "s2": ("Strategy 2",  "Channel Efficiency",       "var(--teal)"),
    "s3": ("Strategy 3",  "Geo Prioritisation",       "var(--amber)"),
    "s4": ("Strategy 4",  "Subscription Flywheel",    "var(--coral)"),
    "s5": ("Strategy 5",  "Funnel Conversion",        "var(--blue)"),
    "arch":    ("",  "Data Architecture",  "var(--blue)"),
    "roadmap": ("",  "Roadmap",            "var(--amber)"),
}

def breadcrumb(sid, meta):
    label, name, color = meta
    tag = f'<span style="color:{color};font-weight:700">{label}{" — " if label else ""}{name}</span>'
    return f"""
  <div class="sec-breadcrumb">
    <a href="#">↑ Top</a>
    <span class="crumb-sep">›</span>
    <a href="#questions">Key Questions</a>
    <span class="crumb-sep">›</span>
    <a href="#overview">Metrics Framework</a>
    <span class="crumb-sep">›</span>
    {tag}
  </div>"""

for sid, meta in SECTION_META.items():
    # Insert breadcrumb as first child of .container inside the section
    # Pattern: <div class="container strategy-section sN"> or <div class="container">
    if sid in ("arch", "roadmap"):
        pattern = f'(id="{sid}"[^>]*>\\s*<div class="container">)'
    else:
        pattern = f'(id="{sid}"[^>]*>\\s*<div class="container strategy-section {sid}">)'

    crumb = breadcrumb(sid, meta)

    def make_replacer(c):
        def r(m): return m.group(1) + c
        return r

    html = re.sub(pattern, make_replacer(crumb), html, count=1)

# ── 5. ADD "↑ Back" NEXT TO EVERY q-detail-link ──────────────────────────────
# Each q-footer has one or two q-detail-links. Add a "back to questions" pill
# ONCE per footer, after the last link in that footer.
def add_back_to_footer(m):
    footer_html = m.group(0)
    # Only add if not already there
    if "q-back-link" in footer_html:
        return footer_html
    back = '\n      <a class="q-back-link" href="#questions">↑ Questions</a>'
    return footer_html.rstrip("</div>").rstrip() + back + "\n    </div>"

html = re.sub(
    r'<div class="q-footer">[\s\S]+?</div>',
    add_back_to_footer,
    html
)

# ── 6. WRITE ──────────────────────────────────────────────────────────────────
HTML.write_text(html, encoding="utf-8")

crumbs  = len(re.findall(r'class="sec-breadcrumb"', html))
backs   = len(re.findall(r'class="q-back-link"', html))
kb      = round(len(html)/1024, 1)
print(f"Done.  Breadcrumbs: {crumbs}  Back-links: {backs}  Size: {kb} KB")
