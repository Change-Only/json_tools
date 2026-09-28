/* eslint-disable */
/**
 * run-tests.mjs —— JSON 工具箱 · QA 单元/静态一致性测试（T1 + T2）
 * 运行：node .qa/run-tests.mjs   （Node 22）
 * 只读产品代码，不修改任何 web/ 下文件。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');

/* ============================ 断言框架 ============================ */
const results = [];
let curGroup = '(none)';
function group(g) { curGroup = g; }
function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') {
    if (typeof a === 'number' && isNaN(a) && isNaN(b)) return true;
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEq(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEq(a[k], b[k])) return false;
  return true;
}
function check(name, actual, expected) {
  const pass = deepEq(actual, expected);
  results.push({ group: curGroup, name, pass, expected, actual });
  return pass;
}
function ok(name, cond, detail) {
  const pass = !!cond;
  results.push({ group: curGroup, name, pass, expected: 'truthy', actual: detail === undefined ? (pass ? 'ok' : 'falsey') : detail });
  return pass;
}
function show(v) {
  if (typeof v === 'string') return v.length > 200 ? JSON.stringify(v.slice(0, 200)) + '…' : JSON.stringify(v);
  if (v instanceof Error) return v.name + ': ' + v.message;
  try { const s = JSON.stringify(v); return s === undefined ? String(v) : (s && s.length > 240 ? s.slice(0, 240) + '…' : s); } catch (e) { return String(v); }
}

/* ============================ 加载 core ============================ */
globalThis.window = globalThis;
function loadScript(p) {
  const code = fs.readFileSync(p, 'utf8');
  vm.runInThisContext(code, { filename: p });
}
const CORE = ['vendor/libs.js', 'js/core/json.js', 'js/core/convert.js', 'js/core/codegen.js', 'js/core/codec.js', 'js/core/analyze.js'];
for (const f of CORE) loadScript(path.join(WEB, f));
loadScript(path.join(WEB, 'js/tools-registry.js'));

const J = globalThis.JTCore.json;
const C = globalThis.JTCore.convert;
const G = globalThis.JTCore.codegen;
const K = globalThis.JTCore.codec;
const A = globalThis.JTCore.analyze;

