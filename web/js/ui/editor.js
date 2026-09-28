/*!
 * ui/editor.js —— 行号编辑器 + 只读高亮渲染层 + 树形视图 + 可拖拽分栏
 * 依赖：dom.js、storage.js。挂载到 window.JTUI.editor / window.JTUI.tree / window.JTUI.split
 */
(function () {
  'use strict';
  var JT = (window.JTUI = window.JTUI || {});
  var dom = null;
  function D() { return dom || (dom = JT.dom); }

  function esc(s) { return D().esc(s); }
  function utf8Bytes(text) {
    text = String(text == null ? '' : text);
    var bytes = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) bytes += 1;
      else if (c < 0x800) bytes += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }
  function formatBytes(n) {
    if (n < 1024) return n + ' 字节';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  /* ============================ 高亮 ============================ */

  function highlightJson(text) {
    var out = '';
    var re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+\.?\d*(?:[eE][-+]?\d+)?)|\b(true|false|null)\b|([{}\[\],:])/g;
    var last = 0, m;
    while ((m = re.exec(text)) !== null) {
      out += esc(text.slice(last, m.index));
      if (m[1] !== undefined) {
        if (m[2]) out += '<span class="tok-key">' + esc(m[1]) + '</span><span class="tok-punc">' + esc(m[2]) + '</span>';
        else out += '<span class="tok-str">' + esc(m[1]) + '</span>';
      } else if (m[3] !== undefined) out += '<span class="tok-num">' + esc(m[3]) + '</span>';
      else if (m[4] !== undefined) out += '<span class="tok-lit">' + esc(m[4]) + '</span>';
      else if (m[5] !== undefined) out += '<span class="tok-punc">' + esc(m[5]) + '</span>';
      last = m.index + m[0].length;
    }
    out += esc(text.slice(last));
    return out;
  }

  function highlightGeneric(text) {
    var out = '';
    var re = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(#[^\n]*|\/\/[^\n]*)|(-?\b\d+\.?\d*\b)|\b(true|false|null|undefined)\b/g;
    var last = 0, m;
    while ((m = re.exec(text)) !== null) {
      out += esc(text.slice(last, m.index));
      if (m[1] !== undefined) out += '<span class="tok-str">' + esc(m[1]) + '</span>';
      else if (m[2] !== undefined) out += '<span class="tok-com">' + esc(m[2]) + '</span>';
      else if (m[3] !== undefined) out += '<span class="tok-num">' + esc(m[3]) + '</span>';
      else if (m[4] !== undefined) out += '<span class="tok-lit">' + esc(m[4]) + '</span>';
      last = m.index + m[0].length;
    }
    out += esc(text.slice(last));
    return out;
  }

  function highlight(text, lang) {
    if (lang === 'json' || lang === 'ndjson') return highlightJson(text);
    return highlightGeneric(text);
  }

  /* ============================ JSON 折叠辅助 ============================ */

  /**
   * 字符串感知地扫描 JSON 文本，返回所有跨行的 { 与 [ 块。
   * 返回数组元素：{ start: 开括号行号(0基), end: 闭括号行号(0基), ch: '{'|'[' }（仅收录 start < end 的块）。
   * 仅在 JSON.parse 已通过时调用，括号必然配对。
   */
  function scanJsonBlocks(text) {
    var stack = [], blocks = [];
    var inStr = false, escaped = false, line = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (c === '\n') { line++; continue; }
      if (inStr) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{' || c === '[') stack.push({ line: line, ch: c });
      else if (c === '}' || c === ']') {
        var top = stack.pop();
        if (top && ((c === '}' && top.ch === '{') || (c === ']' && top.ch === '[')) && line > top.line) {
          blocks.push({ start: top.line, end: line, ch: top.ch });
        }
      }
    }
    return blocks;
  }

  /** 解析 "key": value 形态的行（传入已 trim 文本），返回 { key, rawValue, isString } 或 null。 */
  function parseKvLine(trimmed) {
    var m = /^"((?:\\.|[^"\\])*)"\s*:\s*(.+?)\s*,?\s*$/.exec(trimmed);
    if (!m) return null;
    var key = m[1];
    try { key = JSON.parse('"' + m[1] + '"'); } catch (e) { /* 保留原文 */ }
    return { key: key, rawValue: m[2], isString: m[2].charAt(0) === '"' };
  }

  /** 把 JSON 字符串字面量（含引号）还原为实际文本；失败时退化为去掉首尾引号。 */
  function decodeJsonString(raw) {
    if (raw.charAt(0) !== '"') return raw;
    try { return JSON.parse(raw); } catch (e) { return raw.slice(1, -1); }
  }

  /* ============================ 复制 ============================ */

  function copyText(text) {
    text = String(text == null ? '' : text);
    return new Promise(function (resolve) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(fallbackCopy(text)); });
      } else {
        resolve(fallbackCopy(text));
      }
    });
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* ============================ 编辑器 ============================ */

  function createEditor(opts) {
    opts = opts || {};
    var mode = opts.mode || 'edit';
    var lang = opts.lang || 'json';

    var root = D().el('section', { class: 'jt-panel jt-panel-' + mode });

    var head = D().el('div', { class: 'jt-panel-head' });
    var titleWrap = D().el('div', { class: 'jt-panel-title' });
    var badge = D().el('span', { class: 'jt-badge', text: opts.title || 'JSON' });
    titleWrap.appendChild(badge);
    var stats = D().el('span', { class: 'jt-panel-stats', text: '' });
    var viewToggle = D().el('span', { class: 'jt-viewtoggle', style: { display: 'none' } });
    var actions = D().el('div', { class: 'jt-panel-actions' });
    head.appendChild(titleWrap);
    head.appendChild(stats);
    head.appendChild(viewToggle);
    head.appendChild(actions);

    var body = D().el('div', { class: 'jt-panel-body' });
    var gutter = D().el('div', { class: 'jt-gutter', 'aria-hidden': 'true' });
    var gutterInner = D().el('div', { class: 'jt-gutter-inner' });
    gutter.appendChild(gutterInner);

    var area = D().el('div', { class: 'jt-area' });
    var textarea = null, codeView = null, emptyHint = null;

    if (mode === 'edit') {
      textarea = D().el('textarea', {
        class: 'jt-textarea', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off',
        autocorrect: 'off', wrap: 'off', placeholder: opts.placeholder || ''
      });
      area.appendChild(textarea);
    } else {
      codeView = D().el('pre', { class: 'jt-code' });
      area.appendChild(codeView);
    }
    emptyHint = D().el('div', { class: 'jt-empty' });
    emptyHint.innerHTML = opts.emptyHtml || (
      '<div class="jt-empty-inner">' +
      '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>' +
      '<p>在此粘贴 JSON，或拖拽文件到这里</p>' +
      '<p class="jt-empty-sub">Ctrl+Enter 执行 · 点击「载入示例」快速开始</p></div>'
    );
    area.appendChild(emptyHint);

    body.appendChild(gutter);
    body.appendChild(area);

    /* --- 悬浮复制条（仅输出视图）：跟随悬停行，提供复制键 / 值 / 对象 / 数组 --- */
    var copybar = null, copybarInner = null;
    if (mode === 'view') {
      copybar = D().el('div', { class: 'jt-copybar' });
      copybarInner = D().el('div', { class: 'jt-copybar-inner' });
      copybar.appendChild(copybarInner);
      body.appendChild(copybar);
    }
    var onCopyFn = typeof opts.onCopy === 'function' ? opts.onCopy : copyText;

    var errBar = D().el('div', { class: 'jt-errbar', style: { display: 'none' } });

    root.appendChild(head);
    root.appendChild(body);
    root.appendChild(errBar);

    /* --- 行号（支持 JSON 折叠箭头） --- */
    var lineCount = 0;
    var viewText = '';   // 当前视图文本（getValue / setLang / refresh 使用）
    var fold = null;     // 折叠状态：{ lines, blocks, blockAtStart, lineEls, gEls, arrowEls, collapsed }
    var copybarLine = -1;

    function renderGutter(count) {
      lineCount = count;
      if (fold) {
        // 折叠模式：行号前渲染折叠箭头（仅块首行有）
        var html = '';
        for (var i = 0; i < count; i++) {
          var hasBlock = fold.blockAtStart[i] !== undefined;
          html += '<div class="jt-gline" data-i="' + i + '">' +
            '<span class="jt-fold"' + (hasBlock ? ' data-fold="' + i + '" title="折叠 / 展开"' : '') + '>' +
            (hasBlock ? '▾' : '') + '</span>' +
            '<span class="jt-gnum">' + (i + 1) + '</span></div>';
        }
        gutterInner.innerHTML = html;
        fold.gEls = gutterInner.querySelectorAll('.jt-gline');
        fold.arrowEls = {};
        for (var s in fold.blockAtStart) {
          var g = fold.gEls[s];
          if (g) fold.arrowEls[s] = g.firstChild;
        }
        return;
      }
      var html2 = '';
      for (var j = 1; j <= count; j++) html2 += '<div>' + j + '</div>';
      gutterInner.innerHTML = html2;
    }

    /* --- 统计 --- */
    function updateStats(text) {
      var t = String(text == null ? '' : text);
      var lines = t === '' ? 0 : t.split('\n').length;
      stats.textContent = lines + ' 行 · ' + t.length + ' 字符 · ' + formatBytes(utf8Bytes(t));
    }

    /* --- 空状态 --- */
    function updateEmpty(text) {
      var empty = String(text == null ? '' : text).trim() === '';
      if (empty) root.classList.add('jt-is-empty'); else root.classList.remove('jt-is-empty');
    }

    /* --- 滚动同步 --- */
    function syncScroll() {
      var scroller = mode === 'edit' ? textarea : area;
      if (scroller) gutter.scrollTop = scroller.scrollTop;
    }

    /* --- 视图渲染（JSON 输出走可折叠的逐行渲染，其余走整块高亮） --- */
    function renderBlob(text) {
      codeView.classList.remove('jt-code-lines');
      codeView.innerHTML = highlight(text, lang) + '\n';
      if (fold) { root.classList.remove('jt-foldable'); gutter.classList.remove('jt-gutter-fold'); }
      fold = null;
    }

    function renderView(text) {
      if (mode !== 'view' || !codeView) return;
      var t = String(text == null ? '' : text);
      viewText = t;
      fold = null;
      hideCopybar();

      // 仅当内容确实是合法 JSON（或 NDJSON 逐行合法）时启用折叠文本视图
      var canFold = (lang === 'json' || lang === 'ndjson') && t.length > 0;
      if (canFold && lang === 'json') {
        try { JSON.parse(t); } catch (e) { canFold = false; }
      }
      if (canFold && lang === 'ndjson') {
        var ndLines = t.split('\n');
        for (var k = 0; k < ndLines.length; k++) {
          if (!ndLines[k].trim()) continue;
          try { JSON.parse(ndLines[k]); } catch (e) { canFold = false; break; }
        }
      }
      var lines = t.split('\n');
      if (canFold && (lines.length > 8000 || t.length > 2 * 1024 * 1024)) canFold = false; // 超大内容性能保护
      if (!canFold) { renderBlob(t); renderGutter(Math.max(1, lines.length)); return; }

      var blocks = scanJsonBlocks(t);
      var blockAtStart = {};
      blocks.forEach(function (b) { blockAtStart[b.start] = b; });
      fold = { lines: lines, blocks: blocks, blockAtStart: blockAtStart, lineEls: [], gEls: [], arrowEls: {}, collapsed: {} };

      root.classList.add('jt-foldable');
      gutter.classList.add('jt-gutter-fold');
      var html = '';
      for (var i = 0; i < lines.length; i++) {
        html += '<div class="jt-cline" data-i="' + i + '">' + highlight(lines[i], 'json');
        var b = blockAtStart[i];
        if (b) html += '<span class="jt-fold-ell jt-fold-ell-' + (b.ch === '{' ? 'obj' : 'arr') + '"></span>';
        html += '</div>';
      }
      codeView.classList.add('jt-code-lines');
      codeView.innerHTML = html;
      fold.lineEls = codeView.querySelectorAll('.jt-cline');
      renderGutter(lines.length);
      applyFold();
    }

    /* --- 折叠：可见性重算（嵌套折叠时内层保持自身状态） --- */
    function applyFold() {
      if (!fold) return;
      var sorted = fold.blocks.slice().sort(function (a, b) { return a.start - b.start; });
      var idx = 0, maxEnd = -1;
      for (var i = 0; i < fold.lines.length; i++) {
        while (idx < sorted.length && sorted[idx].start < i) {
          if (fold.collapsed[sorted[idx].start]) maxEnd = Math.max(maxEnd, sorted[idx].end);
          idx++;
        }
        var hidden = i > 0 && maxEnd >= i;
        var el = fold.lineEls[i];
        if (el) el.classList.toggle('jt-cline-hidden', hidden);
        var g = fold.gEls[i];
        if (g) g.classList.toggle('jt-g-hidden', hidden);
      }
      // 同步箭头方向与行内省略号
      fold.blocks.forEach(function (b) {
        var collapsedNow = !!fold.collapsed[b.start];
        var arrow = fold.arrowEls[b.start];
        if (arrow) { arrow.textContent = collapsedNow ? '▸' : '▾'; arrow.title = collapsedNow ? '展开' : '折叠'; }
        var opener = fold.lineEls[b.start];
        if (opener) opener.classList.toggle('jt-collapsed', collapsedNow);
      });
    }

    function toggleFold(i) {
      if (!fold || fold.blockAtStart[i] === undefined) return;
      if (fold.collapsed[i]) delete fold.collapsed[i]; else fold.collapsed[i] = true;
      hideCopybar();
      applyFold();
    }

    /* --- 悬浮复制条 --- */
    /** 取块的源码切片；若闭括号行带尾随逗号（非末尾数组元素 / 后续键值对），去掉以保证复制结果为合法 JSON。 */
    function sliceBlock(b) {
      var ls = fold.lines.slice(b.start, b.end + 1);
      ls[ls.length - 1] = ls[ls.length - 1].replace(/^(\s*[}\]])\s*,/, '$1');
      return ls.join('\n');
    }

    /** 计算第 i 行可用的复制动作。 */
    function lineActions(i) {
      if (!fold) return [];
      var t = fold.lines[i].trim();
      if (!t) return [];
      if (/^[}\])],?$/.test(t)) return []; // 纯收尾括号行
      var b = fold.blockAtStart[i];
      var kv = parseKvLine(t);
      var acts = [];
      if (kv && kv.key != null) acts.push({ label: '复制键', tip: '复制键名', text: String(kv.key) });
      if (b) {
        var what = b.ch === '{' ? '对象' : '数组';
        acts.push({ label: '复制' + what, tip: '复制完整' + what + '（含子项）', text: sliceBlock(b) });
      } else if (kv) {
        acts.push({ label: '复制值', tip: '复制该值', text: kv.isString ? decodeJsonString(kv.rawValue) : kv.rawValue });
      } else {
        // 数组标量项（"foo", / 123,）或裸标量
        var v = t.replace(/,\s*$/, '');
        acts.push({ label: '复制值', tip: '复制该值', text: v.charAt(0) === '"' ? decodeJsonString(v) : v });
      }
      return acts;
    }

    function hideCopybar() {
      if (copybar) copybar.style.display = 'none';
      copybarLine = -1;
    }

    function showCopybar(i, lineEl) {
      var acts = lineActions(i);
      if (!acts.length) { hideCopybar(); return; }
      if (copybarLine !== i) {
        D().clear(copybarInner);
        acts.forEach(function (a) {
          copybarInner.appendChild(D().el('button', {
            class: 'jt-copybar-btn', type: 'button', text: a.label, title: a.tip,
            onclick: function () {
              Promise.resolve(onCopyFn(a.text)).then(function () { hideCopybar(); }, function () { hideCopybar(); });
            }
          }));
        });
        copybarLine = i;
      }
      var br = body.getBoundingClientRect();
      var lr = lineEl.getBoundingClientRect();
      copybar.style.display = 'block';
      copybar.style.top = Math.max(2, lr.top - br.top + lr.height / 2) + 'px';
      copybar.style.right = '10px';
    }

    function applyText(text) {
      text = String(text == null ? '' : text);
      if (mode === 'edit') {
        if (textarea.value !== text) textarea.value = text;
        renderGutter(Math.max(1, text === '' ? 1 : text.split('\n').length));
      } else {
        renderView(text); // view 模式行号由 renderView 内部渲染（含折叠箭头）
      }
      updateStats(text);
      updateEmpty(text);
      // 内容整体替换（载入示例 / 粘贴 / 回灌输出 / 清空）后滚动位置归零，行号槽与正文同步
      var scroller = (mode === 'edit') ? textarea : area;
      if (scroller) scroller.scrollTop = 0;
      gutter.scrollTop = 0;
    }

    if (mode === 'edit') {
      textarea.addEventListener('input', function () {
        renderGutter(Math.max(1, textarea.value.split('\n').length));
        updateStats(textarea.value);
        updateEmpty(textarea.value);
        if (typeof opts.onInput === 'function') opts.onInput(textarea.value);
      });
      textarea.addEventListener('scroll', syncScroll);
      textarea.addEventListener('keydown', function (e) {
        if (e.key === 'Tab') {
          e.preventDefault();
          var s = textarea.selectionStart, en = textarea.selectionEnd;
          textarea.value = textarea.value.slice(0, s) + '  ' + textarea.value.slice(en);
          textarea.selectionStart = textarea.selectionEnd = s + 2;
          textarea.dispatchEvent(new Event('input'));
        }
      });
      // 拖拽上传
      textarea.addEventListener('dragover', function (e) { e.preventDefault(); root.classList.add('jt-dragover'); });
      textarea.addEventListener('dragleave', function () { root.classList.remove('jt-dragover'); });
      textarea.addEventListener('drop', function (e) {
        e.preventDefault();
        root.classList.remove('jt-dragover');
        if (typeof opts.onDrop === 'function') opts.onDrop(e);
      });
    } else {
      area.addEventListener('scroll', function () { syncScroll(); hideCopybar(); });
      // 折叠箭头点击（事件委托，行号槽）
      gutterInner.addEventListener('click', function (e) {
        if (!fold) return;
        var f = e.target && e.target.closest ? e.target.closest('.jt-fold') : null;
        if (!f) return;
        var i = f.getAttribute('data-fold');
        if (i != null && i !== '') toggleFold(parseInt(i, 10));
      });
      // 悬停行 → 悬浮复制条
      codeView.addEventListener('mousemove', function (e) {
        if (!fold) return;
        var el = e.target && e.target.closest ? e.target.closest('.jt-cline') : null;
        if (!el) { hideCopybar(); return; }
        showCopybar(parseInt(el.getAttribute('data-i'), 10), el);
      });
      area.addEventListener('mouseleave', hideCopybar);
    }

    /* --- 操作按钮 --- */
    function setActions(list) {
      D().clear(actions);
      (list || []).forEach(function (a) {
        if (!a) return;
        var btn = D().el('button', {
          class: 'jt-tool-btn', type: 'button', title: a.title || a.id || '',
          'aria-label': a.title || a.id || '',
          html: a.svg || '<span>' + esc(a.label || '') + '</span>',
          onclick: function () { if (typeof a.onClick === 'function') a.onClick(); }
        });
        actions.appendChild(btn);
      });
    }
    setActions(opts.actions);

    // 初始渲染
    applyText(opts.value || '');

    return {
      root: root,
      mode: mode,
      getValue: function () { return mode === 'edit' ? textarea.value : viewText; },
      setValue: applyText,
      setTitle: function (t) { badge.textContent = t; },
      setLang: function (l) { lang = l; if (mode !== 'edit') renderView(viewText); },
      setActions: setActions,
      setError: function (err) {
        if (!err) { errBar.style.display = 'none'; return; }
        D().clear(errBar);
        errBar.style.display = '';
        errBar.appendChild(D().el('span', { class: 'jt-errbar-line', text: err.line ? '第 ' + err.line + ' 行' : '错误' }));
        errBar.appendChild(D().el('span', { class: 'jt-errbar-msg', text: err.message || '' }));
        if (err.line && mode === 'edit') {
          errBar.appendChild(D().el('button', {
            class: 'jt-linkbtn', type: 'button', text: '定位',
            onclick: function () { locateLine(err.line, err.column); }
          }));
        }
      },
      clearError: function () { errBar.style.display = 'none'; },
      focus: function () { if (textarea) textarea.focus(); },
      scrollTo: function (top) { var s = mode === 'edit' ? textarea : area; if (s) s.scrollTop = top; },
      getScroller: function () { return mode === 'edit' ? textarea : area; },
      refresh: function () { if (mode !== 'edit') renderView(viewText); syncScroll(); },
      /** 用自定义节点替换正文（用于树形 / diff 等视图），opts:{keepGutter} */
      setCustom: function (node, opts) {
        opts = opts || {};
        fold = null;
        hideCopybar();
        renderGutter(lineCount); // 恢复无箭头的普通行号
        gutter.style.display = opts.keepGutter ? '' : 'none';
        D().clear(area);
        emptyHint.style.display = 'none';
        if (node) area.appendChild(node);
        area.scrollTop = 0;
      },
      /** 恢复为文本/代码正文显示 */
      setTextMode: function () {
        gutter.style.display = '';
        D().clear(area);
        if (mode === 'edit') area.appendChild(textarea);
        else if (codeView) area.appendChild(codeView);
        area.appendChild(emptyHint);
      },
      setStatsText: function (t) { stats.textContent = t; },
      /**
       * 设置输出面板头部的「文本 / 树形」视图切换控件。
       * opt: { visible, mode:'text'|'tree', treeDisabled, disabledTip, onSelect(mode) }
       */
      setViewToggle: function (opt) {
        D().clear(viewToggle);
        if (!opt || !opt.visible) { viewToggle.style.display = 'none'; return; }
        viewToggle.style.display = '';
        var mode = opt.mode || 'text';
        var btnText = D().el('button', {
          class: 'jt-seg' + (mode === 'text' ? ' active' : ''), type: 'button', text: '文本', title: '以文本显示',
          onclick: function () { if (typeof opt.onSelect === 'function') opt.onSelect('text'); }
        });
        var btnTree = D().el('button', {
          class: 'jt-seg' + (mode === 'tree' ? ' active' : '') + (opt.treeDisabled ? ' jt-seg-disabled' : ''), type: 'button', text: '树形',
          title: opt.treeDisabled ? (opt.disabledTip || '当前结果不支持树形视图') : '以树形结构显示',
          onclick: function () { if (opt.treeDisabled) return; if (typeof opt.onSelect === 'function') opt.onSelect('tree'); }
        });
        if (opt.treeDisabled) btnTree.disabled = true;
        viewToggle.appendChild(btnText);
        viewToggle.appendChild(btnTree);
      }
    };

    function locateLine(line, column) {
      if (!textarea) return;
      var lines = textarea.value.split('\n');
      var pos = 0;
      for (var i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
      pos += Math.max(0, (column || 1) - 1);
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
      // 粗略滚动到可视区
      var lineHeight = 20.8;
      textarea.scrollTop = Math.max(0, (line - 3) * lineHeight);
      syncScroll();
    }
  }

  /* ============================ 树形视图 ============================ */

  function createTree(opts) {
    opts = opts || {};
    var root = D().el('div', { class: 'jt-tree' });
    var notice = D().el('div', { class: 'jt-tree-notice', style: { display: 'none' } });
    root.appendChild(notice);

    var copyHandler = opts.onCopy || function (t) { copyText(t); };

    function valueClass(v) {
      if (v === null) return 'jt-v-null';
      if (Array.isArray(v)) return 'jt-v-array';
      var t = typeof v;
      if (t === 'object') return 'jt-v-object';
      if (t === 'number') return 'jt-v-number';
      if (t === 'boolean') return 'jt-v-boolean';
      return 'jt-v-string';
    }
    function preview(v) {
      if (v === null) return 'null';
      if (typeof v === 'string') return '"' + (v.length > 120 ? v.slice(0, 120) + '…' : v) + '"';
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      if (Array.isArray(v)) return '[' + v.length + ' 项]';
      return '{' + Object.keys(v).length + ' 项}';
    }
    function isLeaf(v) { return v === null || typeof v !== 'object'; }

    var rootContainer = null;

    /**
     * 构建一个树节点。
     * @param {string|number|null} key 键名（根节点为 null）
     * @param {*} value 值
     * @param {string} path 完整路径
     * @param {number} depth 深度（根为 0）
     * @param {number} expandTo 默认展开到的最大深度（该深度及以上的容器节点默认展开）
     * @returns {{node:Object, row:Object, children:Array, leaf:boolean, setOpen:Function}}
     */
    function buildNode(key, value, path, depth, expandTo) {
      var node = D().el('div', { class: 'jt-tnode' });
      var row = D().el('div', { class: 'jt-trow' });
      row.style.paddingLeft = (depth * 16) + 'px';
      var childrenBox = null;
      var toggle = null;
      var built = false;
      var leaf = isLeaf(value);
      var self = { node: node, row: row, children: [], leaf: leaf, setOpen: function () {} };

      if (!leaf) {
        toggle = D().el('span', {
          class: 'jt-ttoggle', html: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'
        });
        row.appendChild(toggle);
        childrenBox = D().el('div', { class: 'jt-tchildren', style: { display: 'none' } });

        function buildChildren() {
          if (built) return;
          built = true;
          var keys = Array.isArray(value) ? value.map(function (_, i) { return i; }) : Object.keys(value);
          keys.forEach(function (k) {
            var child = buildNode(k, value[k], path + (Array.isArray(value) ? '[' + k + ']' : ('.' + k)), depth + 1, expandTo);
            self.children.push(child);
            childrenBox.appendChild(child.node);
          });
        }
        self.setOpen = function (open) {
          if (open && !built) buildChildren();
          childrenBox.style.display = open ? '' : 'none';
          toggle.classList.toggle('jt-open', open);
        };
        row.addEventListener('click', function (e) {
          if (e.target.closest('.jt-tact')) return;
          self.setOpen(childrenBox.style.display === 'none');
        });
      } else {
        row.appendChild(D().el('span', { class: 'jt-tspacer' }));
      }

      if (key !== null && key !== undefined) {
        row.appendChild(D().el('span', { class: 'jt-tkey' + (typeof key === 'number' ? ' jt-tkey-num' : ''), text: String(key) }));
        row.appendChild(D().el('span', { class: 'jt-tcolon', text: ':' }));
      }
      row.appendChild(D().el('span', { class: 'jt-tval ' + valueClass(value), text: preview(value) }));

      var acts = D().el('span', { class: 'jt-tacts' });
      acts.appendChild(D().el('button', {
        class: 'jt-tact', type: 'button', title: '复制路径',
        html: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l6-6"/><path d="M10 6l1-1a4 4 0 0 1 6 6l-1 1"/><path d="M14 18l-1 1a4 4 0 0 1-6-6l1-1"/></svg>',
        onclick: function (e) { e.stopPropagation(); copyHandler(path); }
      }));
      acts.appendChild(D().el('button', {
        class: 'jt-tact', type: 'button', title: '复制值',
        html: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
        onclick: function (e) { e.stopPropagation(); copyHandler(leaf ? String(value) : JSON.stringify(value, null, 2)); }
      }));
      row.appendChild(acts);

      node.appendChild(row);
      if (childrenBox) node.appendChild(childrenBox);

      // 默认展开：depth <= expandTo 的容器节点直接展开，避免「整面板只有一个折叠根」
      if (!leaf && depth <= expandTo) self.setOpen(true);
      return self;
    }

    function countNodes(v, limit) {
      var n = 0;
      (function walk(x) {
        n++;
        if (n > limit) return;
        if (Array.isArray(x)) x.forEach(walk);
        else if (x && typeof x === 'object') Object.keys(x).forEach(function (k) { walk(x[k]); });
      })(v);
      return n;
    }

    /** 全部展开（带节点预算保护，超深超大文档不会无限递归）。 */
    function expandAll() {
      if (!rootContainer) return;
      var budget = 20000;
      (function walk(c) {
        if (budget <= 0) return;
        budget--;
        c.setOpen(true);
        c.children.forEach(walk);
      })(rootContainer);
    }

    /** 全部折叠。 */
    function collapseAll() {
      if (!rootContainer) return;
      (function walk(c) {
        c.children.forEach(walk);
        c.setOpen(false);
      })(rootContainer);
    }

    function render(value) {
      // 清空除 notice 外的内容（工具栏 + 树体每次重建）
      while (root.childNodes.length > 1) root.removeChild(root.lastChild);
      var n = countNodes(value, 30050);
      if (n > 3000) {
        notice.style.display = '';
        notice.textContent = '节点数约 ' + n + '，已启用懒加载（展开时才渲染子节点）以保护性能。';
      } else notice.style.display = 'none';

      // 默认展开深度：单根（数组 / 仅 1 个键的对象）展开到第 3 层，其余展开前 2 层；
      // 超大文档（>3000 节点）仅默认展开根节点，子节点保持懒加载。
      var singleRoot = Array.isArray(value) || (value !== null && typeof value === 'object' && Object.keys(value).length === 1);
      var expandTo = n > 3000 ? 0 : (singleRoot ? 2 : 1);

      var bar = D().el('div', { class: 'jt-tree-bar' });
      bar.appendChild(D().el('span', { class: 'jt-tree-bar-title', text: '树形视图' }));
      bar.appendChild(D().el('span', { class: 'jt-tree-bar-spacer' }));
      bar.appendChild(D().el('button', { class: 'jt-tree-bar-btn', type: 'button', text: '全部展开', title: '展开所有层级（超大文档可能较慢）', onclick: expandAll }));
      bar.appendChild(D().el('button', { class: 'jt-tree-bar-btn', type: 'button', text: '全部折叠', title: '折叠所有层级', onclick: collapseAll }));
      root.appendChild(bar);

      var body = D().el('div', { class: 'jt-tree-body' });
      rootContainer = buildNode(null, value, '$', 0, expandTo);
      body.appendChild(rootContainer.node);
      root.appendChild(body);
    }

    return { root: root, render: render };
  }

  /* ============================ 可拖拽分栏 ============================ */

  function createSplit(opts) {
    opts = opts || {};
    var container = opts.container;
    var left = opts.left, right = opts.right;
    var storage = (JT.storage && opts.storageKey) ? JT.storage : null;
    var ratio = storage ? storage.getPref(opts.storageKey, opts.ratio || 0.5) : (opts.ratio || 0.5);
    if (typeof ratio !== 'number' || ratio < 0.15 || ratio > 0.85) ratio = 0.5;

    var divider = D().el('div', { class: 'jt-splitter', role: 'separator', 'aria-label': '拖拽调整宽度', tabindex: '0' });
    container.appendChild(left);
    container.appendChild(divider);
    container.appendChild(right);

    function isVertical() {
      try { return window.getComputedStyle(container).flexDirection === 'column'; } catch (e) { return false; }
    }

    function apply(r) {
      ratio = Math.max(0.15, Math.min(0.85, r));
      left.style.flex = '0 0 ' + (ratio * 100) + '%';
      right.style.flex = '1 1 0%';
      if (storage) storage.setPref(opts.storageKey, ratio);
    }
    apply(ratio);

    var dragging = false;
    function start(e) {
      dragging = true;
      divider.classList.add('jt-active');
      document.body.classList.add('jt-col-resizing');
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) return;
      var rect = container.getBoundingClientRect();
      var vertical = isVertical();
      var r = vertical ? (e.clientY - rect.top) / rect.height : (e.clientX - rect.left) / rect.width;
      apply(r);
    }
    function end() {
      if (!dragging) return;
      dragging = false;
      divider.classList.remove('jt-active');
      document.body.classList.remove('jt-col-resizing');
    }
    divider.addEventListener('mousedown', start);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
    divider.addEventListener('dblclick', function () { apply(0.5); });
    divider.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { apply(ratio - 0.03); e.preventDefault(); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { apply(ratio + 0.03); e.preventDefault(); }
    });

    return { setRatio: apply, getRatio: function () { return ratio; }, divider: divider };
  }

  JT.editor = { create: createEditor, highlight: highlight, copy: copyText, utf8Bytes: utf8Bytes, formatBytes: formatBytes };
  JT.tree = { create: createTree };
  JT.split = { create: createSplit };
})();
