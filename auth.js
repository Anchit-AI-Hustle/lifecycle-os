/* eslint-env browser */
/**
 * auth.js — Lifecycle OS shared auth + cross-step navigation header.
 *
 * Drop this <script> into any page in the project. It:
 *   1. Bootstraps a Supabase client from window.__SUPABASE__ (set in HTML head)
 *      OR from the /api/public-config endpoint at runtime. The client persists
 *      the session and accepts the Google OAuth callback (PKCE).
 *   2. SIGN-IN IS GOOGLE, THROUGH SUPABASE AUTH, AND NOTHING ELSE (2026-10-10,
 *      the owner's words: "No signin with mobile number - only Google signin
 *      pls"). The rail's "Sign in with Google" chip starts Google sign-in and
 *      never hands the browser to a host that is not there or to a project
 *      whose Google provider is off. redirectTo is this origin's root (the
 *      Site URL) so a missing wildcard allowlist cannot 400 the bounce;
 *      rememberReturnTo / restoreReturnTo send the person back to the page
 *      they pressed from. The mobile number + 4-digit PIN sign-in that ran
 *      from 2026-09-28 is switched OFF: there is no panel, the server refuses
 *      op=enter, and a phone session left in this browser is ended on boot
 *      (its device brands are kept). See endLegacyPhoneSession().
 *   3. Renders a shared left rail with cross-step navigation so any stage
 *      can jump to any other stage.
 *   4. Provides window.LifecycleAuth.{client, session, user, signOut,
 *      openSignIn, apiToken, backend} for any page that needs the caller.
 *
 * supabase-js keeps the Google session under `sb-<ref>-auth-token`.
 * LifecycleAuth.internal is true only for a signed-in Google account.
 * Open external links in a new tab; same-app links stay in same tab.
 */
