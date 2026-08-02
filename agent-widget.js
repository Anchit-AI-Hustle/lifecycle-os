/* eslint-env browser */
/**
 * Knickgasm Agent — embeddable widget (Shopify-ready).
 *
 * Drop ONE line into any Shopify theme (theme.liquid, product template, or a
 * collection template) to add a floating voice+chat concierge:
 *
 *   <script src="https://knickgasm.vercel.app/agent-widget.js"
 *           data-agent="agent_knickgasm" defer></script>
 *
 * Per-collection / per-product agents: set data-agent to any agent id from
 * /api/brain?action=agents (e.g. agent_airbrush_coffee, agent_chai_collection),
 * or omit it and pass data-collection="Kicks" to auto-route.
 * Voice replies use ElevenLabs when configured server-side, else browser TTS.
 *
 * UI model (matches the portfolio assistant):
 *   - A floating icon (FAB) sits on every page. Tapping it expands the chat.
 *   - The chat header has Maximise (enlarge the panel) and Minimise (back to FAB).
 *   - The composer carries the controls inline: a "Chat / Narrate" mode chip and
 *     a Text / Voice / Call reply selector, plus mic and send.
 *   - Narrate reads the page's prose as flowing full sentences (never UI chrome
 *     fragments), and every chat reply is spoken as one complete utterance.
 */
