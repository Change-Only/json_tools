// hover-check.mjs — 验证悬浮复制条 hover 修复 + 折叠箭头增强，并产出 README 截图
import fs from 'node:fs';
import path from 'node:path';
const osTmp = process.env.TEMP || '/tmp';
const { chromium } = await import('file:///' + osTmp.replace(/\\/g, '/') + '/jtb-pw/node_modules/playwright-core/index.mjs');

const BASE = process.argv[2] || 'http://127.0.0.1:8898';
const SHOTS = process.argv[3] || 'docs/screenshots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const rec = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForSelector('.jt-panel-view .jt-cline', { timeout: 10000 });
await sleep(400);

// --- 1. hover 键值行 → 复制条出现 ---
const lines = page.locator('.jt-panel-view .jt-cline');
const n = await lines.count();
rec('输出折叠视图渲染行数', n > 3, 'lines=' + n);

// 找一个带「复制值」的键值行（第 2 行通常是键值行）
let targetIdx = -1;
for (let i = 0; i < Math.min(n, 10); i++) {
  const t = (await lines.nth(i).textContent()) || '';
  if (/:\s*"/.test(t) && !/[{\[]\s*$/.test(t.trim())) { targetIdx = i; break; }
}
rec('找到键值行', targetIdx >= 0, 'idx=' + targetIdx);

const line = lines.nth(targetIdx);
await line.hover();
await sleep(200);
const barVisible1 = await page.locator('.jt-panel-view .jt-copybar').isVisible();
rec('悬停行后复制条出现', barVisible1);

// --- 2. 核心修复断言：鼠标移到按钮上，按钮必须仍可见（修复前会消失） ---
const btn = page.locator('.jt-panel-view .jt-copybar-btn', { hasText: '复制值' }).first();
const bb = await btn.boundingBox();
rec('复制按钮有位置', !!bb, JSON.stringify(bb));
if (bb) {
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 6 });
  await sleep(250);
  const stillVisible = await btn.isVisible();
  const inHover = await page.evaluate(() => {
    const hs = document.querySelectorAll(':hover');
    return Array.from(hs).some((el) => el.classList && el.classList.contains('jt-copybar-btn'));
  });
  rec('鼠标移到按钮上按钮不消失（核心修复）', stillVisible, 'visible=' + stillVisible);
  rec('按钮处于 :hover 状态', inHover);
  await page.screenshot({ path: path.join(SHOTS, '02-fold-copy-hover.png') });

  // --- 3. 点击按钮 → 剪贴板内容 === 行内值 ---
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await btn.click();
  await sleep(250);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const lineText = await line.textContent();
  // 行文本形如 "name": "张三" — 复制值应为去引号去转义的值
  const m = lineText.match(/:\s*("(?:[^"\\]|\\.)*")/);
  let expectVal = m ? m[1] : null;
  let ok = false;
  if (expectVal != null) {
    try { expectVal = JSON.parse(expectVal); ok = clip === expectVal; } catch { ok = false; }
  }
  rec('点击「复制值」写入剪贴板正确', ok, 'clip=' + JSON.stringify(clip) + ' expect=' + JSON.stringify(expectVal));
}

// --- 4. 对象块首行：复制对象 → 合法 JSON ---
let blockIdx = -1;
for (let i = 0; i < Math.min(n, 6); i++) {
  const t = ((await lines.nth(i).textContent()) || '').trim();
  if (/[{\[]\s*$/.test(t)) { blockIdx = i; break; }
}
if (blockIdx >= 0) {
  await lines.nth(blockIdx).hover();
  await sleep(200);
  const btnObj = page.locator('.jt-panel-view .jt-copybar-btn', { hasText: /复制对象|复制数组/ }).first();
  if (await btnObj.isVisible()) {
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await btnObj.click();
    await sleep(250);
    const clip2 = await page.evaluate(() => navigator.clipboard.readText());
    let valid = false;
    try { JSON.parse(clip2); valid = true; } catch {}
    rec('「复制对象」结果为合法 JSON', valid && clip2.trim().length > 2, 'len=' + clip2.length);
  } else {
    rec('「复制对象」按钮出现', false);
  }
}

// --- 5. 折叠箭头增强：点击折叠 → 行隐藏 + ▸ 高亮类 ---
const arrow = page.locator('.jt-panel-view .jt-gutter .jt-fold[data-fold]').first();
const arrowBox = await arrow.boundingBox();
if (arrowBox) {
  await arrow.click();
  await sleep(200);
  const collapsedCls = await arrow.evaluate((el) => el.className);
  const hiddenCount = await page.locator('.jt-panel-view .jt-cline-hidden').count();
  rec('点击箭头可折叠', hiddenCount > 0, 'hidden=' + hiddenCount + ' cls=' + collapsedCls);
  rec('折叠态箭头带高亮类', /jt-fold-collapsed/.test(collapsedCls));
  await page.screenshot({ path: path.join(SHOTS, '03-fold-collapsed.png') });
  await arrow.click(); // 展开
  await sleep(150);
} else {
  rec('折叠箭头存在', false);
}

// --- 6. README 截图 ---
await page.screenshot({ path: path.join(SHOTS, '01-home-light.png') });
await page.evaluate(() => document.querySelector('.jt-top-actions .jt-icon-btn[title="切换主题"]').click());
await sleep(250);
await page.screenshot({ path: path.join(SHOTS, '04-home-dark.png') });
await page.evaluate(() => document.querySelector('.jt-top-actions .jt-icon-btn[title="切换主题"]').click());
// 树形视图
await page.evaluate(() => document.querySelector('.jt-nav-item[data-id="query-jsonpath"]').click());
await sleep(300);
await page.evaluate(() => document.querySelector('.jt-th-actions .jt-btn-primary').click());
await sleep(500);
await page.screenshot({ path: path.join(SHOTS, '05-tree-view.png') });

rec('console error 数为 0', errors.length === 0, errors.slice(0, 3).join(' ; '));

fs.writeFileSync('.qa/hover-results.json', JSON.stringify(results, null, 2));
const fails = results.filter((r) => !r.pass).length;
console.log('TOTAL ' + results.length + ' FAIL ' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
