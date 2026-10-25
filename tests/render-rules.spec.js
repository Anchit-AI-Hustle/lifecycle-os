// "Kill the AI Tell": the render rules every generated scene and video carries
// (2026-10-25). The operator, with the card ("Make Higgsfield & Seedance stop
// looking like AI by default"): "Integrate everything mentioned".
//
// Executed: the shipped prompt builders (image-prompt.js), the shipped video
// cascade (video-core.js over a fetch that answers exactly the documented
// Pollo request and throws on anything else), and the shipped motion and
// story briefs. Each rule is read from what a model would actually be sent.
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RR = require(path.join(ROOT, 'api', '_shared', 'render-rules.js'));
const IP = require(path.join(ROOT, 'api', '_shared', 'image-prompt.js'));
const VC = path.join(ROOT, 'api', '_shared', 'video-core.js');
const WC = path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js');
const SUBMIT = 'https://pollo.ai/api/platform/v1/generation/kling-ai/kling-v2-5-turbo/video';
const PHOTO = 'https://shop.example/cdn/bag.jpg';
const BRAND = { name: 'Fernwick Roasters', industry: 'Coffee roaster', palette: { primary: '#7a3b1f', accent: '#e8b04a', surface: '#fffaf2', ink: '#2b1a10' } };

test('the card is all here: four tells, three lighting rules, three bans, three opening rules, five re-prompts, four drift checks, the compact block', () => {
  expect(RR.TELLS.map((t) => t.id)).toEqual(['flat_light', 'eye_contact', 'plastic_skin', 'phantom_hands']);
  expect(RR.LIGHTING.map((t) => t.id)).toEqual(['underexposed', 'mixed_temp', 'window_spill']);
  expect(RR.BANS.map((t) => t.id)).toEqual(['giveaway', 'production', 'filler']);
  expect(RR.OPENING.map((t) => t.id)).toEqual(['micro_glitch', 'object_out_of_place', 'phone_light']);
  expect(Object.keys(RR.QUICK_FIX)).toEqual(['too_clean', 'stares', 'plastic', 'too_still', 'too_staged']);
  expect(RR.DRIFT.length).toBe(4);
  for (const line of ['light: phone-camera, -1/3 stop, mixed temp, window spill', 'ban: unbroken gaze, perfect posture, plastic skin, phantom hands',
    'cut: sighs, hair tucks, off-camera glances', 'open: 1 micro-glitch, 1 object out of place', 'no: cinema grade, empty set, magazine framing']) {
    expect(RR.COMPACT).toContain(line);
  }
});

test('every real-looking image mode carries the rules and the phone-camera quality line; a design mockup keeps the studio line', () => {
  for (const mode of ['photo', 'ad', 'reels', 'ambient']) {
    const p = IP.buildPreamble(BRAND, mode);
    expect(p, mode).toMatch(/a third of a stop under/);
    expect(p, mode).toMatch(/mixed colour temperature/);
    expect(p, mode).toMatch(/window spill/);
    expect(p, mode).toMatch(/no cinema-grade colour grade, no empty-set staging, no magazine-styled framing/);
    expect(p, mode).toContain(IP.REAL_QUALITY);
    expect(p, mode).not.toContain(IP.QUALITY);
    expect(p, mode).not.toMatch(/graded like a film still|Cinematic 9:16|natural soft lighting/);
  }
  // A person may be in a photo or an ad: the person rules ride along. An
  // ambient backdrop has no one in it.
  expect(IP.buildPreamble(BRAND, 'photo')).toMatch(/no unbroken gaze/);
  expect(IP.buildPreamble(BRAND, 'ambient')).not.toMatch(/no unbroken gaze/);
  const design = IP.buildPreamble(BRAND, 'design');
  expect(design).not.toMatch(/window spill/);
  expect(design).toContain(IP.QUALITY);
});

test('the out-of-place object is ordinary, never a product, packaging, logo or text, and the anti-fabrication rules still close the prompt', () => {
  const p = IP.buildPreamble(BRAND, 'photo');
  expect(p).toMatch(/one ordinary object out of place \(a mug, a charger cable\), never a product, packaging, logo, sign or readable text/);
  expect(p.indexOf(IP.NEVER)).toBeGreaterThan(p.indexOf('window spill'));
});

