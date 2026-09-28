/*!
 * ui/modal.js —— 弹窗（关于 / 快捷键 / 历史记录 / 示例库）+ 确认框
 * 依赖：dom.js（window.JTUI.dom）。挂载到 window.JTUI.modal
 */
(function () {
  'use strict';
  var JT = (window.JTUI = window.JTUI || {});

  var overlay = null;
  var onCloseHandlers = [];

  function close() {
    if (!overlay) return;
    var o = overlay;
    overlay = null;
    o.classList.remove('jt-modal-show');
    setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 160);
    var hs = onCloseHandlers.slice();
    onCloseHandlers = [];
    hs.forEach(function (fn) { try { fn(); } catch (e) { /* 忽略 */ } });
  }

  /**
   * 打开弹窗。
   * @param {{title:string, content:(Node|Node[]|string), footer:(Node|Node[]|null),
   *          size:'sm'|'md'|'lg'|'xl', onClose:Function, closable:boolean}} opts
   * @returns {{close:Function}}
   */
  function open(opts) {
    opts = opts || {};
    var dom = JT.dom;
    close();

    var ov = dom.el('div', { class: 'jt-modal-overlay', role: 'dialog', 'aria-modal': 'true' });
    var box = dom.el('div', { class: 'jt-modal jt-modal-' + (opts.size || 'md') });

    var head = dom.el('div', { class: 'jt-modal-head' });
    head.appendChild(dom.el('h3', { class: 'jt-modal-title', text: opts.title || '' }));
    var closeBtn = dom.el('button', {
      class: 'jt-icon-btn', type: 'button', 'aria-label': '关闭',
      html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
      onclick: close
    });
    head.appendChild(closeBtn);

    var body = dom.el('div', { class: 'jt-modal-body' });
    if (typeof opts.content === 'string') body.innerHTML = opts.content;
    else if (opts.content) dom.append(body, opts.content);

    box.appendChild(head);
    box.appendChild(body);
    if (opts.footer) {
      var foot = dom.el('div', { class: 'jt-modal-foot' });
      dom.append(foot, opts.footer);
      box.appendChild(foot);
    }
    ov.appendChild(box);

    ov.addEventListener('mousedown', function (e) { if (e.target === ov && opts.closable !== false) close(); });

    document.body.appendChild(ov);
    overlay = ov;
    requestAnimationFrame(function () { ov.classList.add('jt-modal-show'); });
    if (opts.onClose) onCloseHandlers.push(opts.onClose);

    // 焦点管理
    setTimeout(function () {
      var focusable = box.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable) focusable.focus();
    }, 40);

    return { close: close, overlay: ov, body: body, box: box };
  }

  /** 确认框（返回 Promise<boolean>）。 */
  function confirm(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var dom = JT.dom;
      var settled = false;
      function done(v) { if (settled) return; settled = true; m.close(); resolve(v); }
      var content = dom.el('p', { class: 'jt-modal-text', text: opts.message || '' });
      var footer = [
        dom.el('button', { class: 'jt-btn', type: 'button', text: opts.cancelText || '取消', onclick: function () { done(false); } }),
        dom.el('button', { class: 'jt-btn jt-btn-primary' + (opts.danger ? ' jt-btn-danger' : ''), type: 'button', text: opts.okText || '确定', onclick: function () { done(true); } })
      ];
      var m = open({ title: opts.title || '确认', content: content, footer: footer, size: 'sm', onClose: function () { if (!settled) { settled = true; resolve(false); } } });
    });
  }

  // 全局 Esc 关闭
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay) { e.preventDefault(); close(); }
  });

  JT.modal = { open: open, close: close, confirm: confirm, isOpen: function () { return !!overlay; } };
})();