(function () {
  'use strict';
  if (window.__KnickgasmAgentWidget) return;
  window.__KnickgasmAgentWidget = true;

  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var ORIGIN = (script.src && script.src.indexOf('http') === 0) ? script.src.split('/').slice(0, 3).join('/') : '';
  var API = ORIGIN + '/api/brain';
  var AGENT = script.getAttribute('data-agent') || '';
  var COLLECTION = script.getAttribute('data-collection') || '';
  var sessionId = null, history = [], agent = null, open = false;
  var replyMode = 'voice';   // 'text' | 'voice' | 'call' — how answers come back

  var css = '#vah-agent-fab{position:fixed;right:22px;bottom:22px;z-index:99990;width:62px;height:62px;border-radius:50%;background:#6A33D8;color:#F7F5F2;border:2px solid #D0473E;box-shadow:0 12px 34px rgba(0,0,0,.3);cursor:pointer;font-size:26px;display:flex;align-items:center;justify-content:center;transition:transform .2s}' +
    '#vah-agent-fab:hover{transform:scale(1.07)}' +
    '#vah-agent-fab::after{content:"";position:absolute;top:10px;right:10px;width:11px;height:11px;border-radius:50%;background:#3ddc84;border:2px solid #6A33D8}' +
    '#vah-agent-fab .vah-pulse{position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 0 rgba(171,135,67,.5);animation:vahPulse 2.6s ease-out infinite;pointer-events:none}' +
    '@keyframes vahPulse{0%{box-shadow:0 0 0 0 rgba(171,135,67,.45)}70%{box-shadow:0 0 0 16px rgba(171,135,67,0)}100%{box-shadow:0 0 0 0 rgba(171,135,67,0)}}' +
    '#vah-agent-panel{position:fixed;right:22px;bottom:96px;z-index:99991;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 130px));background:#F7F5F2;border:1px solid #D0473E;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden;font-family:"Instrument Sans","Helvetica Neue",Arial,sans-serif;transition:width .26s ease,height .26s ease}' +
    '#vah-agent-panel.open{display:flex}' +
    '#vah-agent-panel.max{width:min(560px,calc(100vw - 32px));height:min(760px,calc(100vh - 120px))}' +
    '#vah-agent-head{background:#6A33D8;color:#F7F5F2;padding:14px 16px;display:flex;align-items:center;gap:10px}' +
    '#vah-agent-head .vah-id{flex:1;min-width:0}' +
    '#vah-agent-head b{font-family:"Montserrat",Georgia,serif;font-size:15px;letter-spacing:.04em}' +
    '#vah-agent-head small{display:block;color:#D0473E;font-size:10.5px;letter-spacing:.08em}' +
    '#vah-agent-head .vah-win{appearance:none;background:rgba(251,245,234,.1);border:1px solid rgba(251,245,234,.25);color:#F7F5F2;width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:15px;line-height:1;display:inline-flex;align-items:center;justify-content:center}' +
    '#vah-agent-head .vah-win:hover{background:rgba(251,245,234,.2)}' +
    '#vah-agent-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}' +
    '.vah-m{max-width:82%;padding:10px 13px;border-radius:13px;font-size:13.5px;line-height:1.55;white-space:pre-wrap}' +
    '.vah-m.u{align-self:flex-end;background:#6A33D8;color:#F7F5F2;border-bottom-right-radius:3px}' +
    '.vah-m.a{align-self:flex-start;background:#fff;border:1px solid rgba(171,135,67,.35);color:#111111;border-bottom-left-radius:3px}' +
    '.vah-m.a a{color:#6A33D8;font-weight:600}' +
    '#vah-agent-input{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:9px 10px;background:#fff;border-top:1px solid rgba(171,135,67,.3)}' +
    '#vah-agent-input input{flex:1;min-width:120px;border:1px solid rgba(171,135,67,.4);border-radius:10px;padding:10px 12px;font-size:13.5px;outline:none;font-family:inherit}' +
    '#vah-agent-input button{border:none;border-radius:10px;cursor:pointer;font-family:inherit}' +
    '.vah-mode{position:relative}' +
    '.vah-mode-btn{display:inline-flex;align-items:center;gap:5px;background:rgba(0,74,43,.08);border:1px solid rgba(0,74,43,.2)!important;color:#6A33D8;font-weight:600;font-size:12px;border-radius:99px;padding:8px 11px}' +
    '.vah-menu{position:absolute;bottom:calc(100% + 6px);left:0;width:210px;background:#fff;border:1px solid rgba(171,135,67,.5);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.25);padding:6px;display:none;z-index:5}' +
    '.vah-menu.open{display:block}' +
    '.vah-menu button{display:flex;width:100%;text-align:left;gap:4px;flex-direction:column;background:transparent;border:0!important;border-radius:9px;padding:9px 10px;color:#111111}' +
    '.vah-menu button:hover{background:#F7F5F2}' +
    '.vah-menu b{font-size:13px;color:#6A33D8}.vah-menu em{font-style:normal;font-size:11px;color:#7a7568}' +
    '.vah-reply{display:inline-flex;gap:2px;background:#F7F5F2;border:1px solid rgba(171,135,67,.4);border-radius:99px;padding:3px}' +
    '.vah-reply button{width:30px;height:28px;border-radius:99px!important;background:transparent;color:#7a7568;font-size:13px;display:inline-flex;align-items:center;justify-content:center}' +
    '.vah-reply button.on{background:rgba(0,74,43,.12);color:#6A33D8;font-weight:700}' +
    '.vah-reply button.on[data-reply="call"]{background:rgba(61,220,132,.18);color:#1b7a44}' +
    '#vah-mic{background:#F7F5F2;border:1px solid #D0473E!important;color:#6A33D8;padding:0 12px;height:38px}' +
    '#vah-mic.on{background:#c0392b;color:#fff}' +
    '#vah-send{background:#6A33D8;color:#F7F5F2;padding:0 14px;height:38px;font-weight:700}';

  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  var fab = document.createElement('button'); fab.id = 'vah-agent-fab'; fab.title = 'Talk to a Knickgasm expert'; fab.innerHTML = '<span class="vah-pulse"></span>🎙';
  var panel = document.createElement('div'); panel.id = 'vah-agent-panel';
  panel.innerHTML = '<div id="vah-agent-head"><span style="font-size:20px">🍃</span><div class="vah-id"><b id="vah-agent-name">Knickgasm Expert</b><small>voice &amp; chat · honest answers</small></div>' +
      '<button class="vah-win" id="vah-max" title="Maximise the chat" aria-label="Maximise">⤢</button>' +
      '<button class="vah-win" id="vah-min" title="Minimise to the floating button" aria-label="Minimise">—</button></div>' +
    '<div id="vah-agent-msgs"></div>' +
    '<div id="vah-agent-input">' +
      '<div class="vah-mode"><button id="vah-mode-btn" class="vah-mode-btn" type="button" aria-haspopup="true" aria-expanded="false">💬 Chat ▾</button>' +
        '<div class="vah-menu" id="vah-menu">' +
          '<button type="button" data-mode="chat"><b>💬 Chat</b><em>Type &amp; read answers</em></button>' +
          '<button type="button" data-mode="narrate"><b>🔊 Narrate</b><em>Listen to this page</em></button>' +
        '</div></div>' +
      '<input id="vah-q" placeholder="Ask about benefits, crafting, value…">' +
      '<div class="vah-reply" role="group" aria-label="How replies come back">' +
        '<button type="button" data-reply="text" title="Text only — silent answers">Aa</button>' +
        '<button type="button" data-reply="voice" class="on" title="Voice reply — answers read aloud">🔊</button>' +
        '<button type="button" data-reply="call" title="Call — hands-free voice conversation">📞</button>' +
      '</div>' +
      '<button id="vah-mic" title="Speak">🎙</button><button id="vah-send" title="Send">→</button></div>';
  document.body.appendChild(fab); document.body.appendChild(panel);

  var msgs = panel.querySelector('#vah-agent-msgs');
  function add(cls, text) {
    var d = document.createElement('div'); d.className = 'vah-m ' + cls;
    d.innerHTML = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/(https?:\/\/[^\s)]+)/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">view product</a>'; });
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d;
  }

  // Default to a female English voice for the browser-TTS fallback.
  // (Server ElevenLabs voice is female-configured separately.)
  var femaleVoice = null;
  function pickFemaleVoice() {
    if (!('speechSynthesis' in window)) return null;
    var voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    var prefer = ['google uk english female', 'microsoft sonia', 'microsoft libby', 'microsoft hazel',
      'microsoft aria', 'samantha', 'serena', 'kate', 'martha', 'stephanie', 'fiona', 'tessa',
      'karen', 'moira', 'victoria', 'female'];
    var en = voices.filter(function (v) { return /^en[-_]?/i.test(v.lang); });
    var pool = en.length ? en : voices;
    function byPref(list) {
      for (var i = 0; i < prefer.length; i++) {
        var hit = list.find(function (v) { return v.name.toLowerCase().indexOf(prefer[i]) > -1; });
        if (hit) return hit;
      }
      return null;
    }
    var gb = pool.filter(function (v) { return /en[-_]?gb/i.test(v.lang); });
    var inn = pool.filter(function (v) { return /en[-_]?in/i.test(v.lang); });
    return byPref(gb) || byPref(inn) || byPref(pool) || gb[0] || inn[0] || pool[0] || null;
  }
  if ('speechSynthesis' in window) {
    femaleVoice = pickFemaleVoice();
    window.speechSynthesis.onvoiceschanged = function () { femaleVoice = pickFemaleVoice(); };
  }

  // Speak one block of text as a SINGLE utterance so it reads as flowing,
  // complete sentences — never word-by-word or fragment-by-fragment. onDone
  // fires once the speech finishes (used by Call mode to re-open the mic).
  function speak(text, onDone) {
    var clean = String(text || '')
      .replace(/https?:\/\/\S+/g, 'the product page')
      .replace(/```[a-zA-Z0-9]*\n?/g, ' ').replace(/```/g, ' ').replace(/`/g, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')                 // [label](url) -> label
      .replace(/^[ \t]{0,3}#{1,6}\s*/gm, '')                     // headings
      .replace(/^\s*([-*+•]|\d+[.)])\s+/gm, '')                  // list markers
      .replace(/[*_#~]/g, '')                                    // stray emphasis chars
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F0FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}♀♂⚖❤]+/gu, ' ');
    // Turn line breaks into sentence stops so lists don't read as run-ons.
    clean = clean.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean)
      .map(function (l) { return /[.!?:;,…]$/.test(l) ? l : (l + '.'); })
      .join(' ').replace(/\s+([.,!?;:])/g, '$1').replace(/\s+/g, ' ').trim();
    if (!clean) { if (onDone) onDone(); return; }
    var spoken = clean.replace(/KNICKGASM/g, 'Knickgasm').replace(/KSM-?66/gi, 'K S M sixty-six');
    fetch(API + '?action=tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: clean }) })
      .then(function (r) { if (r.ok && (r.headers.get('content-type') || '').indexOf('audio') > -1) return r.blob(); throw 0; })
      .then(function (b) { var a = new Audio(URL.createObjectURL(b)); a.onended = function () { if (onDone) onDone(); }; a.onerror = function () { if (onDone) onDone(); }; a.play(); })
      .catch(function () {
        if ('speechSynthesis' in window) {
          var u = new SpeechSynthesisUtterance(spoken);
          u.lang = 'en-GB';
          var fv = femaleVoice || pickFemaleVoice();
          if (fv) { u.voice = fv; u.lang = fv.lang; }
          u.pitch = 1.05; u.rate = 0.98;
          u.onend = function () { if (onDone) onDone(); };
          u.onerror = function () { if (onDone) onDone(); };
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
        } else if (onDone) { onDone(); }
      });
  }

  // Server TTS (/api/brain?action=tts) caps a single request at ~2400 chars, so
  // a long page narration must be split or only its opening would be spoken.
  // Break text into <=1800-char chunks on sentence boundaries and speak them
  // back-to-back so the whole page is read aloud.
  function chunkForSpeech(text, max) {
    max = max || 1800;
    var sentences = String(text || '').match(/[^.!?]+[.!?]+(?:\s|$)|\S[^.!?]*$/g) || [];
    var out = [], buf = '';
    for (var i = 0; i < sentences.length; i++) {
      var s = sentences[i].trim();
      if (!s) continue;
      if (buf && (buf.length + 1 + s.length) > max) { out.push(buf); buf = s; }
      else { buf = buf ? buf + ' ' + s : s; }
    }
    if (buf) out.push(buf);
    if (out.length) return out;
    return text ? [String(text).slice(0, max)] : [];
  }
  function speakSequence(chunks, onDone) {
    var i = 0;
    (function next() {
      if (i >= chunks.length) { if (onDone) onDone(); return; }
      speak(chunks[i++], next);
    })();
  }

  // Read the page's actual prose as flowing sentences. We collect only
  // sentence-bearing copy (headings + paragraphs + list items) and skip UI
  // chrome — buttons, nav, badges, price chips — then give each clause a full
  // stop and join with spaces, so the voice never reads broken fragments.
  function buildPageNarration() {
    var parts = [], seen = {};
    var nodes = document.querySelectorAll('main h1, main h2, main h3, main p, main li, article h1, article h2, article h3, article p, article li, body h1, body h2, body p');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.closest('#vah-agent-panel, #vah-agent-fab, nav, header nav, footer, script, style, button, [aria-hidden="true"]')) continue;
      var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length < 18 || seen[t]) continue;          // 18+ chars ⇒ a sentence, not a label
      seen[t] = 1;
      if (!/[.!?:;]$/.test(t)) t += '.';
      parts.push(t);
      if (parts.length >= 40) break;                          // cap absurdly long pages
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  function narratePage() {
    var text = buildPageNarration();
    if (!text) { add('a', 'There is nothing on this page for me to read aloud yet.'); return; }
    add('a', 'Reading this page aloud for you…');
    speakSequence(chunkForSpeech(text));
  }

  function ask(text) {
    if (!text) return;
    add('u', text); history.push({ role: 'user', content: text });
    fetch(API + '?action=agent-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agent ? agent.id : (AGENT || 'agent_knickgasm'), session_id: sessionId, message: text, history: history.slice(-10), context: { page: location.href, shopify: true } }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) { add('a', 'Sorry — try once more?'); return; }
      sessionId = j.session_id; history.push({ role: 'agent', content: j.reply });
      add('a', j.reply);
      // Reply mode governs voice: 'text' stays silent, 'voice'/'call' read the
      // full answer aloud, and 'call' re-opens the mic for hands-free chat.
      if (replyMode !== 'text') {
        speakSequence(chunkForSpeech(j.speak || j.reply), function () {
          // Re-check the live state when speech ends — the visitor may have left
          // Call mode or minimised the panel while the answer was being spoken,
          // so only resume hands-free listening if they're still in it.
          if (replyMode === 'call' && open) setTimeout(startMic, 450);
        });
      }
    }).catch(function () { add('a', 'Connection hiccup — try again in a moment.'); });
  }

  var input = panel.querySelector('#vah-q');
  panel.querySelector('#vah-send').onclick = function () { var t = input.value.trim(); input.value = ''; ask(t); };
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var t = input.value.trim(); input.value = ''; ask(t); } });

  // ----- Mode chip: Chat <-> Narrate (Narrate is a one-shot action) -----
  var modeBtn = panel.querySelector('#vah-mode-btn');
  var menu = panel.querySelector('#vah-menu');
  modeBtn.onclick = function (e) { e.stopPropagation(); var o = !menu.classList.contains('open'); menu.classList.toggle('open', o); modeBtn.setAttribute('aria-expanded', o ? 'true' : 'false'); };
  document.addEventListener('click', function (e) { if (!e.target.closest('.vah-mode')) { menu.classList.remove('open'); modeBtn.setAttribute('aria-expanded', 'false'); } });
  menu.querySelectorAll('button[data-mode]').forEach(function (b) {
    b.onclick = function () {
      menu.classList.remove('open'); modeBtn.setAttribute('aria-expanded', 'false');
      if (b.getAttribute('data-mode') === 'narrate') {
        modeBtn.innerHTML = '🔊 Narrate ▾'; narratePage();
        setTimeout(function () { modeBtn.innerHTML = '💬 Chat ▾'; }, 1000);
      } else { input.focus(); }
    };
  });

  // ----- Reply mode: text | voice | call -----
  var replyBtns = panel.querySelectorAll('.vah-reply button[data-reply]');
  function setReply(mode) {
    replyMode = mode;
    replyBtns.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-reply') === mode); });
  }
  replyBtns.forEach(function (b) {
    b.onclick = function () {
      setReply(b.getAttribute('data-reply'));
      if (b.getAttribute('data-reply') === 'call') setTimeout(startMic, 140);
    };
  });

  // ----- Mic -----
  var micBtn = panel.querySelector('#vah-mic');
  function startMic() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { add('a', 'Voice input needs Chrome/Edge — text works everywhere!'); return; }
    var rec = new SR(); rec.lang = 'en-IN'; micBtn.classList.add('on');
    rec.onresult = function (e) { ask(e.results[0][0].transcript); };
    rec.onend = function () { micBtn.classList.remove('on'); };
    rec.onerror = function () { micBtn.classList.remove('on'); };
    try { rec.start(); } catch (err) { micBtn.classList.remove('on'); }
  }
  micBtn.onclick = startMic;

  // ----- Window controls: maximise / minimise -----
  panel.querySelector('#vah-max').onclick = function (e) { e.stopPropagation(); panel.classList.toggle('max'); };
  panel.querySelector('#vah-min').onclick = function (e) { e.stopPropagation(); open = false; panel.classList.remove('open'); };

  function openPanel() {
    open = true; panel.classList.add('open');
    if (!agent) {
      fetch(API + '?action=agents').then(function (r) { return r.json(); }).then(function (j) {
        var list = j.agents || [];
        agent = list.find(function (a) { return a.id === AGENT; }) ||
          (COLLECTION && list.find(function (a) { return (a.catalog_scope && (a.catalog_scope.categories || []).indexOf(COLLECTION) > -1); })) ||
          list[0] || { id: 'agent_knickgasm', name: 'Knickgasm', greeting: 'Namaste! Ask me anything about our sneakers.' };
        panel.querySelector('#vah-agent-name').textContent = agent.name;
        add('a', agent.greeting || 'Namaste! How can I help?');
      }).catch(function () { agent = { id: 'agent_knickgasm', name: 'Knickgasm' }; add('a', 'Namaste! Ask me anything about our sneakers.'); });
    }
  }
  fab.onclick = function () { if (open) { open = false; panel.classList.remove('open'); } else { openPanel(); } };

  // Public integration contract for landing pages. A link to #agent must open
  // the real concierge rather than merely scrolling to a decorative preview.
  function openFromPage(message) {
    openPanel();
    window.requestAnimationFrame(function () {
      if (message) input.value = String(message);
      input.focus();
    });
  }
  window.KnickgasmAgent = { open: openFromPage, ask: function (message) { openFromPage(); ask(String(message || '').trim()); } };
  window.addEventListener('knickgasm-agent:open', function (event) {
    openFromPage(event.detail && event.detail.message);
  });
  window.addEventListener('hashchange', function () {
    if (window.location.hash === '#agent') openFromPage();
  });
  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[href="#agent"]');
    // A repeated click on the current hash does not fire hashchange.
    if (link && window.location.hash === '#agent') openFromPage();
  });
  if (window.location.hash === '#agent') openFromPage();
})();
