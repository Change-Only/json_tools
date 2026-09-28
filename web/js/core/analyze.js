/*!
 * core/analyze.js —— JSON 工具箱 · 校验与分析纯逻辑层（零 DOM 依赖）
 * 职责：语法校验 / 重复键检测 / JSON Schema 校验 / 结构统计 / 体积对比 / 异常值 / 安全检查 / 差异 / 生成示例
 */
(function (root) {
  'use strict';

  var NS = (root.JTCore = root.JTCore || {});
  function J() { return root.JTCore.json; }

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  /* ============================ 语法校验 ============================ */

  /** JSON 语法校验，返回 json.parse 的结果（含 line/column/snippet）。 */
  function validateSyntax(text) {
    var res = J().parse(text);
    if (res.ok) return { valid: true, error: null, line: 0, column: 0, snippet: [] };
    return { valid: false, error: res.error, line: res.line, column: res.column, snippet: res.snippet, position: res.position };
  }

  /* ============================ 重复键检测 ============================ */

  /** 检测同一对象内的重复键，返回 {ok, duplicates:[{path,key}], error}。 */
  function findDuplicateKeys(text) {
    var s = String(text == null ? '' : text);
    var i = 0, n = s.length;
    var dups = [];
    function err(m) { throw new Error('第 ' + i + ' 字符附近：' + m); }
    function ws() { while (i < n && /\s/.test(s.charAt(i))) i++; }
    function parseString() {
      i++;
      var out = '';
      while (i < n) {
        var c = s.charAt(i);
        if (c === '\\') {
          var nx = s.charAt(i + 1);
          if (nx === 'u') { out += String.fromCharCode(parseInt(s.substr(i + 2, 4), 16)); i += 6; continue; }
          var map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
          out += (map[nx] !== undefined ? map[nx] : nx);
          i += 2; continue;
        }
        if (c === '"') { i++; return out; }
        out += c; i++;
      }
      err('字符串未闭合');
      return out;
    }
    function parseValue(path) {
      ws();
      var c = s.charAt(i);
      if (c === '{') { i++; parseObject(path); return; }
      if (c === '[') { i++; parseArray(path); return; }
      if (c === '"') { parseString(); return; }
      var start = i;
      while (i < n && !/[\s,\]\}]/.test(s.charAt(i))) i++;
      if (i === start && i < n) i++;
    }
    function parseObject(path) {
      ws();
      if (s.charAt(i) === '}') { i++; return; }
      var seen = {};
      while (i < n) {
        ws();
        if (s.charAt(i) === '}') { i++; return; }
        if (s.charAt(i) !== '"') {
          while (i < n && s.charAt(i) !== ',' && s.charAt(i) !== '}') i++;
          if (s.charAt(i) === '}') { i++; return; }
          i++; continue;
        }
        var key = parseString();
        var kp = path + '.' + key;
        if (Object.prototype.hasOwnProperty.call(seen, key)) dups.push({ path: kp, key: key, firstPos: seen[key], dupPos: i });
        else seen[key] = i;
        ws();
        if (s.charAt(i) === ':') { i++; parseValue(kp); }
        ws();
        if (s.charAt(i) === ',') { i++; continue; }
        if (s.charAt(i) === '}') { i++; return; }
        i++;
      }
    }
    function parseArray(path) {
      ws();
      if (s.charAt(i) === ']') { i++; return; }
      var idx = 0;
      while (i < n) {
        parseValue(path + '[' + idx + ']');
        idx++;
        ws();
        if (s.charAt(i) === ',') { i++; continue; }
        if (s.charAt(i) === ']') { i++; return; }
        i++;
      }
    }
    try { parseValue('$'); }
    catch (e) { return { ok: false, error: e.message, duplicates: dups }; }
    return { ok: true, error: null, duplicates: dups };
  }

  /* ============================ JSON Schema 校验 ============================ */

  function matchesType(v, t) {
    switch (t) {
      case 'null': return v === null;
      case 'boolean': return typeof v === 'boolean';
      case 'object': return isObj(v);
      case 'array': return Array.isArray(v);
      case 'number': return typeof v === 'number';
      case 'integer': return typeof v === 'number' && Number.isInteger(v);
      case 'string': return typeof v === 'string';
      default: return true;
    }
  }
  function checkFormat(v, format) {
    switch (format) {
      case 'date-time': return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(v);
      case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(v);
      case 'time': return /^\d{2}:\d{2}(:\d{2})?$/.test(v);
      case 'email': return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
      case 'uri': case 'url': return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+$/.test(v);
      case 'uuid': return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);
      case 'ipv4': return /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split('.').every(function (x) { return +x >= 0 && +x <= 255; });
      case 'ipv6': return /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(v);
      default: return true;
    }
  }

  /**
   * 轻量 JSON Schema 校验器。
   * @returns {{valid:boolean, errors:Array<{path,message}>}}
   */
  function validateSchema(value, schema) {
    var errors = [];
    function fail(path, message) { errors.push({ path: path, message: message }); }
    function walk(v, sch, path) {
      if (sch === true || sch === undefined || sch === null) return;
      if (sch === false) { fail(path, '不允许任何值（false schema）'); return; }
      if (typeof sch !== 'object') return;

      if (sch.type) {
        var types = Array.isArray(sch.type) ? sch.type : [sch.type];
        var ok = types.some(function (t) { return matchesType(v, t); });
        if (!ok) { fail(path, '类型应为 ' + types.join(' | ') + '，实际为 ' + typeOf(v)); return; }
      }
      if (sch.const !== undefined && JSON.stringify(v) !== JSON.stringify(sch.const)) fail(path, '应等于常量 ' + JSON.stringify(sch.const));
      if (sch.enum) {
        var inEnum = sch.enum.some(function (e) { return JSON.stringify(e) === JSON.stringify(v); });
        if (!inEnum) fail(path, '取值不在枚举范围：' + JSON.stringify(sch.enum).slice(0, 80));
      }
      if (typeof v === 'number') {
        if (sch.minimum !== undefined && v < sch.minimum) fail(path, '小于最小值 ' + sch.minimum);
        if (sch.maximum !== undefined && v > sch.maximum) fail(path, '大于最大值 ' + sch.maximum);
        if (sch.exclusiveMinimum !== undefined && v <= sch.exclusiveMinimum) fail(path, '应大于 ' + sch.exclusiveMinimum);
        if (sch.exclusiveMaximum !== undefined && v >= sch.exclusiveMaximum) fail(path, '应小于 ' + sch.exclusiveMaximum);
        if (sch.multipleOf !== undefined && sch.multipleOf > 0 && Math.abs(v % sch.multipleOf) > 1e-9) fail(path, '应为 ' + sch.multipleOf + ' 的倍数');
      }
      if (typeof v === 'string') {
        if (sch.minLength !== undefined && v.length < sch.minLength) fail(path, '长度小于 ' + sch.minLength);
        if (sch.maxLength !== undefined && v.length > sch.maxLength) fail(path, '长度大于 ' + sch.maxLength);
        if (sch.pattern) { try { if (!new RegExp(sch.pattern).test(v)) fail(path, '不匹配正则 /' + sch.pattern + '/'); } catch (e) { /* 忽略非法正则 */ } }
        if (sch.format && !checkFormat(v, sch.format)) fail(path, '不符合 format:' + sch.format);
      }
      if (Array.isArray(v)) {
        if (sch.minItems !== undefined && v.length < sch.minItems) fail(path, '元素数小于 ' + sch.minItems);
        if (sch.maxItems !== undefined && v.length > sch.maxItems) fail(path, '元素数大于 ' + sch.maxItems);
        if (sch.uniqueItems) {
          var seen = {};
          v.forEach(function (e, idx) { var k = JSON.stringify(e); if (Object.prototype.hasOwnProperty.call(seen, k)) fail(path + '[' + idx + ']', '元素重复'); seen[k] = 1; });
        }
        if (sch.items) v.forEach(function (e, idx) { walk(e, sch.items, path + '[' + idx + ']'); });
      }
      if (isObj(v)) {
        if (Array.isArray(sch.required)) sch.required.forEach(function (k) { if (!(k in v)) fail(path, '缺少必填字段：' + k); });
        if (sch.properties) Object.keys(sch.properties).forEach(function (k) { if (k in v) walk(v[k], sch.properties[k], path + '.' + k); });
        if (sch.additionalProperties === false && sch.properties) {
          Object.keys(v).forEach(function (k) { if (!(k in sch.properties)) fail(path, '不允许的额外字段：' + k); });
        }
      }
      if (Array.isArray(sch.allOf)) sch.allOf.forEach(function (s) { walk(v, s, path); });
      if (Array.isArray(sch.anyOf)) {
        var anyOk = sch.anyOf.some(function (s) { var es = []; var saved = errors; errors = es; walk(v, s, path); var good = es.length === 0; errors = saved; return good; });
        if (!anyOk) fail(path, '不满足 anyOf 任一分支');
      }
      if (Array.isArray(sch.oneOf)) {
        var cnt = sch.oneOf.filter(function (s) { var es = []; var saved = errors; errors = es; walk(v, s, path); var good = es.length === 0; errors = saved; return good; }).length;
        if (cnt !== 1) fail(path, 'oneOf 需恰好满足 1 个分支，实际 ' + cnt);
      }
      if (sch.not) {
        var es2 = []; var saved2 = errors; errors = es2; walk(v, sch.not, path); var good2 = es2.length === 0; errors = saved2;
        if (good2) fail(path, '不应匹配 not 分支');
      }
    }
    walk(value, schema, '$');
    return { valid: errors.length === 0, errors: errors };
  }

  /* ============================ 结构统计 ============================ */

  /** 生成人类可读的结构统计。 */
  function structureStats(value) {
    var base = J().stats(value);
    var keyList = Object.keys(base.keyFreq).map(function (k) { return { key: k, count: base.keyFreq[k] }; });
    keyList.sort(function (a, b) { return b.count - a.count; });
    var arrLen = base.arrayLengths;
    var objFields = base.objectFieldCounts;
    return {
      nodes: base.nodes,
      maxDepth: base.maxDepth,
      typeCounts: base.typeCounts,
      depthCounts: base.depthCounts,
      topKeys: keyList.slice(0, 20),
      arrayCount: arrLen.length,
      arrayLenMin: arrLen.length ? Math.min.apply(null, arrLen) : 0,
      arrayLenMax: arrLen.length ? Math.max.apply(null, arrLen) : 0,
      arrayLenAvg: arrLen.length ? arrLen.reduce(function (a, b) { return a + b; }, 0) / arrLen.length : 0,
      objectCount: objFields.length,
      fieldMax: objFields.length ? Math.max.apply(null, objFields) : 0,
      fieldAvg: objFields.length ? objFields.reduce(function (a, b) { return a + b; }, 0) / objFields.length : 0,
      chars: base.chars,
      bytes: base.bytes,
      lines: base.lines
    };
  }

  /* ============================ 体积对比 ============================ */

  /** 原文 / 格式化 / 压缩 的体积对比。 */
  function sizeCompare(text, value) {
    var compact = '';
    try { compact = JSON.stringify(value); } catch (e) { compact = String(text || ''); }
    var pretty = '';
    try { pretty = JSON.stringify(value, null, 2); } catch (e) { pretty = compact; }
    var orig = String(text == null ? '' : text);
    var utf8 = J().utf8Bytes;
    return {
      original: { chars: orig.length, bytes: utf8(orig) },
      formatted: { chars: pretty.length, bytes: utf8(pretty) },
      minified: { chars: compact.length, bytes: utf8(compact) },
      savedByMinify: utf8(orig) - utf8(compact),
      minifyRatio: utf8(orig) ? Math.round((1 - utf8(compact) / utf8(orig)) * 1000) / 10 : 0,
      prettyRatio: utf8(compact) ? Math.round((utf8(pretty) / utf8(compact)) * 100) / 100 : 0
    };
  }

  /* ============================ 异常值检查 ============================ */

  var DATE_RE = /^\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/;

  /** 遍历检查异常值。opts:{maxDepth:20, longStringLen:1024} */
  function findAnomalies(value, opts) {
    opts = opts || {};
    var maxDepth = opts.maxDepth || 20;
    var longLen = opts.longStringLen || 1024;
    var issues = [];
    function add(type, path, detail) { issues.push({ type: type, path: path, detail: detail }); }
    function walk(v, path, depth) {
      if (depth > maxDepth) { add('deep', path, '嵌套深度 ' + depth + ' 层（超过 ' + maxDepth + '）'); return; }
      var t = typeOf(v);
      if (t === 'null') { add('null', path, '值为 null'); return; }
      if (t === 'string') {
        if (v === '') add('emptyString', path, '空字符串');
        else if (v.length > longLen) add('longString', path, '字符串长度 ' + v.length + '（超过 ' + longLen + '）');
        else if (DATE_RE.test(v)) add('suspiciousDate', path, '疑似非标准日期格式：' + v);
        return;
      }
      if (t === 'number') {
        if (!isFinite(v)) add('nonFinite', path, '非法数字：' + v);
        else if (Number.isInteger(v) && Math.abs(v) > Number.MAX_SAFE_INTEGER) add('unsafeInteger', path, '超出安全整数范围：' + v);
        return;
      }
      if (t === 'array') {
        if (v.length === 0) { add('emptyArray', path, '空数组'); return; }
        v.forEach(function (e, i) { walk(e, path + '[' + i + ']', depth + 1); });
        return;
      }
      if (t === 'object') {
        var keys = Object.keys(v);
        if (keys.length === 0) { add('emptyObject', path, '空对象'); return; }
        keys.forEach(function (k) { walk(v[k], path + '.' + k, depth + 1); });
        return;
      }
    }
    walk(value, '$', 1);
    // 汇总
    var byType = {};
    issues.forEach(function (it) { byType[it.type] = (byType[it.type] || 0) + 1; });
    return { issues: issues, byType: byType, total: issues.length };
  }

  /* ============================ 安全检查 ============================ */

  var SENSITIVE_NAMES = ['password', 'passwd', 'pwd', 'token', 'secret', 'apikey', 'api_key', 'accesskey', 'access_key', 'privatekey', 'private_key', 'idcard', 'id_card', 'phone', 'mobile', 'email', 'bankcard', 'bank_card', 'creditcard', 'credit_card', 'session', 'cookie', 'authorization', 'auth', 'ssn'];

  function isSensitiveName(k) {
    var low = String(k).toLowerCase().replace(/[_\-\s]/g, '');
    return SENSITIVE_NAMES.some(function (s) { return low.indexOf(s.replace(/[_\-\s]/g, '')) >= 0; });
  }

  /** 安全检查：敏感字段 / 明文密码猜测 / JWT 提示。 */
  function securityCheck(value) {
    var hits = [];
    var jwtFields = [];
    var plaintextPasswords = [];
    function walk(v, path) {
      if (isObj(v)) {
        Object.keys(v).forEach(function (k) {
          var p = path + '.' + k;
          if (isSensitiveName(k)) {
            var val = v[k];
            var preview = (val === null || typeof val !== 'object') ? String(val) : '[' + typeOf(val) + ']';
            if (preview.length > 60) preview = preview.slice(0, 60) + '…';
            hits.push({ path: p, key: k, valuePreview: preview });
            if (/pass/i.test(k) && typeof val === 'string' && val.length >= 4 && val.length <= 64 && !/^\*+$/.test(val)) {
              plaintextPasswords.push({ path: p, length: val.length });
            }
            if (typeof val === 'string' && /^eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*$/.test(val)) {
              jwtFields.push({ path: p });
            }
          }
          walk(v[k], p);
        });
      } else if (Array.isArray(v)) {
        v.forEach(function (e, i) { walk(e, path + '[' + i + ']'); });
      }
    }
    walk(value, '$');
    var notices = [];
    if (hits.length) notices.push('警告：检测到 ' + hits.length + ' 处敏感字段名，请确认其中是否含真实密钥/隐私数据。');
    if (plaintextPasswords.length) notices.push('警告：' + plaintextPasswords.length + ' 处疑似明文密码（password 类字段且非掩码）。');
    if (jwtFields.length) notices.push('提示：' + jwtFields.length + ' 处字段值疑似 JWT，可复制后用「JWT 解码」查看内容。');
    if (!hits.length) notices.push('通过：未命中内置的敏感字段名规则。');
    return { hits: hits, plaintextPasswords: plaintextPasswords, jwtFields: jwtFields, notices: notices, count: hits.length };
  }

  /* ============================ 差异 + 示例 ============================ */

  function diff(left, right) { return J().diff(left, right); }

  /** 从 JSON 生成精简示例。opts:{maxArray, maxString} */
  function makeExample(value, opts) {
    opts = opts || {};
    var maxArray = opts.maxArray == null ? 2 : opts.maxArray;
    var maxString = opts.maxString == null ? 60 : opts.maxString;
    var truncated = 0;
    function walk(v) {
      if (Array.isArray(v)) {
        var arr = [];
        var lim = Math.min(v.length, maxArray);
        for (var i = 0; i < lim; i++) arr.push(walk(v[i]));
        if (v.length > lim) { truncated++; }
        return arr;
      }
      if (isObj(v)) {
        var o = {};
        Object.keys(v).forEach(function (k) { o[k] = walk(v[k]); });
        return o;
      }
      if (typeof v === 'string' && v.length > maxString) { truncated++; return v.slice(0, maxString) + '…'; }
      return v;
    }
    var out = walk(value);
    return { value: out, truncated: truncated };
  }

  /* ============================ 导出 ============================ */

  NS.analyze = {
    validateSyntax: validateSyntax,
    findDuplicateKeys: findDuplicateKeys,
    validateSchema: validateSchema,
    matchesType: matchesType,
    checkFormat: checkFormat,
    structureStats: structureStats,
    sizeCompare: sizeCompare,
    findAnomalies: findAnomalies,
    securityCheck: securityCheck,
    isSensitiveName: isSensitiveName,
    diff: diff,
    makeExample: makeExample
  };
})(typeof window !== 'undefined' ? window : globalThis);
