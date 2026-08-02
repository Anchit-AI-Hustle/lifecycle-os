"""
Adds 4 SVG flowcharts to strategy.html:
  1. Overview section — Metrics → Threshold Breach → Action decision flow
  2. S1 (Retention Engine) — Win-back email sequence decision ladder
  3. S3 (Geo Expansion) — Market budget allocation decision tree
  4. Roadmap — Phase gate progression diagram
"""
import re, pathlib

HTML = pathlib.Path(r"c:\Users\Archit Tandon\Desktop\knickgasm-dtc-data-engine\reports\strategy.html")
html = HTML.read_text(encoding="utf-8")

# ── Shared CSS ─────────────────────────────────────────────────────────────────
FLOWCHART_CSS = """
/* ── FLOWCHARTS ── */
.fc-wrap {
  margin: 32px 0;
  overflow-x: auto;
  padding-bottom: 4px;
}
.fc-label {
  font-size: .72rem; font-weight: 800; text-transform: uppercase;
  letter-spacing: .1em; color: var(--text3); margin-bottom: 14px;
  display: flex; align-items: center; gap: 8px;
}
.fc-label::before { content: ''; display: block; width: 16px; height: 2px; background: var(--border); }
.fc-wrap svg {
  display: block;
  width: 100%;
  height: auto;
}
"""
html = html.replace("</style>", FLOWCHART_CSS + "\n</style>", 1)


# ── Arrow marker defs (reused across all SVGs) ─────────────────────────────────
def svg_defs(markers):
    """markers = list of (id, fill) pairs"""
    out = ["<defs>"]
    for mid, fill in markers:
        out.append(
            f'<marker id="{mid}" viewBox="0 0 10 10" refX="9" refY="5" '
            f'markerWidth="6" markerHeight="6" orient="auto">'
            f'<path d="M0,1 L9,5 L0,9 Z" fill="{fill}"/></marker>'
        )
    out.append("</defs>")
    return "\n".join(out)


def pill(x, y, w, h, fill, text, text_fill="#fff", fs=12, fw=600):
    cx, cy = x + w // 2, y + h // 2 + 4
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h//2}" fill="{fill}"/>'
        f'<text x="{cx}" y="{cy}" text-anchor="middle" font-size="{fs}" font-weight="{fw}" fill="{text_fill}">{text}</text>'
    )


def box(x, y, w, h, fill, stroke, text_lines, text_fill="#1e293b", fs=11, fw=500, rx=7):
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>']
    n = len(text_lines)
    line_h = 14
    start_y = y + h // 2 - (n - 1) * line_h // 2 + 4
    cx = x + w // 2
    for i, line in enumerate(text_lines):
        out.append(f'<text x="{cx}" y="{start_y + i*line_h}" text-anchor="middle" font-size="{fs}" font-weight="{fw}" fill="{text_fill}">{line}</text>')
    return "\n".join(out)


def diamond(cx, cy, hw, hh, fill, stroke, text_lines, text_fill="#1e293b", fs=10):
    pts = f"{cx},{cy-hh} {cx+hw},{cy} {cx},{cy+hh} {cx-hw},{cy}"
    out = [f'<polygon points="{pts}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>']
    n = len(text_lines)
    line_h = 13
    start_y = cy - (n - 1) * line_h // 2 + 4
    for i, line in enumerate(text_lines):
        out.append(f'<text x="{cx}" y="{start_y + i*line_h}" text-anchor="middle" font-size="{fs}" font-weight="600" fill="{text_fill}">{line}</text>')
    return "\n".join(out)


def arrow(x1, y1, x2, y2, color="#94a3b8", marker="arr-gray", dashed=False):
    dash = ' stroke-dasharray="5,3"' if dashed else ""
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="1.5"{dash} marker-end="url(#{marker})"/>'


def hline(x1, x2, y, color="#94a3b8"):
    return f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{color}" stroke-width="1.5"/>'


def vline(x, y1, y2, color="#94a3b8"):
    return f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y2}" stroke="{color}" stroke-width="1.5"/>'


def label(x, y, text, fill, anchor="middle", fs=10, fw=700):
    return f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{fs}" font-weight="{fw}" fill="{fill}">{text}</text>'


def svg_wrap(content, w, h, title=""):
    font = "font-family=\"'Inter',system-ui,sans-serif\""
    return (
        f'<div class="fc-wrap">\n'
        f'{"<div class=\"fc-label\">" + title + "</div>" if title else ""}'
        f'<svg viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" {font}>\n'
        f'{content}\n'
        f'</svg>\n</div>'
    )


