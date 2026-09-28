/*!
 * ui/storage.js —— localStorage 持久化（历史 / 草稿 / 主题 / 收藏）
 * 依赖：无（不可用时自动降级为内存存储）。挂载到 window.JTUI.storage
 */
(function () {
  'use strict';
  var JT = (window.JTUI = window.JTUI || {});
  var PREFIX = 'jt.';
  var HISTORY_MAX = 50;
  var mem = {};

  var available = (function () {
    try {
      var k = '__jt_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  function getRaw(k) {
    try { return available ? window.localStorage.getItem(PREFIX + k) : (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null); }
    catch (e) { return null; }
  }
  function setRaw(k, v) {
    try { if (available) window.localStorage.setItem(PREFIX + k, v); else mem[k] = v; }
    catch (e) { mem[k] = v; }
  }
  function delRaw(k) {
    try { if (available) window.localStorage.removeItem(PREFIX + k); else delete mem[k]; }
    catch (e) { delete mem[k]; }
  }
  function get(key, dflt) {
    var v = getRaw(key);
    if (v === null || v === undefined) return dflt;
    try { return JSON.parse(v); } catch (e) { return dflt; }
  }
  function set(key, value) {
    try { setRaw(key, JSON.stringify(value)); } catch (e) { /* 忽略 */ }
  }

  /* ---------- 草稿 ---------- */

  function getDraftMap() { return get('drafts', {}) || {}; }
  function getDraft(toolId) { var m = getDraftMap(); return m[toolId] === undefined ? null : m[toolId]; }
  function setDraft(toolId, text) {
    if (!toolId) return;
    var m = getDraftMap();
    if (text === null || text === undefined || text === '') delete m[toolId];
    else m[toolId] = String(text);
    set('drafts', m);
  }
  function clearDrafts() { delRaw('drafts'); }

  /* ---------- 历史记录 ---------- */

  function getHistory() { var h = get('history', []); return Array.isArray(h) ? h : []; }
  function addHistory(entry) {
    if (!entry) return;
    var h = getHistory();
    h.unshift({
      id: String(Date.now()) + '-' + Math.floor(Math.random() * 1e4),
      time: Date.now(),
      toolId: entry.toolId || '',
      toolName: entry.toolName || entry.toolId || '',
      inputSummary: String(entry.inputSummary || '').slice(0, 160),
      outputPreview: String(entry.outputPreview || '').slice(0, 200),
      params: entry.params || {},
      input: String(entry.input || '').slice(0, 20000)
    });
    if (h.length > HISTORY_MAX) h = h.slice(0, HISTORY_MAX);
    set('history', h);
  }
  function removeHistory(id) { set('history', getHistory().filter(function (e) { return e.id !== id; })); }
  function clearHistory() { delRaw('history'); }

  /* ---------- 主题 / 收藏 / 偏好 ---------- */

  function getTheme() { return get('theme', 'system'); }
  function setTheme(v) { set('theme', v); }

  function getFavorites() { var f = get('favorites', []); return Array.isArray(f) ? f : []; }
  function toggleFavorite(id) {
    var f = getFavorites();
    var i = f.indexOf(id);
    if (i >= 0) f.splice(i, 1); else f.push(id);
    set('favorites', f);
    return f;
  }
  function isFavorite(id) { return getFavorites().indexOf(id) >= 0; }

  function getPref(k, d) { var p = get('prefs', {}); return p[k] === undefined ? d : p[k]; }
  function setPref(k, v) { var p = get('prefs', {}); p[k] = v; set('prefs', p); }

  /** 首次运行标记 */
  function isFirstRun() { return get('firstRun', true); }
  function markNotFirstRun() { set('firstRun', false); }

  JT.storage = {
    available: available,
    get: get, set: set, del: delRaw,
    getDraft: getDraft, setDraft: setDraft, clearDrafts: clearDrafts,
    getHistory: getHistory, addHistory: addHistory, removeHistory: removeHistory, clearHistory: clearHistory,
    getTheme: getTheme, setTheme: setTheme,
    getFavorites: getFavorites, toggleFavorite: toggleFavorite, isFavorite: isFavorite,
    getPref: getPref, setPref: setPref,
    isFirstRun: isFirstRun, markNotFirstRun: markNotFirstRun
  };
})();
