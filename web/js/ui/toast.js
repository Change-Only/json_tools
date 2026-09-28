/*!
 * ui/toast.js —— 轻提示（右下角堆叠，滑入滑出）
 * 依赖：无（自行创建容器）。挂载到 window.JTUI.toast
 */
(function () {
  'use strict';
  var JT = (window.JTUI = window.JTUI || {});
  var host = null;

  function ensureHost() {
    if (host && host.parentNode) return host;
    host = document.createElement('div');
    host.className = 'jt-toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
    return host;
  }

  var ICONS = {
    success: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>'
  };

  var MAX_TOASTS = 3;      // 屏幕上最多同时显示的条数
  var DEDUP_MS = 1500;      // 相同内容在该时间窗内只提示一次
  var recent = {};          // { 内容: 最近一次展示的时间戳 }

  function pruneRecent(now) {
    var keys = Object.keys(recent);
    if (keys.length <= 200) return;
    keys.forEach(function (k) { if (now - recent[k] > DEDUP_MS * 4) delete recent[k]; });
  }

  function show(message, type, duration) {
    try {
      var msg = String(message == null ? '' : message);
      var now = Date.now();
      if (recent[msg] && (now - recent[msg]) < DEDUP_MS) return; // 内容去重
      recent[msg] = now;
      pruneRecent(now);

      var h = ensureHost();
      // 数量上限：超出时移除最旧的一条，保证最新提示始终可见
      while (h.children.length >= MAX_TOASTS && h.firstChild) h.removeChild(h.firstChild);

      var t = document.createElement('div');
      t.className = 'jt-toast jt-toast-' + (type || 'info');
      var icon = document.createElement('span');
      icon.className = 'jt-toast-icon';
      icon.innerHTML = ICONS[type] || ICONS.info;
      var span = document.createElement('span');
      span.className = 'jt-toast-msg';
      span.textContent = msg;
      t.appendChild(icon);
      t.appendChild(span);
      h.appendChild(t);
      requestAnimationFrame(function () { t.classList.add('jt-toast-in'); });
      var life = duration || 2400;
      var timer = setTimeout(function () {
        t.classList.remove('jt-toast-in');
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 220);
      }, life);
      t.addEventListener('click', function () { clearTimeout(timer); if (t.parentNode) t.parentNode.removeChild(t); });
    } catch (e) { /* 容错：提示失败不影响主流程 */ }
  }

  JT.toast = {
    show: show,
    success: function (m, d) { show(m, 'success', d); },
    error: function (m, d) { show(m, 'error', d || 3600); },
    warn: function (m, d) { show(m, 'warn', d || 3000); },
    info: function (m, d) { show(m, 'info', d); }
  };
})();
