/*!
 * tools-registry.js —— 工具注册表（分类 + 元数据 + 参数控件描述 + 执行函数）
 * 每个工具：{ id, cat, name, desc, icon, outLang, view, params[], run(input, params, ctx) }
 * run 统一签名，返回 { output, data, view, notices, error, errorLine }；异常已被统一捕获。
 * 依赖：window.JTCore（core/*.js）、window.JTUI.convert 无需 DOM。
 */
(function () {
  'use strict';
  var JT = (window.JT = window.JT || {});

  /* ============================ 通用辅助 ============================ */

  function core() { return window.JTCore || {}; }
  function j() { return core().json; }
  function conv() { return core().convert; }
  function cg() { return core().codegen; }
  function cc() { return core().codec; }
  function an() { return core().analyze; }

  function pretty(v, indent) { return j().stringify(v, { indent: indent == null ? 2 : indent }); }
  function compact(v) { return j().minify(v, {}); }

  /** 抛出一个带行号信息的 JSON 解析错误。 */
  function jsonErr(r) {
    var e = new Error(r.error || 'JSON 解析失败');
    e.jtc = { line: r.line, column: r.column };
    return e;
  }
  /** 要求输入必须是合法 JSON，否则抛出带行号的错误。 */
  function reqJson(ctx) {
    var r = ctx.parseInput();
    if (!r.ok) throw jsonErr(r);
    return r.value;
  }
  function reqText(input) { return String(input == null ? '' : input); }

  /**
   * 代码生成统一执行包装：把生成过程中的「字段名去重」等结构性调整通过 notices 反馈给用户。
   * @param {Function} genFn 形如 cg().toTypeScript(value, opts) 的生成函数
   * @param {*} value 输入 JSON 值
   * @param {Object} opts 生成选项（会被复制，额外注入 report 数组）
   */
  function runCodegen(genFn, value, opts) {
    var report = [];
    var o = {};
    if (opts) { for (var k in opts) { if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k]; } }
    o.report = report;
    var output = genFn(value, o);
    var res = { output: output };
    if (report.length) res.notices = report;
    return res;
  }

  /** 简单可复现随机数（32 位 LCG）。 */
  function rng(seed) {
    if (seed === undefined || seed === null || seed === '') return Math.random;
    var s = 0, str = String(seed);
    for (var i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function asArray(v, what) {
    if (!Array.isArray(v)) throw new Error('输入应为 JSON 数组' + (what ? '（' + what + '）' : ''));
    return v;
  }

  function tableText(headers, rows) {
    var widths = headers.map(function (h, i) {
      var max = String(h).length;
      rows.forEach(function (r) { var s = String(r[i] == null ? '' : r[i]); if (s.length > max) max = s.length; });
      return Math.min(max, 40);
    });
    function line(cells) {
      return cells.map(function (c, i) { var s = String(c == null ? '' : c); if (s.length > widths[i]) s = s.slice(0, widths[i] - 1) + '…'; while (s.length < widths[i]) s += ' '; return s; }).join('  ');
    }
    var out = [line(headers), widths.map(function (w) { return new Array(w + 1).join('-'); }).join('  ')];
    rows.forEach(function (r) { out.push(line(r)); });
    return out.join('\n');
  }

  /* ============================ 分类 ============================ */

  JT.categories = [
    { id: 'format', name: '格式化与美化', icon: 'wand' },
    { id: 'convert', name: '格式转换', icon: 'swap' },
    { id: 'query', name: '查询与提取', icon: 'search' },
    { id: 'validate', name: '校验与分析', icon: 'shield' },
    { id: 'codec', name: '编码与安全', icon: 'lock' },
    { id: 'utility', name: '实用工具', icon: 'tool' }
  ];

  /* ============================ 参数构造器 ============================ */

  function sel(id, label, options, dflt) { return { id: id, type: 'select', label: label, options: options, default: dflt }; }
  function txt(id, label, dflt, ph) { return { id: id, type: 'text', label: label, default: dflt == null ? '' : dflt, placeholder: ph || '' }; }
  function num(id, label, dflt, min, max) { return { id: id, type: 'number', label: label, default: dflt, min: min, max: max }; }
  function chk(id, label, dflt) { return { id: id, type: 'checkbox', label: label, default: !!dflt }; }
  function area(id, label, dflt, ph) { return { id: id, type: 'textarea', label: label, default: dflt == null ? '' : dflt, placeholder: ph || '' }; }

  var DIR = function (a, b, dflt) { return sel('direction', '方向', [{ value: 'a', label: a }, { value: 'b', label: b }], dflt || 'a'); };

  /* ============================ 工具定义 ============================ */

  var TOOLS = [];

  /* ---------- 分类一：格式化与美化 ---------- */

  TOOLS.push({
    id: 'format-pretty', cat: 'format', name: 'JSON 美化', icon: 'wand', outLang: 'json', view: 'text',
    desc: '按缩进美化 JSON，支持键排序与非 ASCII 转义',
    params: [
      sel('indent', '缩进', [{ value: '2', label: '2 空格' }, { value: '4', label: '4 空格' }, { value: '8', label: '8 空格' }, { value: 'tab', label: 'Tab' }], '2'),
      sel('sortKeys', '键排序', [{ value: 'none', label: '不排序' }, { value: 'asc', label: 'A→Z' }, { value: 'desc', label: 'Z→A' }], 'none'),
      sel('escape', '非 ASCII', [{ value: 'keep', label: '保留原样' }, { value: 'escape', label: '转义为 \\uXXXX' }], 'keep')
    ],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      return { output: j().stringify(v, { indent: params.indent, sortKeys: params.sortKeys, escapeNonAscii: params.escape === 'escape' }), data: v };
    }
  });

  TOOLS.push({
    id: 'format-minify', cat: 'format', name: 'JSON 压缩', icon: 'compress', outLang: 'json', view: 'text',
    desc: '去除全部空白字符，可选 Unicode 转义',
    params: [chk('escapeUnicode', '非 ASCII 转义为 \\uXXXX', false)],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      return { output: j().minify(v, { escapeUnicode: params.escapeUnicode }), data: v };
    }
  });

  TOOLS.push({
    id: 'format-escape', cat: 'format', name: 'JSON 转义', icon: 'quote', outLang: 'text', view: 'text',
    desc: '把 JSON 文本转成可嵌入 JSON 字符串的字面量',
    params: [],
    run: function (input) { return { output: j().escapeJson(reqText(input)) }; }
  });

  TOOLS.push({
    id: 'format-unescape', cat: 'format', name: 'JSON 去转义', icon: 'quote', outLang: 'text', view: 'text',
    desc: '还原 \\n \\t \\" \\\\ \\uXXXX 等转义序列',
    params: [],
    run: function (input) { return { output: j().unescapeJson(reqText(input)) }; }
  });

  TOOLS.push({
    id: 'format-unicode', cat: 'format', name: 'Unicode 转义', icon: 'globe', outLang: 'text', view: 'text',
    desc: '中文 ↔ \\u4e2d 形式的 Unicode 转义与还原',
    params: [
      sel('direction', '方向', [{ value: 'escape', label: '转义（中文 → \\uXXXX）' }, { value: 'unescape', label: '还原（\\uXXXX → 中文）' }], 'escape'),
      chk('onlyNonAscii', '仅转义非 ASCII 字符', true)
    ],
    run: function (input, params) {
      var text = reqText(input);
      var out = params.direction === 'unescape' ? j().unicodeUnescape(text) : j().unicodeEscape(text, { onlyNonAscii: params.onlyNonAscii });
      return { output: out };
    }
  });

  TOOLS.push({
    id: 'format-lax', cat: 'format', name: '宽松修复', icon: 'broom', outLang: 'json', view: 'text',
    desc: '单引号/尾逗号/注释/裸键/NaN/中文引号 一键修复为合法 JSON',
    params: [],
    run: function (input, params, ctx) {
      var r = ctx.parseInput();
      if (!r.ok) { var e = jsonErr(r); e.message = '修复后仍无法解析：' + e.message; throw e; }
      var out = pretty(r.value);
      var notices = [];
      if (r.repaired) notices.push('已自动修复 ' + (r.repairs.length || 0) + ' 类问题：' + r.repairs.join('、'));
      else notices.push('输入本身就是合法 JSON，无需修复。');
      return { output: out, data: r.value, notices: notices };
    }
  });

  TOOLS.push({
    id: 'format-sort-keys', cat: 'format', name: '键名排序', icon: 'sort', outLang: 'json', view: 'text',
    desc: '按字母顺序对对象键排序，可递归',
    params: [
      sel('order', '顺序', [{ value: 'asc', label: '升序 A→Z' }, { value: 'desc', label: '降序 Z→A' }], 'asc'),
      chk('recursive', '递归所有层级', true)
    ],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      return { output: pretty(j().sortKeysDeep(v, { order: params.order, recursive: params.recursive })), data: v };
    }
  });

  TOOLS.push({
    id: 'format-sort-array', cat: 'format', name: '数组排序', icon: 'sort', outLang: 'json', view: 'text',
    desc: '按元素值或指定字段排序数组',
    params: [
      sel('mode', '模式', [{ value: 'value', label: '按元素值' }, { value: 'field', label: '按指定字段' }], 'value'),
      txt('field', '字段名', '', '如 age 或 user.name'),
      sel('order', '顺序', [{ value: 'asc', label: '升序' }, { value: 'desc', label: '降序' }], 'asc'),
      chk('numericFirst', '数字优先比较', false)
    ],
    run: function (input, params, ctx) {
      var v = asArray(reqJson(ctx));
      return { output: pretty(j().sortArray(v, { mode: params.mode, field: params.field, order: params.order, numericFirst: params.numericFirst })) };
    }
  });

  TOOLS.push({
    id: 'format-dedupe', cat: 'format', name: '数组去重', icon: 'layers', outLang: 'json', view: 'text',
    desc: '按元素值或指定字段去重，保留首次出现',
    params: [
      sel('mode', '模式', [{ value: 'value', label: '按元素值' }, { value: 'field', label: '按指定字段' }], 'value'),
      txt('field', '字段名', '', '如 id')
    ],
    run: function (input, params, ctx) {
      var v = asArray(reqJson(ctx));
      var out = j().dedupe(v, { mode: params.mode, field: params.field });
      return { output: pretty(out), notices: ['原始 ' + v.length + ' 条 → 去重后 ' + out.length + ' 条（移除 ' + (v.length - out.length) + ' 条）'] };
    }
  });

  TOOLS.push({
    id: 'format-flatten', cat: 'format', name: '展平 / 还原', icon: 'layers', outLang: 'json', view: 'text',
    desc: '{"a":{"b":1}} ↔ {"a.b":1} 双向转换；键名本身含分隔符字符时往返可能不保真，建议改用其他分隔符',
    params: [
      sel('direction', '方向', [{ value: 'flatten', label: '展平（嵌套 → 扁平）' }, { value: 'unflatten', label: '还原（扁平 → 嵌套）' }], 'flatten'),
      sel('separator', '分隔符', [
        { value: '.', label: '. （点号）— 键名含点时不保真' },
        { value: '__', label: '__ （双下划线）— 推荐' },
        { value: '→', label: '→ （箭头）— 推荐' },
        { value: '/', label: '/ （斜杠）' }
      ], '.'),
      chk('arrays', '展平时也展开数组（a[0]）', false)
    ],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      var notices = [];
      var out;
      if (params.direction === 'unflatten') {
        out = j().unflatten(v, { separator: params.separator || '.', notices: notices });
      } else {
        out = j().flatten(v, { separator: params.separator || '.', arrays: params.arrays });
      }
      var res = { output: pretty(out) };
      if (notices.length) res.notices = notices;
      return res;
    }
  });

  TOOLS.push({
    id: 'format-null-clean', cat: 'format', name: '清理空值', icon: 'broom', outLang: 'json', view: 'text',
    desc: '删除 null / 空字符串 / 空数组 / 空对象（可多选）',
    params: [
      chk('null', '删除 null', true),
      chk('emptyString', '删除空字符串 ""', false),
      chk('emptyArray', '删除空数组 []', false),
      chk('emptyObject', '删除空对象 {}', false)
    ],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      return { output: pretty(j().cleanNulls(v, { 'null': params['null'], emptyString: params.emptyString, emptyArray: params.emptyArray, emptyObject: params.emptyObject })) };
    }
  });

  TOOLS.push({
    id: 'format-default-fill', cat: 'format', name: '模板补全默认值', icon: 'template', outLang: 'json', view: 'text',
    desc: '按模板 JSON 为缺失字段补默认值',
    params: [area('template', '模板 JSON', '{\n  "name": "",\n  "age": 0,\n  "active": true\n}', '粘贴模板 JSON')],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      var tpl;
      try { tpl = JSON.parse(params.template); } catch (e) { throw new Error('模板 JSON 解析失败：' + e.message); }
      return { output: pretty(j().fillDefaults(v, tpl)) };
    }
  });

  TOOLS.push({
    id: 'format-single-line', cat: 'format', name: '单行 / 多行转换', icon: 'rows', outLang: 'json', view: 'text',
    desc: 'JSON 在单行与多行之间转换，可展开字面量 \\n',
    params: [
      sel('direction', '方向', [{ value: 'single', label: '多行 → 单行' }, { value: 'multi', label: '单行 → 多行' }], 'single'),
      chk('expandLiteral', '先把字面量 \\n 展开为真实换行', false)
    ],
    run: function (input, params, ctx) {
      var text = reqText(input);
      if (params.expandLiteral) text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      var r = j().parseLax(text);
      if (!r.ok) throw jsonErr(r);
      return { output: params.direction === 'multi' ? pretty(r.value) : compact(r.value) };
    }
  });

  /* ---------- 分类二：格式转换 ---------- */

  function convertTool(o) { TOOLS.push(o); }

  convertTool({
    id: 'convert-yaml', cat: 'convert', name: 'JSON ⇄ YAML', icon: 'swap', outLang: 'yaml', view: 'text',
    desc: 'JSON 与 YAML 双向互转',
    params: [DIR('JSON → YAML', 'YAML → JSON', 'a'), sel('indent', '缩进', [{ value: '2', label: '2 空格' }, { value: '4', label: '4 空格' }], '2'), chk('foldLongLines', '折叠超长行（80 列）', false)],
    run: function (input, params, ctx) {
      if (params.direction === 'a') {
        return { output: conv().jsonToYaml(reqJson(ctx), { indent: params.indent, foldLongLines: params.foldLongLines }), outLang: 'yaml' };
      }
      return { output: pretty(conv().yamlToJson(input)), outLang: 'json' };
    }
  });

  convertTool({
    id: 'convert-toml', cat: 'convert', name: 'JSON ⇄ TOML', icon: 'swap', outLang: 'toml', view: 'text',
    desc: 'JSON 与 TOML 双向互转（注意 TOML 无 null）',
    params: [DIR('JSON → TOML', 'TOML → JSON', 'a')],
    run: function (input, params, ctx) {
      if (params.direction === 'a') {
        var r = conv().jsonToToml(reqJson(ctx));
        return { output: r.text, notices: r.notices, outLang: 'toml' };
      }
      var v = conv().tomlToJson(input);
      return { output: pretty(v), outLang: 'json', notices: ['已从 TOML 解析，TOML 结构中的 table 已转为嵌套对象。'] };
    }
  });

  convertTool({
    id: 'convert-xml', cat: 'convert', name: 'JSON ⇄ XML', icon: 'swap', outLang: 'xml', view: 'text',
    desc: 'JSON 与 XML 双向互转，可配置根节点/数组项/属性前缀',
    params: [
      DIR('JSON → XML', 'XML → JSON', 'a'),
      txt('rootName', '根节点名', 'root'),
      txt('itemName', '数组项节点名', 'item'),
      txt('attrPrefix', '属性前缀', '@_'),
      txt('textKey', '文本节点键', '#text')
    ],
    run: function (input, params, ctx) {
      var opts = { rootName: params.rootName, itemName: params.itemName, attrPrefix: params.attrPrefix, textKey: params.textKey, notices: [] };
      if (params.direction === 'a') {
        var res = { output: conv().jsonToXml(reqJson(ctx), opts), outLang: 'xml' };
        if (opts.notices.length) res.notices = opts.notices;
        return res;
      }
      var res2 = { output: pretty(conv().xmlToJson(input, opts)), outLang: 'json' };
      if (opts.notices.length) res2.notices = opts.notices;
      return res2;
    }
  });

  convertTool({
    id: 'convert-csv', cat: 'convert', name: 'JSON ⇄ CSV/TSV', icon: 'swap', outLang: 'csv', view: 'text',
    desc: '对象数组与 CSV/TSV 双向互转',
    params: [
      DIR('JSON → CSV', 'CSV → JSON', 'a'),
      sel('delimiter', '分隔符', [{ value: ',', label: '逗号 ,' }, { value: 'tab', label: '制表符 Tab' }, { value: ';', label: '分号 ;' }, { value: '|', label: '竖线 |' }], ','),
      chk('header', '包含表头', true),
      sel('nested', '嵌套对象处理', [{ value: 'flatten', label: '扁平化（a.b）' }, { value: 'json', label: '转为 JSON 串' }], 'flatten'),
      chk('coerce', '反解时自动识别数字/布尔', true)
    ],
    run: function (input, params, ctx) {
      var opts = { delimiter: params.delimiter, header: params.header, nested: params.nested, coerce: params.coerce };
      if (params.direction === 'a') {
        var r = conv().jsonToCsv(reqJson(ctx), opts);
        return { output: r.text, notices: r.notices, outLang: 'csv' };
      }
      return { output: pretty(conv().csvToJson(input, opts)), outLang: 'json' };
    }
  });

  convertTool({
    id: 'convert-querystring', cat: 'convert', name: 'JSON ⇄ 查询串', icon: 'link', outLang: 'text', view: 'text',
    desc: 'JSON 与 URL 查询串双向互转（支持嵌套与数组）',
    params: [
      DIR('JSON → 查询串', '查询串 → JSON', 'a'),
      sel('arrayStyle', '数组写法', [{ value: 'bracket', label: 'a[]=1（方括号）' }, { value: 'repeat', label: 'a=1&a=2（重复键）' }], 'bracket')
    ],
    run: function (input, params, ctx) {
      if (params.direction === 'a') {
        return { output: conv().jsonToQuery(reqJson(ctx), { arrayStyle: params.arrayStyle }), outLang: 'text' };
      }
      return { output: pretty(conv().queryToJson(input)), outLang: 'json' };
    }
  });

  convertTool({
    id: 'convert-properties', cat: 'convert', name: 'JSON ⇄ .env / Properties', icon: 'swap', outLang: 'text', view: 'text',
    desc: 'JSON 与 .env / Java Properties 双向互转',
    params: [
      DIR('JSON → Properties', 'Properties → JSON', 'a'),
      sel('delimiter', '分隔符', [{ value: '=', label: '等号 =' }, { value: 'colon', label: '冒号 :' }], '='),
      chk('quote', '值含特殊字符时加引号', true)
    ],
    run: function (input, params, ctx) {
      if (params.direction === 'a') {
        return { output: conv().jsonToProperties(reqJson(ctx), { delimiter: params.delimiter, quote: params.quote }), outLang: 'text' };
      }
      return { output: pretty(conv().propertiesToJson(input)), outLang: 'json' };
    }
  });

  convertTool({
    id: 'convert-ndjson', cat: 'convert', name: 'JSON ⇄ NDJSON', icon: 'rows', outLang: 'json', view: 'text',
    desc: 'JSON 数组与 JSON Lines（每行一条）双向互转',
    params: [DIR('JSON 数组 → NDJSON', 'NDJSON → JSON 数组', 'a')],
    run: function (input, params, ctx) {
      if (params.direction === 'a') return { output: conv().jsonToNdjson(reqJson(ctx)), outLang: 'text' };
      return { output: pretty(conv().ndjsonToJson(input)), outLang: 'json' };
    }
  });

  convertTool({
    id: 'convert-md', cat: 'convert', name: 'JSON → Markdown 表格', icon: 'table', outLang: 'markdown', view: 'text',
    desc: '把对象数组渲染成 Markdown 表格',
    params: [txt('path', '数据路径（可空）', '', '如 data.list')],
    run: function (input, params, ctx) {
      return { output: conv().jsonToMarkdown(reqJson(ctx), { path: params.path }), outLang: 'markdown' };
    }
  });

  var NAME_STYLE = sel('nameStyle', '字段命名风格', [{ value: 'camel', label: 'camelCase' }, { value: 'snake', label: 'snake_case' }, { value: 'pascal', label: 'PascalCase' }, { value: 'keep', label: '保持原样' }], 'camel');
  var OPTIONAL_MODE = sel('optionalMode', '必填性', [{ value: 'none', label: '全部必填' }, { value: 'missing', label: '缺失字段可选（?）' }, { value: 'all', label: '全部可选（?）' }], 'missing');

  convertTool({
    id: 'convert-ts', cat: 'convert', name: 'JSON → TypeScript', icon: 'code', outLang: 'code', view: 'code',
    desc: '生成 TypeScript interface，嵌套对象自动拆分',
    params: [txt('rootName', '根类型名', 'Root'), OPTIONAL_MODE, NAME_STYLE, chk('exportKeyword', '添加 export 关键字', true)],
    run: function (input, params, ctx) {
      return runCodegen(cg().toTypeScript, reqJson(ctx), { rootName: params.rootName, optionalMode: params.optionalMode, nameStyle: params.nameStyle, exportKeyword: params.exportKeyword });
    }
  });

  convertTool({
    id: 'convert-java', cat: 'convert', name: 'JSON → Java', icon: 'code', outLang: 'code', view: 'code',
    desc: '生成 Java POJO，可加 Lombok 与 Jackson 注解',
    params: [
      txt('rootName', '类名', 'Root'), txt('packageName', '包名', ''),
      sel('lombok', 'Lombok', [{ value: 'data', label: '@Data' }, { value: 'getset', label: '@Getter/@Setter' }, { value: 'none', label: '不生成（手写 getter/setter）' }], 'data'),
      chk('jackson', '@JsonProperty 注解', true), NAME_STYLE
    ],
    run: function (input, params, ctx) {
      return runCodegen(cg().toJava, reqJson(ctx), { rootName: params.rootName, packageName: params.packageName, lombok: params.lombok, jackson: params.jackson, nameStyle: params.nameStyle });
    }
  });

  convertTool({
    id: 'convert-kotlin', cat: 'convert', name: 'JSON → Kotlin', icon: 'code', outLang: 'code', view: 'code',
    desc: '生成 Kotlin data class',
    params: [txt('rootName', '类名', 'Root'), chk('jackson', '@JsonProperty 注解', false), OPTIONAL_MODE, NAME_STYLE],
    run: function (input, params, ctx) {
      return runCodegen(cg().toKotlin, reqJson(ctx), { rootName: params.rootName, jackson: params.jackson, optionalMode: params.optionalMode, nameStyle: params.nameStyle });
    }
  });

  convertTool({
    id: 'convert-go', cat: 'convert', name: 'JSON → Go', icon: 'code', outLang: 'code', view: 'code',
    desc: '生成 Go struct 与 json tag',
    params: [txt('rootName', '类型名', 'Root'), txt('packageName', '包名', 'main'), chk('jsonTag', '生成 json tag', true), chk('pointerForOptional', '可选字段用指针', false)],
    run: function (input, params, ctx) {
      return runCodegen(cg().toGo, reqJson(ctx), { rootName: params.rootName, packageName: params.packageName, jsonTag: params.jsonTag, pointerForOptional: params.pointerForOptional });
    }
  });

  convertTool({
    id: 'convert-python', cat: 'convert', name: 'JSON → Python', icon: 'code', outLang: 'code', view: 'code',
    desc: '生成 dataclass / Pydantic BaseModel / TypedDict',
    params: [
      sel('pyStyle', '风格', [{ value: 'dataclass', label: 'dataclass' }, { value: 'pydantic', label: 'Pydantic BaseModel' }, { value: 'typeddict', label: 'TypedDict' }], 'dataclass'),
      txt('rootName', '根类型名', 'Root'), OPTIONAL_MODE, NAME_STYLE
    ],
    run: function (input, params, ctx) {
      return runCodegen(cg().toPython, reqJson(ctx), { pyStyle: params.pyStyle, rootName: params.rootName, optionalMode: params.optionalMode, nameStyle: params.nameStyle });
    }
  });

  convertTool({
    id: 'convert-csharp', cat: 'convert', name: 'JSON → C#', icon: 'code', outLang: 'code', view: 'code',
    desc: '生成 C# class，可加 JsonPropertyName 注解',
    params: [txt('rootName', '类名', 'Root'), txt('namespace', '命名空间', ''), chk('jsonProperty', 'JsonPropertyName 注解', true), OPTIONAL_MODE, NAME_STYLE],
    run: function (input, params, ctx) {
      return runCodegen(cg().toCSharp, reqJson(ctx), { rootName: params.rootName, namespace: params.namespace, jsonProperty: params.jsonProperty, optionalMode: params.optionalMode, nameStyle: params.nameStyle });
    }
  });

  convertTool({
    id: 'convert-rust', cat: 'convert', name: 'JSON → Rust', icon: 'code', outLang: 'code', view: 'code',
    desc: '生成 Rust struct，含 serde derive 与 rename',
    params: [txt('rootName', '结构名', 'Root'), OPTIONAL_MODE, NAME_STYLE],
    run: function (input, params, ctx) {
      return runCodegen(cg().toRust, reqJson(ctx), { rootName: params.rootName, optionalMode: params.optionalMode, nameStyle: params.nameStyle });
    }
  });

  convertTool({
    id: 'convert-swift', cat: 'convert', name: 'JSON → Swift', icon: 'code', outLang: 'code', view: 'code',
    desc: '生成 Swift Codable struct 与 CodingKeys',
    params: [txt('rootName', '结构名', 'Root'), OPTIONAL_MODE, NAME_STYLE],
    run: function (input, params, ctx) {
      return runCodegen(cg().toSwift, reqJson(ctx), { rootName: params.rootName, optionalMode: params.optionalMode, nameStyle: params.nameStyle });
    }
  });

  convertTool({
    id: 'convert-dart', cat: 'convert', name: 'JSON → Dart', icon: 'code', outLang: 'code', view: 'code',
    desc: '生成 Dart class，含 fromJson / toJson',
    params: [txt('rootName', '类名', 'Root'), OPTIONAL_MODE, NAME_STYLE],
    run: function (input, params, ctx) {
      return runCodegen(cg().toDart, reqJson(ctx), { rootName: params.rootName, optionalMode: params.optionalMode, nameStyle: params.nameStyle });
    }
  });

  convertTool({
    id: 'convert-php', cat: 'convert', name: 'JSON → PHP', icon: 'code', outLang: 'code', view: 'code',
    desc: '生成带类型属性的 PHP class',
    params: [txt('rootName', '类名', 'Root'), txt('namespace', '命名空间', ''), OPTIONAL_MODE, NAME_STYLE],
    run: function (input, params, ctx) {
      return runCodegen(cg().toPhp, reqJson(ctx), { rootName: params.rootName, namespace: params.namespace, optionalMode: params.optionalMode, nameStyle: params.nameStyle });
    }
  });

  convertTool({
    id: 'convert-ddl', cat: 'convert', name: 'JSON → 建表 DDL', icon: 'db', outLang: 'sql', view: 'code',
    desc: '依据 JSON 结构推断字段类型并生成 CREATE TABLE',
    params: [
      sel('dialect', '方言', [{ value: 'mysql', label: 'MySQL' }, { value: 'postgresql', label: 'PostgreSQL' }, { value: 'sqlite', label: 'SQLite' }], 'mysql'),
      txt('tableName', '表名', 'my_table'), txt('primaryKey', '主键字段名', ''),
      chk('withComments', '含推断注释', true), NAME_STYLE
    ],
    run: function (input, params, ctx) {
      var res = runCodegen(cg().toDDL, reqJson(ctx), { dialect: params.dialect, tableName: params.tableName, primaryKey: params.primaryKey, withComments: params.withComments, nameStyle: params.nameStyle });
      res.outLang = 'sql';
      return res;
    }
  });

  convertTool({
    id: 'convert-schema', cat: 'convert', name: 'JSON → JSON Schema', icon: 'schema', outLang: 'json', view: 'code',
    desc: '生成 Draft 2020-12 JSON Schema（含类型/必填/format 推断）',
    params: [txt('title', 'Schema 标题', 'Root'), txt('id', '$id（可空）', '')],
    run: function (input, params, ctx) {
      var opts = { title: params.title, rootName: params.title };
      if (params.id) opts.id = params.id;
      return { output: cg().toJsonSchema(reqJson(ctx), opts), outLang: 'json' };
    }
  });

  /* ---------- 分类三：查询与提取 ---------- */

  TOOLS.push({
    id: 'query-jsonpath', cat: 'query', name: 'JSONPath 查询', icon: 'search', outLang: 'json', view: 'tree',
    desc: '支持 $ .key [n] [*] ..key [start:end] * 的 JSONPath 查询',
    params: [txt('expr', 'JSONPath 表达式', '$..name', '如 $..author 或 $.store.book[*].title')],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      var res = j().jsonPath(v, params.expr);
      var values = res.map(function (r) { return r.value; });
      var out = values.length === 1 ? pretty(values[0]) : pretty(values);
      return { output: out, data: res.map(function (r) { return { path: r.path, value: r.value }; }), notices: ['命中 ' + res.length + ' 条结果'] };
    }
  });

  TOOLS.push({
    id: 'query-paths', cat: 'query', name: '列出所有叶子路径', icon: 'tree', outLang: 'text', view: 'text',
    desc: '列出所有叶子节点的路径，便于复制引用',
    params: [sel('style', '路径风格', [{ value: 'dot', label: '点号 a.b[0]' }, { value: 'jsonpath', label: 'JSONPath $.a.b[0]' }], 'dot')],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      var paths = j().leafPaths(v, { style: params.style });
      return { output: paths.join('\n'), data: paths, notices: ['共 ' + paths.length + ' 条叶子路径'] };
    }
  });

  TOOLS.push({
    id: 'query-get', cat: 'query', name: '按路径取值', icon: 'key', outLang: 'json', view: 'text',
    desc: '支持 a.b[0].c 与 $.a.b[0] 两种写法',
    params: [txt('path', '路径', '$.a.b', '如 data.list[0].name')],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      var val = j().getByPath(v, params.path);
      if (val === undefined) return { output: '（未找到该路径）', notices: ['路径不存在：' + params.path] };
      return { output: (val !== null && typeof val === 'object') ? pretty(val) : String(val), data: val };
    }
  });

  TOOLS.push({
    id: 'query-keys', cat: 'query', name: '键名搜索', icon: 'key', outLang: 'text', view: 'text',
    desc: '按名称（模糊/正则）搜索键，输出 路径 → 值',
    params: [txt('pattern', '匹配模式', '', '如 name 或 ^user'), chk('regex', '按正则匹配', false), chk('caseSensitive', '区分大小写', false)],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      var flags = params.caseSensitive ? '' : 'i';
      var test;
      if (params.regex) { var re = new RegExp(params.pattern, flags); test = function (k) { return re.test(k); }; }
      else if (params.caseSensitive) test = function (k) { return k.indexOf(params.pattern) >= 0; };
      else { var lp = String(params.pattern).toLowerCase(); test = function (k) { return k.toLowerCase().indexOf(lp) >= 0; }; }
      var hits = [];
      (function walk(x, path) {
        if (x && typeof x === 'object' && !Array.isArray(x)) {
          Object.keys(x).forEach(function (k) {
            var p = path + '.' + k;
            if (test(k)) hits.push(p + '  →  ' + (x[k] !== null && typeof x[k] === 'object' ? j().safeStr(x[k]).slice(0, 60) : String(x[k])));
            walk(x[k], p);
          });
        } else if (Array.isArray(x)) x.forEach(function (e, i) { walk(e, path + '[' + i + ']'); });
      })(v, '$');
      return { output: hits.length ? hits.join('\n') : '（无匹配）', data: hits, notices: ['命中 ' + hits.length + ' 个键'] };
    }
  });

  TOOLS.push({
    id: 'query-values', cat: 'query', name: '值搜索', icon: 'search', outLang: 'text', view: 'text',
    desc: '按关键字搜索值，支持包含/等于/正则与类型过滤',
    params: [
      txt('keyword', '关键字', '', '如 张三'),
      sel('mode', '匹配方式', [{ value: 'contains', label: '包含' }, { value: 'equals', label: '等于' }, { value: 'regex', label: '正则' }], 'contains'),
      sel('typeFilter', '类型过滤', [{ value: 'any', label: '任意' }, { value: 'string', label: '字符串' }, { value: 'number', label: '数字' }, { value: 'boolean', label: '布尔' }, { value: 'null', label: 'null' }], 'any')
    ],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      var re = params.mode === 'regex' ? new RegExp(params.keyword) : null;
      function typeOf(x) { return x === null ? 'null' : (Array.isArray(x) ? 'array' : typeof x); }
      function match(x) {
        if (params.typeFilter !== 'any' && typeOf(x) !== params.typeFilter) return false;
        if (x !== null && typeof x === 'object') return false;
        var s = x === null ? 'null' : String(x);
        if (params.mode === 'equals') return s === String(params.keyword);
        if (params.mode === 'regex') return re.test(s);
        return s.indexOf(String(params.keyword)) >= 0;
      }
      var hits = [];
      (function walk(x, path) {
        if (Array.isArray(x)) x.forEach(function (e, i) { walk(e, path + '[' + i + ']'); });
        else if (x && typeof x === 'object') Object.keys(x).forEach(function (k) { walk(x[k], path + '.' + k); });
        else if (match(x)) hits.push(path + '  =  ' + (x === null ? 'null' : String(x)));
      })(v, '$');
      return { output: hits.length ? hits.join('\n') : '（无匹配）', data: hits, notices: ['命中 ' + hits.length + ' 个值'] };
    }
  });

  TOOLS.push({
    id: 'query-collect', cat: 'query', name: '递归收集同名键', icon: 'layers', outLang: 'json', view: 'text',
    desc: '递归收集所有同名 key 的值（支持多 key 逗号分隔）',
    params: [txt('keys', '键名（逗号分隔）', 'id', '如 id,name')],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      var list = j().collectKeys(v, params.keys);
      var vals = list.map(function (h) { return h.value; });
      return { output: pretty({ matched: vals.length, values: vals, detail: list }), data: list, notices: ['收集到 ' + vals.length + ' 个值'] };
    }
  });

  TOOLS.push({
    id: 'query-pick', cat: 'query', name: '只保留指定键', icon: 'filter', outLang: 'json', view: 'text',
    desc: '递归删除其它键，只保留指定键（逗号分隔）',
    params: [txt('keys', '保留的键', '', '如 id,name')],
    run: function (input, params, ctx) {
      return { output: pretty(j().pickKeys(reqJson(ctx), params.keys)) };
    }
  });

  TOOLS.push({
    id: 'query-omit', cat: 'query', name: '删除指定键', icon: 'filter', outLang: 'json', view: 'text',
    desc: '递归删除指定键（支持 * 通配，逗号分隔）',
    params: [txt('keys', '删除的键', '', '如 password,*token*')],
    run: function (input, params, ctx) {
      return { output: pretty(j().omitKeys(reqJson(ctx), params.keys)) };
    }
  });

  TOOLS.push({
    id: 'query-pluck', cat: 'query', name: '字段投影 pluck', icon: 'filter', outLang: 'json', view: 'text',
    desc: '从数组抽取字段，如 name 或 items[].id',
    params: [txt('expr', '表达式', 'name', '如 users[].name')],
    run: function (input, params, ctx) {
      return { output: pretty(j().pluck(reqJson(ctx), params.expr)) };
    }
  });

  TOOLS.push({
    id: 'query-group', cat: 'query', name: '分组 groupBy', icon: 'group', outLang: 'json', view: 'text',
    desc: '数组按字段分组，输出分组计数与结果',
    params: [txt('field', '分组字段', 'type')],
    run: function (input, params, ctx) {
      var v = asArray(reqJson(ctx));
      var groups = j().groupBy(v, params.field);
      var rows = groups.map(function (g) { return [g.key, g.count]; });
      return {
        output: tableText(['分组', '数量'], rows) + '\n\n' + pretty(groups.map(function (g) { return { key: g.key, count: g.count, items: g.items }; })),
        data: groups, notices: ['共 ' + groups.length + ' 个分组']
      };
    }
  });

  TOOLS.push({
    id: 'query-aggregate', cat: 'query', name: '数值聚合', icon: 'chart', outLang: 'text', view: 'stats',
    desc: '对指定数值字段求 count/sum/avg/min/max',
    params: [txt('fields', '字段（逗号分隔）', 'price,count')],
    run: function (input, params, ctx) {
      var v = asArray(reqJson(ctx));
      var rows = j().aggregate(v, params.fields);
      var table = rows.map(function (r) { return [r.field, r.count, r.sum, r.avg == null ? '-' : Math.round(r.avg * 100) / 100, r.min, r.max]; });
      return { output: tableText(['字段', '计数', '求和', '平均', '最小', '最大'], table), data: rows, view: 'stats' };
    }
  });

  TOOLS.push({
    id: 'query-merge', cat: 'query', name: '深合并两个 JSON', icon: 'merge', outLang: 'json', view: 'text',
    desc: '把第二份 JSON 深合并进当前 JSON，可设冲突策略',
    params: [
      area('second', '第二份 JSON', '{\n  "extra": true\n}', '粘贴用于合并的 JSON'),
      sel('conflict', '冲突策略', [{ value: 'overwrite', label: '覆盖（后者优先）' }, { value: 'keep', label: '保留（前者优先）' }, { value: 'concat', label: '数组拼接' }], 'overwrite')
    ],
    run: function (input, params, ctx) {
      var a = reqJson(ctx);
      var b;
      try { b = JSON.parse(params.second); } catch (e) { throw new Error('第二份 JSON 解析失败：' + e.message); }
      return { output: pretty(j().deepMerge(a, b, { conflict: params.conflict })) };
    }
  });

  TOOLS.push({
    id: 'query-patch', cat: 'query', name: '应用 JSON Patch', icon: 'patch', outLang: 'json', view: 'text',
    desc: '应用 RFC6902 JSON Patch（add/remove/replace/move/copy/test）',
    params: [area('patch', 'Patch 数组', '[\n  { "op": "add", "path": "/newKey", "value": 1 }\n]', '粘贴 Patch 数组')],
    run: function (input, params, ctx) {
      var doc = reqJson(ctx);
      var patch;
      try { patch = JSON.parse(params.patch); } catch (e) { throw new Error('Patch 数组解析失败：' + e.message); }
      var out = j().applyPatch(doc, patch);
      return { output: pretty(out), notices: ['已应用 ' + (Array.isArray(patch) ? patch.length : 0) + ' 个补丁操作'] };
    }
  });

  /* ---------- 分类四：校验与分析 ---------- */

  TOOLS.push({
    id: 'validate-syntax', cat: 'validate', name: 'JSON 语法校验', icon: 'check', outLang: 'text', view: 'text',
    desc: '精确到行列的语法校验，并给出上下文片段',
    params: [],
    run: function (input) {
      var r = j().parse(input);
      if (r.ok) {
        var st = j().stats(r.value);
        return { output: '✅ JSON 语法正确\n\n节点总数：' + st.nodes + '\n最大深度：' + st.maxDepth + '\n字符数：' + st.chars + '，字节数：' + st.bytes, data: st, notices: ['语法校验通过'] };
      }
      var lines = ['❌ 语法错误：第 ' + r.line + ' 行，第 ' + r.column + ' 列', r.error, ''];
      if (r.snippet && r.snippet.length) {
        r.snippet.forEach(function (s) {
          lines.push((s.current ? '▶ ' : '  ') + String(s.line).padStart(4, ' ') + ' | ' + s.text);
        });
      }
      return { output: lines.join('\n'), error: r.error, errorLine: r.line, view: 'text' };
    }
  });

  TOOLS.push({
    id: 'validate-duplicate-keys', cat: 'validate', name: '重复键检测', icon: 'alert', outLang: 'text', view: 'text',
    desc: '检测同一对象内的重复键并给出路径',
    params: [],
    run: function (input) {
      var r = an().findDuplicateKeys(input);
      if (!r.ok) return { output: '警告：无法解析：' + r.error, error: r.error };
      if (!r.duplicates.length) return { output: '✅ 未检测到重复键。', notices: ['未发现重复键'] };
      var lines = r.duplicates.map(function (d) { return '重复：' + d.path; });
      return { output: '检测到 ' + r.duplicates.length + ' 处重复键：\n\n' + lines.join('\n'), data: r.duplicates, notices: ['存在重复键，仅最后一个生效'] };
    }
  });

  TOOLS.push({
    id: 'validate-schema', cat: 'validate', name: 'JSON Schema 校验', icon: 'schema', outLang: 'text', view: 'text',
    desc: '用 JSON Schema 校验当前 JSON，逐条列出错误路径',
    params: [area('schema', 'JSON Schema', '{\n  "type": "object",\n  "required": ["name"],\n  "properties": {\n    "name": { "type": "string" }\n  }\n}', '粘贴 JSON Schema')],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      var schema;
      try { schema = JSON.parse(params.schema); } catch (e) { throw new Error('Schema 解析失败：' + e.message); }
      var res = an().validateSchema(v, schema);
      if (res.valid) return { output: '✅ 校验通过，数据符合 Schema。', data: res, notices: ['Schema 校验通过'] };
      var lines = res.errors.map(function (e) { return '错误：' + e.path + '：' + e.message; });
      return { output: '❌ 校验失败，共 ' + res.errors.length + ' 处问题：\n\n' + lines.join('\n'), data: res, notices: ['Schema 校验未通过'] };
    }
  });

  TOOLS.push({
    id: 'validate-stats', cat: 'validate', name: '结构统计', icon: 'chart', outLang: 'text', view: 'stats',
    desc: '节点数/深度/类型分布/Key 频次/数组长度分布/体积',
    params: [],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      var s = an().structureStats(v);
      var typeRows = Object.keys(s.typeCounts).filter(function (k) { return s.typeCounts[k]; }).map(function (k) { return [k, s.typeCounts[k]]; });
      var top = s.topKeys.map(function (k) { return k.key + '(' + k.count + ')'; }).join(', ');
      var text = [
        '节点总数：' + s.nodes + '    最大深度：' + s.maxDepth,
        '字符数：' + s.chars + '    字节数：' + s.bytes + '    行数：' + s.lines,
        '数组数量：' + s.arrayCount + '（长度 ' + s.arrayLenMin + '~' + s.arrayLenMax + '，平均 ' + (Math.round(s.arrayLenAvg * 100) / 100) + '）',
        '对象数量：' + s.objectCount + '（字段最多 ' + s.fieldMax + '）',
        '',
        '类型分布：',
        tableText(['类型', '数量'], typeRows),
        '',
        'Key 频次 Top：' + (top || '（无）'),
        '',
        '各层节点数：' + Object.keys(s.depthCounts).sort(function (a, b) { return a - b; }).map(function (d) { return 'L' + d + '=' + s.depthCounts[d]; }).join('  ')
      ].join('\n');
      return { output: text, data: s, view: 'stats' };
    }
  });

  TOOLS.push({
    id: 'validate-size', cat: 'validate', name: '体积对比', icon: 'size', outLang: 'text', view: 'stats',
    desc: '原文 / 格式化 / 压缩 的字节数与压缩率',
    params: [],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      var s = an().sizeCompare(input, v);
      var text = tableText(['形态', '字符数', '字节数'], [
        ['原文', s.original.chars, s.original.bytes],
        ['格式化(2空格)', s.formatted.chars, s.formatted.bytes],
        ['压缩', s.minified.chars, s.minified.bytes]
      ]) + '\n\n压缩后相比原文节省 ' + s.savedByMinify + ' 字节，压缩率 ' + s.minifyRatio + '%\n格式化/压缩体积比 ' + s.prettyRatio;
      return { output: text, data: s, view: 'stats' };
    }
  });

  TOOLS.push({
    id: 'validate-anomaly', cat: 'validate', name: '异常值检查', icon: 'alert', outLang: 'text', view: 'table',
    desc: 'null / 空值 / 超大整数 / 超深嵌套 / 可疑日期 / 超长字符串',
    params: [num('maxDepth', '最大深度阈值', 20, 1, 200), num('longStringLen', '超长字符串阈值', 1024, 1, 1000000)],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      var r = an().findAnomalies(v, { maxDepth: params.maxDepth, longStringLen: params.longStringLen });
      if (!r.total) return { output: '✅ 未发现异常值。', data: r, view: 'table', notices: ['未发现异常'] };
      var rows = r.issues.slice(0, 500).map(function (it) { return [it.type, it.path, it.detail]; });
      return { output: '共发现 ' + r.total + ' 处异常：\n\n' + tableText(['类型', '路径', '说明'], rows), data: r, view: 'table', notices: ['发现 ' + r.total + ' 处异常'] };
    }
  });

  TOOLS.push({
    id: 'validate-security', cat: 'validate', name: '安全检查', icon: 'shield', outLang: 'text', view: 'table',
    desc: '敏感字段名 / 明文密码 / JWT 明文提示',
    params: [],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      var r = an().securityCheck(v);
      var rows = r.hits.map(function (h) { return [h.path, h.key, h.valuePreview]; });
      var text = r.notices.join('\n') + '\n\n' + (r.hits.length ? tableText(['路径', '字段名', '值预览'], rows) : '（无敏感字段命中）');
      return { output: text, data: r, view: 'table', notices: r.notices };
    }
  });

  TOOLS.push({
    id: 'validate-diff', cat: 'validate', name: 'JSON 差异对比', icon: 'diff', outLang: 'text', view: 'diff',
    desc: '按路径列出 新增/删除/修改，左右对照高亮',
    params: [area('right', '右侧 JSON', '{\n}\n', '粘贴用于对比的 JSON')],
    run: function (input, params, ctx) {
      var left = reqJson(ctx);
      var right;
      try { right = JSON.parse(params.right); } catch (e) { throw new Error('右侧 JSON 解析失败：' + e.message); }
      var d = j().diff(left, right);
      var lines = d.map(function (x) {
        var tag = x.type === 'added' ? '+ 新增' : (x.type === 'removed' ? '- 删除' : '~ 修改');
        return tag + '  ' + x.path;
      });
      return {
        output: d.length ? lines.join('\n') : '两侧完全一致，无差异。',
        data: { diff: d, left: left, right: right },
        view: 'diff',
        notices: ['差异条数：' + d.length]
      };
    }
  });

  TOOLS.push({
    id: 'validate-example', cat: 'validate', name: '生成精简示例', icon: 'sample', outLang: 'json', view: 'text',
    desc: '截断长数组与长字符串，生成可分享的精简 JSON',
    params: [num('maxArray', '数组最大保留条数', 2, 0, 1000), num('maxString', '字符串最大长度', 60, 4, 10000)],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      var r = an().makeExample(v, { maxArray: params.maxArray, maxString: params.maxString });
      return { output: pretty(r.value), notices: ['已截断 ' + r.truncated + ' 处长数组/长字符串'] };
    }
  });

  /* ---------- 分类五：编码与安全 ---------- */

  TOOLS.push({
    id: 'codec-base64', cat: 'codec', name: 'Base64 编解码', icon: 'binary', outLang: 'text', view: 'text',
    desc: 'UTF-8 安全的 Base64 编码/解码，支持 URL-safe',
    params: [
      DIR('编码', '解码', 'a'),
      chk('urlSafe', 'URL-safe（- _ 代替 + /）', false),
      chk('noPadding', '去掉结尾的 =', false),
      chk('lineBreaks', '每 76 字符换行', false)
    ],
    run: function (input, params) {
      if (params.direction === 'a') return { output: cc().base64Encode(reqText(input), { urlSafe: params.urlSafe, noPadding: params.noPadding, lineBreaks: params.lineBreaks }) };
      return { output: cc().base64Decode(reqText(input)) };
    }
  });

  TOOLS.push({
    id: 'codec-url', cat: 'codec', name: 'URL 编解码', icon: 'link', outLang: 'text', view: 'text',
    desc: 'encodeURIComponent / encodeURI / 查询串解析为 JSON',
    params: [
      sel('direction', '模式', [{ value: 'encode', label: '编码' }, { value: 'decode', label: '解码' }, { value: 'parse', label: '查询串 → JSON' }], 'encode'),
      sel('style', '范围', [{ value: 'component', label: 'encodeURIComponent' }, { value: 'uri', label: 'encodeURI' }], 'component')
    ],
    run: function (input, params) {
      var text = reqText(input);
      if (params.direction === 'encode') return { output: cc().urlEncode(text, params.style) };
      if (params.direction === 'decode') return { output: cc().urlDecode(text, params.style) };
      return { output: pretty(conv().queryToJson(text)), outLang: 'json' };
    }
  });

  TOOLS.push({
    id: 'codec-html', cat: 'codec', name: 'HTML 实体编解码', icon: 'code', outLang: 'text', view: 'text',
    desc: '&amp; &lt; &gt; &#39; &#x4e2d; 等实体编解码',
    params: [DIR('编码', '解码', 'a')],
    run: function (input, params) {
      var text = reqText(input);
      return { output: params.direction === 'a' ? cc().htmlEncode(text) : cc().htmlDecode(text) };
    }
  });

  TOOLS.push({
    id: 'codec-jwt', cat: 'codec', name: 'JWT 解码', icon: 'jwt', outLang: 'json', view: 'text',
    desc: '解析 Header/Payload，自动转换 exp/iat/nbf 并判断过期',
    params: [],
    run: function (input) {
      var r = cc().jwtDecode(reqText(input));
      var out = ['【Header】', pretty(r.header), '', '【Payload】', pretty(r.payload)];
      if (Object.keys(r.meta).length) {
        out.push('', '【时间字段】');
        Object.keys(r.meta).forEach(function (k) { out.push('  ' + k + ' = ' + r.meta[k].value + '  →  ' + r.meta[k].readable); });
      }
      out.push('', '【Signature】', r.signature || '(无)');
      return { output: out.join('\n'), data: r, notices: r.notices };
    }
  });

  TOOLS.push({
    id: 'codec-timestamp', cat: 'codec', name: '时间戳 ⇄ 日期', icon: 'clock', outLang: 'text', view: 'text',
    desc: '时间戳与日期互转，自动识别秒/毫秒，支持时区',
    params: [
      sel('direction', '方向', [{ value: 'toDate', label: '时间戳 → 日期' }, { value: 'fromDate', label: '日期 → 时间戳' }, { value: 'now', label: '当前时间' }], 'toDate'),
      sel('unit', '单位', [{ value: 'auto', label: '自动识别' }, { value: 's', label: '秒' }, { value: 'ms', label: '毫秒' }], 'auto'),
      txt('tz', '时区偏移（小时，可空=本地）', '')
    ],
    run: function (input, params) {
      if (params.direction === 'now') {
        var n = cc().nowTimestamp();
        return { output: ['秒：' + n.seconds, '毫秒：' + n.ms, 'ISO：' + n.iso].join('\n'), data: n };
      }
      var tz = params.tz === '' || params.tz === undefined ? undefined : Number(params.tz);
      if (params.direction === 'fromDate') {
        var r2 = cc().dateToTimestamp(reqText(input), { unit: params.unit === 's' ? 's' : 'ms' });
        return { output: ['毫秒：' + r2.ms, '秒：' + r2.seconds, 'ISO：' + r2.iso].join('\n'), data: r2 };
      }
      var r = cc().timestampToDate(reqText(input).trim(), { unit: params.unit, tz: tz });
      return {
        output: ['识别单位：' + r.detectedUnit, 'ISO(UTC)：' + r.isoUTC, 'UTC：' + r.utc, '本地(' + r.tzLabel + ')：' + r.local, '星期：' + r.weekday, '秒：' + r.seconds, '毫秒：' + r.ms].join('\n'),
        data: r
      };
    }
  });

  TOOLS.push({
    id: 'codec-hash', cat: 'codec', name: '哈希计算', icon: 'hash', outLang: 'text', view: 'text',
    desc: 'SHA-1 / SHA-256 / SHA-384 / SHA-512（WebCrypto，异步）',
    params: [sel('algorithm', '算法', [{ value: 'SHA-256', label: 'SHA-256' }, { value: 'SHA-1', label: 'SHA-1' }, { value: 'SHA-384', label: 'SHA-384' }, { value: 'SHA-512', label: 'SHA-512' }], 'SHA-256')],
    run: function (input, params) {
      var text = reqText(input);
      return cc().hash(text, params.algorithm).then(function (hex) {
        return { output: hex + '\n\n（' + params.algorithm + '，输入 ' + text.length + ' 字符）', notices: ['哈希计算完成'] };
      });
    }
  });

  TOOLS.push({
    id: 'codec-uuid', cat: 'codec', name: 'UUID / 随机 ID', icon: 'id', outLang: 'text', view: 'text',
    desc: '生成 UUID v4 / NanoID / 短随机 ID',
    params: [
      sel('type', '类型', [{ value: 'v4', label: 'UUID v4' }, { value: 'nanoid', label: 'NanoID' }, { value: 'short', label: '短随机 ID' }], 'v4'),
      num('count', '生成个数', 5, 1, 1000),
      num('size', 'NanoID 长度', 21, 4, 64),
      chk('uppercase', '大写', false),
      chk('noHyphen', 'UUID 去掉连字符', false)
    ],
    run: function (input, params) {
      var out = [];
      for (var i = 0; i < params.count; i++) {
        if (params.type === 'nanoid') out.push(cc().nanoId({ size: params.size }));
        else if (params.type === 'short') out.push(cc().shortId());
        else out.push(cc().uuidV4({ uppercase: params.uppercase, noHyphen: params.noHyphen }));
      }
      return { output: out.join('\n'), data: out, notices: ['已生成 ' + params.count + ' 个'] };
    }
  });

  TOOLS.push({
    id: 'codec-regex', cat: 'codec', name: '正则测试器', icon: 'regex', outLang: 'text', view: 'text',
    desc: '测试正则匹配，输出匹配列表、位置与分组捕获',
    params: [txt('pattern', '正则表达式', '\\d+', '如 \\w+@\\w+\\.com'), txt('flags', '标志 (g i m s u y)', 'g'), chk('forceGlobal', '强制全局匹配', false)],
    run: function (input, params) {
      var flags = params.flags || '';
      if (params.forceGlobal && flags.indexOf('g') < 0) flags += 'g';
      var r = cc().regexTest(reqText(input), params.pattern, flags);
      if (!r.count) return { output: '无匹配。', data: r, notices: ['匹配 0 处'] };
      var lines = r.matches.map(function (m, i) {
        var s = '#' + (i + 1) + '  位置 ' + m.index + '  长度 ' + m.length + '\n    匹配: ' + m.match;
        if (m.groups && m.groups.length) s += '\n    分组: ' + JSON.stringify(m.groups);
        if (m.named) s += '\n    命名组: ' + JSON.stringify(m.named);
        return s;
      });
      return { output: lines.join('\n\n'), data: r, notices: ['匹配 ' + r.count + ' 处'] };
    }
  });

  TOOLS.push({
    id: 'codec-string', cat: 'codec', name: '字符串字面量转换', icon: 'abc', outLang: 'text', view: 'text',
    desc: '普通文本 ⇄ JSON 字符串 ⇄ JS 单引号 ⇄ C 风格转义',
    params: [sel('target', '目标形式', [{ value: 'toJson', label: 'JSON 字符串（双引号）' }, { value: 'toJs', label: 'JS 字符串（单引号）' }, { value: 'toC', label: 'C 风格转义' }, { value: 'parse', label: '解析字面量为文本' }], 'toJson')],
    run: function (input, params) {
      var text = reqText(input);
      switch (params.target) {
        case 'toJs': return { output: cc().toJsLiteral(text) };
        case 'toC': return { output: cc().toCLiteral(text) };
        case 'parse': return { output: cc().parseLiteral(text).value };
        default: return { output: cc().toJsonLiteral(text) };
      }
    }
  });

  /* ---------- 分类六：实用工具 ---------- */

  TOOLS.push({
    id: 'utility-mock', cat: 'utility', name: 'Mock 数据生成', icon: 'dice', outLang: 'json', view: 'text',
    desc: '按当前 JSON 结构生成随机 Mock 数据',
    params: [num('count', '顶层条数', 3, 1, 1000), num('arrayCount', '数组元素个数', 3, 0, 100), num('stringMin', '字符串最短', 4, 1, 200), num('stringMax', '字符串最长', 12, 1, 200), txt('seed', '随机种子（可空）', '')],
    run: function (input, params, ctx) {
      var v = reqJson(ctx);
      return {
        output: cg().toMock(v, { count: params.count, arrayCount: params.arrayCount, stringMin: params.stringMin, stringMax: params.stringMax, seed: params.seed }),
        notices: ['已按结构生成 Mock 数据']
      };
    }
  });

  TOOLS.push({
    id: 'utility-shuffle', cat: 'utility', name: '随机打乱 / 取样', icon: 'shuffle', outLang: 'json', view: 'text',
    desc: '随机打乱数组，或随机取样 N 条（可设种子）',
    params: [num('count', '取样条数（0=全部打乱）', 0, 0, 100000), txt('seed', '随机种子（可空）', '')],
    run: function (input, params, ctx) {
      var v = asArray(reqJson(ctx)).slice();
      var rand = rng(params.seed);
      for (var i = v.length - 1; i > 0; i--) { var k = Math.floor(rand() * (i + 1)); var t = v[i]; v[i] = v[k]; v[k] = t; }
      var out = params.count > 0 ? v.slice(0, params.count) : v;
      return { output: pretty(out), notices: ['共 ' + v.length + ' 条，输出 ' + out.length + ' 条'] };
    }
  });

  TOOLS.push({
    id: 'utility-split', cat: 'utility', name: '数组分块', icon: 'split', outLang: 'json', view: 'text',
    desc: '按每 N 条把数组切分为多个块',
    params: [num('size', '每块条数', 10, 1, 100000)],
    run: function (input, params, ctx) {
      var v = asArray(reqJson(ctx));
      var size = Math.max(1, params.size);
      var chunks = [];
      for (var i = 0; i < v.length; i += size) chunks.push(v.slice(i, i + size));
      return { output: pretty(chunks), notices: ['切分为 ' + chunks.length + ' 块'] };
    }
  });

  TOOLS.push({
    id: 'utility-sample', cat: 'utility', name: '大数组抽样', icon: 'sample', outLang: 'json', view: 'text',
    desc: '首 N 条 / 随机 N 条 / 按步长抽样',
    params: [sel('mode', '模式', [{ value: 'first', label: '前 N 条' }, { value: 'random', label: '随机 N 条' }, { value: 'step', label: '按步长' }], 'first'), num('count', 'N 条', 10, 1, 1000000), num('step', '步长', 10, 1, 1000000), txt('seed', '随机种子（可空）', '')],
    run: function (input, params, ctx) {
      var v = asArray(reqJson(ctx));
      var out;
      if (params.mode === 'random') {
        var rand = rng(params.seed);
        var copy = v.slice();
        for (var i = copy.length - 1; i > 0; i--) { var k = Math.floor(rand() * (i + 1)); var t = copy[i]; copy[i] = copy[k]; copy[k] = t; }
        out = copy.slice(0, params.count);
      } else if (params.mode === 'step') {
        out = [];
        for (var s = 0; s < v.length; s += Math.max(1, params.step)) out.push(v[s]);
      } else {
        out = v.slice(0, params.count);
      }
      return { output: pretty(out), notices: ['原始 ' + v.length + ' 条 → 抽样 ' + out.length + ' 条'] };
    }
  });

  /* ============================ 统一异常包装 ============================ */

  TOOLS.forEach(function (t) {
    var raw = t.run;
    t.run = function (input, params, ctx) {
      params = params || {};
      try {
        var res = raw(input, params, ctx);
        if (res && typeof res.then === 'function') {
          return res.then(function (r) { return r || {}; }, function (e) {
            return { output: '', error: (e && e.message) || String(e), errorLine: (e && e.jtc && e.jtc.line) || null };
          });
        }
        return res || {};
      } catch (e) {
        return { output: '', error: (e && e.message) || String(e), errorLine: (e && e.jtc && e.jtc.line) || null };
      }
    };
    if (t.cat === 'utility' && t.params === undefined) t.params = [];
    var p = t.params || [];
    var defaults = {};
    p.forEach(function (x) { defaults[x.id] = x.default; });
    t.defaultParams = defaults;
    if (!t.icon) t.icon = 'wand';
    if (!t.view) t.view = 'text';
    if (!t.outLang) t.outLang = 'text';
  });

  var byId = {};
  TOOLS.forEach(function (t) { byId[t.id] = t; });

  JT.registry = {
    categories: JT.categories,
    tools: TOOLS,
    byId: byId,
    get: function (id) { return byId[id] || null; },
    countByCat: function (cat) { return TOOLS.filter(function (t) { return t.cat === cat; }).length; }
  };
})();