# ══════════════════════════════════════════════════════════════════════════════
# FLOWCHART 1 — Overview: Metrics → Alert → Action decision flow
# ══════════════════════════════════════════════════════════════════════════════
def build_metrics_action_flow():
    W, H = 660, 310
    parts = [svg_defs([("arr-gray","#94a3b8"),("arr-amber","#d97706"),("arr-teal","#0d9488"),("arr-purple","#7c3aed")])]

    # Title row
    parts.append(label(330, 22, "Weekly Review Trigger Protocol", "#475569", fs=11, fw=700))

    # Start pill
    parts.append(pill(215, 34, 230, 36, "#0f172a", "Run Tier 1 Weekly Review", fs=11))

    # Arrow down
    parts.append(arrow(330, 70, 330, 92, "#94a3b8", "arr-gray"))

    # Decision diamond
    parts.append(diamond(330, 118, 88, 32, "#f8fafc", "#475569", ["Any metric", "below target?"], "#334155", fs=10))

    # NO branch — right side
    parts.append(arrow(418, 118, 530, 118, "#16a34a", "arr-gray"))
    parts.append(box(530, 100, 118, 36, "#f0fdf4", "#16a34a", ["All clear — log", "reading + date"], "#166534", fs=10))
    parts.append(label(472, 113, "NO", "#16a34a", fs=9, fw=800))

    # YES branch — down
    parts.append(arrow(330, 150, 330, 172, "#d97706", "arr-amber"))
    parts.append(label(338, 165, "YES", "#d97706", "start", fs=9, fw=800))

    # Three-way branch box
    parts.append(box(200, 172, 260, 36, "#fef3c7", "#d97706", ["Which tier breached?"], "#92400e", fs=11, fw=600))

    # Three fans
    parts.append(hline(110, 550, 222, "#94a3b8"))
    parts.append(vline(110, 208, 228, "#94a3b8"))
    parts.append(vline(330, 208, 228, "#94a3b8"))
    parts.append(vline(550, 208, 228, "#94a3b8"))

    # Three outcome boxes
    # Tier 1 (Revenue/Margin)
    parts.append(box(20, 228, 180, 60, "#fff7ed", "#d97706", ["Tier 1 breach", "→ Check CAC + AOV", "→ Revenue by market"], "#92400e", fs=10, fw=500))
    parts.append(label(110, 224, "Tier 1 — Business", "#d97706", fs=9, fw=800))

    # Tier 2 (Growth)
    parts.append(box(240, 228, 180, 60, "#f0fdfa", "#0d9488", ["Tier 2 breach", "→ Audit email flows", "→ Review channel mix"], "#065f46", fs=10, fw=500))
    parts.append(label(330, 224, "Tier 2 — Growth", "#0d9488", fs=9, fw=800))

    # Tier 3 (Retention)
    parts.append(box(460, 228, 180, 60, "#faf5ff", "#7c3aed", ["Tier 3 breach", "→ Cohort deep-dive", "→ Win-back segment"], "#4c1d95", fs=10, fw=500))
    parts.append(label(550, 224, "Tier 3 — Retention", "#7c3aed", fs=9, fw=800))

    return svg_wrap("\n".join(parts), W, H, "Metrics Review Decision Protocol")


