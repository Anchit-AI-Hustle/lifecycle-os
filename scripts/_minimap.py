"""
Adds a VS Code-style minimap to the right edge of the sidebar.

A thin vertical strip (6 px wide) shows the entire page as proportionally-sized
coloured segments — one per major section. A semi-transparent "viewport box"
slides along the strip in real-time as you scroll, showing exactly where you are.

Layout: strip sits at the right edge of the fixed sidebar (left: 242px),
height = 100vh - 56px (matches sidebar height).
"""
import re, pathlib

HTML = pathlib.Path(r"c:\Users\Archit Tandon\Desktop\knickgasm-dtc-data-engine\reports\strategy.html")
html = HTML.read_text(encoding="utf-8")

# ── 1. CSS ─────────────────────────────────────────────────────────────────────
MINIMAP_CSS = """
/* ── SIDEBAR MINIMAP ── */
#sb-minimap {
  position: fixed;
  left: 242px;
  top: 56px;
  width: 6px;
  height: calc(100vh - 56px);
  z-index: 51;
  background: var(--bg3);
  border-right: 1px solid var(--border);
  overflow: hidden;
  cursor: pointer;
}
.mm-seg {
  width: 100%;
  opacity: .7;
  transition: opacity .12s;
}
#sb-minimap:hover .mm-seg { opacity: .9; }
#mm-viewport {
  position: absolute;
  left: 0; right: 0;
  background: rgba(255,255,255,.35);
  border-top: 1px solid rgba(255,255,255,.7);
  border-bottom: 1px solid rgba(255,255,255,.7);
  pointer-events: none;
  transition: top .08s linear;
}
@media (prefers-color-scheme: dark) {
  #mm-viewport {
    background: rgba(255,255,255,.15);
    border-color: rgba(255,255,255,.4);
  }
}
@media (max-width: 960px) {
  #sb-minimap { display: none; }
}
"""
html = html.replace("</style>", MINIMAP_CSS + "\n</style>", 1)

# ── 2. HTML: minimap strip injected just before </body> ──────────────────────
MINIMAP_HTML = """
<div id="sb-minimap">
  <div id="mm-viewport"></div>
</div>
"""

# ── 3. JS: build segments + track scroll ─────────────────────────────────────
MINIMAP_JS = """
<script>
(function() {
  // Section definitions: [id, hex colour]
  var SECTIONS = [
    ['hero',      '#818cf8'],
    ['questions', '#7c3aed'],
    ['overview',  '#d97706'],
    ['metric-m1', '#d97706'],
    ['s1',        '#7c3aed'],
    ['s2',        '#0d9488'],
    ['s3',        '#d97706'],
    ['s4',        '#e11d48'],
    ['s5',        '#2563eb'],
    ['arch',      '#2563eb'],
    ['roadmap',   '#d97706'],
  ];

  function buildMinimap() {
    var map = document.getElementById('sb-minimap');
    if (!map) return;

    var totalH = document.body.scrollHeight;

    // Measure each section's top + height
    var segs = [];
    for (var i = 0; i < SECTIONS.length; i++) {
      var id = SECTIONS[i][0], color = SECTIONS[i][1];
      var el = document.getElementById(id);
      if (!el) continue;
      var top = el.getBoundingClientRect().top + window.scrollY;
      segs.push({ top: top, color: color, id: id });
    }

    // Sort by vertical position
    segs.sort(function(a,b){ return a.top - b.top; });

    // Remove old segments (keep #mm-viewport)
    var old = map.querySelectorAll('.mm-seg');
    old.forEach(function(n){ n.remove(); });

    var vp = document.getElementById('mm-viewport');

    // Build proportional segments between sections
    var mapH = map.offsetHeight;
    for (var j = 0; j < segs.length; j++) {
      var segTop = segs[j].top;
      var segBot = j + 1 < segs.length ? segs[j+1].top : totalH;
      var pct = ((segBot - segTop) / totalH) * 100;

      var div = document.createElement('div');
      div.className = 'mm-seg';
      div.style.height = pct + '%';
      div.style.background = segs[j].color;
      div.dataset.targetId = segs[j].id;

      // Click to scroll to section
      (function(sid) {
        div.addEventListener('click', function() {
          var target = document.getElementById(sid);
          if (target) target.scrollIntoView({ behavior: 'smooth' });
        });
      })(segs[j].id);

      map.insertBefore(div, vp);
    }

    updateViewport();
  }

  function updateViewport() {
    var map = document.getElementById('sb-minimap');
    var vp  = document.getElementById('mm-viewport');
    if (!map || !vp) return;

    var totalH  = document.body.scrollHeight;
    var viewH   = window.innerHeight;
    var scrollY = window.scrollY;
    var mapH    = map.offsetHeight;

    var vpH  = Math.max(8, (viewH  / totalH) * mapH);
    var vpTop = (scrollY / totalH) * mapH;

    vp.style.height = vpH + 'px';
    vp.style.top    = vpTop + 'px';
  }

  // Click on minimap track to scroll proportionally
  document.addEventListener('DOMContentLoaded', function() {
    buildMinimap();

    var map = document.getElementById('sb-minimap');
    if (map) {
      map.addEventListener('click', function(e) {
        if (e.target.classList.contains('mm-seg')) return; // handled by seg
        var rect   = map.getBoundingClientRect();
        var ratio  = (e.clientY - rect.top) / rect.height;
        window.scrollTo({ top: ratio * document.body.scrollHeight, behavior: 'smooth' });
      });
    }

    window.addEventListener('scroll', updateViewport, { passive: true });
    window.addEventListener('resize', buildMinimap,   { passive: true });
  });
})();
</script>
"""

html = html.replace("</body>", MINIMAP_HTML + MINIMAP_JS + "\n</body>", 1)

HTML.write_text(html, encoding="utf-8")
print(f"Done. Minimap added. {round(len(html)/1024,1)} KB")
