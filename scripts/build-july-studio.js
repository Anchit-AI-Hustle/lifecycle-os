#!/usr/bin/env node
'use strict';

/**
 * build-july-studio.js — KNICKGASM USA July calendar + mailer studio
 * (lifecycle-usa-july-calendar-mailer-studio.html, served at /july-studio · /usa-july).
 *
 * Reads the manifest (data/calendar/usa-july-2026.json) written by
 * build-july-mailers.js and emits ONE self-contained studio page with:
 *   - a shared top block (forecast + numbers analysis + scenario cards) that is
 *     identical across both views,
 *   - a Card / List view toggle rendering the SAME 12 sends and the SAME expand
 *     behaviour (variant tabs, live preview, reasoning, download),
 *   - previews served from the real files (iframe src="/mailers/usa-july/<file>"),
 *     so the preview IS the exact deployable/downloadable file.
 *
 * Security: all data-derived text is written via textContent / setAttribute and
 * the DOM is built with createElement — no innerHTML or iframe.srcdoc is fed from
 * embedded data, so there is no DOM-text -> HTML injection sink.
 *
 * Usage: node scripts/build-july-studio.js  (after build-july-mailers.js)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function main() {
  const manifestPath = path.join(ROOT, 'data', 'calendar', 'usa-july-2026.json');
  if (!fs.existsSync(manifestPath)) { console.error('Run scripts/build-july-mailers.js first.'); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Embed the manifest AND each variant exact HTML so the page previews and
  // downloads the byte-identical file even offline. Preview uses a Blob URL
  // (a navigation, not an HTML-injection sink), so there is no srcdoc /
  // innerHTML-from-data XSS surface.
  const htmlByFile = {};
  const embed = (rel) => { if (rel) { const abs = path.join(ROOT, rel); htmlByFile[rel] = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "<p>missing</p>"; } };
  for (const slot of manifest.slots) {
    for (const v of slot.variants) embed(v.file);
    embed(slot.ads && slot.ads.file);
    embed(slot.landing && slot.landing.file);
  }
  const DATA = JSON.stringify({ manifest: manifest, htmlByFile: htmlByFile })
    .replace(/</g, "\\u003c");

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KNICKGASM USA July · Calendar + Mailer Studio</title>
<style>
  :root{--green:#D0473E;--lava:#6A33D8;--ink:#111111;--chalk:#FFFFFF;--line:#e6dcc7;--muted:#7a6e5a;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--chalk);color:var(--ink);font-family:'Instrument Sans','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;}
  a{color:var(--brand-primary-text,var(--green));}
  header.top{background:var(--green);color:var(--chalk);padding:26px 22px;}
  header.top .brand{font-family:'Montserrat','Raleway',Georgia,serif;letter-spacing:.32em;font-size:22px;font-weight:700;}
  header.top .sub{color:var(--brand-accent-text,var(--lava));letter-spacing:.24em;text-transform:uppercase;font-size:11px;margin-top:6px;}
  header.top h1{font-family:'Montserrat','Raleway',Georgia,serif;font-weight:700;font-size:27px;margin:14px 0 4px;}
  header.top p{margin:0;color:#d8e3db;font-size:14px;max-width:820px;line-height:1.6;}
  .wrap{max-width:1160px;margin:0 auto;padding:22px;}
  .fcast{background:#fff;border:1px solid var(--line);border-left:3px solid var(--lava);border-radius:8px;padding:14px 16px;font-size:13.5px;color:#4a4235;line-height:1.65;margin:18px 0;}
  .fcast b{color:var(--brand-primary-text,var(--green));}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:12px 0 20px;}
  .stat{background:#fff;border:1px solid var(--line);border-top:3px solid var(--lava);border-radius:8px;padding:14px 16px;}
  .stat b{display:block;font-family:'Montserrat',Georgia,serif;font-size:26px;color:var(--brand-primary-text,var(--green));line-height:1;}
  .stat span{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;display:block;margin-top:8px;}
  .stat em{font-style:normal;font-size:12px;color:#4a4235;display:block;margin-top:4px;}
  .sec-h{font-family:'Montserrat',Georgia,serif;color:var(--brand-primary-text,var(--green));font-size:18px;margin:24px 0 10px;}
  .scn{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:8px;}
  .scard{border:1px solid var(--line);border-radius:12px;background:#fff;padding:16px 18px;}
  .scard.rec{border:2px solid var(--green);box-shadow:0 4px 16px rgba(0,74,43,.12);}
  .scard .lab{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--brand-accent-text,var(--lava));}
  .scard .amt{font-family:'Montserrat',Georgia,serif;color:var(--brand-primary-text,var(--green));font-size:20px;margin:8px 0;}
  .scard .sub{font-size:12.5px;color:#4a4235;line-height:1.55;}
  .scard .rp{display:inline-block;margin-top:10px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:var(--green);color:var(--chalk);padding:4px 10px;border-radius:999px;}
  .toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:18px 0 12px;}
  .toggle{display:inline-flex;border:1px solid var(--line);border-radius:999px;background:#fff;overflow:hidden;}
  .toggle button{border:0;background:transparent;padding:8px 18px;font-size:13px;color:var(--muted);cursor:pointer;font-family:inherit;}
  .toggle button.on{background:var(--green);color:var(--chalk);}
  .muted{font-size:12px;color:var(--muted);}
  /* list view */
  .rows .row{background:#fff;border:1px solid var(--line);border-radius:10px;margin-bottom:12px;overflow:hidden;}
  .rhead{display:grid;grid-template-columns:88px 128px 1fr 120px 40px;gap:12px;align-items:center;padding:14px 16px;cursor:pointer;}
  .rhead:hover{background:#fbf8f0;}
  .date{font-family:'Montserrat',Georgia,serif;color:var(--brand-primary-text,var(--green));font-size:15px;}
  .date small{display:block;color:var(--muted);font-family:inherit;font-size:11px;letter-spacing:.06em;text-transform:uppercase;}
  .badge{display:inline-block;background:#eef3ef;color:var(--brand-primary-text,var(--green));border:1px solid #cfe0d5;border-radius:14px;padding:3px 10px;font-size:11.5px;font-weight:600;white-space:nowrap;}
  .prod{font-size:14px;}.prod .play{display:block;color:var(--muted);font-size:12px;margin-top:3px;}
  .event{font-size:11.5px;color:#8a5a12;background:#faf1df;border:1px solid #ecd9b6;border-radius:12px;padding:3px 9px;display:inline-block;margin-top:3px;}
  .price{color:var(--brand-primary-text,var(--green));font-weight:700;font-size:14px;text-align:right;}
  .chev{color:var(--brand-accent-text,var(--lava));text-align:center;font-size:18px;transition:transform .15s;}
  .row.open .chev,.card.open .chev{transform:rotate(90deg);}
  /* card view */
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;}
  .card{background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;}
  .card .chead{padding:14px 16px;cursor:pointer;}
  .card .chead:hover{background:#fbf8f0;}
  .card .ctop{display:flex;justify-content:space-between;align-items:center;gap:10px;}
  .card .cdate{font-family:'Montserrat',Georgia,serif;color:var(--brand-primary-text,var(--green));font-size:16px;}
  .card .cprod{font-size:14.5px;font-weight:600;margin:10px 0 2px;}
  .card .cplay{font-size:12px;color:var(--muted);}
  .card .cchips{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;}
  .chip{font-size:10.5px;border:1px solid var(--line);border-radius:10px;padding:2px 8px;color:var(--muted);}
  .chip.img{border-color:#cfe0d5;color:var(--brand-primary-text,var(--green));}
  .chip.col{background:#eef3ef;border-color:#cfe0d5;color:var(--brand-primary-text,var(--green));font-weight:600;}
  /* shared expand body */
  .body{display:none;border-top:1px solid var(--line);padding:14px 16px;background:#fbf8f0;}
  .row.open .body,.card.open .body{display:block;}
  .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;}
  .tab{border:1px solid var(--line);background:#fff;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12px;color:var(--muted);}
  .tab.on{background:var(--ink);color:#fff;border-color:var(--ink);}
  .tab small{display:block;font-size:9.5px;opacity:.7;}
  .pv{background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-bottom:10px;}
  .pvbar{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line);font-size:12px;}
  .pvbar .subj{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .dl{background:var(--lava);color:var(--ink);border-radius:5px;padding:5px 11px;font-size:12px;font-weight:700;text-decoration:none;white-space:nowrap;}
  iframe{width:100%;height:460px;border:0;display:block;background:#fff;}
  .reason h4{margin:0 0 6px;font-family:'Montserrat',Georgia,serif;color:var(--brand-primary-text,var(--green));font-size:15px;}
  .reason dt{color:var(--brand-accent-text,var(--lava));text-transform:uppercase;letter-spacing:.06em;font-size:10px;margin-top:8px;font-weight:700;}
  .reason dd{margin:2px 0 0;color:#3f382c;font-size:12.5px;line-height:1.5;}
  .assetnote{font-size:11px;color:var(--muted);margin-top:10px;border-top:1px dashed var(--line);padding-top:8px;word-break:break-all;}
  footer{color:var(--muted);font-size:12px;padding:24px 22px;text-align:center;}
</style>
</head>
<body>
<header class="top">
  <div class="brand">KNICKGASM</div>
  <div class="sub">Lifecycle OS · USA</div>
  <h1>July Calendar + Mailer Studio</h1>
  <p>Every send is generated through the automated mailer-calendar pipeline: four variants per slot (Text A/B, Text + Visual A/B) rendered by the shared brand renderer and scrubbed against the banned-phrase list. Hero images come only from origin-validated brand_assets. Card and list views show the same calendar and the same analysis.</p>
</header>
<div class="wrap">
  <div class="fcast" id="fcast"></div>
  <div class="stats" id="stats"></div>
  <div class="sec-h">Cadence scenarios</div>
  <div class="scn" id="scn"></div>
  <div class="toolbar">
    <div class="toggle" id="toggle">
      <button data-v="card" class="on">▦ Card view</button>
      <button data-v="list">☰ List view</button>
    </div>
    <div class="muted" id="count"></div>
  </div>
  <div id="view"></div>
</div>
<footer>Lifecycle OS · US market (knickgasm.com) · Scenario C executed model · assets origin-validated against the KNICKGASM allowlist.</footer>

<script id="data" type="application/json">${DATA}</script>
<script>
(function(){
  var D = JSON.parse(document.getElementById('data').textContent);
  var M = D.manifest, H = D.htmlByFile;
  var slots = M.slots;
  var _blobUrls = [];
  var WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // tiny DOM builder — text is always set via textContent (no HTML injection)
  function el(tag, cls, text){ var n=document.createElement(tag); if(cls)n.className=cls; if(text!=null)n.textContent=text; return n; }

  // ── shared top block (identical in both views) ────────────────────────────
  var cohorts={}, events=0, verified=0, weeks={};
  slots.forEach(function(s){
    cohorts[s.segment]=(cohorts[s.segment]||0)+1;
    if(s.event) events++;
    if(s.hero_asset && s.hero_asset.status==='verified') verified++;
    var wk = Math.ceil(parseInt(s.date.slice(8),10)/7); weeks[wk]=(weeks[wk]||0)+1;
  });
  var nCohorts=Object.keys(cohorts).length;

  var fc=document.getElementById('fcast');
  fc.appendChild(el('b','', 'Forecast · '));
  fc.appendChild(document.createTextNode(
    slots.length+' cohort sends across July ('+(slots.length*4)+' mailer variants), spanning '+nCohorts+
    ' RFM cohorts and '+events+' verified event tie-ins. Built to Scenario C (2-3 emails/user/week, multiple mailers/day allowed). '+
    'Hero imagery is 100% origin-validated ('+verified+'/'+slots.length+' slots carry a verified brand_assets photo; the rest render image-free rather than link a fabricated URL).'
  ));

  var stats=document.getElementById('stats');
  [ [slots.length,'Cohort sends','~'+(weeks[1]||0)+'/'+(weeks[2]||0)+'/'+(weeks[3]||0)+'/'+(weeks[4]||0)+'/'+(weeks[5]||0)+' by week'],
    [slots.length*4,'Mailer variants','2 Text · 2 Text+Visual each'],
    [slots.length,'Ad sets','Meta · Google · TikTok each'],
    [slots.length,'Landing pages','flagship long-form'],
    [nCohorts,'RFM cohorts',Object.keys(cohorts).join(', ')],
    [(M.selected_collections||[]).length,'Collections covered',(M.selected_collections||[]).map(function(c){return c.title;}).join(', ')||'—'],
    [events,'Event tie-ins','World Cup, Ice Cream Day, Parents, Friendship'],
    [verified+'/'+slots.length,'Verified heroes','origin-validated, no fabricated URLs'] ].forEach(function(r){
    var d=el('div','stat'); d.appendChild(el('b','',String(r[0]))); d.appendChild(el('span','',r[1])); d.appendChild(el('em','',r[2])); stats.appendChild(d);
  });

  var SCN=[
    {k:'A',lab:'Scenario A · Conservative',amt:'~1 / user / week',sub:'Lowest pressure, best deliverability headroom. One mailer/day. Shown for comparison — not executed.'},
    {k:'B',lab:'Scenario B · Balanced',amt:'~2 / user / week',sub:'Middle path between reach and fatigue. Shown for comparison — not executed.'},
    {k:'C',lab:'Scenario C · Executed',amt:'2-3 / user / week',sub:'Multiple mailers/day across cohorts. This July calendar is built to Scenario C.',rec:true}
  ];
  var scn=document.getElementById('scn');
  SCN.forEach(function(s){
    var c=el('div','scard'+(s.rec?' rec':'')); c.appendChild(el('div','lab',s.lab)); c.appendChild(el('div','amt',s.amt)); c.appendChild(el('div','sub',s.sub));
    if(s.rec) c.appendChild(el('span','rp','Executed'));
    scn.appendChild(c);
  });
  document.getElementById('count').textContent = slots.length+' sends · click any to preview its mailers, ads + landing page';

  // Build a list of previewable assets for a slot: 4 mailers + ad set + landing page.
  function assetsFor(slot){
    var list = slot.variants.map(function(v){ return { group:'Mailers', key:v.key, tab:(v.label.split(' · ')[1]||v.label), sub:v.type+(v.has_image?'':' · text-only'), file:v.file, subject:v.subject }; });
    if(slot.ads && slot.ads.file) list.push({ group:'Ads', key:'ads', tab:'Meta / Google / TikTok', sub:'paid-social preview', file:slot.ads.file, subject:'Ads · '+slot.product });
    if(slot.landing && slot.landing.file) list.push({ group:'Landing', key:'lp', tab:'Landing page', sub:'flagship long-form', file:slot.landing.file, subject:(slot.landing.title||slot.product) });
    return list;
  }

  // ── expand body (shared by card + list) ───────────────────────────────────
  function buildBody(slot){
    var body=el('div','body');
    var assets=assetsFor(slot);

    // asset-class selector: Mailers (4) · Ads · Landing
    var groups=['Mailers','Ads','Landing'].filter(function(g){ return assets.some(function(a){return a.group===g;}); });
    var classTabs=el('div','tabs');
    var tabs=el('div','tabs'); tabs.style.marginTop='2px';
    var pv=el('div','pv');
    var bar=el('div','pvbar');
    var subj=el('div','subj');
    var dl=el('a','dl','Download .html');
    bar.appendChild(subj); bar.appendChild(dl);
    var frame=document.createElement('iframe'); frame.setAttribute('title','asset preview'); frame.setAttribute('loading','lazy');
    pv.appendChild(bar); pv.appendChild(frame);

    function show(a){
      Array.prototype.forEach.call(tabs.children,function(t){ t.classList.toggle('on', t.getAttribute('data-key')===a.key); });
      var html = H[a.file] || "";
      var url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      _blobUrls.push(url);
      frame.setAttribute("src", url);
      dl.setAttribute("href", url);
      dl.setAttribute("download", a.file.split("/").pop());
      subj.textContent = a.subject;
    }
    function showGroup(g){
      Array.prototype.forEach.call(classTabs.children,function(t){ t.classList.toggle('on', t.getAttribute('data-g')===g); });
      tabs.textContent='';
      var inGroup=assets.filter(function(a){return a.group===g;});
      inGroup.forEach(function(a){
        var t=el('div','tab'); t.setAttribute('data-key',a.key);
        t.appendChild(document.createTextNode(a.tab));
        t.appendChild(el('small','', a.sub));
        t.addEventListener('click',function(){ show(a); });
        tabs.appendChild(t);
      });
      show(inGroup[g==='Mailers' && inGroup[2] ? 2 : 0]);
    }
    groups.forEach(function(g){
      var ct=el('div','tab'); ct.setAttribute('data-g',g);
      var n=assets.filter(function(a){return a.group===g;}).length;
      ct.appendChild(document.createTextNode(g)); ct.appendChild(el('small','', n+(n>1?' assets':' asset')));
      ct.addEventListener('click',function(){ showGroup(g); });
      classTabs.appendChild(ct);
    });

    var r=slot.reasoning||{};
    var reason=el('div','reason'); reason.appendChild(el('h4','','Why this send'));
    var dlst=document.createElement('dl');
    [['Who (cohort)',r.who],['What',r.what],['How it works',r.how],['Hypothesis',r.hypothesis],['Expected impact',r.expected]].forEach(function(p){
      if(!p[1])return; dlst.appendChild(el('dt','',p[0])); dlst.appendChild(el('dd','',p[1]));
    });
    reason.appendChild(dlst);
    var note=el('div','assetnote');
    var ha=slot.hero_asset||{};
    note.textContent = 'Hero asset: '+(ha.status==='verified' ? ('verified · origin-validated · '+(ha.url||'')) : 'placeholder (rendered image-free — no fabricated URL)')+'  ·  CTA -> '+slot.cta_url;
    reason.appendChild(note);
    if((slot.collections||[]).length){ var cnote=el('div','assetnote'); cnote.textContent='Collections: '+slot.collections.join(', ')+(slot.collection_cta?('  ·  collection CTA -> '+slot.collection_cta.url):''); reason.appendChild(cnote); }

    body.appendChild(classTabs); body.appendChild(tabs); body.appendChild(pv); body.appendChild(reason);
    showGroup('Mailers'); // default group
    return body;
  }

  // ── list view ─────────────────────────────────────────────────────────────
  function listView(){
    var box=el('div','rows');
    slots.forEach(function(slot){
      var row=el('div','row');
      var head=el('div','rhead');
      var d=new Date(slot.date+'T00:00:00');
      var dt=el('div','date', slot.date.slice(8)+' Jul'); dt.appendChild(el('small','',WD[d.getUTCDay()]));
      var seg=el('div'); seg.appendChild(el('span','badge',slot.segment));
      var prod=el('div','prod', slot.product);
      var play=el('span','play', slot.play); prod.appendChild(play);
      if((slot.collections||[]).length){ var cc=el('div'); cc.style.marginTop='4px'; slot.collections.forEach(function(c){ cc.appendChild(el('span','chip col','▸ '+c)); }); prod.appendChild(cc); }
      if(slot.event){ var evrow=el('div'); evrow.appendChild(el('span','event',slot.event)); prod.appendChild(evrow); }
      var price=el('div','price', slot.price||'');
      var chev=el('div','chev','›');
      head.appendChild(dt); head.appendChild(seg); head.appendChild(prod); head.appendChild(price); head.appendChild(chev);
      row.appendChild(head);
      head.addEventListener('click',function(){ toggle(row,slot); });
      box.appendChild(row);
    });
    return box;
  }

  // ── card view ───────────────────────────────────────────────────────────
  function cardView(){
    var box=el('div','cards');
    slots.forEach(function(slot){
      var card=el('div','card');
      var head=el('div','chead');
      var top=el('div','ctop');
      var d=new Date(slot.date+'T00:00:00');
      top.appendChild(el('div','cdate', slot.date.slice(8)+' Jul · '+WD[d.getUTCDay()]));
      top.appendChild(el('span','badge',slot.segment));
      head.appendChild(top);
      head.appendChild(el('div','cprod', slot.product));
      var play=el('div','cplay', slot.play + (slot.price?(' · '+slot.price):''));
      head.appendChild(play);
      if(slot.event){ var ev=el('div'); ev.appendChild(el('span','event',slot.event)); ev.style.marginTop='8px'; head.appendChild(ev); }
      var chips=el('div','cchips');
      slot.variants.forEach(function(v){ chips.appendChild(el('span','chip'+(v.has_image?' img':''), v.label.split(' · ')[0])); });
      var chev=el('span','chev',' ›'); chips.appendChild(chev);
      head.appendChild(chips);
      if((slot.collections||[]).length){ var cc=el('div','cchips'); cc.style.marginTop='6px'; slot.collections.forEach(function(c){ cc.appendChild(el('span','chip col','▸ '+c)); }); head.appendChild(cc); }
      card.appendChild(head);
      head.addEventListener('click',function(){ toggle(card,slot); });
      box.appendChild(card);
    });
    return box;
  }

  function toggle(container, slot){
    if(container.classList.contains('open')){ container.classList.remove('open'); return; }
    if(!container.getAttribute('data-built')){ container.appendChild(buildBody(slot)); container.setAttribute('data-built','1'); }
    container.classList.add('open');
  }

  var current='card';
  function render(){
    var v=document.getElementById('view'); v.textContent='';
    v.appendChild(current==='card'?cardView():listView());
  }
  document.getElementById('toggle').addEventListener('click',function(e){
    var b=e.target.closest('button'); if(!b)return;
    current=b.getAttribute('data-v');
    Array.prototype.forEach.call(this.children,function(x){ x.classList.toggle('on', x===b); });
    render();
  });
  render();
})();
</script>
</body>
</html>`;

  const out = path.join(ROOT, 'lifecycle-usa-july-calendar-mailer-studio.html');
  fs.writeFileSync(out, page);
  console.log(`✓ wrote lifecycle-usa-july-calendar-mailer-studio.html (${Math.round(page.length / 1024)} KB, ${manifest.slots.length} sends, card+list toggle, iframe src previews)`);
}

main();
