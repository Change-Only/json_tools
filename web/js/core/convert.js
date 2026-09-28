/*!
 * core/convert.js —— JSON 工具箱 · 格式转换纯逻辑层（零 DOM 依赖）
 * 职责：YAML / TOML / XML / CSV / QueryString / Properties / NDJSON / Markdown 与 JSON 双向互转
 * 依赖运行时注入的离线包 root.JSONToolboxLibs（仅 js-yaml / yaml / smol-toml 用到）。
 */
(function (root) {
  'use strict';

  var NS = (root.JTCore = root.JTCore || {});
  var J = function () { return root.JTCore && root.JTCore.json; };

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function libs() { return root.JSONToolboxLibs || null; }

  /* 把非 JSON 值（Date / undefined 等）规范化为 JSON 友好值 */
  function sanitize(v) {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(sanitize);
    if (v !== null && typeof v === 'object') {
      var o = {};
      Object.keys(v).forEach(function (k) { var s = sanitize(v[k]); if (s !== undefined) o[k] = s; });
      return o;
    }
    if (typeof v === 'function' || typeof v === 'undefined' || typeof v === 'symbol') return undefined;
    return v;
  }

  /* ============================ YAML ============================ */

  function jsonToYaml(value, opts) {
    opts = opts || {};
    var lib = libs();
    var indent = opts.indent == null ? 2 : parseInt(opts.indent, 10);
    if (isNaN(indent)) indent = 2;
    var lineWidth = opts.foldLongLines ? 80 : -1;
    var v = sanitize(value);
    if (lib && lib.jsyaml && typeof lib.jsyaml.dump === 'function') {
      return lib.jsyaml.dump(v, { indent: indent, lineWidth: lineWidth, noRefs: true, skipInvalid: true });
    }
    if (lib && lib.yaml && typeof lib.yaml.stringify === 'function') {
      return lib.yaml.stringify(v, { indent: indent, lineWidth: opts.foldLongLines ? 80 : 0 });
    }
    throw new Error('YAML 序列化库不可用，请确认 vendor/libs.js 已正确加载。');
  }

  function yamlToJson(text) {
    var lib = libs();
    if (lib && lib.jsyaml && typeof lib.jsyaml.load === 'function') {
      return sanitize(lib.jsyaml.load(String(text)));
    }
    if (lib && lib.yaml && typeof lib.yaml.parse === 'function') {
      return sanitize(lib.yaml.parse(String(text)));
    }
    throw new Error('YAML 解析库不可用，请确认 vendor/libs.js 已正确加载。');
  }

  /* ============================ TOML ============================ */

  /** 找出值为 null 的字段路径（TOML 无 null，会被丢弃）。 */
  function findNullPaths(value, prefix, out) {
    out = out || [];
    prefix = prefix || '';
    if (value === null) { out.push(prefix || '$'); return out; }
    if (Array.isArray(value)) value.forEach(function (e, i) { findNullPaths(e, prefix + '[' + i + ']', out); });
    else if (isObj(value)) Object.keys(value).forEach(function (k) { findNullPaths(value[k], prefix ? prefix + '.' + k : k, out); });
    return out;
  }

  /**
   * JSON → TOML。
   * @returns {{text:string, notices:string[]}}
   */
  function jsonToToml(value, opts) {
    opts = opts || {};
    var lib = libs();
    if (!lib || !lib.toml || typeof lib.toml.stringify !== 'function') {
      throw new Error('TOML 序列化库不可用，请确认 vendor/libs.js 已正确加载。');
    }
    var notices = [];
    var dropped = findNullPaths(value);
    if (dropped.length) {
      notices.push('TOML 不支持 null：以下 ' + dropped.length + ' 个字段已丢弃 → ' + dropped.slice(0, 20).join(', ') + (dropped.length > 20 ? ' …' : ''));
    }
    var clean = sanitize(pruneNull(value));
    var text;
    try {
      text = lib.toml.stringify(clean);
    } catch (e) {
      // 顶层必须是对象
      if (!isObj(clean)) throw new Error('TOML 的顶层结构必须是对象（table）：' + (e && e.message ? e.message : e));
      throw e;
    }
    return { text: text, notices: notices };
  }

  function pruneNull(v) {
    if (Array.isArray(v)) return v.map(pruneNull).filter(function (x) { return x !== null && x !== undefined; });
    if (isObj(v)) {
      var o = {};
      Object.keys(v).forEach(function (k) { var p = pruneNull(v[k]); if (p !== null && p !== undefined) o[k] = p; });
      return o;
    }
    return v;
  }

  function tomlToJson(text) {
    var lib = libs();
    if (!lib || !lib.toml || typeof lib.toml.parse !== 'function') {
      throw new Error('TOML 解析库不可用，请确认 vendor/libs.js 已正确加载。');
    }
    return sanitize(lib.toml.parse(String(text)));
  }

  /* ============================ XML ============================ */

  function decodeEntities(str) {
    var map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0' };
    return String(str).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, ent) {
      if (ent.charAt(0) === '#') {
        try {
          if (ent.charAt(1) === 'x' || ent.charAt(1) === 'X') return String.fromCodePoint(parseInt(ent.slice(2), 16));
          return String.fromCodePoint(parseInt(ent.slice(1), 10));
        } catch (e) { return m; }
      }
      return Object.prototype.hasOwnProperty.call(map, ent) ? map[ent] : m;
    });
  }
  function escapeText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** 极简 XML 解析器（纯 JS，无 DOM 依赖），返回根节点对象。 */
  function parseXml(str) {
    var s = String(str == null ? '' : str).replace(/^\uFEFF/, '');
    var i = 0, n = s.length;

    function trimWs() { while (i < n && /\s/.test(s.charAt(i))) i++; }
    function err(msg) { var e = new Error('XML 解析错误（位置 ' + i + '）：' + msg); e.xmlish = true; throw e; }

    function skipProlog() {
      while (true) {
        trimWs();
        if (s.substr(i, 4) === '<!--') { var e1 = s.indexOf('-->', i); i = e1 < 0 ? n : e1 + 3; continue; }
        if (s.substr(i, 2) === '<?') { var e2 = s.indexOf('?>', i); i = e2 < 0 ? n : e2 + 2; continue; }
        if (s.substr(i, 9) === '<!DOCTYPE' || s.substr(i, 2) === '<!') { var e3 = s.indexOf('>', i); i = e3 < 0 ? n : e3 + 1; continue; }
        break;
      }
    }

    function parseElement() {
      if (s.charAt(i) !== '<') err('期望 <');
      i++;
      var nameStart = i;
      while (i < n && !/[\s\/>]/.test(s.charAt(i))) i++;
      var name = s.slice(nameStart, i);
      if (!name) err('标签名为空');
      var node = { name: name, attrs: {}, children: [], text: '' };
      while (true) {
        trimWs();
        if (s.charAt(i) === '/' && s.charAt(i + 1) === '>') { i += 2; return node; }
        if (s.charAt(i) === '>') { i++; break; }
        if (i >= n) err('标签未闭合：<' + name + '>');
        var aStart = i;
        while (i < n && !/[\s=\/>]/.test(s.charAt(i))) i++;
        var aName = s.slice(aStart, i);
        trimWs();
        var aVal = '';
        if (s.charAt(i) === '=') {
          i++;
          trimWs();
          var q = s.charAt(i);
          if (q === '"' || q === "'") {
            i++;
            var vStart = i;
            while (i < n && s.charAt(i) !== q) i++;
            aVal = s.slice(vStart, i);
            i++;
          } else {
            var vStart2 = i;
            while (i < n && !/[\s>\/]/.test(s.charAt(i))) i++;
            aVal = s.slice(vStart2, i);
          }
        }
        if (aName) node.attrs[aName] = decodeEntities(aVal);
      }
      var textBuf = '';
      while (i < n) {
        var c = s.charAt(i);
        if (c === '<') {
          if (s.substr(i, 4) === '<!--') { var ce = s.indexOf('-->', i); i = ce < 0 ? n : ce + 3; continue; }
          if (s.substr(i, 9) === '<![CDATA[') { var cde = s.indexOf(']]>', i); var cd = s.slice(i + 9, cde < 0 ? n : cde); textBuf += cd; i = cde < 0 ? n : cde + 3; continue; }
          if (s.substr(i, 2) === '</') {
            i += 2;
            var cNameStart = i;
            while (i < n && s.charAt(i) !== '>') i++;
            var cName = s.slice(cNameStart, i).trim();
            i++;
            if (cName !== name) err('标签不匹配：<' + name + '> 与 </' + cName + '>');
            node.text += decodeEntities(textBuf);
            return node;
          }
          node.text += decodeEntities(textBuf);
          textBuf = '';
          node.children.push(parseElement());
          continue;
        }
        textBuf += c;
        i++;
      }
      node.text += decodeEntities(textBuf);
      return node;
    }

    skipProlog();
    if (s.charAt(i) !== '<') err('未找到根元素');
    return { root: parseElement() };
  }

  function nodeToValue(node, opts) {
    var obj = {};
    var hasAttr = false;
    Object.keys(node.attrs).forEach(function (k) { obj[opts.attrPrefix + k] = opts.coerce ? coerceScalar(node.attrs[k]) : node.attrs[k]; hasAttr = true; });
    var groups = {};
    node.children.forEach(function (c) {
      if (!groups[c.name]) groups[c.name] = [];
      groups[c.name].push(nodeToValue(c, opts));
    });
    var names = Object.keys(groups);
    names.forEach(function (nm) { obj[nm] = groups[nm].length === 1 ? groups[nm][0] : groups[nm]; });
    var text = node.text.trim();
    if (text) {
      if (!hasAttr && names.length === 0) return opts.coerce ? coerceScalar(text) : text;
      obj[opts.textKey] = opts.coerce ? coerceScalar(text) : text;
    }
    return obj;
  }

  function coerceScalar(s) {
    s = String(s).trim();
    if (s === '') return '';
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    if (/^-?\d+$/.test(s) && String(parseInt(s, 10)) === s) return parseInt(s, 10);
    if (/^-?\d*\.\d+([eE][-+]?\d+)?$/.test(s) || /^-?\d+[eE][-+]?\d+$/.test(s)) { var f = parseFloat(s); if (!isNaN(f)) return f; }
    return s;
  }

  function xmlOpts(opts) {
    opts = opts || {};
    return {
      rootName: opts.rootName || 'root',
      itemName: opts.itemName || 'item',
      attrPrefix: opts.attrPrefix == null ? '@_' : opts.attrPrefix,
      textKey: opts.textKey || '#text',
      indent: opts.indent == null ? 2 : parseInt(opts.indent, 10) || 0,
      coerce: opts.coerce !== false,
      declaration: opts.declaration !== false,
      // 可选：外部传入的告警收集数组，用于反馈 XML 无法无损表达的类型
      notices: Array.isArray(opts.notices) ? opts.notices : null
    };
  }

  /**
   * 收集 JSON 中无法在 XML 里无损表达的节点路径。
   * XML 没有 null / 空数组 / 空字符串的原生表示，它们都会被写成自闭合空元素 <x/>，
   * 再次解析回 JSON 时只能得到 {}，因此需要提示用户。
   */
  function collectXmlLossy(value, out, path) {
    if (value === null || value === undefined) { out.push(path || '根节点'); return; }
    if (Array.isArray(value)) {
      if (value.length === 0) { out.push(path || '根节点'); return; }
      value.forEach(function (v, i) { collectXmlLossy(v, out, path + '[' + i + ']'); });
      return;
    }
    if (isObj(value)) {
      Object.keys(value).forEach(function (k) {
        collectXmlLossy(value[k], out, path ? path + '.' + k : k);
      });
      return;
    }
    if (value === '') out.push(path || '根节点');
  }

  /** 统计 XML 中的「空元素」（无属性 / 无子节点 / 无文本），它们只能映射为 {}。 */
  function countEmptyElements(node, path, out) {
    var empty = Object.keys(node.attrs).length === 0 && node.children.length === 0 && node.text.trim() === '';
    if (empty) out.push(path);
    node.children.forEach(function (c) { countEmptyElements(c, path + '.' + c.name, out); });
  }

  function buildElement(name, value, level, o) {
    var pad = new Array(level + 1).join('  ');
    // 数组 → 重复同名元素（与解析端的分组规则对称，保证往返一致）
    if (Array.isArray(value)) {
      if (value.length === 0) return pad + '<' + name + '/>';
      return value.map(function (v) { return buildElement(name, v, level, o); }).join('\n');
    }
    var attrs = '';
    var kids = [];
    var text = null;
    if (isObj(value)) {
      Object.keys(value).forEach(function (k) {
        if (o.attrPrefix && k.indexOf(o.attrPrefix) === 0) attrs += ' ' + k.slice(o.attrPrefix.length) + '="' + escapeAttr(value[k]) + '"';
        else if (k === o.textKey) text = value[k];
        else kids.push(buildElement(k, value[k], level + 1, o));
      });
    } else {
      text = value === null || value === undefined ? '' : value;
    }
    if (kids.length === 0) {
      if (text === null || text === undefined || String(text) === '') return pad + '<' + name + attrs + '/>';
      return pad + '<' + name + attrs + '>' + escapeText(text) + '</' + name + '>';
    }
    var inner = kids.join('\n');
    if (text !== null && text !== undefined && String(text) !== '') inner = pad + '  ' + escapeText(text) + '\n' + inner;
    return pad + '<' + name + attrs + '>\n' + inner + '\n' + pad + '</' + name + '>';
  }

  /** JSON → XML。opts 可含 notices 数组以接收「类型无法无损表达」的告警。 */
  function jsonToXml(value, opts) {
    var o = xmlOpts(opts);
    var body;
    if (Array.isArray(value)) {
      // 顶层数组 → 重复 itemName 元素
      body = value.length ? value.map(function (v) { return buildElement(o.itemName, v, 0, o); }).join('\n') : buildElement(o.rootName, value, 0, o);
    } else {
      body = buildElement(o.rootName, value, 0, o);
    }
    if (o.notices) {
      var lossy = [];
      collectXmlLossy(value, lossy, '');
      if (lossy.length) {
        var shown = lossy.slice(0, 8).join('、');
        o.notices.push('XML 无法无损表达 null / 空数组 / 空字符串：以下 ' + lossy.length + ' 处将转为空元素 <../>，再转回 JSON 时会得到 {}。位置：' + shown + (lossy.length > 8 ? ' 等' : '') + '。');
      }
    }
    return (o.declaration ? '<?xml version="1.0" encoding="UTF-8"?>\n' : '') + body;
  }

  /** XML → JSON。opts 可含 notices 数组以接收「空元素类型不可判定」的告警。 */
  function xmlToJson(text, opts) {
    var o = xmlOpts(opts);
    var parsed = parseXml(text);
    var out = {};
    out[parsed.root.name] = nodeToValue(parsed.root, o);
    if (o.notices) {
      var empties = [];
      countEmptyElements(parsed.root, o.rootName || 'root', empties);
      if (empties.length) {
        o.notices.push('检测到 ' + empties.length + ' 个空元素（如 <x/>），已解析为 {}；XML 无法区分原始数据是 null / [] / "" 还是 {}。');
      }
    }
    return out;
  }

  /* ============================ CSV / TSV ============================ */

  function cellToString(v, opts) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
      if (opts.nested === 'json') return JSON.stringify(v);
      return JSON.stringify(v);
    }
    return String(v);
  }

  function collectColumns(rows, opts) {
    if (opts.columns && String(opts.columns).trim()) {
      return String(opts.columns).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }
    if (opts.nested === 'flatten') {
      var flat = rows.map(function (r) { return J().flatten(r, { separator: '.' }); });
      var seen = {};
      var cols = [];
      flat.forEach(function (f) { Object.keys(f).forEach(function (k) { if (!seen[k]) { seen[k] = 1; cols.push(k); } }); });
      return cols;
    }
    var seen2 = {};
    var cols2 = [];
    rows.forEach(function (r) {
      if (isObj(r)) Object.keys(r).forEach(function (k) { if (!seen2[k]) { seen2[k] = 1; cols2.push(k); } });
    });
    return cols2;
  }

  /**
   * JSON → CSV/TSV。
   * @returns {{text:string, notices:string[]}}
   */
  function jsonToCsv(value, opts) {
    opts = opts || {};
    var notices = [];
    var delim = opts.delimiter === 'tab' ? '\t' : (opts.delimiter || ',');
    if (delim === '\\t') delim = '\t';
    var header = opts.header !== false;
    var rows;
    if (Array.isArray(value)) rows = value;
    else if (isObj(value)) rows = [value];
    else rows = [{ value: value }];

    var allObjects = rows.every(function (r) { return isObj(r); });
    if (!allObjects) {
      notices.push('存在非对象元素，已按单列输出。');
      rows = rows.map(function (r) { return isObj(r) ? r : { value: r }; });
    }
    var cols = collectColumns(rows, opts);
    if (cols.length === 0) {
      // 数组套数组
      rows = rows.map(function (r) { var o = {}; (Array.isArray(r) ? r : [r]).forEach(function (x, i) { o['col' + (i + 1)] = x; }); return o; });
      cols = collectColumns(rows, opts);
    }

    function q(s) {
      s = String(s == null ? '' : s);
      if (s.indexOf(delim) >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    var lines = [];
    if (header) lines.push(cols.map(q).join(delim));
    rows.forEach(function (row) {
      var src = (opts.nested === 'flatten') ? J().flatten(row, { separator: '.' }) : row;
      lines.push(cols.map(function (c) { return q(cellToString(src[c], opts)); }).join(delim));
    });
    return { text: lines.join('\n'), notices: notices, columns: cols };
  }

  function parseCsvRows(text, delim) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0, n = text.length;
    while (i < n) {
      var c = text.charAt(i);
      if (inQuotes) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /** CSV/TSV → JSON。opts: {delimiter, header, coerce} */
  function csvToJson(text, opts) {
    opts = opts || {};
    var delim = opts.delimiter === 'tab' ? '\t' : (opts.delimiter || ',');
    if (delim === '\\t') delim = '\t';
    var rows = parseCsvRows(String(text == null ? '' : text), delim).filter(function (r) {
      return !(r.length === 1 && r[0] === '');
    });
    if (rows.length === 0) return [];
    var coerce = opts.coerce !== false;
    var doCoerce = function (s) { return coerce ? coerceScalar(s) : s; };
    if (opts.header === false) {
      return rows.map(function (r) { return r.map(doCoerce); });
    }
    var header = rows[0].map(function (h, idx) { return h === '' ? 'col' + (idx + 1) : h; });
    return rows.slice(1).map(function (r) {
      var o = {};
      header.forEach(function (h, idx) { o[h] = doCoerce(r[idx] === undefined ? '' : r[idx]); });
      return o;
    });
  }

  /* ============================ QueryString ============================ */

  function qsEncode(v) { return encodeURIComponent(v); }

  function flattenQuery(obj, opts) {
    opts = opts || {};
    var pairs = [];
    function walk(v, key) {
      if (Array.isArray(v)) {
        v.forEach(function (e) {
          if (opts.arrayStyle === 'repeat') walk(e, key);
          else walk(e, key + '[]');
        });
      } else if (v !== null && typeof v === 'object') {
        Object.keys(v).forEach(function (k) { walk(v[k], key ? key + '.' + k : k); });
      } else {
        pairs.push([key, v === null || v === undefined ? '' : String(v)]);
      }
    }
    if (obj !== null && typeof obj === 'object') Object.keys(obj).forEach(function (k) { walk(obj[k], k); });
    return pairs;
  }

  /** JSON → 查询串。opts: {arrayStyle:'bracket'|'repeat', leading:boolean} */
  function jsonToQuery(obj, opts) {
    opts = opts || {};
    var pairs = flattenQuery(obj, opts);
    var s = pairs.map(function (p) { return qsEncode(p[0]) + '=' + qsEncode(p[1]); }).join('&');
    return opts.leading ? (s ? '?' + s : '') : s;
  }

  function setQueryValue(target, key, value) {
    // 支持 a.b=1（点号嵌套）与 a[]=1（数组）
    var arrayKey = /\[\]$/.test(key);
    var baseKey = arrayKey ? key.replace(/\[\]$/, '') : key;
    var parts = baseKey.split('.');
    var cur = target;
    for (var i = 0; i < parts.length - 1; i++) {
      var p = parts[i];
      if (p === '') continue;
      if (cur[p] === undefined || typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
      cur = cur[p];
    }
    var last = parts[parts.length - 1];
    if (arrayKey) {
      if (!Array.isArray(cur[last])) cur[last] = [];
      cur[last].push(value);
    } else if (Object.prototype.hasOwnProperty.call(cur, last)) {
      if (Array.isArray(cur[last])) cur[last].push(value);
      else cur[last] = [cur[last], value];
    } else {
      cur[last] = value;
    }
  }

  /** 查询串 → JSON。opts:{coerce} */
  function queryToJson(text, opts) {
    opts = opts || {};
    var s = String(text == null ? '' : text).trim().replace(/^[?#]/, '');
    var out = {};
    if (!s) return out;
    s.split('&').forEach(function (pair) {
      if (pair === '') return;
      var idx = pair.indexOf('=');
      var k = idx < 0 ? pair : pair.slice(0, idx);
      var v = idx < 0 ? '' : pair.slice(idx + 1);
      try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch (e) { /* 保留 */ }
      try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* 保留 */ }
      if (opts.coerce !== false) v = coerceScalar(v);
      setQueryValue(out, k, v);
    });
    return out;
  }

  /* ============================ Properties / .env ============================ */

  /** JSON → .env / Properties。opts:{delimiter:'='|':', quote:boolean} */
  function jsonToProperties(obj, opts) {
    opts = opts || {};
    var delim = opts.delimiter === 'colon' ? ':' : (opts.delimiter || '=');
    if (delim === ':') delim = ' : ';
    var quote = !!opts.quote;
    var lines = [];
    function walk(v, prefix) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        Object.keys(v).forEach(function (k) { walk(v[k], prefix ? prefix + '.' + k : k); });
        return;
      }
      if (Array.isArray(v)) {
        v.forEach(function (e, i) { walk(e, prefix + '[' + i + ']'); });
        return;
      }
      var val = v === null || v === undefined ? '' : String(v);
      if (quote && (val === '' || /[\s#!=:]/.test(val) || /[\u4e00-\u9fa5]/.test(val))) val = '"' + val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
      lines.push(prefix + delim + val);
    }
    if (obj !== null && typeof obj === 'object') Object.keys(obj).forEach(function (k) { walk(obj[k], k); });
    else lines.push('value' + delim + String(obj));
    return lines.join('\n');
  }

  /** .env / Properties → JSON。opts:{coerce} */
  function propertiesToJson(text, opts) {
    opts = opts || {};
    var s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var lines = s.split(/\r?\n/);
    var out = {};
    var buf = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (buf === '') {
        var t = line.replace(/^\s+/, '');
        if (t === '' || t.charAt(0) === '#' || t.charAt(0) === '!') continue;
        buf = line;
      } else {
        buf += '\n' + line;
      }
      // 续行：末尾为奇数个反斜杠
      var m = /(\\+)$/.exec(buf);
      if (m && m[1].length % 2 === 1) { buf = buf.slice(0, -1); continue; }
      var work = buf;
      buf = '';
      var sepMatch = /^[^=:]*[=:]/.exec(work);
      var key, val;
      if (sepMatch) {
        var sepIdx = work.search(/[=:]/);
        key = work.slice(0, sepIdx).trim();
        val = work.slice(sepIdx + 1).trim();
      } else {
        key = work.trim();
        val = '';
      }
      // 处理转义
      val = val.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\u([0-9a-fA-F]{4})/g, function (mm, h) { return String.fromCharCode(parseInt(h, 16)); });
      if ((val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') || (val.charAt(0) === "'" && val.charAt(val.length - 1) === "'")) {
        val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      }
      out[key] = opts.coerce !== false ? coerceScalar(val) : val;
    }
    return out;
  }

  /* ============================ NDJSON / JSON Lines ============================ */

  /** JSON → NDJSON（每行一个 JSON）。 */
  function jsonToNdjson(value) {
    var arr = Array.isArray(value) ? value : [value];
    return arr.map(function (v) { return JSON.stringify(v); }).join('\n');
  }

  /** NDJSON → JSON 数组。 */
  function ndjsonToJson(text) {
    var out = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
      var t = line.trim();
      if (t === '') return;
      out.push(JSON.parse(t));
    });
    return out;
  }

  /* ============================ Markdown ============================ */

  function mdCell(v) {
    var s = (v === null || v === undefined) ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  /** JSON → Markdown 表格。opts:{path} 指定数据路径。 */
  function jsonToMarkdown(value, opts) {
    opts = opts || {};
    var data = value;
    if (opts.path) {
      var j = J();
      data = j.getByPath(value, opts.path);
    }
    if (!Array.isArray(data)) {
      if (isObj(data)) data = [data];
      else return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
    }
    if (data.length === 0) return '（空数组）';
    var cols = [];
    var seen = {};
    data.forEach(function (row) {
      if (isObj(row)) Object.keys(row).forEach(function (k) { if (!seen[k]) { seen[k] = 1; cols.push(k); } });
    });
    if (cols.length === 0) {
      var lines0 = ['| # | 值 |', '| --- | --- |'];
      data.forEach(function (v, i) { lines0.push('| ' + i + ' | ' + mdCell(v) + ' |'); });
      return lines0.join('\n');
    }
    var head = '| ' + cols.join(' | ') + ' |';
    var sep = '| ' + cols.map(function () { return '---'; }).join(' | ') + ' |';
    var body = data.map(function (row) {
      return '| ' + cols.map(function (c) { return mdCell(isObj(row) ? row[c] : ''); }).join(' | ') + ' |';
    });
    return [head, sep].concat(body).join('\n');
  }

  /* ============================ 导出 ============================ */

  NS.convert = {
    sanitize: sanitize,
    coerceScalar: coerceScalar,
    // YAML
    jsonToYaml: jsonToYaml,
    yamlToJson: yamlToJson,
    // TOML
    jsonToToml: jsonToToml,
    tomlToJson: tomlToJson,
    findNullPaths: findNullPaths,
    // XML
    jsonToXml: jsonToXml,
    xmlToJson: xmlToJson,
    parseXml: parseXml,
    // CSV
    jsonToCsv: jsonToCsv,
    csvToJson: csvToJson,
    // QueryString
    jsonToQuery: jsonToQuery,
    queryToJson: queryToJson,
    // Properties
    jsonToProperties: jsonToProperties,
    propertiesToJson: propertiesToJson,
    // NDJSON
    jsonToNdjson: jsonToNdjson,
    ndjsonToJson: ndjsonToJson,
    // Markdown
    jsonToMarkdown: jsonToMarkdown
  };
})(typeof window !== 'undefined' ? window : globalThis);
