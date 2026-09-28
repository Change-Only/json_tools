/* Round 4 · C2 Swift CodingKeys 亲眼验证：直接打印生成结果 + 逐条断言 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ style: {} }), addEventListener() {} };
const load = (rel) => { (0, eval)(fs.readFileSync(path.join(WEB, rel), 'utf8')); };
['js/core/json.js', 'js/core/convert.js', 'js/core/codegen.js'].forEach(load);
const G = globalThis.JTCore.codegen;

const parse = (src) => ({
  props: [...src.matchAll(/^\s+let\s+(\S+)\s*:/gm)].map((m) => m[1]),
  cases: [...src.matchAll(/^\s+case\s+(\S+)\s*=\s*"([^"]*)"$/gm)].map((m) => ({ name: m[1], key: m[2] })),
  hasKeys: /enum CodingKeys/.test(src),
});

const cases = [
  ['主用例 class/userName/default_value', { class: 1, userName: 2, default_value: 3 }],
  ['无映射 userName/age', { userName: 1, age: 2 }],
  ['边界 a_b/aB 冲突', { a_b: 1, aB: 2 }],
  ['边界 中文键（名==键）', { '中文': 1 }],
  ['单个保留字 class', { class: 1 }],
];

let pass = 0, fail = 0;
const ck = (name, cond, detail) => { if (cond) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✘', name, '→', detail); } };

for (const [title, obj] of cases) {
  const src = G.toSwift(obj, { rootName: 'Root', optionalMode: 'none' });
  console.log(`\n===== ${title} =====`);
  console.log(`输入: ${JSON.stringify(obj)}`);
  console.log('生成:\n' + src);
  const p = parse(src);
  const map = {}; p.cases.forEach((c) => { map[c.name] = c.key; });
  console.log(`属性(${p.props.length}): ${p.props.join(', ')}`);
  console.log(`CodingKeys(${p.cases.length}): ${JSON.stringify(map)}  hasKeys=${p.hasKeys}`);
  if (title.includes('主用例')) {
    ck('case 数 == 属性数 == 3', p.cases.length === 3 && p.props.length === 3, JSON.stringify(p));
    ck('class_1 ↔ "class"', map['class_1'] === 'class', JSON.stringify(map));
    ck('userName ↔ "userName"（未改名也显式写出）', map['userName'] === 'userName', JSON.stringify(map));
    ck('defaultValue ↔ "default_value"', map['defaultValue'] === 'default_value', JSON.stringify(map));
    ck('每个属性都被某 case 覆盖', p.props.every((x) => p.cases.some((c) => c.name === x)), JSON.stringify(p));
  }
  if (title.includes('无映射 userName/age')) ck('完全不生成 CodingKeys', !p.hasKeys, src);
  if (title.includes('a_b/aB')) {
    const oneToOne = p.cases.length === p.props.length && p.cases.every((c) => p.props.includes(c.name)) && p.props.every((x) => p.cases.some((c) => c.name === x));
    ck('冲突重命名后 CodingKeys↔属性一一对应', src.length > 0 && oneToOne, JSON.stringify(p));
  }
  if (title.includes('中文')) ck('名==键 → 不生成 CodingKeys 且属性正常', !p.hasKeys && p.props.length === 1, src);
}

/* R3 映射回归：按每门语言自身的 RESERVED 表判断“无裸保留字标识符” */
console.log('\n===== R3 沉淀回归：各语言保留字均被规避（按各自 RESERVED 表） =====');
const RES = G.reservedWords || {};
const GEN = [
  ['TypeScript', 'ts', 'toTypeScript', /^\s+([A-Za-z_$][\w$]*)\??\s*:/gm],
  ['Java', 'java', 'toJava', /private\s+[\w<>\[\]]+\s+([A-Za-z_$][\w$]*)\s*;/gm],
  ['Kotlin', 'kotlin', 'toKotlin', /\bval\s+([A-Za-z_$][\w$]*)\s*:/gm],
  ['Go', 'go', 'toGo', /^\t([A-Z][\w]*)\s+/gm],
  ['Python', 'python', 'toPython', /^\s{4}([A-Za-z_$][\w$]*)\s*:/gm],
  ['CSharp', 'csharp', 'toCSharp', /public\s+[\w<>\[\].?]+\s+([A-Za-z_$][\w$]*)\s*\{/gm],
  ['Rust', 'rust', 'toRust', /^\s+pub\s+([A-Za-z_$][\w$]*)\s*:/gm],
  ['Swift', 'swift', 'toSwift', /^\s+let\s+([A-Za-z_$][\w$]*)\s*:/gm],
  ['Dart', 'dart', 'toDart', /^\s+final\s+\S+\s+([A-Za-z_$][\w$]*)\s*;/gm],
  ['Php', 'php', 'toPhp', /public\s+\S+\s+\$([A-Za-z_][\w$]*)\s*;/gm],
  ['DDL', 'sql', 'toDDL', /^\s+`([^`]+)`\s/gm],
];
ck('codegen 暴露 11 个语言生成器', GEN.every(([, , fn]) => typeof G[fn] === 'function'), GEN.map(([l]) => l).join(','));
const ALLRES = { class: 1, int: 2, public: 3, default: 4, func: 5, if: 6, for: 7, return: 8, var: 9, fun: 10, type: 11, interface: 12 };
for (const [label, lang, fn, re] of GEN) {
  const out = G[fn](ALLRES, { rootName: 'Root', optionalMode: 'none' });
  const names = [...out.matchAll(re)].map((m) => m[1]).filter((n) => n !== 'Root');
  const resSet = new Set((RES[lang] || []).map(String));
  const bare = lang === 'sql' ? [] : names.filter((n) => resSet.has(n)); // DDL 反引号包裹合法
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  console.log(`  ${label}: 标识符 ${names.length} 个, 裸保留字 ${bare.length}, 重复 ${dup.length}`);
  ck(`${label}: 无裸保留字/无重复（≥10 标识符）`, names.length >= 10 && bare.length === 0 && dup.length === 0, JSON.stringify({ bare, dup, names }));
}

console.log(`\n===== C2 汇总：通过 ${pass} / 失败 ${fail} =====`);
process.exit(fail === 0 ? 0 : 1);