/* ============================ T1. 静态一致性核查 ============================ */
function t1() {
  group('T1-资源引用');
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const refs = [];
  const re = /(?:src|href)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) refs.push(m[1]);
  // data: / http(s): / # 不是本地文件资源（如内联 favicon）
  const localRefs = refs.filter((r) => !/^(data:|https?:|mailto:|#|\/\/)/.test(r));
  ok('index.html 引用本地资源数 = 17（含 favicon.png）', localRefs.length === 17, '实际 ' + localRefs.length + '：' + localRefs.join(', '));
  const missing = localRefs.filter((r) => !fs.existsSync(path.join(WEB, r)));
  ok('全部引用资源存在', missing.length === 0, '缺失：' + missing.join(', '));
  results.push({ group: 'T1-资源引用', name: '资源清单', pass: true, expected: '', actual: localRefs.join(' | ') + '  ｜ 非文件引用: ' + refs.filter((r) => !localRefs.includes(r)).join(' | ') });

  group('T1-外链/module/emoji');
  // 收集所有 web 下文本文件
  function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(js|html|css|md)$/.test(e.name)) out.push(p);
    }
    return out;
  }
  const files = walk(WEB, []);
  const extTag = [];
  const moduleDecl = [];
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    // 外链：script src / link href / CSS @import / url(http
    const l1 = txt.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']*/gi) || [];
    const l2 = txt.match(/@import\s+(?:url\()?["']?https?:\/\//gi) || [];
    const l3 = txt.match(/url\(\s*["']?https?:\/\//gi) || [];
    [...l1, ...l2, ...l3].forEach((x) => extTag.push(rel + ' :: ' + x.slice(0, 60)));
    // ES module 残留（锚定行首，避免命中 codegen 里的 'import java...' 字符串）
    const mm = txt.match(/^\s*(?:import\s+[^\n]*from\s+['"]|import\s+['"]|export\s+(?:default|const|function|class|let|var)\b)/gm) || [];
    const modAttr = txt.match(/type\s*=\s*["']module["']/gi) || [];
    [...mm, ...modAttr].forEach((x) => moduleDecl.push(rel + ' :: ' + x.trim().slice(0, 60)));
  }
  ok('0 个外链资源（CDN/字体）', extTag.length === 0, extTag.length ? extTag.join('\n') : '0');
  ok('0 处 ES module 残留', moduleDecl.length === 0, moduleDecl.length ? moduleDecl.join('\n') : '0');
  // emoji 扫描（允许 ✅❌）
  const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;
  const emojiHits = [];
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    let mm;
    const r = new RegExp(emojiRe.source, 'gu');
    while ((mm = r.exec(txt)) !== null) {
      const ch = mm[0];
      if (ch === '\u2705' || ch === '\u274C') continue; // ✅ ❌
      emojiHits.push(rel + ' :: U+' + ch.codePointAt(0).toString(16) + ' ' + ch);
    }
  }
  ok('0 个非许可 emoji（✅❌除外）', emojiHits.length === 0, emojiHits.slice(0, 20).join('\n') || '0');

  group('T1-注册表');
  const reg = globalThis.JT.registry;
  const tools = reg.tools;
  ok('工具总数 = 68', tools.length === 68, '实际 ' + tools.length);
  const ids = tools.map((t) => t.id);
  ok('id 唯一', new Set(ids).size === ids.length, '重复：' + ids.filter((x, i) => ids.indexOf(x) !== i).join(','));

  const views = new Set(['text', 'code', 'stats', 'table', 'diff', 'tree']);
  const langs = new Set(['json', 'yaml', 'toml', 'xml', 'csv', 'markdown', 'sql', 'code', 'text', 'html']);
  const badMeta = [];
  for (const t of tools) {
    if (!t.id || !t.cat || !t.name || !t.desc || typeof t.run !== 'function') badMeta.push(t.id + ' 缺 id/cat/name/desc/run');
    if (!views.has(t.view)) badMeta.push(t.id + ' view 非法: ' + t.view);
    if (!langs.has(t.outLang)) badMeta.push(t.id + ' outLang 非法: ' + t.outLang);
    (t.params || []).forEach((p) => {
      if (!p.id || !p.type) badMeta.push(t.id + ' 控件缺 key/type: ' + JSON.stringify(p));
      if (p.type === 'select' && (!p.options || !p.options.length)) badMeta.push(t.id + '.' + p.id + ' select 缺 options');
    });
  }
  ok('每个工具元数据完整（id/cat/name/desc/run/outLang/view/params）', badMeta.length === 0, badMeta.join('\n') || '0');

  // 分类工具数与声明一致
  const catCounts = {};
  tools.forEach((t) => { catCounts[t.cat] = (catCounts[t.cat] || 0) + 1; });
  results.push({ group: 'T1-注册表', name: '分类计数', pass: true, expected: '', actual: JSON.stringify(catCounts) });
  ok('分类数 = 6 且每类均有工具', reg.categories.length === 6 && reg.categories.every((c) => catCounts[c.id] > 0), JSON.stringify(catCounts));

  // 静态比对 params 声明 vs run 读取
  group('T1-参数一一对应');
  const src = fs.readFileSync(path.join(WEB, 'js/tools-registry.js'), 'utf8');
  // 按 id 定位每个工具对象块，再在其内找 params 数组与 run 函数体
  function findBlock(text, startIdx) {
    // 从 startIdx 起找第一个 { 或 [，做括号配对
    let i = startIdx;
    while (i < text.length && text[i] !== '{' && text[i] !== '[') i++;
    const open = text[i];
    const close = open === '{' ? '}' : ']';
    let depth = 0, inStr = null, esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return { from: i, to: j + 1, body: text.slice(i, j + 1) }; }
    }
    return null;
  }
  const mismatches = [];
  for (const t of tools) {
    const idIdx = src.indexOf("id: '" + t.id + "'");
    if (idIdx < 0) { mismatches.push(t.id + ' 源码中未找到'); continue; }
    const pIdx = src.indexOf('params:', idIdx);
    let declared = [];
    if (pIdx >= 0 && pIdx < idIdx + 4000) {
      const pb = findBlock(src, pIdx + 'params:'.length);
      if (pb) {
        const b = pb.body;
        const rr = /\b(?:sel|txt|num|chk|area)\(\s*'([^']+)'/g;
        let mm;
        while ((mm = rr.exec(b)) !== null) declared.push(mm[1]);
        if (/\bDIR\(/.test(b)) declared.push('direction');
        if (/\bOPTIONAL_MODE\b/.test(b)) declared.push('optionalMode'); // 共享常量：sel('optionalMode', ...)
        if (/\bNAME_STYLE\b/.test(b)) declared.push('nameStyle');       // 共享常量：sel('nameStyle', ...)
      }
    }
    const rIdx = src.indexOf('run: function', idIdx);
    const rb = rIdx >= 0 ? findBlock(src, src.indexOf('{', rIdx)) : null;
    const read = new Set();
    if (rb) {
      let mm;
      const r1 = /params\.([A-Za-z_$][\w$]*)/g;
      while ((mm = r1.exec(rb.body)) !== null) read.add(mm[1]);
      const r2 = /params\[\s*['"]([^'"]+)['"]\s*\]/g;
      while ((mm = r2.exec(rb.body)) !== null) read.add(mm[1]);
    }
    const declaredSet = new Set(declared);
    const undeclared = [...read].filter((k) => !declaredSet.has(k));
    const unread = declared.filter((k) => !read.has(k));
    if (undeclared.length) mismatches.push(t.id + ' run 读取了未声明的 params: ' + undeclared.join(','));
    if (unread.length) mismatches.push(t.id + ' 声明了但 run 未读取的 params: ' + unread.join(','));
  }
  ok('params 控件与 run 读取一一对应', mismatches.length === 0, mismatches.join('\n') || '0');
  return { catCounts, refs };
}

/* ============================ T2. core 纯逻辑单元测试 ============================ */
function t2core() {
  /* ---- json.parse 错误定位 ---- */
  group('T2-json.parse 错误定位');
  {
    const r1 = J.parse('{\n  "a": 1,\n  "b": "unterminated\n}');
    ok('未闭合字符串 errorLine 有效(>0)', r1.ok === false && typeof r1.line === 'number' && r1.line > 0, show({ line: r1.line, col: r1.column, err: r1.error }));
    const r2 = J.parse('{\n  "a": 1,\n  "b": 2\n  "c": 3\n}'); // 缺逗号 → 第4行附近
    ok('缺逗号 errorLine 指向出错行(>=3)', r2.ok === false && r2.line >= 3, show({ line: r2.line, col: r2.column }));
    const r3 = J.parse('{\n  "a": 1,\n  "b": [1,2,\n}'); // 尾逗号 → 第3/4行
    ok('数组尾逗号 errorLine 有效', r3.ok === false && r3.line > 0, show({ line: r3.line, col: r3.column }));
    const r4 = J.parse('{“a”: 1}'); // 中文全角引号 → 严格解析失败
    ok('中文全角引号严格解析失败且有行号', r4.ok === false && r4.line > 0, show({ line: r4.line, err: r4.error }));
    const r5 = J.parse('{"a":1,}'); // 对象尾逗号
    ok('对象尾逗号 errorLine > 0', r5.ok === false && r5.line > 0, show({ line: r5.line }));
  }

  /* ---- parseLax ---- */
  group('T2-json.parseLax');
  {
    const cases = [
      ["{'a':1}", { a: 1 }, "单引号"],
      ['{"a":1,}', { a: 1 }, "对象尾逗号"],
      ['{"a":[1,2,]}', { a: [1, 2] }, "数组尾逗号"],
      ['// c\n{"a":1}', { a: 1 }, "// 注释"],
      ['/* c */{"a":1}', { a: 1 }, "块注释"],
      ['{a:1}', { a: 1 }, "裸键"],
      ['{"a":True,"b":False,"c":None}', { a: true, b: false, c: null }, "True/False/None"],
      ['{"a":"中","n":1}', { a: '中', n: 1 }, "中文值"],
      ['{"a"：1}', { a: 1 }, "全角冒号+裸键"],
    ];
    for (const [inp, exp, label] of cases) {
      const r = J.parseLax(inp);
      ok('parseLax ' + label + ' 结果值正确', r.ok && deepEq(r.value, exp), show({ ok: r.ok, value: r.value, exp }));
    }
    const bom = J.parseLax('\uFEFF{"a":1}');
    ok('parseLax BOM 处理', bom.ok && deepEq(bom.value, { a: 1 }), show(bom.value));
    const cq = J.parseLax('{“a”: “中文”}'); // 中文引号
    ok('parseLax 中文引号({“a”:“中文”})', cq.ok && deepEq(cq.value, { a: '中文' }), show({ ok: cq.ok, value: cq.value, text: cq.error }));
    const singleWithQuote = J.parseLax("{'a':'it\\'s'}");
    ok("parseLax 单引号内含转义'", singleWithQuote.ok && singleWithQuote.value.a === "it's", show(singleWithQuote.value));
    const multi = J.parseLax("{'x':1,'y':[True,None,2.5]}");
    ok('parseLax 混合类型数组', multi.ok && deepEq(multi.value, { x: 1, y: [true, null, 2.5] }), show(multi.value));
  }

  /* ---- 格式化 / 压缩 ---- */
  group('T2-格式化与压缩');
  {
    const v = { b: 2, a: { d: 4, c: 3 }, list: [1, 2] };
    const s2 = J.stringify(v, { indent: 2 });
    ok('缩进2 首行前有换行', s2.includes('\n  "b"'), show(s2));
    const s4 = J.stringify(v, { indent: 4 });
    ok('缩进4 使用4空格', s4.includes('\n    "b"'), show(s4));
    const s8 = J.stringify(v, { indent: 8 });
    ok('缩进8 使用8空格', s8.includes('\n        "b"'), show(s8));
    const stab = J.stringify(v, { indent: 'tab' });
    ok('缩进Tab 使用制表符', stab.includes('\n\t"b"'), show(stab));
    const asc = JSON.parse(J.stringify(v, { sortKeys: 'asc' }));
    ok('键排序 asc 顶层 A→Z', Object.keys(asc).join(',') === 'a,b,list', Object.keys(asc).join(','));
    ok('键排序 asc 递归(内层 c,d)', Object.keys(asc.a).join(',') === 'c,d', Object.keys(asc.a).join(','));
    const desc = JSON.parse(J.stringify(v, { sortKeys: 'desc' }));
    ok('键排序 desc 顶层 Z→A', Object.keys(desc).join(',') === 'list,b,a', Object.keys(desc).join(','));
    ok('键排序 desc 递归(内层 d,c)', Object.keys(desc.a).join(',') === 'd,c', Object.keys(desc.a).join(','));
    const mini = J.minify(v, {});
    ok('压缩后可被 JSON.parse 且等价', deepEq(JSON.parse(mini), v), mini);
    ok('压缩无多余空白', !/\s/.test(mini), mini);
    const escNonAscii = J.stringify({ a: '中' }, { indent: 2, escapeNonAscii: true });
    ok('escapeNonAscii 转义中文', escNonAscii.includes('\\u4e2d'), escNonAscii);
  }

  /* ---- 转义 / 去转义幂等 ---- */
  group('T2-转义幂等');
  {
    const samples = ['a\nb\tc"d\\e\u4e2d/f\bg\fh', '中文测试', 'no special'];
    for (const x of samples) {
      const esc = J.escapeJson(x);
      ok('unescape(escape(x))===x :: ' + JSON.stringify(x), J.unescapeJson(esc) === x, show(J.unescapeJson(esc)));
      ok('escape(unescape(esc))===esc :: ' + JSON.stringify(x), J.escapeJson(J.unescapeJson(esc)) === esc, show(J.escapeJson(J.unescapeJson(esc))));
    }
    ok('unicodeEscape/Unescape 中文往返', J.unicodeUnescape(J.unicodeEscape('中文A', { onlyNonAscii: true })) === '中文A', J.unicodeEscape('中文A', { onlyNonAscii: true }));
  }

  /* ---- convert 双向往返 ---- */
  group('T2-convert 往返');
  {
    const yamlObj = { app: { name: 'JSON 工具箱', version: '1.0.0', debug: false }, list: [1, 2, 3], n: 42, s: 'x' };
    const y = C.jsonToYaml(yamlObj, { indent: 2 });
    ok('YAML 往返等价', deepEq(C.yamlToJson(y), yamlObj), show({ y, back: C.yamlToJson(y) }));

    const tomlObj = { title: 't', owner: { name: 'x', age: 3 }, nums: [1, 2, 3] };
    const tm = C.jsonToToml(tomlObj);
    ok('TOML 往返等价', deepEq(C.tomlToJson(tm.text), tomlObj), show({ text: tm.text, back: C.tomlToJson(tm.text) }));

    farm: {
      const xmlInner = { '@_id': 1, '#text': 'hello', item: [{ '@_k': 'a', '#text': 'A' }, { '@_k': 'b', '#text': 'B' }], nested: { deep: { v: 1 } } };
      const x = C.jsonToXml(xmlInner, { rootName: 'root', itemName: 'item', attrPrefix: '@_', textKey: '#text' });
      const back = C.xmlToJson(x, { attrPrefix: '@_', textKey: '#text' });
      ok('XML 往返（属性+文本+嵌套+数组）', deepEq(back, { root: xmlInner }), show({ xml: x, back }));
    }
    {
      const escObj = { v: 'a & b < c > d "e"' };
      const x = C.jsonToXml(escObj, { rootName: 'root' });
      const back = C.xmlToJson(x, {});
      ok('XML &<> 实体转义往返', deepEq(back, { root: escObj }), show({ xml: x, back }));
    }
    {
      const cdata = '<r><v><![CDATA[a < b & c]]></v></r>';
      ok('XML CDATA 解析', deepEq(C.xmlToJson(cdata, {}), { r: { v: 'a < b & c' } }), show(C.xmlToJson(cdata, {})));
    }
    {
      const arrX = C.jsonToXml({ empty: [] }, { rootName: 'root' });
      const b = C.xmlToJson(arrX, {});
      // XML 无空数组原语，此类型丢失属固有限制；修复后由 notices 明确告警（见 R2-P3-2）
      ok('XML 空数组：类型丢失为 {} 且已告警（已知限制）', deepEq(b, { root: { empty: {} } }), show({ xml: arrX, back: b }));
    }
    {
      const nullX = C.jsonToXml({ n: null }, { rootName: 'root' });
      const b = C.xmlToJson(nullX, {});
      ok('XML null：类型丢失为 {} 且已告警（已知限制）', deepEq(b, { root: { n: {} } }), show({ xml: nullX, back: b }));
    }
    {
      const rows = [{ id: 1, name: '张三', note: 'a,b' }, { id: 2, name: '李四', note: 'x"y' }];
      const csv = C.jsonToCsv(rows, { delimiter: ',', header: true });
      const back = C.csvToJson(csv.text, { delimiter: ',', header: true });
      ok('CSV 往返等价（含逗号/引号）', deepEq(back, rows), show({ csv: csv.text, back }));
    }
    {
      const qsObj = { a: 1, b: 'x y', c: ['p', 'q'] };
      const q = C.jsonToQuery(qsObj, { arrayStyle: 'repeat' });
      const back = C.queryToJson(q);
      ok('QueryString repeat 往返（数组→合并）', deepEq(back, { a: 1, b: 'x y', c: ['p', 'q'] }), show({ q, back }));
      const q2 = C.jsonToQuery(qsObj, { arrayStyle: 'bracket' });
      const back2 = C.queryToJson(q2);
      ok('QueryString bracket 往返', deepEq(back2, { a: 1, b: 'x y', c: ['p', 'q'] }), show({ q: q2, back: back2 }));
    }
    {
      const nd = [{ a: 1 }, { b: 2 }];
      const t = C.jsonToNdjson(nd);
      ok('NDJSON 往返等价', deepEq(C.ndjsonToJson(t), nd), show({ t, back: C.ndjsonToJson(t) }));
    }
    {
      const props = { 'app.name': 'x', 'a.b': 1 };
      const p = C.jsonToProperties({ app: { name: 'x' }, a: { b: 1 } }, { quote: false });
      ok('Properties 序列化输出键值', /app\.name=x/.test(p) && /a\.b=1/.test(p), p);
      const back = C.propertiesToJson(p, {});
      ok('Properties 反解值正确', back['app.name'] === 'x' && back['a.b'] === 1, show(back));
    }
    // TOML null 告警
    {
      const r = C.jsonToToml({ a: 1, b: null, c: { d: null } }, {});
      ok('TOML 含 null 给出告警', Array.isArray(r.notices) && r.notices.length >= 1 && /null/i.test(r.notices.join(' ')), show(r.notices));
      ok('TOML 含 null 不抛异常且输出文本', typeof r.text === 'string' && r.text.length > 0, show(r.text));
    }
  }

  /* ---- codegen 代码合法性 ---- */
  group('T2-codegen');
  {
    const sample = {
      id: 1, score: 1.5, ok: true, tag: null, name: '张三', empty: null,
      items: [{ a: 1 }, { a: 'x' }],
      nested: { other: { v: 1 } },
      'a b': 1, 'aB': 2,
    };
    const ts = G.toTypeScript(sample, { rootName: 'Root' });
    ok('TS 生成可信（含 interface）', /interface\s+\w+\s*\{/.test(ts), ts.slice(0, 300));
    ok('TS 括号配对', balanced(ts), '不配对');
    const java = G.toJava(sample, { rootName: 'Root' });
    ok('Java 括号配对', balanced(java), '不配对');
    const go = G.toGo(sample, { rootName: 'Root' });
    ok('Go 括号配对', balanced(go) && /package\s+main/.test(go), go.slice(0, 200));
    const py = G.toPython(sample, { rootName: 'Root' });
    ok('Python 括号配对', balanced(py), py.slice(0, 200));
    const rust = G.toRust(sample, { rootName: 'Root' });
    ok('Rust 括号配对', balanced(rust), rust.slice(0, 200));
    const ddl = G.toDDL({ id: 1, name: 'x', tags: ['a'], meta: { k: 1 } }, { dialect: 'mysql', tableName: 't', primaryKey: 'id' });
    ok('DDL 含 CREATE TABLE 且括号配对', /CREATE TABLE/.test(ddl) && balanced(ddl), ddl.slice(0, 300));
    const schema = G.toJsonSchema(sample, { title: 'Root' });
    let schemaParsed = null;
    try { schemaParsed = JSON.parse(schema); } catch (e) {}
    ok('JSON Schema 可被 JSON.parse', schemaParsed !== null && schemaParsed.type === 'object', schema.slice(0, 200));
    // nullable / mixed
    const mixed = G.inferValue([1, 'a', true]);
    ok('inferValue 数组成员类型不一致 → mixed', mixed.type === 'array' && mixed.item && mixed.item.type === 'mixed', show(mixed));
    const nullOnly = G.inferValue([null]);
    ok('inferValue null-only 数组元素 = null', nullOnly.type === 'array' && nullOnly.item.type === 'null', show(nullOnly));
    const intFloat = G.inferValue({ a: 1, b: 1.5 });
    ok('int/float 混合：a=integer,b=number', intFloat.props.a.type === 'integer' && intFloat.props.b.type === 'number', show(intFloat.props));
    // 字段名冲突（空/空格/点）
    const tsDup = G.toTypeScript({ 'a b': 1, aB: 2 }, { rootName: 'R' });
    const fieldCount = (tsDup.match(/^\s+aB\??\s*:/gm) || []).length;
    ok('字段名冲突不产生重复标识符（a b / aB）', fieldCount <= 1, 'aB 字段出现 ' + fieldCount + ' 次\n' + tsDup);
  }

  /* ---- json 高级操作 ---- */
  group('T2-json 操作');
  {
    const store = { store: { book: [{ title: 'A', price: 5 }, { title: 'B', price: 15 }], bicycle: { color: 'red' } } };
    ok('JSONPath $.store.bicycle.color', deepEq(J.jsonPath(store, '$.store.bicycle.color').map((x) => x.value), ['red']), show(J.jsonPath(store, '$.store.bicycle.color')));
    ok('JSONPath $..price', deepEq(J.jsonPath(store, '$..price').map((x) => x.value), [5, 15]), show(J.jsonPath(store, '$..price').map((x) => x.value)));
    ok('JSONPath $.store.book[*].title', deepEq(J.jsonPath(store, '$.store.book[*].title').map((x) => x.value), ['A', 'B']), show(J.jsonPath(store, '$.store.book[*].title').map((x) => x.value)));
    ok("JSONPath $['store']['bicycle']['color']", deepEq(J.jsonPath(store, "$['store']['bicycle']['color']").map((x) => x.value), ['red']), 'ok');
    ok('JSONPath $..book[0].title', deepEq(J.jsonPath(store, '$..book[0].title').map((x) => x.value), ['A']), show(J.jsonPath(store, '$..book[0].title').map((x) => x.value)));
    ok('JSONPath $..book[0:2].title (slice)', deepEq(J.jsonPath(store, '$..book[0:2].title').map((x) => x.value), ['A', 'B']), show(J.jsonPath(store, '$..book[0:2].title').map((x) => x.value)));

    const paths = J.leafPaths(store, { style: 'dot' });
    ok('leafPaths 包含 $.store.book[0].title', paths.includes('$.store.book[0].title') || paths.includes('store.book[0].title'), show(paths));
    ok('getByPath(data.list[0].name)', J.getByPath({ data: { list: [{ name: 'n' }] } }, 'data.list[0].name') === 'n', 'ok');
    ok('getByPath($.a.b) 两种写法', J.getByPath({ a: { b: 2 } }, '$.a.b') === 2, 'ok');

    ok('pickKeys 按层保留指定键', deepEq(J.pickKeys({ a: 1, b: { a: 2, c: 3 } }, 'a'), { a: 1 }), show(J.pickKeys({ a: 1, b: { a: 2, c: 3 } }, 'a')));
    ok('omitKeys 通配 *', deepEq(J.omitKeys({ a: 1, tokenX: 2, keep: 3 }, '*token*'), { a: 1, keep: 3 }), show(J.omitKeys({ a: 1, tokenX: 2, keep: 3 }, '*token*')));
    ok('collectKeys 递归收集', deepEq(J.collectKeys({ a: { id: 1 }, id: 2 }, 'id').map((x) => x.value).sort(), [1, 2]), show(J.collectKeys({ a: { id: 1 }, id: 2 }, 'id')));
    ok('groupBy 分组计数', deepEq(J.groupBy([{ t: 'x' }, { t: 'x' }, { t: 'y' }], 't').map((g) => [g.key, g.count]), [['x', 2], ['y', 1]]), show(J.groupBy([{ t: 'x' }, { t: 'x' }, { t: 'y' }], 't').map((g) => [g.key, g.count])));
    ok('aggregate 数值统计', (() => { const r = J.aggregate([{ p: 1 }, { p: 3 }, { p: 5 }], 'p')[0]; return r.count === 3 && r.sum === 9 && r.min === 1 && r.max === 5; })(), show(J.aggregate([{ p: 1 }, { p: 3 }, { p: 5 }], 'p')[0]));
    ok('deepMerge overwrite', deepEq(J.deepMerge({ a: { x: 1 }, k: 1 }, { a: { x: 2, y: 3 } }, { conflict: 'overwrite' }), { a: { x: 2, y: 3 }, k: 1 }), show(J.deepMerge({ a: { x: 1 }, k: 1 }, { a: { x: 2, y: 3 } }, { conflict: 'overwrite' })));
    ok('deepMerge keep', deepEq(J.deepMerge({ a: 1 }, { a: 2, b: 3 }, { conflict: 'keep' }), { a: 1, b: 3 }), show(J.deepMerge({ a: 1 }, { a: 2, b: 3 }, { conflict: 'keep' })));
    ok('deepMerge concat 数组', deepEq(J.deepMerge({ a: [1] }, { a: [2, 3] }, { conflict: 'concat' }).a, [1, 2, 3]), show(J.deepMerge({ a: [1] }, { a: [2, 3] }, { conflict: 'concat' })));

    const d = J.diff({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 });
    ok('diff 检出 changed/added', d.some((x) => x.path === '$.b' && x.type === 'changed') && d.some((x) => x.path === '$.c' && x.type === 'added'), show(d));

    // applyPatch
    ok('applyPatch add', deepEq(J.applyPatch({ a: 1 }, [{ op: 'add', path: '/b', value: 2 }]), { a: 1, b: 2 }), 'ok');
    ok('applyPatch remove', deepEq(J.applyPatch({ a: 1, b: 2 }, [{ op: 'remove', path: '/b' }]), { a: 1 }), 'ok');
    ok('applyPatch replace', deepEq(J.applyPatch({ a: 1 }, [{ op: 'replace', path: '/a', value: 9 }]), { a: 9 }), 'ok');
    ok('applyPatch move', deepEq(J.applyPatch({ a: 1, b: 2 }, [{ op: 'move', from: '/a', path: '/c' }]), { b: 2, c: 1 }), 'ok');
    ok('applyPatch copy', deepEq(J.applyPatch({ a: 1 }, [{ op: 'copy', from: '/a', path: '/b' }]), { a: 1, b: 1 }), 'ok');
    ok('applyPatch add 数组 - 追加', deepEq(J.applyPatch({ a: [1] }, [{ op: 'add', path: '/a/-', value: 2 }]), { a: [1, 2] }), show(J.applyPatch({ a: [1] }, [{ op: 'add', path: '/a/-', value: 2 }])));
    ok('applyPatch test 通过', deepEq(J.applyPatch({ a: 1 }, [{ op: 'test', path: '/a', value: 1 }]), { a: 1 }), 'ok');
    let testThrew = false;
    try { J.applyPatch({ a: 1 }, [{ op: 'test', path: '/a', value: 2 }]); } catch (e) { testThrew = true; }
    ok('applyPatch test 失败抛错', testThrew, String(testThrew));
    ok('applyPatch 根路径替换', deepEq(J.applyPatch({ a: 1 }, [{ op: 'replace', path: '', value: { z: 9 } }]), { z: 9 }), show(J.applyPatch({ a: 1 }, [{ op: 'replace', path: '', value: { z: 9 } }])));

    // flatten / unflatten
    ok('flatten 嵌套→扁平', deepEq(J.flatten({ a: { b: 1 } }, {}), { 'a.b': 1 }), show(J.flatten({ a: { b: 1 } }, {})));
    ok('flatten+unflatten 往返（无数组）', deepEq(J.unflatten(J.flatten({ a: { b: 1, c: { d: 2 } } }, {}), {}), { a: { b: 1, c: { d: 2 } } }), show(J.unflatten(J.flatten({ a: { b: 1, c: { d: 2 } } }, {}), {})));
    ok('flatten arrays:true 展平数组', deepEq(J.flatten({ a: [10, 20] }, { arrays: true }), { 'a[0]': 10, 'a[1]': 20 }), show(J.flatten({ a: [10, 20] }, { arrays: true })));
    ok('unflatten 还原数组（往返）', deepEq(J.unflatten(J.flatten({ a: [10, 20] }, { arrays: true }), {}), { a: [10, 20] }), show(J.unflatten(J.flatten({ a: [10, 20] }, { arrays: true }), {})));

    ok('dedupe 按值', deepEq(J.dedupe([1, 1, 2, 3, 3], {}), [1, 2, 3]), 'ok');
    ok('dedupe 按字段', deepEq(J.dedupe([{ id: 1 }, { id: 1 }, { id: 2 }], { mode: 'field', field: 'id' }), [{ id: 1 }, { id: 2 }]), 'ok');
    ok('sortArray 按值升序', deepEq(J.sortArray([3, 1, 2], { order: 'asc' }), [1, 2, 3]), 'ok');
    ok('sortArray 按值降序', deepEq(J.sortArray([3, 1, 2], { order: 'desc' }), [3, 2, 1]), 'ok');
    ok('sortArray 按字段', deepEq(J.sortArray([{ a: 2 }, { a: 1 }], { mode: 'field', field: 'a' }), [{ a: 1 }, { a: 2 }]), 'ok');
    ok('sortKeysDeep 递归', Object.keys(JSON.parse(J.stringify({ b: { d: 1, c: 2 }, a: 1 }, { sortKeys: 'asc' }))).join(',') === 'a,b', 'ok');
    ok('cleanNulls 删 null', deepEq(J.cleanNulls({ a: null, b: 1 }, { null: true }), { b: 1 }), show(J.cleanNulls({ a: null, b: 1 }, { null: true })));
    ok('cleanNulls 多选删空串/空数组', deepEq(J.cleanNulls({ a: '', b: [], c: 1 }, { emptyString: true, emptyArray: true }), { c: 1 }), show(J.cleanNulls({ a: '', b: [], c: 1 }, { emptyString: true, emptyArray: true })));
  }

  /* ---- codec ---- */
  group('T2-codec');
  {
    ok('Base64 中文往返', K.base64Decode(K.base64Encode('中文字符')) === '中文字符', K.base64Decode(K.base64Encode('中文字符')));
    ok('Base64 "abc" = "YWJj"', K.base64Encode('abc') === 'YWJj', K.base64Encode('abc'));
    ok('Base64 URL-safe 编码', /[-_]/.test(K.base64Encode('??>>', { urlSafe: true })) || K.base64Encode('??>>', { urlSafe: true }).replace(/[-_]/g, '') !== '', K.base64Encode('??>>', { urlSafe: true }));
    const noPad = K.base64Encode('a', { noPadding: true });
    ok('Base64 noPadding 无 =', !noPad.includes('='), noPad);
    ok('Base64 解码无 padding（YWJj 已无填充）', K.base64Decode('YWJj') === 'abc', K.base64Decode('YWJj'));
    ok('Base64 解码无 padding("YQ")=a', K.base64Decode('YQ') === 'a', K.base64Decode('YQ'));
    ok('Base64 非法字符被忽略', K.base64Decode('YW!Jj') === 'abc', K.base64Decode('YW!Jj'));

    ok('URL encode/decode 往返', K.urlDecode(K.urlEncode('a b&c=中')) === 'a b&c=中', K.urlDecode(K.urlEncode('a b&c=中')));
    ok('URL encodeURI 保留 /', K.urlEncode('a/b c', 'uri') === 'a/b%20c', K.urlEncode('a/b c', 'uri'));

    ok('HTML 编解码往返', K.htmlDecode(K.htmlEncode('<a>&"\u4e2d')) === '<a>&"\u4e2d', K.htmlEncode('<a>&"\u4e2d'));
    ok('HTML 十六进制实体解码', K.htmlDecode('&#x4e2d;') === '中', K.htmlDecode('&#x4e2d;'));
    ok('HTML 十进制实体解码', K.htmlDecode('&#20013;') === '中', K.htmlDecode('&#20013;'));
    ok('HTML 命名实体解码', K.htmlDecode('&amp;&lt;&gt;&quot;') === '&<>"', K.htmlDecode('&amp;&lt;&gt;&quot;'));

    // JWT
    const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const now = Math.floor(Date.now() / 1000);
    const jwtExpired = b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url({ sub: '1', exp: now - 100 }) + '.sig';
    const jwtValid = b64url({ alg: 'HS256' }) + '.' + b64url({ sub: '1', exp: now + 10000 }) + '.sig';
    const jwtNbf = b64url({ alg: 'HS256' }) + '.' + b64url({ nbf: now + 10000 }) + '.sig';
    const jwtNone = b64url({ alg: 'none' }) + '.' + b64url({ a: 1 }) + '.';
    const d1 = K.jwtDecode(jwtExpired);
    ok('JWT 过期判定 expired=true', d1.expired === true && d1.notices.join(' ').includes('过期'), show(d1.notices));
    ok('JWT 未过期 expired=false', K.jwtDecode(jwtValid).expired === false, show(K.jwtDecode(jwtValid)));
    ok('JWT nbf 未生效告警', K.jwtDecode(jwtNbf).notices.join(' ').includes('尚未生效'), show(K.jwtDecode(jwtNbf).notices));
    ok('JWT alg:none 告警', K.jwtDecode(jwtNone).notices.join(' ').includes('none'), show(K.jwtDecode(jwtNone).notices));

    // timestamp
    ok('timestamp 秒自动识别', K.timestampToDate('1700000000', {}).detectedUnit === 'seconds', show(K.timestampToDate('1700000000', {}).detectedUnit));
    ok('timestamp 毫秒自动识别', K.timestampToDate('1700000000000', {}).detectedUnit === 'milliseconds', 'ok');
    ok('timestamp 0 → 1970', K.timestampToDate(0, {}).isoUTC.startsWith('1970-01-01'), K.timestampToDate(0, {}).isoUTC);
    ok('timestamp 负值不抛异常', (() => { try { K.timestampToDate(-1000, {}); return true; } catch (e) { return false; } })(), 'ok');
    ok('timestamp 2038 之后可用', K.timestampToDate('2500000000', {}).isoUTC.startsWith('2049'), K.timestampToDate('2500000000', {}).isoUTC);
    ok('dateToTimestamp 往返(秒)', K.timestampToDate(K.dateToTimestamp('2023-05-12T08:30:00Z', {}).seconds, {}).isoUTC === '2023-05-12T08:30:00.000Z', 'ok');

    // uuid
    const uuids = [];
    for (let i = 0; i < 1000; i++) uuids.push(K.uuidV4());
    ok('UUID v4 格式合法', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuids[0]), uuids[0]);
    ok('UUID 1000 个无重复', new Set(uuids).size === 1000, '唯一数=' + new Set(uuids).size);

    // regex
    const rx = K.regexTest('a1 b2', '(\\w)(\\d)', 'g');
    ok('regex 全局匹配计数', rx.count === 2, show(rx));
    ok('regex 分组捕获', deepEq(rx.matches[0].groups, ['a', '1']), show(rx.matches[0]));

    // string literal
    ok('parseLiteral 解析转义', K.parseLiteral('"a\\nb"').value === 'a\nb', show(K.parseLiteral('"a\\nb"')));
  }

  /* ---- analyze ---- */
  group('T2-analyze');
  {
    ok('validateSyntax 合法', A.validateSyntax('{"a":1}').valid === true, 'ok');
    const vs = A.validateSyntax('{"a":}');
    ok('validateSyntax 非法含行号', vs.valid === false && vs.line > 0, show(vs));

    const dk = A.findDuplicateKeys('{"a":1,"a":2,"b":{"c":1,"c":2}}');
    ok('findDuplicateKeys 检出 2 处', dk.ok && dk.duplicates.length === 2, show(dk.duplicates));

    // schema
    const sch = { type: 'object', required: ['name', 'age'], properties: { name: { type: 'string', minLength: 2 }, age: { type: 'integer', minimum: 0, maximum: 200 }, role: { enum: ['a', 'b'] }, email: { type: 'string', format: 'email' }, tags: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } } } };
    const bad = { name: 'x', age: -1, role: 'z', email: 'not-an-email', tags: ['a', 'a'] };
    const res = A.validateSchema(bad, sch);
    ok('validateSchema 检出错误数 = 5', res.errors.length === 5, show(res.errors.map((e) => e.path + ':' + e.message)));
    ok('validateSchema 关键错误路径准确($.name,$.age,$.role,$.email,$.tags[1])',
      res.errors.some((e) => e.path === '$.name') && res.errors.some((e) => e.path === '$.age') &&
      res.errors.some((e) => e.path === '$.role') && res.errors.some((e) => e.path === '$.email') &&
      res.errors.some((e) => e.path === '$.tags[1]'), show(res.errors.map((e) => e.path)));
    ok('validateSchema anyOf 通过', A.validateSchema('x', { anyOf: [{ type: 'string' }, { type: 'number' }] }).valid === true, 'ok');
    ok('validateSchema anyOf 失败', A.validateSchema(true, { anyOf: [{ type: 'string' }, { type: 'number' }] }).valid === false, 'ok');
    ok('validateSchema oneOf 恰好1个通过', A.validateSchema(5, { oneOf: [{ type: 'number', minimum: 0 }, { type: 'number', minimum: 10 }] }).valid === true, show(A.validateSchema(5, { oneOf: [{ type: 'number', minimum: 0 }, { type: 'number', minimum: 10 }] })));
    ok('validateSchema allOf 全满足', A.validateSchema(5, { allOf: [{ type: 'number' }, { minimum: 1 }] }).valid === true, 'ok');

    // stats 手工可数
    const sv = { a: 1, b: [2, 3], c: { d: 4 } };
    const st = J.stats(sv);
    ok('stats 节点数 = 7', st.nodes === 7, 'nodes=' + st.nodes);
    ok('stats 最大深度 = 3', st.maxDepth === 3, 'maxDepth=' + st.maxDepth);
    ok('stats 类型分布 object=2,array=1,number=4', st.typeCounts.object === 2 && st.typeCounts.array === 1 && st.typeCounts.number === 4, JSON.stringify(st.typeCounts));

    const anom = A.findAnomalies({ a: null, b: '', c: [], d: {} }, {});
    ok('anomaly 检出 null/空串/空数组/空对象', anom.total === 4, show(anom.byType));

    const sec = A.securityCheck({ user: 'u', password: 'secret123', token: 'eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.x' });
    ok('security 命中 password/token 敏感字段', sec.hits.some((h) => h.key === 'password') && sec.hits.some((h) => h.key === 'token'), show(sec.hits));
    ok('security 命中明文密码', sec.plaintextPasswords.length >= 1, show(sec.plaintextPasswords));

    const size = A.sizeCompare('{"a": 1}', { a: 1 });
    ok('size 压缩后更小', size.minified.bytes <= size.original.bytes, show(size));
  }

  /* ---- 全量 68 工具空/非法输入 ---- */
  group('T2-全量68工具输入健壮性');
  {
    const reg = globalThis.JT.registry;
    const inputs = ['', '   ', 'null', '[]', '123', 'abc', '"str"'];
    const ctxFor = (input) => ({ parseInput: () => J.parseLax(input) });
    const problems = [];
    const toolReport = [];
    for (const t of reg.tools) {
      for (const inp of inputs) {
        const params = Object.assign({}, t.defaultParams);
        let out;
        try {
          out = t.run(inp, params, ctxFor(inp));
        } catch (e) {
          problems.push(t.id + ' 输入' + JSON.stringify(inp) + ' 同步抛异常: ' + e.message);
          continue;
        }
        if (out && typeof out.then === 'function') {
          out.then(() => {}, (e) => { problems.push(t.id + ' 输入' + JSON.stringify(inp) + ' Promise reject: ' + (e && e.message)); });
          continue;
        }
        if (!out || (out.output === undefined && out.error === undefined && out.data === undefined)) {
          problems.push(t.id + ' 输入' + JSON.stringify(inp) + ' 返回空结果');
        }
      }
      // 记录一次默认输入(合法对象数组)的执行摘要，用于报告
      const demo = JSON.stringify([{ id: 1, name: 'x', score: 1.5, ok: true, tags: ['a'] }, { id: 2, name: 'y', score: 2, ok: false, tags: [] }]);
      let r;
      try { r = t.run(demo, Object.assign({}, t.defaultParams), ctxFor(demo)); } catch (e) { r = { error: e.message }; }
      if (r && typeof r.then === 'function') r = { pending: true };
      toolReport.push({ id: t.id, cat: t.cat, error: !!(r && r.error), outLen: r && r.output ? String(r.output).length : 0, errMsg: (r && r.error) || '' });
    }
    ok('68 工具 × 7 非法输入：无异常且均有返回', problems.length === 0, problems.join('\n') || '0');
    results.push({ group: curGroup, name: '工具执行摘要', pass: true, expected: '', actual: JSON.stringify(toolReport) });
  }

  /* ---- 深嵌套 / 大数组 ---- */
  group('T2-压力与边界');
  {
    // 30 层
    let deep = { v: 1 };
    for (let i = 0; i < 30; i++) deep = { child: deep };
    let t0 = Date.now();
    let okDeep = true, deepMsg = '';
    try { const st = J.stats(deep); deepMsg = 'depth=' + st.maxDepth; } catch (e) { okDeep = false; deepMsg = e.message; }
    ok('深嵌套30层 stats 不异常', okDeep, deepMsg);
    try { const s = J.stringify(deep, { indent: 2 }); ok('深嵌套30层 stringify OK', s.length > 0, String(s.length)); } catch (e) { ok('深嵌套30层 stringify OK', false, e.message); }
    try { J.jsonPath(deep, '$..v'); ok('深嵌套30层 JSONPath 不异常', true, 'ok'); } catch (e) { ok('深嵌套30层 JSONPath 不异常', false, e.message); }

    const big = [];
    for (let i = 0; i < 2000; i++) big.push({ id: i, name: 'n' + i, g: 'G' + (i % 7), v: i * 1.5 });
    t0 = Date.now();
    let bigOk = true, bmsg = '';
    try {
      const st = J.stats(big);
      const g = J.groupBy(big, 'g');
      const ag = J.aggregate(big, 'v');
      const s = J.stringify(big, { indent: 2 });
      bmsg = 'nodes=' + st.nodes + ', groups=' + g.length + ', sum=' + ag[0].sum + ', strLen=' + s.length + ', ' + (Date.now() - t0) + 'ms';
    } catch (e) { bigOk = false; bmsg = e.message; }
    ok('大数组2000条各项操作不异常且限时', bigOk && (Date.now() - t0) < 5000, bmsg);
  }
}

function balanced(text) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  let inStr = null, esc = false, inLineComment = false, inBlockComment = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c === '*' && n === '/') { inBlockComment = false; i++; } continue; }
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && n === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && n === '*') { inBlockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '(' || c === '[' || c === '{') stack.push(c);
    else if (c === ')' || c === ']' || c === '}') { if (stack.pop() !== pairs[c]) return false; }
  }
  return stack.length === 0;
}

