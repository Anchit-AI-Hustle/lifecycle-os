"""
1. Fully rebuilds the #arch section as a 4-story narrative
2. Adds a CSS funnel visualization to each strategy section (S1-S5)
3. Injects all required CSS
"""
import re, pathlib

HTML = pathlib.Path(r"c:\Users\Archit Tandon\Desktop\knickgasm-dtc-data-engine\reports\strategy.html")
html = HTML.read_text(encoding="utf-8")

# ══════════════════════════════════════════════════════════════════════════════
# 1. CSS
# ══════════════════════════════════════════════════════════════════════════════
NEW_CSS = """
/* ── STORY SECTION HEADER ── */
.story-num {
  display:inline-flex; align-items:center; justify-content:center;
  width:28px; height:28px; border-radius:50%;
  font-size:.72rem; font-weight:800; color:#fff; flex-shrink:0;
}
.story-hdr {
  display:flex; align-items:center; gap:12px;
  margin:48px 0 20px;
}
.story-hdr h3 { font-size:1.1rem; font-weight:800; }
.story-sub { font-size:.85rem; color:var(--text2); margin:-12px 0 20px; max-width:680px; line-height:1.6; }

/* ── PIPELINE (Story 1) ── */
.pipeline { display:flex; flex-direction:column; gap:0; margin:0 0 8px; }
.pl-row {
  display:grid;
  grid-template-columns: 200px 40px 180px 40px 180px 40px 1fr;
  align-items:center; gap:0; margin-bottom:8px;
}
.pl-source {
  padding:12px 14px; border-radius:10px; border:1px solid var(--border);
  background:var(--bg2);
}
.pl-source-name { font-size:.82rem; font-weight:700; margin-bottom:2px; }
.pl-source-sub  { font-size:.7rem;  color:var(--text3); }
.pl-arrow {
  text-align:center; font-size:1rem; color:var(--text3); padding:0 4px;
}
.pl-ingest {
  padding:10px 12px; border-radius:8px; border:1px dashed var(--border);
  font-size:.72rem; color:var(--text2); text-align:center; line-height:1.4;
}
.pl-schema {
  padding:12px 14px; border-radius:10px; border-left:3px solid;
  background:var(--bg3);
}
.pl-schema-name { font-size:.8rem; font-weight:800; margin-bottom:4px; }
.pl-schema-count { font-size:.68rem; color:var(--text3); margin-bottom:6px; }
.pl-schema-tables { font-size:.68rem; color:var(--text2); line-height:1.5; }
.pl-output {
  padding:10px 12px; border-radius:8px; border:1px solid var(--border);
  background:var(--bg2); font-size:.72rem; line-height:1.5; color:var(--text2);
}
.pl-connector {
  display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:4px;
  grid-column:1/-1; padding:8px 0;
  font-size:.72rem; color:var(--text3);
}
.pl-connector-line {
  width:2px; height:20px; background:var(--border);
}
.pl-db-box {
  grid-column:3/6;
  background:linear-gradient(135deg,#1e1b4b,#312e81);
  color:#fff; border-radius:12px; padding:16px 20px; text-align:center;
}
.pl-db-box .db-label { font-size:.68rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#818cf8; margin-bottom:4px; }
.pl-db-box .db-name  { font-size:1rem; font-weight:800; margin-bottom:2px; }
.pl-db-box .db-sub   { font-size:.72rem; color:#94a3b8; }
.pl-output-row {
  grid-column:1/-1; display:grid;
  grid-template-columns:repeat(3,1fr); gap:10px; margin-top:4px;
}
.pl-out-card {
  border-radius:10px; border:1px solid var(--border); background:var(--bg2);
  padding:14px; text-align:center;
}
.pl-out-card .out-icon { font-size:1.4rem; margin-bottom:6px; }
.pl-out-card .out-name { font-size:.82rem; font-weight:700; margin-bottom:4px; }
.pl-out-card .out-desc { font-size:.72rem; color:var(--text2); line-height:1.4; }

/* ── SCHEMA CARDS (Story 2) ── */
.schema-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:16px; }
.schema-card {
  border-radius:12px; border:1px solid var(--border); background:var(--bg);
  overflow:hidden;
}
.schema-card-hdr {
  padding:14px 16px; display:flex; align-items:flex-start; gap:10px;
}
.schema-badge {
  font-size:.68rem; font-weight:800; letter-spacing:.08em;
  text-transform:uppercase; color:#fff; padding:3px 8px; border-radius:4px;
  flex-shrink:0;
}
.schema-purpose { font-size:.8rem; color:var(--text2); line-height:1.45; flex:1; }
.schema-card-body { padding:0 16px 16px; }
.schema-section-lbl {
  font-size:.62rem; font-weight:800; letter-spacing:.1em;
  text-transform:uppercase; color:var(--text3); margin:10px 0 5px;
}
.schema-table-list {
  display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px;
}
.schema-tbl {
  font-size:.68rem; background:var(--bg3); border:1px solid var(--border);
  border-radius:4px; padding:2px 7px; color:var(--text2); font-family:monospace;
}
.schema-powers { display:flex; flex-wrap:wrap; gap:4px; }
.schema-power-pill {
  font-size:.65rem; font-weight:600; padding:2px 8px;
  border-radius:999px; border:1px solid; color:inherit;
}

/* ── JOIN CARDS (Story 3) ── */
.join-card {
  border-radius:12px; border:1px solid var(--border); background:var(--bg2);
  padding:20px; margin-bottom:14px;
}
.join-visual {
  display:flex; align-items:center; gap:8px;
  margin-bottom:14px; flex-wrap:wrap;
}
.join-tbl {
  padding:8px 14px; border-radius:8px;
  font-size:.8rem; font-weight:700; font-family:monospace;
  border:1px solid var(--border);
}
.join-op {
  font-size:.7rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase;
  color:var(--text3); padding:0 4px;
}
.join-key {
  font-size:.7rem; color:var(--text3); font-family:monospace;
  padding:4px 8px; background:var(--bg3); border-radius:4px;
}
.join-plain {
  background:var(--bg3); border-radius:8px; padding:12px 14px;
  font-size:.82rem; color:var(--text); line-height:1.6; margin-bottom:12px;
  border-left:3px solid var(--blue);
}
.join-enables {
  display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  font-size:.72rem; color:var(--text3);
}
.join-num {
  display:inline-flex; align-items:center; justify-content:center;
  width:24px; height:24px; border-radius:50%; background:var(--blue);
  color:#fff; font-size:.7rem; font-weight:800; flex-shrink:0;
}

/* ── VIEWS (Story 4) ── */
.view-card {
  border-radius:12px; border:1px solid var(--border); background:var(--bg2);
  overflow:hidden; margin-bottom:14px;
}
.view-card-hdr {
  display:flex; align-items:center; gap:12px; padding:14px 18px;
  border-bottom:1px solid var(--border); background:var(--bg3);
}
.view-name { font-size:.88rem; font-weight:800; font-family:monospace; }
.view-desc { font-size:.78rem; color:var(--text2); flex:1; }
.view-card-body { padding:0; }
.view-cols {
  display:grid; grid-template-columns:1fr 1fr;
  gap:1px; background:var(--border);
}
@media(max-width:600px){ .view-cols { grid-template-columns:1fr; } }
.view-col { background:var(--bg2); padding:14px 18px; }
.view-col-lbl {
  font-size:.64rem; font-weight:800; letter-spacing:.1em;
  text-transform:uppercase; color:var(--text3); margin-bottom:8px;
}
.view-field {
  display:flex; align-items:center; gap:8px; padding:4px 0;
  border-bottom:1px solid var(--border); font-size:.78rem;
}
.view-field:last-child { border-bottom:none; }
.vf-name { font-family:monospace; color:var(--text); flex:1; }
.vf-type { font-size:.68rem; color:var(--text3); flex-shrink:0; }
.vf-desc { font-size:.72rem; color:var(--text2); }

/* ── FUNNEL VISUALIZATION ── */
.funnel-story {
  background:var(--bg2); border:1px solid var(--border);
  border-radius:14px; overflow:hidden; margin:24px 0;
}
.funnel-story-hdr {
  padding:14px 20px; border-bottom:1px solid var(--border);
  display:flex; align-items:center; gap:10px; background:var(--bg3);
}
.funnel-story-title { font-size:.88rem; font-weight:800; }
.funnel-story-sub   { font-size:.75rem; color:var(--text2); flex:1; }
.funnel-body        { padding:20px 24px 24px; }
.funnel-stage       { display:flex; align-items:center; gap:12px; margin-bottom:4px; }
.funnel-stage-label {
  min-width:200px; font-size:.78rem; color:var(--text2); line-height:1.3;
  flex-shrink:0;
}
.funnel-bar-track { flex:1; position:relative; height:40px; }
.funnel-bar {
  height:40px; border-radius:6px;
  display:flex; align-items:center; padding:0 14px;
  font-size:.78rem; font-weight:700; color:#fff; white-space:nowrap;
  position:relative;
}
.funnel-right {
  min-width:120px; text-align:right;
  font-size:.75rem; color:var(--text2);
  flex-shrink:0;
}
.funnel-drop {
  padding:2px 0 6px 212px;
  font-size:.71rem; color:var(--coral);
  display:flex; align-items:center; gap:5px;
}
.funnel-drop::before { content:'↓'; }
.funnel-total-bar {
  height:6px; border-radius:3px; background:var(--border); margin:16px 0 4px;
}
.ph {
  background:#fef9c3; color:#854d0e;
  border:1.5px dashed #ca8a04; border-radius:4px;
  padding:1px 5px; font-size:.78rem; font-weight:600;
}
"""

