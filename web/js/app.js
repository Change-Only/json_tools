/*!
 * app.js —— 装配层：布局渲染 / 工具路由 / 事件绑定 / 快捷键 / 状态栏 / 弹窗 / 示例库
 * 依赖：JTCore（core/*.js）、JTUI（ui/*.js）、JT.registry（tools-registry.js）
 */
(function () {
  'use strict';
  var JT = (window.JT = window.JT || {});
  var D;

  // 把 UI 命名空间（window.JTUI）的组件别名到 app 命名空间，便于统一以 JT.dom / JT.storage 形式引用。
  (function aliasUI() {
    var UI = window.JTUI || {};
    ['dom', 'toast', 'storage', 'modal', 'editor', 'tree', 'split'].forEach(function (k) {
      if (UI[k]) JT[k] = UI[k];
    });
  })();

  /* ============================ 内联 SVG 图标（stroke 风格） ============================ */

  var ICONS = {
    wand: '<path d="M15 4V2M15 20v-2M8.5 9.5 3 4M21 4l-5.5 5.5M4 21l9.5-9.5"/><path d="M9 4h.01M4 9h.01"/>',
    compress: '<path d="M9 3v6H3M15 21v-6h6M3 15h6v6M21 9h-6V3"/>',
    quote: '<path d="M3 21c3 0 7-1 7-8V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h3M14 21c3 0 7-1 7-8V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
    broom: '<path d="M19 3l-8 8M14 8l-5 5M9 13l-6 6 2 .5L6 21l6-6M13 5l6 6"/>',
    sort: '<path d="M11 5h10M11 9h7M11 15h10M11 19h7M4 4v16M4 20l-2.5-2.5M4 20l2.5-2.5"/>',
    layers: '<path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
    template: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    rows: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    swap: '<path d="M7 16V4M7 4 3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    schema: '<path d="M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2M16 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    tree: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M12 12H6v4M12 12h6v4"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.5 12.5 6-6M16 7l2 2M14 9l2 2"/>',
    filter: '<path d="M3 4h18l-7 8v6l-4 2v-8z"/>',
    group: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    chart: '<path d="M3 21h18M6 21V10M11 21V4M16 21v-7M21 21V8"/>',
    merge: '<path d="M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v6M18 3v6a3 3 0 0 1-3 3H9a3 3 0 0 0-3 3v6"/>',
    patch: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    diff: '<path d="M12 3v18M5 7h4M5 7l1.5-1.5M5 7l1.5 1.5M15 17h4M19 17l-1.5-1.5M19 17l-1.5 1.5"/>',
    sample: '<path d="M6 3v12a3 3 0 0 0 3 3h12M18 3l3 3-3 3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/>',
    binary: '<rect x="4" y="3" width="7" height="18" rx="2"/><rect x="13" y="3" width="7" height="18" rx="2"/><path d="M7.5 8v0M16.5 16v0"/>',
    jwt: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h4M7 13h8M7 15h5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    id: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M5 16c.5-1.5 1.7-2 3-2s2.5.5 3 2M14 10h5M14 14h5"/>',
    regex: '<path d="M12 3v10M7.5 5.5l9 5M16.5 5.5l-9 5"/><circle cx="12" cy="16" r="1.5"/>',
    abc: '<path d="M3 18 6.5 6 10 18M4.2 14h4.6M14 8h2.5a2.5 2.5 0 0 1 0 5H14zM14 13h2.8a2.5 2.5 0 0 1 0 5H14z"/>',
    dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01"/>',
    shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
    split: '<path d="M12 3v18M3 8h6M3 16h6M15 8h6M21 16h6"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-3-3z"/>'
  };

  function svg(name, size) {
    var s = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || ICONS.tool) + '</svg>';
  }

  /* ============================ 内置示例数据 ============================ */

  var EXAMPLES = [
    {
      id: 'users', name: '用户列表', desc: '对象数组，含多种字段类型',
      text: JSON.stringify([
        { id: 1, name: '张三', email: 'zhangsan@example.com', age: 28, active: true, tags: ['admin', 'vip'], profile: { bio: '前端工程师', city: '北京', score: 92.5 }, createdAt: '2023-05-12T08:30:00Z' },
        { id: 2, name: '李四', email: 'lisi@example.com', age: 34, active: false, tags: ['user'], profile: { bio: '产品经理', city: '上海', score: 88.0 }, createdAt: '2022-11-02T14:05:00Z' },
        { id: 3, name: '王五', email: 'wangwu@example.com', age: 25, active: true, tags: [], profile: { bio: null, city: '深圳', score: 76.5 }, createdAt: '2024-01-20T09:15:00Z' }
      ], null, 2)
    },
    {
      id: 'config', name: '嵌套配置', desc: '多层嵌套对象，用于结构分析',
      text: JSON.stringify({
        app: { name: 'JSON 工具箱', version: '1.0.0', debug: false },
        server: { host: '127.0.0.1', port: 8712, timeout: 30000, cors: { enabled: true, origins: ['http://localhost'] } },
        database: { driver: 'sqlite', file: './data.db', pool: { min: 1, max: 10 }, options: { timeout: 5000 } },
        logging: { level: 'info', outputs: ['console', 'file'], file: { path: './logs/app.log', maxSize: '10MB' } },
        features: { darkMode: true, autoSave: true, history: { enabled: true, limit: 50 } }
      }, null, 2)
    },
    {
      id: 'api', name: '接口响应（分页）', desc: '含分页元信息的典型接口返回',
      text: JSON.stringify({
        code: 0, message: 'success',
        data: {
          total: 3, page: 1, pageSize: 10,
          list: [
            { orderId: 'ORD-2024-001', amount: 199.9, status: 'PAID', user: { id: 1, name: '张三' }, items: [{ sku: 'A1', qty: 2, price: 59.95 }] },
            { orderId: 'ORD-2024-002', amount: 88.0, status: 'PENDING', user: { id: 2, name: '李四' }, items: [{ sku: 'B2', qty: 1, price: 88.0 }] },
            { orderId: 'ORD-2024-003', amount: 320.5, status: 'SHIPPED', user: { id: 3, name: '王五' }, items: [{ sku: 'C3', qty: 5, price: 64.1 }] }
          ]
        }
      }, null, 2)
    },
    {
      id: 'toml', name: 'TOML 配置', desc: 'TOML → JSON 转换示例',
      text: '[app]\nname = "JSON 工具箱"\nversion = "1.0.0"\n\n[server]\nhost = "127.0.0.1"\nport = 8712\ntimeout = 30000\n\n[database]\ndriver = "sqlite"\nfile = "./data.db"\n\n[[users]]\nname = "张三"\nage = 28\n\n[[users]]\nname = "李四"\nage = 34\n'
    },
    {
      id: 'yaml', name: 'YAML 配置', desc: 'YAML ↔ JSON 转换示例',
      text: 'app:\n  name: JSON 工具箱\n  version: 1.0.0\n  debug: false\nserver:\n  host: 127.0.0.1\n  port: 8712\nusers:\n  - name: 张三\n    age: 28\n    tags: [admin, vip]\n  - name: 李四\n    age: 34\n    tags: [user]\n'
    },
    {
      id: 'csv', name: 'CSV 客户表', desc: 'CSV → JSON 转换示例',
      text: 'id,name,email,age,active\n1,张三,zhangsan@example.com,28,true\n2,李四,lisi@example.com,34,false\n3,王五,wangwu@example.com,25,true\n'
    },
    {
      id: 'jwt', name: 'JWT 示例', desc: '用于 JWT 解码工具',
      text: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuW8oOS4iSIsImFkbWluIjp0cnVlLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAwMDAwMDAwMH0.dyt0CoTl4WoVjAHI9Q_CwSKhl6d_9rhM3NrXuJttkao'
    },
    {
      id: 'bigarray', name: '大数组（200 条）', desc: '用于抽样/分块/性能测试',
      get: function () {
        var arr = [];
        for (var i = 1; i <= 200; i++) {
          arr.push({ id: i, name: '用户' + i, age: 18 + (i % 40), score: Math.round((50 + (i * 7) % 50) * 10) / 10, active: i % 3 !== 0, group: 'G' + (i % 5) });
        }
        return JSON.stringify(arr, null, 2);
      }
    }
  ];

  /* ============================ 应用状态 ============================ */

  var state = {
    toolId: null,
    input: '',
    output: '',
    paramValues: {},
    collapsed: {},
    lastResult: null,
    viewMode: null,
    outputEditing: false,
    sidebarHidden: false
  };

  var inputEditor = null, outputEditor = null, split = null;
  var sidebarEl, searchEl, paramsEl, toolTitleEl, toolDescEl, toolActionsEl, statusEl, editorsEl;

  function currentTool() { return JT.registry.get(state.toolId); }

  function exampleText(ex) { return ex.get ? ex.get() : ex.text; }

  /* ============================ 主题 ============================ */

  function resolveTheme(pref) {
    if (pref === 'system') {
      try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
      catch (e) { return 'light'; }
    }
    return pref;
  }
  function applyTheme(pref) {
    var eff = resolveTheme(pref);
    document.documentElement.setAttribute('data-theme', eff);
  }
  function cycleTheme() {
    var order = ['light', 'dark', 'system'];
    var cur = JT.storage.getTheme();
    var next = order[(order.indexOf(cur) + 1) % order.length];
    JT.storage.setTheme(next);
    applyTheme(next);
    JT.toast.info('主题：' + ({ light: '浅色', dark: '深色', system: '跟随系统' }[next]));
  }

  /* ============================ 顶部栏 ============================ */

  function buildTopbar() {
    var brand = D.el('div', { class: 'jt-brand' });
    brand.innerHTML =
      '<span class="jt-logo">' + svg('schema', 20) + '</span>' +
      '<span class="jt-brand-text"><b>JSON 工具箱</b><small>v1.0.0 · 离线版</small></span>';

    searchEl = D.el('div', { class: 'jt-search' });
    searchEl.innerHTML = svg('search', 15) + '<input type="search" id="jtSearch" placeholder="搜索工具…  (Ctrl+K)" aria-label="搜索工具" autocomplete="off" /><kbd>Ctrl K</kbd>';
    var input = searchEl.querySelector('input');
    input.addEventListener('input', function () { renderSidebar(input.value.trim()); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { input.value = ''; renderSidebar(''); input.blur(); }
      if (e.key === 'Enter') {
        var first = D.qs('.jt-nav-item', sidebarEl);
        if (first) { selectTool(first.dataset.id); }
      }
    });

    var actions = D.el('div', { class: 'jt-top-actions' });
    function topBtn(icon, title, onClick) {
      return D.el('button', { class: 'jt-icon-btn', type: 'button', title: title, 'aria-label': title, html: svg(icon, 18), onclick: onClick });
    }
    actions.appendChild(topBtn('globe', '切换主题', cycleTheme));
    actions.appendChild(topBtn('clock', '历史记录', openHistory));
    actions.appendChild(topBtn('template', '示例库', openExamples));
    actions.appendChild(topBtn('key', '快捷键', openShortcuts));
    actions.appendChild(topBtn('shield', '关于', openAbout));

    return [brand, searchEl, actions];
  }

  /* ============================ 侧边导航 ============================ */

  function renderSidebar(filter) {
    D.clear(sidebarEl);
    var tools = JT.registry.tools;
    var f = (filter || '').toLowerCase();
    var favSet = {};
    JT.storage.getFavorites().forEach(function (id) { favSet[id] = 1; });

    function matches(t) {
      if (!f) return true;
      return (t.name + ' ' + t.desc + ' ' + t.id).toLowerCase().indexOf(f) >= 0;
    }

    var favTools = tools.filter(function (t) { return favSet[t.id] && matches(t); });
    if (favTools.length) {
      var favGroup = D.el('div', { class: 'jt-nav-group' });
      favGroup.appendChild(D.el('div', { class: 'jt-nav-head fixed', html: '<span class="jt-nav-icon">' + svg('key', 15) + '</span><span class="jt-nav-name">收藏</span>' }));
      var favList = D.el('div', { class: 'jt-nav-list' });
      favTools.forEach(function (t) { favList.appendChild(navItem(t)); });
      favGroup.appendChild(favList);
      sidebarEl.appendChild(favGroup);
    }

    JT.registry.categories.forEach(function (cat) {
      var list = tools.filter(function (t) { return t.cat === cat.id && matches(t); });
      if (!list.length) return;
      var collapsed = !!state.collapsed[cat.id] && !f;
      var group = D.el('div', { class: 'jt-nav-group' + (collapsed ? ' collapsed' : '') });
      var head = D.el('div', { class: 'jt-nav-head', role: 'button', tabindex: '0' });
      head.innerHTML =
        '<span class="jt-nav-arrow">' + svg('sort', 12) + '</span>' +
        '<span class="jt-nav-icon">' + svg(cat.icon, 15) + '</span>' +
        '<span class="jt-nav-name">' + D.esc(cat.name) + '</span>' +
        '<span class="jt-nav-count">' + list.length + '</span>';
      head.addEventListener('click', function () {
        state.collapsed[cat.id] = !state.collapsed[cat.id];
        renderSidebar(searchEl.querySelector('input').value.trim());
      });
      head.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); head.click(); } });
      var listEl = D.el('div', { class: 'jt-nav-list' });
      list.forEach(function (t) { listEl.appendChild(navItem(t)); });
      group.appendChild(head);
      group.appendChild(listEl);
      sidebarEl.appendChild(group);
    });

    if (!sidebarEl.children.length) {
      sidebarEl.appendChild(D.el('div', { class: 'jt-nav-empty', text: '没有匹配的工具' }));
    }
  }

  function navItem(t) {
    var item = D.el('button', {
      class: 'jt-nav-item' + (state.toolId === t.id ? ' active' : ''), type: 'button',
      title: t.name + ' — ' + t.desc, dataset: { id: t.id }
    });
    item.innerHTML = '<span class="jt-nav-item-icon">' + svg(t.icon, 16) + '</span><span class="jt-nav-item-name">' + D.esc(t.name) + '</span>';
    item.addEventListener('click', function () { selectTool(t.id); });
    return item;
  }

  /* ============================ 工具工作区 ============================ */

  function renderToolHead(tool) {
    D.clear(toolTitleEl);
    toolTitleEl.appendChild(D.el('span', { class: 'jt-th-icon', html: svg(tool.icon, 18) }));
    toolTitleEl.appendChild(D.el('h2', { class: 'jt-th-name', text: tool.name }));
    var catName = (JT.registry.categories.filter(function (c) { return c.id === tool.cat; })[0] || {}).name || '';
    toolTitleEl.appendChild(D.el('span', { class: 'jt-th-cat', text: catName }));
    toolDescEl.textContent = tool.desc;

    D.clear(toolActionsEl);
    var fav = JT.storage.isFavorite(tool.id);
    toolActionsEl.appendChild(D.el('button', {
      class: 'jt-btn jt-btn-ghost', type: 'button', title: '收藏 / 取消收藏',
      html: svg('key', 15) + '<span>' + (fav ? '已收藏' : '收藏') + '</span>',
      onclick: function () { JT.storage.toggleFavorite(tool.id); renderToolHead(tool); renderSidebar(searchEl.querySelector('input').value.trim()); }
    }));
    toolActionsEl.appendChild(D.el('button', { class: 'jt-btn jt-btn-ghost', type: 'button', title: '重置参数为默认值', html: svg('broom', 15) + '<span>重置参数</span>', onclick: function () { resetParams(tool); } }));
    toolActionsEl.appendChild(D.el('button', { class: 'jt-btn jt-btn-ghost', type: 'button', title: '把输出作为新输入', html: svg('swap', 15) + '<span>交换左右</span>', onclick: swapSides }));
    toolActionsEl.appendChild(D.el('button', { class: 'jt-btn jt-btn-primary', type: 'button', title: '执行 (Ctrl+Enter)', html: svg('check', 15) + '<span>执行</span>', onclick: run }));
  }

  function renderParams(tool) {
    D.clear(paramsEl);
    if (!tool.params || !tool.params.length) {
      paramsEl.appendChild(D.el('span', { class: 'jt-params-empty', text: '该工具无需参数' }));
      return;
    }
    tool.params.forEach(function (p) {
      var wrap = D.el('label', { class: 'jt-param' + (p.type === 'textarea' ? ' jt-param-wide' : '') });
      wrap.appendChild(D.el('span', { class: 'jt-param-label', text: p.label }));
      var control;
      if (p.type === 'select') {
        control = D.el('select', { class: 'jt-select' });
        p.options.forEach(function (o) { control.appendChild(D.el('option', { value: o.value, text: o.label, selected: String(state.paramValues[p.id]) === String(o.value) ? 'selected' : null })); });
        control.addEventListener('change', function () { state.paramValues[p.id] = control.value; });
      } else if (p.type === 'checkbox') {
        control = D.el('input', { type: 'checkbox', class: 'jt-check' });
        control.checked = !!state.paramValues[p.id];
        control.addEventListener('change', function () { state.paramValues[p.id] = control.checked; });
      } else if (p.type === 'number') {
        control = D.el('input', { type: 'number', class: 'jt-input jt-input-num', value: state.paramValues[p.id] });
        if (p.min != null) control.setAttribute('min', p.min);
        if (p.max != null) control.setAttribute('max', p.max);
        control.addEventListener('input', function () { state.paramValues[p.id] = control.value === '' ? '' : Number(control.value); });
      } else if (p.type === 'textarea') {
        control = D.el('textarea', { class: 'jt-textarea-sm', rows: '3', placeholder: p.placeholder || '' });
        control.value = state.paramValues[p.id] == null ? '' : state.paramValues[p.id];
        control.addEventListener('input', function () { state.paramValues[p.id] = control.value; });
      } else {
        control = D.el('input', { type: 'text', class: 'jt-input', value: state.paramValues[p.id] == null ? '' : state.paramValues[p.id], placeholder: p.placeholder || '' });
        control.addEventListener('input', function () { state.paramValues[p.id] = control.value; });
      }
      wrap.appendChild(control);
      paramsEl.appendChild(wrap);
    });
  }

  function resetParams(tool) {
    state.paramValues = Object.assign({}, tool.defaultParams);
    renderParams(tool);
    JT.toast.info('已重置参数');
  }

  /* ============================ 编辑器面板 ============================ */

  function inputActions() {
    return [
      { id: 'paste', title: '从剪贴板粘贴', svg: svg('code', 15), onClick: pasteFromClipboard },
      { id: 'example', title: '载入示例', svg: svg('template', 15), onClick: openExamples },
      { id: 'file', title: '上传文件', svg: svg('rows', 15), onClick: uploadFile },
      { id: 'clear', title: '清空输入', svg: svg('broom', 15), onClick: function () { setInput(''); run(); } }
    ];
  }
  function outputActions() {
    return [
      { id: 'copy', title: '复制输出 (Ctrl+Shift+C)', svg: svg('binary', 15), onClick: function () { JT.editor.copy(state.output).then(function (ok) { ok ? JT.toast.success('已复制到剪贴板') : JT.toast.error('复制失败，请手动选择复制'); }); } },
      { id: 'swap', title: '结果作为新输入', svg: svg('swap', 15), onClick: swapSides },
      { id: 'save', title: '下载输出 (Ctrl+S)', svg: svg('rows', 15), onClick: downloadOutput },
      { id: 'clear', title: '清空输出', svg: svg('broom', 15), onClick: function () { state.output = ''; state.outputEditing = false; outputEditor.setValue(''); setStatus('ready', '已清空输出'); } }
    ];
  }

  function buildEditors() {
    D.clear(editorsEl);
    inputEditor = JT.editor.create({ mode: 'edit', lang: 'json', title: '输入', value: state.input, actions: inputActions(), onInput: function (v) { state.input = v; JT.storage.setDraft(state.toolId, v); }, onDrop: handleDrop });
    outputEditor = JT.editor.create({
      mode: 'view', lang: 'json', title: '输出', value: '', actions: outputActions(),
      onCopy: function (t) { JT.editor.copy(String(t)).then(function (ok) { JT.toast.success(ok ? '已复制' : '复制失败'); }); },
      // 输出面板进入编辑态后，编辑内容实时同步到 state.output，使复制 / 下载 / 作为新输入直接可用
      onEditText: function (v) { state.output = v; }
    });
    editorsEl.classList.add('jt-split');
    split = JT.split.create({ container: editorsEl, left: inputEditor.root, right: outputEditor.root, storageKey: 'splitRatio', ratio: 0.5 });
  }

  function setInput(text, opts) {
    state.input = String(text == null ? '' : text);
    if (inputEditor) inputEditor.setValue(state.input);
    JT.storage.setDraft(state.toolId, state.input);
    if (opts && opts.focus && inputEditor) inputEditor.focus();
  }

  function updateInputBadge(tool) {
    var langMap = {
      'convert-yaml': 'JSON / YAML', 'convert-toml': 'JSON / TOML', 'convert-xml': 'JSON / XML',
      'convert-csv': 'JSON / CSV', 'convert-md': 'JSON'
    };
    var label = '输入';
    if (tool.inputKind === 'text') label = '输入文本';
    inputEditor.setTitle(label);
  }

  /* ============================ 执行 ============================ */

  function makeCtx(input) {
    var cached = null;
    return {
      parseInput: function () {
        if (cached) return cached;
        cached = JTCore.json.parseLax(input);
        return cached;
      }
    };
  }

  function collectParams(tool) {
    var p = {};
    (tool.params || []).forEach(function (x) { p[x.id] = state.paramValues[x.id]; });
    return p;
  }

  function run() {
    var tool = currentTool();
    if (!tool) return;
    var input = inputEditor ? inputEditor.getValue() : state.input;
    state.input = input;
    // 执行入口：先清除两侧面板的旧错误提示，避免上一次的报错残留
    if (inputEditor) inputEditor.clearError();
    if (outputEditor) outputEditor.clearError();

    var params = collectParams(tool);
    var ctx = makeCtx(input);
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();

    function finish(result, asyncResolved) {
      var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
      renderResult(tool, result || {}, t1 - t0);
    }

    try {
      var res = tool.run(input, params, ctx);
      if (res && typeof res.then === 'function') {
        setStatus('running', '执行中…');
        res.then(function (r) { finish(r, true); }, function (e) { finish({ error: (e && e.message) || String(e) }, true); });
      } else {
        finish(res, false);
      }
    } catch (e) {
      finish({ error: (e && e.message) || String(e), errorLine: (e && e.jtc && e.jtc.line) || null });
    }
  }

  /* ============================ 结果渲染 ============================ */

  /** 数据是否可以渲染为树形（对象 / 数组）。 */
  function isTreeData(data) {
    return data !== undefined && data !== null && typeof data === 'object';
  }

  /** 根据工具默认视图与用户手动选择，决定当前输出视图（'text' | 'tree' | 'diff'）。 */
  function decideView(tool, result) {
    var supportsTree = isTreeData(result.data);
    var def = result.view || tool.view || 'text';
    if (def === 'diff' && result.data && result.data.diff) return 'diff';
    // 用户手动选择优先
    if (state.viewMode === 'tree') return supportsTree ? 'tree' : 'text';
    if (state.viewMode === 'text') return 'text';
    // 自动：工具声明树形且数据可树形展示时用树形
    if (def === 'tree' && supportsTree) return 'tree';
    return 'text';
  }

  /** 更新输出面板头部视图控件（文本 / 树形 / 编辑）。 */
  function updateOutputToggle(mode, supportsTree, title) {
    outputEditor.setViewToggle({
      visible: true,
      mode: mode,
      editable: mode === 'text',
      editing: state.outputEditing,
      treeDisabled: !supportsTree,
      disabledTip: '当前结果不是 JSON 对象/数组，无法使用树形视图',
      onSelect: function (m) {
        // 切换视图前若处于编辑态，先把编辑内容提交为新的输出
        if (state.outputEditing) { state.output = outputEditor.getValue(); state.outputEditing = false; }
        state.viewMode = m;
        renderOutput();
      },
      onEditSelect: function (flag) {
        outputEditor.setEditable(flag);
        state.outputEditing = outputEditor.isEditing();
        if (flag) {
          outputEditor.setTitle('输出 · 编辑中');
          setStatus('ready', '可直接编辑输出内容，改完点「查看」应用');
        } else {
          state.output = outputEditor.getValue();
          outputEditor.setTitle('输出 · ' + title);
          setStatus('ok', '编辑已应用 · 输出 ' + state.output.length + ' 字符');
        }
        updateOutputToggle(mode, supportsTree, title);
      }
    });
  }

  /** 仅重绘输出区域（切换文本/树形时复用，无需重新执行工具）。 */
  function renderOutput() {
    var lr = state.lastResult;
    if (!lr) return;
    var tool = lr.tool, result = lr.result;
    var supportsTree = isTreeData(result.data);
    var mode = decideView(tool, result);

    if (mode === 'diff') {
      state.outputEditing = false;
      outputEditor.setTextMode();
      outputEditor.setCustom(renderDiff(result.data));
      outputEditor.setStatsText('共 ' + result.data.diff.length + ' 处差异');
      outputEditor.setTitle('输出 · 差异');
      outputEditor.setViewToggle({ visible: false });
      return;
    }

    if (mode === 'tree') {
      state.outputEditing = false;
      outputEditor.setTextMode();
      var tree = JT.tree.create({ onCopy: function (t) { JT.editor.copy(String(t)).then(function (ok) { JT.toast.success(ok ? '已复制' : '复制失败'); }); } });
      outputEditor.setCustom(tree.root);
      tree.render(result.data);
      outputEditor.setStatsText('树形视图');
      outputEditor.setTitle('输出 · 树形');
      updateOutputToggle(mode, supportsTree, '树形');
    } else {
      outputEditor.setTextMode();
      var lang = (result.outLang === 'json' || tool.outLang === 'json') ? 'json' : 'text';
      var title = langLabel(result.outLang || tool.outLang);
      outputEditor.setLang(lang);
      outputEditor.setValue(state.output);
      outputEditor.setTitle('输出 · ' + title);
      updateOutputToggle(mode, supportsTree, title);
    }
  }

  function renderResult(tool, result, ms) {
    var notices = result.notices || [];

    if (result.error) {
      state.output = '';
      state.lastResult = null;
      state.outputEditing = false;
      outputEditor.setTextMode();
      outputEditor.setValue('');
      outputEditor.setViewToggle({ visible: false });
      outputEditor.setError({ line: result.errorLine, message: result.error });
      setStatus('error', result.error);
      inputEditor.setError(result.errorLine ? { line: result.errorLine, message: result.error } : null);
      setTiming(ms);
      return;
    }

    inputEditor.clearError();
    outputEditor.clearError();
    state.output = result.output == null ? '' : String(result.output);
    state.outputEditing = false; // 新结果覆盖输出，退出编辑态

    state.lastResult = { tool: tool, result: result, ms: ms };
    renderOutput();

    if (notices.length) notices.forEach(function (n) { JT.toast.show(n, 'info', 3200); });
    setStatus('ok', '执行成功 · 输出 ' + state.output.length + ' 字符');
    setTiming(ms);

    JT.storage.addHistory({
      toolId: tool.id, toolName: tool.name,
      inputSummary: state.input.slice(0, 120).replace(/\s+/g, ' '),
      outputPreview: state.output.slice(0, 200),
      params: collectParams(tool), input: state.input
    });
  }

  function langLabel(l) {
    var m = { json: 'JSON', yaml: 'YAML', toml: 'TOML', xml: 'XML', csv: 'CSV', markdown: 'Markdown', sql: 'SQL', code: '代码', text: '文本', diff: '差异' };
    return m[l] || '文本';
  }

  function shorten(v) {
    if (v === undefined) return '∅';
    var s = (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v);
    return s.length > 70 ? s.slice(0, 70) + '…' : s;
  }

  function renderDiff(data) {
    var wrap = D.el('div', { class: 'jt-diff' });
    var counts = { added: 0, removed: 0, changed: 0 };
    data.diff.forEach(function (d) { counts[d.type] = (counts[d.type] || 0) + 1; });
    wrap.appendChild(D.el('div', {
      class: 'jt-diff-summary',
      html: '<span class="jt-diff-c added">+' + counts.added + ' 新增</span><span class="jt-diff-c removed">-' + counts.removed + ' 删除</span><span class="jt-diff-c changed">~' + counts.changed + ' 修改</span>'
    }));
    var list = D.el('div', { class: 'jt-diff-list' });
    if (!data.diff.length) {
      list.appendChild(D.el('div', { class: 'jt-diff-empty', text: '两侧完全一致，无差异。' }));
    }
    data.diff.forEach(function (d) {
      var row = D.el('div', { class: 'jt-diff-row jt-diff-' + d.type });
      row.appendChild(D.el('span', { class: 'jt-diff-tag', text: d.type === 'added' ? '新增' : d.type === 'removed' ? '删除' : '修改' }));
      row.appendChild(D.el('code', { class: 'jt-diff-path', text: d.path }));
      var vals = D.el('span', { class: 'jt-diff-vals' });
      if (d.type !== 'added') vals.appendChild(D.el('span', { class: 'jt-diff-l', text: shorten(d.left) }));
      if (d.type === 'changed') vals.appendChild(D.el('span', { class: 'jt-diff-arrow', text: '→' }));
      if (d.type !== 'removed') vals.appendChild(D.el('span', { class: 'jt-diff-r', text: shorten(d.right) }));
      row.appendChild(vals);
      list.appendChild(row);
    });
    wrap.appendChild(list);
    return wrap;
  }

  /* ============================ 状态栏 ============================ */

  var statusTimer = null;
  function setStatus(kind, message) {
    if (!statusEl) return;
    var dot = D.qs('.jt-status-dot', statusEl);
    var msg = D.qs('.jt-status-msg', statusEl);
    if (dot) dot.className = 'jt-status-dot jt-status-' + kind;
    if (msg) msg.textContent = message || '';
    if (statusTimer) clearTimeout(statusTimer);
    if (kind === 'ok' || kind === 'error') {
      statusTimer = setTimeout(function () { if (msg) msg.textContent = '就绪'; if (dot) dot.className = 'jt-status-dot jt-status-ready'; }, 4000);
    }
  }
  function setTiming(ms) {
    var el = D.qs('.jt-status-time', statusEl);
    if (el && ms != null) el.textContent = (ms < 10 ? ms.toFixed(2) : ms.toFixed(1)) + ' ms';
  }
  function updateStatusCounts() {
    var el = D.qs('.jt-status-counts', statusEl);
    if (el) el.textContent = '输入 ' + (state.input ? state.input.length : 0) + ' 字符 · 输出 ' + (state.output ? state.output.length : 0) + ' 字符';
    var tid = D.qs('.jt-status-tool', statusEl);
    if (tid) tid.textContent = state.toolId || '';
  }

  function buildStatusbar() {
    statusEl = D.el('footer', { class: 'jt-statusbar', role: 'contentinfo' });
    statusEl.innerHTML =
      '<span class="jt-status-left"><span class="jt-status-dot jt-status-ready"></span><span class="jt-status-msg">就绪</span></span>' +
      '<span class="jt-status-time">—</span>' +
      '<span class="jt-status-right"><span class="jt-status-counts"></span><span class="jt-status-tool"></span></span>';
    return statusEl;
  }

  /* ============================ 工具路由 ============================ */

  function selectTool(id, opts) {
    var tool = JT.registry.get(id);
    if (!tool) return;
    state.toolId = id;
    state.paramValues = Object.assign({}, tool.defaultParams);

    renderToolHead(tool);
    renderParams(tool);
    updateInputBadge(tool);
    renderSidebar(searchEl.querySelector('input').value.trim());
    D.qsa('.jt-nav-item').forEach(function (n) { if (n.dataset.id === id) n.classList.add('active'); });

    var draft = JT.storage.getDraft(id);
    if (draft === null && !opts) draft = exampleText(EXAMPLES[0]);
    setInput(draft === null ? '' : draft);
    state.output = '';
    state.lastResult = null;
    state.viewMode = null;
    outputEditor.setValue('');
    outputEditor.clearError();
    outputEditor.setViewToggle({ visible: false });

    if (!opts || opts.autorun !== false) run();
  }

  function swapSides() {
    if (!state.output) { JT.toast.warn('输出为空，无法交换'); return; }
    setInput(state.output);
    JT.toast.success('已把输出作为新输入');
    run();
  }

  /* ============================ 文件 / 剪贴板 ============================ */

  function handleDrop(e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    readFile(files[0]);
  }
  function uploadFile() {
    var inp = D.el('input', { type: 'file', accept: '.json,.yaml,.yml,.toml,.xml,.csv,.txt,.ndjson,.env,.properties', style: { display: 'none' } });
    inp.addEventListener('change', function () { if (inp.files && inp.files[0]) readFile(inp.files[0]); });
    document.body.appendChild(inp);
    inp.click();
    setTimeout(function () { if (inp.parentNode) inp.parentNode.removeChild(inp); }, 1000);
  }
  function readFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      setInput(String(reader.result || ''));
      JT.toast.success('已载入文件：' + file.name);
      run();
    };
    reader.onerror = function () { JT.toast.error('读取文件失败'); };
    reader.readAsText(file, 'utf-8');
  }
  function pasteFromClipboard() {
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (t) { setInput(t); run(); }, function () { JT.toast.warn('无法读取剪贴板，请手动粘贴（Ctrl+V）'); });
    } else {
      JT.toast.warn('当前环境不支持读取剪贴板，请手动粘贴（Ctrl+V）');
    }
  }

  function extFor(lang) {
    var m = { json: 'json', yaml: 'yaml', toml: 'toml', xml: 'xml', csv: 'csv', markdown: 'md', sql: 'sql', text: 'txt', code: 'txt' };
    return m[lang] || 'txt';
  }
  function mimeFor(lang) {
    var m = { json: 'application/json', yaml: 'text/yaml', toml: 'text/plain', xml: 'application/xml', csv: 'text/csv', markdown: 'text/markdown', sql: 'text/plain', text: 'text/plain', code: 'text/plain' };
    return m[lang] || 'text/plain';
  }
  function downloadOutput() {
    if (!state.output) { JT.toast.warn('输出为空'); return; }
    var tool = currentTool();
    var lang = (tool && tool.outLang) || 'text';
    var blob = new Blob([state.output], { type: mimeFor(lang) + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = D.el('a', { href: url, download: 'output-' + Date.now() + '.' + extFor(lang) });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 200);
    JT.toast.success('已开始下载');
  }

  /* ============================ 弹窗内容 ============================ */

  function openAbout() {
    var c = D.el('div', { class: 'jt-about' });
    c.innerHTML =
      '<p><b>JSON 工具箱</b> v1.0.0 · 完全离线运行的桌面 JSON 处理工具。</p>' +
      '<p>内置 ' + JT.registry.tools.length + ' 个工具，覆盖格式化、格式转换、查询提取、校验分析、编码安全与实用工具六大类。</p>' +
      '<p class="jt-muted">技术栈：纯静态前端（原生 JS，无框架、无 CDN）+ Python 桌面外壳。所有依赖已离线内置于 vendor/libs.js。</p>';
    JT.modal.open({ title: '关于 JSON 工具箱', content: c, size: 'md' });
  }

  function openShortcuts() {
    var rows = [
      ['Ctrl + Enter', '执行当前工具'],
      ['Ctrl + Shift + C', '复制输出'],
      ['Ctrl + K', '聚焦搜索框'],
      ['Ctrl + S', '下载输出'],
      ['Ctrl + B', '折叠 / 展开侧栏'],
      ['Ctrl + D', '切换主题'],
      ['Esc', '关闭弹窗'],
      ['Alt + ↑ / ↓', '上一个 / 下一个工具'],
      ['Tab（编辑区内）', '插入两个空格']
    ];
    var table = D.el('div', { class: 'jt-keys' });
    rows.forEach(function (r) {
      var row = D.el('div', { class: 'jt-keys-row' });
      row.appendChild(D.el('span', { class: 'jt-keys-k', text: r[0] }));
      row.appendChild(D.el('span', { class: 'jt-keys-v', text: r[1] }));
      table.appendChild(row);
    });
    JT.modal.open({ title: '快捷键', content: table, size: 'md' });
  }

  function openExamples() {
    var wrap = D.el('div', { class: 'jt-examples' });
    EXAMPLES.forEach(function (ex) {
      var item = D.el('button', { class: 'jt-example', type: 'button' });
      item.innerHTML = '<span class="jt-example-name">' + D.esc(ex.name) + '</span><span class="jt-example-desc">' + D.esc(ex.desc) + '</span>';
      item.addEventListener('click', function () {
        setInput(exampleText(ex));
        JT.toast.success('已载入示例：' + ex.name);
        JT.modal.close();
        run();
      });
      wrap.appendChild(item);
    });
    JT.modal.open({ title: '示例库', content: wrap, size: 'lg' });
  }

  function openHistory() {
    var wrap = D.el('div', { class: 'jt-history' });
    function refresh() {
      D.clear(wrap);
      var list = JT.storage.getHistory();
      if (!list.length) { wrap.appendChild(D.el('div', { class: 'jt-empty', text: '暂无历史记录' })); return; }
      list.forEach(function (h) {
        var row = D.el('div', { class: 'jt-hist-row' });
        var time = new Date(h.time);
        var meta = D.el('div', { class: 'jt-hist-meta' });
        meta.appendChild(D.el('span', { class: 'jt-hist-tool', text: h.toolName || h.toolId }));
        meta.appendChild(D.el('span', { class: 'jt-hist-time', text: time.toLocaleString() }));
        meta.appendChild(D.el('span', { class: 'jt-hist-sum', text: h.inputSummary || '' }));
        row.appendChild(meta);
        var acts = D.el('div', { class: 'jt-hist-acts' });
        acts.appendChild(D.el('button', { class: 'jt-btn jt-btn-sm', type: 'button', text: '回填', onclick: function () {
          if (h.toolId && JT.registry.get(h.toolId)) {
            selectTool(h.toolId, { autorun: false });
            state.paramValues = Object.assign({}, JT.registry.get(h.toolId).defaultParams, h.params || {});
            renderParams(currentTool());
          }
          setInput(h.input || '');
          JT.modal.close();
          run();
        } }));
        acts.appendChild(D.el('button', { class: 'jt-btn jt-btn-sm', type: 'button', text: '删除', onclick: function () { JT.storage.removeHistory(h.id); refresh(); } }));
        row.appendChild(acts);
        wrap.appendChild(row);
      });
    }
    refresh();
    var footer = D.el('button', { class: 'jt-btn jt-btn-danger', type: 'button', text: '清空全部历史', onclick: function () { JT.storage.clearHistory(); refresh(); JT.toast.info('已清空历史'); } });
    JT.modal.open({ title: '历史记录（最近 ' + JT.storage.getHistory().length + ' 条）', content: wrap, footer: footer, size: 'lg' });
  }

  /* ============================ 快捷键 ============================ */

  function bindShortcuts() {
    document.addEventListener('keydown', function (e) {
      var ctrl = e.ctrlKey || e.metaKey;
      var key = e.key;
      if (ctrl && key === 'Enter') { e.preventDefault(); run(); return; }
      if (ctrl && e.shiftKey && (key === 'C' || key === 'c')) {
        e.preventDefault();
        JT.editor.copy(state.output).then(function (ok) { ok ? JT.toast.success('已复制输出') : JT.toast.error('复制失败'); });
        return;
      }
      if (ctrl && (key === 'k' || key === 'K')) { e.preventDefault(); var s = D.qs('#jtSearch'); if (s) { s.focus(); s.select(); } return; }
      if (ctrl && (key === 's' || key === 'S')) { e.preventDefault(); downloadOutput(); return; }
      if (ctrl && (key === 'b' || key === 'B')) { e.preventDefault(); toggleSidebar(); return; }
      if (ctrl && (key === 'd' || key === 'D')) { e.preventDefault(); cycleTheme(); return; }
      if (e.altKey && (key === 'ArrowDown' || key === 'ArrowUp')) {
        e.preventDefault();
        var tools = JT.registry.tools;
        var idx = tools.findIndex(function (t) { return t.id === state.toolId; });
        var next = key === 'ArrowDown' ? (idx + 1) % tools.length : (idx - 1 + tools.length) % tools.length;
        selectTool(tools[next].id);
      }
    });
  }

  function toggleSidebar() {
    state.sidebarHidden = !state.sidebarHidden;
    document.body.classList.toggle('jt-sidebar-hidden', state.sidebarHidden);
  }

  /* ============================ 初始化 ============================ */

  function init() {
    D = JT.dom;
    applyTheme(JT.storage.getTheme());

    var app = D.qs('#app');
    if (!app) { console.error('缺少 #app 容器'); return; }

    // 顶部栏
    var topbar = D.el('header', { class: 'jt-topbar', role: 'banner' });
    buildTopbar().forEach(function (n) { topbar.appendChild(n); });

    // 侧栏
    sidebarEl = D.el('aside', { class: 'jt-sidebar', role: 'navigation', 'aria-label': '工具导航' });

    // 工作区
    var ws = D.el('main', { class: 'jt-workspace' });
    var head = D.el('div', { class: 'jt-toolhead' });
    toolTitleEl = D.el('div', { class: 'jt-th-left' });
    toolDescEl = D.el('p', { class: 'jt-th-desc' });
    toolActionsEl = D.el('div', { class: 'jt-th-actions' });
    head.appendChild(toolTitleEl);
    head.appendChild(toolActionsEl);
    var headWrap = D.el('div', { class: 'jt-toolhead-wrap' });
    headWrap.appendChild(head);
    headWrap.appendChild(toolDescEl);
    paramsEl = D.el('div', { class: 'jt-params', role: 'group', 'aria-label': '工具参数' });
    editorsEl = D.el('div', { class: 'jt-editors' });
    ws.appendChild(headWrap);
    ws.appendChild(paramsEl);
    ws.appendChild(editorsEl);

    // 主区域
    var main = D.el('div', { class: 'jt-main' });
    main.appendChild(sidebarEl);
    main.appendChild(ws);

    // 状态栏
    var statusbar = buildStatusbar();

    // 挂载
    D.clear(app);
    app.appendChild(topbar);
    app.appendChild(main);
    app.appendChild(statusbar);

    buildEditors();

    // 首次运行：默认工具 format-pretty + 用户列表示例
    var firstRun = JT.storage.isFirstRun();
    var startTool = 'format-pretty';
    state.toolId = startTool;
    var tool = JT.registry.get(startTool);
    state.paramValues = Object.assign({}, tool.defaultParams);
    state.input = exampleText(EXAMPLES[0]);
    inputEditor.setValue(state.input);
    renderSidebar('');
    selectTool(startTool);
    if (firstRun) { JT.storage.markNotFirstRun(); }

    bindShortcuts();

    // 监听系统主题变化
    try {
      if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
          if (JT.storage.getTheme() === 'system') applyTheme('system');
        });
      }
    } catch (e) { /* 忽略 */ }

    inputEditor.focus();
    updateStatusCounts();
    setInterval(updateStatusCounts, 1200);
  }

  JT.app = { init: init, run: run, selectTool: selectTool, examples: EXAMPLES };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
