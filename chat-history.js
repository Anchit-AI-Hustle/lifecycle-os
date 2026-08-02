/* chat-history.js — shared per-assistant conversation store for KNICKGASM chat UIs
 * (KicksGPT /kicksgpt and Knickgasm Agent /agent). localStorage-backed, namespaced per
 * assistant. Saves every conversation, remembers the current one, and supports
 * new / switch / continue / rename / delete. Quota-safe (prunes oldest on overflow).
 *
 *   var CH = VHChat('kicksgpt');
 *   CH.append('user', text);  CH.append('agent', reply, { steps });
 *   CH.list();  CH.setCurrent(id);  CH.create();  CH.remove(id);  CH.last();
 * Each conversation: { id, title, created, updated, messages:[{role,text,at,...}] }.
 */
(function (global) {
  'use strict';
  function now() { return (new Date()).getTime(); }
  function uid() { return 'c' + now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function VHChat(namespace, opts) {
    opts = opts || {};
    var KEY = 'vhchat:' + namespace;
    var KEEP = opts.keep || 40; // max conversations retained

    function readAll() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } }
    var db = readAll(); if (!db.convos) db.convos = {}; if (!('current' in db)) db.current = null;

    function prune() {
      var ids = Object.keys(db.convos);
      if (ids.length <= KEEP) return;
      ids.sort(function (a, b) { return (db.convos[a].updated || 0) - (db.convos[b].updated || 0); });
      for (var i = 0; i < ids.length - KEEP; i++) delete db.convos[ids[i]];
    }
    function save() {
      prune();
      try { localStorage.setItem(KEY, JSON.stringify(db)); }
      catch (_) { // quota — drop oldest until it fits
        var ids = Object.keys(db.convos).sort(function (a, b) { return (db.convos[a].updated || 0) - (db.convos[b].updated || 0); });
        while (ids.length > 1) {
          delete db.convos[ids.shift()];
          try { localStorage.setItem(KEY, JSON.stringify(db)); return; } catch (__) {}
        }
      }
    }

    function list() {
      return Object.keys(db.convos).map(function (id) { return db.convos[id]; })
        .sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
    }
    function get(id) { return db.convos[id] || null; }
    function current() { return (db.current && db.convos[db.current]) ? db.convos[db.current] : null; }
    function create() {
      var id = uid();
      db.convos[id] = { id: id, title: 'New chat', created: now(), updated: now(), messages: [] };
      db.current = id; save(); return db.convos[id];
    }
    function ensure() { return current() || create(); }
    function setCurrent(id) { if (db.convos[id]) { db.current = id; save(); } return current(); }
    function append(role, text, extra) {
      var c = ensure();
      var m = { role: role, text: String(text == null ? '' : text), at: now() };
      if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) m[k] = extra[k];
      c.messages.push(m);
      if (role === 'user' && (!c.title || c.title === 'New chat')) c.title = m.text.slice(0, 52) || 'New chat';
      c.updated = now(); save(); return c;
    }
    function remove(id) { delete db.convos[id]; if (db.current === id) db.current = null; save(); }
    function rename(id, title) { if (db.convos[id]) { db.convos[id].title = String(title || '').slice(0, 80) || 'Untitled'; db.convos[id].updated = now(); save(); } }
    function last() { return list()[0] || null; }
    function currentId() { return db.current; }

    return { list: list, get: get, current: current, currentId: currentId, create: create,
      ensure: ensure, setCurrent: setCurrent, append: append, remove: remove, rename: rename, last: last };
  }

  global.VHChat = VHChat;
})(typeof window !== 'undefined' ? window : this);
