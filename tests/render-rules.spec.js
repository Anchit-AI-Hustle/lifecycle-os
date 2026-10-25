// "Kill the AI Tell": the render rules for Higgsfield and Seedance (2026-10-25).
// The operator, with the card ("Make Higgsfield & Seedance stop looking like
// AI by default"): "Integrate everything mentioned". The first cut put the
// rules into every image and video prompt the app writes; the operator: "Still
// using the wrong approach", then chose (1) a skill holding the card and (2)
// real renders through Higgsfield / Seedance. So:
//   - the card lives whole in .claude/commands/kill-the-ai-tell.md, its blocks
//     byte-equal to api/_shared/render-rules.js;
//   - the generic prompts (image-prompt.js, Pollo, Veo) carry none of it;
//   - the Seedance request on Higgsfield carries it (tests/higgsfield-seedance.spec.js).
// Executed: the shipped prompt builders and the shipped video cascade over a
// fetch that answers exactly the documented requests and throws on anything else.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RR = require(path.join(ROOT, 'api', '_shared', 'render-rules.js'));
const IP = require(path.join(ROOT, 'api', '_shared', 'image-prompt.js'));
const VC = path.join(ROOT, 'api', '_shared', 'video-core.js');
const WC = path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js');
const SUBMIT = 'https://pollo.ai/api/platform/v1/generation/kling-ai/kling-v2-5-turbo/video';
const PHOTO = 'https://shop.example/cdn/bag.jpg';
const BRAND = { name: 'Fernwick Roasters', industry: 'Coffee roaster', palette: { primary: '#7a3b1f', accent: '#e8b04a', surface: '#fffaf2', ink: '#2b1a10' } };
const RULE_WORDS = /window spill|<render_rules>|REALISM \(phone camera|a third of a stop under|Phone-camera realism/;

test('the card is all here: four tells, three lighting rules, three bans, three opening rules, five re-prompts, four drift checks, the compact block', () => {
  expect(RR.TELLS.map((t) => t.id)).toEqual(['flat_light', 'eye_contact', 'plastic_skin', 'phantom_hands']);
  expect(RR.LIGHTING.map((t) => t.id)).toEqual(['underexposed', 'mixed_temp', 'window_spill']);
  expect(RR.BANS.map((t) => t.id)).toEqual(['giveaway', 'production', 'filler']);
  expect(RR.OPENING.map((t) => t.id)).toEqual(['micro_glitch', 'object_out_of_place', 'phone_light']);
  expect(Object.keys(RR.QUICK_FIX)).toEqual(['too_clean', 'stares', 'plastic', 'too_still', 'too_staged']);
  expect(RR.DRIFT.length).toBe(4);
  for (const line of ['light: phone-camera, -1/3 stop, mixed temp, window spill', 'ban (if a person is in frame; never add one): unbroken gaze, perfect posture, plastic skin, phantom hands',
    'cut: sighs, hair tucks, idle off-camera glances (keep the one phone-screen glance)', 'open: 1 micro-glitch, 1 object out of place', 'no: cinema grade, empty set, magazine framing']) {
    expect(RR.COMPACT).toContain(line);
  }
});

test('the skill holds the whole card, and its two blocks are the ones the Seedance request carries', () => {
  const skill = fs.readFileSync(path.join(ROOT, '.claude', 'commands', 'kill-the-ai-tell.md'), 'utf8');
  expect(skill.startsWith('---\nname: kill-the-ai-tell\n')).toBe(true);
  expect(skill).toContain('/brand-context');
  // The blocks, byte for byte: change one and the other must change with it.
  expect(skill).toContain('```\n' + RR.COMPACT + '\n```');
  expect(skill).toContain('```\n' + RR.COMPACT_PACKSHOT + '\n```');
  for (const t of RR.TELLS) expect(skill, t.id).toContain(t.tell);
  for (const l of RR.LIGHTING) expect(skill, l.id).toContain(l.rule);
  for (const o of RR.OPENING) expect(skill, o.id).toContain(o.rule);
  for (const b of RR.BANS) for (const item of b.items.filter((x) => !/^zero /.test(x))) expect(skill.toLowerCase(), item).toContain(item.toLowerCase());
  for (const f of Object.values(RR.QUICK_FIX)) expect(skill, f.problem).toContain('| ' + f.problem + ' | "' + f.reprompt + '" |');
  for (const f of Object.values(RR.QUICK_FIX_PACKSHOT).filter((x) => x !== RR.QUICK_FIX.too_clean)) expect(skill, f.problem).toContain(f.reprompt);
  for (const d of RR.DRIFT) expect(skill, d.symptom).toContain('**' + d.symptom + '**');
  expect(skill).toMatch(/It does not pick your hook/);
  // It names the API the app actually calls.
  expect(skill).toContain('https://api.higgsfield.ai/bytedance/seedance-2.0/image-to-video');
  expect(skill).toContain('Authorization: Key <key id>:<secret>');
});

test('the generic image prompts carry no render rules: every mode, the full preamble and the short guard', () => {
  for (const mode of ['photo', 'ad', 'reels', 'ambient', 'design']) {
    expect(IP.buildPreamble(BRAND, mode), mode).not.toMatch(RULE_WORDS);
    expect(IP.buildPreamble(BRAND, mode, { compact: true }), mode).not.toMatch(RULE_WORDS);
    expect(IP.compactGuard(mode, { brand: BRAND }), mode).not.toMatch(RULE_WORDS);
    expect(IP.buildPreamble(BRAND, mode), mode).toContain(IP.QUALITY);
  }
  expect(IP.REAL_QUALITY).toBeUndefined();
});

function net(answer) {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const out = answer(u, init);
    if (!out) throw new Error('unrouted request: ' + u);
    return new Response(JSON.stringify(out.body), { status: out.status || 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { global.fetch = real; } };
}
function loadVC(media, ov) {
  delete require.cache[VC];
  const wc = require(WC);
  wc.mediaKeysForCurrentRequest = async () => media;
  wc.llmOverridesForCurrentRequest = async () => ov || null;
  return require(VC);
}

test('Pollo is sent the brief as written: no render rules, with or without the product photo', async () => {
  const n = net((u, init) => (u === SUBMIT && init.method === 'POST' ? { body: { taskId: 't-' + n.calls.length } } : null));
  try {
    const vc = loadVC({ pollo: { api_key: 'workspace-key' } });
    await vc.generateVideo({ prompt: 'A customer unboxes the bag at the kitchen table', duration_s: 8, aspect: '9:16' });
    expect(n.calls[0].body.input.prompt).toBe('A customer unboxes the bag at the kitchen table');
    await vc.generateVideo({ prompt: 'Slow push in on the bag', duration_s: 8, aspect: '9:16', motion: { images: [PHOTO] } });
    expect(n.calls[1].body.input).toMatchObject({ image: PHOTO, prompt: 'Slow push in on the bag' });
  } finally { n.restore(); delete require.cache[VC]; }
});

test('Veo on the workspace\'s Gemini connection is sent the brief as written', async () => {
  const VEO = 'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning';
  const n = net((u) => (u === VEO + '?key=own-gemini' ? { body: { name: 'operations/op-1' } } : (u.includes('operations/op-1') ? { body: { name: 'operations/op-1', done: false } } : null)));
  try {
    const vc = loadVC(null, { keys: { gemini: 'own-gemini' } });
    await vc.generateVideo({ prompt: 'Slow push in on the bag', duration_s: 8, aspect: '9:16', budget_ms: 3000, motion: { images: [PHOTO] } });
    expect(n.calls.find((c) => c.url.startsWith(VEO)).body.instances[0].prompt).toBe('Slow push in on the bag');
  } finally { n.restore(); delete require.cache[VC]; }
});

test('the shot and story briefs carry no render rules (the skill and the Seedance request do)', () => {
  const motion = require(path.join(ROOT, 'scripts', 'lib', 'motion-ad.js'));
  const brief = motion.motionBrief({ brand: BRAND, product: 'House blend', scenes: [{ image: PHOTO, headline: 'Roasted on Tuesdays' }], cta: 'Shop now' });
  expect(brief.render_rules).toBeUndefined();
  expect(JSON.stringify(brief)).not.toMatch(RULE_WORDS);
  const story = require(path.join(ROOT, 'scripts', 'lib', 'story-ad.js'));
  const sb = story.storyBrief({ brandName: 'Fernwick Roasters', hook: 'Fresh this week', products: [{ title: 'House blend', price: '£9', image: PHOTO }], cta: 'Shop now' });
  expect(sb.render_rules).toBeUndefined();
});

test('withRules: a packshot gets the packshot block (nothing added), a scene the full one, never both', () => {
  const shot = RR.withRules('Slow push in on the bag', { medium: 'video', packshot: true });
  expect(shot).toMatch(/move only the camera and the light, add nothing to it/);
  expect(shot).toContain(RR.COMPACT_PACKSHOT);
  expect(shot).not.toMatch(/object out of place/);
  const scene = RR.withRules('A customer unboxes the bag', { medium: 'video', people: true });
  expect(scene).toContain(RR.COMPACT);
  expect(scene).toMatch(/If a person is in frame \(never add one\), opening 3 seconds: one micro-glitch/);
  expect(scene).toMatch(/With no person: one handheld micro-shake/);
  expect(scene).toMatch(/no sighs, hair tucks or idle off-camera glances/);
});

test('a prompt that already carries a block (pasted from the skill) is normalised to the one that fits this frame', () => {
  const pasted = 'Customer unboxes the bag.\n' + RR.COMPACT;
  const shot = RR.withRules(pasted, { medium: 'video', packshot: true });
  expect(shot).toContain(RR.COMPACT_PACKSHOT);
  expect(shot).not.toMatch(/object out of place/);
  expect(shot.split('<render_rules>').length).toBe(2);
  const back = RR.withRules(shot, { medium: 'video', people: true });
  expect(back).toContain(RR.COMPACT);
  expect(back).not.toContain('add nothing, the photo is the product');
  expect(back.split('REALISM (phone camera').length).toBe(2);
});

test('a long brief is cut before the compact block is', () => {
  const fitted = RR.fit(RR.withRules('b'.repeat(1400), { medium: 'video', packshot: true }), 1500);
  expect(fitted.length).toBeLessThanOrEqual(1500);
  expect(fitted.endsWith(RR.COMPACT_PACKSHOT)).toBe(true);
});

test('the guard a 1,500-character provider gets first keeps every fabrication ban, and lets an ad or a design carry its own lines', () => {
  for (const mode of ['photo', 'ad', 'reels', 'ambient', 'design']) {
    const g = IP.compactGuard(mode);
    expect(g, mode).toMatch(/no fake candlestick charts, price tickers, portfolio balances or return figures/);
    expect(g, mode).toMatch(/actual retail packaging or labels/);
  }
  expect(IP.compactGuard('design')).toMatch(/any text beyond the lines supplied/);
  expect(IP.compactGuard('ad')).toMatch(/any text beyond the lines supplied/);
  expect(IP.compactGuard('photo')).toMatch(/readable text/);
  expect(IP.compactGuard('photo', { product: { title: 'House blend' } })).toMatch(/Show only the product: add no other object/);
  expect(IP.buildPreamble(BRAND, 'photo', { compact: true })).not.toContain(IP.NEVER_SHORT);
});

test('the guard a short provider gets keeps the brand kind\'s own ban: no synthetic people for a news brand', () => {
  const news = { name: 'Quillforth Gazette', industry: 'News publisher', palette: BRAND.palette };
  expect(IP.subjectFor(news).caution).toMatch(/synthetic politicians/);
  for (const mode of ['photo', 'ad', 'reels', 'design']) expect(IP.compactGuard(mode, { brand: news }), mode).toMatch(/synthetic politicians\/people/);
  expect(IP.compactGuard('photo', { brand: news, product: { title: 'Weekend edition' } })).toMatch(/Show only this product/);
});

test('the compact preamble keeps the brand\'s style lock and type, bounded', () => {
  const b = Object.assign({}, BRAND, { brand_data: { style_lock: { photo_style: 'Overhead daylight on raw linen, ' + 'x'.repeat(500), rules: ['Never show a hand', 'Always a terracotta prop', 'third rule'] } } });
  const c = IP.buildPreamble(b, 'photo', { compact: true });
  expect(c).toMatch(/Photo style: Overhead daylight on raw linen/);
  expect(c).toMatch(/Never break: Never show a hand Always a terracotta prop/);
  expect(c).not.toMatch(/third rule/);
  expect(c.length).toBeLessThan(1000);
});