html = html.replace("</style>", NEW_CSS + "\n</style>", 1)


# ══════════════════════════════════════════════════════════════════════════════
# 2. REBUILD #arch SECTION CONTENT
# ══════════════════════════════════════════════════════════════════════════════
NEW_ARCH = """
  <div class="section-label" style="color:var(--blue)">Data Architecture</div>
  <h2 class="section-title">How the Data Flows — Story by Story</h2>
  <p class="section-sub">Four sources, one database, fifteen metrics. Every number in this document traces back to a specific table, a specific join, a specific SQL block. This section makes that path visible.</p>

  <!-- ─── STORY 1: THE FLOW ─────────────────────────────────────────── -->
  <div class="story-hdr">
    <span class="story-num" style="background:var(--blue)">1</span>
    <h3>The Flow — where data comes from, where it lands, what it produces</h3>
  </div>
  <p class="story-sub">Everything begins as a CSV export. Every number you act on begins here.</p>

  <div style="overflow-x:auto;padding-bottom:8px">
  <div style="min-width:720px">

  <!-- Source → Schema rows -->
  <div style="display:grid;grid-template-columns:1fr 32px 1fr 32px 1fr;gap:0;align-items:stretch;margin-bottom:24px">

    <!-- SOURCES -->
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="font-size:.65rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin-bottom:4px">Data Sources</div>
      <div class="pl-source" style="border-left:3px solid #d97706">
        <div class="pl-source-name">📦 Matrixify</div>
        <div class="pl-source-sub">Shopify raw export app</div>
        <div style="margin-top:6px;font-size:.68rem;color:var(--text3)">orders.csv, customers.csv, products.csv, order_line_items.csv…</div>
      </div>
      <div class="pl-source" style="border-left:3px solid #16a34a">
        <div class="pl-source-name">📊 Shopify Analytics</div>
        <div class="pl-source-sub">Pre-aggregated reports</div>
        <div style="margin-top:6px;font-size:.68rem;color:var(--text3)">revenue_metrics.csv, acquisition_metrics.csv, marketing_attribution.csv…</div>
      </div>
      <div class="pl-source" style="border-left:3px solid #7c3aed">
        <div class="pl-source-name">✉️ Klaviyo</div>
        <div class="pl-source-sub">Email + SMS CDP</div>
        <div style="margin-top:6px;font-size:.68rem;color:var(--text3)">profiles.csv, campaigns.csv, flows.csv, events.json…</div>
      </div>
      <div class="pl-source" style="border-left:3px solid #2563eb">
        <div class="pl-source-name">📱 WebEngage</div>
        <div class="pl-source-sub">Behavioural event stream</div>
        <div style="margin-top:6px;font-size:.68rem;color:var(--text3)">events.csv, user_profiles.csv, revenue_mapping.csv…</div>
      </div>
    </div>

    <!-- ARROW + INGEST -->
    <div style="display:flex;align-items:center;justify-content:center;font-size:.9rem;color:var(--text3)">→</div>

    <!-- SCHEMAS inside DuckDB -->
    <div style="display:flex;flex-direction:column;gap:0;background:linear-gradient(160deg,#1e1b4b 0%,#312e81 100%);border-radius:14px;padding:16px;color:#fff">
      <div style="font-size:.65rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#818cf8;margin-bottom:10px;text-align:center">knickgasm_dtc.duckdb</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.08);border-left:3px solid #d97706">
          <div style="font-size:.78rem;font-weight:700;margin-bottom:2px">matrixify</div>
          <div style="font-size:.68rem;color:#94a3b8">20 tables · raw transactional data</div>
        </div>
        <div style="padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.08);border-left:3px solid #16a34a">
          <div style="font-size:.78rem;font-weight:700;margin-bottom:2px">shopify_analytics</div>
          <div style="font-size:.68rem;color:#94a3b8">13 tables · aggregated channel &amp; revenue reports</div>
        </div>
        <div style="padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.08);border-left:3px solid #7c3aed">
          <div style="font-size:.78rem;font-weight:700;margin-bottom:2px">klaviyo</div>
          <div style="font-size:.68rem;color:#94a3b8">9 tables · email profiles, campaigns, churn predictions</div>
        </div>
        <div style="padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.08);border-left:3px solid #2563eb">
          <div style="font-size:.78rem;font-weight:700;margin-bottom:2px">webengage</div>
          <div style="font-size:.68rem;color:#94a3b8">4 tables · behavioural events + funnel summaries</div>
        </div>
      </div>
      <div style="text-align:center;margin-top:10px;font-size:.65rem;color:#818cf8">python run_all.py → upsert + dedup on every run</div>
    </div>

    <!-- ARROW -->
    <div style="display:flex;align-items:center;justify-content:center;font-size:.9rem;color:var(--text3)">→</div>

    <!-- OUTPUTS -->
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="font-size:.65rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin-bottom:4px">What It Produces</div>
      <div class="pl-out-card">
        <div class="out-icon">📐</div>
        <div class="out-name">15 Metric Queries</div>
        <div class="out-desc">queries/metrics.sql — M1 through M15 + BONUS. Run once against real data to fill every placeholder in this document.</div>
      </div>
      <div class="pl-out-card">
        <div class="out-icon">🗺</div>
        <div class="out-name">5 Growth Strategies</div>
        <div class="out-desc">Each strategy in this document maps to specific metric outputs — retention, channel, geo, subscription, funnel.</div>
      </div>
      <div class="pl-out-card">
        <div class="out-icon">⚡</div>
        <div class="out-name">6 Cross-Source Signals</div>
        <div class="out-desc">Metrics that require joining across schemas — LTV:CAC, at-risk revenue, email revenue %, SKU subscription gap.</div>
      </div>
    </div>
  </div>
  </div><!-- min-width -->
  </div><!-- overflow-x -->

  <!-- ─── STORY 2: FOUR SCHEMAS ─────────────────────────────────────── -->
  <div class="story-hdr">
    <span class="story-num" style="background:var(--amber)">2</span>
    <h3>The Four Schemas — purpose, key tables, what each one powers</h3>
  </div>
  <p class="story-sub">Each schema is a world with a specific job. Understanding the job determines which schema to query first.</p>

  <div class="schema-grid">

    <div class="schema-card">
      <div class="schema-card-hdr" style="border-bottom:3px solid #d97706">
        <div>
          <span class="schema-badge" style="background:#d97706">matrixify</span>
          <div class="schema-purpose" style="margin-top:8px">The source of truth for every customer transaction. Every order, every line item, every product and variant lives here as Shopify exported it.</div>
        </div>
      </div>
      <div class="schema-card-body">
        <div class="schema-section-lbl">Key Tables</div>
        <div class="schema-table-list">
          <span class="schema-tbl">orders</span><span class="schema-tbl">order_line_items</span>
          <span class="schema-tbl">customers</span><span class="schema-tbl">products</span>
          <span class="schema-tbl">product_variants</span><span class="schema-tbl">refunds</span>
        </div>
        <div class="schema-section-lbl">Powers</div>
        <div class="schema-powers">
          <span class="schema-power-pill" style="color:#d97706;border-color:#d97706;background:var(--amber-light)">M1–M5 · M8 · M10–M15</span>
          <span class="schema-power-pill" style="color:#d97706;border-color:#d97706;background:var(--amber-light)">Cohort retention</span>
          <span class="schema-power-pill" style="color:#d97706;border-color:#d97706;background:var(--amber-light)">LTV by market</span>
        </div>
      </div>
    </div>

    <div class="schema-card">
      <div class="schema-card-hdr" style="border-bottom:3px solid #16a34a">
        <div>
          <span class="schema-badge" style="background:#16a34a">shopify_analytics</span>
          <div class="schema-purpose" style="margin-top:8px">Pre-aggregated Shopify reports. Where matrixify is rows, shopify_analytics is summaries — daily revenue, sessions, channel attribution already rolled up.</div>
        </div>
      </div>
      <div class="schema-card-body">
        <div class="schema-section-lbl">Key Tables</div>
        <div class="schema-table-list">
          <span class="schema-tbl">revenue_metrics</span>
          <span class="schema-tbl">acquisition_metrics</span>
          <span class="schema-tbl">marketing_attribution</span>
          <span class="schema-tbl">channel_performance</span>
        </div>
        <div class="schema-section-lbl">Powers</div>
        <div class="schema-powers">
          <span class="schema-power-pill" style="color:#16a34a;border-color:#16a34a;background:var(--teal-light)">M3 LTV:CAC</span>
          <span class="schema-power-pill" style="color:#16a34a;border-color:#16a34a;background:var(--teal-light)">M6 CAC by channel</span>
          <span class="schema-power-pill" style="color:#16a34a;border-color:#16a34a;background:var(--teal-light)">M7 Email revenue %</span>
        </div>
      </div>
    </div>

    <div class="schema-card">
      <div class="schema-card-hdr" style="border-bottom:3px solid #7c3aed">
        <div>
          <span class="schema-badge" style="background:#7c3aed">klaviyo</span>
          <div class="schema-purpose" style="margin-top:8px">The CDP layer. Klaviyo knows the future that Shopify can't see — churn risk scores, predicted CLV, and which email flow influenced which order.</div>
        </div>
      </div>
      <div class="schema-card-body">
        <div class="schema-section-lbl">Key Tables</div>
        <div class="schema-table-list">
          <span class="schema-tbl">profiles</span>
          <span class="schema-tbl">campaigns</span>
          <span class="schema-tbl">flows</span>
          <span class="schema-tbl">events</span>
          <span class="schema-tbl">deliverability_metrics</span>
        </div>
        <div class="schema-section-lbl">Powers</div>
        <div class="schema-powers">
          <span class="schema-power-pill" style="color:#7c3aed;border-color:#7c3aed;background:var(--purple-light)">M7 Email %</span>
          <span class="schema-power-pill" style="color:#7c3aed;border-color:#7c3aed;background:var(--purple-light)">M13 Churn risk</span>
          <span class="schema-power-pill" style="color:#7c3aed;border-color:#7c3aed;background:var(--purple-light)">M14 At-risk revenue</span>
        </div>
      </div>
    </div>

    <div class="schema-card">
      <div class="schema-card-hdr" style="border-bottom:3px solid #2563eb">
        <div>
          <span class="schema-badge" style="background:#2563eb">webengage</span>
          <div class="schema-purpose" style="margin-top:8px">The event layer. Every product view, cart add, checkout start, and order is a timestamped event. This schema turns the storefront into a funnel.</div>
        </div>
      </div>
      <div class="schema-card-body">
        <div class="schema-section-lbl">Key Tables</div>
        <div class="schema-table-list">
          <span class="schema-tbl">events</span>
          <span class="schema-tbl">event_summary</span>
          <span class="schema-tbl">user_profiles</span>
          <span class="schema-tbl">revenue_mapping</span>
        </div>
        <div class="schema-section-lbl">Powers</div>
        <div class="schema-powers">
          <span class="schema-power-pill" style="color:#2563eb;border-color:#2563eb;background:var(--blue-light)">M9 Checkout funnel</span>
          <span class="schema-power-pill" style="color:#2563eb;border-color:#2563eb;background:var(--blue-light)">Device + geo split</span>
          <span class="schema-power-pill" style="color:#2563eb;border-color:#2563eb;background:var(--blue-light)">Weekly CVR trend</span>
        </div>
      </div>
    </div>

  </div><!-- schema-grid -->

  <!-- ─── STORY 3: THREE JOINS ──────────────────────────────────────── -->
  <div class="story-hdr">
    <span class="story-num" style="background:var(--teal)">3</span>
    <h3>Three joins that matter — and why each one exists</h3>
  </div>
  <p class="story-sub">Most of the analytic power in this system comes from three cross-table relationships. Each join connects a piece of data that neither table can answer alone.</p>

  <div class="join-card">
    <div class="join-visual">
      <span class="join-num">1</span>
      <div class="join-tbl" style="background:var(--amber-light);border-color:#d97706;color:#92400e">matrixify.orders</div>
      <span class="join-op">JOIN</span>
      <div class="join-tbl" style="background:var(--amber-light);border-color:#d97706;color:#92400e">matrixify.order_line_items</div>
      <span class="join-op">ON</span>
      <span class="join-key">order_line_items.order_id = orders.id</span>
    </div>
    <div class="join-plain">
      <strong>Plain English:</strong> An order is a basket receipt — it tells you the total and the customer. A line item is each individual product in that basket. This join lets you go from "KNICKGASM made $50 on this order" to "this customer bought Embroidery Latte (×2) and Earl Grey Box (×1)." Without it, you can measure revenue but not what people actually buy.
    </div>
    <div class="join-enables">
      <span>Enables:</span>
      <span class="src-badge src-matrixify">M5 Gross Margin by Product</span>
      <span class="src-badge src-matrixify">M10 Subscription Mix</span>
      <span class="src-badge src-matrixify">M15 Product Repeat Rate</span>
      <span class="src-badge src-matrixify">SKU subscription gap analysis</span>
    </div>
  </div>

  <div class="join-card">
    <div class="join-visual">
      <span class="join-num">2</span>
      <div class="join-tbl" style="background:var(--purple-light);border-color:#7c3aed;color:#5b21b6">klaviyo.profiles</div>
      <span class="join-op">JOIN</span>
      <div class="join-tbl" style="background:var(--amber-light);border-color:#d97706;color:#92400e">matrixify.orders</div>
      <span class="join-op">ON</span>
      <span class="join-key">profiles.email = orders.email</span>
    </div>
    <div class="join-plain">
      <strong>Plain English:</strong> Klaviyo knows the prediction — this customer is high churn risk, their predicted 12-month CLV is $180. Shopify knows the history — this customer bought 4 times, spent $240 total. Joining them on email bridges the future forecast to the purchase record. The result: you can say "we have $X in predicted revenue from customers who are likely to churn this quarter" — a dollar figure that justifies win-back spend.
    </div>
    <div class="join-enables">
      <span>Enables:</span>
      <span class="src-badge src-klaviyo">M13 Churn Risk Distribution</span>
      <span class="src-badge src-klaviyo">M14 At-Risk Revenue</span>
      <span class="src-badge src-matrixify">CLV validation vs Klaviyo prediction</span>
    </div>
  </div>

  <div class="join-card">
    <div class="join-visual">
      <span class="join-num">3</span>
      <div class="join-tbl" style="background:var(--purple-light);border-color:#7c3aed;color:#5b21b6">klaviyo.campaigns</div>
      <span class="join-op">JOIN</span>
      <div class="join-tbl" style="background:var(--teal-light);border-color:#0d9488;color:#0f766e">shopify_analytics.revenue_metrics</div>
      <span class="join-op">ON</span>
      <span class="join-key">DATE_TRUNC('month', sent_at) = month</span>
    </div>
    <div class="join-plain">
      <strong>Plain English:</strong> Klaviyo tracks what email generated ($12K attributed to this campaign). Shopify tracks total revenue ($80K net sales this month). Joining them by calendar month and dividing gives you the email revenue share — the single most important measure of whether your owned channel is pulling its weight. If email accounts for less than 20% of revenue, you are over-dependent on paid channels that can become expensive or unavailable overnight.
    </div>
    <div class="join-enables">
      <span>Enables:</span>
      <span class="src-badge src-klaviyo">M7 Email Revenue %</span>
      <span class="src-badge src-shopify">Channel efficiency benchmark</span>
      <span class="src-badge src-klaviyo">Flow vs campaign contribution split</span>
    </div>
  </div>

  <!-- ─── STORY 4: THREE VIEWS ──────────────────────────────────────── -->
  <div class="story-hdr">
    <span class="story-num" style="background:var(--coral)">4</span>
    <h3>Three views — pre-built queries you get out of the box</h3>
  </div>
  <p class="story-sub">These are the three queries you will run most. Each one joins across schemas and produces a result you can act on directly.</p>

  <div class="view-card">
    <div class="view-card-hdr">
      <div class="view-name" style="color:var(--amber)">customer_lifetime_value</div>
      <div class="view-desc">One row per customer — LTV, order count, market, churn risk, and predicted CLV side by side.</div>
      <span class="src-badge src-matrixify" style="flex-shrink:0">matrixify × klaviyo</span>
    </div>
    <div class="view-card-body">
      <div class="view-cols">
        <div class="view-col">
          <div class="view-col-lbl">Output Columns</div>
          <div class="view-field"><span class="vf-name">customer_id</span><span class="vf-type">VARCHAR</span></div>
          <div class="view-field"><span class="vf-name">market</span><span class="vf-type">VARCHAR</span><span class="vf-desc">US / UK / IN / RoW</span></div>
          <div class="view-field"><span class="vf-name">total_orders</span><span class="vf-type">INT</span></div>
          <div class="view-field"><span class="vf-name">actual_ltv</span><span class="vf-type">DECIMAL</span><span class="vf-desc">sum of all orders</span></div>
          <div class="view-field"><span class="vf-name">predicted_clv_1y</span><span class="vf-type">DECIMAL</span><span class="vf-desc">from Klaviyo model</span></div>
          <div class="view-field"><span class="vf-name">churn_risk</span><span class="vf-type">VARCHAR</span><span class="vf-desc">low/medium/high/winback</span></div>
        </div>
        <div class="view-col">
          <div class="view-col-lbl">Use It For</div>
          <div class="view-field"><span class="vf-desc">Export high-LTV + high-risk customers → Klaviyo win-back segment</span></div>
          <div class="view-field"><span class="vf-desc">Compare Klaviyo predicted_clv vs actual_ltv to validate model accuracy</span></div>
          <div class="view-field"><span class="vf-desc">Set per-market CAC ceiling: median_ltv ÷ target_ratio</span></div>
          <div class="view-field"><span class="vf-desc">Feed subscription conversion targeting: high LTV + no active sub</span></div>
        </div>
      </div>
    </div>
  </div>

  <div class="view-card">
    <div class="view-card-hdr">
      <div class="view-name" style="color:var(--blue)">weekly_checkout_funnel</div>
      <div class="view-desc">Weekly conversion rates at every funnel stage — with automatic alert flag when CVR drops &gt;5% WoW.</div>
      <span class="src-badge src-webengage" style="flex-shrink:0">webengage.event_summary</span>
    </div>
    <div class="view-card-body">
      <div class="view-cols">
        <div class="view-col">
          <div class="view-col-lbl">Output Columns</div>
          <div class="view-field"><span class="vf-name">week</span><span class="vf-type">DATE</span></div>
          <div class="view-field"><span class="vf-name">product_viewed</span><span class="vf-type">INT</span><span class="vf-desc">top of funnel</span></div>
          <div class="view-field"><span class="vf-name">added_to_cart</span><span class="vf-type">INT</span></div>
          <div class="view-field"><span class="vf-name">checkout_created</span><span class="vf-type">INT</span></div>
          <div class="view-field"><span class="vf-name">order_created</span><span class="vf-type">INT</span><span class="vf-desc">bottom of funnel</span></div>
          <div class="view-field"><span class="vf-name">overall_cvr_pct</span><span class="vf-type">DECIMAL</span><span class="vf-desc">view → order</span></div>
          <div class="view-field"><span class="vf-name">alert</span><span class="vf-type">VARCHAR</span><span class="vf-desc">fires if CVR drops &gt;5%</span></div>
        </div>
        <div class="view-col">
          <div class="view-col-lbl">Use It For</div>
          <div class="view-field"><span class="vf-desc">Spot the exact funnel stage where this week's revenue dropped</span></div>
          <div class="view-field"><span class="vf-desc">Distinguish traffic quality decline from UX/checkout friction</span></div>
          <div class="view-field"><span class="vf-desc">Alert fires automatically — no manual monitoring needed</span></div>
          <div class="view-field"><span class="vf-desc">Segment by device / market in WHERE clause for root cause</span></div>
        </div>
      </div>
    </div>
  </div>

  <div class="view-card">
    <div class="view-card-hdr">
      <div class="view-name" style="color:var(--teal)">channel_roi</div>
      <div class="view-desc">CAC, LTV, LTV:CAC ratio, and traffic volume per acquisition channel — the monthly budget reallocation screen.</div>
      <span class="src-badge src-shopify" style="flex-shrink:0">shopify_analytics × matrixify</span>
    </div>
    <div class="view-card-body">
      <div class="view-cols">
        <div class="view-col">
          <div class="view-col-lbl">Output Columns</div>
          <div class="view-field"><span class="vf-name">channel</span><span class="vf-type">VARCHAR</span><span class="vf-desc">google / meta / email / organic…</span></div>
          <div class="view-field"><span class="vf-name">new_customers</span><span class="vf-type">INT</span></div>
          <div class="view-field"><span class="vf-name">total_spend</span><span class="vf-type">DECIMAL</span></div>
          <div class="view-field"><span class="vf-name">cac</span><span class="vf-type">DECIMAL</span><span class="vf-desc">spend ÷ new_customers</span></div>
          <div class="view-field"><span class="vf-name">avg_ltv</span><span class="vf-type">DECIMAL</span><span class="vf-desc">from matrixify.orders</span></div>
          <div class="view-field"><span class="vf-name">ltv_cac_ratio</span><span class="vf-type">DECIMAL</span><span class="vf-desc">flag if &lt;3:1</span></div>
        </div>
        <div class="view-col">
          <div class="view-col-lbl">Use It For</div>
          <div class="view-field"><span class="vf-desc">Monthly budget meeting: which channels to scale vs pause</span></div>
          <div class="view-field"><span class="vf-desc">Any channel below 2:1 for 2 months → pause spending immediately</span></div>
          <div class="view-field"><span class="vf-desc">Set CAC ceiling per market: UK median LTV ÷ 3 = UK CAC ceiling</span></div>
          <div class="view-field"><span class="vf-desc">Track email as a channel — its CAC is near zero, making its ratio the benchmark</span></div>
        </div>
      </div>
    </div>
  </div>

  <!-- PATH TO SCALE -->
  <div class="story-hdr">
    <span class="story-num" style="background:var(--text3)">→</span>
    <h3>Path to scale</h3>
  </div>
  <div class="workflow">
    <div class="wf-box accent-blue" style="text-align:left;padding:14px 16px">
      <div style="font-weight:800;font-size:.82rem;margin-bottom:4px">DuckDB (now)</div>
      <div style="font-size:.72rem;opacity:.8">Local file, instant queries, zero infra cost</div>
    </div>
    <div class="wf-arrow">→</div>
    <div class="wf-box" style="text-align:left;padding:14px 16px">
      <div style="font-weight:800;font-size:.82rem;margin-bottom:4px">MotherDuck</div>
      <div style="font-size:.72rem;color:var(--text2)">Same SQL, cloud hosted, team-shareable</div>
    </div>
    <div class="wf-arrow">→</div>
    <div class="wf-box" style="text-align:left;padding:14px 16px">
      <div style="font-weight:800;font-size:.82rem;margin-bottom:4px">BI Layer</div>
      <div style="font-size:.72rem;color:var(--text2)">Metabase / Evidence.dev dashboards</div>
    </div>
    <div class="wf-arrow">→</div>
    <div class="wf-box accent-teal" style="text-align:left;padding:14px 16px">
      <div style="font-weight:800;font-size:.82rem;margin-bottom:4px">Alerting</div>
      <div style="font-size:.72rem;opacity:.8">Metric drops trigger Slack / email</div>
    </div>
  </div>
"""

