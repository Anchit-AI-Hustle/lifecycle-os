/**
 * knickgasm3d-bridge.js — no-build ESM bridge for the static HTML pages.
 * ---------------------------------------------------------------------------
 * The React `Knickgasm3DConnectorEngine` lives in the bundled marketing_automation
 * app. The vanilla static pages (home, landing pages, official-designs) cannot
 * import a TSX module, so this bridge re-implements the same behaviour in plain
 * ESM: it detects the render tier, parses the host for Meta-ads landers, reads
 * the SAME dual-data sources, injects the brand theme, and mounts a continuous
 * three.js scene of floating product panels — with an automatic fast 2D
 * fallback for low-end / mobile / reduced-motion / no-WebGL / crawler traffic.
 *
 * Usage (in any static page):
 *   <div data-knickgasm3d data-region="us"></div>
 *   <script type="module">
 *     import { mountKnickgasm3D } from '/assets/knickgasm3d-bridge.js';
 *     document.querySelectorAll('[data-knickgasm3d]').forEach(el => mountKnickgasm3D(el));
 *   </script>
 *
 * Data sources (mirrors the engine's hierarchy):
 *   catalog/pricing → same-origin /data/catalog/products_{region}.json
 *                     (built from Shopify, served CORS-enabled) with a public
 *                     Shopify /products.json fallback.
 *   historical      → /api/brain?action=snowflake-metrics (Snowflake mirror).
 */

const THREE_CDN = 'https://esm.sh/three@0.169.0';

/* ── Brand constants (source of truth: Brand style guide) ─────────────────── */
export const BRAND = {
  primary: '#6A33D8',
  accent: '#D0473E',
  ink: '#111111',
  surface: '#F7F5F2',
  headingFont: "'Montserrat','Raleway',Georgia,serif",
  bodyFont: "'Instrument Sans','Helvetica Neue',Arial,sans-serif",
};

const STORE = {
  us: { base: 'https://knickgasm.com', ccy: '$', lander: /^try\.knickgasm\.com$/i },
  uk: { base: 'https://knickgasm.com', ccy: '£', lander: /^try\.knickgasm\.co\.uk$/i },
  global: { base: 'https://knickgasm.com', ccy: '$', lander: /^try\.knickgasm\.global$/i },
};
const META_LANDER_RE = /^try\.knickgasm\.(com|co\.uk|global)$/i;

/* ── Routing ──────────────────────────────────────────────────────────────── */
export function parseRoute(host, pathname, regionHint) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  const isMetaLander = META_LANDER_RE.test(h);
  let region = regionHint || 'us';
  if (!regionHint) {
    if (/\.co\.uk$/i.test(h) || h === 'knickgasm.com') region = 'uk';
    else if (/\.global$/i.test(h)) region = 'global';
  }
  let isolatedHandle = null;
  if (isMetaLander) {
    const seg = String(pathname || '').split('/').filter(Boolean)[0];
    isolatedHandle = seg ? decodeURIComponent(seg) : null;
  }
  return { region, isMetaLander, isolatedHandle, base: (STORE[region] || STORE.us).base };
}

/* ── Capability detection → render tier ───────────────────────────────────── */
function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch (_) { return false; }
}
function detectTier(override) {
  if (override) return override;
  const ua = (navigator.userAgent || '');
  if (/bot|crawl|spider|slurp|facebookexternalhit|lighthouse|headless/i.test(ua)) return '2d';
  try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return '2d'; } catch (_) {}
  if (!hasWebGL()) return '2d';
  const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency;
  if ((typeof mem === 'number' && mem <= 2) || (typeof cores === 'number' && cores <= 2)) return '2d';
  return '3d';
}

/* ── Brand CSS variable injection ─────────────────────────────────────────── */
export function injectBrandCSSVars(theme) {
  const r = document.documentElement;
  // Var names mirror the architecture spec (--knickgasm-green/-lava/-font); values
  // stay locked to the brand style guide.
  r.style.setProperty('--knickgasm-green', theme.primary);
  r.style.setProperty('--knickgasm-lava', theme.accent);
  r.style.setProperty('--knickgasm-ink', theme.ink);
  r.style.setProperty('--knickgasm-surface', theme.surface);
  r.style.setProperty('--knickgasm-head-font', theme.headingFont);
  r.style.setProperty('--knickgasm-font', theme.bodyFont);
}

/* ── Data: catalog (Shopify-built, same-origin) with public fallback ──────── */
async function fetchTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 9000);
  try { return await fetch(url, Object.assign({ signal: ctrl.signal }, opts || {})); }
  finally { clearTimeout(t); }
}

