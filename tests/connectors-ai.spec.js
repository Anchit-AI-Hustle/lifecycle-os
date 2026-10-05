// Connectors — workspace AI models are configurable on the same page as
// deployment connector health. The browser test exercises the actual page and
// records every POST, so this does not pass by asserting strings in the source.
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let server; let base; let posts; let mode;

const providers = [
  {
    id: 'openai', label: 'OpenAI (ChatGPT)', category: 'ai', llm_provider: 'openai',
    blurb: 'GPT models.', key_url: 'https://platform.openai.com/api-keys',
    fields: [{ key: 'api_key', label: 'API key', secret: true, required: true, placeholder: '' }],
    known_models: ['gpt-5.6', 'gpt-5-mini'], platform_default: true,
  },
  {
    id: 'ollama', label: 'Ollama (self hosted)', category: 'ai', llm_provider: 'ollama',
    blurb: 'Your own Ollama server.', key_url: '',
    fields: [
      { key: 'base_url', label: 'Base URL', secret: false, required: true, placeholder: 'https://ollama.example' },
      { key: 'api_key', label: 'Token', secret: true, required: false, placeholder: '' },
    ],
    known_models: ['llama3.3'], platform_default: false,
  },
];

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');

    if (u.pathname === '/auth.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(
        'window.LifecycleAuth={session:{access_token:"session-token"}};' +
        'window.LifecycleStatus={decide:async function(){return null;}};'
      );
    }

    if (u.pathname === '/api/brain' && u.searchParams.get('action') === 'os-connectors') {
      return json(res, 200, {
        ok: true,
        summary: { connected: 1, partial: 0, not_connected: 1, total: 2, persisted: true },
        connectors: [
          { id: 'shopify', name: 'Shopify', category: 'commerce', state: 'connected', required_env_vars: [], missing_env_vars: [], include_in_daily_job: true },
          { id: 'meta_ads', name: 'Meta Ads', category: 'ads', state: 'not_connected', required_env_vars: ['META_ACCESS_TOKEN'], missing_env_vars: ['META_ACCESS_TOKEN'], include_in_daily_job: true },
        ],
      });
    }

    if (u.pathname === '/api/public-config' && u.searchParams.get('action') === 'connections') {
      const op = u.searchParams.get('op') || 'list';
      if (req.method === 'GET' && op === 'list') {
        if (mode === 'device') {
          return json(res, 200, {
            ok: true, storage: 'device',
            note: 'This brand is kept on this device, so no platform account is connected to it, and none can be connected from here.',
            providers, connections: [], routing: { entries: [], use_platform_fallback: true },
            secrets_storage: { encrypted: true, store: true },
          });
        }
        return json(res, 200, {
          ok: true, providers,
          connections: [{
            provider: 'openai', configured: true, secret_fields: ['api_key'], secret_hint: '4242',
            config: {}, status: 'active', last_check_ok: true, last_check_note: 'Answered on gpt-5.6.',
          }],
          routing: { entries: [{ provider: 'openai', models: ['gpt-5.6'], enabled: true }], use_platform_fallback: true },
          secrets_storage: { encrypted: true, store: true },
        });
      }

      let raw = '';
      req.on('data', (c) => { raw += c; });
      return req.on('end', () => {
        let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch (_) {}
        posts.push({ op, body, authorization: req.headers.authorization || '' });
        if (op === 'check') return json(res, 200, { ok: true, note: 'Answered on gpt-5.6.' });
        if (op === 'delete') return json(res, 200, { ok: true, deleted: body.provider });
        if (op === 'routing-save') return json(res, 200, { ok: true, routing: body.routing });
        return json(res, 200, { ok: true, connection: { provider: body.provider } });
      });
    }

    const file = path.join(ROOT, u.pathname === '/' ? 'connectors.html' : u.pathname.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript' : 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

test.afterAll(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });
test.beforeEach(() => { posts = []; mode = 'workspace'; });

async function open(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await page.goto(base + '/connectors.html', { waitUntil: 'load' });
  await expect(page.locator('#ai-providers .conn')).toHaveCount(2);
  await expect(page.locator('#content .conn')).toHaveCount(2);
  return errors;
}

test('the Connectors page shows workspace AI providers without exposing stored keys', async ({ page }) => {
  const errors = await open(page);

  await expect(page.locator('#ai-storage')).toContainText('AES-256-GCM');
  const openai = page.locator('#ai-providers .conn[data-ai-provider="openai"]');
  await expect(openai).toContainText('Your key');
  await expect(openai.locator('input[type=password]')).toHaveAttribute('placeholder', /ending 4242/);
  await expect(openai.locator('input[type=password]')).toHaveValue('');
  expect((await page.locator('body').innerText())).not.toContain('session-token');

  await expect(page.locator('#ai-routing .route-step')).toHaveCount(1);
  await expect(page.locator('#ai-routing')).toContainText('OpenAI');
  await expect(page.locator('#ai-routing .mchip[aria-pressed="true"]')).toContainText('gpt-5.6');
  expect(errors).toEqual([]);
});

test('a user can save their own provider key from Connectors and the browser sends auth', async ({ page }) => {
  await open(page);
  const openai = page.locator('#ai-providers .conn[data-ai-provider="openai"]');
  await openai.locator('input[type=password]').fill('sk-user-private-value');
  await openai.locator('[data-ai-act="save"]').click();

  await expect.poll(() => posts.filter((x) => x.op === 'save').length).toBe(1);
  const p = posts.find((x) => x.op === 'save');
  expect(p.authorization).toBe('Bearer session-token');
  expect(p.body).toEqual({ provider: 'openai', fields: { api_key: 'sk-user-private-value' } });

  // The list reload rebuilds the form from the sanitised server response. The
  // key is never rendered back into the page.
  await expect(openai.locator('input[type=password]')).toHaveValue('');
});

test('custom model ids and provider fallback are saved as workspace routing', async ({ page }) => {
  await open(page);

  const custom = page.locator('#ai-routing [data-route-custom="0"]');
  await custom.fill('gpt-my-account-preview');
  await custom.press('Enter');
  await expect(page.locator('#ai-routing .mchip[aria-pressed="true"]')).toContainText(['gpt-5.6', 'gpt-my-account-preview']);

  await page.locator('#ai-fallback').selectOption('0');
  await page.locator('#ai-save-routing').click();
  await expect.poll(() => posts.filter((x) => x.op === 'routing-save').length).toBe(1);

  const p = posts.find((x) => x.op === 'routing-save');
  expect(p.body.routing.use_platform_fallback).toBe(false);
  expect(p.body.routing.entries[0]).toMatchObject({
    provider: 'openai',
    models: ['gpt-5.6', 'gpt-my-account-preview'],
    enabled: true,
  });
});

test('device/demo mode explains why keys cannot be stored and disables writes', async ({ page }) => {
  mode = 'device';
  await open(page);
  await expect(page.locator('#ai-storage')).toContainText('kept on this device');
  await expect(page.locator('#ai-providers [data-ai-act="save"]').first()).toBeDisabled();
  await expect(page.locator('#ai-routing')).toContainText('platform default');
});