function pollo(answer) {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, body: init.body ? JSON.parse(init.body) : null });
    const out = answer(u, init);
    if (!out) throw new Error('unrouted request: ' + u);
    return new Response(JSON.stringify(out.body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { global.fetch = real; } };
}
function loadVC() {
  delete require.cache[VC];
  const wc = require(WC);
  wc.mediaKeysForCurrentRequest = async () => ({ pollo: { api_key: 'workspace-key' } });
  wc.llmOverridesForCurrentRequest = async () => null;
  return require(VC);
}

test('a video model is sent the rules with the compact block; over the product\'s own photo only the camera and light move', async () => {
  const net = pollo((u, init) => (u === SUBMIT && init.method === 'POST' ? { body: { taskId: 't-' + net.calls.length, status: 'waiting' } } : null));
  try {
    const vc = loadVC();
    await vc.generateVideo({ prompt: 'A customer unboxes the bag at the kitchen table', duration_s: 8, aspect: '9:16' });
    const t2v = net.calls[0].body.input.prompt;
    expect(t2v.startsWith('A customer unboxes the bag at the kitchen table')).toBe(true);
    expect(t2v).toContain(RR.COMPACT);
    expect(t2v).toMatch(/exactly one micro-glitch/);
    expect(t2v).toMatch(/eye contact breaks by 0:02/);
    expect(t2v.length).toBeLessThanOrEqual(1500);

    await vc.generateVideo({ prompt: 'Slow push in on the bag', duration_s: 8, aspect: '9:16', motion: { images: [PHOTO] } });
    const i2v = net.calls[1].body.input;
    expect(i2v.image).toBe(PHOTO);
    expect(i2v.prompt).toMatch(/move only the camera and the light, add nothing to it/);
    expect(i2v.prompt).not.toMatch(/object out of place \(a mug/);
    expect(i2v.prompt).toContain(RR.COMPACT);
  } finally { net.restore(); delete require.cache[VC]; }
});

test('a long brief is cut before the compact block is: the block always reaches the model', () => {
  const long = RR.withRules('b'.repeat(1400), { medium: 'video' });
  const fitted = RR.fit(long, 1500);
  expect(fitted.length).toBeLessThanOrEqual(1500);
  expect(fitted.endsWith(RR.COMPACT)).toBe(true);
  expect(RR.withRules(long, { medium: 'video' })).toBe(long);
});

test('the shot brief and the story brief ask for a phone-camera look, never a filmic grade, and carry the re-prompts', () => {
  const motion = require(path.join(ROOT, 'scripts', 'lib', 'motion-ad.js'));
  const brief = motion.motionBrief({ brand: BRAND, product: 'House blend', scenes: [{ image: PHOTO, headline: 'Roasted on Tuesdays' }], cta: 'Shop now' });
  const s = JSON.stringify(brief);
  expect(s).not.toMatch(/filmic|Cinematic/);
  expect(brief.grade).toMatch(/never a cinema-grade colour grade/);
  for (const sh of brief.shots) expect(sh.video_prompt).toMatch(/phone-camera look/);
  expect(brief.render_rules.compact_block).toBe(RR.COMPACT);
  expect(brief.render_rules.quick_fixes.map((f) => f.problem)).toEqual(['Too clean', 'Stares', 'Plastic', 'Too still', 'Too staged']);
  expect(brief.render_rules.check_first).toMatch(/Frame 1/);

  const story = require(path.join(ROOT, 'scripts', 'lib', 'story-ad.js'));
  const sb = story.storyBrief({ brandName: 'Fernwick Roasters', hook: 'Fresh this week', products: [{ title: 'House blend', price: '£9', image: PHOTO }], cta: 'Shop now' });
  expect(sb.render_rules.compact_block).toBe(RR.COMPACT);
  for (const sc of sb.scenes.filter((x) => x.motion)) expect(sc.motion).toMatch(/phone-camera look with no cinema grade/);
});