async function loadCatalog(region) {
  const store = STORE[region] || STORE.us;
  // 1) Same-origin built catalog (CORS-enabled, fast, no cross-origin risk).
  try {
    const res = await fetchTimeout(`/data/catalog/products_${region}.json`, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length) {
        return list.map((p) => ({
          title: p.n || '',
          handle: p.h || '',
          image: p.i || null,
          price: p.price ? (String(p.price).startsWith(store.ccy) ? p.price : store.ccy + p.price) : '',
          url: `${store.base}/products/${p.h || ''}`,
        }));
      }
    }
  } catch (_) { /* fall through */ }
  // 2) Public Shopify storefront fallback.
  try {
    const res = await fetchTimeout(`${store.base}/products.json?limit=24`, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const json = await res.json();
      return (json.products || []).map((p) => {
        const v = (p.variants || [])[0] || {};
        return {
          title: p.title || '',
          handle: p.handle || '',
          image: (p.images && p.images[0] && p.images[0].src) || null,
          price: v.price ? store.ccy + v.price : '',
          url: `${store.base}/products/${p.handle || ''}`,
        };
      });
    }
  } catch (_) { /* fall through */ }
  return [];
}

/* ── 2D fallback renderer ─────────────────────────────────────────────────── */
function render2D(el, products, route, theme) {
  const list = route.isMetaLander ? products.slice(0, 1) : products.slice(0, 12);
  el.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.setAttribute('data-v3d-tier', '2d');
  wrap.style.cssText = `background:${theme.sceneBg || theme.ink};color:${theme.sceneFg || theme.surface};font-family:${theme.bodyFont};padding:40px 22px;border-radius:16px;`;
  const h = document.createElement('h2');
  h.textContent = route.isMetaLander ? 'Your ritual, one tap away' : 'Knickgasm';
  h.style.cssText = `font-family:${theme.headingFont};font-size:30px;margin:0 0 6px;color:${theme.sceneFg || theme.surface};`;
  wrap.appendChild(h);
  const grid = document.createElement('div');
  grid.style.cssText = `display:grid;grid-template-columns:${route.isMetaLander ? '1fr' : 'repeat(auto-fill,minmax(210px,1fr))'};gap:16px;margin-top:22px;`;
  list.forEach((p) => {
    const a = document.createElement('a');
    a.href = p.url; a.style.cssText = `display:block;background:${theme.surface};color:${theme.ink};border-radius:14px;overflow:hidden;text-decoration:none;border:1px solid ${theme.accent}33;`;
    a.innerHTML = `${p.image ? `<img src="${p.image}" alt="" style="width:100%;height:150px;object-fit:cover;display:block">` : `<div style="height:110px;background:${theme.primary}"></div>`}
      <div style="padding:12px">
        <div style="font-family:${theme.headingFont};font-size:16px;margin-bottom:4px">${p.title}</div>
        <div style="color:${theme.primary};font-weight:700">${p.price || ''}</div>
        <div style="margin-top:9px;padding:8px 14px;border-radius:999px;background:${theme.primary};color:${theme.surface};text-align:center;font-weight:600;font-size:13px">${route.isMetaLander ? 'Add to cart' : 'View'}</div>
      </div>`;
    grid.appendChild(a);
  });
  wrap.appendChild(grid);
  el.appendChild(wrap);
}