# ── Find and replace the arch section inner content ───────────────────────────
# Keep: opening section tag, breadcrumb  |  Replace: everything after breadcrumb to </div></section>
arch_open  = html.find('id="arch"')
arch_crumb_end = html.find('</div>\n  <div class="section-label"', arch_open)
arch_section_end = html.find('</div>\n</section>', arch_crumb_end) + len('</div>\n</section>')

# Everything after breadcrumb </div> up to </div></section>
old_inner = html[arch_crumb_end:arch_section_end]
new_inner = '\n  </div><!-- breadcrumb -->\n' + NEW_ARCH + '\n</div>\n</section>'
html = html[:arch_crumb_end] + new_inner + html[arch_section_end:]


# ══════════════════════════════════════════════════════════════════════════════
# 3. FUNNEL VISUALIZATIONS in strategy sections
# ══════════════════════════════════════════════════════════════════════════════

def funnel_html(title, subtitle, icon, color, stages):
    """stages = list of (label, width_pct, value_ph, drop_ph)"""
    bars = []
    for i, (label, pct, val_ph, drop_ph) in enumerate(stages):
        bar = f'''
    <div class="funnel-stage">
      <div class="funnel-stage-label">{label}</div>
      <div class="funnel-bar-track">
        <div class="funnel-bar" style="width:{pct}%;background:{color};opacity:{0.95 - i*0.12:.2f}">
          <mark class="ph" title="Run the relevant metric query to fill this value">{val_ph}</mark>
        </div>
      </div>
      <div class="funnel-right">{pct}% of top</div>
    </div>'''
        if drop_ph and i < len(stages)-1:
            bar += f'\n    <div class="funnel-drop"><mark class="ph" title="Calculated drop-off between stages">{drop_ph}</mark> drop to next stage</div>'
        bars.append(bar)
    return f"""
  <div class="funnel-story">
    <div class="funnel-story-hdr">
      <span style="font-size:1.2rem">{icon}</span>
      <div>
        <div class="funnel-story-title">{title}</div>
        <div class="funnel-story-sub">{subtitle}</div>
      </div>
    </div>
    <div class="funnel-body">{''.join(bars)}
      <div style="margin-top:16px;font-size:.72rem;color:var(--text3);border-top:1px solid var(--border);padding-top:10px">
        Each bar = share of the stage above. Values are placeholders — run the linked metric query to fill with your real data.
      </div>
    </div>
  </div>"""