# ══════════════════════════════════════════════════════════════════════════════
# FLOWCHART 2 — S1: Win-back Email Sequence Decision Ladder
# ══════════════════════════════════════════════════════════════════════════════
def build_winback_sequence():
    W, H = 560, 510
    parts = [svg_defs([("arr-gray","#94a3b8"),("arr-purple","#7c3aed"),("arr-green","#16a34a"),("arr-red","#dc2626")])]

    cx = 180  # main flow center-x
    # Start
    parts.append(pill(cx-110, 16, 220, 36, "#7c3aed", "Customer Places First Order", fs=11))

    # Day 0
    parts.append(arrow(cx, 52, cx, 74, "#7c3aed", "arr-purple"))
    parts.append(box(cx-110, 74, 220, 40, "#faf5ff", "#7c3aed", ["Day 0: Post-purchase email", "+ order confirmation"], "#4c1d95", fs=10))
    parts.append(label(cx-125, 98, "D+0", "#7c3aed", "end", fs=9, fw=800))

    # Arrow to Day 30 check
    parts.append(arrow(cx, 114, cx, 136, "#94a3b8", "arr-gray"))

    # Decision: Day 30 repeat purchase?
    parts.append(diamond(cx, 162, 90, 32, "#f8fafc", "#475569", ["Day 30: re-ordered?"], "#334155", fs=10))
    parts.append(label(cx-100, 156, "D+30", "#94a3b8", "end", fs=9, fw=800))

    # YES branch right
    parts.append(arrow(cx+90, 162, cx+200, 162, "#16a34a", "arr-green"))
    parts.append(box(cx+200, 146, 150, 32, "#f0fdf4", "#16a34a", ["Exit to retention flow", "(high-value buyer)"], "#166534", fs=9))
    parts.append(label(cx+130, 156, "YES", "#16a34a", fs=9, fw=800))

    # NO branch down
    parts.append(arrow(cx, 194, cx, 214, "#94a3b8", "arr-gray"))
    parts.append(label(cx+6, 207, "NO", "#dc2626", "start", fs=9, fw=800))

    # Day 45 nudge email
    parts.append(box(cx-110, 214, 220, 40, "#fff7ed", "#d97706", ["Day 45: &#8220;How's your sneaker?&#8221;", "soft re-engagement email"], "#92400e", fs=10))
    parts.append(label(cx-125, 238, "D+45", "#d97706", "end", fs=9, fw=800))

    # Arrow to Day 60 check
    parts.append(arrow(cx, 254, cx, 276, "#94a3b8", "arr-gray"))

    # Decision: Day 60 purchased?
    parts.append(diamond(cx, 302, 90, 32, "#f8fafc", "#475569", ["Day 60: purchased?"], "#334155", fs=10))
    parts.append(label(cx-100, 296, "D+60", "#94a3b8", "end", fs=9, fw=800))

    # YES branch right
    parts.append(arrow(cx+90, 302, cx+200, 302, "#16a34a", "arr-green"))
    parts.append(box(cx+200, 286, 150, 32, "#f0fdf4", "#16a34a", ["Exit — add to loyalty", "nurture sequence"], "#166534", fs=9))
    parts.append(label(cx+130, 296, "YES", "#16a34a", fs=9, fw=800))

    # NO branch down
    parts.append(arrow(cx, 334, cx, 354, "#94a3b8", "arr-gray"))
    parts.append(label(cx+6, 347, "NO", "#dc2626", "start", fs=9, fw=800))

    # Day 74 win-back with offer
    parts.append(box(cx-110, 354, 220, 42, "#fff1f2", "#e11d48", ["Day 74: Win-back + offer", "(CLV &gt; $200 → 15% off)"], "#9f1239", fs=10))
    parts.append(label(cx-125, 380, "D+74", "#e11d48", "end", fs=9, fw=800))

    # Arrow to final decision
    parts.append(arrow(cx, 396, cx, 416, "#94a3b8", "arr-gray"))

    # Decision: responded?
    parts.append(diamond(cx, 440, 90, 32, "#f8fafc", "#475569", ["Responded?"], "#334155", fs=10))

    # YES branch right
    parts.append(arrow(cx+90, 440, cx+200, 440, "#16a34a", "arr-green"))
    parts.append(box(cx+200, 424, 140, 32, "#f0fdf4", "#16a34a", ["Re-activated —", "monitor 90d"], "#166534", fs=9))
    parts.append(label(cx+130, 434, "YES", "#16a34a", fs=9, fw=800))

    # NO branch down
    parts.append(arrow(cx, 472, cx, 490, "#94a3b8", "arr-gray"))
    parts.append(label(cx+6, 485, "NO", "#dc2626", "start", fs=9, fw=800))
    parts.append(pill(cx-90, 490, 180, 32, "#1e293b", "Lapsed — CLV scored in Klaviyo", "#94a3b8", fs=10))

    return svg_wrap("\n".join(parts), W, H, "Customer Win-Back Email Sequence")


