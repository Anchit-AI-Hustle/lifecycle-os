// Both mailer types on every path, the logo header linked to the brand's
// homepage, a word budget, properly made pictures, and the quality rules every
// mailer and ad is judged by (2026-10-17).
//
// The operator: "For the mailers, ensure that the text is not too much. Need
// both types of mailers - 1. Text only 2. Text and visuals. Ensure that visuals
// are properly created. Headers of the mails must have the brand logo with
// redirection to homepage of brand ... add more quality checks and rules &
// regulations for creation of all assets like mailers and ads."
//
// Executed: Smart Brain's shipped buildCampaign with no model (template path)
// and with a scripted model writing far too much (model path), each mailer
// read as a reader receives it; the contract check on finished artefacts.
//
// Run: npx playwright test tests/mailer-types-and-quality.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const PLAN = require.resolve(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const contracts = require(path.join(ROOT, 'api', '_shared', 'asset-contracts.js'));
const MF = require(path.join(ROOT, 'api', '_shared', 'mailer-format.js'));

const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];
const IMG = (n) => `https://aryateas.example/cdn/tea-${n}.jpg`;
const BRAND = {
  id: 'device:arya', slug: 'arya-teas', name: 'Arya Tea Estate', website: 'https://aryateas.example', industry: 'Kalimpong tea estate and store',
  tagline: 'Single-estate Kalimpong, picked and packed at the garden',
  palette: { primary: '#0E4D35', accent: '#C99A2E', ink: '#1E2A24', surface: '#FBF8F1' },
  regions: [{ code: 'IN', currency: 'INR', store_url: 'https://aryateas.example', home: true }],
  claims: ['Grown at 1,800 metres in Kalimpong', 'Packed at the garden within 48 hours of plucking'],
  logo_url: 'https://aryateas.example/logo.png',
  legal_entity: 'Arya Tea Estate Pvt Ltd, Kalimpong 734101, India',
};
const slot = (brand) => ({
  id: 'types-1', date: '2026-10-20', market: 'IN', objective: 'reactivation', brand: brand || BRAND,
  cohort: { name: 'At Risk', size: 1200, rules: ['r'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'],
  confidence: 0.6, offer: { depth: 'none', pct: 0 },
  heroProduct: { sku: 'A1', title: 'Arya Diamond First Flush', handle: 'arya-diamond-ff', category: 'Black Tea', image: IMG('diamond'), price: 1450 },
  supportingProducts: [{ sku: 'A2', title: 'Arya Ruby Second Flush', handle: 'arya-ruby-sf', category: 'Black Tea' }],
});

const wordsOf = (t) => String(t || '').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const text = (h) => String(h || '').replace(/<head[\s\S]*?<\/head>/i, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
const headerLink = (html) => {
  const at = html.search(/data-mail-logo(?!-link)/);
  const m = html.slice(at).match(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
  return { at, href: m && m[1], inner: m && m[2] };
};
const pictures = (html) => (html.replace(/<head[\s\S]*?<\/head>/i, '').match(/<img\b[^>]*>/g) || []).filter((t) => !/logo\.png|weserv/.test(t));

async function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.concat(Object.keys(env)).map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
async function buildTemplate(brand) {
  return withEnv({ FREE_GENERATION: 'off' }, async () => {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    return require(PLAN).buildCampaign(slot(brand), smartConfig({}), { noLLM: true, withCreatives: false });
  });
}

const noUtm = (u) => String(u || '').replace(/&amp;/g, '&').replace(/[?&]utm_[a-z]+=[^&#"]*/g, '').replace(/^([^?]*)&/, '$1?');
function expectLogoHeader(html, brand) {
  const h = headerLink(html);
  expect(h.at, 'the mail has a logo header').toBeGreaterThan(-1);
  // The link carries the send's UTM tags since 2026-10-20 (marketing-team); under them, the homepage.
  expect(noUtm(h.href), 'the logo links to the brand homepage').toBe(brand.website);
  expect(h.inner).toMatch(new RegExp(`<img[^>]*alt="${brand.name}"`));
  // The header comes before any other link in the mail.
  const firstHref = (html.replace(/<head[\s\S]*?<\/head>/i, '').match(/<a\b[^>]*href="([^"]*)"/) || [])[1];
  expect(noUtm(firstHref)).toBe(brand.website);
}

test('with no model, a send ships BOTH types: two Text and two Text + Visual, each headed by the logo linked home', async () => {
  const c = await buildTemplate();
  const em = c.assets.email;
  expectLogoHeader(em.html, BRAND);
  const v = em.variants;
  expect(Array.isArray(v)).toBe(true);
  expect(v.map((x) => x.type).sort()).toEqual(['Text', 'Text', 'Text + Visual', 'Text + Visual']);
  for (const x of v) {
    expectLogoHeader(x.html, BRAND);
    const pics = pictures(x.html);
    if (x.type === 'Text') {
      expect(pics, `${x.key}: a Text mailer shows no picture but the logo`).toEqual([]);
    } else {
      expect(pics.length, `${x.key}: a Text + Visual mailer shows the product`).toBeGreaterThan(0);
      for (const t of pics) {
        expect(t).toMatch(/src="https:\/\//);
        expect(t).toMatch(/alt="[^"]+"/);
        expect(t).toMatch(/width="\d+"/);
      }
      expect(x.html).toContain(IMG('diamond'));
    }
    // Each variant is judged as its own type, and our own output passes.
    expect(x.contract_check, x.key).toBeTruthy();
    expect(x.contract_check.violations.filter((y) => !y.compliance), x.key).toEqual([]);
  }
  expect(c.contract_check.violations.filter((y) => /^email/.test(y.asset) && !y.compliance && y.level === 'block')).toEqual([]);
});

test('a fact is said once: the tagline and the claims are not repeated in the header or the footer', async () => {
  const c = await buildTemplate();
  for (const x of c.assets.email.variants) {
    const t = text(x.html);
    expect(t.split(BRAND.tagline).length - 1, `${x.key}: tagline`).toBeLessThanOrEqual(1);
    for (const claim of BRAND.claims) expect(t.split(claim).length - 1, `${x.key}: ${claim}`).toBeLessThanOrEqual(1);
    expect(t).not.toMatch(/₹1450(?!\d)/); // the price in the market's own format: ₹1,450
  }
});

test('an SVG logo is shown as PNG through the free image service; with free generation off the name stands in, still linked home', () => {
  const svg = Object.assign({}, BRAND, { logo_url: 'https://aryateas.example/logo.svg' });
  const on = withEnvSync({ FREE_GENERATION: 'on' }, () => MF.logoHeader({ brand: svg }));
  expect(on).toMatch(/<a href="https:\/\/aryateas\.example"[^>]*><img src="https:\/\/images\.weserv\.nl\/\?url=https%3A%2F%2Faryateas\.example%2Flogo\.svg&amp;output=png/);
  const off = withEnvSync({ FREE_GENERATION: 'off' }, () => MF.logoHeader({ brand: svg }));
  expect(off).not.toMatch(/<img/);
  expect(off).toMatch(/<a href="https:\/\/aryateas\.example"[^>]*><span[^>]*>ARYA TEA ESTATE<\/span>/);
  // No website: the store a caller passes is the home link; a data: logo is never used.
  const noSite = MF.logoHeader({ brand: { name: 'X', logo_url: 'data:image/png;base64,AAA' }, store: 'https://x.example/in' });
  expect(noSite).toMatch(/href="https:\/\/x\.example\/in"/);
  expect(noSite).not.toMatch(/data:image/);
});
function withEnvSync(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

// ── The model path, with a model that writes far too much ───────────────────
const LONG = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ') + '.';
const longCopy = () => ({
  email: { subject: 'Your next first flush', preheader: 'From the garden this week', hook: 'h', hero_headline: 'Your next first flush is picked', intro_paragraph: 'Single-estate Kalimpong, picked and packed at the garden.', body_paragraph: LONG, benefits: ['Grown at 1,800 metres in Kalimpong', 'Packed at the garden within 48 hours of plucking', 'Single-estate Kalimpong'], rating: null, reviews: [], badges: [], guarantee: LONG, ps: LONG, faq: [], cta: 'Shop now', image_brief: 'x' },
  landing: { hero_headline: 'First flush', hero_sub: 'Sub', why_title: 'Why', why_bullets: ['A', 'B', 'C'], proof_quote: '', proof_author: '', faq: [], cta: 'Shop now', image_brief: 'y' },
  ads: { meta: { primary_text: 'Single-estate Kalimpong, picked and packed at the garden.', headline: 'Arya Diamond First Flush', description: 'd', image_brief: 'z' }, google: { headlines: ['Arya Diamond First Flush', 'Kalimpong first flush', 'Packed at the garden'], descriptions: ['Single-estate Kalimpong, picked and packed.', 'Grown at 1,800 metres in Kalimpong.'], image_brief: 'w' }, tiktok: { script: 's', caption: 'c', image_brief: 'v' } },
});
async function buildModel() {
  return withEnv({ FREE_GENERATION: 'off' }, async () => {
    const realLlm = require.cache[LLM]; const realPlan = require.cache[PLAN];
    try {
      const real = require(LLM);
      const stub = async (o) => {
        if (/strategy/.test(String(o.stage || ''))) return { text: JSON.stringify({ angle: 'a', framework: 'PAS', hook_thesis: 'x', target_emotion: 'calm', proof_points: [], differentiator: 'x', dos: [], donts: [] }), provider: 'scripted', model: 'm' };
        return { text: JSON.stringify(longCopy()), provider: 'scripted', model: 'm' };
      };
      Object.assign(stub, real);
      require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
      delete require.cache[PLAN];
      const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
      return await require(PLAN).buildCampaign(slot(), smartConfig({}), { noLLM: false, withCreatives: false });
    } finally {
      require.cache[LLM] = realLlm; if (realPlan) require.cache[PLAN] = realPlan; else delete require.cache[PLAN];
    }
  });
}

test('a model that writes too much: the mailer keeps to its word budget by leaving whole blocks out, never cutting a sentence', async () => {
  const c = await buildModel();
  expect(c.copywriter.provider).toBe('scripted');
  const v = c.assets.email.variants;
  expect(v.map((x) => x.type).sort()).toEqual(['Text', 'Text', 'Text + Visual', 'Text + Visual']);
  for (const x of v) {
    expectLogoHeader(x.html, BRAND);
    const t = text(x.html);
    const budget = x.type === 'Text' ? contracts.MAIL_WORDS.text : contracts.MAIL_WORDS.visual;
    // The body between the header and the footer.
    const body = text(x.html.slice(x.html.search(/data-mail-logo(?!-link)/), x.html.search(/data-mail-footer/)));
    expect(wordsOf(body), `${x.key} body words`).toBeLessThanOrEqual(budget + 12);
    // The 60-word blocks are left out whole, never cut: either all of it or none.
    const n = (t.match(/word\d+/g) || []).length;
    expect(n % 61 === 0 || n % 60 === 0, `${x.key}: ${n} filler words`).toBe(true);
    expect(t).toContain('Single-estate Kalimpong, picked and packed at the garden');
  }
  // The writer is briefed with the same numbers.
});

test('the copy brief and the JSON schema carry the word budget', async () => {
  const prompts = [];
  await withEnv({ FREE_GENERATION: 'off' }, async () => {
    const realLlm = require.cache[LLM]; const realPlan = require.cache[PLAN];
    try {
      const real = require(LLM);
      const stub = async (o) => { prompts.push(JSON.stringify(o)); return { text: JSON.stringify(longCopy()), provider: 'scripted', model: 'm' }; };
      Object.assign(stub, real);
      require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
      delete require.cache[PLAN];
      const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
      await require(PLAN).buildCampaign(slot(), smartConfig({}), { noLLM: false, withCreatives: false });
    } finally {
      require.cache[LLM] = realLlm; if (realPlan) require.cache[PLAN] = realPlan; else delete require.cache[PLAN];
    }
  });
  const all = prompts.join('\n');
  expect(all).toMatch(new RegExp(`hero_headline at most ${contracts.MAIL_WORDS.headline} words`));
  expect(all).toMatch(new RegExp(`under ${contracts.MAIL_WORDS.visual} words for the picture-led mailer`));
});

test('the asset prompt an operator copies to a model asks for the logo linked to the homepage', async () => {
  const c = await buildTemplate();
  const mp = String(c.assets.email.master_prompt_v1 || c.assets.email.master_prompt || '');
  expect(mp).toMatch(/LOGO \(header/);
  expect(mp).toMatch(/wrapped in a link to the brand's homepage \(https:\/\/aryateas\.example\)/);
});

// ── The rules, on finished artefacts ─────────────────────────────────────────
const shell = (inner, foot) => `<!doctype html><html><head><title>t</title></head><body><table role="presentation" width="600">${inner}${foot === undefined ? '<tr><td data-mail-footer>Arya Tea Estate Pvt Ltd, Kalimpong. You are receiving this because you are a customer. Manage preferences or unsubscribe.</td></tr>' : foot}</table></body></html>`;
const header = MF.logoHeader({ brand: BRAND });
const check = (a) => contracts.check(Object.assign({ contract: 'email.mailer', subject: 'Your next first flush', preheader: 'From the garden this week' }, a));
const slots = (r) => r.violations.map((x) => `${x.level}:${x.slot}`);

test('mailer rules: logo linked home, unsubscribe, honest subject, the two types, pictures, length', () => {
  const ok = check({ html: shell(`${header}<tr><td><h1>First flush</h1><p>Picked at the garden.</p><a href="https://aryateas.example/p" data-ds="button-primary">Shop now</a></td></tr>`), mailer_type: 'text' });
  expect(ok.violations).toEqual([]);
  // No logo header: blocked.
  expect(slots(check({ html: shell('<tr><td><h1>First flush</h1></td></tr>') }))).toContain('block:header');
  // A header link that is not https: blocked.
  expect(slots(check({ html: shell(MF.logoHeader({ brand: { name: 'Arya' } }) + '<tr><td>x</td></tr>') }))).toContain('block:header');
  // No unsubscribe: blocked.
  expect(slots(check({ html: shell(`${header}<tr><td>x</td></tr>`, '<tr><td>Arya Tea Estate</td></tr>') }))).toContain('block:footer');
  // A subject pretending to be a reply: blocked. Shouting and !!: warned.
  expect(slots(check({ subject: 'RE: your order', html: shell(`${header}<tr><td>x</td></tr>`) }))).toContain('block:subject');
  expect(slots(check({ subject: 'HUGE SAVINGS today!!', html: shell(`${header}<tr><td>x</td></tr>`) })).filter((s) => s === 'warn:subject').length).toBe(2);
  // A Text mailer with a picture, a Text + Visual one without.
  const pic = '<tr><td><img src="https://aryateas.example/cdn/tea.jpg" alt="Tea" width="536"></td></tr>';
  expect(slots(check({ html: shell(header + pic), mailer_type: 'text' }))).toContain('warn:html');
  expect(slots(check({ html: shell(header + pic), mailer_type: 'text_visual' }))).toEqual([]);
  expect(slots(check({ html: shell(`${header}<tr><td>x</td></tr>`), mailer_type: 'text_visual' }))).toContain('warn:html');
  // A picture over http, with no alt or width.
  expect(slots(check({ html: shell(`${header}<tr><td><img src="http://x.example/a.jpg"></td></tr>`), mailer_type: 'text_visual' }))).toEqual(expect.arrayContaining(['block:html', 'warn:html']));
  // Too much text, an overlong headline, a wall paragraph.
  const wall = `<p>${LONG} ${LONG}</p>`;
  const long = slots(check({ html: shell(`${header}<tr><td><h1>${LONG}</h1>${wall}${wall}</td></tr>`), mailer_type: 'text' }));
  expect(long).toEqual(expect.arrayContaining(['warn:copy', 'warn:hero_headline']));
  // A main button to "#".
  expect(slots(check({ html: shell(`${header}<tr><td><a href="#" data-ds="button-primary">Shop</a></td></tr>`) }))).toContain('block:cta');
});

test('ad rules: no gap marker to a stranger, no shouting, no duplicate headlines, a static ad shows a picture', () => {
  const meta = (a) => contracts.check(Object.assign({ platform: 'meta', creative_type: 'static', primary_text: 'Single-estate Kalimpong.', headline: 'Arya First Flush', creative: { image: IMG('a') } }, a));
  expect(meta({}).violations).toEqual([]);
  expect(slots(meta({ headline: '[DATA REQUIRED BEFORE LAUNCH: product, Arya, IN]' }))).toContain('block:headline');
  expect(slots(meta({ headline: 'HUGE SALE NOW' }))).toContain('warn:headline');
  expect(slots(meta({ primary_text: 'Buy now!! Click here' }))).toEqual(expect.arrayContaining(['warn:primary_text']));
  expect(slots(meta({ creative: {} }))).toContain('warn:creative');
  expect(slots(meta({ headline: 'Same line', primary_text: 'Same line' }))).toContain('warn:headline');
  const rsa = contracts.check({ platform: 'google', headlines: ['First flush', 'First flush', 'Kalimpong'], descriptions: ['One description.', 'Two description.'] });
  expect(slots(rsa)).toContain('warn:headlines');
});

// ── The brand's own logo, wherever its record holds it (2026-10-17) ─────────
// The operator: "use the brand logos itself". Only `logo_url` reached the mail
// header, so a brand whose logo sat in its read site, its assets or its icon got
// its name in type. Nothing read off another company's site is ever used.
test('the mail header takes the brand\'s own logo from anywhere on its record, then its site\'s icon, never another site\'s', () => {
  const on = (b) => withEnvSync({ FREE_GENERATION: 'on' }, () => MF.emailLogo(b));
  const site = { name: 'Arya', website: 'https://aryateas.example' };
  expect(on(Object.assign({}, site, { logo_url: 'https://aryateas.example/l.png' }))).toMatchObject({ url: 'https://aryateas.example/l.png', kind: 'logo', source: 'logo_url' });
  expect(on(Object.assign({}, site, { brand_data: { design_system: { logo: { url: 'https://cdn.aryateas.example/mark.png' } } } }))).toMatchObject({ kind: 'logo', source: 'design_system.logo' });
  expect(on(Object.assign({}, site, { brand_assets: [{ url: 'https://cdn.example/arya-logo.png', role: 'logo', found_on: 'https://aryateas.example/' }] }))).toMatchObject({ url: 'https://cdn.example/arya-logo.png', kind: 'logo' });
  expect(on(Object.assign({}, site, { favicon_url: 'https://aryateas.example/apple-touch-icon.png' }))).toMatchObject({ kind: 'icon', source: 'favicon_url' });
  // A logo read off ANOTHER company's site is passed over for the brand's own icon.
  const foreign = on(Object.assign({}, site, { brand_assets: [{ url: 'https://cdn.example/other-logo.png', role: 'logo', found_on: 'https://othercompany.example/' }] }));
  expect(foreign.url).not.toContain('other-logo');
  expect(foreign.url).toBe('https://www.google.com/s2/favicons?domain=aryateas.example&sz=256');
  // Nothing on the record but the website: the icon its site publishes.
  expect(on(site)).toMatchObject({ kind: 'icon', url: 'https://www.google.com/s2/favicons?domain=aryateas.example&sz=256' });
  // The header renders it, linked home, an icon at an icon's size.
  const h = withEnvSync({ FREE_GENERATION: 'on' }, () => MF.logoHeader({ brand: site }));
  expect(h).toMatch(/<a href="https:\/\/aryateas\.example"[^>]*><img src="https:\/\/www\.google\.com\/s2\/favicons\?domain=aryateas\.example&amp;sz=256" alt="Arya" width="48"/);
  // A template mail for a brand with no logo_url still opens with an image.
  expect(contracts.check({ contract: 'email.mailer', subject: 's', preheader: 'p', html: `<html><body><table>${h}<tr><td>x</td></tr><tr><td data-mail-footer>unsubscribe</td></tr></table></body></html>` }).violations.filter((v) => v.slot === 'header')).toEqual([]);
});