(function () {
  'use strict';

  // One public origin for the product, even when a person began on one of
  // Vercel's generated deployment aliases.
  var CANONICAL_APP_ORIGIN = 'https://lifecycle-os.anchit-tandon.com';
  // A deployment URL is useful to Vercel, but it is never a public product URL.
  // Redirect every Lifecycle OS project alias (including per-deployment URLs)
  // while retaining the requested app path, query and fragment.
  if (/^lifecycle(?:-|\.)/i.test(location.hostname) && /\.vercel\.app$/i.test(location.hostname)) {
    location.replace(CANONICAL_APP_ORIGIN + location.pathname + location.search + location.hash);
    return;
  }

  if (window.__LifecycleAuthBooted) return;
  window.__LifecycleAuthBooted = true;

  // ─── Shared design system: load /theme.css once on every page ───────────
  // theme.css is additive (design tokens + globally-safe polish + opt-in vh-*
  // components), so it never clobbers a page's own CSS. Injected here so every
  // page that ships auth.js inherits the system — including the Capacitor apps,
  // which are WebView shells over production. Also ensure the viewport opts into
  // safe-area (notch) insets so the theme's env() padding actually resolves.
  // The frozen "diff-version" snapshot must never change — it is a pinned
  // before/after reference (see diff-version/FROZEN_AT.txt). It is fully
  // self-themed, so we exempt it from the shared theme system entirely: no
  // theme.css injection, no green lock — it keeps its own dark theme.
  var IS_FROZEN_DIFF = /(^|\/)diff-version(\/|\.html|$)/.test(location.pathname);

  (function ensureTheme() {
    try {
      var d = document;
      if (IS_FROZEN_DIFF) { d.documentElement.setAttribute('data-theme', 'dark'); return; }
      if (!d.querySelector('link[data-vh-theme]')) {
        var l = d.createElement('link');
        l.rel = 'stylesheet';
        l.href = '/theme.css?v=20260915-status';
        l.setAttribute('data-vh-theme', '1');
        (d.head || d.documentElement).appendChild(l);
      }
      var vp = d.querySelector('meta[name="viewport"]');
      if (vp && !/viewport-fit/.test(vp.getAttribute('content') || '')) {
        vp.setAttribute('content', vp.getAttribute('content') + ', viewport-fit=cover');
      } else if (!vp) {
        vp = d.createElement('meta');
        vp.name = 'viewport';
        vp.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
        (d.head || d.documentElement).appendChild(vp);
      }
      // Locked theme: one green surface. No switcher. Force the attribute and
      // clear any stale saved variant so old localStorage can't resurface it.
      d.documentElement.setAttribute('data-theme', 'green');
      try { localStorage.removeItem('vh-theme'); } catch (_) {}
    } catch (_) {}
  })();

  // ─── Shared motion layer: load /motion.js once on every page ────────────
  // Additive scroll-reveal + depth choreography (Design DNA / Motion). It is
  // fully fail-safe (never hides content if it doesn't run) and self-skips the
  // frozen diff snapshot + reduced-motion users. Loaded deferred so it never
  // blocks first paint.
  (function ensureMotion() {
    try {
      if (IS_FROZEN_DIFF) return;
      var d = document;
      if (d.querySelector('script[data-vh-motion]')) return;
      var s = d.createElement('script');
      s.src = '/motion.js?v=20260719';
      s.defer = true;
      s.setAttribute('data-vh-motion', '1');
      (d.head || d.documentElement).appendChild(s);
    } catch (_) {}
  })();

  /* ─── A FAILURE MUST LOOK LIKE A FAILURE ─────────────────────────────────
     Found on the live deployment. With the Supabase project paused, the
     onboarding wizard's "Your brands" panel rendered

         session_verification_unavailable

     styled exactly like the brand rows it replaced - a machine identifier sat
     in a list of brands and read as the name of one. PR #75 made the SENTENCE
     win over the code in brand-context.js, which was necessary and is not
     sufficient: an error of any kind dropped into a slot labelled "Your
     brands" still reads as a brand. The defect is not the wording, it is that
     a failure was wearing content's clothes - `<p class="muted">`,
     `<div class="empty">`, `<td class="muted">`, a card body, a table row.

     So every one of those call sites now renders through here, and this is
     ONE implementation rather than twenty-odd, for the reason this repo keeps
     recording: two copies drift, and the second one is the one nobody fixes.

     Three things it guarantees, in this order:
       1. A FRAME. Every failure carries an uppercase tag naming what could not
          be done, role="alert", and a red-edged panel that no data row in this
          app looks like. `data-failure="1"` marks it for tests.
       2. A SENTENCE. A bare machine identifier is never the explanation. Known
          codes get real words; an unknown one is reported as a sentence with
          the code kept BESIDE it, labelled, never as the whole message.
       3. THE CAUSE, where it is knowable. `backend_unreachable` on the payload
          (a paused, renamed or deleted project - the network cannot tell them
          apart) says plainly that the database is unreachable and that nothing
          was saved, because "nothing was saved" is the part an operator will
          otherwise have to discover by losing work.

     Styling lives in theme.css (.vh-failure), brand tokens only, on the light
     panel surface - never a dark-neutral ground, which is a HARD repo rule. */
  (function failurePresentation() {
    var esc = function (v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    // A machine identifier: snake_case / dotted, no spaces. This is the shape
    // that must never reach a reader as the whole explanation.
    var IDENT = /^[a-z][a-z0-9]*(?:[_.\-][a-z0-9]+)+$/;
    var UNREACHABLE = {
      backend_unreachable: 1,
      session_verification_unavailable: 1,
      supabase_not_configured: 1,
    };

    var DB_DOWN = 'The database is unreachable, so this could not be loaded and nothing has been saved. '
      + 'The project it points at is paused, renamed or deleted, which look identical from here.';

    // Codes this app actually emits. Anything not listed still gets a sentence
    // (see below) - the table is a courtesy, not the guarantee.
    var SENTENCES = {
      session_verification_unavailable: DB_DOWN,
      supabase_not_configured: 'This deployment has no database configured, so nothing can be read or saved here.',
      backend_unreachable: DB_DOWN,
      sign_in_required: 'You are signed out, so this could not be loaded. Sign in and try again.',
      not_authenticated: 'You are signed out, so this could not be loaded. Sign in and try again.',
      forbidden: 'Your account does not have access to this brand.',
      not_a_member: 'Your account is not a member of this brand workspace.',
      no_active_workspace: 'No brand is active yet. Set one up in onboarding, then come back.',
      not_found: 'That record no longer exists.',
      rate_limited: 'The service is rate limiting this request. Wait a moment and try again.',
      insufficient_credits: 'There are not enough credits on this brand to run that.',
    };

    function payloadOf(e) {
      if (!e || typeof e !== 'object') return null;
      if (e.payload && typeof e.payload === 'object') return e.payload;
      return e;
    }

    /** The machine identifier behind a failure, or '' when there is none. */
    function codeOf(e) {
      if (!e) return '';
      var p = payloadOf(e) || {};
      var c = (typeof e === 'object' && e.code) || p.error || p.code || '';
      if (!c && typeof e === 'object' && e.message && IDENT.test(String(e.message).trim())) c = e.message;
      if (!c && typeof e === 'string' && IDENT.test(e.trim())) c = e;
      return String(c || '').trim();
    }

    function unreachable(e) {
      var p = payloadOf(e) || {};
      if (p.backend_unreachable === true) return true;
      return !!UNREACHABLE[codeOf(e)];
    }

    /** Always a sentence. Never a bare identifier, never an empty string. */
    function sentence(e) {
      if (unreachable(e)) return DB_DOWN;
      var code = codeOf(e);
      if (code && SENTENCES[code]) return SENTENCES[code];

      var raw = '';
      if (typeof e === 'string') raw = e;
      else if (e && typeof e === 'object') raw = e.message || (payloadOf(e) || {}).message || '';
      raw = String(raw || '').trim();
      // Several endpoints answer with `{ ok:false, error:"<a real sentence>" }`
      // and no `message`. That sentence is the explanation and must be used;
      // only an IDENTIFIER-shaped `error` is withheld from the reader.
      if ((!raw || IDENT.test(raw)) && code && !IDENT.test(code)) raw = code;

      // `Failed to fetch` / `NetworkError...` is the browser's words for "the
      // request never arrived". Left as-is it reads as jargon, so it is said
      // plainly and, like every other refusal, it says nothing was saved.
      if (/failed to fetch|networkerror|load failed|err_(?:network|connection)/i.test(raw)) {
        return 'The server could not be reached, so this could not be loaded and nothing has been saved.';
      }
      if (!raw || IDENT.test(raw)) {
        return code || raw
          ? 'The server refused this request and did not explain why.'
          : 'This could not be loaded.';
      }
      return raw;
    }

    /**
     * The failure block. `opts.title` names what could not be done - it is the
     * part that stops the panel reading as data, so it is never omitted.
     */
    function html(e, opts) {
      var o = opts || {};
      // AN ORDINARY STATE NEVER WEARS THE FAILURE FRAME (2026-09-29). A
      // signed-out visitor, a sign-in kept on this device only, a phone
      // account with no wallet: each is a state, not a fault, and the red
      // frame for it teaches people to ignore the frame. The sentence for it
      // comes from LifecycleStatus, the one source the pre-send checks use.
      try {
        var LS = window.LifecycleStatus;
        if (LS && LS.ordinary(e)) return LS.htmlFor(e, o);
      } catch (_) { /* fall through to the frame */ }
      var tag = o.title || 'Could not load';
      var code = codeOf(e);
      var msg = sentence(e);
      // The code is kept, because it is what a bug report needs - but it is
      // labelled and secondary, never the explanation itself.
      var codeLine = code && code !== msg
        ? '<span class="vh-failure-code">Reported by the server as: ' + esc(code) + '</span>\n'
        : '';
      // The newlines are load-bearing, not formatting. These spans are block
      // level in CSS, but textContent ignores CSS - so without a separator the
      // tag and the sentence run together into one unreadable string wherever
      // the text is read rather than looked at (a screen reader, a copied
      // error report, a test assertion).
      return '<div class="vh-failure" role="alert" data-failure="1">'
        + '<span class="vh-failure-tag">' + esc(tag) + '</span>\n'
        + '<span class="vh-failure-msg">' + esc(msg) + '</span>\n'
        + codeLine
        + (o.extra ? '<span class="vh-failure-msg">' + esc(o.extra) + '</span>' : '')
        + '</div>';
    }

    /** The same block as a table row, so a <tbody> never gets a loose <div>. */
    function rowHtml(e, opts) {
      var o = opts || {};
      return '<tr class="vh-failure-tr"><td colspan="' + (Number(o.colspan) || 99) + '">'
        + html(e, o) + '</td></tr>';
    }

    /**
     * Render into an element, choosing the row form for table containers - a
     * loose <div> inside a <table> is dropped by the parser and the slot ends
     * up EMPTY, which is the same defect arriving by a different route.
     */
    function show(el, e, opts) {
      var node = typeof el === 'string' ? document.getElementById(el) : el;
      if (!node) return;
      var tag = (node.tagName || '').toUpperCase();
      if (tag === 'TBODY') node.innerHTML = rowHtml(e, opts);
      else if (tag === 'TABLE') node.innerHTML = '<tbody>' + rowHtml(e, opts) + '</tbody>';
      else node.innerHTML = html(e, opts);
    }

    window.LifecycleFailure = {
      sentence: sentence,
      code: codeOf,
      unreachable: unreachable,
      html: html,
      rowHtml: rowHtml,
      show: show,
    };
  })();

  /* ── An action that needs the server, in a state that cannot reach an
     account (2026-09-29) ─────────────────────────────────────────────────────
     tests/signed-out-actions.spec.js drove every visible control on every page
     in three states - a reachable backend with no session, an unreachable one,
     and a mobile+PIN session kept on this device - and found the same shape
     on nine pages: the handler asked the server FIRST, the server answered
     401 sign_in_required (exactly as it should), and the page rendered that
     refusal as a red failure frame: "Failed to generate the plan
     {"ok":false,"error":"sign_in_required",...}" on the calendar, on load, for
     every visitor who is not signed in. Being signed out is the most ordinary
     state there is, and a fault frame for it - on the first screen, before a
     key is pressed - teaches people that the frame means nothing.

     ONE decision, made BEFORE anything is sent, from the one record auth.js
     already publishes (LifecycleAuth.backend + LifecycleAuth.session), and ONE
     sentence per state, in the accent rule (.vh-status), naming what did not
     run and what would let it:

       signed-out          a reachable backend, no session
       unreachable         the configured database is not answering
       unconfigured        no SUPABASE_URL at all

     (Until 2026-10-10 a mobile+PIN sign-in had three more states here -
     device, unverified-session, no-wallet. That sign-in is switched off; a
     Google session is verified by the server on every request.)

     `refusal(what, {metered})` answers null when the action may proceed (a
     Google session, the localhost preview, or a state auth.js
     has not decided yet - the server is the judge then). Pages call it in
     their request helper and THROW the result; every existing catch that goes
     through LifecycleFailure.show() then renders the status line, because
     LifecycleFailure recognises an ordinary refusal - its own or the server's
     401 - and hands it here. Nothing is sent, nothing spins, nothing is red.

     Never a dialog, never a toast as the only trace, brand tokens only. */
  (function serverActions() {
    var esc = function (v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    // The server's codes for "no account it can act for" - ordinary for a
    // visitor who is not signed in.
    var ORDINARY = { sign_in_required: 1, not_authenticated: 1, operator_session_required: 1 };
    // The server's codes for "a mobile-number sign-in cannot do this". Since
    // 2026-10-10 no such sign-in exists (Google only), so a request carrying a
    // leftover phone token is answered as a signed-out one; the codes are kept
    // so an old answer still reads as a status, never a red frame.
    var PHONE_ONLY = { credits_require_account: 1, account_type_unsupported: 1, pin_signin_removed: 1 };
    var SIGN_IN = 'Sign in with Google (the Sign in with Google chip in the menu)';

    function hostOf() { try { return new URL((window.__SUPABASE__ || {}).url).host; } catch (e) { return ''; } }
    function backend() { var a = window.LifecycleAuth; return (a && a.backend) || { kind: 'pending' }; }
    function codeOf(e) {
      if (!e) return '';
      var p = (e && typeof e === 'object' && e.payload && typeof e.payload === 'object') ? e.payload : (e && typeof e === 'object' ? e : {});
      return String((typeof e === 'object' && e.code) || p.error || p.code || (typeof e === 'string' ? e : '') || '').trim();
    }
    function cap(s) { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

    /**
     * Why `what` cannot run right now, or null. `what` is a noun phrase for
     * the action ("Generating the plan", "Your usage and ledger").
     */
    function refusal(what, opts) {
      var subject = cap(what || 'This action');
      var kind = backend().kind || 'pending';
      var host = hostOf();
      var state = '', lead = '', body = '', code = 'sign_in_required', status = 401;
      if (kind === 'signed-out') {
        state = 'signed-out';
        lead = 'Not run: you are signed out.';
        body = subject + ' runs on the server for an account it can verify, so it did not run and nothing was sent. '
          + SIGN_IN + ', then try again; everything else on this page keeps working.';
      } else if (kind === 'unreachable') {
        state = 'unreachable';
        lead = 'Not run: the workspace database is unreachable.';
        body = subject + ' needs the database this deployment points at' + (host ? ' (' + host + ')' : '')
          + ', which is not answering, so it did not run and nothing was sent. Sign in with Google needs it too. Everything else on this page keeps working.';
        code = 'backend_unreachable'; status = 503;
      } else if (kind === 'unconfigured') {
        state = 'unconfigured';
        lead = 'Not run: no workspace database is configured.';
        body = subject + ' needs a workspace database, and this deployment has none set (SUPABASE_URL), '
          + 'so it did not run and nothing was sent.';
        code = 'supabase_not_configured'; status = 503;
      } else {
        // A Google session, the localhost preview, the SDK failing to load,
        // or a boot still deciding: the server is the judge.
        return null;
      }
      var e = new Error(lead + ' ' + body);
      e.ordinary = true; e.state = state; e.lead = lead; e.body = body; e.code = code; e.status = status;
      e.payload = { ok: false, error: code, message: e.message, ordinary: true, state: state };
      return e;
    }

    /** Is this error an ordinary state rather than a fault? */
    function ordinary(e) {
      if (!e) return false;
      if (typeof e === 'object' && e.ordinary === true) return true;
      var code = codeOf(e);
      // A device brand cannot hold encrypted platform credentials. That is a
      // state of this sign-in, said as a status, never a red frame.
      if (code === 'device_account') return true;
      if (PHONE_ONLY[code]) return true;
      if (ORDINARY[code]) return !!refusal('This');
      return false;
    }

    function statusHtml(lead, body) {
      return '<div class="vh-status" role="status" data-status="1">'
        + (lead ? '<b>' + esc(lead) + '</b> ' : '') + esc(body) + '</div>';
    }
    /** A title like "Usage could not be loaded" / "Failed to generate the plan" → its subject. */
    function subjectOf(title) {
      var t = String(title || '').replace(/\s+could not be\b.*$/i, '').replace(/\s+did not\b.*$/i, '').replace(/^failed to\s+/i, '').trim();
      return cap(t);
    }
    /** The status block for an ordinary refusal, the server's or our own. */
    function htmlFor(e, opts) {
      var o = opts || {};
      var code = codeOf(e);
      if (typeof e === 'object' && e.ordinary === true && e.lead) return statusHtml(e.lead, e.body);
      if (code === 'device_account') {
        var dm = (e && typeof e === 'object' && (e.message || (e.payload && e.payload.message))) || '';
        return statusHtml('Kept on this device.', dm);
      }
      if (PHONE_ONLY[code]) {
        return statusHtml((o.title ? subjectOf(o.title) + ': ' : '') + 'not run.',
          'Sign-in is with Google now; a mobile-number sign-in is not accepted. ' + SIGN_IN + ', then try again.');
      }
      var r = refusal(o.title ? subjectOf(o.title) : 'This action');
      if (!r) return statusHtml('', (e && e.message) || 'This did not run.');
      return statusHtml(r.lead, r.body);
    }
    function rowHtml(html, opts) {
      return '<tr class="vh-status-tr"><td colspan="' + (Number((opts || {}).colspan) || 99) + '">' + html + '</td></tr>';
    }
    /** Render a status (a refusal, or plain words) into a slot, table-aware. */
    function show(el, x, opts) {
      var node = typeof el === 'string' ? document.getElementById(el) : el;
      if (!node) return;
      var html = (x && typeof x === 'object') ? htmlFor(x, opts) : statusHtml('', x);
      var tag = (node.tagName || '').toUpperCase();
      if (tag === 'TBODY') node.innerHTML = rowHtml(html, opts);
      else if (tag === 'TABLE') node.innerHTML = '<tbody>' + rowHtml(html, opts) + '</tbody>';
      else node.innerHTML = html;
    }

    /**
     * refusal(), once auth.js has DECIDED the state. A page that asks on
     * load can be earlier than the reachability probe (an unreachable host
     * takes longer to fail than a live one takes to answer), and a refusal
     * read while the state is still `pending` is null - so the request went
     * out and its 503 came back as a frame. Waits for the first decision,
     * bounded by the same 8 s brand-context.js allows the gate.
     */
    function decide(what, opts) {
      var settled = function () { return Promise.resolve(refusal(what, opts)); };
      var a = window.LifecycleAuth;
      var kind = a && a.backend && a.backend.kind;
      // Already decided: answer now. `pending`, or auth.js not assigned yet
      // (a deferred script, and the page's own load already asked), waits for
      // the first real decision. Treating "not assigned" as decided is what
      // sent /brain's plan request out signed-out and painted the empty
      // preview ("no sends", "env not linked") over the sign-in sentence.
      if (kind && kind !== 'pending') return settled();
      var first = a && typeof a.backendState === 'function' ? a.backendState() : null;
      var wait = first || new Promise(function (resolve) {
        var done = false;
        var finish = function () { if (done) return; done = true; window.removeEventListener('lifecycleauth:backend', onEvent); resolve(); };
        var onEvent = function (ev) {
          var k = ev && ev.detail && ev.detail.kind;
          if (k && k !== 'pending') finish();
        };
        window.addEventListener('lifecycleauth:backend', onEvent);
        setTimeout(finish, 8000);
      });
      return Promise.race([wait, new Promise(function (r) { setTimeout(r, 8000); })])
        .then(settled, settled);
    }

    window.LifecycleStatus = { refusal: refusal, decide: decide, ordinary: ordinary, html: statusHtml, htmlFor: htmlFor, show: show };
  })();

  // ─── Universal brand layer + credit meter ───────────────────────────────
  // brand-context.js re-skins the whole app to the signed-in user's ACTIVE
  // brand workspace (palette, fonts, name, favicon) and sends a user with no
  // brand to /onboarding. credits.js renders the live balance pill, labels
  // every [data-credit-feature] element with its cost, and guards runs.
  // Both are additive, fail-safe and self-skip the frozen diff snapshot.
  // brand-context loads FIRST so credits can read the active workspace id.
  // ─── Same-origin API calls carry the session automatically ──────────────
  // The credit meter identifies the caller from a Supabase bearer token, and
  // several long-standing endpoints (/api/ai/generate, /api/ai/image,
  // /api/calendar) are now metered. Dozens of pages call them with only a
  // Content-Type header, so without this every signed-in user would get
  // 401 sign_in_required the moment the meter is configured.
  //
  // Rather than editing every call site, fetch is wrapped once here: a
  // SAME-ORIGIN request to /api/... gets the current access token attached,
  // and only when the caller has not set an Authorization header itself (so
  // CRON_SECRET callers and explicit tokens still win).
  //
  // Cross-origin requests are never touched — attaching the token to a third
  // party would leak the user's session.
  (function attachSessionToApiCalls() {
    try {
      if (window.__lcFetchPatched || typeof window.fetch !== 'function') return;
      window.__lcFetchPatched = true;
      var nativeFetch = window.fetch.bind(window);

      // The Google session's access token (a Supabase JWT), and nothing else.
      // A mobile-number token is never sent (2026-10-10): that sign-in is
      // switched off and the server refuses one exactly like no token at all.
      function currentToken() {
        try {
          var a = window.LifecycleAuth;
          if (a && typeof a.apiToken === 'function') return a.apiToken() || '';
        } catch (_) {}
        return '';
      }

      function isOwnApi(url) {
        try {
          var u = new URL(url, location.href);
          return u.origin === location.origin && /^\/api\//.test(u.pathname);
        } catch (_) { return false; }
      }

      window.fetch = function (input, init) {
        try {
          var url = (typeof input === 'string') ? input : (input && input.url) || '';
          if (!isOwnApi(url)) return nativeFetch(input, init);

          // Restore the Google session before the first authenticated API
          // request. Public config/auth bootstrap must never wait on itself.
          if (new URL(url, location.href).pathname !== '/api/public-config' && !authReady.settled) {
            return authReady.promise.then(function () { return window.fetch(input, init); });
          }

          var token = currentToken();
          if (!token) return nativeFetch(input, init);

          // Request object: clone with the header added, leaving the body alone.
          if (typeof input !== 'string' && input && typeof Request !== 'undefined' && input instanceof Request) {
            if (input.headers && input.headers.get && input.headers.get('Authorization')) return nativeFetch(input, init);
            var req = new Request(input, init || undefined);
            if (!req.headers.get('Authorization')) req.headers.set('Authorization', 'Bearer ' + token);
            return nativeFetch(req);
          }

          var opts = Object.assign({}, init || {});
          var headers = new Headers((opts && opts.headers) || {});
          if (!headers.get('Authorization')) headers.set('Authorization', 'Bearer ' + token);
          opts.headers = headers;
          return nativeFetch(input, opts);
        } catch (_) {
          return nativeFetch(input, init);
        }
      };
    } catch (_) {}
  })();

  (function ensurePlatformRuntimes() {
    try {
      if (IS_FROZEN_DIFF) return;
      var d = document;
      // region-context loads after brand-context because the market list IS the
      // brand's own `regions`. Loading it here rather than page by page is the
      // point: region selection was present on 17 of 66 pages, in six different
      // shapes, none of which shared the choice, so picking a market on one
      // page silently reverted on the next.
      // brand-catalog.js is the ONE reader of a brand's catalogue (2026-10-05):
      // loaded on every page, so no page has a reason to fetch one itself.
      [['/brand-context.js?v=20260809', 'data-vh-brand'],
        ['/brand-catalog.js?v=20261010', 'data-vh-catalog'],
        ['/region-context.js?v=20261005', 'data-vh-region'],
        ['/credits.js?v=20260809', 'data-vh-credits']].forEach(function (pair) {
        if (d.querySelector('script[' + pair[1] + ']')) return;
        // A page that already includes the catalogue resolver itself keeps it.
        if (pair[1] === 'data-vh-catalog' && (window.BrandCatalog || d.querySelector('script[src*="brand-catalog.js"]'))) return;
        var s = d.createElement('script');
        s.src = pair[0];
        s.setAttribute(pair[1], '1');
        (d.head || d.documentElement).appendChild(s);
      });
    } catch (_) {}
  })();

  // Theme switcher removed — the theme is locked to green (see theme.css).
  // Clean up the old floating button if a cached page still has one.
  (function removeLegacyThemeSwitch() {
    function kill() { var b = document.getElementById('vh-theme-switch'); if (b) b.remove(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kill);
    else kill();
  })();

  // ─── PWA install: register the service worker once per page load ────────
  // This is what makes the address-bar install icon appear in Chrome / Edge
  // (and adds "Add to Home Screen" on iOS/Android) — alongside the manifest.
  //
  // Aggressive update path: every page load, ask the registration to update;
  // if a waiting SW exists, tell it to skipWaiting; once it takes control,
  // reload the page so the user instantly sees the new auth.js / shell.
  // Without this the user had to do a manual "hard reload" to see sidebar
  // changes — we now self-heal the cache on every navigation.
  // navigator.webdriver: automation (Playwright/CI) gets no service worker -
  // the first-install controllerchange reload would restart pages mid-test.
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !navigator.webdriver) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        // Trigger an update check on every page load.
        reg.update().catch(() => {});
        // If a new SW is already waiting (from a previous visit), activate now.
        if (reg.waiting) reg.waiting.postMessage('skipWaiting');
        // When a new SW takes over, reload once so the page uses the fresh shell.
        let didReload = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (didReload) return; didReload = true;
          // Defer slightly so any in-flight nav clicks finish.
          setTimeout(() => location.reload(), 50);
        });
        // Listen for "updatefound" → "installed" so we don't sit on a waiting SW.
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              sw.postMessage('skipWaiting');
            }
          });
        });
      } catch { /* SW registration failed — site still works */ }
    });
  }

  // ─── The PLATFORM mark (2026-09-29) ─────────────────────────────────────
  // Lifecycle OS's own mark: a closed loop with an advancing arrowhead (the
  // lifecycle that keeps running) around a still core (the OS). It is the SAME
  // geometry as assets/lifecycle-os-mark.svg, which is the browser-tab icon,
  // the touch icon and every PWA / launcher raster (scripts/build-platform-mark.js),
  // so the rail and the tab show one object.
  //
  // It is PLATFORM chrome, not tenant chrome, and that is the point of it. The
  // previous mark painted its tile with --brand-primary and its centre with
  // --brand-accent, and brand-context.js then REPLACED it outright with the
  // active brand's logo_url - so the product had no mark of its own anywhere,
  // and with tenant zero active the shell and the tab both wore that tenant's
  // logo. Now: the glyph is currentColor (the rail's ink), the tile is the
  // neutral panel token with a hairline, and the ACTIVE brand's logo renders
  // beside its name in the brand slot (.lnav-brandlogo), never in place of
  // this. No colour literal here: a hex would be a colour this file decided
  // for itself (the futuristic-layer rule).
  const LOGO_SVG = `<svg class="lnav-mark" viewBox="0 0 64 64" role="img" aria-label="Lifecycle OS" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="62" height="62" rx="15" fill="var(--vh-panel-2, transparent)" stroke="var(--vh-line, currentColor)" stroke-width="2"/>
    <path d="M 36.4 15.58 A 17 17 0 1 1 18.07 22.25" fill="none" stroke="currentColor" stroke-width="6.5" stroke-linecap="round"/>
    <path d="M 22.09 16.52 L 22.82 26.8 L 12.18 19.34 Z" fill="currentColor"/>
    <circle cx="32" cy="32" r="4.5" fill="currentColor"/>
  </svg>`;

  // ─── Information architecture (left-hand sidebar) ───────────────────
  // Flat items render as top-level links; `children` render as an expandable
  // group. `open:true` marks a feature that never requires sign-in.
  // Stroke icons (inherit currentColor). Brand glyphs (Google/Meta/TikTok) live
  // in BRAND below and render in their own official colours.
  const ICONS = {
    home:       '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9h5v-5h4v5h5v-9"/>',
    analysis:   '<path d="M4 19V5"/><path d="M4 19h16"/><rect x="7" y="11" width="3" height="5"/><rect x="12" y="7" width="3" height="9"/><rect x="17" y="13" width="3" height="3"/>',
    competitor: '<path d="m21 21-4.3-4.3"/><circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6"/>',
    mailer:     '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    calendar:   '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    ads:        '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15 8a4 4 0 0 1 0 8"/>',
    landing:    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
    kb:         '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M19 17H6a2 2 0 0 0-2 2"/>',
    discover:   '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6M8 11h6"/>',
    cohort:     '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9.5" r="2.3"/><path d="M16 14.4c2.6.4 4.5 2.6 4.5 5.6"/>',
    studio:     '<path d="M5 3v4M3 5h4M6 17v4M4 19h4"/><path d="m13 3 2.3 6.7L22 12l-6.7 2.3L13 21l-2.3-6.7L4 12l6.7-2.3z"/>',
    insights:   '<path d="M3 3v18h18"/><path d="m7 14 3-4 3 3 4-6"/><circle cx="7" cy="14" r="1.2"/><circle cx="10" cy="10" r="1.2"/><circle cx="13" cy="13" r="1.2"/><circle cx="17" cy="7" r="1.2"/>',
    knickgasm:     '<path d="M12 21c-1-5-4-6.5-7-7 0-5 3.5-8 7-9 3.5 1 7 4 7 9-3 .5-6 2-7 7z"/><path d="M12 13c1.5-2 3.5-3 5.5-3.5"/>',
    social:     '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.7 6.8-4.4M8.6 13.3l6.8 4.4"/>',
    avatars:    '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/><path d="M12 2.2v1.4M12 12.4v1.4M17.8 8h-1.4M7.6 8H6.2"/>',
  };
  // Real, full-colour brand glyphs. Each is a complete <svg> with its own
  // viewBox + official brand colours, so Meta / Google / TikTok read as the
  // actual app icons rather than generic line-art.
  const BRAND = {
    google: '<svg viewBox="0 0 24 24" width="18" height="18" class="lnav-ic lnav-brandic"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"/></svg>',
    meta:   '<svg viewBox="0 0 24 24" width="18" height="18" class="lnav-ic lnav-brandic" fill="none" stroke="#0866FF" stroke-width="2.2" stroke-linecap="round"><path d="M2.2 13.6c.9-4.2 2.6-6.6 4.8-6.6 2.8 0 4.3 3.7 6.5 7.2 1.6 2.6 2.8 3.8 4.3 3.8 1.7 0 2.6-1.7 2.6-4.2 0-3.5-1.6-6.6-4-6.6-2.7 0-4.4 3.3-6.6 6.8-1.6 2.5-2.9 4.2-4.6 4.2-1.4 0-2.3-1-2.6-2.4"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" width="18" height="18" class="lnav-ic lnav-brandic"><path fill="#25F4EE" d="M15.3 5.6a4.3 4.3 0 0 1-1-2.6h-1.9v12.4a2.4 2.4 0 1 1-2.4-2.4c.2 0 .4 0 .6.1V11a5.5 5.5 0 1 0 4.3 5.4V8.9a7.3 7.3 0 0 0 3.3 1.2V7.5a4.3 4.3 0 0 1-2.8-1.9z"/><path fill="#FE2C55" d="M17.1 6.4a4.3 4.3 0 0 1-1-2.6h-1.9v12.4a2.4 2.4 0 1 1-2.4-2.4c.2 0 .4 0 .6.1v-2.1a5.5 5.5 0 1 0 4.3 5.4V9.7A7.3 7.3 0 0 0 20 10.9V8.3a4.3 4.3 0 0 1-2.9-1.9z"/><path fill="#FFF" d="M16.2 6a4.3 4.3 0 0 1-1-2.6h-1.9v12.4a2.4 2.4 0 1 1-2.4-2.4c.2 0 .4 0 .6.1V11.4a5.5 5.5 0 1 0 4.3 5.4V9.3a7.3 7.3 0 0 0 3.3 1.2V7.9A4.3 4.3 0 0 1 16.2 6z"/></svg>',
  };
  // ─── Information architecture ───────────────────────────────────────
  // Workflow-ordered IA (product-owner rule): Home pinned on top, then the
  // sections follow the SEQUENTIAL order a marketer actually works in —
  //   1. RESEARCH & BENCHMARK  = what others do, what we know, what our data says.
  //   2. PLAN                  = calendars + the UK program.
  //   3. DESIGN & CREATE       = where KNICKGASM produces its own assets.
  //   4. SHARE & TRACK         = the export/download library of finished work.
  //   5. ASSISTANTS            = cross-cutting conversational/autonomous helpers.
  // Every destination stays reachable — groups nest, nothing is deleted.
  // Version taxonomy (CLAUDE.md "Version taxonomy (V1 vs V2)"): `ver` badges an
  // item V1 (legacy base app) or V2 (Lifecycle OS, 2026-07-03 additions). Where
  // BOTH generations of the same capability exist, `draft` records Draft 1 vs
  // Draft 2 (e.g. Plan V1 = Draft 1 vs Mailer Calendar V2 = Draft 2 of
  // calendaring; Mailer Studio V1 = Draft 1 vs the Mailer Calendar's built
  // mailers = Draft 2 of mailer creation). The Draft label renders in tooltips
  // and the sub-item info panels — not in the row — to keep rows quiet.
  const NAV = [
    { id: 'appaudit',   label: 'Overall App Audit', href: '/audit',      icon: 'insights', ver: 'v2', match: ['/audit', '/app-audit', '/app-audit.html'] },
    { id: 'home',       label: 'Home',          href: '/',               icon: 'home',     match: ['/', '/index.html'] },
    { group: 'Brand & Credits', icon: 'studio', gid: 'platform', ver: 'v2', children: [
      { id: 'brand-setup',   label: 'Brand Setup',      href: '/onboarding', icon: 'studio', match: ['/onboarding', '/setup', '/start', '/onboarding.html'] },
      { id: 'brand-switch',  label: 'Switch Brand',     href: '/onboarding?step=6', icon: 'studio' },
      { id: 'brandinput',    label: 'Brand Kit',        href: '/brand',      icon: 'insights', match: ['/brand', '/brand.html'] },
      { id: 'about',         label: 'About this platform', href: '/about', icon: 'kb', match: ['/about', '/about.html'] },
      { id: 'designsystem',  label: 'Design System',    href: '/design-system', icon: 'studio', ver: 'v2', match: ['/design-system', '/design-system.html'] },
      { id: 'credits',       label: 'Credits & Usage',  href: '/credits',    icon: 'insights', match: ['/credits', '/wallet', '/billing', '/credits.html'] },
      { id: 'connections',   label: 'Connections & AI Models', href: '/connections', icon: 'insights', ver: 'v2', match: ['/connections', '/integrations', '/ai-models', '/models', '/brand-connections.html'] },
      { id: 'payments',      label: 'Payment Gateways', href: '/payments', icon: 'insights', ver: 'v2', match: ['/payments', '/payment-gateways', '/payments/callback', '/payments.html'] },
      { id: 'publishing',    label: 'Publishing & Deliverability', href: '/publishing', icon: 'insights', ver: 'v2', match: ['/publishing', '/publisher', '/deliverability', '/publishing.html'] },
    ]},
    { group: 'Market Study', icon: 'kb', gid: 'research', ver: 'v2', children: [
      // 'research-all', not 'research': the GROUP already carries gid 'research',
      // and a ? chip is rendered for any id or gid that has an INFO entry. With
      // both keyed the same, the identical panel was offered twice — once on the
      // group header and again on the row immediately under it. Naming follows
      // the region rows below.
      { id: 'research-all',    label: 'Overview (all regions)', href: '/research',               icon: 'kb',       match: ['/research', '/growth-book', '/research.html'] },
      // `region`: the row is offered only while the ACTIVE brand serves that
      // market (syncRegionRows below). These four were shown to every brand,
      // so a brand serving only India was offered US, UK and Global studies it
      // has no study, store or currency for (2026-10-05).
      { id: 'research-us',     label: 'US Study',               href: '/research?region=us',     icon: 'insights' },
      { id: 'research-uk',     label: 'UK Study',               href: '/research?region=uk',     icon: 'insights' },
      { id: 'research-global', label: 'Global Study',           href: '/research?region=global', icon: 'insights' },
      { id: 'research-india',  label: 'India Study',            href: '/research?region=india',  icon: 'insights' },
    ]},
    { id: 'allinone',   label: 'Master Dashboard', href: '/master-dashboard', icon: 'analysis', ver: 'v2', match: ['/master-dashboard', '/master', '/all-in-one', '/os', '/dashboard-os', '/all-in-one.html'] },

    { section: 'Research & Benchmark' },
    { group: 'Competitor Benchmarking', icon: 'competitor', gid: 'competitor', ver: 'v1', children: [
      { id: 'comp-discover',label: 'Discover Brands',href: '/competitor-benchmarking.html#discover', icon: 'discover' },
      { id: 'comp-mailers', label: 'Mailers',        href: '/competitor-benchmarking.html#mailers',  icon: 'mailer' },
      { id: 'comp-meta',    label: 'Meta Ads',       href: '/competitor-benchmarking.html#meta',     icon: 'meta' },
      { id: 'comp-google',  label: 'Google Ads',     href: '/competitor-benchmarking.html#google',   icon: 'google' },
      { id: 'comp-tiktok',  label: 'TikTok Ads',     href: '/competitor-benchmarking.html#tiktok',   icon: 'tiktok' },
      { id: 'comp-landing', label: 'Landing Pages',  href: '/competitor-benchmarking.html#landing',  icon: 'landing' },
      { id: 'comp-insights',label: 'Insights',       href: '/competitor-benchmarking.html#insights', icon: 'insights' },
    ]},
    { group: 'Knowledge Base', icon: 'kb', gid: 'kb', ver: 'v1', children: [
      // The ACTIVE brand's knowledge documents, each at its own address
      // (/kb/brand/<doc>, brand-doc.html), built from that brand's record.
      { id: 'kbv-brand',   label: 'Brand Documents', href: '/kb/brand', icon: 'kb', match: ['/kb/brand', '/brand-doc.html', '/doc'] },
      { id: 'kbv-mailers', label: 'Mailers',       href: '/knowledge-base.html#mailers', icon: 'mailer' },
      { id: 'kbv-meta',    label: 'Meta Ads',      href: '/knowledge-base.html#meta',    icon: 'meta' },
      { id: 'kbv-google',  label: 'Google Ads',    href: '/knowledge-base.html#google',  icon: 'google' },
      { id: 'kbv-tiktok',  label: 'TikTok Ads',    href: '/knowledge-base.html#tiktok',  icon: 'tiktok' },
      { id: 'kbv-landing', label: 'Landing Pages', href: '/knowledge-base.html#landing', icon: 'landing' },
    ]},
    { id: 'designintel', label: 'Design Intelligence', href: '/design-intel', icon: 'insights', ver: 'v2', match: ['/design-intel', '/design-intelligence', '/design-intelligence.html'] },
    { group: 'Data Analysis', icon: 'analysis', gid: 'dataanalysis', ver: 'v2', match: ['/data-analysis', '/data-analysis.html', '/analytics', '/dashboard.html', '/rfm', '/d2c-review', '/business-review', '/usa-d2c-report', '/usa-d2c-dashboard'], children: [
      // Labels and tab ids track analysis-registry.js, which is what the
      // workbench builds its own tab bar from. A rail that names a tab
      // differently from the tab is how a reader concludes there are two of
      // them. Retired tab ids still resolve, so an old bookmark keeps working
      // even though the rail now carries the current one.
      { id: 'da-control',  label: 'Control Room',                  href: '/data-analysis?tab=control',              icon: 'analysis' },
      { id: 'da-acq',      label: 'Acquisition',                   href: '/data-analysis?tab=acq',                  icon: 'insights' },
      { id: 'da-ret',      label: 'Retention',                     href: '/data-analysis?tab=ret',                  icon: 'insights' },
      { id: 'da-cohort',   label: 'Cohort Retention',              href: '/data-analysis?tab=cohort',               icon: 'cohort' },
      { id: 'da-liveads',  label: 'Paid Media',                    href: '/data-analysis?tab=live-ads',             icon: 'ads', match: ['/ads-master', '/ad-campaigns-master', '/ads-kb', '/ad-campaigns-master.html'] },
      { id: 'da-mailer',   label: 'Owned Channels',                href: '/data-analysis?tab=mailer-intelligence',  icon: 'insights' },
      { id: 'da-landing',  label: 'Landing & Experiments',         href: '/data-analysis?tab=landing-intelligence', icon: 'landing' },
      { id: 'da-actions',  label: 'Actions & Outcomes',            href: '/data-analysis?tab=action-outcomes',      icon: 'insights' },
      { id: 'da-alerts',   label: 'Alert Settings',                href: '/data-analysis?tab=alert-settings',       icon: 'insights' },
      { id: 'da-review',   label: 'Sales & Business Review',       href: '/data-analysis?tab=review',               icon: 'analysis', match: ['/d2c-review', '/business-review', '/usa-d2c-report', '/usa-d2c-dashboard'] },
      // dashboard.html is served at /rfm (see vercel.json) and nothing in the
      // rail pointed at it, so a whole page shipped unreachable. Labelled
      // "Draft 1" per the V1/V2 taxonomy: the Cohorts group below is Draft 2 of
      // the same capability.
      { id: 'da-rfm',      label: 'RFM Dashboard (Draft 1)',       href: '/rfm',                                    icon: 'analysis', ver: 'v1', match: ['/rfm', '/dashboard.html'] },
    ]},
    { group: 'Cohorts', icon: 'cohort', gid: 'cohorts', ver: 'v1', children: [
      { id: 'coh-overview',   label: 'Overview',            href: '/cohorts?tab=overview',   icon: 'cohort' },
      { id: 'coh-engagement', label: 'Engagement Cohorts',  href: '/cohorts?tab=engagement', icon: 'insights' },
      { id: 'coh-englevel',   label: 'Engagement Levels',   href: '/cohorts?tab=englevel',   icon: 'insights' },
      { id: 'coh-product',    label: 'Product Cohorts',     href: '/cohorts?tab=product',    icon: 'cohort' },
      { id: 'coh-lifecycle',  label: 'Lifecycle Stages',    href: '/cohorts?tab=lifecycle',  icon: 'cohort' },
      { id: 'coh-rfm',        label: 'RFM Segments',        href: '/cohorts?tab=rfm',        icon: 'analysis' },
      { id: 'coh-behavioral', label: 'Behavioral',          href: '/cohorts?tab=behavioral', icon: 'cohort' },
    ]},
    { id: 'avatars', label: 'Avatars (Personas)', href: '/avatars', icon: 'avatars', ver: 'v2', match: ['/avatars', '/personas', '/avatars.html'] },

    { section: 'Plan' },
    // Growth OS sits first in Plan because it frames everything under it: the
    // funnel, the north star and the ranked experiment list are what a calendar
    // is supposed to serve. It is built from the brand record alone, so it is
    // the one feature here that renders in full on day one with nothing connected.
    { id: 'growthos', label: 'Growth OS', href: '/growth-os', icon: 'insights', ver: 'v2', match: ['/growth-os', '/growth', '/growth-os.html'] },
    // Automated Calendar Creation — the ONE calendar + asset-generation feature.
    // A single flat feature, NO sub-items: it combines the best logic of the
    // former Smart Brain engine, the Mailer Calendar and the Plan Calendar into
    // one automated calendar that plans every slot and pre-builds its full asset
    // bundle (mailer + ads + landing page). The older calendar surfaces stay
    // reachable by URL but are no longer separate nav features; this one
    // feature's match[] also lights up for them.
    { id: 'brain', label: 'Smart Brain', href: '/brain', icon: 'calendar', ver: 'v2', match: ['/brain', '/smart-brain', '/smart-brain.html', '/mailer-calendar', '/lifecycle-calendar.html', '/calendar.html', '/plan'] },
    { id: 'retentionplaybook', label: 'Retention Playbook', href: '/retention-playbook', icon: 'calendar', ver: 'v2', match: ['/retention-playbook', '/retention-playbook.html'] },
    // UK Non-Engagers Hub removed from the user-facing nav (route /uk-non-engagers
    // stays reachable directly); it is no longer a raw nav item.

    { section: 'Design & Create' },
    { id: 'frameworks', label: 'Frameworks', href: '/frameworks', icon: 'kb', ver: 'v2', match: ['/frameworks', '/frameworks.html'] },
    // Mailer Studio is an OPEN feature — works standalone without sign-in.
    { id: 'studio', label: 'Mailer Studio',   href: '/studio', open: true, icon: 'studio', ver: 'v1', draft: 'Draft 1', match: ['/studio', '/lifecycle_mailer_architect_v34.html', '/app', '/mailer'] },
    // Independent LHS item (product-owner request 2026-07-25): the master ads
    // knowledge base + performance dashboard compiled from the KT handover
    // (emails, spend workbook, social update deck) + live connector reads.
    // "Ad Campaigns Master Dashboard -> /ads-master" used to sit here as a
    // top-level row. /ads-master is a REDIRECT (vercel.json redirects, not
    // rewrites) to /data-analysis?tab=live-ads — which the Data Analysis group
    // already lists as "Paid Media". Two rows, one page, and the redirect hid
    // it from any check that only reads rewrites. The description that lived on
    // this row moved to the row that survives.
    { group: 'Ad Campaigns', icon: 'ads', gid: 'ads', ver: 'v1', children: [
      { id: 'ads-perf',    label: 'Ad Performance', href: '/ads-dashboard', icon: 'analysis', ver: 'v2', match: ['/ads-dashboard', '/ad-performance', '/ads-dashboard.html'] },
      { id: 'ads-cal',     label: 'Calendar',   href: '/ad-campaigns.html#calendar', icon: 'calendar' },
      { id: 'ads-meta',    label: 'Meta Ads',   href: '/ad-campaigns.html#meta',     icon: 'meta' },
      { id: 'ads-google',  label: 'Google Ads', href: '/ad-campaigns.html#google',   icon: 'google' },
      { id: 'ads-tiktok',  label: 'TikTok Ads', href: '/ad-campaigns.html#tiktok',   icon: 'tiktok' },
    ]},
    // TWO GROUPS, because these are two features.
    //
    // Everything below used to sit in one group called "3D Storefront &
    // Websites": the 3D storefront AND every landing-page feature. So the
    // landing-page builder's own sub-pages were filed under a heading that does
    // not mention landing pages, while "Landing Pages" appeared as a row under
    // Competitor Benchmarking and again under Knowledge Base — three places
    // using the term, none of them the builder. The builder's own root
    // (/landing-pages) was not reachable from the rail at all; the four rows
    // jumped straight to anchors inside it.
    { group: '3D Storefront & Websites', icon: 'landing', gid: 'storefront3d', ver: 'v2', match: ['/3d', '/storefront-3d', '/storefront-3d.html', '/shop-3d', '/store-3d', '/official-designs', '/official-designs.html', '/designs'], children: [
      { id: 'store3d-all', label: '3D Storefront (overview)', href: '/3d', icon: 'knickgasm', match: ['/3d', '/storefront-3d', '/storefront-3d.html', '/shop-3d'] },
      { id: 'web-us',     label: '🇺🇸 US Website',     href: '/3d/us',     icon: 'knickgasm', match: ['/3d/us', '/store-3d-us'] },
      { id: 'web-uk',     label: '🇬🇧 UK Website',     href: '/3d/uk',     icon: 'knickgasm', match: ['/3d/uk', '/store-3d-uk'] },
      { id: 'web-global', label: '🌍 Global Website',  href: '/3d/global', icon: 'knickgasm', match: ['/3d/global', '/store-3d-global'] },
      { id: 'web-india',  label: '🇮🇳 India Website',  href: '/3d/in',     icon: 'knickgasm', match: ['/3d/in', '/3d/india', '/store-3d-in'] },
      { id: 'lp-overview', label: 'Design References', href: '/website-designs', icon: 'landing', match: ['/website-designs', '/website-designs.html'] },
    ]},
    // "Landing Page Builder", not "Landing Pages". Competitor Benchmarking and
    // Knowledge Base each carry a "Landing Pages" ROW, and both are part of a
    // parallel channel set (Mailers / Meta / Google / TikTok / Landing Pages)
    // that this repo's design rules say to keep equal and aligned — renaming one
    // of them to dodge a collision would break the set. Naming this group for
    // what it holds costs nothing and leaves those rows alone. (The reference
    // repo calls its group "Landing Pages" and carries the same collision.)
    { group: 'Landing Page Builder', icon: 'landing', gid: 'landing', ver: 'v2', match: ['/landing-pages', '/landing-pages.html', '/landing-page-templates', '/templates', '/template-gallery', '/template-gallery.html'], children: [
      // The builder itself, first. Its four rows are anchors INSIDE this page,
      // so without it there was no row that opened the page from the top.
      { id: 'lp-build',   label: 'Overview (all channels)', href: '/landing-pages', icon: 'landing', match: ['/landing-pages', '/landing-pages.html'] },
      { id: 'lp-mailers', label: 'For Mailers',    href: '/landing-pages#mailers',  icon: 'mailer' },
      { id: 'lp-meta',    label: 'For Meta Ads',   href: '/landing-pages#meta',     icon: 'meta' },
      { id: 'lp-google',  label: 'For Google Ads', href: '/landing-pages#google',   icon: 'google' },
      { id: 'lp-tiktok',  label: 'For TikTok Ads', href: '/landing-pages#tiktok',   icon: 'tiktok' },
      { id: 'lp-templates', label: 'Landing Page Templates', href: '/landing-page-templates', icon: 'landing', match: ['/landing-page-templates', '/templates', '/template-gallery', '/template-gallery.html'] },
      // Tenant zero's own landing artefacts. Hidden once another brand is
      // active (data-shipped-nav); they are not this product's live pages.
      { id: 'lp-best',    label: '★ Live: Agent Page', href: '/lp/best',  icon: 'knickgasm', match: ['/lp/best'], shipped: true },
      { id: 'lp-best-3d', label: '★ 3D Agent Page (motion)', href: '/lp/best-3d', icon: 'knickgasm', match: ['/lp/best-3d'], shipped: true },
      { id: 'lp-agent',   label: 'Landing Page with All-In-One Voice+Chat+Talk Agent',   href: '/lp/agent', icon: 'knickgasm', match: ['/lp/agent'] },
    ]},

    { id: 'music', label: 'Music (Official Songs)', href: '/music', icon: 'knickgasm', ver: 'v2', match: ['/music', '/music.html'] },

    { section: 'Share & Track' },
    { id: 'social', label: 'Social Media OS', href: '/social', icon: 'social', ver: 'v2', match: ['/social', '/social-media', '/social-media.html'] },
    { id: 'assets', label: 'Created Assets', href: '/assets', icon: 'analysis', ver: 'v1', match: ['/assets', '/assets.html'] },
    // ONE navigation layer: the suite no longer renders its own column, so its
    // modules live here, in the same order as the AI-TeleSuite source app.
    { group: 'TeleSuite', icon: 'avatars', gid: 'telesuite', ver: 'v2',
      match: ['/telesuite', '/telesuite.html'], children: [
      // "Overview", not "Home": the rail already has a Home that goes to /, and
      // a second row with the same word pointing somewhere else is the kind of
      // repeat that makes a menu feel duplicated. Every other group's root row
      // here is named for what it opens ("3D Storefront (overview)", "Overview
      // (all regions)"), so this follows that.
      { id: 'ts-home', label: "Overview (all tools)", href: '/telesuite#home', icon: 'analysis' },
      { id: 'ts-products', label: "Products", href: '/telesuite#products', icon: 'analysis' },
      // "Call Knowledge Base": the top-level Knowledge Base group is the
      // app-wide one, and this is TeleSuite's own grounding library for pitches,
      // rebuttals and call scoring. Two rows reading "Knowledge Base" and
      // opening two different libraries is the repeat this removes.
      { id: 'ts-knowledgebase', label: "Call Knowledge Base", href: '/telesuite#knowledge-base', icon: 'analysis' },
      { id: 'ts-pitchgenerator', label: "AI Pitch Generator", href: '/telesuite#pitch-generator', icon: 'analysis' },
      { id: 'ts-rebuttalgenerator', label: "AI Rebuttal Assistant", href: '/telesuite#rebuttal-generator', icon: 'analysis' },
      { id: 'ts-transcription', label: "Audio Transcription", href: '/telesuite#transcription', icon: 'analysis' },
      { id: 'ts-transcriptiondashboard', label: "Transcription DB", href: '/telesuite#transcription-dashboard', icon: 'analysis' },
      { id: 'ts-callscoring', label: "AI Call Scoring", href: '/telesuite#call-scoring', icon: 'analysis' },
      { id: 'ts-callscoringdashboard', label: "Call Scoring DB", href: '/telesuite#call-scoring-dashboard', icon: 'analysis' },
      { id: 'ts-combinedcallanalysis', label: "Combined Call Analysis", href: '/telesuite#combined-call-analysis', icon: 'analysis' },
      { id: 'ts-combinedcallanalysisdashboard', label: "Combined Analysis DB", href: '/telesuite#combined-call-analysis-dashboard', icon: 'analysis' },
      { id: 'ts-voicesalesagent', label: "AI Voice Sales Agent", href: '/telesuite#voice-sales-agent', icon: 'analysis' },
      { id: 'ts-voicesalesdashboard', label: "Voice Sales DB", href: '/telesuite#voice-sales-dashboard', icon: 'analysis' },
      { id: 'ts-voicesupportagent', label: "AI Voice Support Agent", href: '/telesuite#voice-support-agent', icon: 'analysis' },
      { id: 'ts-voicesupportdashboard', label: "Voice Support DB", href: '/telesuite#voice-support-dashboard', icon: 'analysis' },
      { id: 'ts-createtrainingdeck', label: "Training Material Creator", href: '/telesuite#create-training-deck', icon: 'analysis' },
      { id: 'ts-trainingmaterialdashboard', label: "Material DB", href: '/telesuite#training-material-dashboard', icon: 'analysis' },
      { id: 'ts-dataanalysis', label: "AI Data Analyst", href: '/telesuite#data-analysis', icon: 'analysis' },
      { id: 'ts-dataanalysisdashboard', label: "Data Analysis DB", href: '/telesuite#data-analysis-dashboard', icon: 'analysis' },
      { id: 'ts-batchaudiodownloader', label: "Batch Audio Downloader", href: '/telesuite#batch-audio-downloader', icon: 'analysis' },
      { id: 'ts-activitydashboard', label: "Global Activity Log", href: '/telesuite#activity-dashboard', icon: 'analysis' },
      { id: 'ts-cloneapp', label: "Clone Full App", href: '/telesuite#clone-app', icon: 'analysis' },
      { id: 'ts-n8nworkflow', label: "n8n Workflow", href: '/telesuite#n8n-workflow', icon: 'analysis' },
    ] },

    { section: 'Assistants' },
    // KicksGPT (internal team chat/info tool) and Knickgasm Agent (customer-facing
    // concierge) are conversational assistants and stay here. The former Smart
    // Brain moved to Plan and was renamed Automated Calendar Creation — it is a
    // calendar-creation feature, not a chat assistant, so it no longer lives here.
    { id: 'kicksgpt', label: 'Brand Assistant',   href: '/kicksgpt', icon: 'knickgasm', ver: 'v1', match: ['/kicksgpt', '/kicks', '/ask', '/kicksgpt.html'] },
    { id: 'agent',   label: 'Brand Agent', href: '/agent',   icon: 'knickgasm', ver: 'v1', match: ['/agent', '/agent.html'] },

    { section: 'Settings' },
    { id: 'connectors', label: 'Connectors', href: '/connectors', icon: 'insights', ver: 'v2', match: ['/connectors', '/connectors.html'] },
    { id: 'accessissues', label: 'Access Issues', href: '/access-issues', icon: 'insights', ver: 'v2', match: ['/access-issues', '/access', '/access-issues.html'] },

    // ── "Aman's version" (aka "Aman's code") — the frozen 3 Jul 2026 build ──
    // Hidden from the rail per product-owner request, but KEPT as a feature: the
    // code still lives under /diff-version and is reachable by direct URL. If the
    // owner refers to "Aman's code" / "Aman's version" anywhere, it means THIS
    // frozen snapshot. Uncomment the two lines below to restore it to the menu.
    // { section: 'Archive' },
    // { id: 'diffversion', label: "Aman's version", href: '/diff-version', icon: 'insights', ver: 'v2', draft: "Aman's code — frozen 3 Jul 2026 build", match: ['/diff-version', '/diff-version.html', '/diff-version/pages/mailer-calendar.html', '/diff-version/pages/uk-non-engagers.html', '/diff-version/pages/social-media.html'] },
  ];

  // ─── Feature IA (standing rule — see CLAUDE.md "LHS navigation IA rule") ──
  // EVERY feature item in this menu expands into the SAME five sub-items, in
  // this exact order: 1 What does it do? · 2 Who is it for? · 3 How does it
  // work? · 4 Input · 5 Step-by-Step Working. For content-producing features
  // (mailers, ads, landing pages, campaign plans) step 5 maps to the
  // multi-agent pipeline: Ideology → Data analysis + review + hypothesis →
  // Business & strategy decisions → Content → Design + layout + structure →
  // Audio/Video (where applicable) → Coding → Final compilation + presentation.
  // Content rules: double-quoted strings only (apostrophes are fine, never use
  // a double quote or backtick inside), text positions only (never attributes).
  const SUBQ = [
    ['what',  'What does it do?'],
    ['who',   'Who is it for?'],
    ['how',   'How does it work?'],
    ['input', 'Input'],
    ['steps', 'Step-by-Step Working'],
  ];
  // Each entry: { title, what, who, how, input, steps:[[name, detail, runsVia?]…], pipeline?:true }
  const INFO = {
    // Home is a plain landing link, not a content-producing feature, so it
    // deliberately has NO 5-sub-item IA entry — it renders as a simple link.
    publishing: {
      title: 'Publishing & Deliverability',
      what: "The half of the platform that SENDS. Everything else here creates an asset; this maps one onto the platforms a brand has connected, checks whether sending it is safe, and dispatches it. It also holds the deliverability engine: SPF, DKIM, DMARC, MX and BIMI parsed rather than merely counted, blocklist lookups, a warmup ramp with automatic throttles, and a spam analysis of the specific message about to go out.",
      who: "The owner or an editor of the active brand workspace. Live publishing is a second, deliberate switch on top of storing a credential, because storing a key is permission to read and sending as somebody's brand is not the same decision.",
      how: "One pipeline. An asset is mapped by a platform adapter into that platform's own payload; the preflight gate scores domain authentication, warmup caps, segment health, the cross-channel frequency cap and content spam signals, returning pass, warn or block; a passing job joins a queue that leases each job, retries with exponential backoff and jitter, honours a platform's own Retry-After and cannot double-post because a unique idempotency key covers the intent. A block can be overridden, and the override is recorded against the person who made it with their reason.",
      input: "The asset (copy, HTML, images, headlines), the channels to send it to, a dispatch mode of publish now, schedule or export as draft, and the sending domain. A check that could not be performed is reported as a warning, never as a pass.",
      steps: [
        ['Ideology', 'A send that reaches a spam folder is not a send, so the deliverability gate belongs in front of the dispatcher rather than beside it.'],
        ['Data analysis + review + hypothesis', 'Resolves DNS for the sending domain, scores the audience by recency, frequency and monetary value against the brand\'s own distribution, and estimates bounce risk from addresses that already hard bounced.'],
        ['Business & strategy decisions', 'Matches message priority to engagement tier and applies the promotional cap of 2 touches per rolling 7 days from the campaign spec, counted ACROSS email, SMS and push rather than per channel.'],
        ['Content', 'Analyses the specific message for spam signals, image to text ratio, link quality and a missing unsubscribe, which is a legal exposure rather than a matter of taste.'],
        ['Design + layout + structure', 'The score dial, the DNS checklist and the warmup ramp render from brand tokens like every other surface.'],
        ['Coding', 'Adapters implement one contract in api/_shared/adapters/; the queue converges on the job row and re-fires itself, because this deployment has nowhere to run a worker process. Mounted on the existing brain and public-config routers, so no thirteenth serverless function.'],
        ['Final compilation + presentation', 'Every attempt, its error class and its backoff are recorded, and the platform\'s own callbacks reconcile the result. Runs via: /api/brain?action=dispatch-enqueue'],
      ],
    },
    connections: {
      title: 'Connections & AI Models',
      what: "The place a brand brings its own accounts. Two things live here: the platforms this brand runs on (commerce, ad platforms, lifecycle and mailer tools) and the AI providers whose models write its work. A key entered here is encrypted inside the server, is never returned to the browser and is never written to a log, so the page can only ever show you its last four characters.",
      who: "The owner or an editor of the active brand workspace. A viewer can see what is connected and cannot change it. Everything stored is private to this one workspace: no other brand on the deployment can read or spend it.",
      how: "Two records per brand. A connection row holds the non-secret settings and a four character hint; the secret itself sits encrypted in a separate table that the browser role cannot select from at all, and only the server reads it, after checking the caller's own session and their role. The AI tab writes an ORDERED list of providers, each with its own ordered model list, and api/_shared/llm.js runs exactly that order instead of its default cascade. Your key for a provider replaces the platform key for that provider, so a brand that brought its own account is never quietly spending the platform's quota.",
      input: "For a platform: whatever that platform issues, which is usually an API key or an account token plus an account id. For AI: a provider key, then the providers in the order you want them tried and the models inside each. Where a sign-in flow has not been established for a platform, the page says so with a DATA REQUIRED marker rather than showing a button that goes nowhere.",
      steps: [
        ['Ideology', 'A brand should be able to run the whole platform on its own accounts, and a secret should be readable by nothing except the code that spends it.'],
        ['Data analysis + review + hypothesis', 'Reads what this workspace has already connected and which providers the platform itself can still cover, so the page can say whether a key is needed at all.'],
        ['Business & strategy decisions', 'The order you set decides which providers see the prompts of this brand, so it outranks the internal speed optimisation that pins whichever provider answered first.'],
        ['Content', 'Nothing is generated here. The stored routing is what every other feature then generates through.'],
        ['Design + layout + structure', 'Rendered entirely from brand tokens, so the page re-skins with the workspace like every other surface.'],
        ['Coding', 'Encrypted with AES-256-GCM under CONNECTION_SECRET_KEY before storage; metadata is written with the token of the caller so RLS decides, and secrets are written with the service role only after the role check passes. Mounted on the existing public-config router, so no thirteenth serverless function.'],
        ['Final compilation + presentation', 'The resolved routing is handed to the model cascade for every generation this workspace runs. Runs via: /api/public-config?action=connections'],
      ],
    },
    payments: {
      title: 'Payment Gateways',
      what: "Attaches the brand's OWN payment gateway account to this workspace, so the rest of the platform can reference real money: revenue against a campaign, a payout a lifecycle send should be credited with, a checkout the campaign points at. The operator picks a gateway, signs in at that gateway, and it belongs to this brand. Where a provider genuinely offers no sign-in, the page says so instead of pretending.",
      who: "The owner or an editor of the active brand workspace. A connection belongs to exactly one workspace and no other brand on the deployment can read it, not even its existence.",
      how: "Three providers use a real sign-in. Stripe uses Connect OAuth for Standard accounts. Razorpay uses partner OAuth when this deployment holds partner credentials, and falls back to a key id and secret when it does not, which is a real limitation of not being an approved partner rather than a shortcut. PayPal mints a one-time partner referral link that the merchant signs in through. Shopify signs the operator into their own store, which grants READ access to Shopify Payments payouts and disputes and cannot make this platform a processor on that store.",
      input: "A choice of gateway, and then a sign-in at that provider. For Shopify, the store domain first, because sign-in happens on the store's own domain. For the Razorpay key path only, a key id and key secret from the merchant's own dashboard.",
      steps: [
        ['Ideology', 'A merchant should connect by signing in, not by hunting for a secret. Where that is not possible, say so on the page.'],
        ['Data analysis + review + hypothesis', 'Reads what this deployment is registered for with each provider and reports the missing environment variables by name, so a disabled button always explains itself.'],
        ['Business & strategy decisions', 'Read-only scope is requested by default. Write scope is offered but not assumed, because a platform that can charge a merchant account should have been asked first.'],
        ['Content', 'Nothing is generated here. The stored connection is what other features then reconcile revenue against.'],
        ['Design + layout + structure', 'Rendered from brand tokens, so it re-skins with the workspace like every other surface.'],
        ['Coding', 'The OAuth state binds the returning code to the workspace and user that started the flow, so a code cannot be redeemed into a different brand. Credentials are sealed with AES-256-GCM under PAYMENTS_ENCRYPTION_KEY before storage, the ciphertext columns are revoked from every browser-facing database role, and the browser only ever receives a four character hint. Mounted on the existing public-config router, so no thirteenth serverless function.'],
        ['Final compilation + presentation', 'A connected gateway is available to every feature that needs real payment data. Runs via: /api/public-config?action=payments'],
      ],
    },
    designsystem: {
      title: "Design System",
      what: "The Lifecycle OS design system, live: the platform's own mark and logo set, the surface contract that says which token paints every ground, text and edge, and every component of the app rendered in the ACTIVE brand, with each text colour's measured contrast against its ground.",
      who: "Anyone building or reviewing a screen, and a brand owner checking that their colours read well everywhere before activating them.",
      how: "Every colour on the page is a role token from theme.css, resolved through the brand tokens brand-context.js paints from the active record. Brand-coloured text is derived for its ground, a brand-coloured section goes through sectionGround so it is never a dark neutral, and the platform mark stays neutral whatever brand is active. The contract and its machine-readable tokens live in design/lifecycle-os.",
      input: "The active brand's record: its palette, typography and name. Nothing is typed on this page.",
      steps: [
        ["Ideology", "One contract for every screen: a page picks a role, never a colour, so it re-skins to any brand and stays readable."],
        ["Data analysis + review + hypothesis", "Reads the brand tokens tokens() derived for this brand and measures each text token against the ground it is allowed on."],
        ["Business & strategy decisions", "The platform's identity stays the platform's; the brand owns the colours, type and copy."],
        ["Content", "Specimen copy only. No brand fact is written here."],
        ["Design + layout + structure", "Every kit component in theme.css, the icon set and the illustrations, laid out as a sheet."],
        ["Coding", "Static page on the shared shell; tests/design-system.spec.js renders it under six palettes and fails on an unreadable pair, a dark section or a colour literal."],
        ["Final compilation + presentation", "The same contract is published as the Lifecycle OS Design System. Runs via: /design-system"],
      ],
    },
    brandinput: {
      title: 'Brand Kit',
      what: "The single brand-truth record for the platform: the four-colour palette, the two type families, the voice (tone, tagline, do and banned lists) and the footer identity blocks. Every generator in the OS reads this one record, so it is the place brand truth is set once instead of being retyped into each feature.",
      who: "The brand owner. Brand Setup (/onboarding) is where a NEW brand workspace is created and activated - this page is where the active brand's kit is fine-tuned afterwards.",
      how: "Reads and writes the lifecycle_brand_kit singleton in Supabase through /api/kb?action=brand-kit. Colours are validated as #RRGGBB and the body-text-on-background pair is contrast-checked against WCAG AA before a save is allowed to look healthy. The Verify panel compares the saved palette against the prompt-side brand block in api/_shared/master-prompt.js and flags drift, because generated copy reads that block rather than the database.",
      input: "Four hex colours, two font families with their CSS stacks, a tone line and tagline, the do and banned phrase lists, and the footer legal, contact and social values.",
      steps: [
        ['Ideology', 'One brand record, many consumers: never let a second copy of brand truth exist.'],
        ['Data analysis + review + hypothesis', 'Loads the saved singleton and compares it against the live store theme and the prompt block.'],
        ['Business & strategy decisions', 'The do and banned lists become the enforced gates every generated asset is scrubbed against.'],
        ['Content', 'Tone, tagline and the word lists feed straight into every generation prompt.'],
        ['Design + layout + structure', 'Palette and typography drive mailer, ad and landing-page rendering; the live preview shows the pairing before saving.'],
        ['Coding', 'Persisted via /api/kb?action=brand-kit (GET reads, POST upserts) - no thirteenth serverless function, it extends the existing KB router.'],
        ['Final compilation + presentation', 'Saved values are what the next generated asset uses. Runs via: /api/kb?action=brand-kit'],
      ],
    },
    growthos: {
      title: 'Growth OS',
      what: "The growth operating picture for the active brand: a ranked experiment roadmap, a funnel audit with the largest expected leak marked, a checklist audit of the surfaces that carry conversion, a north-star metric with its input and channel metrics, a cohort framework, a 30-60-90 plan, a day-by-day first week, and the competitive read. It is what a growth lead would hand you in week one, built for whatever this brand happens to sell.",
      who: "Whoever owns growth for the active brand, on day one. It is the first page to open on a new workspace, because it renders in full before anything is connected.",
      how: "The model is chosen from what the brand actually offers, by weight rather than by presence, so a store is run as a store and a publisher as a publisher: the funnel, the north star and the whole experiment library change with it. Experiment confidence is computed rather than asserted - it rises when an experiment rests on a fact the brand has supplied, and falls when it depends on a number nobody has measured, which is what stops a day-one roadmap from looking equally certain about everything. Every figure carries its basis: measured, modelled or unset. A modelled sector benchmark is shown as a range and is never written into a value field, so it cannot be mistaken for this brand's own result.",
      input: "Nothing to enter. It reads the active brand record: offerings, regions, claims and the recorded market study. Connecting analytics replaces modelled ranges with measured values.",
      steps: [
        ['Ideology', 'Same depth of growth thinking for every brand, and never a number this brand has not earned.'],
        ['Data analysis + review + hypothesis', 'Picks the growth model from the offering mix, then instantiates the funnel, the KPI tree and the experiment library against it.'],
        ['Business & strategy decisions', 'Scores every experiment on impact, computed confidence and ease, ranks by ICE, and marks as blocked any whose precondition the brand record does not yet satisfy.'],
        ['Content', "Hypotheses are written with this brand's own offerings, regions and verifiable claims; nothing is carried over from another tenant."],
        ['Design + layout + structure', 'Renders through the brand tokens, so the page re-skins with the brand like every other surface.'],
        ['Coding', 'Deterministic and offline: no LLM, no network, no key, so the page always renders identically and instantly. Runs via: /api/brain?action=growth-os'],
        ['Final compilation + presentation', 'Nine tabs over one model, plus an open-gaps list naming exactly what is missing before any of it can run on real numbers. Runs via: /api/brain?action=growth-os'],
      ],
    },
    appaudit: {
      title: 'Overall App Audit',
      what: "A live quality scorecard for the whole OS. Every feature is rated on four axes — accuracy (is the output factually true, no fabrication), implementation (code robustness), execution (does it work end-to-end in production), and results (does it drive a usable outcome). The confidence bar is 9.5: nothing is 'done' below it.",
      who: "The product owner and the growth team, as the single place to judge whether the app is trustworthy enough to run the brand.",
      how: "Scores come from deep code audits (file-level findings), not impressions. The page computes an overall from the audited features, surfaces the three systemic blockers that cap quality (fabrication, the stale prod key, and the missing Klaviyo/Shopify feeds), and lists the roadmap that lifts each feature to 9.5.",
      input: "Nothing to enter — it reads the recorded audit. The full written audit is downloadable as Markdown for offline analysis.",
      steps: [
        ['Ideology', 'Real-only, zero-fabrication quality: a feature is only as good as the truth of what it ships.'],
        ['Data analysis + review + hypothesis', 'Deep per-feature code audits produce file-level findings and four-axis scores.'],
        ['Business & strategy decisions', 'The three systemic blockers are identified and prioritised by blast radius.'],
        ['Content', 'Each feature gets a plain-English gap note: what to fix to reach 9.5.'],
        ['Design + layout + structure', 'Scores render as a ring + per-feature axis bars, colour-coded by threshold.'],
        ['Compilation + presentation', 'An overall rating, the blocker board, the scorecard and the roadmap, plus a downloadable Markdown audit.', '/audit']
      ]
    },
    // The Paid Media tab of Data Analysis.
    //
    // This slot used to hold the "Ad Campaigns Master Dashboard" description,
    // keyed 'adsmaster' for a top-level nav row. Two things were wrong with it.
    // The row redirected onto THIS page, so the rail offered one page twice.
    // And the text described a page that analysis-registry.js records as
    // DELETED - eleven tabs, an uploaded ads knowledge base, handover files -
    // removed because all of it was one advertiser's, carried over when this
    // repo was copied from a sibling. Re-pointing that text here would have
    // advertised a feature nobody can open. Rewritten to what this tab is.
    'da-liveads': {
      title: "Paid Media",
      what: "Paid performance for the ad accounts THIS workspace has connected: spend, delivery and campaign rollups read from those accounts. A workspace with nothing connected sees an empty state saying so, never another advertiser's numbers.",
      who: "The paid media and growth team of the active brand.",
      how: "Reads the connected ad accounts for the active workspace and treats the current day as partial rather than complete. Where no account is connected for a platform, that platform is reported as not connected instead of being shown as zero. Warehouse-depth rows live on the separate Ads Analysis page, which is a DEPLOYMENT-level Snowflake connection and labels its figures as such.",
      input: "Nothing to enter. Connect ad accounts under Connections, then filter by objective, delivery status and date range.",
      pipeline: true,
      steps: [
        ['Ideology', 'Report what the connected accounts actually returned, and name what is missing rather than filling it in.'],
        ['Data analysis + review + hypothesis', 'Campaign and objective rollups computed from this workspace\'s own delivery.', '/api/brain?action=ads-live'],
        ['Business & strategy decisions', 'Verdicts are scored on what each account can actually measure: return on ad spend only where a conversion signal fires, click and impression economics where the sale happens somewhere the ad cannot be credited for it.'],
        ['Content', 'Per-campaign rows with the platform\'s own metric names, so a figure can be traced back to its source.'],
        ['Design + layout + structure', 'Sortable, filterable tables in the active brand\'s palette; a not-connected state is a stated message, not an empty chart.'],
        ['Coding', 'A tab of the Data Analysis page reading workspace-scoped endpoints; no new serverless function, so the 12-function cap is untouched.', '/data-analysis?tab=live-ads'],
        ['Final compilation + presentation', 'Warehouse-depth rows via the separate Ads Analysis page.', '/ads-dashboard'],
      ],
    },
    kicksgpt: {
      title: 'Brand Assistant',
      what: "INTERNAL TOOL, for the active brand's team only (not customer-facing). The brand assistant is the ACTIVE brand's own LLM: a conversational operator that actually RUNS the growth stack instead of just chatting: it queries analytics, reads competitor benchmarks, searches the knowledge base, and can generate calendars and campaign assets on explicit request.",
      who: "The operator (growth and retention team). Its recommendations span every cohort — the nine RFM segments (Champions through Lost) and the UK engagement cohorts (Non-Buyers/Non-Engagers and T&B Buyers/Non-Engagers).",
      how: "A provider-agnostic tool-calling loop: the model emits strict JSON actions, the server executes them against the same _shared cores the public API routes use, feeds results back, and loops (default 5 steps, up to 3 tools in parallel). Because tool calls are plain JSON, it works across the whole 6-provider text waterfall, including free tiers. An evidence contract forces every recommendation to quote exact tool-sourced figures.",
      input: "A plain-English question or instruction in the chat. Write and generate tools (generate_calendar, generate_assets_for_slot, run_agentic_campaign, klaviyo) fire only when you explicitly ask.",
      steps: [
        ['Prompt', 'You ask a question; the loop pins the first live LLM provider so later steps skip dead keys.', '/api/brain?action=brand-chat'],
        ['Plan a tool call', 'The model emits a strict JSON action — one tool, or a batch of up to 3 run in parallel.'],
        ['Execute tools', 'ask_analytics · run_analysis · list_cohorts · get_calendar · get_competitor_benchmarks · search_knowledge_base · list_campaigns · klaviyo — each reuses the exact logic behind the public routes.', '/api/brain?action=brand-tools (manifest)'],
        ['Loop on evidence', 'Results feed back into the conversation; repeated tool+args calls are deduped; up to 5 reasoning steps.'],
        ['Final answer', 'A final action with exact figures, target metric and expected impact, a complete hypothesis, and competitor benchmarks — shown with the full tool trace.'],
      ],
    },
    brain: {
      title: 'Smart Brain',
      what: "The one calendar feature of the OS — it combines the automated engine (formerly Smart Brain), the Cohort Mailer Calendar (Draft 2) and the 30-Day Plan Calendar (Draft 1). It maintains a rolling 90-day campaign plan in Supabase (smart_calendar_entries), refreshes it every morning by diff — never a wholesale rewrite — and turns every human-approved slot into a complete campaign: mailer + Meta/Google/TikTok ads + a landing page.",
      who: "Every customer cohort gets slots — RFM segments and engagement cohorts alike. The lifecycle team supervises: nothing ships without a human approve.",
      how: "Six services run in sequence — KB, Analysis, Competitor, Calendar, Generation, Review. A daily Vercel Cron (03:30 UTC, CRON_SECRET-protected) syncs the plan; the console at /brain lists tentative slots for approve/reject; approving generates all assets and mirrors them into ads_generated and landing_pages_generated. Platform push is Phase 2 (push_status: not_integrated_phase_2).",
      input: "Nothing daily — the cron drives it. From you: approve or reject decisions per slot, plus optional feedback that recalibrates future planning.",
      pipeline: true,
      steps: [
        ['Ideology', 'Each slot starts as a campaign concept — the occasion, the angle, the single idea the send must carry. Maximum ideation before any data is touched.'],
        ['Data analysis + review + hypothesis', 'The KB, Analysis, and Competitor services pull owned assets, RFM and cohort signals, and competitor benchmarks, then state a testable hypothesis per slot.', '/api/calendar?action=smart-brain-sync-daily'],
        ['Business & strategy decisions', 'The Calendar service decides cohort, product focus, offer mechanic, and send date — diff-updating the rolling 90-day plan.', '/api/calendar?action=smart-brain-plan'],
        ['Content', 'On approval, the Generation service LLM-writes the mailer copy plus Meta, Google, and TikTok ad copy.', '/api/calendar?action=smart-brain-approve'],
        ['Design + layout + structure', 'Brand-gated templates apply the 4-colour palette and Montserrat / Instrument Sans; hero creative comes from the image cascade.'],
        ['Coding', 'Assets compile to production HTML — a Klaviyo-ready mailer and a landing page served at /lp/:campaignId.'],
        ['Final compilation + presentation', 'The Review service scores the output; everything is mirrored into ads_generated and landing_pages_generated and presented in the /brain console.', '/api/brain?action=cron (daily)'],
      ],
    },
    agent: {
      title: 'Brand Agent',
      what: "CUSTOMER-FACING TOOL, the concierge your customers talk to. A conversational concierge: talk (text or voice) to an expert in the active brand that answers product questions and recommends only that brand's real catalogue. The example pages at /lp/agent and /lp/best belong to the shipped brand; every other brand is served its own page.",
      who: "Prospective and existing customers on-site; strongest for Non-Buyers who need guidance to a first purchase. The team uses this page to configure and demo agents.",
      how: "A chat UI over the shared 6-provider LLM waterfall, grounded in brand voice and the product catalog. Voice replies use ElevenLabs TTS with a browser-TTS fallback. Agent personas can be created, updated, and synced from this page.",
      input: "A visitor question — preferences, goals, or gifting needs. For the team: agent persona settings.",
      steps: [
        ['Ask', 'The visitor describes what they want — calm evenings, a coffee alternative, a gift.', '/api/brain?action=agent-chat'],
        ['Ground', 'The agent answers in brand voice, grounded in real catalog products and regional store URLs.'],
        ['Recommend', 'It proposes specific products with honest pricing and lacing guidance.'],
        ['Speak', 'Optional voice output via ElevenLabs, falling back to the browser voice.', '/api/brain?action=tts'],
        ['Convert', 'CTAs deep-link to the right regional store product page (US/UK/EU/AU/IN).'],
      ],
    },
    analysis: {
      title: 'Data Analysis',
      what: "The full D2C growth analytics workbench, built on the live US and UK market exports. A dashboard of every analysis a growth team needs — revenue and AOV trends, sales by channel, product type and day of week, discount exposure, new-vs-returning split, returning-customer rate, customer acquisition, cohort retention, and top products — with a US/UK market toggle. Every widget drills into a detailed page with the complete data table, a bigger chart, a growth read, and a CSV download. The legacy RFM Retention Intelligence tool (upload-and-score) still lives at /rfm.",
      who: "The growth and retention team. The dashboard analyses the whole customer base and every revenue cut; the drill-downs and cohort heatmap feed cohort, RFM and lifecycle targeting used everywhere else in the OS.",
      how: "Data is compiled from the exported market CSVs (data/market/{us,uk}) by scripts/build-market-analytics.js into a single client-side module, so the dashboard renders real numbers with no upload and no server round-trip. The upstream ingestion and DuckDB engine that produces these exports is the DTC Data Engine, surfaced natively in-app at /data-engine. The RFM tool at /rfm still parses uploaded CSV/XLSX in the browser and scores the nine RFM segments.",
      input: "Nothing to upload for the dashboard — it reads the compiled market exports. Pick the market (US or UK) and open any widget to drill in and download its CSV. For the RFM tool: CSV/XLSX order and customer exports.",
      steps: [
        ['Compile', 'Market CSV exports are compiled into a self-contained data module by scripts/build-market-analytics.js.', 'scripts/build-market-analytics.js'],
        ['Overview', 'KPI tiles and a widget grid render trends, mix, retention and top products for the selected market.'],
        ['Drill in', 'Any widget opens a detailed page: full data table, larger chart, and a concrete growth read.'],
        ['Cohort read', 'The retention heatmap normalises each acquisition quarter to 100% so LTV assumptions and sticky cohorts are visible.'],
        ['Hand off', 'Cuts feed cohort, RFM and lifecycle targeting; the RFM tool at /rfm scores uploaded data for the segment lens.'],
      ],
    },
    music: {
      title: 'Music (Official Songs)',
      what: "The library of the active brand's official music: the branding track (with lyrics) that plays in-app and drops into ad creatives, social videos and landing pages as a native, brand-owned audio and video bed.",
      who: "Anyone producing outward-facing content: ad creatives, Social Media OS videos, landing pages and event assets that need on-brand, cleared audio.",
      how: "A self-contained page that streams each official track, and exposes a Use-in-ad action that copies the hosted asset URL and hands off to the Ad Campaigns builder. Tracks are served from /assets/media and are usable anywhere in the OS.",
      input: "Nothing to upload, the official tracks are bundled with the app. From you: pick a track, preview it, then copy its URL, copy an embed snippet, or download it for the creative you are building.",
      steps: [
        ['Ideology', 'Brand music carries the Feel Alive voice into sound: warm, sensory, heritage-led.'],
        ['Content', 'The branding track (with lyrics) is the first official song; more can be added to the same library.'],
        ['Audio/Video', 'Stream and preview in-app; the file is the brand-owned audio and video bed for ads and social.'],
        ['Coding', 'Served natively from /assets/media; copy the hosted URL or an embed snippet, or download for the target creative.', '/music'],
        ['Compilation', 'Drop it into an ad creative or social post via the Ad Campaigns builder.', '/ads'],
      ],
    },
    research: {
      title: 'Market Study',
      what: "The single narrative reference for how the active brand grows: brand truth, the US and UK market intelligence, live performance pulled from the market exports, the four buyer avatars and the cohort model, the retention operating principles, the growth plays currently running, and the data engine underneath it all. It is the connective story that the operational features read from.",
      who: "The whole growth and retention team. It frames every cohort and avatar the OS targets, and turns the raw analytics into prioritised, named growth plays.",
      how: "A self-contained page organised into tabs: Overview, Brand Foundation, Market Intelligence, Live Performance (real numbers from the compiled market data), Growth Plays, Retention Playbooks (the knowledge/retention library), and Data Engine. It links out to Avatars, Cohorts, and the Data Analysis workbench, and cites the market study, schemas and retention config.",
      input: "Nothing to upload — the book compiles the market exports and the brand knowledge base. From you: read it before planning, and use its growth plays and avatar/cohort mapping to brief every campaign.",
      steps: [
        ['Brand truth', 'Positioning, voice, palette and lexicon set the non-negotiable creative frame.'],
        ['Market intelligence', 'US coffee and functional-beverage sizing, benchmarks and the competitor brand matrix set the opportunity.'],
        ['Live performance', 'Real US and UK numbers ground every claim; the full workbench is one click away.', '/data-analysis'],
        ['Growth plays', 'The prioritised, data-grounded moves, each mapped to an avatar and cohort.'],
        ['Data engine', 'The ingestion and competitor-capture pipeline that feeds the active brand\'s own numbers. It never reads another brand\'s export.'],
      ],
    },
    avatars: {
      title: 'Avatars (Personas)',
      what: "The customer-persona layer of the OS: named, hyper-specific buyer avatars built on top of the cohort dictionary and the US coffee and functional-beverage market study. Each avatar bundles demographics, geography, price elasticity, core value driver, and churn triggers into one face a brief can target, so copy, imagery, and offers stay grounded in a real person rather than an abstract segment.",
      who: "The growth and creative team. The avatars translate the analytics cohorts (RFM segments, engagement cohorts, lifecycle stages) into behavioural buyer profiles for the active brand — e.g. the Identity Buyer, the Habitual Loyalist, the Gifting Connector, and the Curious Switcher.",
      how: "Personas are derived from the market-intelligence study (docs/market-intelligence) and the cohort model: each avatar maps to specific cohorts, carries hard planning numbers (age band, HHI, AOV, LTV:CAC, reactivation likelihood), and links to the schema that captures the same fields on a live profile (schemas/cohort-profile.json) and the retention triggers that fire for it (config/retention-triggers.yaml). Use the avatar name verbatim in a brief and every downstream tool inherits its targeting.",
      input: "Nothing to upload — the avatars are curated from the market study and the cohort dictionary. From you: pick the avatar a campaign targets, and read its value driver, elasticity, and churn triggers before writing the brief.",
      steps: [
        ['Read the market', 'The US coffee and functional-beverage landscape (TAM/SAM/SOM, brand matrix, regional matrix) frames who is worth winning and how they behave.'],
        ['Map to cohorts', 'Each avatar is pinned to the RFM segments, engagement cohorts, and product cohorts it represents, so it inherits real audiences.'],
        ['Load the profile fields', 'Demographics, geography, price elasticity, value driver, reactivation likelihood, and churn triggers are stated as hard planning numbers.'],
        ['Wire the triggers', 'The retention-trigger config names which automated webhooks fire for the avatar (churn risk, replenishment, win-back, VIP early access).'],
        ['Target in a brief', 'Name the avatar in any campaign and the mailer, ad, landing-page, and social tools inherit its voice, imagery, offer sensitivity, and cohort.'],
      ],
    },
    assets: {
      title: 'Created Assets',
      what: "The output shelf: every asset this OS has produced — mailers, Meta/Google/TikTok ads, landing pages — collected in one browsable place with previews, so finished work never gets lost in the tool that made it.",
      who: "The operator and reviewer. Each asset targets whichever cohort its originating campaign or slot was planned for.",
      how: "It reads the generation logs and stores the creation tools write to (mailer logs, the ads store, per-channel landing-page stores) and lists everything with preview, clone, and re-prompt affordances.",
      input: "Nothing to create here — the shelf fills up as Mailer Studio, Ad Campaigns, Landing Pages, and Smart Brain approvals produce work.",
      steps: [
        ['Collect', 'Assets register themselves as the creation tools save their output.'],
        ['Browse', 'Filter by type and channel — mailers, ads per platform, landing pages.'],
        ['Preview', 'Open any asset exactly as it will render.'],
        ['Reuse', 'Clone or re-prompt an asset back into its creation tool for the next iteration.'],
      ],
    },
    kb: {
      title: 'Knowledge Base',
      what: "The active brand's own reference library: our mailers, Meta/Google/TikTok ads, and landing pages, ingested and classified so every generator in this OS can ground itself in what the brand has actually shipped.",
      who: "The generation pipelines and the operator. It is not cohort-specific — it is the shared memory every cohort's campaigns draw on.",
      how: "A Supabase-backed router at /api/kb. Assets are ingested by URL with tags, classified by LLM, attributed to brands, and ranked; the page browses them by channel tab (Mailers / Meta / Google / TikTok / Landing Pages). Brand Documents (/kb/brand) are the active brand's foundation, catalogue, cohorts, offers, creative rules and market, built from its own record, each at its own address.",
      input: "URLs or captured emails to ingest, with tags. Bulk lists of top emails can be pushed in one call.",
      steps: [
        ['Ingest', 'Add an asset by URL with tags.', '/api/kb?action=ingest'],
        ['Classify', 'LLM classification tags each email with its angle, offer, and structure.', '/api/kb?action=classify-emails'],
        ['Brand-tag', 'Assets are attributed to brands, cross-referencing Competitor Benchmarking.', '/api/kb?action=brands'],
        ['Rank', 'Top-performing emails are ranked and kept fresh.', '/api/kb?action=top-emails'],
        ['Serve', 'Generators and the brand assistant search this library while writing new work.', '/api/kb?action=list'],
      ],
    },
    competitor: {
      title: 'Competitor Benchmarking',
      what: "Competitor intelligence: captures rival brands' marketing emails from a dedicated Gmail inbox into a Google Sheet, renders them for side-by-side study, and distils benchmarks — cadence, offer depth, creative angles. The competitor set is the ACTIVE brand's own universe. It also owns brand discovery.",
      who: "The strategy layer. Benchmarks feed the brand assistant's evidence contract, Smart Brain planning, and the human planner — informing campaigns for every cohort.",
      how: "One router dispatched by ?action=list|html|poll|sync. Poll reads the capture inbox over IMAP; parsed emails become rows (columns A–K) in the Google Sheet database; sync runs on a CRON_SECRET-protected schedule. Google auth is keyless via Workload Identity Federation (Vercel OIDC → Google STS → service-account impersonation), with a legacy JSON-key fallback.",
      input: "Subscribe the capture inbox to competitor newsletters — the system does the rest. Optionally add brands to discover and track.",
      steps: [
        ['Capture', 'Competitor emails arrive in the dedicated Gmail inbox, which is subscribed to rival brands.'],
        ['Poll', 'IMAP polling pulls new messages and parses brand, subject, offer, and full HTML.', '/api/competitor?action=poll'],
        ['Store', 'Each email becomes a row (columns A–K) in the Google Sheet via keyless WIF auth.', '/api/competitor?action=sync (cron)'],
        ['Browse', 'The page lists captured emails and renders their full HTML for study.', '/api/competitor?action=list · ?action=html'],
        ['Benchmark', 'Cadence, offer, and angle insights feed the brand assistant, Smart Brain, and human planning.'],
      ],
    },
    calendar: {
      title: 'Plan Calendar (30-day RFM plan)',
      what: "Generates a 30-day marketing calendar from your analytics: dated sends with segment, theme, offer mechanic, and a subject hint — festival-aware. Any planned row can be fed straight into mailer generation. This is Draft 1 (V1) of calendaring; Draft 2 is the Mailer Calendar (UK).",
      who: "The nine RFM segments from Data Analysis — Champions, Loyal, Promising, New, Need-Attention, About-to-Sleep, At-Risk, Hibernating, Lost.",
      how: "The page posts your analytics state to the calendar engine and renders the returned 30-day plan as a grid. Trigger-mailer feeds one row into the mailer engine for generation.",
      input: "Analytics state handed over from Data Analysis via localStorage (segments, insights), plus your date window.",
      pipeline: true,
      steps: [
        ['Ideology', 'Maximum ideation on themes: festivals, rituals, and seasonal moments the brand can own inside the window.'],
        ['Data analysis + review + hypothesis', 'RFM segment sizes, discount exposure, and recency curves define who is reachable and what each send must prove.'],
        ['Business & strategy decisions', 'Slots are allocated across segments and offer mechanics — frequency-capped, festival-aware, revenue-weighted.', '/api/calendar?action=generate'],
        ['Content', 'Each slot receives its campaign definition: audience, theme, angle, and subject hint.'],
        ['Final compilation + presentation', 'The 30-day grid renders; any row hands off to mailer generation in one click.', '/api/calendar?action=trigger-mailer'],
      ],
    },
    cohorts: {
      title: 'Cohorts',
      what: "The single source of truth for WHO we mail: explicit definitions of every audience — the nine RFM segments and the UK engagement cohorts — with their rules, objectives, and voice guides.",
      who: "It defines the cohorts themselves: RFM segments by recency/frequency thresholds (Champions through Lost), and the engagement cohorts — Cohort A: Non-Buyers/Non-Engagers, Cohort B: T&B Buyers/Non-Engagers.",
      how: "A reference page over the same definitions the planners consume. Lifecycle cohorts carry an objective, a voice guide, and a product-mix rotation (Cohort A is coffee-heavy at 4:1:1; Cohort B is T&B-first at 3:2:1).",
      input: "Nothing to use it. Definition changes are made in code and Supabase so every planner and generator inherits them consistently.",
      steps: [
        ['Define the rule', 'Each cohort is an explicit predicate — e.g. Champions = last order within 30 days AND 5+ orders; Cohort A = on the list, never purchased, not opening.'],
        ['Attach the objective', 'Every cohort carries its job — e.g. Cohort A: earn the open, earn the click, first purchase.'],
        ['Set the voice guide', 'Tone rules per cohort: no guilt or pressure for non-engagers; familiarity, never chasing, for lapsed buyers.'],
        ['Feed the planners', 'Calendar, Lifecycle Calendar, and Smart Brain all plan against these exact definitions.'],
      ],
    },
    studio: {
      title: 'Mailer Studio',
      what: "The main creation app: a 5-step wizard (Brief → Products → Generation → Review & Refine → Final HTML) that produces four mailer variants — A (Image · Hero close-up), B (Image · Lifestyle wide), T1 (Text · Editorial), T2 (Text · Founder note) — across 11 layout archetypes, with real catalog products and region-correct pricing. This is Draft 1 (V1) of mailer creation; Draft 2 is the Mailer Calendar's built mailers.",
      who: "Whatever cohort the brief targets — RFM segments handed over from the Calendar, or a manually described audience. Output is a compact (~1200–1500px) Klaviyo-ready HTML mailer.",
      how: "A multi-stage AI pipeline. Text runs through the 6-provider waterfall; images cascade Gemini native → Imagen → OpenAI gpt-image → Pollinations flux. Structural divergence between variants is forced (variant B always takes an alternate archetype). Brand gates enforce the 4-colour palette, Montserrat / Instrument Sans, and the banned-phrase list.",
      input: "A campaign brief (typed, AI-autofilled, or handed over from a calendar row), your market (US/UK/Global — selects catalog and currency), and product selections.",
      pipeline: true,
      steps: [
        ['Ideology', 'Max-creativity concepting: the brief expands into campaign concepts and suggested angles before anything is designed.', '/api/ai/generate (create_brief · concepts · suggested_prompts)'],
        ['Data analysis + review + hypothesis', 'Real catalog data (products, prices, handles) and analytics state ground every claim; each variant carries a hypothesis of why it should win.'],
        ['Business & strategy decisions', 'The strategy stage locks audience, offer mechanic, archetype per variant, and the success metric.', '/api/ai/pipeline/strategy'],
        ['Content', 'Variant copy is written — four structurally diverging variants, banned phrases blocked, brand voice enforced.', '/api/ai/pipeline/variant · /api/ai/generate (mailer_full)'],
        ['Design + layout + structure', 'One of 11 archetypes shapes the layout; hero imagery generates through the image cascade with catalog-aware prompts.', '/api/ai/pipeline/images · /api/ai/image'],
        ['Coding', 'Everything compiles to email-safe HTML — inline CSS, bulletproof CTAs, roughly two scrolls tall.', '/api/ai/pipeline/html'],
        ['Final compilation + presentation', 'Review & Refine critiques the result on four dimensions and presents final HTML to copy or download.', '/api/ai/pipeline/score'],
      ],
    },
    lifecycle: {
      title: 'Mailer Calendar (UK)',
      what: "The UK lifecycle mailer calendar: deterministically plans 14/30/45 days of sends for the two engagement cohorts by rotating a curated play library — then builds any planned send into a Klaviyo-ready mailer with exactly ONE brand-gated LLM call. This is Draft 2 (V2 — Lifecycle OS) of both calendaring and mailer creation; Draft 1 is the 30-day Calendar plus Mailer Studio.",
      who: "Cohort A — Non-Buyers/Non-Engagers (objective: earn the open, earn the click, first purchase) and Cohort B — T&B Buyers/Non-Engagers (objective: reactivate with familiarity, cross-grade to the brand's own subscription). The UK calendar uses the active brand's own store.",
      how: "Two modes. PLAN is deterministic — no LLM: it rotates plays per cohort at your cadence (default 2/week), enforcing hard product rules (T&B is one-time only; Coffee and Supplements are subscription-first; supplements are never priced; no founder voice — templates restricted to pure/visual/editorial). BUILD makes one LLM call against locked facts and renders the brand template.",
      input: "Start date, plan window (14/30/45 days), cohort checkboxes, and sends-per-cohort-per-week. Nothing runs automatically — a human clicks Generate.",
      pipeline: true,
      steps: [
        ['Ideology', 'The play library IS the ideation layer: every play encodes a distinct psychological angle per cohort — story introduction, win-back, unboxing math, launch news.'],
        ['Data analysis + review + hypothesis', 'Every claim comes from locked facts — real UK handles, live prices and compare-at prices, the 7-gift list, the £105/year subscription gift value. Nothing outside the facts file may be claimed.'],
        ['Business & strategy decisions', 'The planner rotates product types by cohort mix (A coffee-heavy, B T&B-first), applies cadence and festival awareness, and enforces purchase-mode rules per product type.', '/api/calendar?action=lifecycle-generate'],
        ['Content', 'Build Mailer writes subject, preheader, and body in ONE brand-gated LLM call — banned phrases and founder voice hard-fail.', '/api/calendar?action=lifecycle-build-mailer'],
        ['Design + layout + structure', 'The play declares its template style (pure / visual / editorial), rendered in the 4-colour palette with Montserrat headings; optional hero creative via the image cascade.'],
        ['Coding', 'Output is a single centred 600px presentation table — all CSS inline, bulletproof CTAs, Klaviyo unsubscribe tags.'],
        ['Final compilation + presentation', 'Preview in a modal, copy the HTML, or download; built slots persist to Supabase (lifecycle_calendar_entries).', '/api/calendar?action=lifecycle-list'],
      ],
    },
    ukhub: {
      title: 'UK Non-Engagers Hub',
      what: "The Week-1 campaign hub for the UK non-engager program: 2 cohorts × 3 send slots × 2 creative variations = 12 finished, Klaviyo-paste-ready emails, with subject lines and preheaders parsed live from the actual email files.",
      who: "Cohort A — Non-Buyers/Non-Engagers and Cohort B — T&B Buyers/Non-Engagers. Sends are planned for 09:00 UK time.",
      how: "A static hub over the built email files (lifecycle-campaigns/2026-07-03_week1). Each slot offers V1 vs V2 — genuinely different psychological angles (e.g. sensory story vs question-led pattern-interrupt) — pick one or split-test. Preview, Copy HTML, and Download work per variation.",
      input: "None — the emails are pre-built against the locked facts file. You only choose which variation to ship.",
      steps: [
        ['Pick the slot', 'Six dated slots (Jul 3 / 6 / 9 × two cohorts), each with its objective spelled out.'],
        ['Compare angles', 'V1 vs V2 are distinct creative hypotheses, not copy tweaks — built for A/B testing.'],
        ['Preview', 'Renders the exact HTML in a modal iframe; subjects and preheaders are parsed live from each file.'],
        ['Copy or download', 'One click copies the full Klaviyo-ready HTML to the clipboard.'],
        ['Ship in Klaviyo', 'Paste into a Klaviyo campaign against the matching segment, scheduled for 09:00 UK.'],
      ],
    },
    ads: {
      title: 'Ad Campaigns',
      what: "Creates paid-social and search ad creatives — Meta, Google, TikTok — copy plus generated visuals, organised on its own calendar. Approved Smart Brain slots auto-generate their full ad set, mirrored into the ads_generated store.",
      who: "Prospecting and retargeting audiences per platform. Each ad set inherits the cohort of the campaign slot it came from.",
      how: "Per-platform tabs generate ad copy through the shared LLM waterfall and static creatives through the image cascade. Platform push is Phase 2 — assets are produced and reviewed here, not published automatically.",
      input: "A campaign or slot (from Smart Brain or the calendar tab), or a manual brief with product, platform, and audience.",
      pipeline: true,
      steps: [
        ['Ideology', 'Max-ideation on hooks and angles per platform — thumb-stopping concepts before any asset exists.'],
        ['Data analysis + review + hypothesis', 'Competitor ad benchmarks and owned KB assets define what to beat; every creative states the hypothesis it tests.'],
        ['Business & strategy decisions', 'Platform, audience, funnel stage, and offer mechanic are locked per ad set.'],
        ['Content', 'Platform-native copy — primary text, headlines, descriptions — in brand voice with banned phrases blocked.', '/api/ai/generate'],
        ['Design + layout + structure', 'Static creatives generate through the image cascade with catalog-aware prompts.', '/api/ai/image'],
        ['Audio/Video', 'Video ads: scripts and scene plans; video generation rungs are scaffolded to stub gracefully until keys exist.'],
        ['Coding', 'Assets are packaged to correct per-placement specs — ratios, durations, character limits.'],
        ['Final compilation + presentation', 'Everything mirrors into ads_generated for review; platform push remains Phase 2.', '/api/calendar?action=smart-brain-approve'],
      ],
    },
    // Keyed 'storefront3d' to match the nav group's gid. The 3D group used to
    // carry gid 'landing', so opening its ? chip showed the LANDING PAGES
    // description — a different feature — and the storefront had no description
    // of its own anywhere. The two are now separate groups with separate keys.
    storefront3d: {
      title: '3D Storefront & Websites',
      what: "The brand's own store, rebuilt as a browsable 3D scene: product panels in the active brand's palette and typography, one variant per region (US, UK, Global, India). It is the STORE. Campaign destinations for mailers and ads are a different feature, Landing Pages, and they have their own group.",
      who: "Shoppers browsing the storefront, and anyone reviewing how the brand's own catalogue reads as a site rather than as a list.",
      how: "The route decides the region (/3d, /3d/us, /3d/uk, /3d/global, /3d/in all serve storefront-3d.html with a variant), and the page renders that region's products. Products come through brand-catalog.js, so the scene shows THIS workspace's own catalogue and shows nothing rather than another brand's when none is connected. A 2D fallback layout takes over when WebGL is unavailable or motion is reduced, so the page is never blank.",
      input: "Nothing at view time: the route sets the region, and the active brand supplies the palette, the typography and the products.",
      pipeline: true,
      steps: [
        ['Ideology', 'The store as a place to move through rather than a grid to scroll.'],
        ['Data analysis + review + hypothesis', 'The region variant selects which of the brand\'s market catalogues is shown.'],
        ['Business & strategy decisions', 'Region switching is a first-class control, because price and availability differ per market.'],
        ['Content', 'Titles, prices and imagery come from the active brand\'s own catalogue, never a sample set.'],
        ['Design + layout + structure', 'Brand tokens drive the materials and the type, so the scene re-skins with the workspace.'],
        ['Coding', 'Rendered in the browser with a 2D fallback for reduced-motion, low-end and crawler traffic.', '/storefront-3d.html'],
        ['Final compilation + presentation', 'Served per region; Design References collects the static comparisons.', '/3d'],
      ],
    },
    landing: {
      title: 'Landing Pages',
      what: "Generates and serves brand-compliant HTML landing pages — presell and editorial pages matched to mailers and ads. The shipped brand's example pages live at /lp/best and /lp/agent; every other brand gets a page built from its own record.",
      who: "Traffic from each channel: pages exist for Mailers, for Meta, for Google, and for TikTok, inheriting the cohort of the campaign that links to them.",
      how: "Pages are LLM-generated to the /lp/:id serving contract, compiled by the LP compiler, stored in landing_pages_generated, and served live from the calendar router. Smart Brain approvals generate one automatically per campaign.",
      input: "A campaign or slot, or a manual brief: product, angle, source channel, and market.",
      pipeline: true,
      steps: [
        ['Ideology', 'Max-creativity page concepts: the presell narrative, the promise above the fold, the proof structure.'],
        ['Data analysis + review + hypothesis', 'Real product data and competitor landing-page intel ground every claim; each page states the conversion hypothesis it tests.'],
        ['Business & strategy decisions', 'Message matched to source channel and cohort — what the click was promised is what the page must deliver.'],
        ['Content', 'Long-form persuasion copy in brand voice — sensory, story-driven, no banned phrases.', '/api/ai/generate'],
        ['Design + layout + structure', 'Section architecture in the 4-colour palette with Montserrat / Instrument Sans; hero imagery via the image cascade.'],
        ['Coding', 'Compiles to a self-contained HTML page honouring the /lp/:id serving contract.'],
        ['Final compilation + presentation', 'Stored in landing_pages_generated and served live at /lp/:campaignId.', '/api/calendar?action=lp&id=…'],
      ],
    },
    officialdesigns: {
      title: 'Official Website Designs',
      what: "A true-to-brand 3D replica of the Knickgasm storefront and Meta-ads landers, rendered as a continuous WebGL scene of floating product panels and glassmorphic surfaces. Live catalog and pricing come from the regional Shopify storefront; historical metrics come from the Snowflake to Supabase daily mirror. It degrades automatically to a fast 2D brand layout on low-end, mobile, reduced-motion or crawler traffic so conversion is never sacrificed.",
      who: "Shoppers in each region the active brand sells in, plus paid-social traffic landing on that brand's own store, where a lander can collapse into a single-product checkout.",
      how: "The Knickgasm3DConnectorEngine (React context provider + data-orchestration middleware) resolves the region and lander from the hostname, connects Shopify and the Snowflake mirror, extracts the live theme colours and typography, injects them into the 3D materials and CSS custom properties, and renders the scene with three and react-three-fiber. Static pages mount the same engine through a no-build ESM bridge.",
      input: "Nothing from you at view time — the hostname decides region and lander mode. Operators can force a region or a 2D preview on the showcase page.",
      pipeline: true,
      steps: [
        ['Ideology', 'The spatial concept: floating mesh product panels over a unified viewport, brand-cloned lighting and surfaces.'],
        ['Data analysis + review + hypothesis', 'Shopify catalog and pricing are the live source; the Snowflake mirror supplies historical metrics that shape which products lead.', '/api/brain?action=snowflake-metrics'],
        ['Business & strategy decisions', 'Meta-ads landers isolate one product or bundle for zero-friction checkout; the full store shows the exploration constellation.'],
        ['Content', 'Product copy and pricing pulled live per region, formatted to the correct currency.'],
        ['Design + layout + structure', 'Live theme colours and Montserrat / Instrument Sans typography injected into shader uniforms and CSS variables for an exact brand replica.'],
        ['Coding', 'Rendered with three and react-three-fiber in the React app; mounted on static pages via the ESM bridge, with an automatic 2D fallback.', '/assets/knickgasm3d-bridge.js'],
        ['Final compilation + presentation', 'Served as the Official Website Designs showcase and reused inside landing-page templates.', '/official-designs'],
      ],
    },
    accessissues: {
      title: 'Access Issues',
      what: "A strictly read-only audit of Shopify account access and installed apps. It runs entirely in the browser over evidence you provide (user, role, group and activity CSV exports, an app register, login history, and HR/agency/contract context), aggregates effective access per user, and flags unnecessary users, excessive permissions, unused apps, duplicate functionality, security concerns, and avoidable cost. It emits findings and recommendations only.",
      who: "The operator and store owner. Read-only by architecture: it never authenticates to Shopify, never issues a GraphQL mutation, never requests a write scope, and cannot invite, suspend, remove, install or uninstall anything. Remediation stays with a human who approves and implements separately.",
      how: "Model A (offline audit): an authorized admin exports the CSVs and captures read-only app, billing and login evidence; this tool parses it locally and derives findings. Model B (controlled live read-only via Shopify CLI with read_* scopes only, no --allow-mutations) is run externally and its JSON pasted in as evidence. A governing read-only policy is applied to any AI narrative step.",
      input: "Shopify user CSV (required), plus optional role CSV, group CSV, activity-log CSV, app register (CSV/JSON), login-history JSON, and free-text HR/agency/contract context.",
      pipeline: true,
      steps: [
        ['Ideology', 'Least-privilege and no-change-by-architecture: the audit can never modify the account.'],
        ['Data analysis + review + hypothesis', 'Parses the exports locally, aggregates rows by user ID, and joins user to role to effective permissions and store access.'],
        ['Business & strategy decisions', 'Separates observed fact, inferred finding, missing evidence, and recommended action for every flag; never guesses missing justification.'],
        ['Content', 'Applies the rule engine: unnecessary users, excessive permissions, unused apps, duplicate functionality, security concerns, and an avoidable annual cost run-rate.'],
        ['Design + layout + structure', 'Renders a light, high-contrast findings dashboard with severity-ranked cards and exportable report.'],
        ['Coding', 'Runs client-side; an optional AI executive summary posts only the derived findings under a strict read-only policy.', '/api/brain?action=access-narrative'],
        ['Final compilation + presentation', 'Findings and recommendations only; a human approves and implements any remediation.', '/access-issues'],
      ],
    },
    social: {
      title: 'Social Media OS',
      what: "The daily social engine (V2 — Lifecycle OS): a 7-agent pipeline produces one complete day-package of posts across 11 platform formats — Instagram Feed, Reels and Stories, Facebook, TikTok, LinkedIn, X, Threads, Pinterest, YouTube Shorts, plus a long-form blog — every string brand-scrubbed, nothing published without a human approve.",
      who: "Followers and prospects per platform, UK market first. The operator reviews each day-package in the /social console and approves or skips per post.",
      how: "Seven bounded LLM agents run in sequence — each ONE call on the right provider tier, each with a deterministic fallback so the run never fails outright — inside a ~75s time box. A daily Vercel Cron (04:30 UTC) drives it; results persist to social_posts_generated in Supabase. Per-platform constraints (aspect, dims, char limits, hashtags, best time) live in a data spec, not prose. Platform push stays Phase 2 (push_status: not_integrated_phase_2).",
      input: "Nothing daily — the cron drives it; or hit Run Today in the console. From you: approve or skip per post. Product-focus rotation and festivals come from the active brand's own data; links use that brand's own product handles only.",
      pipeline: true,
      steps: [
        ['Ideology', "Premium-tier agent picks the day's creative theme — festival-aware, rotating product focus — maximum ideation before any data is touched.", '/api/brain?action=social-run-daily'],
        ['Data & Hypothesis', "Reads recent-post history from the DB to avoid repetition and states a performance hypothesis for the day's angle."],
        ['Strategy', "Locks objective, CTA, and destination link per platform — the active brand's own product handles only."],
        ['Content', "Writes per-platform copy — captions, titles, hashtags within each platform's limits — plus the 800-1200 word blog, in brand voice with banned phrases blocked."],
        ['Design', "Generates the hero image via the shared image cascade with per-platform crops; if generation fails it ships the exact image prompt instead."],
        ['Audio/Video', "Builds the storyboard and requests video via video-core for Reels, TikTok, and Shorts — stubbing gracefully when no video keys exist."],
        ['Compilation', "Fast-tier agent assembles the final day-package JSON, every string passes the brand scrub, and posts persist for review — approve or skip in the console.", '/api/brain?action=social-list · social-approve · social-skip'],
      ],
    },
  };

  // Expose the nav model so other pages (e.g. the homepage widget grid) can
  // mirror EVERY LHS item without drifting out of sync. Set synchronously on
  // script parse (auth.js is deferred → runs before DOMContentLoaded).
  try { window.__LC_NAV = NAV; } catch (_) {}
  try { window.__LC_NAV_INFO = { SUBQ, INFO }; } catch (_) {}

  // Flatten to a list of panel items for matching / open-page detection.
  function leafItems() {
    const out = [];
    NAV.forEach((n) => {
      if (n.section) return;            // section dividers have no panel
      if (n.children) n.children.forEach((c) => out.push(c));
      else out.push(n);
    });
    return out;
  }
  // currentStepId: pick the best-matching NAV panel for the current URL.
  // Priority order:
  //   1. EXACT match on full href (pathname + hash) — distinguishes sub-tabs
  //      like /ad-campaigns.html#calendar from /ad-campaigns.html#google.
  //   2. EXACT match on pathname against `match[]`.
  //   3. EXACT match on pathname against href's pathname part (fallback for
  //      sub-tabs whose container page is open with no hash yet).
  //   4. PREFIX match against `match[]` — but never against `/`.
  function currentStepId() {
    // A page whose tabs switch IN PLACE (no URL change) can name its own active
    // rail item via window.__LC_ACTIVE_ID. The URL is then not the source of
    // truth - the page is - so this override wins when it names a real leaf.
    try {
      const forced = window.__LC_ACTIVE_ID;
      if (forced && leafItems().some((it) => it.id === forced)) return forced;
    } catch (_) {}
    const p = location.pathname.toLowerCase();
    const s = (location.search || '').toLowerCase();  // e.g. ?region=us, ?tab=rfm
    const h = (location.hash || '').toLowerCase();     // e.g. #meta, #mailers
    const leaves = leafItems();

    // 1. EXACT full-href match, most-specific URL form first, so query- and
    //    hash-scoped sub-items (/research?region=us, /ad-campaigns.html#meta,
    //    /cohorts?tab=rfm) each light up their OWN row rather than the group's
    //    overview. Candidates go specific -> general.
    for (const cand of [p + s + h, p + s, p + h, p]) {
      for (const it of leaves) {
        if (it.href && it.href.toLowerCase() === cand) return it.id;
      }
    }
    // 2. match[] exact on pathname
    for (const it of leaves) {
      if ((it.match || []).some((m) => p === String(m).toLowerCase())) return it.id;
    }
    // 3. href pathname exact + URL carries no hash AND no query → first sub-tab
    //    of that page (container open, no specific sub-tab selected yet).
    if (!h && !s) {
      for (const it of leaves) {
        if (it.href) {
          const hp = it.href.split('#')[0].split('?')[0].toLowerCase();
          if (hp === p) return it.id;
        }
      }
    }
    // 4. match[] prefix (never `/`)
    for (const it of leaves) {
      if ((it.match || []).some((m) => m !== '/' && p.startsWith(String(m).toLowerCase() + '/'))) return it.id;
    }
    // 5. pathname-exact fallback IGNORING query/hash — when the URL carries a
    //    ?tab=/#hash that matched no specific sub-tab panel (steps 1-2), keep the
    //    page's OWN group/panel lit instead of falling through to Home. (Step 3
    //    only fires when there is no query/hash; this covers the query/hash case.)
    for (const it of leaves) {
      if (it.href) {
        const hp = it.href.split('#')[0].split('?')[0].toLowerCase();
        if (hp !== '/' && hp === p) return it.id;
      }
    }
    return 'home';
  }
  // Pages that must never gate behind the login wall.
  //
  // Internal tool: we do NOT force a sign-in to use any feature. The
  // optional "Sign in" chip stays in the nav (so profiles/Supabase still work
  // when signed in), but no page is blocked by the login wall. This avoids
  // lockouts from external OAuth redirect-URL/domain mismatches. To re-enable
  // forced auth on specific pages later, return `!!(item && item.open)` based
  // on a per-item flag instead of `true`.
  function isOpenPage() {
    const p = (location.pathname || '').toLowerCase();
    // Legal/consent pages are always open (never lock a user out of the
    // privacy/terms pages).
    if (/(^|\/)(privacy|terms)(\.html)?$/.test(p)) return true;
    // The HOMEPAGE must be publicly viewable (not behind a login page, and it
    // explains the app's purpose).
    // It renders a guest nav + a Sign in button, but is never walled.
    if (p === '/' || p === '' || /(^|\/)index(\.html)?$/.test(p)) return true;
    // Otherwise a page is open ONLY if its nav panel is explicitly flagged
    // open (Mailer Studio). Everything else is for a signed-in person.
    const id = currentStepId();
    const item = leafItems().find((s) => s.id === id);
    return !!(item && item.open);
  }

  /* MARKET STUDY ROWS ARE THE ACTIVE BRAND'S OWN REGIONS (2026-10-05).
     The rail offered "US Study / UK Study / Global Study / India Study" to
     every brand: an Indian brand was offered three markets it does not serve,
     and a UAE brand had no row for its own. The static rows stay in NAV (the
     model, the ? panels), are hidden once the brand's regions are known, and
     one row per region the brand lists is drawn in their place, HOME first.
     A brand with no regions gets the overview row alone, where the page says
     what is missing. */
  function syncStudyRows() {
    try {
      const RC = window.RegionContext;
      const nav = document.getElementById('lifecycle-nav');
      if (!nav || !RC || !RC.loaded) return;
      const all = nav.querySelector('a[data-id="research-all"]');
      const body = all && all.closest('.lnav-gbody');
      if (!body) return;
      let icon = null;
      ['research-us', 'research-uk', 'research-global', 'research-india'].forEach((id) => {
        const a = body.querySelector('a[data-id="' + id + '"]');
        if (!a) return;
        if (!icon) icon = a.querySelector('svg');
        const row = (a.parentElement && a.parentElement.classList.contains('lnav-item')) ? a.parentElement : a;
        row.hidden = true;
        row.setAttribute('data-study-static', '1');
      });
      body.querySelectorAll('[data-study-region]').forEach((el) => el.remove());
      const here = /\/research/.test(location.pathname) ? (new URLSearchParams(location.search).get('region') || '') : '';
      const opts = (typeof RC.options === 'function' ? RC.options() : []).slice()
        .sort((x, y) => (y.home ? 1 : 0) - (x.home ? 1 : 0));
      opts.forEach((o) => {
        const code = String(o.code || '').toLowerCase();
        if (!code) return;
        const a = document.createElement('a');
        a.className = 'lnav-link' + (here && RC.resolve(here) === o.code ? ' active' : '');
        a.href = '/research?region=' + encodeURIComponent(code);
        a.setAttribute('data-id', 'research-' + code);
        a.setAttribute('data-study-region', o.code);
        a.title = o.label + (o.home ? ' - home market' : '');
        if (icon) a.appendChild(icon.cloneNode(true));
        const t = document.createElement('span');
        t.className = 'lnav-txt';
        t.textContent = o.name + ' Study';
        a.appendChild(t);
        body.appendChild(a);
      });
    } catch (_) { /* the rail keeps its static rows */ }
  }
  try { window.addEventListener('regioncontext:change', () => setTimeout(syncStudyRows, 0)); } catch (_) {}

  // ─── Left-hand sidebar (global cross-feature navigation) ────────────
  function injectTopbar(user) {
    if (document.getElementById('lifecycle-nav')) return;
    const cur = currentStepId();
    const svg = (k) => BRAND[k]
      ? BRAND[k]
      : `<svg class="lnav-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ''}</svg>`;

    // Standing IA rule (CLAUDE.md "LHS navigation IA rule"): the five common
    // "know about this feature" questions (What does it do? / Who is it for? /
    // How does it work? / Input / Step-by-Step Working) are the SAME for every
    // feature, so they no longer clutter the rail. Sanctioned rendering
    // (2026-07-09): a quiet `?` chip sits next to each feature/group label and
    // opens a POPUP that presents all five questions as headings with their
    // content. The rail itself now shows only the real feature links and their
    // group sub-sections. Order and presence of the five questions are
    // unchanged; they just live in the modal instead of an inline accordion.

    // The info key highlighted as "current": the current item's own INFO entry,
    // else the gid of the group that contains the current panel.
    let activeInfoKey = null;
    if (INFO[cur]) activeInfoKey = cur;
    else {
      for (const n of NAV) {
        if (n.children && n.gid && n.children.some((c) => c.id === cur)) { activeInfoKey = n.gid; break; }
      }
    }
    const infoBtn = (key, label) => INFO[key]
      ? `<button type="button" class="lnav-i${key === activeInfoKey ? ' on' : ''}" data-itoggle="${key}" title="Know about: ${label}" aria-label="Know about ${label}" aria-haspopup="dialog">?</button>`
      : '';

    // V1/V2 taxonomy badge — REMOVED from the rail (product-owner request) to cut
    // clutter. The `ver`/`draft` data is kept on each NAV item (it still feeds the
    // tooltip text and the `?` info popup / version taxonomy), but no visible chip
    // renders in the row. Return '' to drop the chip everywhere it was used.
    const verChip = () => '';

    // Build the nav markup. Internal nav stays in the same tab so the back
    // button works naturally; external links elsewhere in the app keep their
    // own target="_blank" where they're declared.
    const linkRow = (item) => {
      const isCur = item.id === cur;
      const shipped = item.shipped ? ' data-shipped-nav="1"' : '';
      const a = `<a class="lnav-link${isCur ? ' active' : ''}" href="${item.href}" data-id="${item.id}" title="${item.label}"${INFO[item.id] ? '' : shipped}>
        ${svg(item.icon)}<span class="lnav-txt">${item.label}</span>${verChip(item)}</a>`;
      if (!INFO[item.id]) return a;
      return `<div class="lnav-item"${shipped}>${a}${infoBtn(item.id, item.label)}</div>`;
    };
    // Double-layer nav: Tier-1 = top-level features (flat items + group headers),
    // Tier-2 = each feature's sub-sections. Groups start COLLAPSED — only the
    // group that owns the current page opens, keeping the rail calm. The caret
    // expands/collapses any group on demand.
    const navHtml = NAV.map((n) => {
      if (n.section) return `<div class="lnav-section">${n.section}</div>`;
      if (!n.children) return linkRow(n);
      const groupActive = n.children.some((c) => c.id === cur);
      return `<div class="lnav-group${groupActive ? ' open active-group' : ''}">
        <div class="lnav-item"><button class="lnav-ghead" type="button" title="${n.group}">${svg(n.icon)}<span class="lnav-txt">${n.group}</span>${verChip(n)}<svg class="lnav-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>${n.gid ? infoBtn(n.gid, n.group) : ''}</div>
        <div class="lnav-gbody">${n.children.map(linkRow).join('')}</div>
      </div>`;
    }).join('');

    const userHtml = railUserHtml(user);

    const wrap = document.createElement('div');
    wrap.id = 'lifecycle-nav';
    wrap.innerHTML = `
      <style>
        :root { --lsb-w: 248px; }
        @media (min-width: 961px) { body { margin-left: var(--lsb-w) !important; } }
        /* The rail is the TOOL's chrome in the BRAND's colours and type: every colour
           below is a contract token (design/lifecycle-os/CONTRACT.md), never a
           literal. It used to paint the active row in tenant zero's red with its
           purple edge, and the phone bar near-black under near-black text, for
           every brand. */
        #lifecycle-nav { font-family: var(--vh-font-body, system-ui, sans-serif); }

        /* Mobile top bar — FIXED so it stays pinned while the page scrolls.
           (A sticky element can't hold here: its wrapper #lifecycle-nav is only
           bar-height tall because the drawer + backdrop are position:fixed.)
           An in-flow spacer of the same height reserves layout space below. */
        #lifecycle-nav .lnav-mbar {
          display: none; align-items: center; gap: 12px;
          position: fixed; top: 0; left: 0; right: 0; z-index: 100;
          height: calc(50px + env(safe-area-inset-top, 0px));
          padding: env(safe-area-inset-top, 0px) max(14px, env(safe-area-inset-right, 0px)) 0 max(14px, env(safe-area-inset-left, 0px));
          background: var(--vh-bg); backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border-bottom: 1px solid var(--vh-line);
        }
        #lifecycle-nav .lnav-mbar-spacer { display: none; }
        #lifecycle-nav .lnav-burger {
          background: transparent; border: 1px solid var(--vh-line-hot);
          color: var(--vh-ink); border-radius: 8px; width: 44px; height: 44px; flex-shrink: 0;
          font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center;
        }
        #lifecycle-nav .lnav-mbrand { display: flex; align-items: center; gap: 8px; min-height: 44px;
          font-size: 12px; font-weight: 700; letter-spacing: 0.14em; color: var(--vh-ink, inherit);
          text-transform: uppercase; text-decoration: none; }
        #lifecycle-nav .lnav-mbrand .lnav-mark { width: 22px; height: 22px; flex-shrink: 0; }

        #lifecycle-nav .lnav-backdrop {
          position: fixed; inset: 0; z-index: 109; background: var(--vh-ink);
          opacity: 0; pointer-events: none; transition: opacity .2s;
        }
        #lifecycle-nav.open .lnav-backdrop { opacity: .5; pointer-events: auto; }

        /* Sidebar */
        #lifecycle-nav .lnav-side {
          position: fixed; left: 0; top: 0; z-index: 110;
          /* dvh, not vh: on a phone or tablet 100vh is the LARGE viewport
             (it counts the URL bar), so the rail's foot - the sign-in chip -
             sat under the browser's toolbar. The vh line is the fallback for
             an engine without dynamic units; the CSSOM keeps the last valid. */
          width: var(--lsb-w); height: 100vh; height: 100dvh;
          display: flex; flex-direction: column;
          /* The rail's own surface must be a BRAND surface, not a fixed tan.
             The text tokens are contrast-adjusted against --brand-surface,
             so a rail painted a slightly different colour lands just under
             AA no matter how the tokens are tuned - the group labels and
             every ? chip measured 4.44:1 against this hardcoded tint. It
             also means the rail re-skins with the workspace like the rest
             of the app instead of staying one tenant's colour. */
          background: var(--vh-bg); border-right: 1px solid var(--vh-line);
          padding: 16px 12px 12px;
        }
        /* The wordmark is the PLATFORM's: mark + name in the rail's own ink,
           never a tenant colour. The active brand appears beneath it in the
           brand slot (its logo from its record, or a monogram, beside its
           name). --vh-ink resolves through --brand-ink, which validatePalette
           has already held to AA against the rail surface. */
        #lifecycle-nav .lnav-brand {
          display: flex; align-items: center; gap: 10px; text-decoration: none;
          padding: 4px 8px 16px; color: var(--vh-ink, inherit);
        }
        #lifecycle-nav .lnav-mark { width: 30px; height: 30px; flex-shrink: 0; display: block; transition: transform .2s; }
        #lifecycle-nav .lnav-brand:hover .lnav-mark,
        #lifecycle-nav .lnav-mbrand:hover .lnav-mark { transform: translateY(-1px); }
        #lifecycle-nav .lnav-brand .lnav-bt { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
        #lifecycle-nav .lnav-brand .lnav-bt b { font-family: var(--los-font-wordmark, system-ui, sans-serif); font-size: 14.5px; letter-spacing: -0.01em; color: var(--vh-ink, inherit); font-weight: 700; }
        #lifecycle-nav .lnav-brand .lnav-tagline { font-size: 8px; line-height: 1.25; letter-spacing: .04em; color: var(--vh-ink-dim, inherit); white-space: normal; max-width: 178px; }
        #lifecycle-nav .lnav-brand .lnav-brandrow { display: flex; align-items: center; gap: 5px; min-width: 0; }
        #lifecycle-nav .lnav-brand .lnav-bt small { font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--vh-accent-text, var(--vh-ink-dim, inherit)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        /* The brand slot: the ACTIVE brand's own logo (brand.logo_url) or, with
           none on the record, a monogram of its name on a neutral chip. It is
           never any other tenant's file - brand-context.fillBrandSlot() is the
           only writer. */
        #lifecycle-nav .lnav-brandlogo {
          width: 14px; height: 14px; flex-shrink: 0; border-radius: 4px; overflow: hidden;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 8px; font-weight: 700; letter-spacing: 0; line-height: 1;
          background: var(--vh-panel-2, transparent); border: 1px solid var(--vh-line, currentColor);
          color: var(--vh-ink, inherit);
        }
        #lifecycle-nav .lnav-brandlogo[hidden] { display: none; }
        #lifecycle-nav .lnav-brandlogo img { width: 100%; height: 100%; object-fit: contain; display: block; }
        #lifecycle-nav .lnav-head { display: flex; align-items: center; gap: 6px; }
        /* min-width:0 so a long brand name ellipsises inside the rail instead of
           pushing the collapse button out past its edge (seen on /design-system
           with a 30-character brand name). */
        #lifecycle-nav .lnav-head .lnav-brand { flex: 1; padding-right: 0; min-width: 0; }
        #lifecycle-nav .lnav-brand .lnav-brandrow small { min-width: 0; }
        #lifecycle-nav .lnav-collapse {
          flex-shrink: 0; width: 26px; height: 26px; margin-bottom: 16px;
          background: transparent; border: 1px solid var(--vh-line); border-radius: 7px;
          color: var(--vh-ink-dim); cursor: pointer; font-size: 14px; line-height: 1;
          display: flex; align-items: center; justify-content: center; transition: all .12s;
        }
        #lifecycle-nav .lnav-collapse:hover { border-color: var(--vh-accent); color: var(--vh-ink); }

        /* ── Collapsed (icon-only) rail — desktop only ── */
        @media (min-width: 961px) {
          html.lnav-collapsed #lifecycle-nav .lnav-side { padding-left: 8px; padding-right: 8px; }
          html.lnav-collapsed #lifecycle-nav .lnav-bt,
          html.lnav-collapsed #lifecycle-nav .lnav-txt,
          html.lnav-collapsed #lifecycle-nav .lnav-caret,
          html.lnav-collapsed #lifecycle-nav .lnav-uname { display: none; }
          html.lnav-collapsed #lifecycle-nav .lnav-head { flex-direction: column-reverse; gap: 10px; }
          html.lnav-collapsed #lifecycle-nav .lnav-brand { justify-content: center; padding: 0; }
          html.lnav-collapsed #lifecycle-nav .lnav-link,
          html.lnav-collapsed #lifecycle-nav .lnav-ghead { justify-content: center; padding: 9px 0; }
          html.lnav-collapsed #lifecycle-nav .lnav-gbody { padding-left: 0; margin-left: 0; border-left: none; }
          html.lnav-collapsed #lifecycle-nav .lnav-user { justify-content: center; }
          /* Icon-only rail: hide the feature-IA toggles + sub-item lists. */
          html.lnav-collapsed #lifecycle-nav .lnav-i,
          html.lnav-collapsed #lifecycle-nav .lnav-info { display: none; }
        }

        /* The market picker, one row that slides. It sits above the links
           because every link below it is scoped to the chosen market: a
           calendar, a mailer and an ad set are all built for one region, and
           the control that decides which has to be visible before you pick a
           feature, not buried inside one of them. Styling lives in theme.css
           (.rgn-*); this only places it in the rail. */
        #lifecycle-nav .lnav-region:empty { display: none; }
        #lifecycle-nav .lnav-region { margin: 0 -4px 2px; padding: 0 4px; }
        #lifecycle-nav .lnav-region.rgn-bar { margin: 6px 0 10px; }
        /* Collapsed to the icon rail there is no width for chips or a label,
           and a clipped half-chip is worse than none: the rail expands on
           click, which is where the choice is made. */
        html.lnav-collapsed #lifecycle-nav .lnav-region { display: none; }
        #lifecycle-nav .lnav-scroll { flex: 1; overflow-y: auto; scrollbar-width: thin; margin: 0 -4px; padding: 0 4px; }
        #lifecycle-nav .lnav-scroll::-webkit-scrollbar { width: 6px; }
        #lifecycle-nav .lnav-scroll::-webkit-scrollbar-thumb { background: var(--vh-line); border-radius: 6px; }

        #lifecycle-nav .lnav-ic { width: 18px; height: 18px; flex-shrink: 0; }
        #lifecycle-nav .lnav-brandic { width: 18px; height: 18px; }
        /* Section divider label (KNOWLEDGE BASE / CREATE) */
        #lifecycle-nav .lnav-section {
          padding: 14px 11px 5px; margin-top: 4px;
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
          color: var(--vh-ink-dim);
        }
        html.lnav-collapsed #lifecycle-nav .lnav-section {
          text-align: center; padding: 10px 0 4px; font-size: 0;
        }
        html.lnav-collapsed #lifecycle-nav .lnav-section::before {
          content: ''; display: inline-block; width: 18px; height: 1px; background: var(--vh-line-hot);
        }
        #lifecycle-nav .lnav-link {
          display: flex; align-items: center; gap: 11px;
          padding: 7px 11px; margin: 1px 0; border-radius: 9px;
          font-size: 13px; color: var(--vh-ink-dim); text-decoration: none;
          border: 1px solid transparent; transition: all .12s;
        }
        #lifecycle-nav .lnav-link:focus-visible,
        #lifecycle-nav .lnav-ghead:focus-visible,
        #lifecycle-nav .lnav-i:focus-visible,
        #lifecycle-nav .lnav-info-item:focus-visible {
          outline: 2px solid var(--vh-focus); outline-offset: 1px;
        }
        /* Labels wrap to at most TWO lines instead of truncating mid-word
           ("Calen…", "UK Non-Eng…"). Shared by links AND group headers.
           The row title attribute still carries the full name as a tooltip. */
        #lifecycle-nav .lnav-txt {
          flex: 1; min-width: 0; white-space: normal; overflow-wrap: break-word;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
          overflow: hidden; line-height: 1.3;
        }
        /* V1/V2 taxonomy badge — deliberately quiet (Draft info lives in the
           tooltip + info panels, not the row). */
        #lifecycle-nav .lnav-ver {
          flex-shrink: 0; font-size: 8px; font-weight: 600; letter-spacing: 0.08em;
          line-height: 1.4; padding: 1px 4px; border-radius: 4px; white-space: nowrap;
        }
        #lifecycle-nav .lnav-ver.v1 {
          color: var(--vh-ink-dim); background: var(--vh-panel-2);
        }
        #lifecycle-nav .lnav-ver.v2 {
          color: var(--vh-accent-text); background: var(--vh-panel-2);
        }
        html.lnav-collapsed #lifecycle-nav .lnav-ver { display: none; }
        #lifecycle-nav .lnav-link:hover { color: var(--vh-ink); background: var(--vh-panel-2); }
        /* Current item = the STRONGEST highlight: the ACTIVE brand's primary as
           a control fill, its label and icon in the derived on-primary colour
           (it was tenant zero's red with a purple icon, 1.5:1, for every brand).
           Applies to the active panel AND the active sub-item, so the selected
           sub-item reads stronger than its parent. */
        #lifecycle-nav .lnav-link.active {
          color: var(--vh-on-primary); background: var(--vh-primary); border-color: var(--vh-primary);
          font-weight: 600;
        }
        #lifecycle-nav .lnav-link.active .lnav-ic,
        #lifecycle-nav .lnav-link.active .lnav-ver { color: var(--vh-on-primary); background: transparent; }

        /* Groups */
        #lifecycle-nav .lnav-group { margin: 6px 0 2px; }
        #lifecycle-nav .lnav-ghead {
          width: 100%; display: flex; align-items: center; gap: 11px;
          padding: 7px 11px; border: none; background: transparent; cursor: pointer;
          font-family: inherit; font-size: 13px; color: var(--vh-ink-dim); text-align: left; border-radius: 9px;
        }
        #lifecycle-nav .lnav-ghead:hover { background: var(--vh-panel-2); color: var(--vh-ink); }
        /* Parent of the active sub-item ALSO reads as selected, but LIGHTER than
           the sub-item: the sunken panel (the ground every text token clears AA
           on) with the primary as a left edge, so both show and the sub-item
           stays the stronger of the two. */
        #lifecycle-nav .lnav-group.active-group .lnav-ghead { color: var(--vh-primary-text); background: var(--vh-panel-2); box-shadow: inset 3px 0 0 var(--vh-primary); }
        #lifecycle-nav .lnav-group.active-group .lnav-ghead .lnav-ic { color: var(--vh-primary-text); }
        #lifecycle-nav .lnav-caret { width: 15px; height: 15px; color: var(--vh-ink-dim); transition: transform .18s; }
        #lifecycle-nav .lnav-group.open .lnav-caret { transform: rotate(180deg); }
        #lifecycle-nav .lnav-gbody { display: none; padding-left: 14px; margin-left: 8px; border-left: 1px solid var(--vh-line); }
        #lifecycle-nav .lnav-group.open .lnav-gbody { display: block; }
        #lifecycle-nav .lnav-gbody .lnav-link { font-size: 12.5px; padding: 6px 10px; }

        /* ── Feature IA: row wrapper + "?" toggle + 5 fixed sub-items ── */
        #lifecycle-nav .lnav-item { display: flex; align-items: center; gap: 4px; min-width: 0; }
        #lifecycle-nav .lnav-item > .lnav-link,
        #lifecycle-nav .lnav-item > .lnav-ghead { flex: 1; min-width: 0; }
        #lifecycle-nav .lnav-i {
          flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
          background: transparent; border: 1px solid var(--vh-line-hot);
          color: var(--vh-ink-dim); font-family: inherit; font-size: 10.5px; font-weight: 700; line-height: 1;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: all .12s; padding: 0;
        }
        #lifecycle-nav .lnav-i:hover { border-color: var(--vh-accent); color: var(--vh-ink); }
        #lifecycle-nav .lnav-i.on { background: var(--vh-panel-2); border-color: var(--vh-accent); color: var(--vh-ink); }
        #lifecycle-nav .lnav-info { display: none; margin: 2px 0 4px 8px; padding-left: 12px; border-left: 1px dashed var(--vh-line-hot); }
        /* Touch (2026-10-10): the ? chip is drawn as the same 20px circle but
           answers a 44px square, so a thumb cannot miss it or hit the row. */
        @media (pointer: coarse) {
          #lifecycle-nav .lnav-i { position: relative; z-index: 0; width: 44px; height: 44px; margin: 0 -12px; border-color: transparent; background: transparent; }
          #lifecycle-nav .lnav-i::before { content: ""; position: absolute; left: 12px; top: 12px; width: 20px; height: 20px; box-sizing: border-box; border-radius: 50%; border: 1px solid var(--vh-line-hot); z-index: -1; }
          #lifecycle-nav .lnav-i.on { background: transparent; }
          #lifecycle-nav .lnav-i.on::before { background: var(--vh-panel-2); border-color: var(--vh-accent); }
          #lifecycle-nav .lnav-i:hover::before { border-color: var(--vh-accent); }
          #lifecycle-nav .lnav-section, #lifecycle-nav .lnav-brand .lnav-tagline,
          #lifecycle-nav .lnav-brand .lnav-bt small, #lifecycle-nav .lnav-info-item { font-size: 12px; }
        }
        #lifecycle-nav .lnav-info.open { display: block; }
        #lifecycle-nav .lnav-info-item {
          width: 100%; display: flex; align-items: center; gap: 8px;
          background: transparent; border: none; cursor: pointer; text-align: left;
          font-family: inherit; font-size: 11.5px; color: var(--vh-ink-dim);
          padding: 5px 8px; border-radius: 7px; transition: all .12s;
        }
        #lifecycle-nav .lnav-info-item:hover { color: var(--vh-ink); background: var(--vh-panel-2); }
        #lifecycle-nav .lnav-info-n {
          flex-shrink: 0; width: 15px; height: 15px; border-radius: 4px;
          background: var(--vh-panel-2); color: var(--vh-accent-text);
          font-size: 9px; font-weight: 700; display: flex; align-items: center; justify-content: center;
        }

        /* ── Feature info panel (overlay) ── */
        #lifecycle-nav .lnav-ipanel-backdrop {
          position: fixed; inset: 0; z-index: 125; background: var(--vh-ink); opacity: .5;
          display: none;
        }
        #lifecycle-nav .lnav-ipanel {
          position: fixed; z-index: 126;
          top: 50%; left: 50%; transform: translate(-50%, -50%);
          width: min(560px, 94vw); max-height: min(78vh, 720px); max-height: min(78dvh, 720px);
          background: var(--vh-panel); border: 1px solid var(--vh-line-hot);
          border-radius: 14px; box-shadow: var(--vh-lift-2);
          display: none; flex-direction: column; overflow: hidden;
          font-family: var(--vh-font-body, system-ui, sans-serif);
        }
        #lifecycle-nav.ipanel-open .lnav-ipanel-backdrop { display: block; }
        #lifecycle-nav.ipanel-open .lnav-ipanel { display: flex; }
        #lifecycle-nav .lnav-ipanel-head {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 18px 20px 12px; border-bottom: 1px solid var(--vh-line);
        }
        #lifecycle-nav .lnav-ipanel-eyebrow {
          font-size: 10px; font-weight: 700; letter-spacing: 0.16em;
          text-transform: uppercase; color: var(--vh-accent-text); margin-bottom: 3px;
        }
        #lifecycle-nav .lnav-ipanel-title {
          font-family: var(--vh-font-head, Georgia, serif); font-size: 18px; font-weight: 600;
          color: var(--vh-heading, var(--vh-ink)); letter-spacing: -0.01em; flex: 1;
        }
        #lifecycle-nav .lnav-ipanel-htxt { flex: 1; min-width: 0; }
        #lifecycle-nav .lnav-ipanel-close {
          flex-shrink: 0; width: 28px; height: 28px; border-radius: 8px;
          background: transparent; border: 1px solid var(--vh-line-hot);
          color: var(--vh-ink-dim); font-size: 15px; line-height: 1; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        #lifecycle-nav .lnav-ipanel-close:hover { border-color: var(--vh-accent); color: var(--vh-ink); }
        #lifecycle-nav .lnav-ipanel-body {
          padding: 16px 20px 20px; overflow-y: auto; scrollbar-width: thin;
          font-size: 13px; line-height: 1.65; color: var(--vh-ink-dim);
        }
        #lifecycle-nav .lnav-ipanel-body p { margin: 0 0 10px; }
        #lifecycle-nav .lnav-ipanel-q {
          font-family: var(--vh-font-head, Georgia, serif); font-size: 14.5px; font-weight: 600;
          color: var(--vh-ink); margin: 18px 0 6px; padding-top: 12px;
          border-top: 1px solid var(--vh-line);
        }
        #lifecycle-nav .lnav-ipanel-q:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
        #lifecycle-nav .lnav-ipanel-note {
          font-size: 11.5px; color: var(--vh-accent-text); background: var(--vh-panel-2);
          border: 1px solid var(--vh-line); border-radius: 8px;
          padding: 8px 12px; margin: 0 0 14px;
        }
        #lifecycle-nav .lnav-steps { margin: 0; padding: 0 0 0 4px; list-style: none; counter-reset: lstep; }
        #lifecycle-nav .lnav-steps li {
          counter-increment: lstep; position: relative;
          padding: 0 0 14px 34px; margin: 0;
        }
        #lifecycle-nav .lnav-steps li::before {
          content: counter(lstep); position: absolute; left: 0; top: 1px;
          width: 22px; height: 22px; border-radius: 50%;
          background: var(--vh-panel-2); border: 1px solid var(--vh-line-hot);
          color: var(--vh-accent-text); font-size: 10.5px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
        }
        #lifecycle-nav .lnav-steps li:not(:last-child)::after {
          content: ''; position: absolute; left: 10.5px; top: 26px; bottom: 2px;
          width: 1px; background: var(--vh-line);
        }
        #lifecycle-nav .lnav-steps b { display: block; color: var(--vh-ink); font-size: 12.5px; margin-bottom: 2px; }
        #lifecycle-nav .lnav-steps .lnav-step-d { display: block; font-size: 12px; color: var(--vh-ink-dim); }
        #lifecycle-nav .lnav-steps .lnav-step-via {
          display: inline-block; margin-top: 4px; font-family: var(--vh-font-mono, monospace);
          font-size: 10px; color: var(--vh-ink-dim); background: var(--vh-panel-2);
          border-radius: 5px; padding: 2px 7px;
        }

        /* User footer */
        #lifecycle-nav .lnav-user {
          display: flex; align-items: center; gap: 9px; margin-top: 8px;
          padding: 10px 8px 4px; border-top: 1px solid var(--vh-line); font-size: 12px; color: var(--vh-ink-dim);
        }
        #lifecycle-nav .lnav-avatar { width: 28px; height: 28px; border-radius: 50%;
          /* The workspace's own colours, not one tenant's. The initials sit
             on the primary end of the gradient, so they take --brand-on-
             primary, which is contrast-computed per brand - hardcoded white
             disappears for any brand with a light primary. */
          background: var(--vh-primary);
          display: flex; align-items: center; justify-content: center;
          color: var(--vh-on-primary); font-size: 12px; font-weight: 700; overflow: hidden; flex-shrink: 0; }
        #lifecycle-nav .lnav-avatar img { width: 100%; height: 100%; object-fit: cover; }
        #lifecycle-nav .lnav-uname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #lifecycle-nav .lnav-signout { background: transparent; border: 1px solid var(--vh-line-hot);
          color: var(--vh-ink-dim); cursor: pointer; padding: 4px 8px; border-radius: 6px; font-size: 13px; flex-shrink: 0; }
        #lifecycle-nav .lnav-signout:hover { border-color: var(--vh-accent); color: var(--vh-ink); }
        #lifecycle-nav .lnav-skip {
          position: absolute; left: -999px; top: 8px; z-index: 200;
          background: var(--vh-panel); color: var(--vh-ink);
          border: 1px solid var(--vh-line-hot); border-radius: 8px;
          padding: 8px 12px; font: inherit; font-size: 13px; font-weight: 700;
          text-decoration: none;
        }
        #lifecycle-nav .lnav-skip:focus {
          left: 8px; outline: 2px solid var(--vh-focus); outline-offset: 2px;
        }
        /* A 44px target (2026-10-10): with Google the only sign-in, this chip is
           what every signed-out visitor presses, on a phone too. */
        #lifecycle-nav .lnav-signin { color: var(--vh-link); text-decoration: none; font-weight: 600; padding: 4px 8px;
          display: inline-flex; align-items: center; min-height: 44px; box-sizing: border-box; }
        /* A press held while boot settles: dimmed and waiting, no colour of its own. */
        #lifecycle-nav .lnav-signin[aria-busy="true"] { opacity: .72; cursor: progress; }
        /* Why sign-in did not happen, said UNDER the button that was pressed.
           This replaces a native alert(): a dialog blocks the page, carries the
           site's hostname as its title so it reads as a site error, and cannot
           take the brand's tokens. Same rule as the standing bar - the two
           states someone has to FIX wear the warn edge, being signed out wears
           the accent, an OAuth refusal wears the error edge. Tokens only, no
           colour of its own. */
        #lifecycle-nav .lnav-signin-note {
          margin: 6px 8px 0; padding: 8px 10px; border-radius: 8px;
          font-size: 11.5px; line-height: 1.45; text-align: left;
          background: var(--vh-panel-2); color: var(--vh-ink);
          border: 1px solid var(--vh-line); box-shadow: inset 3px 0 0 var(--vh-warn);
        }
        #lifecycle-nav .lnav-signin-note[data-kind="signed-out"] { box-shadow: inset 3px 0 0 var(--vh-accent); }
        #lifecycle-nav .lnav-signin-note[data-kind="failed"] { box-shadow: none; padding: 0; border: 0; background: transparent; }
        #lifecycle-nav .lnav-signin-note code { font-family: var(--vh-font-mono, monospace); font-size: 10.5px; }
        #lifecycle-nav .lnav-signin-note b { color: var(--vh-ink); }
        #lifecycle-nav .lnav-signin-note[data-kind="expired"] { box-shadow: inset 3px 0 0 var(--vh-accent); }
        /* A phone sign-in ended on boot (2026-10-10): an ordinary state, the accent edge. */
        #lifecycle-nav .lnav-signin-note[data-kind="phone-ended"] { box-shadow: inset 3px 0 0 var(--vh-accent); }
        html.lnav-collapsed #lifecycle-nav .lnav-signin-with { display: none; }

        @media (max-width: 960px) {
          #lifecycle-nav .lnav-mbar { display: flex; }
          #lifecycle-nav .lnav-mbar-spacer { display: block; height: var(--ltb-h, 50px); }
          #lifecycle-nav .lnav-side {
            width: min(var(--lsb-w), 86vw); height: 100dvh;
            transform: translateX(-100%); transition: transform .24s ease;
            box-shadow: var(--vh-lift-2);
            padding-top: calc(16px + env(safe-area-inset-top, 0px));
          }
          #lifecycle-nav.open .lnav-side { transform: translateX(0); }
          /* On mobile the rail is a drawer, never the collapsed icon-rail. */
          html.lnav-collapsed { --lsb-w: 248px; }
        }
      </style>
      <a class="lnav-skip" href="#lc-content">Skip to main content</a>
      <div class="lnav-mbar">
        <button class="lnav-burger" id="lnav-burger" aria-label="Open navigation" aria-expanded="false" aria-controls="lnav-side">☰</button>
        <a class="lnav-mbrand" href="/">${LOGO_SVG} <span style="margin-left:8px" class="lnav-mbrand-label">Lifecycle OS</span></a>
      </div>
      <div class="lnav-mbar-spacer"></div>
      <div class="lnav-backdrop" id="lnav-backdrop"></div>
      <aside class="lnav-side" id="lnav-side" role="navigation" aria-label="Main navigation">
        <div class="lnav-head">
          <a class="lnav-brand" href="/">
            ${LOGO_SVG}
            <span class="lnav-bt"><b>Lifecycle OS</b><small class="lnav-tagline">Every brand. Every lifecycle.</small><span class="lnav-brandrow"><span class="lnav-brandlogo" data-brand-slot="logo" hidden></span><small class="lnav-brandname"></small></span></span>
          </a>
          <button class="lnav-collapse" id="lnav-collapse" type="button" title="Collapse sidebar" aria-label="Collapse sidebar">«</button>
        </div>
        <div class="lnav-region" data-region-picker></div>
        <div class="lnav-scroll">${navHtml}</div>
        ${userHtml}
      </aside>
      <div class="lnav-ipanel-backdrop" id="lnav-ipanel-backdrop"></div>
      <div class="lnav-ipanel" id="lnav-ipanel" role="dialog" aria-modal="true" aria-labelledby="lnav-ipanel-title">
        <div class="lnav-ipanel-head">
          <div class="lnav-ipanel-htxt">
            <div class="lnav-ipanel-eyebrow" id="lnav-ipanel-eyebrow"></div>
            <div class="lnav-ipanel-title" id="lnav-ipanel-title"></div>
          </div>
          <button type="button" class="lnav-ipanel-close" id="lnav-ipanel-close" aria-label="Close">×</button>
        </div>
        <div class="lnav-ipanel-body" id="lnav-ipanel-body"></div>
      </div>
    `;
    document.body.insertBefore(wrap, document.body.firstChild);
    syncStudyRows();
    bindSkipTarget(wrap);
    // Rows marked shipped are one brand's artefacts (the grail-drop pages).
    // They stay for a signed-out preview and for the workspace the server
    // calls tenant zero, and they leave the rail for every other brand.
    const applyShippedNav = () => {
      let show = true;
      try {
        const B = window.BrandContext;
        if (B && B.brand && typeof B.isTenantZero === 'function') show = !!B.isTenantZero(B.brand);
      } catch (_) { show = true; }
      wrap.querySelectorAll('[data-shipped-nav]').forEach((el) => {
        el.hidden = !show;
      });
    };
    applyShippedNav();
    try {
      const B = window.BrandContext;
      if (B && typeof B.ready === 'function') B.ready().then(applyShippedNav, applyShippedNav);
    } catch (_) {}
    if (!window.__lnavShippedBound) {
      window.__lnavShippedBound = true;
      window.addEventListener('brandcontext:change', () => {
        try { window.__lnavApplyShipped && window.__lnavApplyShipped(); } catch (_) {}
      });
    }
    window.__lnavApplyShipped = applyShippedNav;
    // Signal to embedded apps (e.g. Mailer Studio) that they're rendering
    // inside the Lifecycle OS shell, so they can hide their own duplicate
    // header / tabs / sign-out chrome.
    document.body.classList.add('lifecycle-os-mode');
    document.documentElement.classList.add('lifecycle-os-mode');

    // Publish --ltb-h (mobile top-bar height, else 0) so each page's own sticky
    // header offsets correctly beneath the bar on small screens.
    const publishHeight = () => {
      const mbar = wrap.querySelector('.lnav-mbar');
      const h = (mbar && getComputedStyle(mbar).display !== 'none')
        ? Math.ceil(mbar.getBoundingClientRect().height) : 0;
      document.documentElement.style.setProperty('--ltb-h', h + 'px');
    };
    publishHeight();
    requestAnimationFrame(publishHeight);
    window.addEventListener('load', publishHeight);
    if (!window.__ltbResizeHooked) {
      window.__ltbResizeHooked = true;
      window.addEventListener('resize', publishHeight);
    }

    // Group expand/collapse (the head now sits inside a .lnav-item row, so
    // resolve the owning .lnav-group instead of assuming parentElement).
    wrap.querySelectorAll('.lnav-ghead').forEach((btn) => {
      btn.addEventListener('click', () => {
        const g = btn.closest('.lnav-group');
        if (g) g.classList.toggle('open');
      });
    });

    // ── Feature IA: the "?" chip opens a "know about this feature" popup that
    //    lays out all five common questions as headings with their content.
    //    Everything lives inside #lifecycle-nav so page CSS cannot collide, and
    //    it works signed-in or signed-out. Content is written via textContent
    //    so it never needs HTML-escaping.
    const ipanel = wrap.querySelector('#lnav-ipanel');
    const ipanelBody = wrap.querySelector('#lnav-ipanel-body');
    const ipanelTitle = wrap.querySelector('#lnav-ipanel-title');
    const ipanelEyebrow = wrap.querySelector('#lnav-ipanel-eyebrow');
    const closeIpanel = () => wrap.classList.remove('ipanel-open');
    const openInfoModal = (key) => {
      const f = INFO[key];
      if (!f || !ipanel) return;
      ipanelEyebrow.textContent = f.title;
      ipanelTitle.textContent = 'Know about this feature';
      ipanelBody.innerHTML = '';
      SUBQ.forEach(([sub, label]) => {
        const h = document.createElement('h4');
        h.className = 'lnav-ipanel-q';
        h.textContent = label;
        ipanelBody.appendChild(h);
        if (sub === 'steps') {
          if (f.pipeline) {
            const note = document.createElement('p');
            note.className = 'lnav-ipanel-note';
            note.textContent = 'Multi-agent pipeline: every step runs as its own specialist agent, maximum creativity, ideation and business-strategic thinking before anything ships.';
            ipanelBody.appendChild(note);
          }
          const ol = document.createElement('ol');
          ol.className = 'lnav-steps';
          (f.steps || []).forEach((st) => {
            const li = document.createElement('li');
            const b = document.createElement('b'); b.textContent = st[0]; li.appendChild(b);
            const d = document.createElement('span'); d.className = 'lnav-step-d'; d.textContent = st[1]; li.appendChild(d);
            if (st[2]) { const via = document.createElement('span'); via.className = 'lnav-step-via'; via.textContent = 'Runs via: ' + st[2]; li.appendChild(via); }
            ol.appendChild(li);
          });
          ipanelBody.appendChild(ol);
        } else {
          const p = document.createElement('p');
          p.textContent = f[sub] || '';
          ipanelBody.appendChild(p);
        }
      });
      ipanelBody.scrollTop = 0;
      wrap.classList.add('ipanel-open');
    };
    wrap.querySelectorAll('.lnav-i').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        openInfoModal(btn.dataset.itoggle);
      });
    });
    wrap.querySelector('#lnav-ipanel-close')?.addEventListener('click', closeIpanel);
    wrap.querySelector('#lnav-ipanel-backdrop')?.addEventListener('click', closeIpanel);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeIpanel(); });

    // Re-apply active state when the URL hash changes (e.g. user clicks
    // sub-tabs on ad-campaigns.html that just flip the hash). No re-render
    // — just toggle the `active` classes so the sidebar mirrors the new
    // sub-tab without losing scroll position or open-group state.
    const refreshActive = () => {
      const cur = currentStepId();
      wrap.querySelectorAll('.lnav-link').forEach((a) => {
        a.classList.toggle('active', a.dataset.id === cur);
      });
      wrap.querySelectorAll('.lnav-group').forEach((g) => {
        const hit = !!g.querySelector('.lnav-link.active');
        g.classList.toggle('active-group', hit);
        if (hit) g.classList.add('open'); // auto-expand the group that owns the active link
      });
    };
    window.addEventListener('hashchange', refreshActive);
    // Pages with in-place tabs call this after setting window.__LC_ACTIVE_ID.
    window.__LC_NAV_REFRESH = refreshActive;
    // Also refresh on history navigation (back/forward across hash routes).
    window.addEventListener('popstate', refreshActive);
    // AND on programmatic URL changes: region switches, detail panels, and the
    // calendar day-view use history.replaceState/pushState, which fire NEITHER
    // hashchange NOR popstate. Patch them once to emit a signal, and keep a
    // single window-level listener pointed at the latest refreshActive so the
    // highlight updates from every source without stacking listeners.
    window.__lnavRefresh = refreshActive;
    if (!window.__lnavHistoryPatched) {
      window.__lnavHistoryPatched = true;
      ['pushState', 'replaceState'].forEach((m) => {
        const orig = history[m];
        if (typeof orig !== 'function') return;
        history[m] = function () {
          const r = orig.apply(this, arguments);
          try { window.dispatchEvent(new Event('lnav:locationchange')); } catch (_) {}
          return r;
        };
      });
      window.addEventListener('lnav:locationchange', () => { try { window.__lnavRefresh && window.__lnavRefresh(); } catch (_) {} });
    }

    // Mobile drawer open/close
    const setOpen = (o) => {
      wrap.classList.toggle('open', o);
      const burger = wrap.querySelector('#lnav-burger');
      if (burger) {
        burger.setAttribute('aria-expanded', o ? 'true' : 'false');
        burger.setAttribute('aria-label', o ? 'Close navigation' : 'Open navigation');
      }
    };
    wrap.querySelector('#lnav-burger')?.addEventListener('click', () => setOpen(true));
    wrap.querySelector('#lnav-backdrop')?.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (wrap.classList.contains('ipanel-open')) { closeIpanel(); return; }
      setOpen(false);
    });
    // Same-tab nav clicks close the drawer.
    wrap.querySelectorAll('.lnav-link').forEach((a) => {
      if (!a.target) a.addEventListener('click', () => setOpen(false));
    });

    // ── Touch swipe: swipe RIGHT opens the LHS nav, swipe LEFT closes it ──
    // Mobile only. Opening starts from the left half of the screen (so it never
    // fights right-edge content); closing works from anywhere while open.
    // Attached ONCE globally (injectTopbar can re-run on auth changes) and it
    // resolves the live nav element at event time so it never holds a stale ref.
    if (!window.__lcSwipeHooked) {
      window.__lcSwipeHooked = true;
      const navEl = () => document.getElementById('lifecycle-nav');
      const setOpenG = (o) => { const n = navEl(); if (n) n.classList.toggle('open', o); };
      const isMobileNav = () => window.matchMedia('(max-width: 960px)').matches;
      const OPEN_FROM = 0.5;   // opening gesture must start in the left 50% of the viewport
      const THRESH = 55;       // min horizontal travel (px)
      let sx = 0, sy = 0, swiping = false;
      document.addEventListener('touchstart', (e) => {
        const n = navEl();
        if (!n || !isMobileNav() || e.touches.length !== 1) { swiping = false; return; }
        const t = e.touches[0]; sx = t.clientX; sy = t.clientY;
        const open = n.classList.contains('open');
        swiping = open || sx <= window.innerWidth * OPEN_FROM;
      }, { passive: true });
      document.addEventListener('touchend', (e) => {
        if (!swiping) return;
        swiping = false;
        const n = navEl();
        if (!n || !isMobileNav()) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) < THRESH || Math.abs(dx) <= Math.abs(dy)) return; // horizontal-dominant only
        const open = n.classList.contains('open');
        if (dx > 0 && !open) setOpenG(true);        // swipe right → open
        else if (dx < 0 && open) setOpenG(false);   // swipe left → close
      }, { passive: true });
      // Resize cleanup: leaving mobile width should never strand an open drawer.
      window.addEventListener('resize', () => { if (!isMobileNav()) setOpenG(false); });
    }

    // Sign-in / sign-out wiring
    wireRailUser(wrap);

    // ── Collapse / expand the rail (icon-only), persisted across pages ──
    const COLLAPSE_KEY = 'lifecycle-nav-collapsed';
    const collapseBtn = wrap.querySelector('#lnav-collapse');
    const applyCollapsed = (c) => {
      document.documentElement.classList.toggle('lnav-collapsed', c);
      document.documentElement.style.setProperty('--lsb-w', c ? '64px' : '248px');
      if (collapseBtn) {
        collapseBtn.innerHTML = c ? '»' : '«';
        collapseBtn.title = c ? 'Expand sidebar' : 'Collapse sidebar';
      }
      publishHeight();
    };
    let collapsed = false;
    try { collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch {}
    applyCollapsed(collapsed);
    if (collapseBtn) collapseBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch {}
      applyCollapsed(collapsed);
    });
  }

  // The user block at the foot of the rail: the account chip + sign-out when a
  // session exists, a "Sign in with Google" link otherwise. It is the ONLY
  // part of the rail that depends on the session, which is why it can be
  // swapped in place (see setRailUser) instead of the whole rail waiting for
  // the session to resolve. Google is the only sign-in (2026-10-10).
  const SIGN_IN_LABEL = 'Sign in with Google';
  function bindSkipTarget(wrap) {
    const skip = wrap && wrap.querySelector('.lnav-skip');
    if (!skip) return;
    const resolve = () => document.getElementById('lc-content')
      || document.querySelector('main, [role="main"]')
      || wrap.nextElementSibling;
    const mark = (t) => {
      if (!t) return null;
      if (!t.id) t.id = 'lc-content';
      return t;
    };
    mark(resolve());
    skip.addEventListener('click', (e) => {
      const t = mark(resolve());
      if (!t) return;
      e.preventDefault();
      if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
      try { t.focus({ preventScroll: true }); } catch (_) { try { t.focus(); } catch (__) {} }
      try { t.scrollIntoView({ block: 'start' }); } catch (_) {}
    });
  }
  function escHtml(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /** The only sign-in a visitor is offered: Google, through Supabase Auth. */
  function signInLabelHtml() {
    return 'Sign in<span class="lnav-signin-with"> with Google</span>';
  }
  function paintSignInLabel(btn, opts) {
    if (!btn) return;
    // A press in flight owns the label ("Checking sign-in…"). clearSignInNote
    // must not take it back; the press itself restores with { force: true }.
    if (btn.dataset.busy && !(opts && opts.force)) return;
    btn.innerHTML = signInLabelHtml();
    btn.setAttribute('aria-label', SIGN_IN_LABEL);
    btn.removeAttribute('title');
  }
  function railUserHtml(user) {
    // A Google user (Supabase's {email, user_metadata:{name|full_name,
    // avatar_url}}) and the localhost "Local preview" stub, which has the
    // same shape.
    const um = (user && user.user_metadata) || {};
    const display = user
      ? String(um.name || um.full_name || user.email || '?').trim()
      : '';
    const initials = display.slice(0, 1).toUpperCase();
    const avatar = user
      ? (user.user_metadata && user.user_metadata.avatar_url
          ? `<span class="lnav-avatar"><img src="${escHtml(user.user_metadata.avatar_url)}" alt="" referrerpolicy="no-referrer"></span>`
          : `<span class="lnav-avatar">${escHtml(initials)}</span>`)
      : '';
    return user
      ? `<div class="lnav-user"${user.email ? ` title="${escHtml(user.email)}"` : ''}>${avatar}<span class="lnav-uname">${escHtml(display)}</span>
           <button class="lnav-signout" id="lnav-signout" title="Sign out">⎋</button></div>`
      : `<div class="lnav-user"><a class="lnav-signin" id="lnav-signin" href="/" aria-label="${escHtml(SIGN_IN_LABEL)}">${signInLabelHtml()}</a></div>`;
  }
  function wireRailUser(root) {
    const signinBtn = root.querySelector('#lnav-signin');
    if (signinBtn) signinBtn.onclick = (e) => {
      // Always handled here. The anchor's href="/" used to be the fallback for
      // a deployment with no client at all, which sent an unconfigured
      // deployment's visitor to the homepage instead of telling them why.
      e.preventDefault();
      // Google is the only sign-in (2026-10-10). A press during boot waits
      // (the chip says so) and is diagnosed only once the host is known, so
      // a slow config fetch is never reported as a missing project, and a
      // host that is not there is NAMED, never navigated to.
      beginGoogleSignIn(root);
    };
    const signoutBtn = root.querySelector('#lnav-signout');
    if (signoutBtn) signoutBtn.onclick = () => window.LifecycleAuth.signOut();
  }

  /**
   * Take back a refusal the rail is showing: the note under the button, the
   * aria link to it, and the button's own text. Called whenever the state the
   * note described has been superseded - a session arrived (setRailUser), or
   * boot resolved signed-out (gateSignedOut). A note left beside a signed-in
   * chip describes a state that no longer exists. The button text is left
   * alone while a press is in flight, because that press owns it.
   */
  function clearSignInNote(root) {
    const scope = root || document.getElementById('lifecycle-nav');
    if (!scope) return;
    const note = scope.querySelector('#lnav-signin-note');
    if (note) note.remove();
    const btn = scope.querySelector('#lnav-signin');
    if (btn) {
      btn.removeAttribute('aria-describedby');
      paintSignInLabel(btn);
    }
  }

  /**
   * THE RAIL IS MOUNTED BEFORE THE SESSION IS KNOWN, and this is how the session
   * catches up with it.
   *
   * Measured on 2026-09-15 with the real supabase-js against an auth host that
   * does not resolve (a PAUSED project) and the expired session such a browser
   * still holds in localStorage: `getSession()` retries the token refresh with
   * exponential backoff for the SDK's whole 30 s auto-refresh window and only
   * then gives up, so the rail appeared after 25.6-25.8 s on every page
   * measured (research, smart-brain, retention-playbook alike) and after
   * 150-270 ms with no stored session. The pages were never at fault: init()
   * awaited the session before calling injectTopbar(), so for ~25 s each page
   * had NO navigation at all, and a screenshot taken in that window shows the
   * content starting at the left edge. The user's own words: "lhs missing in
   * most of the pages". Nothing in the rail needs the session except this one
   * block, so the guest rail mounts first, synchronously, and this swaps the
   * block when (if) a user arrives. Swapped IN PLACE rather than rebuilding the
   * rail: injectTopbar() registers document/window listeners each time it runs,
   * and a rebuild on every signed-in load would stack them.
   */
  function setRailUser(user) {
    const nav = document.getElementById('lifecycle-nav');
    if (!nav) { injectTopbar(user); return; }
    const slot = nav.querySelector('.lnav-user');
    if (!slot) return;
    // The refusal note sits BESIDE .lnav-user, not inside it, so swapping the
    // block alone would leave a "Sign-in unavailable" note next to the chip.
    clearSignInNote(nav);
    const tmp = document.createElement('div');
    tmp.innerHTML = railUserHtml(user);
    const next = tmp.firstElementChild;
    slot.replaceWith(next);
    wireRailUser(nav);
  }

  // ─── Login wall — REMOVED ───────────────────────────────────────────
  // There is no login wall any more. It blocked every page that was not the
  // homepage, a legal page or the Studio, and it was never the security
  // boundary: the anon key it gated ships in the browser, and RLS (74
  // `is_brand_member` policies, 135 `auth.uid()` checks) is what actually
  // decides which rows a caller can read. With no session those policies all
  // fail and a signed-out caller gets nothing, wall or no wall.
  //
  // removeLoginWall() stays: a browser holding a cached page from before this
  // change can still have the element in the DOM, and gateSignedOut() clears
  // it rather than leaving a wall nobody can dismiss.

  function removeLoginWall() {
    const w = document.getElementById('lifecycle-loginwall');
    if (w) w.remove();
  }

  // ─── Supabase bootstrap ─────────────────────────────────────────────
  async function loadSupabaseSDK() {
    if (window.supabase?.createClient) return window.supabase;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
      s.onload = () => resolve(window.supabase);
      s.onerror = () => reject(new Error('failed to load supabase-js'));
      document.head.appendChild(s);
    });
  }

  // Public Supabase config (anon key is safe on the client — it is designed to
  // ship in the browser and is already served to every visitor by
  // /api/public-config; RLS protects the data). Used as the LAST-RESORT fallback
  // so sign-in works even when the config fetch is unavailable — e.g. on Vercel
  // preview deployments where Deployment Protection redirects /api/public-config
  // to an auth page (HTML, not JSON), or any transient endpoint failure.
  //
  // THE FALLBACK NO LONGER CARRIES A PROJECT REF, and that is the fix rather
  // than a tidy-up. It held a hardcoded Supabase project which was later
  // deleted, so every visitor whose /api/public-config did not answer was sent
  // to `<dead-ref>.supabase.co` and got Chrome's DNS_PROBE_FINISHED_NXDOMAIN —
  // no app error, no explanation, because an OAuth redirect NAVIGATES and
  // cannot fail on a host that does not resolve.
  //
  // This is the SECOND time a baked-in ref went stale here: the Mailer Studio's
  // own comment records being repointed off "a stale third project". A constant
  // that must track an external resource will drift again, and on a multi-tenant
  // platform one project ref is the same defect class as one brand's colour.
  //
  // A deployment that genuinely needs a fallback (a preview where Deployment
  // Protection blocks /api/public-config) sets window.__SUPABASE_FALLBACK__ in
  // its own HTML. Nothing is shipped here.
  const PUBLIC_SUPABASE_FALLBACK = (typeof window !== 'undefined' && window.__SUPABASE_FALLBACK__) || { url: '', anonKey: '' };

  /**
   * Is this auth host actually reachable?
   *
   * `mode: 'no-cors'` on purpose. A CORS refusal and a dead host both reject a
   * normal fetch, so a CORS-mode probe would block sign-in on a perfectly good
   * project. An opaque no-cors response means DNS resolved and the server
   * answered, which is the only thing being asked.
   *
   * A REJECTION blocks sign-in and explains why. A TIMEOUT does not: a slow
   * network is not a missing project, and refusing to sign a user in because
   * their connection is poor would be a worse bug than the one this fixes.
   */
  // Caches the PROBE, not its result, so a second caller while the first is in
  // flight (a Sign-in press racing gateSignedOut) shares one request.
  const REACH_CACHE = new Map();
  function authHostReachable(url) {
    if (!url) return Promise.resolve(false);
    if (REACH_CACHE.has(url)) return REACH_CACHE.get(url);
    const probe = (async () => {
      let ok = true;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 4000);
      try {
        await fetch(url.replace(/\/+$/, '') + '/auth/v1/health', { mode: 'no-cors', signal: ctl.signal });
      } catch (e) {
        ok = (e && e.name === 'AbortError');   // timed out → give it the benefit of the doubt
      } finally {
        clearTimeout(timer);
      }
      return ok;
    })();
    REACH_CACHE.set(url, probe);
    return probe;
  }

  /**
   * AUTH READINESS: settled once init() knows the three things a sign-in
   * diagnosis reads - whether there is a config, whether the SDK client was
   * built, and what the first session lookup said - or once init() has failed
   * trying. Nothing that PAINTS waits on this (the rail is mounted before the
   * first await); only a diagnosis does. Settled on every exit of init() and
   * in boot()'s catch, so a press can never wait forever.
   */
  const authReady = (() => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, settled: false, settle() { if (!this.settled) { this.settled = true; resolve(); } } };
  })();

  /**
   * Which signed-out state is this browser in? One of
   *   unconfigured | sdk | unreachable | signed-out
   * - the same four the standing bar names, decided the same way, so the bar
   * and the sign-in button can never disagree about what is wrong.
   */
  async function signedOutState() {
    const cfg = window.__SUPABASE__ || {};
    if (!cfg.url) return 'unconfigured';
    // A URL but no client: the SDK never loaded (boot()'s catch). This used to
    // be reported as "no Supabase configuration", which sends the operator to
    // check an env var that is set.
    if (!(window.LifecycleAuth && window.LifecycleAuth.client)) return 'sdk';
    return (await authHostReachable(cfg.url)) ? 'signed-out' : 'unreachable';
  }

  /**
   * What this Auth project publishes about its providers.
   *
   * GET /auth/v1/settings is public. `external.google === false` was the live
   * production state on 2026-10-05: GoTrue then answers authorize with
   * 400 validation_failed "Unsupported provider: provider is not enabled",
   * and because signInWithOAuth NAVIGATES the person sees that JSON instead
   * of a sentence. Unreadable settings fail OPEN - a CORS miss, a timeout
   * or a harness that only answers /health must not block a working project.
   * Never prefetch /auth/v1/authorize: that call spends the PKCE verifier.
   */
  const SETTINGS_CACHE = new Map();
  function authSettings(url, anonKey) {
    if (!url) return Promise.resolve(null);
    const key = String(url);
    if (SETTINGS_CACHE.has(key)) return SETTINGS_CACHE.get(key);
    const probe = (async () => {
      const ctl = new AbortController();
      const timer = setTimeout(function () { ctl.abort(); }, 4000);
      try {
        const res = await fetch(url.replace(/\/+$/, '') + '/auth/v1/settings', {
          headers: { apikey: anonKey || '', Authorization: 'Bearer ' + (anonKey || '') },
          signal: ctl.signal,
        });
        if (!res.ok) return null;
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('application/json')) return null;
        return await res.json();
      } catch (e) {
        return null;
      } finally {
        clearTimeout(timer);
      }
    })();
    SETTINGS_CACHE.set(key, probe);
    return probe;
  }
  function googleProviderOff(settings) {
    if (!settings || typeof settings !== 'object') return false;
    const ext = settings.external;
    if (!ext || typeof ext !== 'object') return false;
    return ext.google === false;
  }

  /**
   * Start Google sign-in, but never hand the browser to a host that is not
   * there, or to a project whose Google provider is off. Resolves to null
   * when the redirect has been started, otherwise to `{ kind, message, html }`
   * naming the state that refused it. The sentence is signedOutSentence()'s -
   * the SAME words the standing bar shows for that state.
   */
  async function signInRefusal() {
    // Never diagnose a boot still in flight (see authReady). This also covers
    // window.__startGoogleSignIn__, which pages and tests call directly.
    await authReady.promise;
    const kind = await signedOutState();
    if (kind !== 'signed-out') {
      const s = signedOutSentence(kind);
      return { kind: kind, message: s.text, html: s.html };
    }
    const cfg = window.__SUPABASE__ || {};
    const settings = await authSettings(cfg.url, cfg.anonKey);
    if (googleProviderOff(settings)) {
      const s = signedOutSentence('provider-off');
      return { kind: 'provider-off', message: s.text, html: s.html };
    }
    const client = window.LifecycleAuth && window.LifecycleAuth.client;
    if (!(client && client.auth && typeof client.auth.signInWithOAuth === 'function')) {
      const s = signedOutSentence('sdk');
      return { kind: 'sdk', message: s.text, html: s.html };
    }
    rememberReturnTo();
    const { error } = await client.auth.signInWithOAuth(googleSignInOptions());
    if (!error) return null;
    const message = 'Sign-in failed: ' + (error.message || error);
    return { kind: 'failed', message: message, html: window.LifecycleFailure.html(new Error(message), { title: 'Sign-in failed' }) };
  }

  /** String form of signInRefusal(): '' on success, the sentence on refusal. */
  async function startGoogleSignIn() {
    return beginGoogleSignIn(document.getElementById('lifecycle-nav'));
  }

  /**
   * Say why sign-in did not happen, where the user is looking: a note under
   * the rail's Sign-in button carrying the state's sentence, and the standing
   * bar brought back into view (re-shown if it had been dismissed) so the two
   * explanations are visibly the same one.
   */
  function showSignInRefusal(wrap, btn, refusal) {
    btn.textContent = 'Sign-in unavailable';
    btn.setAttribute('aria-label', 'Sign-in unavailable');
    btn.title = refusal.message;
    btn.setAttribute('aria-describedby', 'lnav-signin-note');
    let note = wrap.querySelector('#lnav-signin-note');
    if (!note) {
      note = document.createElement('div');
      note.id = 'lnav-signin-note';
      note.className = 'lnav-signin-note';
      note.setAttribute('role', 'alert');
      const footer = btn.closest('.lnav-user') || btn;
      footer.insertAdjacentElement('afterend', note);
    }
    note.setAttribute('data-kind', refusal.kind);
    note.innerHTML = refusal.html;
    if (refusal.kind === 'failed') return;   // an OAuth error is not a deployment state
    const bar = injectSignedOutNotice(refusal.kind, { force: true });
    if (!bar) return;
    try { bar.scrollIntoView({ block: 'nearest' }); } catch (_) { /* older engines */ }
    bar.style.outline = '2px solid var(--vh-warn)';
    bar.style.outlineOffset = '-2px';
    setTimeout(function () { bar.style.outline = ''; bar.style.outlineOffset = ''; }, 2400);
  }

  /**
   * The Sign in chip and LifecycleAuth.openSignIn share this. Returns '' when
   * Google has been asked to take over, otherwise the sentence that refused it.
   */
  async function beginGoogleSignIn(root) {
    const nav = root || document.getElementById('lifecycle-nav');
    const btn = nav && nav.querySelector('#lnav-signin');
    if (btn && btn.dataset.busy) return '';
    if (btn) btn.dataset.busy = '1';
    try {
      const waited = !authReady.settled;
      if (waited && btn) {
        btn.textContent = 'Checking sign-in…';
        btn.setAttribute('aria-label', 'Checking sign-in');
        btn.setAttribute('aria-busy', 'true');
      }
      const refusal = await signInRefusal();
      if (waited && btn) {
        paintSignInLabel(btn, { force: true });
        btn.removeAttribute('aria-busy');
      }
      if (!refusal) return '';
      if (btn && nav) showSignInRefusal(nav, btn, refusal);
      return refusal.message || '';
    } catch (err) {
      const message = 'Sign-in failed: ' + ((err && err.message) || err);
      if (btn && nav) {
        showSignInRefusal(nav, btn, {
          kind: 'failed',
          message: message,
          html: window.LifecycleFailure.html(err instanceof Error ? err : new Error(message), { title: 'Sign-in failed' }),
        });
      }
      return message;
    } finally {
      if (btn) delete btn.dataset.busy;
    }
  }

  async function getConfig() {
    if (window.__SUPABASE__?.url && window.__SUPABASE__?.anonKey) return window.__SUPABASE__;
    try {
      const res = await fetch('/api/public-config');
      // Only trust a real JSON response — a protection/redirect page returns
      // HTML, which must NOT be treated as "no config" and must not throw.
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json();
        if (data?.supabase?.url && data?.supabase?.anonKey) {
          window.__SUPABASE__ = data.supabase;
          return data.supabase;
        }
      }
    } catch { /* fall through to the public fallback below */ }
    // Last resort: the baked-in public config (keeps sign-in working on preview
    // deployments and offline). Real env-provided config always wins above.
    // NOT on localhost / file:// — there, returning null preserves the existing
    // "local preview" path (inject the top-bar, no login wall), which local dev
    // and the Playwright suite rely on. The fallback is only for real hosts
    // (preview/production) where /api/public-config may be blocked.
    const isLocalHost = location.protocol === 'file:' ||
      /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname);
    if (!isLocalHost && PUBLIC_SUPABASE_FALLBACK.url && PUBLIC_SUPABASE_FALLBACK.anonKey) {
      window.__SUPABASE__ = PUBLIC_SUPABASE_FALLBACK;
      return PUBLIC_SUPABASE_FALLBACK;
    }
    return null;
  }

  /**
   * ONE sentence per signed-out state, keyed by `kind`
   * (unconfigured | unreachable | sdk | signed-out).
   *
   * Two surfaces explain why sign-in is not happening: the standing bar at the
   * top of every page and the note under the rail's Sign-in button. They were
   * written separately and disagreed on the live deployment - the bar said the
   * project "has most likely been deleted, renamed or paused" (correct: those
   * are indistinguishable from the network, see CLAUDE.md's correction) while
   * the sign-in path said it "has been deleted or renamed", a definite claim
   * the code cannot make. Both render THIS now, so they cannot diverge.
   *
   * Returns { kind, html, text }: `html` carries the <b>/<code> emphasis the
   * bar has always used, `text` is the same words with no markup.
   */
  function signedOutSentence(kind) {
    // FOUR states someone can fix, not one, and naming the wrong one sends
    // the reader to check the thing that is not broken. `unconfigured` is a
    // missing env var on the deployment; `unreachable` is a project that no
    // longer answers, and its host is worth printing because that is the value
    // that has to change; `sdk` is the supabase-js CDN not loading;
    // `provider-off` is a reachable project whose Google provider is disabled
    // (GoTrue 400 validation_failed); `signed-out` is the ordinary case where
    // everything works and this visitor simply has no session.
    var host = '';
    try { host = new URL((window.__SUPABASE__ || {}).url).host; } catch (e) { /* none configured */ }
    // 2026-10-10: sign-in is Google, and Google needs this Supabase project.
    // Each state says what is wrong and that the pages stay open.
    var html;
    if (kind === 'sdk') {
      html = '<b>The Supabase library did not load.</b> auth.js loads '
        + 'supabase-js from a CDN and that request failed - an ad blocker, a network policy or a CDN '
        + 'outage will all do this. Every page is still open and usable. Sign in with Google needs that '
        + 'library, so it cannot run until it loads. Retry on a different network or allow '
        + '<code>cdn.jsdelivr.net</code>, then reload.';
    } else if (kind === 'signed-out') {
      html = '<b>You are signed out.</b> Every page is open and usable, and this one is showing only '
        + 'what this browser holds. <b>Sign in with Google</b> (the Sign in with Google '
        + 'chip in the menu) to keep your brands and work under your name - so an empty panel here means '
        + '"not signed in", not "no data".';
    } else if (kind === 'provider-off' && host) {
      html = '<b>Google is not enabled on this Supabase project</b> (<code>' + host
        + '</code>). Sign in with Google cannot start because the Auth server refuses it with '
        + '<code>validation_failed</code>: provider is not enabled. In the Supabase dashboard open '
        + '<b>Authentication → Providers → Google</b>, turn the provider on, set the Client ID and '
        + 'Client Secret from a Google Cloud OAuth web client, and add the Authorized redirect URI '
        + '<code>https://' + host + '/auth/v1/callback</code>. Then reload. Every page stays open.';
    } else if (kind === 'unreachable' && host) {
      // Host-neutral on purpose: SUPABASE_URL may name a hosted project OR a
      // self-hosted stack (docs/self-hosted-supabase.md); the probe derives
      // its URL from that value and never assumes a *.supabase.co host.
      html = '<b>Running without a workspace database.</b> The database this deployment points at (<code>' + host
        + '</code>) cannot be reached - its Supabase project has most '
        + 'likely been deleted, renamed or paused, or the self-hosted stack is down. Every page is open and '
        + 'usable, but <b>nothing is loaded from or saved to a server.</b> Sign in with Google needs that '
        + 'project, so it cannot run until it answers; brands you set up meanwhile are kept on this device. '
        + 'Point <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> at a live backend to restore saved work.';
    } else {
      html = '<b>Running without a workspace database.</b> This deployment has no <code>SUPABASE_URL</code> / '
        + '<code>SUPABASE_ANON_KEY</code> set. Every page is open and '
        + 'usable, but <b>nothing is loaded from or saved to a server.</b> Sign in with Google needs those '
        + 'values; brands you set up meanwhile are kept on this device. Set them on the deployment to restore saved work.';
    }
    // A mobile-number sign-in this browser held was ended on this boot
    // (2026-10-10): said once, first, in the same bar.
    if (phoneEndedNote) html = '<b>Mobile-number sign-in has ended.</b> ' + phoneEndedNote + ' ' + html;
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    return { kind: kind, html: html, text: tmp.textContent };
  }

  /**
   * A standing, dismissible bar explaining why the app has no data.
   *
   * Brand tokens only, and never a dark ground: `--vh-warn` on the brand's own
   * surface, ink text. A banner that hardcoded its own colours would be the one
   * element on the page that ignores the active brand, and a dark one would
   * break the repo's standing no-dark-section rule.
   *
   * `opts.force` re-shows a bar the visitor dismissed for this tab: pressing
   * Sign-in is a request for the explanation, so the dismissal is set aside.
   * Returns the bar element (existing or new), or null when nothing rendered.
   */
  /**
   * The standing notice's LAYOUT, once per page. Colours stay inline on the
   * bar itself (unchanged); only position, spacing and the phone clamp live
   * here, because a media query cannot reach an inline declaration.
   * Up to a tablet's width (and on any screen under 520px tall) the sentence is clamped to two
   * lines with a More/Less toggle, and the bar is not sticky: it starts under
   * the phone bar and scrolls away with the page, so the screen goes to content.
   */
  function injectNoticeLayout() {
    if (document.getElementById('lc-authnotice-layout')) return;
    var st = document.createElement('style');
    st.id = 'lc-authnotice-layout';
    st.textContent = [
      '#lc-authnotice{position:sticky;top:var(--ltb-h,0px);z-index:120;padding:10px 16px;display:flex;gap:12px;align-items:flex-start}',
      '#lc-authnotice-text{overflow-wrap:anywhere}',
      '#lc-authnotice .lc-authnotice-more{display:none}',
      '@media (max-width:1024px),(max-height:520px){',
      '#lc-authnotice{padding:6px 12px;gap:8px;align-items:center}',
      '#lc-authnotice:not(.lc-open) #lc-authnotice-text{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}',
      '#lc-authnotice{position:relative;top:auto}',
      '#lc-authnotice .lc-authnotice-more{display:inline-flex;align-items:center;justify-content:center;order:1}',
      '#lc-authnotice > button{order:2;min-height:44px;min-width:44px}',
      '#lc-authnotice > #lc-authnotice-text{order:0}',
      '}',
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  function injectSignedOutNotice(kind, opts) {
    var existing = document.getElementById('lc-authnotice');
    if (existing) {
      // Sign-in may learn a more specific state (Google is off) after boot
      // already painted "signed out". force:true is a request for the
      // explanation, so the bar's words have to match the chip's.
      if (opts && opts.force && existing.getAttribute('data-kind') !== kind) {
        existing.setAttribute('data-kind', kind);
        var existingTxt = existing.querySelector('#lc-authnotice-text');
        if (existingTxt) existingTxt.innerHTML = signedOutSentence(kind).html;
        existing.style.boxShadow = 'inset 0 3px 0 ' + (kind === 'signed-out'
          ? 'var(--vh-accent)' : 'var(--vh-warn)');
      }
      return existing;
    }
    // Dismissed for this tab? Check before building anything.
    if (!(opts && opts.force)) {
      try { if (sessionStorage.getItem('lc-authnotice-hid')) return null; } catch (e) { /* private mode */ }
    }
    var bar = document.createElement('div');
    bar.id = 'lc-authnotice';
    bar.setAttribute('role', 'status');
    bar.setAttribute('data-kind', kind);
    // Sticky BELOW the phone top bar, not over it. `--ltb-h` is the rail's own
    // published height of its fixed mobile bar (0 on a desktop, where there is
    // none). Found on production's bytes at 390px (2026-09-29): with top:0 and
    // a z-index above the bar's, this notice - the one that says "the Sign in
    // chip in the menu" - sat on top of the burger that opens the menu, so a
    // signed-out phone visitor could not reach Sign in until they had found
    // Dismiss. It is inserted after the rail for the same reason: the rail's
    // spacer reserves the fixed bar's height in flow, so the notice starts
    // under the bar at rest as well as when scrolling.
    // Layout (sticky offset, padding, the phone clamp) lives in one stylesheet,
    // injectNoticeLayout(), so a phone can compact the bar with a media query;
    // an inline declaration would outrank every one of them. 2026-10-10: at
    // 320px the full sentence was 334px tall on a 568px screen, so with the
    // 50px top bar 68% of the first screen was chrome.
    injectNoticeLayout();
    bar.className = 'lc-authnotice';
    bar.style.cssText = [
      'background:var(--vh-panel-2,#f5f5f5)',
      'color:var(--vh-ink,#111111)',
      'border-bottom:1px solid var(--vh-line,#ebebeb)',
      // Being signed out is an ordinary state, not a fault. Only the two
      // states someone has to FIX wear the warning colour.
      'box-shadow:inset 0 3px 0 ' + (kind === 'signed-out'
        ? 'var(--vh-accent)' : 'var(--vh-warn)'),
      'font:13px/1.5 var(--vh-font-body,system-ui,sans-serif)',
    ].join(';');
    var txt = document.createElement('div');
    txt.id = 'lc-authnotice-text';
    txt.style.cssText = 'flex:1;min-width:0';
    // The words come from signedOutSentence(), the one source the sign-in
    // button also renders. Nothing is written here.
    txt.innerHTML = signedOutSentence(kind).html;
    var x = document.createElement('button');
    x.type = 'button';
    x.textContent = 'Dismiss';
    x.style.cssText = 'flex:none;border:1px solid var(--vh-line,#ebebeb);background:transparent;'
      + 'color:var(--vh-ink,#111111);border-radius:8px;padding:4px 10px;cursor:pointer;font:inherit';
    x.onclick = function () { bar.remove(); try { sessionStorage.setItem('lc-authnotice-hid', '1'); } catch (e) {} };
    // On a phone the sentence is clamped to two lines; this shows the rest.
    // It comes AFTER Dismiss in the DOM (Dismiss stays the bar's first button)
    // and before it on screen (CSS order), and it is hidden on a wide screen.
    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'lc-authnotice-more';
    more.textContent = 'More';
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-controls', 'lc-authnotice-text');
    more.style.cssText = x.style.cssText;
    more.onclick = function () {
      var open = bar.classList.toggle('lc-open');
      more.textContent = open ? 'Less' : 'More';
      more.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    bar.appendChild(txt); bar.appendChild(x); bar.appendChild(more);
    var host = document.body || document.documentElement;
    var rail = document.getElementById('lifecycle-nav');
    if (rail && rail.parentNode === host) rail.insertAdjacentElement('afterend', bar);
    else host.insertBefore(bar, host.firstChild);
    return bar;
  }

  /**
   * A signed-out visitor is never blocked. Anywhere.
   *
   * WHY THIS IS NOT AN AUTH BYPASS, which is the obvious objection: the wall
   * was never the security boundary and could not have been. The anon key it
   * gated is PUBLIC by design — it ships in the browser and /api/public-config
   * hands it to anyone who asks — so anything the wall "protected" was already
   * one curl away. What actually protects the data is ROW LEVEL SECURITY: 74
   * `is_brand_member` policies and 135 `auth.uid()` checks across the
   * migrations. With no session `auth.uid()` is null, every one of those
   * policies fails, and a signed-out caller gets zero rows. Even the four
   * aggregate views granted to `anon` are `security_invoker=on`, so the same
   * RLS applies through them.
   *
   * So the wall was costing every feature and defending nothing that RLS was
   * not already defending. Removing it changes what the UI SHOWS, never what
   * the database RETURNS.
   *
   * What replaces it is an explanation, not a gate: a dismissible bar that says
   * the visitor is signed out and what that means for the data on screen. An
   * empty dashboard with no explanation reads as "no data" rather than "not
   * signed in", and silence reads as a design choice.
   */
  async function gateSignedOut() {
    removeLoginWall();
    injectTopbar(null);
    // The state is now resolved; a note written against an earlier one (or a
    // "Checking sign-in…" left by a press that is no longer in flight) goes.
    clearSignInNote();
    // Which of the three signed-out states is this? They need different words:
    // a missing env var, a project that no longer answers, and simply being
    // logged out are three different things to be told.
    const url = (window.__SUPABASE__ || {}).url;
    if (!url) { injectSignedOutNotice('unconfigured', { force: !!phoneEndedNote }); setBackendState('unconfigured'); return; }
    const kind = (await authHostReachable(url)) ? 'signed-out' : 'unreachable';
    // A phone sign-in ended on this boot is news: shown even in a tab that
    // dismissed the bar earlier.
    injectSignedOutNotice(kind, { force: !!phoneEndedNote });
    setBackendState(kind);
  }

  // ─── Backend state: ONE answer to "is there a database, and is this visitor
  // signed in to it" ──────────────────────────────────────────────────────────
  // brand-context.js decides from this record, and from nothing else, whether a
  // brand is saved to the ACCOUNT or to THIS DEVICE. It is derived from the same
  // probe (authHostReachable) and the same session the notice bar above is built
  // from, so the bar and the store can never disagree. A second reachability
  // check in brand-context.js would be the "one probe, not two" defect again:
  // two implementations that drift, with the bar saying one thing and the
  // wizard doing another.
  //
  //   kind          reachable  signedIn  who fixes it
  //   unconfigured  false      false     the deployment (no SUPABASE_URL)
  //   unreachable   false      false     the deployment (project paused/gone)
  //   sdk           unknown    false     the network (supabase-js CDN blocked)
  //   signed-out    true       false     nobody: an ordinary state
  //   signed-in     true       true      -
  //   local         true       false     localhost preview: no backend, a
  //                                      preview user, the local server answers
  //
  // `pending` until init() has decided. It is published three ways because the
  // consumers are shaped differently: a field to read, an event to wait on, and
  // a promise that resolves on the FIRST decision.
  const BACKEND_KINDS = {
    pending:      { reachable: null,  signedIn: false },
    unconfigured: { reachable: false, signedIn: false },
    unreachable:  { reachable: false, signedIn: false },
    sdk:          { reachable: null,  signedIn: false },
    'signed-out': { reachable: true,  signedIn: false },
    'signed-in':  { reachable: true,  signedIn: true },
    local:        { reachable: true,  signedIn: false },
  };
  let backendResolve;
  const backendFirst = new Promise((r) => { backendResolve = r; });
  // `extra` carries the Supabase state on its own (`supabase: unconfigured|
  // unreachable|reachable|sdk`). A no-session kind IS a statement about
  // Supabase, so it is published as one (2026-09-29); a Google session is
  // 'reachable' by construction (applySupabaseUser).
  const SUPABASE_OF_KIND = { unconfigured: 'unconfigured', unreachable: 'unreachable', 'signed-out': 'reachable', sdk: 'sdk' };
  function backendSnapshot(kind, extra) {
    const k = BACKEND_KINDS[kind] ? kind : 'pending';
    let host = '';
    try { host = new URL((window.__SUPABASE__ || {}).url).host; } catch (_) { /* none configured */ }
    const prev = (window.LifecycleAuth && window.LifecycleAuth.backend) || {};
    return Object.assign({ kind: k, host, session: prev.session || null, supabase: SUPABASE_OF_KIND[k] || prev.supabase || 'pending' }, BACKEND_KINDS[k], extra || {});
  }
  function setBackendState(kind, extra) {
    const snap = backendSnapshot(kind, extra);
    if (window.LifecycleAuth) window.LifecycleAuth.backend = snap;
    try { window.dispatchEvent(new CustomEvent('lifecycleauth:backend', { detail: snap })); } catch (_) { /* no CustomEvent */ }
    if (snap.kind !== 'pending') backendResolve(snap);
    return snap;
  }
  function backendPending() {
    return !window.LifecycleAuth || !window.LifecycleAuth.backend || window.LifecycleAuth.backend.kind === 'pending';
  }

  // ─── Access mode ─────────────────────────────────────────────────────────
  // Every signed-in user gets full, live access. The former demo/mock-mode
  // gate (which simulated write/generation calls for non-knickgasm.com accounts),
  // its fetch guard, and the demo banner have been removed. The mockMode /
  // __KNICKGASM_MOCK__ flags are kept, pinned to false, so anything that still
  // reads them simply sees "live".
  function applyAccessMode(user) {
    window.LifecycleAuth.internal = !!user;
    window.LifecycleAuth.mockMode = false;
    window.__KNICKGASM_MOCK__ = false;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MOBILE NUMBER + PIN SIGN-IN IS SWITCHED OFF (2026-10-10)

     The owner's words: "No signin with mobile number - only Google signin
     pls". From 2026-09-28 to 2026-10-10 this block was the browser half of a
     mobile number + 4-digit PIN sign-in (a panel in the rail, a device store
     in localStorage, a Neon or Supabase account on the server). It is gone:
     no panel is rendered, nothing here can create or sign in an account, and
     the server refuses `op=enter` (api/_shared/mobile-auth-core.js) and every
     phone or device token exactly like no token at all.

     WHAT A BROWSER THAT USED IT STILL HOLDS, and what boot does with it:
       lifecycle.auth.session        the phone session. ENDED: removed, the
                                     server asked to revoke it (best effort),
                                     and one accent-rule sentence says so.
       lifecycle.auth.device.users   device accounts (name + PBKDF2 of the
                                     PIN). Removed: nothing reads them, and a
                                     4-digit PIN hash is not worth keeping.
       lifecycle.brand.device.workspaces.<phone account id>
                                     the brands that account kept on this
                                     device. KEPT where they are, never deleted,
                                     and COPIED into the device store a signed-
                                     out visitor sees (the unscoped key), so
                                     they stay usable here and are offered for
                                     sync once a Google account is signed in.
     Why copying them out of the account's namespace exposes nothing new: that
     namespace was keyed by an id in plain localStorage, behind a 4-digit PIN
     whose PBKDF2 hash sat beside it - ten thousand guesses away from anyone at
     the keyboard. It separated people sharing a browser; it never protected a
     brand from them, and the alternative is a person's brands vanishing.
     ═══════════════════════════════════════════════════════════════════════════ */

  const LEGACY_SESSION_KEY = 'lifecycle.auth.session';
  const LEGACY_USERS_KEY = 'lifecycle.auth.device.users';
  const DEVICE_BRANDS_KEY = 'lifecycle.brand.device.workspaces';
  // The sentence the standing bar and the rail note carry on the boot that
  // ended a phone session; '' otherwise.
  let phoneEndedNote = '';

  function readJsonKey(k) {
    try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; }
  }

  /**
   * Copy the brands each legacy phone account kept on this device into the
   * signed-out device store, by id, without overwriting a row already there
   * and without removing the originals. Side records kept beside a brand
   * (`<key>.<kind>.<id>`: its catalogue, its context pack) come too.
   * Returns how many brands are now reachable that were not.
   */
  function keepLegacyDeviceBrands(ids, activeFrom) {
    let copied = 0;
    try {
      const into = readJsonKey(DEVICE_BRANDS_KEY) || { version: 1, active_id: '', workspaces: [] };
      if (!Array.isArray(into.workspaces)) into.workspaces = [];
      const have = new Set(into.workspaces.map((w) => w && w.id));
      ids.forEach((id) => {
        const from = readJsonKey(DEVICE_BRANDS_KEY + '.' + id);
        if (!from || !Array.isArray(from.workspaces)) return;
        from.workspaces.forEach((w) => {
          if (!w || !w.id || have.has(w.id)) return;
          into.workspaces.push(w); have.add(w.id); copied++;
        });
        if (!into.active_id && id === activeFrom && from.active_id && have.has(from.active_id)) into.active_id = from.active_id;
        const prefix = DEVICE_BRANDS_KEY + '.' + id + '.';
        const side = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf(prefix) === 0) side.push(k);
        }
        side.forEach((k) => {
          const to = DEVICE_BRANDS_KEY + '.' + k.slice(prefix.length);
          if (localStorage.getItem(to) === null) localStorage.setItem(to, localStorage.getItem(k));
        });
      });
      if (copied) localStorage.setItem(DEVICE_BRANDS_KEY, JSON.stringify(into));
    } catch (_) { /* storage blocked or full: the originals are untouched either way */ }
    return copied;
  }

  /**
   * End a mobile-number sign-in left in this browser. Runs first on every
   * boot; does nothing when there is nothing to end. Never deletes a brand.
   */
  function endLegacyPhoneSession() {
    let had = false;
    try { had = localStorage.getItem(LEGACY_SESSION_KEY) !== null || localStorage.getItem(LEGACY_USERS_KEY) !== null; } catch (_) { return false; }
    if (!had) return false;
    const sess = readJsonKey(LEGACY_SESSION_KEY);
    const users = readJsonKey(LEGACY_USERS_KEY);
    const ids = [];
    const sessId = sess && sess.user && sess.user.id ? String(sess.user.id) : '';
    if (sessId) ids.push(sessId);
    if (users && typeof users === 'object') {
      Object.keys(users).forEach((k) => { const u = users[k]; if (u && u.id && ids.indexOf(String(u.id)) < 0) ids.push(String(u.id)); });
    }
    const copied = keepLegacyDeviceBrands(ids, sessId);
    // A session the server kept (Neon, or a Supabase phone account) is
    // revoked there too, so a copy of its token is worth nothing. Best effort:
    // the server refuses every phone token anyway.
    if (sess && typeof sess.token === 'string' && sess.token && (sess.mode === 'server' || sess.mode === 'supabase')) {
      try {
        fetch('/api/public-config?action=auth&op=signout', {
          method: 'POST', keepalive: true, cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sess.token, 'X-Lifecycle-Token': sess.token },
          body: JSON.stringify({ op: 'signout' }),
        }).catch(() => {});
      } catch (_) { /* nothing to revoke with */ }
    }
    try { localStorage.removeItem(LEGACY_SESSION_KEY); localStorage.removeItem(LEGACY_USERS_KEY); } catch (_) {}
    try { localStorage.removeItem('lc-brand-context'); } catch (_) {}
    if (sess && sess.token) {
      phoneEndedNote = 'Sign-in is with Google now, so the mobile-number sign-in this browser held was ended. '
        + (copied
          ? 'The ' + copied + (copied === 1 ? ' brand' : ' brands') + ' it kept on this device ' + (copied === 1 ? 'is' : 'are') + ' still here.'
          : 'Any brands it kept on this device are still here.');
    }
    return !!phoneEndedNote;
  }

  // Run NOW, while auth.js is still being evaluated - before brand-context.js
  // (which auth.js injects, and which paints the first frame from the device
  // store) runs - so the first frame already shows the brands the ended
  // sign-in kept, not the default and then a flash to them.
  endLegacyPhoneSession();

  /** Under the Sign in chip: the phone sign-in ended on this boot, in the accent rule. */
  function phoneEndedRailNote(nav) {
    if (!phoneEndedNote) return;
    const btn = nav && nav.querySelector('#lnav-signin');
    if (!btn) return;
    let note = nav.querySelector('#lnav-signin-note');
    if (!note) {
      note = document.createElement('div');
      note.id = 'lnav-signin-note';
      note.className = 'lnav-signin-note';
      note.setAttribute('role', 'status');
      (btn.closest('.lnav-user') || btn).insertAdjacentElement('afterend', note);
    }
    note.setAttribute('data-kind', 'phone-ended');
    note.textContent = phoneEndedNote;
    btn.setAttribute('aria-describedby', 'lnav-signin-note');
  }

  /* ── The Google session (Supabase Auth) ───────────────────────────────── */

  // Shown while an OAuth callback is being exchanged, so a signed-out bar
  // never flashes over a sign-in that is a beat away from resolving.
  function injectSigningInOverlay() {
    if (document.getElementById('lifecycle-signingin')) return;
    const el = document.createElement('div');
    el.id = 'lifecycle-signingin';
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <style>
        #lifecycle-signingin {
          position: fixed; inset: 0; z-index: 9999; background: var(--vh-surface, #ffffff);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 18px; font-family: var(--vh-font-body, system-ui, sans-serif); color: var(--vh-ink, #111111);
        }
        #lifecycle-signingin .lsi-ring {
          width: 40px; height: 40px; border-radius: 50%;
          border: 3px solid var(--vh-line, #ebebeb); border-top-color: var(--vh-accent, #6A33D8);
          animation: lsi-spin 0.8s linear infinite;
        }
        @keyframes lsi-spin { to { transform: rotate(360deg); } }
        #lifecycle-signingin .lsi-t { font-size: 13.5px; letter-spacing: 0.02em; }
      </style>
      <div class="lsi-ring"></div>
      <div class="lsi-t">Completing sign-in…</div>
    `;
    (document.body || document.documentElement).appendChild(el);
  }
  function removeSigningInOverlay() {
    const el = document.getElementById('lifecycle-signingin');
    if (el) el.remove();
  }

  // True while the browser is on a Supabase OAuth callback (PKCE ?code=, an
  // ?error=, or an implicit #access_token). During this window the signed-out
  // bar must not flash: detectSessionInUrl is exchanging the code and
  // onAuthStateChange will fire SIGNED_IN momentarily.
  function oauthCallbackInProgress() {
    try {
      const sp = new URLSearchParams(location.search || '');
      if (sp.has('code') || sp.has('error') || sp.has('error_description')) return true;
      const hash = location.hash || '';
      if (/access_token=|error=/.test(hash)) return true;
    } catch (_) {}
    return false;
  }
  /**
   * Google OAuth options. redirectTo is ALWAYS this origin's root: that is the
   * Site URL every deployment allowlists. A per-page pathname 400s when the
   * wildcard is missing (docs/oauth-redirect-migration.md) and the person
   * lands on Chrome's error with no in-app sentence. rememberReturnTo /
   * restoreReturnTo send them back to the page they pressed from.
   * prompt=select_account is the account picker: without it a browser already
   * signed into one Google account never offers another.
   */
  function googleSignInOptions() {
    return {
      provider: 'google',
      options: {
        redirectTo: location.origin + '/',
        queryParams: { prompt: 'select_account' },
      },
    };
  }
  function sameAppPath(a, b) {
    const norm = (p) => {
      p = String(p || '/');
      if (p === '' || p === '/index.html') return '/';
      return p;
    };
    return norm(a) === norm(b);
  }
  function rememberReturnTo() {
    try { localStorage.setItem('lc-return-to', location.pathname + location.search + location.hash); } catch (_) {}
  }
  function restoreReturnTo() {
    let target = null;
    try { target = localStorage.getItem('lc-return-to'); localStorage.removeItem('lc-return-to'); } catch (_) {}
    if (!target || !target.startsWith('/') || target.startsWith('//')) return;
    if (new URL(target, location.origin).origin !== location.origin) return;
    const targetPath = target.split('?')[0].split('#')[0];
    // Only redirect if we actually landed somewhere else (avoid loops / no-ops).
    // `/` and `/index.html` are the same app page: a bounce between them after
    // the Site-URL callback would loop.
    if (targetPath && !sameAppPath(targetPath, location.pathname)) {
      location.replace(target);
    }
  }

  function clearGoogleAccountCache() {
    try { window.BrandContext?.clearCache?.(); } catch (_) {}
    try { localStorage.removeItem('lc-brand-context'); localStorage.removeItem('lc-credits'); } catch (_) {}
  }

  /** A Google session is the sign-in. The access token is the Supabase JWT. */
  function applySupabaseUser(session) {
    if (!session || !session.user) return;
    if (window.LifecycleAuth.user && window.LifecycleAuth.user.id !== session.user.id) clearGoogleAccountCache();
    window.LifecycleAuth.session = session;
    window.LifecycleAuth.user = session.user;
    applyAccessMode(session.user);
    setBackendState('signed-in', { supabase: 'reachable' });
    removeLoginWall();
    removeSigningInOverlay();
    const bar = document.getElementById('lc-authnotice');
    if (bar) bar.remove();
    setRailUser(session.user);
  }
  /** The Google session's access token, '' when there is none or it has run out. */
  function sessionApiToken() {
    const s = window.LifecycleAuth && window.LifecycleAuth.session;
    if (!(s && s.access_token)) return '';
    return s.expires_at && s.expires_at * 1000 <= Date.now() ? '' : s.access_token;
  }

  async function init() {
    window.__startGoogleSignIn__ = startGoogleSignIn;
    window.LifecycleAuth = {
      client: null,
      session: null,
      user: null,
      internal: false,
      mockMode: false,
      // See "Backend state" above. `backend` is the current decision and
      // `backendState()` resolves on the first one, whichever it is.
      backend: backendSnapshot('pending'),
      backendState: () => backendFirst,
      ready: () => authReady.promise,
      // Google is the only sign-in (2026-10-10).
      openSignIn: () => beginGoogleSignIn(document.getElementById('lifecycle-nav')),
      googleSignInOptions,
      restoreReturnTo,
      // Why an action that needs the server cannot run right now, or null.
      // See serverActions(): pages ask BEFORE sending, and throw the answer.
      serverActionRefusal: (what, opts) => (window.LifecycleStatus ? window.LifecycleStatus.refusal(what, opts) : null),
      apiToken: sessionApiToken,
      signOut: async () => {
        try {
          if (window.LifecycleAuth.client && window.LifecycleAuth.client.auth) await window.LifecycleAuth.client.auth.signOut();
        } catch (_) { /* the session is dropped from this browser either way */ }
        window.LifecycleAuth.session = null;
        window.LifecycleAuth.user = null;
        // Drop this account's cached brand. A browser is often shared, and the
        // brand payload carries voice rules, regions and store URLs, so it must
        // not survive into the next person's session.
        clearGoogleAccountCache();
        applyAccessMode(null);
        location.reload();
      },
    };

    // THE RAIL FIRST, BEFORE ANY NETWORK. Every await below this line can take
    // seconds (the config fetch, the SDK, the session lookup), and none of them
    // changes what the rail lists. Only the user block at its foot depends on
    // the session, and setRailUser() swaps that in when the session is known.
    injectTopbar(null);

    const config = await getConfig();
    if (!config) {
      authReady.settle();   // no config means no SDK to wait for
      const isLocal = location.protocol === 'file:' ||
        /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname);
      // No Supabase configured. On localhost / file:// (dev preview) the
      // "Local preview" stub keeps the pages that read a user working.
      if (isLocal && !phoneEndedNote) {
        setRailUser({ email: 'local@preview', user_metadata: { name: 'Local preview' } });
        setBackendState('local');
        return;
      }
      if (isOpenPage() && !phoneEndedNote) { injectTopbar(null); setBackendState('unconfigured'); return; }
      // NO WORKSPACE DATABASE AT ALL. The app runs on whatever local state it
      // has, and SAYS so. Google sign-in needs that database, so the notice
      // names the missing values and the pages stay open.
      injectTopbar(null);
      clearSignInNote();
      injectSignedOutNotice('unconfigured', { force: !!phoneEndedNote });
      setBackendState('unconfigured');
      phoneEndedRailNote(document.getElementById('lifecycle-nav'));
      return;
    }

    // The client holds the Google session. persistSession reads it back on
    // the next page; detectSessionInUrl exchanges the OAuth code (PKCE).
    const sdk = await loadSupabaseSDK();
    const client = sdk.createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
    window.LifecycleAuth.client = client;
    const reachable = await authHostReachable(config.url);
    if (client.auth && typeof client.auth.onAuthStateChange === 'function') {
      client.auth.onAuthStateChange((_event, sess) => {
        if (sess && sess.user) {
          applySupabaseUser(sess);
          restoreReturnTo();
          return;
        }
        if (window.LifecycleAuth.user) {
          clearGoogleAccountCache();
          window.LifecycleAuth.session = null;
          window.LifecycleAuth.user = null;
          applyAccessMode(null);
          setRailUser(null);
          void gateSignedOut();
        }
      });
    }
    // A host that does not answer cannot hand back or renew a session, and
    // asking supabase-js for one makes it retry the refresh for ~25 s first
    // (measured 2026-09-15). Signed out, said, and the rail is already up.
    if (reachable) {
      if (oauthCallbackInProgress()) injectSigningInOverlay();
      let googleSession = null;
      try {
        if (client.auth && typeof client.auth.getSession === 'function') {
          const got = await client.auth.getSession();
          googleSession = got && got.data && got.data.session;
        }
      } catch (_) { googleSession = null; }
      if (googleSession && googleSession.user) {
        applySupabaseUser(googleSession);
        authReady.settle();
        restoreReturnTo();
        return;
      }
      removeSigningInOverlay();
    }
    authReady.settle();
    // Signed out. EVERY page is open - there is no gated set.
    await gateSignedOut();
    // AFTER gateSignedOut(), which clears any note written against an earlier
    // state: this one describes the state just decided.
    phoneEndedRailNote(document.getElementById('lifecycle-nav'));
  }

  // init() is async and was invoked with NO catch, so any rejection — most
  // realistically the supabase-js CDN being blocked by an ad blocker or a
  // network policy — became an unhandled promise rejection and the page
  // rendered NOTHING: no nav, no notice, no reason. A blank page is the least
  // actionable failure there is, and it is the one state that makes "every page
  // is usable signed out" untrue.
  //
  // So the app opens here too. A CDN that would not serve supabase-js is a
  // reason sign-in cannot RUN; it is not a reason to withhold every page from
  // someone who is allowed to read them anyway.
  function boot() {
    Promise.resolve()
      .then(init)
      .catch((e) => {
        try {
          injectTopbar(null);
          const isLocal = location.protocol === 'file:'
            || /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname);
          if (isLocal) { if (backendPending()) setBackendState('local'); return; }
          // Name what failed. Only the SDK load and the client construction can
          // reject here, and both leave sign-in impossible for the same reason.
          const kind = /supabase-js|createClient/i.test(String(e && e.message)) ? 'sdk' : 'unreachable';
          injectSignedOutNotice(kind);
          // A decision already published (a session was found, then something
          // later in init threw) stands; this only fills in a missing one.
          if (backendPending()) setBackendState(kind);
        } catch (_) { /* nothing left to render into */ }
      })
      // Whatever init() did or failed to do, the state is now as known as it
      // will get: release any Sign-in press that was waiting to diagnose it.
      .finally(() => authReady.settle());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

// ── A markdown document opens at a REAL address (2026-10-05) ────────────────
// This block used to intercept every <a href="*.md">, fetch the file and write
// it into an about:blank window styled with tenant zero's fonts and hexes. The
// Brand Knowledge Base box linked tenant zero's own knowledge files that way,
// so every other brand was shown another company's documents, in another
// company's colours, at an address that could not be bookmarked or shared.
//
// Now nothing here writes a document. A link is RETARGETED, never replaced
// by a window: a brand knowledge file lands on its route (/kb/brand/<doc>,
// which renders the ACTIVE brand's document from its own record), a platform
// document under /docs/ lands on the viewer (/doc?md=<path>), and anything
// else is left to the browser as the real file it is. The viewer prints to
// PDF from that address with print CSS. window.__mdToPdf(text, title) - for
// markdown a page GENERATED (the social blog export) - keeps it in this
// browser under its own key and opens /doc?local=<key>: still a real address,
// rendered in the active brand's tokens, and refused for a different brand.
(function () {
  'use strict';
  var LOCAL_PREFIX = 'lifecycle.doc.local.';
  var KEEP = 12;
  // knowledge/brand/<file> -> its document route. The same table as
  // brand-knowledge.js ZERO_FILES (a test holds the two to each other); kept
  // here because this runs on every page and that file loads on one.
  var KB_ROUTES = {
    '00-index.md': '', '01-brand-foundation.md': 'foundation', '02-product-catalog.md': 'catalog',
    '03-lifecycle-cohorts.md': 'cohorts', '04-offers-and-mechanics.md': 'offers',
    '05-landing-pages-and-creative.md': 'creative', '06-market-intelligence-summary.md': 'market',
  };
  /**
   * A blocked pop-up is a BROWSER state, not a fault in the document, and it
   * is said beside the control that asked for it - never as a native alert(),
   * the one dialog that carries the site's hostname as its title and so reads
   * as an error in the site. `anchor` is the link or button that was pressed;
   * without one the element that holds focus (the button, after a click) is
   * used, and failing that the note stands at the top of the page.
   */
  function popupBlockedNote(anchor) {
    var el = anchor && anchor.nodeType === 1 ? anchor : null;
    if (!el) {
      var a = document.activeElement;
      if (a && a !== document.body && /^(A|BUTTON)$/.test(a.tagName || '')) el = a;
    }
    var old = document.getElementById('lc-popup-blocked');
    if (old) old.remove();
    var note = document.createElement('div');
    note.id = 'lc-popup-blocked';
    note.innerHTML = window.LifecycleFailure.html(
      new Error('The browser blocked the pop-up this document opens in. Allow pop-ups for this site, then try again.'),
      { title: 'Pop-up blocked' });
    if (el && el.parentNode) {
      note.style.margin = '8px 0';
      el.insertAdjacentElement('afterend', note);
    } else {
      note.style.cssText = 'position:sticky;top:0;z-index:120;padding:10px 16px;background:var(--vh-panel-2)';
      var root = document.body || document.documentElement;
      root.insertBefore(note, root.firstChild);
    }
    return note;
  }
  /** Where a markdown link should land, or '' to leave it as the file it is. */
  function viewerFor(href) {
    var raw = String(href || '');
    var u;
    try { u = new URL(raw, location.href); } catch (_) { return ''; }
    if (u.origin !== location.origin || !/\.md$/i.test(u.pathname)) return '';
    var file = u.pathname.split('/').pop();
    if (/^\/knowledge\/brand\//.test(u.pathname)) {
      // A brand knowledge file is never shown by path: the route renders the
      // ACTIVE brand's document, and tenant zero's file only to tenant zero.
      // An unlisted one lands on the index rather than on another brand's file.
      var id = Object.prototype.hasOwnProperty.call(KB_ROUTES, file) ? KB_ROUTES[file] : '';
      return '/kb/brand' + (id ? '/' + id : '');
    }
    if (/^\/docs\/[A-Za-z0-9._/-]+\.md$/.test(u.pathname) && u.pathname.indexOf('..') < 0) return '/doc?md=' + encodeURIComponent(u.pathname);
    return '';
  }
  function brandNow() {
    try {
      var b = window.BrandContext && window.BrandContext.brand;
      return { id: (b && b.id) || '', name: (b && b.name) || '' };
    } catch (_) { return { id: '', name: '' }; }
  }
  /** Keep a generated document in this browser; returns its key, or ''. */
  function keepLocal(md, title) {
    try {
      var key = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      var b = brandNow();
      localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify({
        v: 1, title: String(title || '').slice(0, 160), md: String(md || ''),
        brand_id: b.id, brand_name: b.name, created_at: new Date().toISOString(),
      }));
      // Only the most recent few are kept: a generated document lives in this
      // browser, and storage is not an archive.
      var mine = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(LOCAL_PREFIX) === 0) mine.push(k);
      }
      mine.sort();
      while (mine.length > KEEP) localStorage.removeItem(mine.shift());
      return key;
    } catch (_) { return ''; }
  }
  function downloadMarkdown(md, title) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([String(md || '')], { type: 'text/markdown' }));
    a.download = (String(title || 'document').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'document') + '.md';
    document.body.appendChild(a); a.click(); a.remove();
  }
  window.__mdToPdf = function (mdText, title, anchor) {
    var key = keepLocal(mdText, title);
    // A browser that refused to keep it still gets the document, as the file.
    if (!key) { downloadMarkdown(mdText, title); return; }
    var w = window.open('/doc?local=' + key, '_blank');
    if (!w) popupBlockedNote(anchor);
  };
  function retarget(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var dest = viewerFor(a.getAttribute('href'));
    // The browser follows the link as usual - same tab, new tab, whatever the
    // person chose - to an address that renders the document.
    if (dest) a.setAttribute('href', dest);
  }
  document.addEventListener('click', retarget, true);
  document.addEventListener('auxclick', retarget, true);
  window.__docViewerFor = viewerFor;
})();
