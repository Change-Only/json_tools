/*!
 * core/codec.js —— JSON 工具箱 · 编码/安全纯逻辑层（零 DOM 依赖）
 * 职责：Base64 / URL / HTML实体 / JWT / 时间戳 / 哈希 / UUID / 正则 / 字符串字面量
 */
(function (root) {
  'use strict';

  var NS = (root.JTCore = root.JTCore || {});

  /* ============================ UTF-8 手工编解码（不依赖 TextEncoder） ============================ */

  function encodeUTF8(str) {
    str = String(str == null ? '' : str);
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) { bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
          var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
          bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
          i++;
          continue;
        }
        bytes.push(0xEF, 0xBF, 0xBD);
      } else bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
    return bytes;
  }

  function decodeUTF8(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length;) {
      var b = bytes[i];
      if (b < 0x80) { out += String.fromCharCode(b); i++; }
      else if (b < 0xE0) { out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F)); i += 2; }
      else if (b < 0xF0) { out += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F)); i += 3; }
      else {
        var cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
        cp -= 0x10000;
        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
        i += 4;
      }
    }
    return out;
  }

  /* ============================ Base64 ============================ */

  var B64STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function bytesToBase64(bytes, urlSafe, noPadding) {
    var alpha = urlSafe ? B64URL : B64STD;
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
      out += alpha.charAt(b0 >> 2);
      out += alpha.charAt(((b0 & 3) << 4) | ((b1 || 0) >> 4));
      out += (i + 1 < bytes.length) ? alpha.charAt(((b1 & 15) << 2) | ((b2 || 0) >> 6)) : (noPadding ? '' : '=');
      out += (i + 2 < bytes.length) ? alpha.charAt(b2 & 63) : (noPadding ? '' : '=');
    }
    return out;
  }

  function base64ToBytes(str) {
    var s = String(str == null ? '' : str).replace(/[^A-Za-z0-9\-_+/=]/g, '');
    // 统一到标准字母表（URL-safe 的 - _ 映射为 + /），保留 '=' 用于判断填充
    var norm = '';
    for (var k = 0; k < s.length; k++) {
      var ch = s.charAt(k);
      if (ch === '=') { norm += '='; continue; }
      var idx = B64URL.indexOf(ch);
      if (idx < 0) idx = B64STD.indexOf(ch);
      if (idx >= 0) norm += B64STD.charAt(idx);
    }
    var out = [];
    for (var i = 0; i < norm.length; i += 4) {
      if (i >= norm.length) break;
      var c0 = B64STD.indexOf(norm.charAt(i));
      var c1 = (i + 1 < norm.length && norm.charAt(i + 1) !== '=') ? B64STD.indexOf(norm.charAt(i + 1)) : -1;
      var c2 = (i + 2 < norm.length && norm.charAt(i + 2) !== '=') ? B64STD.indexOf(norm.charAt(i + 2)) : -1;
      var c3 = (i + 3 < norm.length && norm.charAt(i + 3) !== '=') ? B64STD.indexOf(norm.charAt(i + 3)) : -1;
      if (c0 < 0 || c1 < 0) break;
      out.push((c0 << 2) | (c1 >> 4));
      if (c2 >= 0) out.push(((c1 & 15) << 4) | (c2 >> 2));
      if (c3 >= 0) out.push(((c2 & 3) << 6) | c3);
    }
    return out;
  }

  /** Base64 编码（UTF-8 安全）。opts:{urlSafe, noPadding, lineBreaks} */
  function base64Encode(text, opts) {
    opts = opts || {};
    var b64 = bytesToBase64(encodeUTF8(text), !!opts.urlSafe, !!opts.noPadding);
    if (opts.lineBreaks) b64 = b64.replace(/(.{76})/g, '$1\n');
    return b64;
  }

  /** Base64 解码（UTF-8 安全）。opts:{urlSafe} */
  function base64Decode(text) {
    return decodeUTF8(base64ToBytes(text));
  }

  /* ============================ URL ============================ */

  /** URL 编码。mode: 'component' | 'uri' */
  function urlEncode(text, mode) {
    var s = String(text == null ? '' : text);
    return mode === 'uri' ? encodeURI(s) : encodeURIComponent(s);
  }
  /** URL 解码（容错）。 */
  function urlDecode(text, mode) {
    var s = String(text == null ? '' : text);
    try { return mode === 'uri' ? decodeURI(s) : decodeURIComponent(s); }
    catch (e) { return decodeURIComponent(s.replace(/%(?![0-9A-Fa-f]{2})/g, '%25')); }
  }

  /* ============================ HTML 实体 ============================ */

  var HTML_NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0', copy: '\u00A9', reg: '\u00AE', hellip: '\u2026', mdash: '\u2014', ndash: '\u2013', ldquo: '\u201C', rdquo: '\u201D', lsquo: '\u2018', rsquo: '\u2019', times: '\u00D7', divide: '\u00F7', trade: '\u2122', euro: '\u20AC', pound: '\u00A3', yen: '\u00A5' };

  /** HTML 实体编码。opts:{encodeAll:boolean} */
  function htmlEncode(text, opts) {
    opts = opts || {};
    return String(text == null ? '' : text).replace(/[&<>"'`]|[^\x00-\x7F]/g, function (c) {
      if (c === '&') return '&amp;';
      if (c === '<') return '&lt;';
      if (c === '>') return '&gt;';
      if (c === '"') return '&quot;';
      if (c === "'") return '&#39;';
      if (c === '`') return '&#96;';
      return '&#x' + c.charCodeAt(0).toString(16).toUpperCase() + ';';
    });
  }

  /** HTML 实体解码。 */
  function htmlDecode(text) {
    return String(text == null ? '' : text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, function (m, ent) {
      if (ent.charAt(0) === '#') {
        try {
          if (ent.charAt(1) === 'x' || ent.charAt(1) === 'X') return String.fromCodePoint(parseInt(ent.slice(2), 16));
          return String.fromCodePoint(parseInt(ent.slice(1), 10));
        } catch (e) { return m; }
      }
      var low = ent.toLowerCase();
      return Object.prototype.hasOwnProperty.call(HTML_NAMED, low) ? HTML_NAMED[low] : m;
    });
  }

  /* ============================ JWT ============================ */

  function b64urlDecodeToString(seg) {
    return base64Decode(seg.replace(/-/g, '+').replace(/_/g, '/'));
  }
  function tsToReadable(sec) {
    try {
      var d = new Date(sec * 1000);
      if (isNaN(d.getTime())) return null;
      return d.toISOString();
    } catch (e) { return null; }
  }

  /** 解码 JWT（不校验签名）。 */
  function jwtDecode(token) {
    var s = String(token == null ? '' : token).trim().replace(/^Bearer\s+/i, '');
    var parts = s.split('.');
    if (parts.length < 2) throw new Error('不是合法的 JWT：应为 header.payload.signature 三段');
    var header, payload;
    try { header = JSON.parse(b64urlDecodeToString(parts[0])); } catch (e) { throw new Error('Header 段解码失败：' + e.message); }
    try { payload = JSON.parse(b64urlDecodeToString(parts[1])); } catch (e) { throw new Error('Payload 段解码失败：' + e.message); }
    var notices = [];
    var now = Math.floor(Date.now() / 1000);
    var meta = {};
    ['exp', 'iat', 'nbf'].forEach(function (k) {
      if (typeof payload[k] === 'number') meta[k] = { value: payload[k], readable: tsToReadable(payload[k]) };
    });
    if (meta.exp) {
      if (meta.exp.value < now) notices.push('警告：Token 已于 ' + meta.exp.readable + ' 过期');
      else notices.push('正常：Token 未过期，将于 ' + meta.exp.readable + ' 过期');
    }
    if (meta.nbf && meta.nbf.value > now) notices.push('警告：Token 尚未生效（nbf=' + meta.nbf.readable + '）');
    if (header.alg && header.alg.toLowerCase() === 'none') notices.push('警告：算法为 none，存在安全风险');
    if (!parts[2]) notices.push('警告：缺少签名段（signature）');
    return {
      header: header,
      payload: payload,
      signature: parts[2] || '',
      meta: meta,
      notices: notices,
      expired: meta.exp ? meta.exp.value < now : null
    };
  }

  /* ============================ 时间戳 ============================ */

  var TZ_OFFSETS = { '-12': -720, '-11': -660, '-10': -600, '-9': -540, '-8': -480, '-7': -420, '-6': -360, '-5': -300, '-4': -240, '-3': -180, '-2': -120, '-1': -60, '0': 0, '1': 60, '2': 120, '3': 180, '4': 240, '5': 300, '5.5': 330, '6': 360, '7': 420, '8': 480, '9': 540, '9.5': 570, '10': 600, '11': 660, '12': 720 };

  function pad(n, w) { var s = String(Math.abs(n)); while (s.length < (w || 2)) s = '0' + s; return (n < 0 ? '-' : '') + s; }

  function formatDate(d, tzSeconds, style) {
    var shifted = new Date(d.getTime() + (tzSeconds || 0) * 1000);
    var Y = shifted.getUTCFullYear();
    var M = pad(shifted.getUTCMonth() + 1);
    var D = pad(shifted.getUTCDate());
    var h = pad(shifted.getUTCHours());
    var m = pad(shifted.getUTCMinutes());
    var s = pad(shifted.getUTCSeconds());
    var ms = pad(shifted.getUTCMilliseconds(), 3);
    if (style === 'iso') return Y + '-' + M + '-' + D + 'T' + h + ':' + m + ':' + s + '.' + ms + (tzSeconds === 0 ? 'Z' : '');
    return Y + '-' + M + '-' + D + ' ' + h + ':' + m + ':' + s;
  }

  /**
   * 时间戳 → 日期。opts:{unit:'auto'|'s'|'ms', tz:number(小时)}
   * @returns {{isoUTC:string, isoLocal:string, local:string, utc:string, seconds:number, ms:number, weekday:string}}
   */
  function timestampToDate(input, opts) {
    opts = opts || {};
    var num = typeof input === 'number' ? input : Number(String(input).trim());
    if (isNaN(num)) throw new Error('不是合法的时间戳：' + input);
    var unit = opts.unit || 'auto';
    var ms;
    if (unit === 's') ms = num * 1000;
    else if (unit === 'ms') ms = num;
    else ms = Math.abs(num) < 1e11 ? num * 1000 : num; // 自动识别（<1e11 视为秒）
    var d = new Date(ms);
    if (isNaN(d.getTime())) throw new Error('时间戳超出可表示范围：' + input);
    var tz = typeof opts.tz === 'number' ? opts.tz : -d.getTimezoneOffset() / 60;
    var weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return {
      ms: ms,
      seconds: Math.floor(ms / 1000),
      isoUTC: d.toISOString(),
      utc: formatDate(d, 0, 'normal') + ' UTC',
      local: formatDate(d, d.getTimezoneOffset() * -60, 'normal'),
      tzLabel: 'UTC' + (tz >= 0 ? '+' : '') + tz,
      weekday: weekdays[d.getUTCDay()],
      detectedUnit: (unit === 'auto') ? (Math.abs(num) < 1e11 ? 'seconds' : 'milliseconds') : unit
    };
  }

  /** 日期字符串 → 时间戳。opts:{unit:'ms'|'s', tz} */
  function dateToTimestamp(input, opts) {
    opts = opts || {};
    var s = String(input == null ? '' : input).trim();
    var d = new Date(s);
    if (isNaN(d.getTime())) {
      // 尝试补时区
      var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
      if (m) d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
      else throw new Error('无法解析日期：' + input);
    }
    var ms = d.getTime();
    return { ms: ms, seconds: Math.floor(ms / 1000), unit: opts.unit || 'ms', iso: d.toISOString() };
  }

  function nowTimestamp() {
    var ms = Date.now();
    return { ms: ms, seconds: Math.floor(ms / 1000), iso: new Date(ms).toISOString() };
  }

  /* ============================ 哈希（WebCrypto，异步） ============================ */

  function hasWebCrypto() {
    return !!(root.crypto && root.crypto.subtle && typeof root.crypto.subtle.digest === 'function');
  }

  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += ('0' + bytes[i].toString(16)).slice(-2);
    return out;
  }

  /**
   * 计算哈希（异步）。algorithm: 'SHA-1'|'SHA-256'|'SHA-384'|'SHA-512'
   * @returns {Promise<string>} 十六进制小写摘要
   */
  function hash(text, algorithm) {
    return new Promise(function (resolve, reject) {
      if (!hasWebCrypto()) {
        reject(new Error('当前环境不可用 WebCrypto（crypto.subtle）。现代浏览器即使在 file:// 下通常也可用，若你的环境确实禁用，请改用「启动.bat」的本地服务模式运行。'));
        return;
      }
      var data = encodeUTF8(text);
      var buf = new Uint8Array(data);
      root.crypto.subtle.digest(algorithm || 'SHA-256', buf).then(function (digest) {
        resolve(bytesToHex(new Uint8Array(digest)));
      }).catch(function (e) { reject(new Error('哈希计算失败：' + (e && e.message ? e.message : e))); });
    });
  }

  /* ============================ UUID / NanoID ============================ */

  function randomBytes(len) {
    var arr = new Array(len);
    if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
      var u = new Uint8Array(len);
      root.crypto.getRandomValues(u);
      for (var i = 0; i < len; i++) arr[i] = u[i];
      return arr;
    }
    for (var j = 0; j < len; j++) arr[j] = Math.floor(Math.random() * 256);
    return arr;
  }

  /** 生成 UUID v4。opts:{uppercase, noHyphen} */
  function uuidV4(opts) {
    opts = opts || {};
    var b = randomBytes(16);
    b[6] = (b[6] & 0x0F) | 0x40;
    b[8] = (b[8] & 0x3F) | 0x80;
    var hex = bytesToHex(b);
    var s = hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    if (opts.noHyphen) s = s.replace(/-/g, '');
    if (opts.uppercase) s = s.toUpperCase();
    return s;
  }

  var NANOID_ALPHABET = '_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /** 生成 NanoID。opts:{size, alphabet} */
  function nanoId(opts) {
    opts = opts || {};
    var size = opts.size || 21;
    var alphabet = opts.alphabet || NANOID_ALPHABET;
    var bytes = randomBytes(size);
    var out = '';
    for (var i = 0; i < size; i++) out += alphabet.charAt(bytes[i] % alphabet.length);
    return out;
  }

  /** 生成短随机 ID（默认 8 位 [a-z0-9]）。 */
  function shortId(size) {
    size = size || 8;
    return nanoId({ size: size, alphabet: 'abcdefghijklmnopqrstuvwxyz0123456789' });
  }

  /* ============================ 正则 ============================ */

  /** 正则测试。opts:{pattern, flags, text}。返回匹配列表。 */
  function regexTest(text, pattern, flags) {
    var re;
    try { re = new RegExp(String(pattern), String(flags || '')); }
    catch (e) { throw new Error('正则表达式无效：' + e.message); }
    var input = String(text == null ? '' : text);
    var matches = [];
    var global = re.global;
    if (global) {
      var m, guard = 0;
      while ((m = re.exec(input)) !== null && guard++ < 100000) {
        matches.push({ match: m[0], index: m.index, length: m[0].length, groups: m.slice(1), named: m.groups || null });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    } else {
      var m2 = re.exec(input);
      if (m2) matches.push({ match: m2[0], index: m2.index, length: m2[0].length, groups: m2.slice(1), named: m2.groups || null });
    }
    return { matches: matches, count: matches.length, source: String(pattern), flags: String(flags || ''), global: global };
  }

  /* ============================ 字符串字面量 ============================ */

  function toJsonLiteral(text) { return JSON.stringify(String(text == null ? '' : text)); }
  function toJsLiteral(text) {
    var s = String(text == null ? '' : text);
    return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + "'";
  }
  function toCLiteral(text) {
    var s = String(text == null ? '' : text);
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
  }
  function parseLiteral(text) {
    var s = String(text == null ? '' : text).trim();
    var m = /^(['"`])([\s\S]*)\1$/.exec(s);
    if (!m) return { value: s, quoted: false };
    var body = m[2];
    var out = '';
    var i = 0;
    while (i < body.length) {
      var ch = body.charAt(i);
      if (ch === '\\' && i + 1 < body.length) {
        var nx = body.charAt(i + 1);
        var map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '0': '\0', '\\': '\\', '"': '"', "'": "'", '`': '`', '/': '/' };
        if (Object.prototype.hasOwnProperty.call(map, nx)) { out += map[nx]; i += 2; continue; }
        if (nx === 'u') { var h = body.substr(i + 2, 4); if (/^[0-9a-fA-F]{4}$/.test(h)) { out += String.fromCharCode(parseInt(h, 16)); i += 6; continue; } }
        if (nx === 'x') { var h2 = body.substr(i + 2, 2); if (/^[0-9a-fA-F]{2}$/.test(h2)) { out += String.fromCharCode(parseInt(h2, 16)); i += 4; continue; } }
        out += nx; i += 2; continue;
      }
      out += ch; i++;
    }
    return { value: out, quoted: true };
  }

  /* ============================ 导出 ============================ */

  NS.codec = {
    encodeUTF8: encodeUTF8,
    decodeUTF8: decodeUTF8,
    base64Encode: base64Encode,
    base64Decode: base64Decode,
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    urlEncode: urlEncode,
    urlDecode: urlDecode,
    htmlEncode: htmlEncode,
    htmlDecode: htmlDecode,
    jwtDecode: jwtDecode,
    timestampToDate: timestampToDate,
    dateToTimestamp: dateToTimestamp,
    nowTimestamp: nowTimestamp,
    formatDate: formatDate,
    hasWebCrypto: hasWebCrypto,
    hash: hash,
    uuidV4: uuidV4,
    nanoId: nanoId,
    shortId: shortId,
    randomBytes: randomBytes,
    regexTest: regexTest,
    toJsonLiteral: toJsonLiteral,
    toJsLiteral: toJsLiteral,
    toCLiteral: toCLiteral,
    parseLiteral: parseLiteral
  };
})(typeof window !== 'undefined' ? window : globalThis);
