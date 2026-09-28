import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'msedge', headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on('pageerror', e => errors.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.addInitScript(() => {
  window.__clipboard = [];
  navigator.clipboard.writeText = (t) => { window.__clipboard.push(t); return Promise.resolve(); };
});
await p.goto('http://127.0.0.1:8878/index.html', { waitUntil: 'load' });
await p.waitForTimeout(1200);
const R = [];
const ok = (n, v, d) => R.push((v ? 'PASS ' : 'FAIL ') + n + (v || !d ? '' : ' — ' + d));

// 键值行（data-i=2: "id": 1,）
const kv = await p.evaluate(() => {
  document.querySelector('.jt-cline[data-i="2"]').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  const bar = document.querySelector('.jt-copybar');
  return { vis: bar.style.display !== 'none', btns: [...bar.querySelectorAll('.jt-copybar-btn')].map(x => x.textContent) };
});
ok('键值行出现复制键+复制值', kv.vis && kv.btns.includes('复制键') && kv.btns.includes('复制值'), JSON.stringify(kv.btns));

await p.evaluate(() => {
  const bar = document.querySelector('.jt-copybar');
  [...bar.querySelectorAll('.jt-copybar-btn')].find(x => x.textContent === '复制键').click();
});
await p.waitForTimeout(80);
const key = await p.evaluate(() => window.__clipboard[window.__clipboard.length - 1]);
ok('复制键 = id', key === 'id', key);

await p.evaluate(() => {
  document.querySelector('.jt-cline[data-i="2"]').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  [...document.querySelector('.jt-copybar').querySelectorAll('.jt-copybar-btn')].find(x => x.textContent === '复制值').click();
});
await p.waitForTimeout(80);
const val = await p.evaluate(() => window.__clipboard[window.__clipboard.length - 1]);
ok('复制值 = 1', val === 1 || val === '1', JSON.stringify(val));

// 字符串值行（data-i=3: "name": "张三",）→ 复制值应去掉引号
await p.evaluate(() => {
  document.querySelector('.jt-cline[data-i="3"]').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  [...document.querySelector('.jt-copybar').querySelectorAll('.jt-copybar-btn')].find(x => x.textContent === '复制值').click();
});
await p.waitForTimeout(80);
const sval = await p.evaluate(() => window.__clipboard[window.__clipboard.length - 1]);
ok('字符串值去引号复制', sval === '张三', JSON.stringify(sval));

// 对象复制（折叠状态下 hover data-i=1 → 复制对象，应等于源码切片）
await p.click('.jt-fold[data-fold="1"]');
await p.waitForTimeout(120);
await p.evaluate(() => {
  document.querySelector('.jt-cline[data-i="1"]').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  [...document.querySelector('.jt-copybar').querySelectorAll('.jt-copybar-btn')].find(x => x.textContent === '复制对象').click();
});
await p.waitForTimeout(80);
const objText = await p.evaluate(() => window.__clipboard[window.__clipboard.length - 1]);
const objOk = await p.evaluate(t => { try { const v = JSON.parse(t); return v && v.id === 1 && v.name === '张三'; } catch (e) { return false; } }, objText);
ok('复制对象 = 合法 JSON 且内容正确', objOk, (objText || '').slice(0, 40));
await p.evaluate(() => document.querySelector('.jt-fold[data-fold="1"]').click()); // 复原
await p.waitForTimeout(100);

// 嵌套数组项复制（tags 内 "admin", 行 = data-i=8）
const arrItem = await p.evaluate(() => {
  document.querySelector('.jt-cline[data-i="8"]').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  const bar = document.querySelector('.jt-copybar');
  return { vis: bar.style.display !== 'none', btns: [...bar.querySelectorAll('.jt-copybar-btn')].map(x => x.textContent) };
});
ok('数组标量项出现复制值', arrItem.vis && arrItem.btns.includes('复制值'), JSON.stringify(arrItem.btns));

// 收尾括号行无复制条（data-i=17 为第一个用户对象的收尾 "},"行 → 实际测试找纯括号行）
const closer = await p.evaluate(() => {
  const lines = [...document.querySelectorAll('.jt-cline')];
  const t = lines[17].textContent.trim();
  const isPure = /^[}\])],?$/.test(t);
  lines[17].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  const bar = document.querySelector('.jt-copybar');
  return { isPure, shown: bar.style.display !== 'none' };
});
ok('收尾括号行不显示复制条', !closer.shown && closer.isPure, JSON.stringify(closer));

// 非 JSON 输出：切到 YAML 工具，应无折叠箭头
await p.evaluate(() => { window.JT.app.selectTool('convert-yaml'); });
await p.waitForTimeout(400);
const yamlFold = await p.evaluate(() => document.querySelectorAll('.jt-fold[data-fold]').length);
ok('YAML 输出无折叠箭头', yamlFold === 0, '箭头=' + yamlFold);

ok('全程 0 报错', errors.length === 0, errors.join(' | '));
console.log(R.join('\n'));
console.log('=== 通过 ' + R.filter(x => x.indexOf('PASS') === 0).length + ' / 失败 ' + R.filter(x => x.indexOf('FAIL') === 0).length + ' ===');
await b.close().catch(() => {});
process.exit(0);
