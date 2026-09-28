/*!
 * ui/dom.js —— 轻量 DOM 工具（qs / qsa / el / on / esc）
 * 依赖：无。挂载到 window.JTUI.dom
 */
(function () {
  'use strict';
  var JT = (window.JTUI = window.JTUI || {});

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** HTML 转义，防止注入。 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function append(parent, child) {
    if (child === null || child === undefined || child === false || child === true) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(parent, c); }); return; }
    if (typeof Node !== 'undefined' && child instanceof Node) { parent.appendChild(child); return; }
    parent.appendChild(document.createTextNode(String(child)));
  }

  /**
   * 创建元素。attrs 支持：class / text / html / style(object) / dataset(object) /
   * on*(函数) / 其它属性；children 支持字符串、节点或数组。
   */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class' || k === 'className') { node.className = v; return; }
        if (k === 'text') { node.textContent = v; return; }
        if (k === 'html') { node.innerHTML = v; return; }
        if (k === 'style' && typeof v === 'object') { Object.keys(v).forEach(function (sk) { node.style[sk] = v[sk]; }); return; }
        if (k === 'dataset' && typeof v === 'object') { Object.keys(v).forEach(function (dk) { node.dataset[dk] = v[dk]; }); return; }
        if (k.indexOf('on') === 0 && typeof v === 'function') { node.addEventListener(k.slice(2).toLowerCase(), v); return; }
        node.setAttribute(k, v);
      });
    }
    if (children !== undefined) append(node, children);
    return node;
  }

  function frag(children) {
    var f = document.createDocumentFragment();
    append(f, children);
    return f;
  }

  function clear(node) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function on(target, evt, handler) {
    if (!target) return function () {};
    target.addEventListener(evt, handler);
    return function () { target.removeEventListener(evt, handler); };
  }

  /** 事件委托：在 root 上监听，命中 selector 时回调。 */
  function delegate(root, evt, selector, handler) {
    if (!root) return function () {};
    var fn = function (e) {
      var t = e.target;
      while (t && t !== root) {
        if (t.matches && t.matches(selector)) { handler.call(t, e, t); return; }
        t = t.parentNode;
      }
    };
    root.addEventListener(evt, fn);
    return function () { root.removeEventListener(evt, fn); };
  }

  function toggleClass(node, cls, force) {
    if (!node) return;
    if (force === undefined) node.classList.toggle(cls);
    else if (force) node.classList.add(cls);
    else node.classList.remove(cls);
  }

  JT.dom = {
    qs: qs, qsa: qsa, esc: esc, el: el, h: el, frag: frag,
    clear: clear, on: on, delegate: delegate, toggleClass: toggleClass, append: append
  };
})();