# S1 — Customer Lifecycle Funnel
S1_FUNNEL = funnel_html(
    "Customer Lifecycle Funnel",
    "How many customers survive each stage of the relationship — from first purchase to high-LTV subscriber",
    "👤", "#7c3aed",
    [
        ("New customers acquired (month)",  100, "[ YOUR NEW CUSTOMERS ]",       "[ YOUR ACQUISITION COST ]"),
        ("Returned within 30 days",          35, "[ RUN M11: 30d retention ]",    "[ 65% — typical drop ]"),
        ("Returned within 90 days",          28, "[ RUN M4: 90d repeat rate ]",   "[ 20% — typical drop ]"),
        ("Placed 3+ orders (loyal tier)",    18, "[ RUN M2: returning segment ]", "[ 10% — typical drop ]"),
        ("Converted to subscription",        10, "[ RUN M10: sub mix ]",          "[ 8% — typical drop ]"),
        ("High-LTV top 20% of base",          5, "[ RUN BONUS: LTV by market ]",  None),
    ]
)

# S2 — Revenue Attribution Funnel
S2_FUNNEL = funnel_html(
    "Revenue Attribution Funnel",
    "How gross revenue flows through discounts and channel attribution to arrive at net channel contribution",
    "💰", "#0d9488",
    [
        ("Gross Revenue (all orders)",       100, "[ RUN M1: gross sales ]",        "[ YOUR DISCOUNT RATE ]"),
        ("Net Revenue (after discounts)",     92, "[ RUN M1: net sales ]",           "[ YOUR EMAIL SHARE ]"),
        ("Email-attributed (Klaviyo)",        35, "[ RUN M7: email revenue % ]",     "[ remaining to paid ]"),
        ("Paid channel revenue",              40, "[ RUN M6: CAC by channel ]",      "[ YOUR ORGANIC % ]"),
        ("Organic / direct revenue",          17, "[ remaining = organic + direct ]", None),
    ]
)

