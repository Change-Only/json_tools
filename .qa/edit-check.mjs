// edit-check.mjs — 验证「输出框内容可编辑」：进入编辑态 / 编辑同步 / 退出渲染 / 非法内容降级
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = await import('file:///' + (process.env.TEMP || '/tmp').replace(/\\/g, '/') + '/jtb-pw/node_modules/playwright-core/index.mjs');

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

const outText = '.jt-panel-view .jt-textarea';
const outCode = '.jt-panel-view .jt-code';
const segEdit = '.jt-panel-view .jt-viewtoggle .jt-seg-edit';

// --- 1. 输出面板存在「编辑」按钮 ---
rec('输出面板有「编辑」按钮', await page.locator(segEdit).count() === 1,
  'text=' + (await page.locator(segEdit).textContent().catch(() => 'n/a')));
rec('初始 textarea 隐藏', !(await page.locator(outText).isVisible()));

// --- 2. 进入编辑态 ---
await page.locator(segEdit).click();
await sleep(250);
rec('点击后 textarea 可见可编辑', await page.locator(outText).isVisible());
rec('进入编辑态后代码视图隐藏', !(await page.locator(outCode).isVisible()));
rec('按钮变为「查看」', (await page.locator(segEdit).textContent()).trim() === '查看');
const treeBtn = page.locator('.jt-panel-view .jt-viewtoggle .jt-seg:not(.jt-seg-edit)', { hasText: '树形' });
rec('编辑态下树形按钮禁用', await treeBtn.isDisabled());
rec('面板带编辑态标识', (await page.locator('.jt-panel-view').getAttribute('class')).includes('jt-panel-editing'));
rec('编辑态下不出现悬浮复制条', !(await page.locator('.jt-panel-view .jt-copybar').isVisible()));

// --- 3. 真实输入（fill 会走 input 事件；不可编辑时 fill 会失败） ---
const NEW = '{\n  "edited": true,\n  "n": 1,\n  "list": [1, 2, 3]\n}';
let fillOk = true;
try { await page.fill(outText, NEW); } catch (e) { fillOk = false; }
rec('可直接在输出框输入内容', fillOk);
await sleep(200);
const stats = await page.locator('.jt-panel-view .jt-panel-stats').textContent();
rec('编辑后行数统计已更新', /5\s*行/.test(stats), stats);

// 编辑内容同步到 state.output → 「复制输出」应按编辑后内容写入剪贴板
await page.evaluate(() => navigator.clipboard.writeText(''));
await page.locator('.jt-panel-view .jt-panel-actions button[title^="复制输出"]').click();
await sleep(250);
const clipEdited = await page.evaluate(() => navigator.clipboard.readText());
// Windows 剪贴板会把换行规范化为 CRLF，比较时统一
const norm = (s) => String(s).replace(/\r\n/g, '\n');
rec('编辑内容已同步（复制输出=编辑后文本）', norm(clipEdited) === norm(NEW), 'clip=' + JSON.stringify(clipEdited.slice(0, 30)));

await page.screenshot({ path: path.join(SHOTS, '06-output-editing.png') });

// --- 4. 退出编辑态 → 按新内容重新渲染 ---
await page.locator(segEdit).click();
await sleep(300);
rec('退出编辑后代码视图恢复', await page.locator(outCode).isVisible());
rec('退出编辑后 textarea 隐藏', !(await page.locator(outText).isVisible()));
const rendered = await page.locator(outCode).textContent();
rec('重新渲染内容为编辑后文本', rendered.includes('"edited"'), 'sample=' + JSON.stringify(rendered.slice(0, 40)));
const lineCount = await page.locator('.jt-panel-view .jt-cline').count();
rec('新内容恢复折叠文本视图', lineCount === 5, 'lines=' + lineCount);
const title = await page.locator('.jt-panel-view .jt-badge').textContent();
rec('标题恢复为非编辑态', !title.includes('编辑中'), title);

// --- 5. 编辑为非法 JSON → 退出后降级（不报错、不崩溃） ---
await page.locator(segEdit).click();
await sleep(200);
await page.fill(outText, '{"broken": ');
await page.locator(segEdit).click();
await sleep(300);
const badLines = await page.locator('.jt-panel-view .jt-cline').count();
const badText = await page.locator(outCode).textContent();
rec('非法内容退出编辑不崩溃且保留文本', badText.includes('broken') && badLines === 0, 'lines=' + badLines);

// --- 6. 编辑态下点「树形」→ 编辑内容先提交，不被丢弃 ---
await page.locator('.jt-panel-view .jt-panel-actions button[title^="清空输出"]').click();
await sleep(150);
await page.locator('.jt-nav-item[data-id="format-pretty"]').click();
await sleep(300);
await page.evaluate(() => document.querySelector('.jt-th-actions .jt-btn-primary').click());
await sleep(400);
await page.locator(segEdit).click();
await sleep(200);
const T2 = '{"committed": 42}';
await page.fill(outText, T2);
await page.evaluate(() => {
  const btns = document.querySelectorAll('.jt-panel-view .jt-viewtoggle .jt-seg');
  for (const b of btns) if (b.textContent.trim() === '树形' && !b.disabled) b.click();
});
await sleep(300);
await page.evaluate(() => navigator.clipboard.writeText(''));
await page.locator('.jt-panel-view .jt-panel-actions button[title^="复制输出"]').click();
await sleep(250);
const clipAfterTree = await page.evaluate(() => navigator.clipboard.readText());
rec('切树形前编辑内容已提交不丢失', clipAfterTree === T2, 'clip=' + JSON.stringify(clipAfterTree));

// --- 7. 重新执行 → 退出编辑态 ---
await page.locator('.jt-panel-view .jt-viewtoggle .jt-seg', { hasText: '文本' }).click();
await sleep(250);
await page.locator(segEdit).click();
await sleep(200);
const editingBefore = (await page.locator('.jt-panel-view').getAttribute('class')).includes('jt-panel-editing');
await page.keyboard.press('Control+Enter');
await sleep(400);
const editingAfter = (await page.locator('.jt-panel-view').getAttribute('class')).includes('jt-panel-editing');
rec('重新执行后自动退出编辑态', editingBefore && !editingAfter, 'before=' + editingBefore + ' after=' + editingAfter);

rec('console error 数为 0', errors.length === 0, errors.slice(0, 3).join(' ; '));

fs.writeFileSync('.qa/edit-results.json', JSON.stringify(results, null, 2));
const fails = results.filter((r) => !r.pass).length;
console.log('TOTAL ' + results.length + ' FAIL ' + fails);
await browser.close();
process.exit(fails ? 1 : 0);
