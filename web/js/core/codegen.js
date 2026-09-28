/*!
 * core/codegen.js —— JSON 工具箱 · 代码模型生成纯逻辑层（零 DOM 依赖）
 * 职责：类型推断 + TS/Java/Kotlin/Go/Python/C#/Rust/Swift/Dart/PHP + DDL + JSON Schema + Mock
 */
(function (root) {
  'use strict';

  var NS = (root.JTCore = root.JTCore || {});

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  /* ============================ 命名风格 ============================ */

  function splitWords(name) {
    return String(name == null ? '' : name)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[^A-Za-z0-9\u4e00-\u9fa5]+/)
      .filter(function (w) { return w.length > 0; });
  }
  function toPascal(name) {
    var w = splitWords(name);
    if (!w.length) return 'Type';
    return w.map(function (x) { return x.charAt(0).toUpperCase() + x.slice(1); }).join('');
  }
  function toCamel(name) {
    var p = toPascal(name);
    return p.charAt(0).toLowerCase() + p.slice(1);
  }
  function toSnake(name) {
    var w = splitWords(name);
    if (!w.length) return 'field';
    return w.map(function (x) { return x.toLowerCase(); }).join('_');
  }
  function styleName(name, style) {
    switch (style) {
      case 'snake': return toSnake(name);
      case 'pascal': return toPascal(name);
      case 'keep': return String(name);
      case 'camel': default: return toCamel(name);
    }
  }

  /* ============================ 各语言保留字（非穷尽，覆盖常见场景） ============================
   * 说明：仅收录各类语言的关键字与高频硬保留字/内置名，用于生成字段名时规避非法标识符。
   * 命中后统一追加 _1 后缀（仍冲突则走 uniqueField 的 _2/_3 递增），原始键名经注解/tag/注释保留。
   */
  var RESERVED = {
    ts: ['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'await', 'async', 'interface', 'implements', 'package', 'private', 'protected', 'public', 'readonly', 'abstract', 'any', 'boolean', 'number', 'string', 'object', 'symbol', 'never', 'unknown', 'type'],
    java: ['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null', 'var', 'record', 'sealed', 'yield'],
    kotlin: ['as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in', 'interface', 'is', 'null', 'object', 'package', 'return', 'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while', 'by', 'catch', 'constructor', 'delegate', 'dynamic', 'field', 'file', 'finally', 'get', 'import', 'init', 'param', 'property', 'receiver', 'set', 'setparam', 'where', 'abstract', 'actual', 'annotation', 'companion', 'const', 'crossinline', 'data', 'enum', 'expect', 'external', 'final', 'infix', 'inline', 'inner', 'internal', 'lateinit', 'noinline', 'open', 'operator', 'out', 'override', 'private', 'protected', 'public', 'reified', 'sealed', 'suspend', 'tailrec', 'vararg', 'it'],
    go: ['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var', 'nil', 'true', 'false', 'any', 'error', 'string', 'bool', 'byte', 'rune', 'int', 'int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'float32', 'float64', 'len', 'cap', 'make', 'new', 'append', 'copy', 'delete', 'panic', 'recover'],
    python: ['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'self', 'int', 'float', 'str', 'bool', 'list', 'dict', 'set', 'tuple', 'type', 'id', 'object', 'input', 'print', 'format'],
    csharp: ['abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char', 'checked', 'class', 'const', 'continue', 'decimal', 'default', 'delegate', 'do', 'double', 'else', 'enum', 'event', 'explicit', 'extern', 'false', 'finally', 'fixed', 'float', 'for', 'foreach', 'goto', 'if', 'implicit', 'in', 'int', 'interface', 'internal', 'is', 'lock', 'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override', 'params', 'private', 'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed', 'short', 'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using', 'virtual', 'void', 'volatile', 'while', 'var', 'dynamic', 'async', 'await', 'record', 'init', 'required'],
    rust: ['as', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while', 'async', 'await', 'abstract', 'become', 'box', 'do', 'final', 'macro', 'override', 'priv', 'typeof', 'unsized', 'virtual', 'yield', 'try'],
    swift: ['associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate', 'func', 'import', 'init', 'inout', 'internal', 'let', 'open', 'operator', 'private', 'precedencegroup', 'protocol', 'public', 'rethrows', 'static', 'struct', 'subtype', 'typealias', 'var', 'break', 'case', 'catch', 'continue', 'default', 'defer', 'do', 'else', 'fallthrough', 'for', 'guard', 'if', 'in', 'repeat', 'return', 'throw', 'throws', 'switch', 'where', 'while', 'as', 'Any', 'false', 'is', 'nil', 'super', 'self', 'Self', 'true', 'try', 'await', 'async', 'some', 'Type', 'type'],
    dart: ['abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'covariant', 'default', 'deferred', 'do', 'dynamic', 'else', 'enum', 'export', 'extends', 'extension', 'external', 'factory', 'false', 'final', 'finally', 'for', 'Function', 'get', 'hide', 'if', 'implements', 'import', 'in', 'interface', 'is', 'late', 'library', 'mixin', 'new', 'null', 'on', 'operator', 'part', 'required', 'rethrow', 'return', 'sealed', 'set', 'show', 'static', 'super', 'switch', 'sync', 'this', 'throw', 'true', 'try', 'typedef', 'var', 'void', 'while', 'with', 'yield', 'int', 'double', 'num', 'bool', 'String', 'List', 'Map', 'Set', 'type'],
    php: ['abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch', 'class', 'clone', 'const', 'continue', 'declare', 'default', 'do', 'echo', 'else', 'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach', 'endif', 'endswitch', 'endwhile', 'enum', 'extends', 'final', 'finally', 'fn', 'for', 'foreach', 'function', 'global', 'goto', 'if', 'implements', 'include', 'include_once', 'instanceof', 'insteadof', 'interface', 'isset', 'list', 'match', 'namespace', 'new', 'or', 'print', 'private', 'protected', 'public', 'readonly', 'require', 'require_once', 'return', 'static', 'switch', 'throw', 'trait', 'try', 'unset', 'use', 'var', 'while', 'xor', 'yield', 'true', 'false', 'null', 'int', 'float', 'string', 'bool', 'type'],
    sql: ['select', 'from', 'where', 'insert', 'update', 'delete', 'create', 'drop', 'alter', 'table', 'index', 'view', 'primary', 'foreign', 'key', 'references', 'unique', 'check', 'default', 'constraint', 'column', 'and', 'or', 'not', 'null', 'in', 'between', 'like', 'order', 'group', 'by', 'having', 'join', 'left', 'right', 'inner', 'outer', 'full', 'on', 'as', 'union', 'distinct', 'case', 'when', 'then', 'else', 'end', 'values', 'set', 'into', 'type']
  };
  /** 各语言的展示名与「原键保留位置」说明，用于生成 notices 提示文案。 */
  var LANG_LABEL = { ts: 'TypeScript', java: 'Java', kotlin: 'Kotlin', go: 'Go', python: 'Python', csharp: 'C#', rust: 'Rust', swift: 'Swift', dart: 'Dart', php: 'PHP', sql: 'SQL' };
  var KEY_MAPPING = {
    ts: 'JSON 原键（TypeScript 无注解机制，序列化层需自行映射）',
    java: '@JsonProperty',
    kotlin: '@JsonProperty（勾选「@JsonProperty 注解」参数后生成）',
    go: 'json tag',
    python: '字段别名 / 行尾注释',
    csharp: 'JsonPropertyName',
    rust: 'serde rename',
    swift: 'CodingKeys',
    dart: 'json 键映射（fromJson/toJson 使用原键）',
    php: '数组键（原键保留）',
    sql: '列注释'
  };
  /** 个别语言会在模型字段名之上再做大小写归一，提示文案里需说明最终形态。 */
  var CASE_NOTE = {
    go: '（Go 导出字段会按规范转为大写驼峰，如 Class1）',
    csharp: '（C# 属性会按规范转为大写驼峰，如 Class1）'
  };

  /* ============================ 类型推断 ============================ */

  function detectFormat(s) {
    if (typeof s !== 'string') return null;
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(s)) return 'date-time';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'date';
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return 'time';
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return 'email';
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)) return 'uuid';
    if (/^https?:\/\/\S+$/.test(s)) return 'uri';
    if (/^[0-9a-fA-F]{24}$/.test(s)) return 'objectid';
    return null;
  }

  function markNullable(schema) {
    if (!schema) return { type: 'null' };
    var s = cloneSchema(schema);
    s.nullable = true;
    return s;
  }
  function cloneSchema(s) { return JSON.parse(JSON.stringify(s)); }

  function inferValue(v) {
    if (v === null) return { type: 'null' };
    if (Array.isArray(v)) {
      var item = null;
      v.forEach(function (e) { item = mergeSchemas(item, inferValue(e)); });
      return { type: 'array', item: item || { type: 'any' } };
    }
    if (typeof v === 'object') {
      var props = {}, required = {};
      Object.keys(v).forEach(function (k) { props[k] = inferValue(v[k]); required[k] = true; });
      return { type: 'object', props: props, required: required };
    }
    if (typeof v === 'boolean') return { type: 'boolean' };
    if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer' } : { type: 'number' };
    return { type: 'string', format: detectFormat(v) };
  }

  function mergeSchemas(a, b) {
    if (!a) return b ? cloneSchema(b) : null;
    if (!b) return cloneSchema(a);
    if (a.type !== b.type) {
      if ((a.type === 'integer' && b.type === 'number') || (a.type === 'number' && b.type === 'integer')) return { type: 'number' };
      if (a.type === 'null') return markNullable(b);
      if (b.type === 'null') return markNullable(a);
      return { type: 'mixed', nullable: a.nullable || b.nullable };
    }
    if (a.type === 'object') {
      var props = {};
      var keys = {};
      Object.keys(a.props || {}).forEach(function (k) { keys[k] = 1; });
      Object.keys(b.props || {}).forEach(function (k) { keys[k] = 1; });
      var reqA = a.required || {}, reqB = b.required || {};
      var required = {};
      Object.keys(keys).forEach(function (k) {
        if (a.props && b.props && a.props[k] && b.props[k]) props[k] = mergeSchemas(a.props[k], b.props[k]);
        else if (a.props && a.props[k]) props[k] = cloneSchema(a.props[k]);
        else props[k] = cloneSchema(b.props[k]);
        if (reqA[k] && reqB[k]) required[k] = true;
      });
      return { type: 'object', props: props, required: required };
    }
    if (a.type === 'array') return { type: 'array', item: mergeSchemas(a.item, b.item) || { type: 'any' } };
    return { type: a.type, format: a.format || b.format, nullable: a.nullable || b.nullable };
  }

  /* ============================ 统一模型 ============================ */

  function buildModel(rootSchema, rootName, opts) {
    opts = opts || {};
    var style = opts.nameStyle || 'camel';
    var types = [];
    var used = {};
    var report = Array.isArray(opts.report) ? opts.report : null;

    function unique(base) {
      var n = base || 'Type';
      if (!used[n]) { used[n] = 1; return n; }
      var i = 2;
      while (used[n + i]) i++;
      used[n + i] = 1;
      return n + i;
    }
    /**
     * 结构内字段名处理：
     * 1) 命中目标语言保留字 → 追加 _1 后缀（原键经注解/tag/注释保留）；
     * 2) 不同 JSON 键被规整成同一标识符时（如 "a b" / aB / "a-b" 都 → aB）→ 追加 _2/_3 递增。
     * 两种改动都会写入 report（由调用方汇入 notices 反馈给用户）。
     * @param {string} base 规整后的候选字段名
     * @param {Object} usedSet 当前结构内已占用的名字集合
     * @param {string} jsonKey 原始 JSON 键（仅用于提示）
     * @returns {{name:string, reserved:boolean}}
     */
    function uniqueField(base, usedSet, jsonKey) {
      var lang = opts.lang;
      var list = lang ? RESERVED[lang] : null;
      var n = base || 'field';
      var reserved = false;
      if (list && list.indexOf(n) >= 0) {
        n = n + '_1';
        reserved = true;
      }
      if (!usedSet[n]) {
        usedSet[n] = 1;
        if (reserved && report) {
          report.push('字段「' + jsonKey + '」是 ' + (LANG_LABEL[lang] || lang) + ' 保留字，已重命名为「' + n + '」（原键已保留在 ' + (KEY_MAPPING[lang] || '原始键映射') + '）' + (CASE_NOTE[lang] || '') + '。');
        }
        return { name: n, reserved: reserved };
      }
      var i = 2;
      while (usedSet[n + '_' + i]) i++;
      var name = n + '_' + i;
      usedSet[name] = 1;
      if (report) {
        report.push((reserved
          ? '字段「' + jsonKey + '」是 ' + (LANG_LABEL[lang] || lang) + '保留字，且「' + n + '」已被占用，已重命名为「' + name + '」'
          : '字段名冲突：JSON 键「' + jsonKey + '」的生成名「' + base + '」与同结构内其他字段重复，已重命名为「' + name + '」以避免冲突') + '（原始键名仍通过注解/映射保留）。');
      }
      return { name: name, reserved: reserved };
    }
    function prim(node) {
      switch (node.type) {
        case 'string': return { kind: 'prim', name: 'string', format: node.format || null };
        case 'integer': return { kind: 'prim', name: 'integer' };
        case 'number': return { kind: 'prim', name: 'number' };
        case 'boolean': return { kind: 'prim', name: 'boolean' };
        case 'null': return { kind: 'prim', name: 'null' };
        default: return { kind: 'prim', name: 'any' };
      }
    }
    function emit(node, hint) {
      if (!node) return { kind: 'prim', name: 'any' };
      if (node.type === 'array') {
        return { kind: 'array', item: emit(node.item || { type: 'any' }, hint + 'Item') };
      }
      if (node.type === 'object') {
        var name = unique(toPascal(hint));
        var rec = { name: name, kind: 'object', fields: [] };
        types.push(rec);
        var usedNames = {};
        Object.keys(node.props || {}).forEach(function (k) {
          var child = node.props[k];
          var t = (child.type === 'object' || child.type === 'array') ? emit(child, name + toPascal(k)) : prim(child);
          var fld = uniqueField(styleName(k, style), usedNames, k);
          rec.fields.push({
            jsonKey: k,
            name: fld.name,
            reserved: fld.reserved,
            type: t,
            optional: !(node.required && node.required[k]),
            nullable: !!child.nullable,
            format: child.format || null
          });
        });
        return { kind: 'ref', name: name };
      }
      return prim(node);
    }
    var rootRef = emit(rootSchema, rootName || 'Root');
    return { types: types, rootRef: rootRef, rootName: (rootRef.kind === 'ref' ? rootRef.name : 'Root') };
  }

  function typeContainsArray(t) {
    if (t.kind === 'array') return true;
    return false;
  }
  function modelUsesArray(model) {
    var found = false;
    model.types.forEach(function (ty) { if (ty.fields.some(function (f) { return typeContainsArray(f.type); })) found = true; });
    if (model.rootRef.kind === 'array') found = true;
    return found;
  }

  /* ============================ TypeScript ============================ */
  function tsType(t) {
    if (t.kind === 'prim') {
      switch (t.name) { case 'string': return 'string'; case 'integer': case 'number': return 'number'; case 'boolean': return 'boolean'; case 'null': return 'null'; default: return 'any'; }
    }
    if (t.kind === 'ref') return t.name;
    if (t.kind === 'array') {
      var inner = tsType(t.item);
      return (t.item.kind === 'prim' || t.item.kind === 'ref') ? inner + '[]' : '(' + inner + ')[]';
    }
    return 'any';
  }
  function toTypeScript(value, opts) {
    opts = opts || {};
    opts.lang = 'ts'; // 供 buildModel 做目标语言保留字规避
    var schema = opts.schema || inferValue(value);
    var model = buildModel(schema, opts.rootName || 'Root', opts);
    var exp = opts.exportKeyword === false ? '' : 'export ';
    var out = [];
    model.types.forEach(function (ty) {
      var lines = [exp + 'interface ' + ty.name + ' {'];
      ty.fields.forEach(function (f) {
        var opt = (opts.optionalMode === 'all' || (opts.optionalMode !== 'none' && f.optional)) ? '?' : '';
        lines.push('  ' + f.name + opt + ': ' + tsType(f.type) + ';');
      });
      if (!ty.fields.length) lines.push('  [key: string]: any;');
      lines.push('}');
      out.push(lines.join('\n'));
    });
    if (model.rootRef.kind !== 'ref') out.unshift(exp + 'type ' + (opts.rootName || 'Root') + ' = ' + tsType(model.rootRef) + ';');
    return out.join('\n\n');
  }

  /* ============================ Java ============================ */
  function javaType(t) {
    if (t.kind === 'prim') {
      switch (t.name) { case 'string': return 'String'; case 'integer': return 'Integer'; case 'number': return 'Double'; case 'boolean': return 'Boolean'; default: return 'Object'; }
    }
    if (t.kind === 'ref') return t.name;
    if (t.kind === 'array') return 'List<' + javaType(t.item) + '>';
    return 'Object';
  }
  function toJava(value, opts) {
    opts = opts || {};
    opts.lang = 'java'; // 供 buildModel 做目标语言保留字规避
    var schema = opts.schema || inferValue(value);
    var model = buildModel(schema, opts.rootName || 'Root', opts);
    var out = [];
    if (opts.packageName) out.push('package ' + opts.packageName + ';');
    var imports = [];
    if (modelUsesArray(model)) imports.push('import java.util.List;');
    if (opts.jackson) imports.push('import com.fasterxml.jackson.annotation.JsonProperty;');
    if (imports.length) out.push(imports.join('\n'));
    var nested = model.types.filter(function (ty) { return ty.name !== model.rootName; });
    function renderClass(ty, isNested) {
      var lines = [];
      var annos = [];
      if (opts.lombok === 'data') annos.push('@Data');
      else if (opts.lombok === 'getset') { annos.push('@Getter'); annos.push('@Setter'); }
      annos.forEach(function (a) { lines.push(a); });
      lines.push((isNested ? 'public static class ' : 'public class ') + ty.name + ' {');
      if (!ty.fields.length) { lines.push('    // 无字段'); }
      ty.fields.forEach(function (f) {
        if (opts.jackson && f.name !== f.jsonKey) lines.push('    @JsonProperty("' + f.jsonKey + '")');
        lines.push('    private ' + javaType(f.type) + ' ' + f.name + ';');
      });
      // 无 Lombok 时生成 getter/setter
      if (opts.lombok === 'none') {
        ty.fields.forEach(function (f) {
          var cap = f.name.charAt(0).toUpperCase() + f.name.slice(1);
          var tname = javaType(f.type);
          lines.push('');
          lines.push('    public ' + tname + ' get' + cap + '() { return this.' + f.name + '; }');
          lines.push('    public void set' + cap + '(' + tname + ' ' + f.name + ') { this.' + f.name + ' = ' + f.name + '; }');
        });
      }
      lines.push('}');
      return lines.join('\n');
    }
    if (model.rootRef.kind === 'ref') {
      var root = model.types[0];
      var body = [renderClass(root, false)];
      nested.forEach(function (ty) { body.push(''); body.push(renderClass(ty, true)); });
      // 嵌套类需放进根类内：重新构造
      if (nested.length) {
        var lines2 = [];
        var annos2 = [];
        if (opts.lombok === 'data') annos2.push('@Data');
        else if (opts.lombok === 'getset') { annos2.push('@Getter'); annos2.push('@Setter'); }
        lines2 = lines2.concat(annos2);
        lines2.push('public class ' + root.name + ' {');
        root.fields.forEach(function (f) {
          if (opts.jackson && f.name !== f.jsonKey) lines2.push('    @JsonProperty("' + f.jsonKey + '")');
          lines2.push('    private ' + javaType(f.type) + ' ' + f.name + ';');
        });
        if (opts.lombok === 'none') {
          root.fields.forEach(function (f) {
            var cap = f.name.charAt(0).toUpperCase() + f.name.slice(1);
            var tname = javaType(f.type);
            lines2.push('');
            lines2.push('    public ' + tname + ' get' + cap + '() { return this.' + f.name + '; }');
            lines2.push('    public void set' + cap + '(' + tname + ' ' + f.name + ') { this.' + f.name + ' = ' + f.name + '; }');
          });
        }
        nested.forEach(function (ty) {
          lines2.push('');
          renderClass(ty, true).split('\n').forEach(function (l) { lines2.push('    ' + l); });
        });
        lines2.push('}');
        body = [lines2.join('\n')];
      }
      out.push(body.join('\n\n'));
    } else {
      model.types.forEach(function (ty) { out.push(renderClass(ty, false)); });
      out.push('// 注意：根结构为 ' + (model.rootRef.kind === 'array' ? '数组，元素类型见上方定义' : '基础类型') + '。');
    }
    return out.join('\n\n');
  }

  /* ============================ Kotlin ============================ */
  function ktType(t) {
    if (t.kind === 'prim') {
      switch (t.name) { case 'string': return 'String'; case 'integer': return 'Int'; case 'number': return 'Double'; case 'boolean': return 'Boolean'; default: return 'Any'; }
    }
    if (t.kind === 'ref') return t.name;
    if (t.kind === 'array') return 'List<' + ktType(t.item) + '>';
    return 'Any';
  }
  function toKotlin(value, opts) {
    opts = opts || {};
    opts.lang = 'kotlin'; // 供 buildModel 做目标语言保留字规避
    var schema = opts.schema || inferValue(value);
    var model = buildModel(schema, opts.rootName || 'Root', opts);
    var out = [];
    if (opts.jackson) out.push('import com.fasterxml.jackson.annotation.JsonProperty');
    model.types.forEach(function (ty) {
      var lines = ['data class ' + ty.name + '('];
      ty.fields.forEach(function (f, idx) {
        var opt = (opts.optionalMode === 'all' || (opts.optionalMode !== 'none' && f.optional)) ? '?' : '';
        var anno = (opts.jackson && f.name !== f.jsonKey) ? '    @JsonProperty("' + f.jsonKey + '") ' : '    ';
        lines.push(anno + 'val ' + f.name + ': ' + ktType(f.type) + opt + (idx < ty.fields.length - 1 ? ',' : ''));
      });
      if (!ty.fields.length) lines.push('    // 无字段');
      lines.push(')');
      out.push(lines.join('\n'));
    });
    if (model.rootRef.kind !== 'ref') out.push('typealias ' + (opts.rootName || 'Root') + ' = ' + ktType(model.rootRef));
    return out.join('\n\n');
  }

  /* ============================ Go ============================ */
  function goType(t, valueMode) {
    if (t.kind === 'prim') {
      switch (t.name) { case 'string': return 'string'; case 'integer': return 'int64'; case 'number': return 'float64'; case 'boolean': return 'bool'; default: return 'interface{}'; }
    }
    if (t.kind === 'ref') return valueMode === 'pointer' ? '*' + t.name : t.name;
    if (t.kind === 'array') return '[]' + goType(t.item, valueMode);
    return 'interface{}';
  }
  function toGo(value, opts) {
    opts = opts || {};
    opts.lang = 'go'; // 供 buildModel 做目标语言保留字规避
    var schema = opts.schema || inferValue(value);
    var model = buildModel(schema, opts.rootName || 'Root', opts);
    var ptrMode = opts.pointerForOptional ? 'pointer' : 'value';
    var out = ['package ' + (opts.packageName || 'main'), ''];
    model.types.forEach(function (ty) {
      var lines = ['type ' + ty.name + ' struct {'];
      if (!ty.fields.length) lines.push('\t// 无字段');
      ty.fields.forEach(function (f) {
        var tname = goType(f.type, (!f.optional && ptrMode === 'pointer') ? 'value' : (f.optional && ptrMode === 'pointer' ? 'pointer' : 'value'));
        var tag = '';
        if (opts.jsonTag !== false) {
          var omit = (opts.omitempty !== false && f.optional) ? ',omitempty' : '';
          tag = ' `json:"' + f.jsonKey + omit + '"`';
        }
        lines.push('\t' + toPascal(f.name) + ' ' + tname + tag);
      });
      lines.push('}');
      out.push(lines.join('\n'));
    });
    if (model.rootRef.kind !== 'ref') out.push('type ' + (opts.rootName || 'Root') + ' = ' + goType(model.rootRef, 'value'));
    return out.join('\n\n');
  }

  /* ============================ Python ============================ */
  function pyType(t, optional) {
    var base;
    if (t.kind === 'prim') {
      switch (t.name) { case 'string': base = 'str'; break; case 'integer': base = 'int'; break; case 'number': base = 'float'; break; case 'boolean': base = 'bool'; break; case 'null': base = 'None'; break; default: base = 'Any'; }
    } else if (t.kind === 'ref') base = t.name;
    else if (t.kind === 'array') base = 'List[' + pyTypeInner(t.item) + ']';
    else base = 'Any';
    return optional ? 'Optional[' + base + ']' : base;
  }
  function pyTypeInner(t) {
    if (t.kind === 'prim') {
      switch (t.name) { case 'string': return 'str'; case 'integer': return 'int'; case 'number': return 'float'; case 'boolean': return 'bool'; case 'null': return 'None'; default: return 'Any'; }
    }
    if (t.kind === 'ref') return t.name;
    if (t.kind === 'array') return 'List[' + pyTypeInner(t.item) + ']';
    return 'Any';
  }
  function toPython(value, opts) {
    opts = opts || {};
    opts.lang = 'python'; // 供 buildModel 做目标语言保留字规避
    var style = opts.pyStyle || 'dataclass';
    var schema = opts.schema || inferValue(value);
    var model = buildModel(schema, opts.rootName || 'Root', opts);
    var out = [];
    if (style === 'pydantic') {
      out.push('from pydantic import BaseModel, Field');
      out.push('from typing import List, Optional, Any');
    } else {
      out.push('from dataclasses import dataclass' + (modelUsesArray(model) ? ', field' : ''));
      out.push('from typing import List, Optional, Any' + (style === 'typeddict' ? ', TypedDict' : ''));
    }
    out.push('');
    model.types.forEach(function (ty) {
      var lines = [];
      if (style === 'pydantic') {
        lines.push('class ' + ty.name + '(BaseModel):');
        if (!ty.fields.length) lines.push('    pass');
        ty.fields.forEach(function (f) {
          var opt = opts.optionalMode === 'all' || (opts.optionalMode !== 'none' && f.optional);
          var tname = pyType(f.type, opt);
          if (f.name !== f.jsonKey) {
            lines.push('    ' + f.name + ': ' + tname + ' = Field(' + (opt ? 'default=None, ' : '') + 'alias="' + f.jsonKey + '")');
          } else {
            lines.push('    ' + f.name + ': ' + tname + (opt ? ' = None' : ''));
          }
        });
      } else if (style === 'typeddict') {
        var total = opts.optionalMode === 'all';
        lines.push('class ' + ty.name + '(TypedDict' + (total ? ', total=False' : '') + '):');
        if (!ty.fields.length) lines.push('    pass');
        ty.fields.forEach(function (f) {
          var opt = opts.optionalMode === 'all' || (opts.optionalMode !== 'none' && f.optional);
          lines.push('    ' + f.name + ': ' + pyType(f.type, opt) + (f.reserved ? '  # 原 JSON 键: "' + f.jsonKey + '"' : ''));
        });
      } else {
        lines.push('@dataclass');
        lines.push('class ' + ty.name + ':');
        if (!ty.fields.length) lines.push('    pass');
        ty.fields.forEach(function (f) {
          var opt = opts.optionalMode === 'all' || (opts.optionalMode !== 'none' && f.optional);
          lines.push('    ' + f.name + ': ' + pyType(f.type, opt) + (opt ? ' = None' : '') + (f.reserved ? '  # 原 JSON 键: "' + f.jsonKey + '"' : ''));
        });
      }
      out.push(lines.join('\n'));
    });
    if (model.rootRef.kind !== 'ref') out.push((opts.rootName || 'Root') + ' = ' + pyType(model.rootRef, false));
    return out.join('\n\n');
  }

  /* ============================ C# ============================ */
  function csType(t, optional) {
    var base;
    if (t.kind === 'prim') {
      switch (t.name) { case 'string': base = 'string'; break; case 'integer': base = 'int'; break; case 'number': base = 'double'; break; case 'boolean': base = 'bool'; break; default: base = 'object'; }
    } else if (t.kind === 'ref') base = t.name;
    else if (t.kind === 'array') base = 'List<' + csType(t.item, false).replace(/\?$/, '') + '>';
    else base = 'object';
    if (optional && base !== 'string' && base !== 'object') base += '?';
    else if (optional && base === 'string') base += '?';
    return base;
  }
  function toCSharp(value, opts) {
    opts = opts || {};
    opts.lang = 'csharp'; // 供 buildModel 做目标语言保留字规避
    var schema = opts.schema || inferValue(value);
    var model = buildModel(schema, opts.rootName || 'Root', opts);
    var out = [];
    if (modelUsesArray(model)) out.push('using System.Collections.Generic;');
    if (opts.jsonProperty) out.push('using System.Text.Json.Serialization;');
    var ns = opts.namespace;
    var indent = ns ? '    ' : '';
    if (ns) out.push('namespace ' + ns + '\n{');
    model.types.forEach(function (ty) {
      var lines = [indent + 'public class ' + ty.name, indent + '{'];
      if (!ty.fields.length) lines.push(indent + '    // 无字段');
      ty.fields.forEach(function (f) {
        if (opts.jsonProperty && f.name !== f.jsonKey) lines.push(indent + '    [JsonPropertyName("' + f.jsonKey + '")]');
        var opt = opts.optionalMode === 'all' || (opts.optionalMode !== 'none' && f.optional);
        lines.push(indent + '    public ' + csType(f.type, opt) + ' ' + toPascal(f.name) + ' { get; set; }');
      });
      lines.push(indent + '}');
      out.push(lines.join('\n'));
    });
    if (model.rootRef.kind !== 'ref') out.push(indent + '// 根结构为 ' + (model.rootRef.kind === 'array' ? 'List<' + csType(model.rootRef.item, false) + '>' : csType(model.rootRef, false)));
    if (ns) out.push('}');
    return out.join('\n\n');
  }

  /* ============================ Rust ============================ */
  function rustType(t, optional) {
    var base;
    if (t.kind === 'prim') {
      switch (t.name) { case 'string': base = 'String'; break; case 'integer': base = 'i64'; break; case 'number': base = 'f64'; break; case 'boolean': base = 'bool'; break; case 'null': base = '()'; break; default: base = 'serde_json::Value'; }
    } else if (t.kind === 'ref') base = t.name;
    else if (t.kind === 'array') base = 'Vec<' + rustType(t.item, false) + '>';
    else base = 'serde_json::Value';
    return optional ? 'Option<' + base + '>' : base;
  }
  function toRust(value, opts) {
    opts = opts || {};
    opts.lang = 'rust'; // 供 buildModel 做目标语言保留字规避
    var schema = opts.schema || inferValue(value);
    var model = buildModel(schema, opts.rootName || 'Root', opts);
    var out = ['use serde::{Deserialize, Serialize};', ''];
    model.types.forEach(function (ty) {
      var lines = ['#[derive(Serialize, Deserialize, Debug, Clone)]', 'pub struct ' + ty.name + ' {'];
      if (!ty.fields.length) lines.push('    // 无字段');
      ty.fields.forEach(function (f) {
        if (f.name !== f.jsonKey) lines.push('    #[serde(rename = "' + f.jsonKey + '")]');
        var opt = opts.optionalMode === 'all' || (opts.optionalMode !== 'none' && f.optional);
        lines.push('    pub ' + toSnake(f.name) + ': ' + rustType(f.type, opt) + ',');
      });
      lines.push('}');
      out.push(lines.join('\n'));
    });
    if (model.rootRef.kind !== 'ref') out.push('pub type ' + (opts.rootName || 'Root') + ' = ' + rustType(model.rootRef, false) + ';');
    return out.join('\n\n');
  }

  /* ============================ Swift ============================ */
  function swiftType(t, optional) {
    var base;
    if (t.kind === 'prim') {
      switch (t.name) { case 'string': base = 'String'; break; case 'integer': base = 'Int'; break; case 'number': base = 'Double'; break; case 'boolean': base = 'Bool'; break; default: base = 'AnyCodable'; }
    } else if (t.kind === 'ref') base = t.name;
    else if (t.kind === 'array') base = '[' + swiftType(t.item, false) + ']';
    else base = 'AnyCodable';
    return optional ? base + '?' : base;
  }
  function toSwift(value, opts) {
    opts = opts || {};
    opts.lang = 'swift'; // 供 buildModel 做目标语言保留字规避
    var schema = opts.schema || inferValue(value);
    var model = buildModel(schema, opts.rootName || 'Root', opts);
    var out = [];
    model.types.forEach(function (ty) {
      var lines = ['struct ' + ty.name + ': Codable {'];
      ty.fields.forEach(function (f) {
        var opt = opts.optionalMode === 'all' || (opts.optionalMode !== 'none' && f.optional);
        // 直接使用模型字段名（保留字重命名后的 class_1 等需与 CodingKeys case 严格一致）
        lines.push('    let ' + f.name + ': ' + swiftType(f.type, opt));
      });
      // Swift 的编码契约：一旦显式声明 CodingKeys，就必须为“全部”属性各提供一个 case，
      // 否则编译器会报 “does not have a matching CodingKeys case”。
      // 因此仅当存在任一「属性名 ≠ JSON 键」时才生成 CodingKeys，并为每个属性逐一写出 case
      // （未重命名的属性也要写 `case userName = "userName"`）；全都无需映射时则完全不生成 CodingKeys。
      var needKeys = ty.fields.some(function (f) { return f.name !== f.jsonKey; });
      if (needKeys) {
        lines.push('');
        lines.push('    enum CodingKeys: String, CodingKey {');
        ty.fields.forEach(function (f) {
          lines.push('        case ' + f.name + ' = "' + f.jsonKey + '"');
        });
        lines.push('    }');
      }
      lines.push('}');
      out.push(lines.join('\n'));
    });
    if (model.rootRef.kind !== 'ref') out.push('typealias ' + (opts.rootName || 'Root') + ' = ' + swiftType(model.rootRef, false));
    return out.join('\n\n');
  }

  /* ============================ Dart ============================ */
  function dartType(t, optional) {
    var base;
    if (t.kind === 'prim') {
      switch (t.name) { case 'string': base = 'String'; break; case 'integer': base = 'int'; break; case 'number': base = 'double'; break; case 'boolean': base = 'bool'; break; default: base = 'dynamic'; }
    } else if (t.kind === 'ref') base = t.name;
    else if (t.kind === 'array') base = 'List<' + dartType(t.item, false).replace(/\?$/, '') + '>';
    else base = 'dynamic';
    return optional ? base + '?' : base;
  }
  function toDart(value, opts) {
    opts = opts || {};
    opts.lang = 'dart'; // 供 buildModel 做目标语言保留字规避
    var schema = opts.schema || inferValue(value);
    var model = buildModel(schema, opts.rootName || 'Root', opts);
    var out = [];
    model.types.forEach(function (ty) {
      var lines = ['class ' + ty.name + ' {'];
      ty.fields.forEach(function (f) {
        var opt = opts.optionalMode === 'all' || (opts.optionalMode !== 'none' && f.optional);
        lines.push('  final ' + dartType(f.type, opt) + ' ' + f.name + ';');
      });
      lines.push('');
      if (ty.fields.length) {
        var params = ty.fields.map(function (f) {
          var opt = opts.optionalMode === 'all' || (opts.optionalMode !== 'none' && f.optional);
          return '    ' + (opt ? '' : 'required ') + 'this.' + f.name + ',';
        });
        lines.push('  ' + ty.name + '({');
        lines = lines.concat(params);
        lines.push('  });');
      } else {
        lines.push('  ' + ty.name + '();');
      }
      lines.push('');
      lines.push('  factory ' + ty.name + '.fromJson(Map<String, dynamic> json) => ' + ty.name + '(');
      ty.fields.forEach(function (f) {
        var opt = opts.optionalMode === 'all' || (opts.optionalMode !== 'none' && f.optional);
        var cast = f.type.kind === 'ref' ? (opt ? '(' + f.type.name + '?' : '') : '';
        var expr = 'json[\'' + f.jsonKey + '\']';
        if (f.type.kind === 'ref') expr = (opt ? '(' : '') + expr + ' == null ? null : ' + f.type.name + '.fromJson(' + expr + ')';
        lines.push('    ' + f.name + ': ' + expr + ',');
      });
      lines.push('  );');
      lines.push('');
      lines.push('  Map<String, dynamic> toJson() => {');
      ty.fields.forEach(function (f) {
        var expr = f.name;
        if (f.type.kind === 'ref') expr = f.name + '?.toJson()';
        lines.push('    \'' + f.jsonKey + '\': ' + expr + ',');
      });
      lines.push('  };');
      lines.push('}');
      out.push(lines.join('\n'));
    });
    if (model.rootRef.kind !== 'ref') out.push('typedef ' + (opts.rootName || 'Root') + ' = ' + dartType(model.rootRef, false) + ';');
    return out.join('\n\n');
  }

  /* ============================ PHP ============================ */
  function phpType(t, optional) {
    var base;
    if (t.kind === 'prim') {
      switch (t.name) { case 'string': base = 'string'; break; case 'integer': base = 'int'; break; case 'number': base = 'float'; break; case 'boolean': base = 'bool'; break; default: base = 'mixed'; }
    } else if (t.kind === 'ref') base = t.name;
    else if (t.kind === 'array') base = 'array';
    else base = 'mixed';
    return optional && base !== 'mixed' ? '?' + base : base;
  }
  function toPhp(value, opts) {
    opts = opts || {};
    opts.lang = 'php'; // 供 buildModel 做目标语言保留字规避
    var schema = opts.schema || inferValue(value);
    var model = buildModel(schema, opts.rootName || 'Root', opts);
    var out = ['<?php', ''];
    if (opts.namespace) { out.pop(); out.push('<?php'); out.push(''); out.push('namespace ' + opts.namespace + ';'); out.push(''); }
    model.types.forEach(function (ty) {
      var lines = ['class ' + ty.name, '{'];
      if (!ty.fields.length) lines.push('    // 无字段');
      ty.fields.forEach(function (f) {
        var opt = opts.optionalMode === 'all' || (opts.optionalMode !== 'none' && f.optional);
        var def = (opt || f.type.name === 'null') ? ' = null' : '';
        lines.push('    public ' + phpType(f.type, opt) + ' $' + toSnake(f.name) + def + ';');
      });
      lines.push('}');
      out.push(lines.join('\n'));
    });
    if (model.rootRef.kind !== 'ref') out.push('// 根结构为 ' + phpType(model.rootRef, false));
    return out.join('\n\n');
  }

  /* ============================ DDL ============================ */
  function ddlType(f, dialect) {
    var t = f.type;
    var isMySQL = dialect === 'mysql', isPG = dialect === 'postgresql';
    function num() {
      if (t.kind === 'prim' && t.name === 'integer') return isMySQL ? 'INT' : (isPG ? 'INTEGER' : 'INTEGER');
      if (t.kind === 'prim' && t.name === 'number') return isMySQL ? 'DOUBLE' : (isPG ? 'DOUBLE PRECISION' : 'REAL');
      return isMySQL ? 'VARCHAR(255)' : 'VARCHAR(255)';
    }
    if (t.kind === 'prim') {
      if (t.name === 'integer' || t.name === 'number') return num();
      if (t.name === 'boolean') return isMySQL ? 'TINYINT(1)' : (isPG ? 'BOOLEAN' : 'INTEGER');
      if (t.name === 'string') {
        if (f.format === 'date-time') return isMySQL ? 'DATETIME' : (isPG ? 'TIMESTAMP' : 'TEXT');
        if (f.format === 'date') return isMySQL ? 'DATE' : (isPG ? 'DATE' : 'TEXT');
        return isMySQL ? 'VARCHAR(255)' : 'VARCHAR(255)';
      }
      return 'TEXT';
    }
    if (t.kind === 'ref') return isMySQL ? 'JSON' : (isPG ? 'JSONB' : 'TEXT');
    if (t.kind === 'array') return isMySQL ? 'JSON' : (isPG ? 'JSONB' : 'TEXT');
    return 'TEXT';
  }
  function toDDL(value, opts) {
    opts = opts || {};
    opts.lang = 'sql'; // 供 buildModel 做 SQL 保留字规避（列名已加引号，此处额外规避常见关键字）
    var dialect = (opts.dialect || 'mysql').toLowerCase();
    var table = opts.tableName || 'my_table';
    var pk = opts.primaryKey ? String(opts.primaryKey).trim() : '';
    var schema = opts.schema || inferValue(value);
    var model = buildModel(schema, opts.rootName || 'Root', opts);
    var rootType = null;
    model.types.forEach(function (ty) { if (ty.name === model.rootName) rootType = ty; });
    if (!rootType && model.types.length) rootType = model.types[0];
    if (!rootType) return '-- 输入不是对象，无法生成建表语句。';
    var quote = dialect === 'mysql' ? '`' : '"';
    var lines = [];
    if (dialect === 'mysql') lines.push('-- MySQL 建表语句（类型由 JSON 推断，仅供参考）');
    else if (dialect === 'postgresql') lines.push('-- PostgreSQL 建表语句（类型由 JSON 推断，仅供参考）');
    else lines.push('-- SQLite 建表语句（类型由 JSON 推断，仅供参考）');
    lines.push('CREATE TABLE ' + quote + table + quote + ' (');
    var cols = [];
    rootType.fields.forEach(function (f) {
      var colName = toSnake(f.name);
      var sqlType = ddlType(f, dialect);
      var part = '  ' + quote + colName + quote + ' ' + sqlType;
      if (f.jsonKey === pk || f.name === pk) part += ' PRIMARY KEY';
      else if (!f.optional && !f.nullable) part += ' NOT NULL';
      if (opts.withComments !== false) part += '  -- ' + f.jsonKey + ' : ' + (f.type.kind === 'prim' ? f.type.name : f.type.kind);
      cols.push(part);
    });
    if (!cols.length) cols.push('  ' + quote + 'id' + quote + ' INTEGER PRIMARY KEY');
    lines.push(cols.join(',\n'));
    lines.push(');');
    if (model.types.length > 1) {
      lines.push('');
      lines.push('-- 检测到 ' + (model.types.length - 1) + ' 个嵌套对象类型，已折叠为 JSON 列；如需拆表请手动调整：');
      model.types.forEach(function (ty) { if (ty.name !== rootType.name) lines.push('--   ' + ty.name); });
    }
    return lines.join('\n');
  }

  /* ============================ JSON Schema ============================ */
  function schemaNode(node) {
    if (!node) return {};
    if (node.type === 'array') {
      return { type: 'array', items: schemaNode(node.item || { type: 'any' }) };
    }
    if (node.type === 'object') {
      var props = {};
      var required = [];
      Object.keys(node.props || {}).forEach(function (k) {
        props[k] = schemaNode(node.props[k]);
        if (node.required && node.required[k]) required.push(k);
      });
      var o = { type: 'object', properties: props, additionalProperties: true };
      if (required.length) o.required = required;
      return o;
    }
    if (node.type === 'mixed') return {};
    if (node.type === 'null') return { type: 'null' };
    var s = { type: node.type };
    if (node.type === 'string' && node.format) s.format = node.format;
    return s;
  }
  function toJsonSchema(value, opts) {
    opts = opts || {};
    var schema = opts.schema || inferValue(value);
    var root = schemaNode(schema);
    var out = { '$schema': 'https://json-schema.org/draft/2020-12/schema' };
    if (opts.id) out.$id = opts.id;
    out.title = opts.title || opts.rootName || 'Root';
    if (opts.description) out.description = opts.description;
    Object.keys(root).forEach(function (k) { out[k] = root[k]; });
    return JSON.stringify(out, null, 2);
  }

  /* ============================ Mock ============================ */
  function makeRandom(seed) {
    if (seed === undefined || seed === null || seed === '') return Math.random;
    var s = 0;
    var str = String(seed);
    for (var i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  var MOCK_WORDS = ['alpha', 'bravo', 'delta', 'echo', 'flame', 'green', 'harbor', 'ivory', 'jungle', 'kite', 'lemon', 'maple', 'noble', 'ocean', 'pearl', 'quartz'];
  function mockString(rand, min, max, format) {
    switch (format) {
      case 'date-time': return new Date(Date.now() - Math.floor(rand() * 1e10)).toISOString();
      case 'date': return new Date(Date.now() - Math.floor(rand() * 1e10)).toISOString().slice(0, 10);
      case 'time': return ('0' + Math.floor(rand() * 24)).slice(-2) + ':' + ('0' + Math.floor(rand() * 60)).slice(-2) + ':' + ('0' + Math.floor(rand() * 60)).slice(-2);
      case 'email': return MOCK_WORDS[Math.floor(rand() * MOCK_WORDS.length)] + Math.floor(rand() * 99) + '@example.com';
      case 'uuid': return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.floor(rand() * 16); var v = c === 'x' ? r : ((r & 0x3) | 0x8); return v.toString(16); });
      case 'uri': return 'https://example.com/' + MOCK_WORDS[Math.floor(rand() * MOCK_WORDS.length)];
      case 'objectid': return 'abcdef0123456789abcdef01'.split('').map(function () { return Math.floor(rand() * 16).toString(16); }).join('').slice(0, 24);
      default: break;
    }
    var len = Math.max(min, Math.floor(min + rand() * (max - min + 1)));
    var s = '';
    while (s.length < len) s += MOCK_WORDS[Math.floor(rand() * MOCK_WORDS.length)];
    return s.slice(0, len);
  }
  function mockFromSchema(node, rand, opts) {
    if (!node) return null;
    switch (node.type) {
      case 'object': {
        var o = {};
        Object.keys(node.props || {}).forEach(function (k) { o[k] = mockFromSchema(node.props[k], rand, opts); });
        return o;
      }
      case 'array': {
        var arr = [];
        var n = Math.max(0, opts.arrayCount || 3);
        for (var i = 0; i < n; i++) arr.push(mockFromSchema(node.item || { type: 'any' }, rand, opts));
        return arr;
      }
      case 'string': return mockString(rand, opts.stringMin || 4, opts.stringMax || 12, node.format);
      case 'integer': return Math.floor(rand() * 1000);
      case 'number': return Math.round(rand() * 100000) / 100;
      case 'boolean': return rand() > 0.5;
      case 'null': return null;
      default: return null;
    }
  }
  /** 依据 JSON 结构生成 Mock 数据。opts:{count, stringMin, stringMax, arrayCount, seed} */
  function toMock(value, opts) {
    opts = opts || {};
    var rand = makeRandom(opts.seed);
    var schema = inferValue(value);
    var count = Math.max(1, opts.count || (Array.isArray(value) ? value.length : 1));
    if (Array.isArray(value)) {
      var arr = [];
      for (var i = 0; i < count; i++) arr.push(mockFromSchema({ type: 'array', item: schema.item }, rand, opts)[0]);
      return JSON.stringify(arr, null, 2);
    }
    return JSON.stringify(mockFromSchema(schema, rand, opts), null, 2);
  }

  /* ============================ 导出 ============================ */

  NS.codegen = {
    splitWords: splitWords,
    toPascal: toPascal,
    toCamel: toCamel,
    toSnake: toSnake,
    styleName: styleName,
    reservedWords: RESERVED,
    detectFormat: detectFormat,
    inferValue: inferValue,
    mergeSchemas: mergeSchemas,
    inferSchema: inferValue,
    buildModel: buildModel,
    toTypeScript: toTypeScript,
    toJava: toJava,
    toKotlin: toKotlin,
    toGo: toGo,
    toPython: toPython,
    toCSharp: toCSharp,
    toRust: toRust,
    toSwift: toSwift,
    toDart: toDart,
    toPhp: toPhp,
    toDDL: toDDL,
    toJsonSchema: toJsonSchema,
    toMock: toMock
  };
})(typeof window !== 'undefined' ? window : globalThis);