# S4 — Subscription Conversion Funnel
S4_FUNNEL = funnel_html(
    "Subscription Conversion Funnel",
    "From all one-time buyers to active subscribers — where the conversion opportunity lives",
    "🔄", "#e11d48",
    [
        ("All one-time buyers (active base)",    100, "[ RUN M2: one-time count ]",        "[ eligible SKU filter ]"),
        ("Bought a subscription-eligible SKU",    72, "[ RUN M15: product repeat rate ]",  "[ sub offer coverage ]"),
        ("Received a subscription offer (flow)",  55, "[ Klaviyo flow sent count ]",        "[ YOUR OFFER CVR ]"),
        ("Converted to subscription",            10, "[ RUN M10: sub mix % ]",             "[ 90d retention ]"),
        ("Still active subscriber at 90 days",    7, "[ Recharge / sub app data ]",         None),
    ]
)

# S5 — Checkout Conversion Funnel
S5_FUNNEL = funnel_html(
    "Checkout Conversion Funnel",
    "Every stage where a potential buyer is lost — the exact drop-off points that determine weekly revenue",
    "🛒", "#2563eb",
    [
        ("Product Viewed",     100, "[ RUN M9: product_viewed ]",    "[ YOUR PV→ATC DROP ]"),
        ("Added to Cart",       14, "[ RUN M9: added_to_cart ]",     "[ YOUR ATC→CHK DROP ]"),
        ("Checkout Created",     9, "[ RUN M9: checkout_created ]",  "[ YOUR CHK→ORDER DROP ]"),
        ("Order Created",        6, "[ RUN M9: order_created ]",      None),
    ]
)