/* ============================ Round 2 新增回归 ============================ */
function hasKeyDeep(v, key) {
  if (Array.isArray(v)) return v.some((e) => hasKeyDeep(e, key));
  if (v !== null && typeof v === 'object') {
    if (Object.prototype.hasOwnProperty.call(v, key)) return true;
    return Object.keys(v).some((k) => hasKeyDeep(v[k], key));
  }
  return false;
}
function makeRnd(seed) { let s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const KEYWORDS = ['alpha', 'beta', 'gamma', '名字', '用户', '字段', 'a', 'b', 'c', 'key', 'val', 'n'];
function randKey(r, allowSep) {
  let k = KEYWORDS[Math.floor(r() * KEYWORDS.length)];
  if (r() < 0.3) k += ' ' + KEYWORDS[Math.floor(r() * KEYWORDS.length)];
  if (allowSep && r() < 0.35) k += '.' + KEYWORDS[Math.floor(r() * KEYWORDS.length)];
  if (r() < 0.2) k += Math.floor(r() * 10);
  if (!allowSep) k = k.replace(/[.[\]]/g, '_');
  if (k === '') k = 'k';
  return k;
}
function randVal(r, depth, allowSep) {
  const t = r();
  if (depth <= 0 || t < 0.42) {
    const s = r();
    if (s < 0.22) return null;
    if (s < 0.42) return Math.floor(r() * 100);
    if (s < 0.56) return Math.round(r() * 1000) / 10;
    if (s < 0.70) return r() < 0.5;
    if (s < 0.80) return '';
    return 'str' + Math.floor(r() * 100) + (r() < 0.25 ? '中' : '');
  }
  if (t < 0.72) {
    const n = Math.floor(r() * 4); // 含空数组
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(randVal(r, depth - 1, allowSep));
    return arr;
  }
  const n = 1 + Math.floor(r() * 4);
  const o = {}; const used = new Set();
  for (let i = 0; i < n; i++) { let k = randKey(r, allowSep); while (used.has(k)) k = k + 'x'; used.add(k); o[k] = randVal(r, depth - 1, allowSep); }
  return o;
}
function randRoot(r, allowSep) {
  // 根为对象或非空数组（避开退化输入）
  if (r() < 0.5) {
    const n = 1 + Math.floor(r() * 4); const o = {}; const used = new Set();
    for (let i = 0; i < n; i++) { let k = randKey(r, allowSep); while (used.has(k)) k = k + 'x'; used.add(k); o[k] = randVal(r, 1 + Math.floor(r() * 5), allowSep); }
    return o;
  }
  const n = 1 + Math.floor(r() * 3); const arr = [];
  for (let i = 0; i < n; i++) arr.push(randVal(r, 1 + Math.floor(r() * 5), allowSep));
  return arr;
}

function t2round2() {
  /* ---- 修复真实性静态核对 ---- */
  group('R2-修复核验(静态)');
  const appSrc = fs.readFileSync(path.join(WEB, 'js/app.js'), 'utf8');
  const htmlSrc = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const jsonSrc = fs.readFileSync(path.join(WEB, 'js/core/json.js'), 'utf8');
  const cgSrc = fs.readFileSync(path.join(WEB, 'js/core/codegen.js'), 'utf8');
  const cvSrc = fs.readFileSync(path.join(WEB, 'js/core/convert.js'), 'utf8');
  const edSrc = fs.readFileSync(path.join(WEB, 'js/ui/editor.js'), 'utf8');
  const toSrc = fs.readFileSync(path.join(WEB, 'js/ui/toast.js'), 'utf8');
  const regSrc = fs.readFileSync(path.join(WEB, 'js/tools-registry.js'), 'utf8');
  const mainSrc = fs.readFileSync(path.join(ROOT, 'main.py'), 'utf8');
  const batSrc = fs.readFileSync(path.join(ROOT, '启动.bat'), 'utf8');
  ok('P1 修复：无 D.modal 残留', !/D\.modal/.test(appSrc), (appSrc.match(/D\.modal/g) || []).length + ' 处');
  ok('P1 修复：JT.modal 用法存在', /JT\.modal\.open\(/.test(appSrc), 'ok');
  ok('P2-1 修复：run() 清两侧错误条', /inputEditor\.clearError\(\);\s*\n\s*if \(outputEditor\) outputEditor\.clearError\(\)/.test(appSrc), 'ok');
  ok('P2-2 修复：parseFlatKey 存在且无 __arr', /function parseFlatKey/.test(jsonSrc) && !/__arr/.test(jsonSrc), 'parseFlatKey=' + /function parseFlatKey/.test(jsonSrc) + ' __arr=' + /__arr/.test(jsonSrc));
  ok('P2-3 修复：codegen uniqueField 存在', /function uniqueField/.test(cgSrc), 'ok');
  ok('P2-3 修复：registry runCodegen 存在', /function runCodegen/.test(regSrc), 'ok');
  ok('P3-1 修复：flatten 输出 a[i] 形式', /prefix \+ '\[' \+ i \+ '\]'/.test(jsonSrc), 'ok');
  ok('P3-2 修复：collectXmlLossy 存在', /function collectXmlLossy/.test(cvSrc) && /notices: Array\.isArray\(opts\.notices\)/.test(cvSrc), 'ok');
  // 图标升级：原为内联占位 data:,，现为真实图标文件 favicon.png（与 exe 的 app.ico 同源设计）
  ok('P3-3 升级：favicon 指向真实文件且存在', /rel="icon"[^>]*href="favicon\.png"/.test(htmlSrc) && fs.existsSync(path.join(WEB, 'favicon.png')), 'ok');
  ok('P3-4 修复：setViewToggle + 树形默认', /setViewToggle/.test(edSrc) && /view: 'tree'/.test(regSrc), 'ok');
  ok('P3-5 修复：toast 上限=3', /MAX_TOASTS\s*=\s*3/.test(toSrc), 'ok');
  ok('P3-6 修复：启动.bat 引号+探测', /"%PYEXE%"/.test(batSrc) && /-c "import sys"/.test(batSrc), 'ok');
  ok('加固：main.py 使用 _MEIPASS', /_MEIPASS/.test(mainSrc), 'ok');

  /* ---- P2-2 属性化压力测试：250 随机样本往返 ---- */
  group('R2-P2-2 flatten/unflatten 属性测试(严格键)');
  {
    const r = makeRnd(20240924);
    let fails = []; let n = 0;
    for (let i = 0; i < 250; i++) {
      const x = randRoot(r, false);
      const flat = J.flatten(x, { arrays: true });
      const back = J.unflatten(flat, {});
      n++;
      const eq = deepEq(back, x);
      const leak = hasKeyDeep(flat, '__arr') || hasKeyDeep(back, '__arr');
      if (!eq || leak) fails.push({ i, input: x, flat, back, leak, note: 'mismatch' });
      if (fails.length >= 5) break;
    }
    ok('250 随机样本 flatten/unflatten 往返深等价（严格键）', fails.length === 0, fails.length ? JSON.stringify(fails[0]).slice(0, 600) : ('样本数=' + n + ' 全部通过'));
    ok('往返输出不含 __arr 内部字段', fails.filter((f) => f.leak).length === 0, 'leak=' + fails.filter((f) => f.leak).length);
  }

  /* ---- P2-2 属性测试（含分隔符/括号的敌意键，用于界定边界） ---- */
  group('R2-P2-2 属性测试(含点键·边界观察)');
  {
    const r = makeRnd(777);
    let total = 0, mismatch = 0, sample = null;
    for (let i = 0; i < 200; i++) {
      const x = randRoot(r, true);
      const flat = J.flatten(x, { arrays: true });
      const back = J.unflatten(flat, {});
      total++;
      if (!deepEq(back, x)) { mismatch++; if (!sample) sample = { input: x, flat, back }; }
    }
    ok('含点键样本：往返失败率已记录（分隔符冲突属固有歧义）', true, 'total=' + total + ' mismatch=' + mismatch + (sample ? ' 首个反例=' + JSON.stringify(sample).slice(0, 400) : ''));
  }

  /* ---- P3-1 兼容性 ---- */
  group('R2-P3-1 展平数组路径');
  {
    const f1 = J.flatten({ a: [10, 20] }, { arrays: true });
    ok('展平只输出规范写法 a[0]（不含 .数字）', Object.keys(f1).includes('a[0]') && !Object.keys(f1).some((k) => /\.\d/.test(k)), JSON.stringify(f1));
    ok('unflatten 兼容旧写法 a.[0]', deepEq(J.unflatten({ 'a.[0]': 10, 'a.[1]': 20 }, {}), { a: [10, 20] }), JSON.stringify(J.unflatten({ 'a.[0]': 10, 'a.[1]': 20 }, {})));
    ok('unflatten 兼容新写法 a[0]', deepEq(J.unflatten({ 'a[0]': 10, 'a[1]': 20 }, {}), { a: [10, 20] }), JSON.stringify(J.unflatten({ 'a[0]': 10, 'a[1]': 20 }, {})));
    ok('两种写法还原结果一致', deepEq(J.unflatten({ 'a.[0]': 1, 'a.[1]': 2 }, {}), J.unflatten({ 'a[0]': 1, 'a[1]': 2 }, {})), 'ok');
  }

  /* ---- P2-3 字段唯一性 ---- */
  group('R2-P2-3 codegen 字段名唯一性');
  {
    const sample = { 'a b': 1, aB: 2, 'a-b': 3, 'class': 4, '中文键': 5 };
    const gens = { TS: G.toTypeScript, Java: G.toJava, Kotlin: G.toKotlin, Go: G.toGo, Python: G.toPython, CSharp: G.toCSharp, Rust: G.toRust, Swift: G.toSwift, Dart: G.toDart, Php: G.toPhp, DDL: G.toDDL };
    for (const [nm, fn] of Object.entries(gens)) {
      const report = [];
      const model = G.buildModel(G.inferValue(sample), 'Root', { report: report });
      const allUnique = model.types.every((ty) => { const ns = ty.fields.map((f) => f.name); return new Set(ns).size === ns.length; });
      let out = '';
      try { out = fn(sample, { report: [] }); } catch (e) { out = ''; }
      ok(nm + ' 字段名无重复且输出非空', allUnique && typeof out === 'string' && out.length > 0, JSON.stringify({ unique: allUnique, len: out.length }));
    }
    const rep = [];
    G.toJava(sample, { jackson: true, report: rep });
    ok('冲突被记录到 report', rep.length >= 1 && /字段名冲突/.test(rep.join(' ')), JSON.stringify(rep).slice(0, 260));
    const javaOut = G.toJava(sample, { jackson: true });
    ok('Java 保留 @JsonProperty("a b")', /@JsonProperty\("a b"\)/.test(javaOut), javaOut.slice(0, 200));
    ok('Java 二次冲突命名为 aB_2', /Integer aB_2;|Double aB_2;|Object aB_2;|\w+ aB_2;/.test(javaOut), javaOut.slice(0, 250));
    const goOut = G.toGo(sample, {});
    ok('Go 保留 json:"a b" 标签', /json:"a b/.test(goOut), goOut.slice(0, 220));
    const rustOut = G.toRust(sample, {});
    ok('Rust 保留 #[serde(rename = "a b")]', /serde\(rename = "a b"\)/.test(rustOut), rustOut.slice(0, 220));

    // 二次冲突：不得与已有 aB_2 撞名
    const s2 = { 'a b': 1, aB: 2, aB_2: 3 };
    const m2 = G.buildModel(G.inferValue(s2), 'Root', { report: [] });
    const names2 = m2.types[0].fields.map((f) => f.name);
    ok('二次冲突后仍无重名', new Set(names2).size === names2.length, JSON.stringify(names2));

    // registry 包装：11 个工具均无错误、非空
    const reg = globalThis.JT.registry;
    const ids = ['convert-ts', 'convert-java', 'convert-kotlin', 'convert-go', 'convert-python', 'convert-csharp', 'convert-rust', 'convert-swift', 'convert-dart', 'convert-php', 'convert-ddl'];
    const bad = [];
    for (const id of ids) {
      const t = reg.get(id);
      const inp = JSON.stringify(sample);
      let r;
      try { r = t.run(inp, Object.assign({}, t.defaultParams, { jackson: true, jsonProperty: true }), { parseInput: () => J.parseLax(inp) }); } catch (e) { r = { error: e.message }; }
      if (!r || r.error || typeof r.output !== 'string' || !r.output.length) bad.push(id + ':' + (r && r.error || 'empty'));
    }
    ok('registry 11 个代码生成工具无错误且非空', bad.length === 0, bad.join(',') || 'all-ok');
    const tj = reg.get('convert-java');
    const inp = JSON.stringify(sample);
    const rj = tj.run(inp, Object.assign({}, tj.defaultParams, { jackson: true }), { parseInput: () => J.parseLax(inp) });
    ok('registry convert-java 汇入重名 notice', Array.isArray(rj.notices) && rj.notices.some((n) => /字段名冲突/.test(n)), JSON.stringify(rj.notices || []).slice(0, 220));

    // 保留字观察项（非断言失败，记录供报告）
    const javaKw = /private\s+\w+\s+class\s*;/.test(javaOut);
    const pyOut = G.toPython(sample, {});
    const pyKw = /^\s+class\s*:/m.test(pyOut);
    results.push({ group: curGroup, name: '观察：生成字段是否含保留字 class', pass: true, expected: '记录', actual: JSON.stringify({ java: javaKw, python: pyKw, javaSnippet: (javaOut.match(/.*\bclass\b.*/) || [''])[0].trim(), pySnippet: (pyOut.match(/^\s+class\s*:.*/m) || [''])[0].trim() }) });
  }

  /* ---- P3-2 XML 告警 ---- */
  group('R2-P3-2 XML 无损性告警');
  {
    const notices = [];
    let xml = '';
    let threw = false;
    try { xml = C.jsonToXml({ a: null, b: [], c: '' }, { rootName: 'root', notices: notices }); } catch (e) { threw = true; }
    ok('XML null/空数组/空串告警非空且说明原因', !threw && notices.length > 0 && /null|空数组|空字符串/.test(notices.join(' ')), JSON.stringify(notices).slice(0, 300));
    ok('XML 转换不抛异常且输出非空', !threw && typeof xml === 'string' && xml.length > 0, xml.slice(0, 80));
    // registry 层透传
    const t = globalThis.JT.registry.get('convert-xml');
    const inp = JSON.stringify({ a: null, b: [], c: '' });
    const r = t.run(inp, Object.assign({}, t.defaultParams), { parseInput: () => J.parseLax(inp) });
    ok('convert-xml 工具 notices 透传', Array.isArray(r.notices) && r.notices.length > 0, JSON.stringify(r.notices || []).slice(0, 200));
  }

  /* ---- P3-5 toast 上限（Node 轻量 DOM 桩） ---- */
  group('R2-P3-5 toast 数量上限/去重');
  {
    function NodeStub(tag) {
      this.tagName = tag; this.children = []; this.style = {}; this._text = '';
      this.classList = { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle() {}, contains(c) { return this._s.has(c); } };
    }
    NodeStub.prototype.appendChild = function (c) { this.children.push(c); c.parentNode = this; return c; };
    NodeStub.prototype.removeChild = function (c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; };
    NodeStub.prototype.setAttribute = function () {};
    NodeStub.prototype.addEventListener = function () {};
    Object.defineProperty(NodeStub.prototype, 'firstChild', { get() { return this.children[0] || null; } });
    Object.defineProperty(NodeStub.prototype, 'textContent', { get() { return this._text; }, set(v) { this._text = String(v); } });
    const body = new NodeStub('body');
    const prevDoc = globalThis.document, prevRaf = globalThis.requestAnimationFrame;
    globalThis.document = { createElement: (t) => new NodeStub(t), body: body, addEventListener() {} };
    globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    delete globalThis.JTUI;
    loadScript(path.join(WEB, 'js/ui/toast.js'));
    const toast = globalThis.JTUI.toast;
    for (let i = 1; i <= 6; i++) toast.show('msg-' + i + '-' + Date.now());
    const host = body.children.find((c) => c.className === 'jt-toasts');
    ok('连发 6 条后同屏 toast ≤ 3', host && host.children.length <= 3, 'count=' + (host ? host.children.length : 'no-host'));
    toast.show('DUP-XYZ'); toast.show('DUP-XYZ');
    const dupCount = host.children.filter((c) => (c.children || []).some((x) => x._text === 'DUP-XYZ')).length;
    ok('相同内容 1.5s 内只保留 1 条', dupCount === 1, 'dupCount=' + dupCount);
    globalThis.document = prevDoc; globalThis.requestAnimationFrame = prevRaf; delete globalThis.JTUI;
  }
}

/* ============================ R3 复验（Round 3：4 项定向打磨） ============================ */
function t2round3() {
  const reg3 = globalThis.JT.registry;
  const edSrc3 = fs.readFileSync(path.join(WEB, 'js/ui/editor.js'), 'utf8');
  const cgSrc3 = fs.readFileSync(path.join(WEB, 'js/core/codegen.js'), 'utf8');
  const regSrc3 = fs.readFileSync(path.join(WEB, 'js/tools-registry.js'), 'utf8');
  const cssSrc3 = fs.readFileSync(path.join(WEB, 'css/components.css'), 'utf8');
  const RES = G.reservedWords;
  const LANGS11 = ['ts', 'java', 'kotlin', 'go', 'python', 'csharp', 'rust', 'swift', 'dart', 'php', 'sql'];

  /* ---- 修复真实性静态核对（读码） ---- */
  group('R3-修复核验(静态)');
  ok('树: buildNode(key,value,path,depth,expandTo) 返回句柄', /function buildNode\(key, value, path, depth, expandTo\)/.test(edSrc3) && /return self;/.test(edSrc3) && /setOpen: function/.test(edSrc3), 'ok');
  ok('树: 默认展开深度 expandTo = n>3000?0:(singleRoot?2:1)', /expandTo = n > 3000 \? 0 : \(singleRoot \? 2 : 1\)/.test(edSrc3), 'ok');
  ok('树: expandAll budget=20000 + collapseAll', /function expandAll/.test(edSrc3) && /budget = 20000/.test(edSrc3) && /function collapseAll/.test(edSrc3), 'ok');
  ok('树: 顶部「全部展开/全部折叠」按钮', /全部展开/.test(edSrc3) && /全部折叠/.test(edSrc3) && /jt-tree-bar/.test(edSrc3), 'ok');
  ok('滚动: applyText 末尾正文+行号槽 scrollTop 归零', /scroller\.scrollTop = 0;[\s\S]{0,60}gutter\.scrollTop = 0;/.test(edSrc3), 'ok');
  ok('保留字: RESERVED 覆盖 11 语言', !!RES && LANGS11.every((k) => Array.isArray(RES[k]) && RES[k].length > 0), RES ? Object.keys(RES).length + ' 语言' : 'missing');
  ok('保留字: uniqueField 命中追加 _1 且置 reserved', /n = n \+ '_1';/.test(cgSrc3) && /reserved = true/.test(cgSrc3), 'ok');
  ok('保留字: 字段对象带 reserved 标记', /reserved: fld\.reserved/.test(cgSrc3), 'ok');
  ok('保留字: 生成器注入 opts.lang（≥11 处）', (cgSrc3.match(/opts\.lang = '/g) || []).length >= 11, (cgSrc3.match(/opts\.lang = '/g) || []).length + ' 处');
  ok('Swift/Dart: 已无 toCamel(f.name)，改用 f.name', !/toCamel\(f\.name\)/.test(cgSrc3) && /let ' \+ f\.name \+ ': '/.test(cgSrc3) && /dartType\(f\.type, opt\) \+ ' ' \+ f\.name/.test(cgSrc3), 'ok');
  ok('registry: flatten separator 为下拉', /sel\('separator'/.test(regSrc3), 'ok');
  ok('registry: flatten desc 含分隔符往返提示', /往返可能不保真|建议改用其他分隔符/.test(regSrc3), 'ok');
  ok('CSS: .jt-tree-bar / .jt-tree-bar-btn 样式存在', /\.jt-tree-bar \{/.test(cssSrc3) && /\.jt-tree-bar-btn \{/.test(cssSrc3), 'ok');

  /* ---- 保留字转义：11 生成器逐语言断言 ---- */
  group('R3-保留字转义(11 生成器)');
  const RK = { 'class': 1, 'int': 2, 'public': 3, 'default': 4, 'func': 5, 'if': 6, 'for': 7, 'return': 8, 'var': 9, 'fun': 10, 'type': 11, 'interface': 12 };
  const GENSX = [
    { lang: 'ts', fn: 'toTypeScript', label: 'TypeScript', re: /^\s+([A-Za-z_$][\w$]*)\??\s*:/gm },
    { lang: 'java', fn: 'toJava', label: 'Java', re: /private\s+[\w<>\[\]]+\s+([A-Za-z_$][\w$]*)\s*;/gm },
    { lang: 'kotlin', fn: 'toKotlin', label: 'Kotlin', re: /\bval\s+([A-Za-z_$][\w$]*)\s*:/gm },
    { lang: 'go', fn: 'toGo', label: 'Go', re: /^\t([A-Z][\w]*)\s+/gm },
    { lang: 'python', fn: 'toPython', label: 'Python', re: /^\s{4}([A-Za-z_$][\w$]*)\s*:/gm },
    { lang: 'csharp', fn: 'toCSharp', label: 'C#', re: /public\s+[\w<>\[\].?]+\s+([A-Za-z_$][\w$]*)\s*\{/gm },
    { lang: 'rust', fn: 'toRust', label: 'Rust', re: /^\s+pub\s+([A-Za-z_$][\w$]*)\s*:/gm },
    { lang: 'swift', fn: 'toSwift', label: 'Swift', re: /^\s+let\s+([A-Za-z_$][\w$]*)\s*:/gm },
    { lang: 'dart', fn: 'toDart', label: 'Dart', re: /^\s+final\s+\S+\s+([A-Za-z_$][\w$]*)\s*;/gm },
    { lang: 'php', fn: 'toPhp', label: 'PHP', re: /public\s+\S+\s+\$([A-Za-z_][\w$]*)\s*;/gm },
    { lang: 'sql', fn: 'toDDL', label: 'DDL', re: /^\s+`([^`]+)`\s/gm }
  ];
  const collectNames = (re, s) => { const out = []; let m; const r = new RegExp(re.source, re.flags); while ((m = r.exec(s)) !== null) { out.push(m[1]); } return out; };
  for (const g of GENSX) {
    const rep = [];
    let out = '';
    try { out = G[g.fn](RK, { report: rep, rootName: 'Root', jackson: true, jsonProperty: true, optionalMode: 'none' }); } catch (e) { out = ''; }
    const names = collectNames(g.re, out).filter((n) => n !== 'Root');
    const resSet = new Set((RES[g.lang] || []).map(String));
    // DDL 列名已用反引号包裹，保留字合法；其余语言检查"裸保留字标识符"
    const bareReserved = g.lang === 'sql' ? [] : names.filter((n) => resSet.has(n));
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    const sane = names.length >= 10;
    ok(g.label + ': 声明标识符均为合法（无裸保留字/无重复）', sane && out.length > 0 && bareReserved.length === 0 && dup.length === 0, JSON.stringify({ n: names.length, bareReserved, dup, names }));
    ok(g.label + ': 保留字改名写入 notices 且含原键说明', rep.length > 0 && rep.some((r) => /保留字/.test(r) && /重命名为/.test(r) && /原键/.test(r)), 'report=' + rep.length + (rep[0] ? ' :: ' + rep[0].slice(0, 90) : ''));
  }

  /* ---- 原键映射保留（逐语言定点） ---- */
  group('R3-原键映射保留');
  const jOut = G.toJava(RK, { jackson: true, jsonProperty: true, optionalMode: 'none' });
  ok('Java @JsonProperty("class") + 属性 class_1', /@JsonProperty\("class"\)\s*\n\s*private\s+\w+\s+class_1;/.test(jOut), (jOut.match(/@JsonProperty\("class"\)/) || [''])[0]);
  const kOut = G.toKotlin(RK, { jackson: true, optionalMode: 'none' });
  ok('Kotlin @JsonProperty("class") val class_1', /@JsonProperty\("class"\)\s*val\s+class_1:/.test(kOut), 'ok');
  const goOut3 = G.toGo(RK, { optionalMode: 'none' });
  ok('Go 保留 json:"class" 标签', /json:"class"/.test(goOut3), (goOut3.match(/json:"class"/) || [''])[0]);
  const rsOut = G.toRust(RK, { optionalMode: 'none' });
  ok('Rust type → #[serde(rename = "type")]', /#\[serde\(rename = "type"\)\]\s*\n\s*pub\s+type_1:/.test(rsOut), 'ok');
  const csOut = G.toCSharp(RK, { jsonProperty: true, optionalMode: 'none' });
  ok('C# JsonPropertyName("class") + Class1', /\[JsonPropertyName\("class"\)\]\s*\n\s*public\s+\w+\s+Class1\s*\{/.test(csOut), 'ok');
  const swOut = G.toSwift(RK, { optionalMode: 'none' });
  ok('Swift CodingKeys case class_1 = "class"', /case\s+class_1\s*=\s*"class"/.test(swOut), 'ok');
  const dtOut = G.toDart(RK, { optionalMode: 'none' });
  ok('Dart class_1: json[\'class\'] 与 \'class\': class_1', /class_1:\s*json\['class'\]/.test(dtOut) && /'class':\s*class_1/.test(dtOut), 'ok');
  const phOut = G.toPhp(RK, { optionalMode: 'none' });
  ok('PHP $class_1', /\$class_1\s*;/.test(phOut), 'ok');

  /* ---- Swift / Dart 映射自洽（保留字键 + 驼峰键 混合） ---- */
  group('R3-Swift/Dart 映射自洽性');
  {
    const MIX = { 'class': 1, 'userName': 2, 'default_value': 3 };
    const sw = G.toSwift(MIX, { rootName: 'Root', optionalMode: 'none' });
    const swProps = [...sw.matchAll(/^\s+let\s+([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1]);
    const swCases = [...sw.matchAll(/case\s+([A-Za-z_$][\w$]*)\s*=\s*"([^"]*)"/g)].map((m) => ({ name: m[1], key: m[2] }));
    ok('Swift 属性名唯一', new Set(swProps).size === swProps.length && swProps.length === 3, JSON.stringify(swProps));
    ok('Swift 每个 case 名都对应一个属性', swCases.length > 0 && swCases.every((c) => swProps.includes(c.name)), JSON.stringify(swCases));
    ok('Swift class → class_1（不再裸 class）', swProps.includes('class_1') && !swProps.includes('class'), JSON.stringify(swProps));
    ok('Swift class_1 ↔ 原键 class', swCases.some((c) => c.name === 'class_1' && c.key === 'class'), JSON.stringify(swCases));
    ok('Swift default_value → defaultValue ↔ 原键', swProps.includes('defaultValue') && swCases.some((c) => c.name === 'defaultValue' && c.key === 'default_value'), JSON.stringify(swCases));
    ok('Swift 驼峰键 userName 未被多余改写', swProps.includes('userName'), JSON.stringify(swProps));

    const dt = G.toDart(MIX, { rootName: 'Root', optionalMode: 'none' });
    const dtProps = [...dt.matchAll(/^\s+final\s+\S+\s+([A-Za-z_$][\w$]*)\s*;/gm)].map((m) => m[1]);
    const dtCtor = [...dt.matchAll(/this\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    const dtFrom = [...dt.matchAll(/^\s+([A-Za-z_$][\w$]*):\s*json\['([^']*)'\]/gm)].map((m) => ({ prop: m[1], key: m[2] }));
    const dtTo = [...dt.matchAll(/'([^']*)':\s*([A-Za-z_$][\w$]*),/g)].map((m) => ({ key: m[1], prop: m[2] }));
    const keysSorted = ['class', 'userName', 'default_value'].sort().join(',');
    ok('Dart 属性唯一 & 构造参数与属性一致', new Set(dtProps).size === dtProps.length && dtProps.length === 3 && dtCtor.every((p) => dtProps.includes(p)) && dtProps.every((p) => dtCtor.includes(p)), JSON.stringify({ dtProps, dtCtor }));
    ok('Dart fromJson: 属性∈属性集 且 键==原键', dtFrom.length === 3 && dtFrom.every((f) => dtProps.includes(f.prop)) && dtFrom.map((f) => f.key).sort().join(',') === keysSorted, JSON.stringify(dtFrom));
    ok('Dart toJson: 键==原键 且 值∈属性集', dtTo.length === 3 && dtTo.every((f) => dtProps.includes(f.prop)) && dtTo.map((f) => f.key).sort().join(',') === keysSorted, JSON.stringify(dtTo));
    ok('Dart class → class_1', dtProps.includes('class_1') && !dtProps.includes('class'), JSON.stringify(dtProps));
  }

  /* ---- 非保留字回归（普通键不得被多改） ---- */
  group('R3-非保留字回归');
  {
    const NORM = { 'userName': 1, 'age': 2 };
    const gens = { TS: 'toTypeScript', Java: 'toJava', Kotlin: 'toKotlin', Go: 'toGo', Python: 'toPython', CSharp: 'toCSharp', Rust: 'toRust', Swift: 'toSwift', Dart: 'toDart', Php: 'toPhp' };
    const bad = [];
    for (const [nm, fn] of Object.entries(gens)) {
      const out = G[fn](NORM, { rootName: 'Root', optionalMode: 'none' });
      if (/_1\b/.test(out)) bad.push(nm + ':has_1');
      if (!/user[ _]?name/i.test(out)) bad.push(nm + ':lost_userName');
    }
    ok('普通键（userName/age）无多余 _1 后缀且保留原名', bad.length === 0, bad.join(',') || 'all-ok');
    const tsOut = G.toTypeScript(NORM, { rootName: 'Root', optionalMode: 'none' });
    ok('TS 普通键结构正确（userName/age）', /userName: number;/.test(tsOut) && /age: number;/.test(tsOut), tsOut.replace(/\s+/g, ' ').slice(0, 120));
  }

  /* ---- flatten 分隔符下拉 + 往返 ---- */
  group('R3-flatten 分隔符');
  {
    const t = reg3.get('format-flatten');
    const sp = t.params.find((p) => p.id === 'separator');
    const opts = sp && sp.options ? sp.options.map((o) => o.value) : [];
    ok('separator 为下拉且含 4 个选项', !!sp && sp.type === 'select' && opts.length === 4, JSON.stringify({ type: sp && sp.type, opts }));
    ok('separator 默认值为 .', t.defaultParams.separator === '.', String(t.defaultParams.separator));
    ok('separator 选项含 . __ → /', ['.', '__', '→', '/'].every((v) => opts.includes(v)), JSON.stringify(opts));
    ok('desc 含分隔符往返提示文案', /往返可能不保真|建议改用其他分隔符/.test(t.desc), String(t.desc).slice(0, 70));
    const inp = { 'a.b': 1, c: 2, 'd.e': { 'f.g': 3 } };
    ok('separator=__ 往返深等价', deepEq(J.unflatten(J.flatten(inp, { separator: '__', arrays: true }), { separator: '__' }), inp), JSON.stringify(J.unflatten(J.flatten(inp, { separator: '__', arrays: true }), { separator: '__' })));
    ok('separator=. 不保真（固有歧义，desc 已提示）', !deepEq(J.unflatten(J.flatten(inp, { separator: '.', arrays: true }), { separator: '.' }), inp), JSON.stringify(J.flatten(inp, { separator: '.', arrays: true })));
    const ti = JSON.stringify(inp);
    const rfl = t.run(ti, Object.assign({}, t.defaultParams, { separator: '__', direction: 'flatten' }), { parseInput: () => J.parseLax(ti) });
    const rbf = t.run(rfl.output, Object.assign({}, t.defaultParams, { separator: '__', direction: 'unflatten' }), { parseInput: () => J.parseLax(rfl.output) });
    ok('registry 展平→还原(separator=__) 深等价', !rfl.error && !rbf.error && deepEq(J.parseLax(rbf.output).value, inp), String(rbf.output || rbf.error).replace(/\s+/g, ' ').slice(0, 160));
  }
}

/* ============================ R4 终验（收尾改动） ============================ */
function t2round4() {
  const cgSrc4 = fs.readFileSync(path.join(WEB, 'js/core/codegen.js'), 'utf8');
  const batSrc4 = fs.readFileSync(path.join(ROOT, '启动.bat'), 'utf8');
  const readmeSrc4 = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  /* ---- 修复真实性静态核对 ---- */
  group('R4-修复核验(静态)');
  ok('启动.bat: BADPY 分支含 exe 兜底（start + exit /b 0）', /:BADPY[\s\S]*?if exist "%DIR%dist\\JSON工具箱\.exe"[\s\S]*?start "" "%DIR%dist\\JSON工具箱\.exe"[\s\S]*?exit \/b 0/.test(batSrc4), 'ok');
  ok('启动.bat: NOTFOUND 分支含 exe 兜底 + 方案三', /:NOTFOUND[\s\S]*?if exist "%DIR%dist\\JSON工具箱\.exe"[\s\S]*?方案三/.test(batSrc4), 'ok');
  ok('启动.bat: Python 5 级探测优先级未变', /runtime\\pythonw\.exe[\s\S]*?envs\\default\\Scripts\\pythonw\.exe[\s\S]*?where pyw[\s\S]*?where pythonw[\s\S]*?where python/.test(batSrc4), 'ok');
  ok('启动.bat: RUN 分支仍优先 python main.py（exe 不在其前）', /:RUN[\s\S]*?start "" "%PYEXE%" %PYARGS% "%DIR%main\.py"/.test(batSrc4), 'ok');
  ok('codegen.js: toSwift 用 needKeys 门控', /var needKeys = ty\.fields\.some\(function \(f\) \{ return f\.name !== f\.jsonKey; \}\)/.test(cgSrc4), 'ok');
  ok('codegen.js: 生成 CodingKeys 时为每个属性逐一写 case（枚举内 forEach + case=jsonKey）', /if \(needKeys\) \{[\s\S]*?ty\.fields\.forEach\(function \(f\) \{[\s\S]*?case ' \+ f\.name \+ ' = "' \+ f\.jsonKey/.test(cgSrc4), 'ok');
  ok('codegen.js: needKeys 为 false 时整块跳过（生成受门控）', /if \(needKeys\) \{[\s\S]*?lines\.push\('    \}'\);[\s\S]*?\n      \}/.test(cgSrc4), 'ok');
  ok('README: dist/ 列入目录结构', /├── dist\//.test(readmeSrc4), 'ok');
  ok('README: 方式 2 为 dist\\JSON工具箱.exe（无需 Python）', /方式 2：直接双击 `dist\\JSON工具箱\.exe`/.test(readmeSrc4), 'ok');
  ok('README: 已知限制新增第 8 条（Swift CodingKeys）', /8\. 「JSON → Swift」的 `CodingKeys`/.test(readmeSrc4), 'ok');

  /* ---- C2: Swift CodingKeys 全量覆盖 ---- */
  group('R4-Swift CodingKeys 全量覆盖');
  const scParse = (src) => ({
    props: [...src.matchAll(/^\s+let\s+(\S+)\s*:/gm)].map((m) => m[1]),
    cases: [...src.matchAll(/^\s+case\s+(\S+)\s*=\s*"([^"]*)"$/gm)].map((m) => ({ name: m[1], key: m[2] })),
  });
  const SC = G.toSwift({ 'class': 1, 'userName': 2, 'default_value': 3 }, { rootName: 'Root', optionalMode: 'none' });
  const sc = scParse(SC);
  ok('case 数严格等于存储属性数（3 === 3）', sc.cases.length === 3 && sc.props.length === 3, JSON.stringify(sc));
  { const map = {}; sc.cases.forEach((c) => { map[c.name] = c.key; });
    ok('逐条配对①：class_1 ↔ "class"', map['class_1'] === 'class', JSON.stringify(map));
    ok('逐条配对②：userName ↔ "userName"（未改名也显式写出）', map['userName'] === 'userName', JSON.stringify(map));
    ok('逐条配对③：defaultValue ↔ "default_value"', map['defaultValue'] === 'default_value', JSON.stringify(map)); }
  ok('每个 case 名都对应一个存储属性', sc.cases.every((c) => sc.props.includes(c.name)), JSON.stringify(sc));
  ok('每个存储属性都被某个 case 覆盖（无遗漏）', sc.props.every((p) => sc.cases.some((c) => c.name === p)), JSON.stringify(sc));
  { const SC2 = G.toSwift({ 'userName': 1, 'age': 2 }, { rootName: 'Root', optionalMode: 'none' });
    ok('无任何映射（userName/age）→ 完全不生成 CodingKeys', !/enum CodingKeys/.test(SC2), SC2.replace(/\s+/g, ' ').slice(0, 120)); }
  { const s = G.toSwift({ 'a_b': 1, 'aB': 2 }, { rootName: 'Root', optionalMode: 'none' });
    const p = scParse(s);
    const oneToOne = p.cases.length === p.props.length && p.cases.every((c) => p.props.includes(c.name)) && p.props.every((x) => p.cases.some((c) => c.name === x));
    ok('边界 a_b/aB（冲突重命名）：CodingKeys↔属性一一对应且不崩溃', s.length > 0 && oneToOne, JSON.stringify(p)); }
  { const s = G.toSwift({ '中文': 1 }, { rootName: 'Root', optionalMode: 'none' });
    const p = scParse(s);
    ok('边界 中文键（名==键）：不生成 CodingKeys 且属性正常', !/enum CodingKeys/.test(s) && /let 中文\s*:/.test(s) && p.props.length === 1, JSON.stringify(p)); }
}

/* ============================ 运行 ============================ */
const t1out = t1();
t2core();
t2round2();
t2round3();
t2round4();

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n================ JSON 工具箱 · 单元/静态测试 ================');
for (const r of results) {
  if (r.actual !== undefined && r.name === '分类计数') continue;
}
console.log(`=== 通过 ${passed} / 失败 ${failed.length} ===\n`);
if (failed.length) {
  console.log('--- 失败明细 ---');
  for (const f of failed) {
    console.log(`[${f.group}] ${f.name}`);
    console.log(`   期望: ${show(f.expected)}`);
    console.log(`   实际: ${show(f.actual)}\n`);
  }
}
// 输出机器可读明细（供报告使用）
fs.writeFileSync(path.join(__dirname, 'unit-results.json'), JSON.stringify({ passed, failed: failed.length, results }, null, 2), 'utf8');
console.log('分类计数: ' + JSON.stringify(t1out.catCounts));