/* ── 3D renderer (three.js, floating textured panels + slow orbit) ────────── */
async function render3D(el, products, route, theme) {
  let THREE;
  try { THREE = await import(THREE_CDN); }
  catch (_) { return render2D(el, products, route, theme); } // CDN blocked → 2D

  el.innerHTML = '';
  el.setAttribute('data-v3d-tier', '3d');
  const width = el.clientWidth || 960;
  const height = el.clientHeight || 520;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.sceneBg || theme.ink);
  scene.fog = new THREE.Fog(new THREE.Color(theme.sceneBg || theme.ink).getHex(), 9, 26);

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 0.5, route.isMetaLander ? 5 : 8);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  el.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.62));
  const dir = new THREE.DirectionalLight(new THREE.Color(theme.accent).getHex(), 1.1);
  dir.position.set(5, 8, 5); scene.add(dir);
  const pt = new THREE.PointLight(new THREE.Color(theme.primary).getHex(), 0.5); pt.position.set(-6, -2, 4); scene.add(pt);

  const loader = new THREE.TextureLoader();
  loader.crossOrigin = 'anonymous';
  const visible = route.isMetaLander ? products.slice(0, 1) : products.slice(0, 8);
  const panels = [];
  const radius = 3.4;

  visible.forEach((p, i) => {
    const angle = (i / Math.max(visible.length, 1)) * Math.PI * 2;
    const big = route.isMetaLander;
    const w = big ? 3.0 : 2.0, hgt = big ? 3.6 : 2.5;
    const geo = new THREE.PlaneGeometry(w, hgt);
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(theme.surface), roughness: 0.2, metalness: 0.05,
      clearcoat: 0.6, transparent: true, opacity: 0.96,
      emissive: new THREE.Color(theme.primary), emissiveIntensity: 0.05,
    });
    if (p.image) {
      loader.load(p.image, (tex) => { mat.map = tex; mat.needsUpdate = true; }, undefined, () => {});
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      big ? 0 : Math.cos(angle) * radius,
      big ? 0 : Math.sin(angle * 0.6) * 1.1,
      big ? 0 : Math.sin(angle) * radius,
    );
    mesh.userData = { url: p.url, phase: i };
    scene.add(mesh);
    panels.push(mesh);
  });

  // Click-through to PDP.
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  renderer.domElement.style.cursor = 'pointer';
  renderer.domElement.addEventListener('click', (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(panels)[0];
    if (hit && hit.object.userData.url) window.location.href = hit.object.userData.url;
  });

  let t = 0, raf = 0;
  const clock = { last: (performance && performance.now ? performance.now() : 0) };
  function tick() {
    const nowMs = (performance && performance.now ? performance.now() : clock.last + 16);
    const delta = Math.min((nowMs - clock.last) / 1000, 0.05); clock.last = nowMs;
    if (!route.isMetaLander) {
      t += delta * 0.08;
      camera.position.x = Math.sin(t) * 8;
      camera.position.z = Math.cos(t) * 8;
      camera.lookAt(0, 0, 0);
    }
    panels.forEach((m) => { m.position.y += Math.sin(nowMs / 900 + m.userData.phase) * 0.0015; m.lookAt(camera.position); });
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  tick();

  const onResize = () => {
    const w = el.clientWidth || width, hh = el.clientHeight || height;
    camera.aspect = w / hh; camera.updateProjectionMatrix(); renderer.setSize(w, hh);
  };
  window.addEventListener('resize', onResize);

  // Return a disposer so callers can unmount cleanly.
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  };
}

/* ── Public mount API ─────────────────────────────────────────────────────── */
export async function mountKnickgasm3D(el, opts) {
  opts = opts || {};
  const theme = Object.assign({}, BRAND, opts.theme || {});
  // Both variations: 'dark' (dark background + light text) and 'light'
  // (light background + dark text). Product panels stay chalk-with-dark-text in
  // both (high contrast either way); only the scene backdrop + headings flip.
  const variant = String(opts.variant || el.getAttribute('data-variant') || 'dark').toLowerCase();
  theme.variant = variant;
  theme.sceneBg = variant === 'light' ? '#ffffff' : theme.ink;
  theme.sceneFg = variant === 'light' ? theme.ink : theme.surface;
  theme.sceneSub = variant === 'light' ? '#556059' : (theme.surface + 'aa');
  injectBrandCSSVars(theme);

  const regionHint = opts.region || el.getAttribute('data-region') || null;
  const route = parseRoute(location.hostname, location.pathname, regionHint);
  const tier = detectTier(opts.tier || el.getAttribute('data-tier'));

  // Loading state.
  el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:${el.clientHeight || 320}px;font-family:${theme.bodyFont};color:${theme.accent}">Lacing the scene…</div>`;

  const products = await loadCatalog(route.region);
  if (!products.length) {
    el.innerHTML = `<div style="padding:28px;font-family:${theme.bodyFont};color:${theme.surface};background:${theme.ink};border-radius:14px">Catalog is briefly unavailable. Please refresh.</div>`;
    return () => {};
  }

  if (tier === '2d') { render2D(el, products, route, theme); return () => {}; }
  try { return await render3D(el, products, route, theme); }
  catch (_) { render2D(el, products, route, theme); return () => {}; }
}

// Auto-mount any [data-knickgasm3d] present at import time (opt-in convenience).
if (typeof document !== 'undefined') {
  const boot = () => document.querySelectorAll('[data-knickgasm3d][data-auto]').forEach((el) => mountKnickgasm3D(el));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}

export default mountKnickgasm3D;