# Inject funnels — insert BEFORE the first <div class="sql-block"> in each section
def inject_funnel(h, section_id, funnel_block):
    sec_start = h.find(f'id="{section_id}"')
    sec_end   = h.find('class="section-divider"', sec_start)
    sql_pos   = h.find('<div class="sql-block">', sec_start, sec_end)
    if sql_pos == -1:
        # Fallback: inject before closing </div></section>
        close = h.rfind('</div>\n</section>', sec_start, sec_end)
        sql_pos = close
    return h[:sql_pos] + funnel_block + "\n\n  " + h[sql_pos:]

html = inject_funnel(html, "s1", S1_FUNNEL)
html = inject_funnel(html, "s2", S2_FUNNEL)
html = inject_funnel(html, "s4", S4_FUNNEL)
html = inject_funnel(html, "s5", S5_FUNNEL)


# ══════════════════════════════════════════════════════════════════════════════
# 4. WRITE
# ══════════════════════════════════════════════════════════════════════════════
HTML.write_text(html, encoding="utf-8")

import re as _re
funnels  = len(_re.findall(r'class="funnel-story"', html))
schemas  = len(_re.findall(r'class="schema-card"', html))
joins    = len(_re.findall(r'class="join-card"', html))
views    = len(_re.findall(r'class="view-card"', html))
kb       = round(len(html)/1024, 1)
print(f"Done.")
print(f"  Funnel visualizations : {funnels}")
print(f"  Schema cards          : {schemas}")
print(f"  Join cards            : {joins}")
print(f"  View cards            : {views}")
print(f"  Size                  : {kb} KB")
