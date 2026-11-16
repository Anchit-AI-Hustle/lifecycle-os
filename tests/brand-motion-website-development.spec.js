// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const leads = require(path.join(ROOT, 'api', '_shared', 'leads.js'));
const lpCraft = require(path.join(ROOT, 'api', '_shared', 'lp-craft.js'));

test.describe('Brand Motion Studios - Futuristic Web Design & 3D Web Integration', () => {
  test('prompts.md exists and contains all 6 drawers, 10-part anatomy, and 15 3D master prompts', () => {
    const promptsPath = path.join(ROOT, 'prompts.md');
    expect(fs.existsSync(promptsPath), 'prompts.md must exist in root').toBe(true);
    const text = fs.readFileSync(promptsPath, 'utf8');

    // 6 drawers
    expect(text).toContain('## 1. Start Drawer');
    expect(text).toContain('## 2. Build Drawer');
    expect(text).toContain('## 3. Fix Drawer');
    expect(text).toContain('## 4. Assets Drawer');
    expect(text).toContain('## 5. Finish Drawer');
    expect(text).toContain('## 6. Going Further');

    // 10-part website anatomy
    expect(text).toContain('1. Nav');
    expect(text).toContain('2. Hero');
    expect(text).toContain('3. Social Proof');
    expect(text).toContain('4. Products or Offerings');
    expect(text).toContain('5. Story');
    expect(text).toContain('6. Testimonials');
    expect(text).toContain('7. Pricing');
    expect(text).toContain('8. FAQ');
    expect(text).toContain('9. Final Call to Action');
    expect(text).toContain('10. Footer');

    // 5 cinematic moves rule
    expect(text).toContain('A slow video hero plus max 1 or 2 cinematic moves');
    expect(text).toContain('Never all five');

    // 15 3D prompt archetypes
    const expectedArchetypes = [
      'Moss Perfume', 'Ring Atelier', 'Lattice Cube', 'Terra Nav', 'Toon Portfolio',
      'Runway Muse', 'Curved Gallery', 'Sport Shades', 'Terrain Card', 'Robot Head',
      'Liquid Chrome', 'Particle Type', 'Gradient Ribbons', 'Data Globe', 'App Showcase'
    ];
    for (const arch of expectedArchetypes) {
      expect(text, `Must include 3D archetype: ${arch}`).toContain(arch);
    }
  });

  test('.claude/skills/new-section/SKILL.md exists and matches Appendix D recipe card', () => {
    const skillPath = path.join(ROOT, '.claude', 'skills', 'new-section', 'SKILL.md');
    expect(fs.existsSync(skillPath), 'SKILL.md must exist').toBe(true);
    const content = fs.readFileSync(skillPath, 'utf8');
    expect(content).toContain('name: new-section');
    expect(content).toContain('Build a new section for this website');
    expect(content).toContain('Check it at 390px, 768px and 1440px wide');
    expect(content).toContain('spacing above and below matches');
  });

  test('leads.js validates required fields and RFC email format', async () => {
    expect(leads.isValidEmail('test@example.com')).toBe(true);
    expect(leads.isValidEmail('invalid-email')).toBe(false);
    expect(leads.isValidEmail('test@')).toBe(false);
    expect(leads.isValidEmail('')).toBe(false);

    // Missing name
    await expect(leads.submitLead({ email: 'hello@brand.com', message: 'Hi' }))
      .rejects.toThrow('Please enter your name.');

    // Missing email
    await expect(leads.submitLead({ name: 'Alex', email: 'bademail', message: 'Hi' }))
      .rejects.toThrow('Please enter a valid email address.');

    // Missing message
    await expect(leads.submitLead({ name: 'Alex', email: 'alex@example.com', message: '' }))
      .rejects.toThrow('Please enter a message.');
  });

  test('leads.js traps spam bots silently when honeypot field is filled', async () => {
    const result = await leads.submitLead({
      name: 'Bot Spammer',
      email: 'spam@bot.com',
      message: 'Cheap sunglasses',
      _gotcha: 'http://spam.ru',
    });
    expect(result.ok).toBe(true);
    expect(result.bot_trapped).toBe(true);
    expect(result.message).toContain('Thank you for reaching out');
  });

  test('leads.js stores legitimate lead in fallback store or Supabase', async () => {
    const res = await leads.submitLead({
      name: 'Sarah Connor',
      email: 'sarah@resistance.org',
      message: 'Inquiring about sustainable footwear line.',
      brand_slug: 'knickgasm',
      market: 'US',
    });
    expect(res.ok).toBe(true);
    expect(res.id).toBeTruthy();
    expect(res.message).toContain('Thank you for reaching out');
  });

  test('public-config.js handles leads endpoint with GET refusal and POST acceptance', async () => {
    const handler = require(path.join(ROOT, 'api', 'public-config.js'));

    // Test GET method refusal (405)
    let getStatus = 0;
    let getBody = null;
    const reqGet = {
      query: { action: 'leads' },
      method: 'GET',
      headers: {},
    };
    const resGet = {
      setHeader: () => {},
      status: (code) => {
        getStatus = code;
        return {
          json: (b) => { getBody = b; return b; },
        };
      },
    };
    await handler(reqGet, resGet);
    expect(getStatus).toBe(405);
    expect(getBody.error).toBe('method_not_allowed');

    // Test valid POST
    let postStatus = 0;
    let postBody = null;
    const reqPost = {
      query: { action: 'leads' },
      method: 'POST',
      body: {
        name: 'Jordan Belfort',
        email: 'jordan@strattonevents.com',
        message: 'Looking to license brand creative assets.',
      },
      headers: { 'content-type': 'application/json' },
    };
    const resPost = {
      setHeader: () => {},
      status: (code) => {
        postStatus = code;
        return {
          json: (b) => { postBody = b; return b; },
        };
      },
    };
    await handler(reqPost, resPost);
    expect(postStatus).toBe(200);
    expect(postBody.ok).toBe(true);
    expect(postBody.id).toBeTruthy();
  });

  test('storefront-3d.html supports embed mode styles, tour parameter, and presets', () => {
    const html = fs.readFileSync(path.join(ROOT, 'storefront-3d.html'), 'utf8');
    expect(html).toContain('body.embed-mode');
    expect(html).toContain("const isTour = _q.has('tour')");
    expect(html).toContain("_q.has('embed')");
    expect(html).toContain("presetParam");
  });

  test('lp-craft.js embeds contact script and 3D lazy script when corresponding tags are present', () => {
    const pageWithForm = '<!doctype html><html><head><title>Test</title></head><body><main id="main"><form class="contact-form"></form></main></body></html>';
    const finishedForm = lpCraft.finish(pageWithForm, {});
    expect(finishedForm).toContain('data-lp-contact-js');

    const pageWith3D = '<!doctype html><html><head><title>Test</title></head><body><main id="main"><div data-3d-scene="cube"></div></main></body></html>';
    const finished3D = lpCraft.finish(pageWith3D, {});
    expect(finished3D).toContain('data-lp-3d-lazy');
  });
});