# ══════════════════════════════════════════════════════════════════════════════
# FLOWCHART 3 — S3: Geo Market Budget Allocation Decision Tree
# ══════════════════════════════════════════════════════════════════════════════
def build_geo_decision_tree():
    W, H = 660, 340

    # Column centers
    cx_us, cx_uk, cx_in = 110, 330, 550

    parts = [svg_defs([("arr-gray","#94a3b8"),("arr-amber","#d97706"),("arr-teal","#0d9488"),("arr-purple","#7c3aed")])]

    # Start pill
    parts.append(pill(195, 14, 270, 36, "#0f172a", "Quarterly LTV by Market Pull", fs=11))

    # Fan connector
    parts.append(vline(330, 50, 68, "#94a3b8"))
    parts.append(hline(cx_us, cx_in, 68, "#94a3b8"))
    for cx in [cx_us, cx_uk, cx_in]:
        parts.append(vline(cx, 68, 84, "#94a3b8"))

    # Market header boxes
    parts.append(box(cx_us-80, 84, 160, 34, "#d97706", "#b45309", ["US  — Primary"], "#fff", fs=11, fw=700, rx=6))
    parts.append(box(cx_uk-80, 84, 160, 34, "#0d9488", "#0f766e", ["UK  — Retain"], "#fff", fs=11, fw=700, rx=6))
    parts.append(box(cx_in-80, 84, 160, 34, "#7c3aed", "#5b21b6", ["IN  — Organic"], "#fff", fs=11, fw=700, rx=6))

    # Lines from market boxes to decisions
    for cx in [cx_us, cx_uk, cx_in]:
        parts.append(vline(cx, 118, 134, "#94a3b8"))

    # Decision diamonds
    parts.append(diamond(cx_us, 160, 78, 30, "#fef3c7", "#d97706", ["LTV:CAC", "> 3 : 1 ?"], "#92400e", fs=10))
    parts.append(diamond(cx_uk, 160, 78, 30, "#ccfbf1", "#0d9488", ["LTV:CAC", "> 2.5 : 1 ?"], "#065f46", fs=10))
    parts.append(diamond(cx_in, 160, 78, 30, "#ede9fe", "#7c3aed", ["Paid spend", "relevant?"], "#4c1d95", fs=10))

    # Branch lines and outcome boxes
    def branches(cx, col, yes_lines, no_lines, yes_fill, yes_stroke, no_fill, no_stroke, yc="#166534", nc="#991b1b"):
        xyes = cx - 50
        xno  = cx + 50
        # angled lines
        out = []
        out.append(f'<line x1="{cx}" y1="190" x2="{xyes}" y2="214" stroke="#94a3b8" stroke-width="1.5"/>')
        out.append(f'<line x1="{cx}" y1="190" x2="{xno}"  y2="214" stroke="#94a3b8" stroke-width="1.5"/>')
        out.append(label(xyes-4, 208, "YES", "#16a34a", "end", fs=9, fw=800))
        out.append(label(xno+4,  208, "NO",  "#dc2626", "start", fs=9, fw=800))
        # YES box
        out.append(box(cx-102, 214, 96, 54, yes_fill, yes_stroke, yes_lines, yc, fs=10, fw=500, rx=6))
        # NO box
        out.append(box(cx+6,   214, 96, 54, no_fill,  no_stroke,  no_lines,  nc, fs=10, fw=500, rx=6))
        return "\n".join(out)

    parts.append(branches(cx_us,
        "us",
        ["Scale paid","+ sub conv."], ["Pause: audit","CAC ceiling"],
        "#f0fdf4","#16a34a","#fef2f2","#dc2626"))

    parts.append(branches(cx_uk,
        "uk",
        ["Retain: email-","first strategy"], ["Reduce paid;","retention only"],
        "#f0fdf4","#16a34a","#fef2f2","#dc2626"))

    parts.append(branches(cx_in,
        "in",
        ["SEO + organic","social only"], ["Gifting +","corporate"],
        "#f0fdf4","#16a34a","#f5f3ff","#7c3aed", "#166534", "#4c1d95"))

    # Bottom convergence
    parts.append(hline(20, 640, 282, "#e2e8f0"))
    parts.append(vline(330, 282, 298, "#94a3b8"))
    parts.append(pill(195, 298, 270, 32, "#d97706", "Reallocate quarterly marketing budget", "#fff", fs=10))

    return svg_wrap("\n".join(parts), W, H, "Market Budget Allocation Decision Tree")


