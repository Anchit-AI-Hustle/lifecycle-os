// Every asset, for every kind of brand, every market it serves, every cohort,
// on the template path, a well-behaved model and a model that answers badly
// (2026-10-24). The operator: "test every asset generation logic and brand
// setup logic too for every parameter and context".
//
// The sweep found, all on the TEMPLATE path (no model at all):
//   - Google headlines over 30 characters ("Kalledevarapura Estate 250 grams"):
//     the units pass kept "250g" where the words broke the limit, then a second
//     walk over `platform_ready` (whose ad `copy` IS the ad object) spelled it
//     anyway, limit-blind; Meta primary text past 125 the same way;
//   - a Google ad with 0 or 1 description for a brand with no tagline or claims
//     (Google serves an RSA only with 2), on every build;
//   - a push notification with an EMPTY body when the title already said the line;
//   - the product named twice in one Meta text, and a brand with no product row
//     named twice ("New to Pale Oak Home? Here is Pale Oak Home.");
//   - the preheader, subline and text version repeating the tagline the subject
//     already carried;
//   - "The The Heritage Tea Company team" for a name that starts with "The";
//   - an SMS for "Chay & Co. — Cafe" blocked as never naming its sender (the
//     dash scrub had written the name with a hyphen);
//   - a landing page whose every button went to "#" passing its contract.
//
// Executed: the shipped buildCampaign (scripted llm.js for the model paths,
// global.fetch throwing), every reader-facing string of every asset judged.
//
// Run: npx playwright test tests/asset-sweep-every-parameter.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const PLAN = require.resolve(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const { BRANDS } = require('./lib/sweep-brands.js');

const COHORTS = ['Champions', 'Loyal Customers', 'Potential Loyalist', 'New Customers', 'Promising', 'Need Attention', 'About to Sleep', 'At Risk', "Can't Lose Them", 'Hibernating', 'Lost', 'Never purchased', 'Replenishment due: repeat'];
const ENV = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];

function goodModel(b) {
  return {
    email: { subject: `A note from ${b.name}`, preheader: 'Short and plain', hook: 'h', hero_headline: `Back at ${b.name}`, intro_paragraph: 'We kept your place.', body_paragraph: 'Everything is where you left it.', benefits: (b.claims || []).slice(0, 2), rating: null, reviews: [], badges: [], guarantee: '', ps: 'See you soon.', faq: [], cta: 'Take a look', image_brief: 'a calm scene' },
    landing: { hero_headline: `Welcome back to ${b.name}`, hero_sub: 'Pick up where you left off.', why_title: 'Why now', why_bullets: (b.claims || ['Plain fact']).slice(0, 3), proof_quote: '', proof_author: '', faq: [], cta: 'Take a look', image_brief: 'scene' },
    ads: { meta: { primary_text: `${b.name} kept your place.`, headline: 'Come back', description: 'd', image_brief: 'z' }, google: { headlines: ['Come back today', b.name.slice(0, 30), 'Pick up again'], descriptions: ['Everything is where you left it.', 'A short note from us.'], image_brief: 'w' }, tiktok: { script: 's', caption: `${b.name} kept your place`, image_brief: 'v' } },
    messaging: { sms: 'We kept your place.', whatsapp: 'We kept your place for you.', push_title: 'Come back', push_body: 'We kept your place.' },
  };
}
// Everything a model must never get into an asset: invented proof, superlatives,
// guarantees, another brand, an unfilled tag, a marker, JS leaks, dashes, copy
// past every platform limit.
function badModel() {
  return {
    email: { subject: 'LIMITED TIME — clinically proven, the best in India', preheader: 'undefined', hook: 'h', hero_headline: 'KNICKGASM hand-painted sneakers — the #1 grail', intro_paragraph: 'Our scientifically proven formula guarantees results in 7 days — trusted by 1,000,000 customers.', body_paragraph: 'Rated 4.9/5 by 250,000+ reviewers. Use code SAVE50 for 50% off. Hurry, last chance!', benefits: ['Clinically proven', 'Award-winning service', '100% natural ingredients', 'Free shipping worldwide'], rating: { value: 4.9, count: '250,000+' }, reviews: [{ text: 'Best ever!', author: 'Priya S.' }], badges: ['#1 in India'], guarantee: '100% money back guarantee', ps: '[DATA REQUIRED BEFORE LAUNCH: price]', faq: [{ q: 'Is it safe?', a: 'Yes, doctors recommend it.' }], cta: 'Buy now {{first_name}}', image_brief: 'sneakers' },
    landing: { hero_headline: 'The best 100W charger — guaranteed', hero_sub: '[object Object]', why_title: 'Why', why_bullets: ['Cures fatigue', 'Scientifically proven', 'Award-winning'], proof_quote: 'Changed my life', proof_author: 'Rahul K.', faq: [{ q: 'q', a: 'a' }], cta: 'Shop now', image_brief: 'y' },
    ads: { meta: { primary_text: 'X'.repeat(300), headline: 'This headline is far too long for a Meta ad headline slot', description: 'd', image_brief: 'z' }, google: { headlines: ['A Google headline that is clearly over thirty chars', 'KNICKGASM grails', 'Best in India'], descriptions: ['D'.repeat(120), 'Clinically proven to work.'], image_brief: 'w' }, tiktok: { script: 's', caption: 'C'.repeat(160), image_brief: 'v' } },
    messaging: { sms: 'Huge sale — 50% off everything, hurry! '.repeat(6), whatsapp: 'Hi {{1}}, sale!', push_title: 'T'.repeat(90), push_body: 'Clinically proven' },
  };
}
const INVENTED = ['clinically proven', 'scientifically proven', 'award-winning', '250,000', '4.9/5', 'SAVE50', 'money back', 'doctors recommend', 'Cures fatigue', 'Changed my life', 'Priya S', 'Rahul K', '#1 in India', 'best in India', 'KNICKGASM'];

