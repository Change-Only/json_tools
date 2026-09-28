/*!
 * core/json.js —— JSON 工具箱 · 纯逻辑层（零 DOM 依赖）
 * 职责：解析 / 宽松修复 / 格式化 / 压缩 / 排序 / 去重 / 深合并 / diff / 统计 / 路径 / JSONPath
 * 加载方式：浏览器 <script> 或 Node（globalThis）。
 * 注意：本文件在「加载时」不得访问 document / window 特有 API，仅通过 root 命名空间挂载。
 */
(function (root) {
  'use strict';

  var NS = (root.JTCore = root.JTCore || {});

  /* ============================ 基础工具 ============================ */

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isArr(v) { return Array.isArray(v); }
  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }
  function hex4(code) { return ('000' + code.toString(16)).slice(-4); }
  function toInt(v, dflt) {
    var n = parseInt(v, 10);
    return isNaN(n) ? dflt : n;
  }
  function clone(v) {
    if (v === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
  }
  function safeStr(v) {
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  function utf8Bytes(text) {
    text = String(text == null ? '' : text);
    if (typeof TextEncoder !== 'undefined') {
      try { return new TextEncoder().encode(text).length; } catch (e) { /* 回退 */ }
    }
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
  function samePrimitive(a, b) {
    if (typeof a === 'number' && typeof b === 'number' && isNaN(a) && isNaN(b)) return true;
    return a === b;
  }

  /* ============================ 解析 ============================ */

  /** 计算某字符下标所在的行/列（均 1 基）。 */
  function lineColOf(text, position) {
    var line = 1, col = 1;
    var p = Math.max(0, Math.min(position, text.length));
    for (var i = 0; i < p; i++) {
      if (text.charAt(i) === '\n') { line++; col = 1; } else { col++; }
    }
    return { line: line, column: col };
  }

  /** 生成错误上下文片段：前一行 / 当前行 / 后一行。 */
  function snippetOf(text, line) {
    var lines = text.split('\n');
    var idx = Math.max(0, Math.min((line || 1) - 1, lines.length - 1));
    var out = [];
    if (idx - 1 >= 0) out.push({ line: idx, text: lines[idx - 1], current: false });
    out.push({ line: idx + 1, text: lines[idx], current: true });
    if (idx + 1 < lines.length) out.push({ line: idx + 2, text: lines[idx + 1], current: false });
    return out;
  }

  /** 逐字符扫描，返回首个语法错误的下标（用于补齐 V8 未给出 position 的情况）。 */
  function scanError(src) {
    var i = 0, n = src.length;
    function ws() { while (i < n && /\s/.test(src.charAt(i))) i++; }
    function parseString() {
      i++;
      while (i < n) {
        var c = src.charAt(i);
        if (c === '\\') { i += 2; continue; }
        if (c === '"') { i++; return true; }
        if (c < '\u0020') return false;
        i++;
      }
      return false;
    }
    function parseValue() {
      ws();
      var c = src.charAt(i);
      if (c === '{') return parseObject();
      if (c === '[') return parseArray();
      if (c === '"') return parseString();
      if (c === '-' || (c >= '0' && c <= '9')) { while (i < n && /[0-9eE+\-.]/.test(src.charAt(i))) i++; return true; }
      if (src.substr(i, 4) === 'true') { i += 4; return true; }
      if (src.substr(i, 5) === 'false') { i += 5; return true; }
      if (src.substr(i, 4) === 'null') { i += 4; return true; }
      return false;
    }
    function parseObject() {
      i++; ws();
      if (src.charAt(i) === '}') { i++; return true; }
      while (i < n) {
        ws();
        if (src.charAt(i) !== '"') return false;
        if (!parseString()) return false;
        ws();
        if (src.charAt(i) !== ':') return false;
        i++;
        if (!parseValue()) return false;
        ws();
        if (src.charAt(i) === ',') { i++; continue; }
        if (src.charAt(i) === '}') { i++; return true; }
        return false;
      }
      return false;
    }
    function parseArray() {
      i++; ws();
      if (src.charAt(i) === ']') { i++; return true; }
      while (i < n) {
        if (!parseValue()) return false;
        ws();
        if (src.charAt(i) === ',') { i++; continue; }
        if (src.charAt(i) === ']') { i++; return true; }
        return false;
      }
      return false;
    }
    if (src.trim() === '') return 0;
    var all = parseValue();
    ws();
    if (!all || i < n) return i;
    return -1;
  }

  /**
   * 严格解析 JSON。
   * @returns {{ok:boolean, value:*, error:?string, position:number, line:number, column:number, snippet:Array}}
   */
  function parse(text) {
    var src = String(text == null ? '' : text);
    if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);
    try {
      return { ok: true, value: JSON.parse(src), error: null, position: 0, line: 0, column: 0, snippet: [] };
    } catch (e) {
      var msg = (e && e.message) ? e.message : String(e);
      var position = -1;
      var m1 = /position\s+(\d+)/i.exec(msg);
      if (m1) position = parseInt(m1[1], 10);
      var line = 0, column = 0;
      var m2 = /line\s+(\d+)\s+column\s+(\d+)/i.exec(msg);
      if (m2) { line = parseInt(m2[1], 10); column = parseInt(m2[2], 10); }
      if (position < 0) { var fp = scanError(src); if (fp >= 0) position = fp; }
      if (!line && position >= 0) { var lc = lineColOf(src, position); line = lc.line; column = lc.column; }
      if (!line) { line = 1; column = 1; }
      return {
        ok: false, value: undefined, error: msg,
        position: position, line: line, column: column, snippet: snippetOf(src, line)
      };
    }
  }

  /* ---- 宽松修复 ---- */

  var QUOTE_PAIRS = { '"': '"', "'": "'", '\u201C': '\u201D', '\u2018': '\u2019', '\u300C': '\u300D', '\u300E': '\u300F' };

  function literalMap(w) {
    switch (w) {
      case 'true': case 'false': case 'null': return w;
      case 'True': return 'true';
      case 'False': return 'false';
      case 'None': case 'NaN': case 'Infinity': case 'undefined': return 'null';
      default: return null;
    }
  }

  /** 将一个字符串体的转义规范化为标准 JSON 双引号字符串体。 */
  function normalizeStringBody(raw) {
    var out = '';
    var i = 0, n = raw.length;
    while (i < n) {
      var ch = raw.charAt(i);
      if (ch === '\\' && i + 1 < n) {
        var nx = raw.charAt(i + 1);
        if (nx === "'") { out += "'"; i += 2; continue; }
        if (nx === '"') { out += '\\"'; i += 2; continue; }
        if ('/bfnrtu'.indexOf(nx) >= 0) { out += '\\' + nx; i += 2; continue; }
        out += nx; i += 2; continue; // 未知转义 → 去掉反斜杠
      }
      if (ch === '"') { out += '\\"'; i++; continue; }
      if (ch === '\n') { out += '\\n'; i++; continue; }
      if (ch === '\r') { out += '\\r'; i++; continue; }
      if (ch === '\t') { out += '\\t'; i++; continue; }
      var code = ch.charCodeAt(0);
      if (code < 0x20) { out += '\\u' + hex4(code); i++; continue; }
      out += ch; i++;
    }
    return out;
  }

  var FIX_LABELS = {
    bom: '移除 UTF-8 BOM 头',
    invisible: '移除不可见字符 / 全角空格',
    comments: '移除 // 与 /* */ 注释',
    quotes: '单引号 / 中文引号 → 双引号',
    trailingComma: '移除多余尾逗号',
    bareKey: '裸键自动补引号',
    literals: 'NaN/Infinity/True/False/None → JSON 字面量',
    punctuation: '中文标点（，：；）→ 半角'
  };

  /**
   * 宽松修复：把「类 JSON」文本修复成合法 JSON 文本。
   * @returns {{text:string, fixes:string[], fixCount:number}}
   */
  function repair(text) {
    var src = String(text == null ? '' : text);
    var flags = { bom: false, invisible: false, comments: false, quotes: false, trailingComma: false, bareKey: false, literals: false, punctuation: false };

    if (src.charCodeAt(0) === 0xFEFF) { src = src.slice(1); flags.bom = true; }
    if (/[\u200B-\u200F\u2060\uFEFF\u180E]/.test(src)) { src = src.replace(/[\u200B-\u200F\u2060\uFEFF\u180E]/g, ''); flags.invisible = true; }
    if (/[\u00A0\u3000]/.test(src)) { src = src.replace(/[\u00A0\u3000]/g, ' '); flags.invisible = true; }

    var out = '';
    var i = 0, n = src.length;
    var stack = [];

    function top() { return stack.length ? stack[stack.length - 1] : null; }

    while (i < n) {
      var c = src.charAt(i);

      // 注释
      if (c === '/' && src.charAt(i + 1) === '/') { while (i < n && src.charAt(i) !== '\n') i++; flags.comments = true; continue; }
      if (c === '/' && src.charAt(i + 1) === '*') { i += 2; while (i < n && !(src.charAt(i) === '*' && src.charAt(i + 1) === '/')) i++; i += 2; flags.comments = true; continue; }

      // 字符串（双引号 / 单引号 / 中文引号）
      if (c === '"' || c === "'" || QUOTE_PAIRS[c]) {
        var closer = QUOTE_PAIRS[c] || c;
        var isDouble = (c === '"');
        var raw = '';
        var j = i + 1;
        var terminated = false;
        while (j < n) {
          var ch = src.charAt(j);
          if (ch === '\\') { raw += ch; if (j + 1 < n) raw += src.charAt(j + 1); j += 2; continue; }
          if (ch === closer) { terminated = true; break; }
          raw += ch; j++;
        }
        out += '"' + normalizeStringBody(raw) + '"';
        if (!isDouble) flags.quotes = true;
        i = terminated ? j + 1 : j;
        continue;
      }

      // 空白
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { out += c; i++; continue; }

      // 中文标点
      if (c === '\uFF0C') { c = ','; flags.punctuation = true; }
      else if (c === '\uFF1A') { c = ':'; flags.punctuation = true; }
      else if (c === '\uFF1B') { c = ';'; flags.punctuation = true; }

      if (c === '{') { stack.push('obj'); out += '{'; i++; continue; }
      if (c === '[') { stack.push('arr'); out += '['; i++; continue; }
      if (c === '}' || c === ']') { stack.pop(); out += c; i++; continue; }
      if (c === ':') { out += ':'; i++; continue; }

      // 逗号（含尾逗号检测）
      if (c === ',') {
        var k = i + 1;
        while (k < n && /\s/.test(src.charAt(k))) k++;
        var nxt = src.charAt(k);
        if (nxt === '}' || nxt === ']') { flags.trailingComma = true; i++; continue; }
        out += ',';
        i++;
        continue;
      }

      // 标识符 / 裸键 / 字面量
      if (/[A-Za-z_$\u00C0-\uFFFF]/.test(c)) {
        var start = i;
        while (i < n && /[A-Za-z0-9_$\u00C0-\uFFFF]/.test(src.charAt(i))) i++;
        var word = src.slice(start, i);
        var la = i;
        while (la < n && /\s/.test(src.charAt(la))) la++;
        var isKey = (src.charAt(la) === ':' || src.charAt(la) === '\uFF1A');
        if (isKey) { out += '"' + word + '"'; flags.bareKey = true; }
        else {
          var rep = literalMap(word);
          if (rep === null) { out += word; }
          else { out += rep; if (rep !== word) flags.literals = true; }
        }
        continue;
      }

      // 数字 / ±Infinity
      if (c === '-' || c === '+' || /[0-9.]/.test(c)) {
        var rest = src.slice(i);
        var mInf = /^[-+]?Infinity/.exec(rest);
        if (mInf) { out += 'null'; flags.literals = true; i += mInf[0].length; continue; }
        var mNum = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(rest);
        if (mNum) { out += mNum[0].replace(/^\+/, ''); i += mNum[0].length; continue; }
        out += c; i++; continue;
      }

      // 其它原样保留（后续解析会报错，交给 UI 提示）
      out += c; i++;
    }

    var fixes = [];
    Object.keys(flags).forEach(function (key) { if (flags[key]) fixes.push(FIX_LABELS[key]); });
    return { text: out, fixes: fixes, fixCount: fixes.length };
  }

  /** 宽松解析：先严格，失败则修复后重试。 */
  function parseLax(text) {
    var strict = parse(text);
    if (strict.ok) return { ok: true, value: strict.value, error: null, line: 0, column: 0, snippet: [], repairs: [], repaired: false };
    var r = repair(text);
    var second = parse(r.text);
    second.repairs = r.fixes;
    second.repairedText = r.text;
    second.repaired = true;
    return second;
  }

  /* ============================ 输出 ============================ */

  function escapeNonAsciiString(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c > 0x7F) out += '\\u' + hex4(c);
      else out += text.charAt(i);
    }
    return out;
  }

  /** 格式化输出。opts: {indent:2|4|8|'tab', sortKeys:'none'|'asc'|'desc', escapeNonAscii:boolean} */
  function stringify(value, opts) {
    opts = opts || {};
    var indent = opts.indent;
    if (indent === 'tab' || indent === '\t') indent = '\t';
    else if (typeof indent === 'string') indent = toInt(indent, 2);
    else if (typeof indent !== 'number') indent = 2;
    var v = value;
    if (opts.sortKeys && opts.sortKeys !== 'none') v = sortKeysDeep(v, { order: opts.sortKeys, recursive: true });
    var str = JSON.stringify(v, null, indent);
    if (str === undefined) str = '';
    if (opts.escapeNonAscii) str = escapeNonAsciiString(str);
    return str;
  }

  /** 压缩输出。opts: {escapeUnicode:boolean} */
  function minify(value, opts) {
    opts = opts || {};
    var str = JSON.stringify(value);
    if (str === undefined) str = '';
    if (opts.escapeUnicode || opts.escapeNonAscii) str = escapeNonAsciiString(str);
    return str;
  }

  /** 转义为可嵌入 JSON 字符串的字面量（含首尾双引号）。 */
  function escapeJson(text) { return JSON.stringify(String(text == null ? '' : text)); }

  /** 还原 JSON / JS 字符串字面量中的转义序列。 */
  function unescapeJson(text) {
    var s = String(text == null ? '' : text).trim();
    var m = /^(['"])([\s\S]*)\1$/.exec(s);
    var body = m ? m[2] : s;
    var out = '';
    var i = 0;
    while (i < body.length) {
      var ch = body.charAt(i);
      if (ch === '\\' && i + 1 < body.length) {
        var nx = body.charAt(i + 1);
        if (nx === 'n') { out += '\n'; i += 2; continue; }
        if (nx === 'r') { out += '\r'; i += 2; continue; }
        if (nx === 't') { out += '\t'; i += 2; continue; }
        if (nx === 'b') { out += '\b'; i += 2; continue; }
        if (nx === 'f') { out += '\f'; i += 2; continue; }
        if (nx === '/') { out += '/'; i += 2; continue; }
        if (nx === '\\') { out += '\\'; i += 2; continue; }
        if (nx === '"') { out += '"'; i += 2; continue; }
        if (nx === "'") { out += "'"; i += 2; continue; }
        if (nx === 'u') {
          var hex = body.substr(i + 2, 4);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 6; continue; }
        }
        out += nx; i += 2; continue;
      }
      out += ch; i++;
    }
    return out;
  }

  /** Unicode 转义。opts: {onlyNonAscii:boolean=true} */
  function unicodeEscape(text, opts) {
    opts = opts || {};
    var only = opts.onlyNonAscii !== false;
    var s = String(text == null ? '' : text);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (only && code <= 0x7F) out += s.charAt(i);
      else out += '\\u' + hex4(code);
    }
    return out;
  }

  /** Unicode 反转义（支持 \uXXXX 与 \u{XXXXX}）。 */
  function unicodeUnescape(text) {
    var s = String(text == null ? '' : text);
    return s.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, function (m, brace, four) {
      try {
        if (brace) return String.fromCodePoint(parseInt(brace, 16));
        return String.fromCharCode(parseInt(four, 16));
      } catch (e) { return m; }
    });
  }

  /* ============================ 排序 / 去重 ============================ */

  /** 递归按键名排序。opts: {order:'asc'|'desc', recursive:boolean=true} */
  function sortKeysDeep(value, opts) {
    opts = opts || {};
    var recursive = opts.recursive !== false;
    var desc = opts.order === 'desc';
    function walk(v) {
      if (Array.isArray(v)) return recursive ? v.map(walk) : v;
      if (isObj(v)) {
        var keys = Object.keys(v);
        keys.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
        if (desc) keys.reverse();
        var o = {};
        for (var i = 0; i < keys.length; i++) o[keys[i]] = recursive ? walk(v[keys[i]]) : v[keys[i]];
        return o;
      }
      return v;
    }
    return walk(value);
  }

  function toComparable(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') return v;
    return safeStr(v);
  }

  /** 数组排序。opts: {mode:'value'|'field', field, order:'asc'|'desc', numericFirst:boolean} */
  function sortArray(arr, opts) {
    opts = opts || {};
    if (!Array.isArray(arr)) return arr;
    var desc = opts.order === 'desc';
    var field = opts.field;
    var numericFirst = !!opts.numericFirst;
    function valueOf(item) {
      if (opts.mode === 'field' && field) return getByPath(item, field);
      return item;
    }
    var copy = arr.slice();
    copy.sort(function (a, b) {
      var va = valueOf(a), vb = valueOf(b);
      if (numericFirst) {
        var na = typeof va === 'number' || (typeof va === 'string' && va.trim() !== '' && !isNaN(Number(va)));
        var nb = typeof vb === 'number' || (typeof vb === 'string' && vb.trim() !== '' && !isNaN(Number(vb)));
        if (na && nb) { var d = Number(va) - Number(vb); return desc ? -d : d; }
        if (na !== nb) return na ? -1 : 1;
      }
      var ca = toComparable(va), cb = toComparable(vb);
      var r = ca < cb ? -1 : ca > cb ? 1 : 0;
      return desc ? -r : r;
    });
    return copy;
  }

  /** 去重。opts: {mode:'value'|'field', field} */
  function dedupe(arr, opts) {
    opts = opts || {};
    if (!Array.isArray(arr)) return arr;
    var seen = {};
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      var key = (opts.mode === 'field' && opts.field) ? safeStr(getByPath(item, opts.field)) : safeStr(item);
      if (!Object.prototype.hasOwnProperty.call(seen, key)) { seen[key] = true; out.push(item); }
    }
    return out;
  }

  /* ============================ 展平 / 还原 ============================ */

  /**
   * 把一条扁平键解析为「路径步骤」序列。
   * 步骤类型：{type:'key', name} 表示对象键；{type:'index', n} 表示数组下标。
   * 同时兼容规范写法 `a[0]` 与历史写法 `a.[0]`，二者均解析为 [a, index 0]。
   */
  function parseFlatKey(key, sep) {
    key = String(key == null ? '' : key);
    sep = sep || '.';
    var steps = [];
    var buf = '';
    var i = 0, n = key.length;
    function flushKey() { if (buf !== '') { steps.push({ type: 'key', name: buf }); buf = ''; } }
    while (i < n) {
      var c = key.charAt(i);
      if (c === '[') {
        var close = key.indexOf(']', i + 1);
        if (close < 0) { buf += c; i++; continue; }
        var inner = key.slice(i + 1, close);
        flushKey();
        if (/^\d+$/.test(inner.trim())) steps.push({ type: 'index', n: parseInt(inner.trim(), 10) });
        else steps.push({ type: 'key', name: inner });
        i = close + 1;
      } else if (sep && key.substr(i, sep.length) === sep) {
        flushKey();
        i += sep.length;
      } else {
        buf += c;
        i++;
      }
    }
    flushKey();
    return steps;
  }

  /** 展平：{"a":{"b":1}} → {"a.b":1}。opts: {separator='.', arrays:boolean=false} */
  function flatten(value, opts) {
    opts = opts || {};
    var sep = opts.separator || '.';
    var arrays = !!opts.arrays;
    var out = {};
    function walk(v, prefix) {
      if (Array.isArray(v)) {
        if (arrays) {
          if (v.length === 0 && prefix) { out[prefix] = []; return; }
          v.forEach(function (e, i) { walk(e, prefix + '[' + i + ']'); });
          return;
        }
        // 未启用数组展开：整段数组作为叶子值保留
        out[prefix] = v;
        return;
      }
      if (isObj(v)) {
        var keys = Object.keys(v);
        if (keys.length === 0 && prefix) { out[prefix] = {}; return; }
        keys.forEach(function (k) {
          var p = prefix ? prefix + sep + k : k;
          walk(v[k], p);
        });
        return;
      }
      out[prefix] = v;
    }
    walk(value, '');
    return out;
  }

  /**
   * 还原：{"a.b":1} → {"a":{"b":1}}，并完整支持数组下标还原（a[0] / a.[0]）。
   * opts: {separator='.', notices?: string[]}
   * 当扁平键之间存在容器类型冲突（同一路径既要求数组又要求对象）时，
   * 会向后出现的结构覆盖，并把说明推入 opts.notices（若提供）。
   */
  function unflatten(value, opts) {
    opts = opts || {};
    var sep = opts.separator || '.';
    var report = Array.isArray(opts.notices) ? opts.notices : null;
    if (!isObj(value) || Array.isArray(value)) return value;

    var root = null;

    function notice(msg) { if (report && report.indexOf(msg) < 0) report.push(msg); }

    function childContainer(container, key, wantArray, flatKey) {
      var existing = container[key];
      var ok = wantArray ? Array.isArray(existing) : (isObj(existing) && !Array.isArray(existing));
      if (!ok) {
        if (existing !== undefined) {
          notice('路径「' + flatKey + '」存在数组/对象类型冲突，已按后出现的结构覆盖，还原结果可能不精确。');
        }
        container[key] = wantArray ? [] : {};
      }
      return container[key];
    }

    Object.keys(value).forEach(function (flatKey) {
      var steps = parseFlatKey(flatKey, sep);
      if (!steps.length) return;
      if (root === null) root = (steps[0].type === 'index') ? [] : {};
      var cur = root;
      for (var i = 0; i < steps.length; i++) {
        var step = steps[i];
        var isLast = (i === steps.length - 1);
        var key = (step.type === 'index') ? step.n : step.name;
        if (isLast) {
          var prev = cur[key];
          if (prev !== undefined && (isObj(prev) || Array.isArray(prev))) {
            notice('键「' + flatKey + '」原为容器值，被同路径的标量值覆盖，还原结果可能不精确。');
          }
          cur[key] = value[flatKey];
        } else {
          var nextIsIndex = (steps[i + 1].type === 'index');
          cur = childContainer(cur, key, nextIsIndex, flatKey);
        }
      }
    });
    return root === null ? {} : root;
  }

  /* ============================ 清理 / 补全 / 合并 ============================ */

  /** 清理空值。opts: {null, emptyString, emptyArray, emptyObject} 均为 boolean */
  function cleanNulls(value, opts) {
    opts = opts || {};
    var rmNull = !!opts['null'];
    var rmEmptyStr = !!opts.emptyString;
    var rmEmptyArr = !!opts.emptyArray;
    var rmEmptyObj = !!opts.emptyObject;
    function isEmpty(v) {
      if (rmNull && v === null) return true;
      if (rmEmptyStr && v === '') return true;
      if (rmEmptyArr && Array.isArray(v) && v.length === 0) return true;
      if (rmEmptyObj && isObj(v) && Object.keys(v).length === 0) return true;
      return false;
    }
    function walk(v) {
      if (Array.isArray(v)) {
        var arr = [];
        v.forEach(function (e) {
          if (e !== null && typeof e === 'object') { var w = walk(e); if (!isEmpty(w)) arr.push(w); }
          else if (!isEmpty(e)) arr.push(e);
        });
        return arr;
      }
      if (isObj(v)) {
        var o = {};
        Object.keys(v).forEach(function (k) {
          var w = (v[k] !== null && typeof v[k] === 'object') ? walk(v[k]) : v[k];
          if (!isEmpty(w)) o[k] = w;
        });
        return o;
      }
      return v;
    }
    return walk(value);
  }

  /** 按模板补默认值（模板中独有的键会补入）。 */
  function fillDefaults(value, template) {
    if (isObj(template)) {
      var base = isObj(value) ? value : {};
      var out = {};
      Object.keys(base).forEach(function (k) { out[k] = base[k]; });
      Object.keys(template).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(out, k) || out[k] === undefined || out[k] === null) {
          out[k] = clone(template[k]);
        } else {
          out[k] = fillDefaults(out[k], template[k]);
        }
      });
      return out;
    }
    if (Array.isArray(template) && Array.isArray(value)) {
      var itemTpl = template.length ? template[0] : null;
      return value.map(function (v) { return itemTpl === null ? v : fillDefaults(v, itemTpl); });
    }
    return value === undefined ? clone(template) : value;
  }

  /** 深合并。opts: {conflict:'overwrite'|'keep'|'concat'} */
  function deepMerge(a, b, opts) {
    opts = opts || {};
    var conflict = opts.conflict || 'overwrite';
    function merge(x, y) {
      if (Array.isArray(x) && Array.isArray(y)) {
        if (conflict === 'concat') return x.concat(y.map(clone));
        if (conflict === 'keep') return clone(x);
        var r = x.slice();
        for (var i = 0; i < y.length; i++) r[i] = (i in r) ? merge(r[i], y[i]) : clone(y[i]);
        return r;
      }
      if (isObj(x) && isObj(y)) {
        var o = {};
        Object.keys(x).forEach(function (k) { o[k] = clone(x[k]); });
        Object.keys(y).forEach(function (k) {
          if (Object.prototype.hasOwnProperty.call(o, k)) {
            if (conflict === 'keep') return;
            o[k] = merge(o[k], y[k]);
          } else {
            o[k] = clone(y[k]);
          }
        });
        return o;
      }
      if (conflict === 'keep') return clone(x);
      return clone(y);
    }
    return merge(a, b);
  }

  /* ============================ Diff ============================ */

  /** 结构化差异对比，返回 [{path, type:'added'|'removed'|'changed', left, right}]。 */
  function diff(left, right) {
    var out = [];
    function walk(l, r, path) {
      var tl = l === undefined ? 'undefined' : typeOf(l);
      var tr = r === undefined ? 'undefined' : typeOf(r);
      if (l === undefined && r !== undefined) { out.push({ path: path, type: 'added', left: undefined, right: r }); return; }
      if (r === undefined && l !== undefined) { out.push({ path: path, type: 'removed', left: l, right: undefined }); return; }
      if (tl !== tr) { out.push({ path: path, type: 'changed', left: l, right: r }); return; }
      if (tl === 'object') {
        var keys = {};
        Object.keys(l).forEach(function (k) { keys[k] = 1; });
        Object.keys(r).forEach(function (k) { keys[k] = 1; });
        Object.keys(keys).sort().forEach(function (k) {
          var hasL = Object.prototype.hasOwnProperty.call(l, k);
          var hasR = Object.prototype.hasOwnProperty.call(r, k);
          if (hasL && !hasR) out.push({ path: path + '.' + k, type: 'removed', left: l[k], right: undefined });
          else if (!hasL && hasR) out.push({ path: path + '.' + k, type: 'added', left: undefined, right: r[k] });
          else walk(l[k], r[k], path + '.' + k);
        });
        return;
      }
      if (tl === 'array') {
        var max = Math.max(l.length, r.length);
        for (var i = 0; i < max; i++) {
          var pi = path + '[' + i + ']';
          if (i >= l.length) out.push({ path: pi, type: 'added', left: undefined, right: r[i] });
          else if (i >= r.length) out.push({ path: pi, type: 'removed', left: l[i], right: undefined });
          else walk(l[i], r[i], pi);
        }
        return;
      }
      if (!samePrimitive(l, r)) out.push({ path: path, type: 'changed', left: l, right: r });
    }
    walk(left, right, '$');
    return out;
  }

  /* ============================ 统计 ============================ */

  /** 结构统计。 */
  function stats(value) {
    var typeCounts = { object: 0, array: 0, string: 0, number: 0, boolean: 0, null: 0 };
    var depthCounts = {};
    var keyFreq = {};
    var arrayLengths = [];
    var objectFieldCounts = [];
    var nodes = 0, maxDepth = 0;
    function walk(v, depth) {
      nodes++;
      depthCounts[depth] = (depthCounts[depth] || 0) + 1;
      if (depth > maxDepth) maxDepth = depth;
      var t = typeOf(v);
      typeCounts[t] = (typeCounts[t] || 0) + 1;
      if (isObj(v)) {
        var ks = Object.keys(v);
        objectFieldCounts.push(ks.length);
        ks.forEach(function (k) { keyFreq[k] = (keyFreq[k] || 0) + 1; walk(v[k], depth + 1); });
      } else if (Array.isArray(v)) {
        arrayLengths.push(v.length);
        v.forEach(function (e) { walk(e, depth + 1); });
      }
    }
    walk(value, 1);
    var compact = '';
    try { compact = JSON.stringify(value) || ''; } catch (e) { compact = ''; }
    var pretty = '';
    try { pretty = JSON.stringify(value, null, 2) || ''; } catch (e) { pretty = ''; }
    return {
      nodes: nodes,
      maxDepth: maxDepth,
      typeCounts: typeCounts,
      depthCounts: depthCounts,
      keyFreq: keyFreq,
      arrayLengths: arrayLengths,
      objectFieldCounts: objectFieldCounts,
      chars: compact.length,
      bytes: utf8Bytes(compact),
      prettyBytes: utf8Bytes(pretty),
      lines: pretty ? pretty.split('\n').length : 0
    };
  }

  /* ============================ 路径 ============================ */

  /** 解析路径表达式（支持 a.b[0].c、$.a.b[0]、JSON Pointer /a/b）。 */
  function parsePath(path) {
    var s = String(path == null ? '' : path).trim();
    if (s === '' || s === '$') return [];
    // JSON Pointer（JSON Patch 常用）：/a/b/0
    if (s.charAt(0) === '/') {
      return s.split('/').slice(1).map(function (seg) { return seg.replace(/~1/g, '/').replace(/~0/g, '~'); });
    }
    var segs = [];
    var i = 0, n = s.length;
    if (s.charAt(0) === '$') i = 1;
    while (i < n) {
      var c = s.charAt(i);
      if (c === '.' || c === ' ') { i++; continue; }
      if (c === '[') {
        var end = s.indexOf(']', i);
        if (end < 0) end = n;
        var inner = s.slice(i + 1, end).trim();
        if ((inner.charAt(0) === '"' && inner.charAt(inner.length - 1) === '"') ||
            (inner.charAt(0) === "'" && inner.charAt(inner.length - 1) === "'")) inner = inner.slice(1, -1);
        segs.push(inner);
        i = end + 1;
        continue;
      }
      var start = i;
      while (i < n && s.charAt(i) !== '.' && s.charAt(i) !== '[') i++;
      var key = s.slice(start, i).trim();
      if (key !== '') segs.push(key);
    }
    return segs;
  }

  /** 按路径取值。 */
  function getByPath(value, path) {
    var segs = parsePath(path);
    var cur = value;
    for (var i = 0; i < segs.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      var seg = segs[i];
      if (Array.isArray(cur)) {
        if (seg.indexOf(':') >= 0) {
          var parts = seg.split(':');
          var s0 = parts[0] === '' ? 0 : toInt(parts[0], 0);
          var s1 = parts[1] === '' || parts[1] === undefined ? cur.length : toInt(parts[1], cur.length);
          cur = cur.slice(s0, s1);
          continue;
        }
        var idx = Number(seg);
        cur = cur[idx];
      } else if (isObj(cur)) {
        cur = cur[seg];
      } else {
        return undefined;
      }
    }
    return cur;
  }

  /** 按路径设值（自动创建中间容器）。 */
  function setByPath(value, path, newValue) {
    var segs = parsePath(path);
    if (segs.length === 0) return newValue;
    if (value === null || typeof value !== 'object') value = isNaN(Number(segs[0])) ? {} : [];
    var cur = value;
    for (var i = 0; i < segs.length - 1; i++) {
      var seg = segs[i];
      if (cur[seg] === null || typeof cur[seg] !== 'object') {
        cur[seg] = isNaN(Number(segs[i + 1])) ? {} : [];
      }
      cur = cur[seg];
    }
    cur[segs[segs.length - 1]] = newValue;
    return value;
  }

  /** 按路径删值。 */
  function deleteByPath(value, path) {
    var segs = parsePath(path);
    if (segs.length === 0) return value;
    var cur = value;
    for (var i = 0; i < segs.length - 1; i++) {
      if (cur === null || typeof cur !== 'object') return value;
      cur = cur[segs[i]];
    }
    if (cur !== null && typeof cur === 'object') {
      var last = segs[segs.length - 1];
      if (Array.isArray(cur)) cur.splice(Number(last), 1);
      else delete cur[last];
    }
    return value;
  }

  /** 列出所有叶子路径。opts: {style:'dot'|'jsonpath'} */
  function leafPaths(value, opts) {
    opts = opts || {};
    var style = opts.style || 'dot';
    var out = [];
    function fmt(p) {
      if (style === 'jsonpath') return p === '' ? '$' : '$' + p;
      return p === '' ? '$' : p.replace(/^\./, '');
    }
    function walk(v, path) {
      if (isObj(v)) {
        var ks = Object.keys(v);
        if (ks.length === 0) { out.push(fmt(path)); return; }
        ks.forEach(function (k) { walk(v[k], path + '.' + k); });
      } else if (Array.isArray(v)) {
        if (v.length === 0) { out.push(fmt(path)); return; }
        v.forEach(function (e, i) { walk(e, path + '[' + i + ']'); });
      } else {
        out.push(fmt(path));
      }
    }
    walk(value, '');
    if (out.length === 0) out.push(style === 'jsonpath' ? '$' : '$');
    return out;
  }

  /* ============================ JSONPath ============================ */

  function parseJsonPath(expr) {
    var s = String(expr == null ? '' : expr).trim();
    var segs = [];
    var i = 0, n = s.length;
    if (s.charAt(0) === '$') i = 1;
    else if (s.charAt(0) === '.') { /* 允许省略 $ */ }
    while (i < n) {
      var c = s.charAt(i);
      if (c === '.') {
        if (s.charAt(i + 1) === '.') {
          i += 2;
          if (s.charAt(i) === '*') { segs.push({ type: 'recursiveWildcard' }); i++; }
          else if (s.charAt(i) === '[') { segs.push({ type: 'recursive' }); }
          else {
            var st = i;
            while (i < n && s.charAt(i) !== '.' && s.charAt(i) !== '[') i++;
            segs.push({ type: 'recursive', key: s.slice(st, i) });
          }
        } else {
          i++;
          if (s.charAt(i) === '*') { segs.push({ type: 'wildcard' }); i++; }
          else if (s.charAt(i) === '[') { /* 交给下一轮 */ }
          else {
            var st2 = i;
            while (i < n && s.charAt(i) !== '.' && s.charAt(i) !== '[') i++;
            var name = s.slice(st2, i);
            if (name) segs.push({ type: 'child', key: name });
          }
        }
        continue;
      }
      if (c === '[') {
        i++;
        while (s.charAt(i) === ' ') i++;
        if (s.charAt(i) === '*') { i++; while (s.charAt(i) === ' ') i++; if (s.charAt(i) === ']') i++; segs.push({ type: 'wildcard' }); continue; }
        if (s.charAt(i) === "'" || s.charAt(i) === '"') {
          var q = s.charAt(i); i++;
          var st3 = i;
          while (i < n && s.charAt(i) !== q) i++;
          var key = s.slice(st3, i);
          i++;
          while (s.charAt(i) === ' ') i++;
          if (s.charAt(i) === ']') i++;
          segs.push({ type: 'child', key: key });
          continue;
        }
        var end = s.indexOf(']', i);
        if (end < 0) end = n;
        var inner = s.slice(i, end).trim();
        i = end + 1;
        if (inner.indexOf(':') >= 0) {
          var parts = inner.split(':');
          segs.push({ type: 'slice', start: parts[0] === '' ? null : parseInt(parts[0], 10), end: (parts[1] === undefined || parts[1] === '') ? null : parseInt(parts[1], 10) });
        } else if (/^-?\d+$/.test(inner)) {
          segs.push({ type: 'index', index: parseInt(inner, 10) });
        } else if (inner === '*') {
          segs.push({ type: 'wildcard' });
        } else {
          segs.push({ type: 'child', key: inner });
        }
        continue;
      }
      // 裸名字
      var st4 = i;
      while (i < n && s.charAt(i) !== '.' && s.charAt(i) !== '[') i++;
      var nm = s.slice(st4, i);
      if (nm) segs.push({ type: 'child', key: nm });
    }
    return segs;
  }

  function pathChild(path, key) {
    return path + (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? '.' + key : "['" + key + "']");
  }
  function pathIndex(path, idx) { return path + '[' + idx + ']'; }

  function collectDescendants(node, path, out) {
    out.push({ value: node.value, path: node.path });
    if (isObj(node.value)) Object.keys(node.value).forEach(function (k) { collectDescendants({ value: node.value[k], path: pathChild(node.path, k) }, pathChild(node.path, k), out); });
    else if (Array.isArray(node.value)) node.value.forEach(function (e, i) { collectDescendants({ value: e, path: pathIndex(node.path, i) }, pathIndex(node.path, i), out); });
  }

  /** JSONPath 查询，返回 [{value, path}]。 */
  function jsonPath(rootValue, expr) {
    var segs = parseJsonPath(expr);
    var current = [{ value: rootValue, path: '$' }];
    for (var si = 0; si < segs.length; si++) {
      var seg = segs[si];
      var next = [];
      for (var ci = 0; ci < current.length; ci++) {
        var node = current[ci];
        var v = node.value;
        if (seg.type === 'child') {
          if (v !== null && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, seg.key)) next.push({ value: v[seg.key], path: pathChild(node.path, seg.key) });
        } else if (seg.type === 'index') {
          if (Array.isArray(v)) {
            var idx = seg.index < 0 ? v.length + seg.index : seg.index;
            if (idx >= 0 && idx < v.length) next.push({ value: v[idx], path: pathIndex(node.path, idx) });
          }
        } else if (seg.type === 'wildcard') {
          if (Array.isArray(v)) v.forEach(function (e, i) { next.push({ value: e, path: pathIndex(node.path, i) }); });
          else if (isObj(v)) Object.keys(v).forEach(function (k) { next.push({ value: v[k], path: pathChild(node.path, k) }); });
        } else if (seg.type === 'slice') {
          if (Array.isArray(v)) {
            var s0 = seg.start === null ? 0 : (seg.start < 0 ? Math.max(0, v.length + seg.start) : seg.start);
            var s1 = seg.end === null ? v.length : (seg.end < 0 ? v.length + seg.end : seg.end);
            for (var k2 = s0; k2 < s1 && k2 < v.length; k2++) next.push({ value: v[k2], path: pathIndex(node.path, k2) });
          }
        } else if (seg.type === 'recursive') {
          var all = [];
          collectDescendants(node, node.path, all);
          all.forEach(function (desc) {
            if (desc.value !== null && typeof desc.value === 'object') {
              if (seg.key === undefined) {
                if (Array.isArray(desc.value)) desc.value.forEach(function (e, i) { next.push({ value: e, path: pathIndex(desc.path, i) }); });
                else Object.keys(desc.value).forEach(function (k) { next.push({ value: desc.value[k], path: pathChild(desc.path, k) }); });
              } else if (Object.prototype.hasOwnProperty.call(desc.value, seg.key)) {
                next.push({ value: desc.value[seg.key], path: pathChild(desc.path, seg.key) });
              }
            }
          });
        } else if (seg.type === 'recursiveWildcard') {
          var all2 = [];
          collectDescendants(node, node.path, all2);
          all2.forEach(function (d) { if (d.value !== node.value || d.path !== node.path) next.push(d); });
        }
      }
      current = next;
    }
    return current;
  }

  /* ============================ 键操作 ============================ */

  function toKeyList(keys) {
    if (Array.isArray(keys)) return keys;
    return String(keys == null ? '' : keys).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function globToRegExp(pattern) {
    return new RegExp('^' + String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  }

  /** 只保留指定键（递归）。 */
  function pickKeys(value, keys) {
    var list = toKeyList(keys);
    function walk(v) {
      if (isObj(v)) {
        var o = {};
        Object.keys(v).forEach(function (k) { if (list.indexOf(k) >= 0) o[k] = walk(v[k]); });
        return o;
      }
      if (Array.isArray(v)) return v.map(walk);
      return v;
    }
    return walk(value);
  }

  /** 删除指定键（递归，支持 * 通配）。 */
  function omitKeys(value, keys) {
    var patterns = toKeyList(keys);
    var regs = patterns.filter(function (p) { return p.indexOf('*') >= 0; }).map(globToRegExp);
    function match(k) {
      if (patterns.indexOf(k) >= 0) return true;
      for (var i = 0; i < regs.length; i++) if (regs[i].test(k)) return true;
      return false;
    }
    function walk(v) {
      if (isObj(v)) {
        var o = {};
        Object.keys(v).forEach(function (k) { if (!match(k)) o[k] = walk(v[k]); });
        return o;
      }
      if (Array.isArray(v)) return v.map(walk);
      return v;
    }
    return walk(value);
  }

  /** 递归收集指定 key 的值，返回 [{path, key, value}]。 */
  function collectKeys(value, keys) {
    var list = toKeyList(keys);
    var res = [];
    function walk(v, path) {
      if (isObj(v)) {
        Object.keys(v).forEach(function (k) {
          var p = pathChild(path, k);
          if (list.indexOf(k) >= 0) res.push({ path: p, key: k, value: v[k] });
          walk(v[k], p);
        });
      } else if (Array.isArray(v)) {
        v.forEach(function (e, i) { walk(e, pathIndex(path, i)); });
      }
    }
    walk(value, '$');
    return res;
  }

  /* ============================ 数据变换 ============================ */

  /** 数组字段投影：users→['name'] 或 {items:[...]}→'items[].id'。 */
  function pluck(arr, expr) {
    var raw = String(expr == null ? '' : expr).trim();
    if (!raw) return arr;
    var segs = raw.split('.').map(function (s) { return s.trim(); }).filter(Boolean);
    function apply(list, i) {
      if (i >= segs.length) return list;
      var seg = segs[i];
      var spread = /\[\]$/.test(seg);
      var key = seg.replace(/\[\]$/, '');
      var next = [];
      list.forEach(function (item) {
        var v = (item === null || item === undefined) ? undefined : item[key];
        if (Array.isArray(v) && spread) v.forEach(function (e) { next.push(e); });
        else next.push(v);
      });
      return apply(next, i + 1);
    }
    if (!Array.isArray(arr)) return [apply([arr], 0)];
    return apply(arr, 0);
  }

  /** 按字段分组。 */
  function groupBy(arr, field) {
    var map = {};
    var order = [];
    var labels = {};
    (arr || []).forEach(function (item) {
      var raw = getByPath(item, field);
      var key = safeStr(raw);
      if (!Object.prototype.hasOwnProperty.call(map, key)) {
        map[key] = [];
        order.push(key);
        labels[key] = (raw === null || typeof raw !== 'object') ? String(raw) : key;
      }
      map[key].push(item);
    });
    return order.map(function (k) { return { key: labels[k], rawKey: k, count: map[k].length, items: map[k] }; });
  }

  /** 聚合统计：对数值字段求 count/sum/avg/min/max。 */
  function aggregate(arr, fields) {
    var list = Array.isArray(fields) ? fields : toKeyList(fields);
    return list.map(function (field) {
      var nums = [];
      var count = 0;
      (arr || []).forEach(function (item) {
        var v = getByPath(item, field);
        if (v === undefined) return;
        count++;
        if (typeof v === 'number' && isFinite(v)) nums.push(v);
      });
      var row = { field: field, count: count, sum: null, avg: null, min: null, max: null };
      if (nums.length) {
        var sum = nums.reduce(function (a, b) { return a + b; }, 0);
        row.sum = sum;
        row.avg = sum / nums.length;
        row.min = Math.min.apply(null, nums);
        row.max = Math.max.apply(null, nums);
      }
      return row;
    });
  }

  /* ============================ JSON Patch ============================ */

  function opAdd(doc, segs, value) {
    if (segs.length === 0) return value;
    var cur = doc;
    for (var i = 0; i < segs.length - 1; i++) {
      if (cur === null || typeof cur !== 'object') throw new Error('路径不存在：' + segs.slice(0, i + 1).join('.'));
      cur = cur[segs[i]];
    }
    var last = segs[segs.length - 1];
    if (Array.isArray(cur)) {
      if (last === '-' || last === '') cur.push(value);
      else cur.splice(parseInt(last, 10), 0, value);
    } else if (cur !== null && typeof cur === 'object') {
      cur[last] = value;
    } else throw new Error('路径不存在：' + segs.join('.'));
    return doc;
  }
  function opRemove(doc, segs) {
    var cur = doc;
    for (var i = 0; i < segs.length - 1; i++) {
      if (cur === null || typeof cur !== 'object') throw new Error('路径不存在：' + segs.join('.'));
      cur = cur[segs[i]];
    }
    var last = segs[segs.length - 1];
    if (Array.isArray(cur)) cur.splice(parseInt(last, 10), 1);
    else if (cur !== null && typeof cur === 'object') delete cur[last];
    return doc;
  }
  function opReplace(doc, segs, value) {
    if (segs.length === 0) return value;
    return opAdd(doc, segs, value);
  }

  /** 应用 RFC6902 JSON Patch。 */
  function applyPatch(doc, patch) {
    var result = clone(doc);
    var ops = Array.isArray(patch) ? patch : (patch && patch.patch) || [];
    ops.forEach(function (op, idx) {
      var path = op.path || '';
      var segs = parsePath(path);
      switch (op.op) {
        case 'add': result = opAdd(result, segs, clone(op.value)); break;
        case 'remove': result = opRemove(result, segs); break;
        case 'replace': result = opReplace(result, segs, clone(op.value)); break;
        case 'move': {
          var mv = clone(getByPath(result, op.from));
          result = opRemove(result, parsePath(op.from));
          result = opAdd(result, segs, mv);
          break;
        }
        case 'copy': result = opAdd(result, segs, clone(getByPath(result, op.from))); break;
        case 'test': {
          var tv = getByPath(result, path);
          if (safeStr(tv) !== safeStr(op.value)) throw new Error('test 断言失败（第 ' + (idx + 1) + ' 条）：' + path);
          break;
        }
        default: throw new Error('未知 op：' + op.op);
      }
    });
    return result;
  }

  /* ============================ 导出 ============================ */

  NS.json = {
    isObj: isObj,
    isArr: isArr,
    typeOf: typeOf,
    clone: clone,
    safeStr: safeStr,
    utf8Bytes: utf8Bytes,
    lineColOf: lineColOf,
    snippetOf: snippetOf,
    parse: parse,
    parseLax: parseLax,
    repair: repair,
    stringify: stringify,
    minify: minify,
    escapeNonAsciiString: escapeNonAsciiString,
    escapeJson: escapeJson,
    unescapeJson: unescapeJson,
    unicodeEscape: unicodeEscape,
    unicodeUnescape: unicodeUnescape,
    sortKeysDeep: sortKeysDeep,
    sortArray: sortArray,
    dedupe: dedupe,
    flatten: flatten,
    unflatten: unflatten,
    cleanNulls: cleanNulls,
    fillDefaults: fillDefaults,
    deepMerge: deepMerge,
    diff: diff,
    stats: stats,
    parsePath: parsePath,
    getByPath: getByPath,
    setByPath: setByPath,
    deleteByPath: deleteByPath,
    leafPaths: leafPaths,
    jsonPath: jsonPath,
    pickKeys: pickKeys,
    omitKeys: omitKeys,
    collectKeys: collectKeys,
    pluck: pluck,
    groupBy: groupBy,
    aggregate: aggregate,
    applyPatch: applyPatch
  };
})(typeof window !== 'undefined' ? window : globalThis);