# ══════════════════════════════════════════════════════════════════════════════
# FLOWCHART 4 — Roadmap: Phase Gate Progression
# ══════════════════════════════════════════════════════════════════════════════
def build_phase_gate():
    W, H = 660, 180

    parts = [svg_defs([("arr-amber","#d97706")])]

    phases = [
        ("Week 1",    "Foundation",         "First data in",        "#d97706", "#fef3c7"),
        ("Wk 2–3",    "Full Coverage",      "All 4 sources + M15",  "#0d9488", "#ccfbf1"),
        ("Month 2",   "Automate",           "Dashboards + flows",   "#7c3aed", "#ede9fe"),
        ("Month 3+",  "Intelligence",       "Predict · Alert · Act","#2563eb", "#dbeafe"),
    ]

    phase_w = 148
    gap     = 16
    x_start = 10

    for i, (period, title, sub, color, light) in enumerate(phases):
        x = x_start + i * (phase_w + gap)
        cx_ph = x + phase_w // 2

        # Phase box
        parts.append(f'<rect x="{x}" y="30" width="{phase_w}" height="108" rx="10" fill="{light}" stroke="{color}" stroke-width="2"/>')

        # Phase number circle
        parts.append(f'<circle cx="{cx_ph}" cy="56" r="16" fill="{color}"/>')
        parts.append(f'<text x="{cx_ph}" y="61" text-anchor="middle" font-size="13" font-weight="800" fill="#fff">{i+1}</text>')

        # Period label
        parts.append(f'<text x="{cx_ph}" y="88" text-anchor="middle" font-size="10" font-weight="700" fill="{color}">{period}</text>')

        # Title
        parts.append(f'<text x="{cx_ph}" y="106" text-anchor="middle" font-size="11" font-weight="700" fill="#1e293b">{title}</text>')

        # Sub
        parts.append(f'<text x="{cx_ph}" y="122" text-anchor="middle" font-size="10" font-weight="400" fill="#64748b">{sub}</text>')

        # GATE checkmark at bottom
        parts.append(f'<text x="{cx_ph}" y="142" text-anchor="middle" font-size="9" font-weight="700" fill="{color}">GATE {i+1} ✓</text>')

        # Arrow to next phase
        if i < len(phases) - 1:
            ax = x + phase_w + 2
            parts.append(f'<line x1="{ax}" y1="84" x2="{ax+gap-4}" y2="84" stroke="{color}" stroke-width="2" marker-end="url(#arr-amber)"/>')

    # Timeline baseline
    parts.append(f'<line x1="{x_start+phase_w//2}" y1="162" x2="{x_start + 3*(phase_w+gap)+phase_w//2}" y2="162" stroke="#e2e8f0" stroke-width="1.5" stroke-dasharray="4,3"/>')
    parts.append(f'<text x="{x_start+phase_w//2}" y="175" text-anchor="middle" font-size="9" fill="#94a3b8">Start</text>')
    parts.append(f'<text x="{x_start + 3*(phase_w+gap)+phase_w//2}" y="175" text-anchor="middle" font-size="9" fill="#94a3b8">Month 3+</text>')

    return svg_wrap("\n".join(parts), W, H, "Implementation Phase Gate Progression")


# ══════════════════════════════════════════════════════════════════════════════
# INJECTION
# ══════════════════════════════════════════════════════════════════════════════

fc1 = build_metrics_action_flow()
fc2 = build_winback_sequence()
fc3 = build_geo_decision_tree()
fc4 = build_phase_gate()

# 1. Overview — insert after the pyramid div (before m-accordion)
html = html.replace(
    '<div class="m-accordion">',
    fc1 + '\n\n<div class="m-accordion">',
    1
)

# 2. S1 win-back — insert after the Customer Lifecycle funnel-story div
#    (before the sql-block in s1 section)
html = html.replace(
    '<div class="sql-block">\n    <h5>Key DuckDB Query — Retention</h5>',
    fc2 + '\n\n  <div class="sql-block">\n    <h5>Key DuckDB Query — Retention</h5>',
    1
)

# 3. S3 geo tree — insert before the existing "Quarterly Geo Reallocation Workflow" h4
html = html.replace(
    '<h4 style="font-size:.85rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text2);margin-bottom:14px">Quarterly Geo Reallocation Workflow</h4>',
    fc3 + '\n\n  <h4 style="font-size:.85rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text2);margin-bottom:14px">Quarterly Geo Reallocation Workflow</h4>',
    1
)

# 4. Roadmap phase gate — insert before the timeline div
html = html.replace(
    '<div class="timeline">',
    fc4 + '\n\n  <div class="timeline">',
    1
)

HTML.write_text(html, encoding="utf-8")

fc_count = html.count('class="fc-wrap"')
print(f"Done. {fc_count} flowcharts injected. {round(len(html)/1024,1)} KB")