async function build(entry, mode) {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error(`network blocked in the asset sweep: ${u}`); };
  const realLlm = require.cache[LLM];
  try {
    if (mode !== 'template') {
      const real = require(LLM);
      const payload = mode === 'model' ? goodModel(entry.brand) : badModel();
      const stub = async (o) => ({ text: JSON.stringify(/strategy/.test(String(o.stage || '')) ? { angle: 'a', framework: 'PAS', hook_thesis: 'x', target_emotion: 'calm', proof_points: [], differentiator: 'x', dos: [], donts: [] } : payload), provider: 'scripted', model: 'scripted' });
      Object.assign(stub, real);
      require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
    }
    delete require.cache[PLAN];
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    return await require(PLAN).buildCampaign(entry, smartConfig({}), { noLLM: mode === 'template', withCreatives: false });
  } finally {
    require.cache[LLM] = realLlm; delete require.cache[PLAN];
    global.fetch = realFetch;
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

const strip = (h) => String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
const textOf = (h) => strip(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const nodesOf = (h) => strip(h).replace(/<[^>]+>/g, '\u0001').split('\u0001').map((x) => x.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()).filter(Boolean);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function surfaces(c) {
  const out = [];
  const e = c.assets.email || {};
  out.push(['email.subject', e.subject, 'text'], ['email.preheader', e.preheader, 'text'], ['email.html', e.html, 'html'], ['email.text', e.text, 'text']);
  (e.variants || []).forEach((v, i) => out.push([`email.variant${i}`, v.html, 'html']));
  (c.assets.landing_pages || []).forEach((l, i) => out.push([`landing${i}`, l.html, 'html']));
  for (const a of c.assets.ads || []) {
    const id = `${a.platform}:${a.creative_type}`;
    for (const f of ['headline', 'primary_text', 'caption', 'cta', 'description']) if (a[f] != null) out.push([`${id}.${f}`, a[f], 'text']);
    for (const f of ['headlines', 'descriptions']) if (Array.isArray(a[f])) a[f].forEach((h, i) => out.push([`${id}.${f}[${i}]`, h, 'text']));
  }
  for (const m of c.assets.messages || []) {
    out.push([`${m.channel}.text`, m.text || m.body || '', 'text']);
    if (m.title) out.push([`${m.channel}.title`, m.title, 'text']);
  }
  return out;
}

// What is NOT the generator's fault: a record that names no website cannot
// have its logo or buttons linked anywhere, and a name longer than a platform
// slot cannot be shortened without cutting it. Each is a stated data gap.
function expectedBlock(v, b) {
  const msg = String(v.message || '');
  if (!b.website && /logo linked to its homepage|link to "#"/.test(msg)) return true;
  if (String(b.name).length > 30 && /has no headlines/.test(msg)) return true;
  return false;
}

function judge(c, b, ctx, mode, others) {
  const f = [];
  const add = (rule, where, detail) => f.push(`${rule} @ ${ctx} ${where}: ${String(detail).slice(0, 200)}`);
  if (!c || !c.assets) { add('no-assets', '', ''); return f; }
  const sum = c.contract_check && c.contract_check.summary ? c.contract_check.summary : c.contract_check;
  for (const v of ((sum && sum.violations) || []).filter((x) => x.level === 'block')) {
    if (mode === 'bad' && /compliance/.test(String(v.contract))) continue; // the gate catching the bad model is the gate working
    if (!expectedBlock(v, b)) add('contract-block', v.asset, `${v.contract} ${v.message}`);
  }
  const mk = ctx.split('|')[1];
  const sym = { IN: '₹', US: '$', UK: '£', EU: '€' }[mk];
  for (const [where, raw, kind] of surfaces(c)) {
    if (raw == null) continue;
    const s = String(raw);
    const t = kind === 'html' ? textOf(s) : s;
    const own = t.split(b.name).join(' ').split(b.name.toUpperCase()).join(' ').split(String(b.legal_entity || '@@')).join(' ');
    if (/[—–]/.test(own)) add('dash', where, own.match(/.{0,40}[—–].{0,40}/)[0]);
    if (/\[object Object\]|\bundefined\b|\bNaN\b/.test(t)) add('js-leak', where, t.match(/.{0,40}(\[object Object\]|\bundefined\b|\bNaN\b).{0,40}/)[0]);
    if (/DATA REQUIRED/.test(t)) add('marker-sent', where, t.match(/.{0,30}DATA REQUIRED[^\]]*\]?/)[0]);
    if (/\{\{(?!\s*(landing_page_url|replenishment_product_title))[^}]*\}\}/.test(t)) add('unfilled-tag', where, t.match(/\{\{[^}]*\}\}/)[0]);
    if (kind === 'html') {
      if (/href=["']http:\/\//.test(s)) add('http-link', where, s.match(/href=["']http:[^"']+/)[0]);
      if (/href=["']javascript:/i.test(s)) add('js-href', where, 'javascript:');
      if (/src=["']data:image/.test(s)) add('base64-image', where, 'data:image');
      if (/(href|src)=["'](undefined|null)/.test(s)) add('undefined-url', where, s.match(/(href|src)=["'](undefined|null)[^"']*/)[0]);
      if (b.website && /href=["']#?["']/.test(s)) add('dead-href', where, s.match(/.{0,60}href=["']#?["'].{0,20}/)[0]);
    }
    for (const nd of kind === 'html' ? nodesOf(s) : [s]) {
      const d = nd.split(b.name).join(' ').match(/.{0,30}\b(\w{3,})\s+\1\b.{0,30}/i);
      if (d) add('doubled-word', where, d[0]);
    }
    for (const o of others) {
      const re = new RegExp(`\\b${reEsc(o)}\\b`, 'i');
      if (re.test(t)) add('foreign-brand', where, o);
    }
    for (const x of ['₹', '£', '€'].filter((y) => y !== sym)) if (new RegExp(`\\${x}\\s?\\d`).test(t)) add('wrong-currency', where, `${mk} shows ${x}`);
    if (mk !== 'US' && /(^|\s)\$\s?\d/.test(t)) add('wrong-currency', where, `${mk} shows $`);
    for (const banned of (b.voice && b.voice.banned) || []) if (new RegExp(`\\b${reEsc(banned)}\\b`, 'i').test(t)) add('banned-phrase', where, banned);
    if (mode === 'bad') for (const inv of INVENTED) if (t.toLowerCase().includes(inv.toLowerCase())) add('invented-survived', where, inv);
    // A product (or a brand with none) is named once per ad line.
    if (kind === 'text' && /\.(primary_text|caption)$/.test(where)) {
      const subj = (b.__hero && b.__hero.title) ? b.__hero.title.split(' ').slice(0, 2).join(' ') : b.name;
      const n = (t.match(new RegExp(reEsc(subj), 'gi')) || []).length;
      if (n > 1 && !/\b\d+\s*watts?\b/.test(t)) add('named-twice', where, t);
    }
  }
  const nameFits = String(b.name).length <= 40;
  for (const a of c.assets.ads || []) {
    const id = `${a.platform}:${a.creative_type}`;
    const L = { meta: { headline: 40, primary_text: 125 }, tiktok: { caption: 100 } }[a.platform] || {};
    for (const [k, n] of Object.entries(L)) if (a[k] && String(a[k]).length > n && (nameFits || k !== 'headline')) add('over-limit', id, `${k} ${String(a[k]).length} > ${n}: ${a[k]}`);
    if (a.platform === 'google') {
      for (const h of a.headlines || []) if (String(h).length > 30) add('over-limit', id, `headline ${h.length} > 30: ${h}`);
      for (const d of a.descriptions || []) if (String(d).length > 90) add('over-limit', id, `description ${d.length} > 90`);
      if (String(b.name).length <= 30 && (a.headlines || []).length < 3) add('rsa-too-thin', id, `${(a.headlines || []).length} headlines`);
      if ((a.descriptions || []).length < 2) add('rsa-too-thin', id, `${(a.descriptions || []).length} descriptions`);
    }
  }
  for (const m of c.assets.messages || []) {
    if (m.channel === 'push' && !String(m.body || '').trim()) add('empty-push', 'push', 'no body');
    if (m.channel === 'push' && String(m.body || '').trim().toLowerCase().replace(/\.$/, '') === String(m.title || '').trim().toLowerCase()) add('push-repeats-title', 'push', m.title);
  }
  const e = c.assets.email || {};
  if (!String(e.subject || '').trim()) add('empty-subject', 'email', '');
  const pre = String(e.preheader || '').trim().toLowerCase();
  if (pre && String(e.subject || '').toLowerCase().includes(pre)) add('preheader-repeats-subject', 'email', `${e.subject} / ${e.preheader}`);
  return f;
}

const ALL_NAMES = BRANDS.map((b) => b.name).concat(['KNICKGASM']);

for (const brand of BRANDS) {
  test(`every asset for ${brand.name} (${brand.slug}), every market, cohort and path, says only what it may`, async () => {
    test.setTimeout(240_000);
    const others = ALL_NAMES.filter((x) => x !== brand.name && !brand.name.includes(x) && !x.includes(brand.name));
    const markets = (brand.regions || []).map((r) => r.code);
    if (!markets.length) markets.push('IN');
    const runs = [];
    for (const mk of markets) for (const coh of COHORTS) runs.push({ mk, coh, mode: 'template', offer: 'none' });
    for (const coh of ['At Risk', 'Champions', 'New Customers']) for (const mode of ['model', 'bad']) for (const offer of ['none', 'pct']) runs.push({ mk: markets[0], coh, mode, offer });
    const { objectiveFor } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const findings = [];
    let built = 0;
    for (const r of runs) {
      const entry = {
        id: `sweep-${brand.slug}-${built}`, date: '2026-11-02', market: r.mk, objective: objectiveFor(r.coh),
        brand: JSON.parse(JSON.stringify(brand)), cohort: { name: r.coh, size: 1500, rules: ['r'] },
        channels: ['email', 'meta', 'google', 'tiktok', 'landing_page', 'sms', 'whatsapp', 'push'], confidence: 0.6,
        offer: r.offer === 'pct' ? { depth: 'moderate', pct: 15 } : { depth: 'none', pct: 0 },
      };
      if (brand.__hero) entry.heroProduct = brand.__hero;
      const ctx = `${brand.slug}|${r.mk}|${r.coh}|${r.mode}|${r.offer}`;
      let c;
      try { c = await build(entry, r.mode); } catch (e) { findings.push(`THROW @ ${ctx}: ${e && e.message}`); continue; }
      built += 1;
      findings.push(...judge(c, brand, ctx, r.mode, others));
    }
    expect(built, 'every planned build ran').toBe(runs.length);
    expect([...new Set(findings)].slice(0, 30)).toEqual([]);
  });
}

test('the units pass keeps a Google headline that the words would push past 30, including through platform_ready', async () => {
  const b = BRANDS.find((x) => x.slug === 'brewfold');
  const entry = { id: 'units', date: '2026-11-02', market: 'IN', objective: 'premium bundle expansion', brand: JSON.parse(JSON.stringify(b)), heroProduct: b.__hero, cohort: { name: 'Champions', size: 900, rules: ['r'] }, channels: ['email', 'google'], offer: { depth: 'none', pct: 0 } };
  const c = await build(entry, 'template');
  const g = c.assets.ads.find((a) => a.platform === 'google');
  expect(g.headlines).toContain('Kalledevarapura Estate 250g');
  for (const h of g.headlines) expect(h.length, h).toBeLessThanOrEqual(30);
  const pr = c.platform_ready.google_ads.map((x) => x.copy);
  for (const ad of pr) for (const h of ad.headlines || []) expect(h.length, h).toBeLessThanOrEqual(30);
  expect(c.unit_words.kept_for_limit.some((k) => k.slot === 'headlines')).toBe(true);
});
