/* eslint-disable */
/**
 * browser-check.mjs —— JSON 工具箱 · 真实浏览器端到端测试（Round 3 复验，含 R1/R2 用例 + R3 树/滚动/保留字/分隔符专项）
 * 运行（需先起服务）：node .qa/browser-check.mjs [baseURL]
 * 回归结果写入 .qa/browser-results.json；R2-flow 截图写入 .qa/shots/round2/，R3 专项截图写入 .qa/shots/round3/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots', 'round2');
fs.mkdirSync(SHOTS, { recursive: true });

const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const PW = path.join(ROOT, '.build', 'node_modules', 'playwright-core', 'index.mjs');

const results = [];
function rec(name, pass, detail) { results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  ::  ' + String(detail).slice(0, 260) : '')); }

const pw = await import(pathToFileURL(PW).href);
const { chromium } = pw;
const browser = await chromium.launch({ channel: 'msedge', headless: true });

/* ============================ 主页面（http） ============================ */
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleMsgs = [];
const badResponses = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push({ type: m.type(), text: m.text(), loc: m.location() }); });
page.on('pageerror', (e) => consoleMsgs.push({ type: 'pageerror', text: e.message, stack: e.stack }));
page.on('response', (r) => { if (r.status() >= 400) badResponses.push({ status: r.status(), url: r.url() }); });
page.on('requestfailed', (r) => badResponses.push({ failed: true, url: r.url(), err: r.failure() && r.failure().errorText }));

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(600);
const shot = (n) => page.screenshot({ path: path.join(SHOTS, n) });

/* --- 首屏 --- */
const catCount = await page.locator('.jt-nav-group').count();
rec('首屏左侧分类分组可见(6)', catCount === 6, 'group=' + catCount);
const navCount = await page.locator('.jt-nav-item').count();
rec('首屏工具项总数 = 68', navCount === 68, 'nav=' + navCount);
const firstOut = await page.evaluate(() => { const v = document.querySelector('section.jt-panel-view .jt-code'); return v ? v.textContent : ''; });
let firstParseable = false; try { JSON.parse(firstOut); firstParseable = true; } catch (e) {}
rec('首屏输入自动载入示例并已美化', firstOut.trim().length > 0 && firstParseable, 'outLen=' + firstOut.length + ' parse=' + firstParseable);
await shot('01-首屏.png');

/* --- 遍历 68 工具 --- */
const toolIds = await page.evaluate(() => window.JT.registry.tools.map((t) => t.id));
const toolReport = [];
const emptyTools = [];
for (const id of toolIds) {
  try {
    await page.evaluate((tid) => { const el = document.querySelector('.jt-nav-item[data-id="' + tid + '"]'); if (el) el.click(); }, id);
    await page.waitForTimeout(35);
    await page.evaluate(() => { const b = document.querySelector('.jt-th-actions .jt-btn-primary'); if (b) b.click(); });
    await page.waitForTimeout(85);
    const info = await page.evaluate(() => {
      const panel = document.querySelector('section.jt-panel-view');
      const code = panel.querySelector('.jt-code');
      const errbar = panel.querySelector('.jt-errbar');
      const errVisible = errbar && errbar.style.display !== 'none';
      const custom = panel.querySelector('.jt-tree, .jt-diff');
      const outLen = code ? code.textContent.length : 0;
      const meaningful = code ? code.textContent.trim().length > 0 : false;
      return { outLen, errVisible, hasCustom: !!custom, err: errVisible && !meaningful && !custom, status: (document.querySelector('.jt-status-msg') || {}).textContent || '' };
    });
    toolReport.push({ id, ...info });
    if (info.outLen === 0 && !info.err && !info.hasCustom) emptyTools.push(id);
  } catch (e) { toolReport.push({ id, fatal: e.message }); emptyTools.push(id + '(异常)'); }
}
rec('68 工具逐个执行：无空白输出', emptyTools.length === 0, emptyTools.join(',') || 'all-ok');
rec('68 工具逐个执行：真实报错工具数已记录', true, 'realErr=' + toolReport.filter((t) => t.err).length);
const pageErrDuringTools = consoleMsgs.filter((m) => m.type === 'pageerror').length;
rec('68 工具遍历期间无 pageerror', pageErrDuringTools === 0, 'pageerror=' + pageErrDuringTools);

/* --- 深色主题 --- */
await page.evaluate(() => { window.JT.storage.setTheme('light'); document.documentElement.setAttribute('data-theme', 'light'); });
const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
await page.evaluate(() => { document.querySelector('.jt-top-actions .jt-icon-btn[title="切换主题"]').click(); });
await page.waitForTimeout(250);
const darkTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
rec('切换深色主题：data-theme=dark', darkTheme === 'dark', 'theme=' + darkTheme);
rec('切换深色主题：背景色确实变化', lightBg !== darkBg, 'light=' + lightBg + ' dark=' + darkBg);
await shot('04-深色主题.png');
await page.evaluate(() => { document.querySelector('.jt-top-actions .jt-icon-btn[title="切换主题"]').click(); }); // 回浅色

/* --- P1：四个弹窗入口 --- */
async function openModal(title) {
  const before = consoleMsgs.filter((m) => m.type === 'pageerror').length;
  await page.evaluate((t) => { document.querySelector('.jt-top-actions .jt-icon-btn[title="' + t + '"]').click(); }, title);
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => {
    const m = document.querySelector('.jt-modal');
    return { visible: !!(m && m.offsetParent !== null), title: m ? m.querySelector('.jt-modal-title').textContent : '' };
  });
  const after = consoleMsgs.filter((m) => m.type === 'pageerror').length;
  return { ...st, threw: after > before };
}
async function escClose() { await page.keyboard.press('Escape'); await page.waitForTimeout(300); return await page.evaluate(() => !document.querySelector('.jt-modal')); }

const mAbout = await openModal('关于');
rec('P1 关于弹窗可打开且标题正确', mAbout.visible && !mAbout.threw && mAbout.title === '关于 JSON 工具箱', JSON.stringify(mAbout));
await shot('02-关于弹窗.png');
rec('P1 关于弹窗 Esc 可关闭', await escClose(), 'ok');

const mKeys = await openModal('快捷键');
const keyRows = await page.evaluate(() => document.querySelectorAll('.jt-keys-row').length);
rec('P1 快捷键弹窗可打开且含条目', mKeys.visible && !mKeys.threw && keyRows > 0, JSON.stringify({ ...mKeys, rows: keyRows }));
rec('P1 快捷键弹窗 Esc 可关闭', await escClose(), 'ok');

const mEx = await openModal('示例库');
rec('P1 示例库弹窗可打开', mEx.visible && !mEx.threw, JSON.stringify(mEx));
rec('P1 示例库弹窗 Esc 可关闭', await escClose(), 'ok');

const mHist = await openModal('历史记录');
const histRows = await page.evaluate(() => document.querySelectorAll('.jt-hist-row').length);
rec('P1 历史记录弹窗可打开且含记录', mHist.visible && !mHist.threw && histRows > 0, JSON.stringify({ ...mHist, rows: histRows }));
await shot('03-历史记录弹窗.png');
rec('P1 历史记录弹窗 Esc 可关闭', await escClose(), 'ok');

/* --- P1：输入区「载入示例」按钮 --- */
const exLoad = await page.evaluate(async () => {
  const before = document.querySelector('section.jt-panel-edit textarea').value;
  const btns = Array.from(document.querySelectorAll('section.jt-panel-edit .jt-panel-actions button'));
  const b = btns.find((x) => (x.title || '').includes('载入示例'));
  if (!b) return { clicked: false };
  b.click();
  await new Promise((r) => setTimeout(r, 300));
  const modalOpen = !!document.querySelector('.jt-modal');
  const items = Array.from(document.querySelectorAll('.jt-example'));
  if (items[1]) items[1].click();           // 点第 2 个示例
  await new Promise((r) => setTimeout(r, 300));
  const after = document.querySelector('section.jt-panel-edit textarea').value;
  return { clicked: true, modalOpen, changed: after !== before, len: after.length };
});
rec('P1 输入区「载入示例」可用且载入后输入变化', exLoad.clicked && exLoad.modalOpen && exLoad.changed, JSON.stringify(exLoad));

/* --- P2-1：错误条清除 --- */
const err1 = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.jt-nav-item[data-id="convert-toml"]').click();
  await sleep(60);
  const ta = document.querySelector('section.jt-panel-edit textarea');
  ta.value = '[1,2,3]'; ta.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('.jt-th-actions .jt-btn-primary').click();
  await sleep(150);
  const panel = document.querySelector('section.jt-panel-view');
  return { afterErr: panel.querySelector('.jt-errbar').style.display !== 'none' };
});
await page.evaluate(async () => {
  document.querySelector('.jt-nav-item[data-id="format-pretty"]').click();
  await new Promise((r) => setTimeout(r, 200));
});
const inErrVisible = await page.locator('section.jt-panel-edit .jt-errbar').isVisible().catch(() => false);
const outErrVisible = await page.locator('section.jt-panel-view .jt-errbar').isVisible().catch(() => false);
rec('P2-1 报错后执行成功工具：两侧错误条均不可见', err1.afterErr && !inErrVisible && !outErrVisible, JSON.stringify({ afterErr: err1.afterErr, inErrVisible, outErrVisible }));

/* --- P2-2 / P3-1：展平 → 还原 完整 UI 流程 --- */
const flatFlow = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setInput = (v) => { const ta = document.querySelector('section.jt-panel-edit textarea'); ta.value = v; ta.dispatchEvent(new Event('input', { bubbles: true })); };
  const runBtn = () => document.querySelector('.jt-th-actions .jt-btn-primary').click();
  const out = () => { const c = document.querySelector('section.jt-panel-view .jt-code'); return c ? c.textContent : ''; };
  document.querySelector('.jt-nav-item[data-id="format-flatten"]').click();
  await sleep(60);
  const original = '{"a":{"b":1},"list":[10,20],"nested":{"arr":[{"x":1},{"x":2}]}}';
  setInput(original);
  // 方向=展平 + 勾选展开数组
  const selects = document.querySelectorAll('.jt-params select');
  // 参数顺序：direction, separator(text), arrays(checkbox)
  if (selects[0]) { selects[0].value = 'flatten'; selects[0].dispatchEvent(new Event('change', { bubbles: true })); }
  const chk = document.querySelectorAll('.jt-params input[type=checkbox]')[0];
  if (chk && !chk.checked) { chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true })); }
  runBtn(); await sleep(200);
  const flatOut = out();
  // 回灌为输入并切到还原
  setInput(flatOut.trim());
  if (selects[0]) { selects[0].value = 'unflatten'; selects[0].dispatchEvent(new Event('change', { bubbles: true })); }
  runBtn(); await sleep(200);
  const backOut = out();
  let eq = false; try { eq = JSON.stringify(JSON.parse(backOut)) === JSON.stringify(JSON.parse(original)); } catch (e) {}
  return { flatOut, backOut, eq, hasCanonical: /list\[0\]/.test(flatOut), hasLegacy: /list\.\[0\]/.test(flatOut) };
});
rec('P3-1 展平输出使用规范 a[0] 形式', flatFlow.hasCanonical && !flatFlow.hasLegacy, 'flat=' + JSON.stringify(flatFlow.flatOut).slice(0, 160));
rec('P2-2/P3-1 展平→还原 UI 全流程深等价', flatFlow.eq, 'back=' + JSON.stringify(flatFlow.backOut).slice(0, 160));

/* --- P3-4：文本/树形切换 --- */
// ① 控件出现
const toggleInfo = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.jt-nav-item[data-id="format-pretty"]').click();
  await sleep(220);
  const vt = document.querySelector('section.jt-panel-view .jt-viewtoggle');
  const segs = vt ? Array.from(vt.querySelectorAll('.jt-seg')) : [];
  return { visible: !!(vt && vt.offsetParent !== null && vt.style.display !== 'none'), labels: segs.map((s) => s.textContent), treeDisabled: segs[1] ? segs[1].disabled : null };
});
rec('P3-4 输出面板出现「文本/树形」切换控件', toggleInfo.visible && toggleInfo.labels.join('/') === '文本/树形', JSON.stringify(toggleInfo));

// ② 切树形 → 渲染 + 折叠
const treeInfo = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const treeBtn = Array.from(document.querySelectorAll('section.jt-panel-view .jt-viewtoggle .jt-seg')).find((b) => b.textContent === '树形');
  treeBtn.click(); await sleep(250);
  const tree = document.querySelector('section.jt-panel-view .jt-tree');
  const rootRow = tree ? tree.querySelector('.jt-trow') : null;
  const childBoxBefore = tree ? tree.querySelector('.jt-tchildren') : null;
  const before = childBoxBefore ? childBoxBefore.style.display : 'none';
  if (rootRow) { rootRow.click(); await sleep(150); }
  const childBox = tree ? tree.querySelector('.jt-tchildren') : null;
  const afterExpand = childBox ? childBox.style.display : null;
  const childCount = tree ? tree.querySelectorAll('.jt-tchildren .jt-tnode').length : 0;
  if (rootRow) { rootRow.click(); await sleep(150); }
  const afterCollapse = tree ? tree.querySelector('.jt-tchildren').style.display : null;
  return { hasTree: !!tree, before, afterExpand, afterCollapse, childCount };
});
// R3 变更：树形根节点改为默认展开（原 R2 断言假设"默认折叠"）。改为断言"渲染出子节点且点击可切换可见性"。
rec('P3-4 点「树形」渲染树节点且可折叠/展开', treeInfo.hasTree && treeInfo.childCount > 0 && treeInfo.before !== treeInfo.afterExpand && treeInfo.afterExpand !== treeInfo.afterCollapse, JSON.stringify(treeInfo));
await shot('05-树形视图.png');
const backText = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = Array.from(document.querySelectorAll('section.jt-panel-view .jt-viewtoggle .jt-seg')).find((b) => b.textContent === '文本');
  t.click(); await sleep(180);
  return { tree: !!document.querySelector('section.jt-panel-view .jt-tree'), code: (document.querySelector('section.jt-panel-view .jt-code') || {}).textContent.length || 0 };
});
rec('P3-4 切回「文本」恢复正常', !backText.tree && backText.code > 0, JSON.stringify(backText));

// ③ 非 JSON 结果 → 置灰
const disabledInfo = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.jt-nav-item[data-id="codec-base64"]').click();
  await sleep(220);
  const vt = document.querySelector('section.jt-panel-view .jt-viewtoggle');
  const segs = vt ? Array.from(vt.querySelectorAll('.jt-seg')) : [];
  const treeBtn = segs[1];
  return { treeDisabled: treeBtn ? treeBtn.disabled : null, cls: treeBtn ? treeBtn.className : '', tip: treeBtn ? treeBtn.title : '' };
});
rec('P3-4 非 JSON 结果：树形切换置灰且有 tooltip', disabledInfo.treeDisabled === true && /jt-seg-disabled/.test(disabledInfo.cls) && /无法使用树形/.test(disabledInfo.tip), JSON.stringify(disabledInfo));
await shot('06-非JSON结果切换置灰.png');

// ④ query-jsonpath 默认树形 & ⑤ 切换工具后 viewMode 重置
const defaultTree = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.jt-nav-item[data-id="query-jsonpath"]').click();
  await sleep(250);
  const hasTree = !!document.querySelector('section.jt-panel-view .jt-tree');
  const activeSeg = (document.querySelector('section.jt-panel-view .jt-viewtoggle .jt-seg.active') || {}).textContent || '';
  // 切走再回来，验证 viewMode 重置
  document.querySelector('.jt-nav-item[data-id="format-pretty"]').click();
  await sleep(220);
  const afterSwitchTree = !!document.querySelector('section.jt-panel-view .jt-tree');
  const afterSwitchActive = (document.querySelector('section.jt-panel-view .jt-viewtoggle .jt-seg.active') || {}).textContent || '';
  return { hasTree, activeSeg, afterSwitchTree, afterSwitchActive };
});
rec('P3-4 query-jsonpath 默认树形', defaultTree.hasTree && defaultTree.activeSeg === '树形', JSON.stringify(defaultTree));
rec('P3-4 切换工具后 viewMode 重置为自动(text for 美化)', !defaultTree.afterSwitchTree && defaultTree.afterSwitchActive === '文本', JSON.stringify({ afterSwitchTree: defaultTree.afterSwitchTree, afterSwitchActive: defaultTree.afterSwitchActive }));

/* --- P3-5：连续点复制 6 次 → 同屏 toast ≤ 3 --- */
const copyToasts = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.jt-nav-item[data-id="format-pretty"]').click();
  await sleep(200);
  const btns = Array.from(document.querySelectorAll('section.jt-panel-view .jt-panel-actions button'));
  const copy = btns.find((b) => (b.title || '').includes('复制'));
  for (let i = 0; i < 6; i++) { copy.click(); await sleep(20); }
  await sleep(200);
  const toasts = document.querySelectorAll('.jt-toasts .jt-toast');
  return { count: toasts.length, texts: Array.from(toasts).map((t) => t.textContent) };
});
rec('P3-5 连续点复制 6 次：同屏 toast ≤ 3', copyToasts.count <= 3, JSON.stringify(copyToasts));
rec('P3-5 相同内容去重：复制提示仅 1 条', copyToasts.texts.filter((t) => /复制/.test(t)).length <= 1, JSON.stringify(copyToasts.texts));

/* --- P2-1 错误定位（非法 JSON） --- */
await page.evaluate(() => { document.querySelector('.jt-nav-item[data-id="validate-syntax"]').click(); });
await page.waitForTimeout(80);
await page.evaluate(() => { const ta = document.querySelector('section.jt-panel-edit textarea'); ta.value = '{\n  "a": 1,\n  "b": 2\n  "c": 3\n}'; ta.dispatchEvent(new Event('input', { bubbles: true })); });
await page.evaluate(() => { document.querySelector('.jt-th-actions .jt-btn-primary').click(); });
await page.waitForTimeout(220);
const errLineInfo = await page.evaluate(() => {
  const panel = document.querySelector('section.jt-panel-view');
  const code = panel.querySelector('.jt-code'); const errbar = panel.querySelector('.jt-errbar');
  return { code: code ? code.textContent : '', errBar: errbar ? errbar.textContent : '', errVisible: errbar && errbar.style.display !== 'none' };
});
rec('非法 JSON 执行出现错误提示且含行号', /第\s*\d+\s*行/.test(errLineInfo.code) || /第\s*\d+\s*行/.test(errLineInfo.errBar), JSON.stringify(errLineInfo).slice(0, 200));
await shot('07-错误定位.png');

/* --- YAML 转换截图 --- */
await page.evaluate(() => { document.querySelector('.jt-nav-item[data-id="convert-yaml"]').click(); });
await page.waitForTimeout(300);
const yamlOut = await page.evaluate(() => { const c = document.querySelector('section.jt-panel-view .jt-code'); return c ? c.textContent.slice(0, 120) : ''; });
rec('YAML 转换工具输出非空', yamlOut.trim().length > 0, JSON.stringify(yamlOut).slice(0, 100));
await shot('08-YAML转换.png');

/* --- 快捷键抽查 --- */
const scK = await page.evaluate(async () => {
  document.body.click();
  return true;
});
await page.keyboard.press('Control+k');
await page.waitForTimeout(120);
const kFocused = await page.evaluate(() => document.activeElement && document.activeElement.id === 'jtSearch');
rec('快捷键 Ctrl+K 聚焦搜索框', kFocused, 'focused=' + kFocused);
// Alt+ArrowDown 切工具
const beforeTool = await page.evaluate(() => document.querySelector('.jt-th-name').textContent);
await page.keyboard.press('Alt+ArrowDown');
await page.waitForTimeout(200);
const afterTool = await page.evaluate(() => document.querySelector('.jt-th-name').textContent);
rec('快捷键 Alt+↓ 切换到下一个工具', beforeTool !== afterTool, beforeTool + ' → ' + afterTool);
// Ctrl+Shift+C 复制
const scCopy = await page.evaluate(async () => { document.querySelectorAll('.jt-toasts .jt-toast').forEach((t) => t.remove()); return true; });
await page.evaluate(() => { document.querySelector('.jt-nav-item[data-id="format-pretty"]').click(); });
await page.waitForTimeout(200);
await page.keyboard.press('Control+Shift+C');
await page.waitForTimeout(300);
const copyToast = await page.evaluate(() => Array.from(document.querySelectorAll('.jt-toasts .jt-toast')).map((t) => t.textContent).join(' | '));
rec('快捷键 Ctrl+Shift+C 复制输出出现提示', /复制/.test(copyToast), copyToast || '(无 toast)');

/* --- 搜索 / 持久化 --- */
const searchFilter = await page.evaluate(async () => {
  const inp = document.querySelector('#jtSearch'); inp.value = 'base64'; inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const n = document.querySelectorAll('.jt-nav-item').length;
  inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
  return n;
});
rec('搜索框过滤左侧列表', searchFilter > 0 && searchFilter < 68, '过滤后=' + searchFilter);

await page.evaluate(() => { window.JT.storage.setTheme('dark'); document.documentElement.setAttribute('data-theme', 'dark'); });
await page.evaluate(() => { const ta = document.querySelector('section.jt-panel-edit textarea'); ta.value = '{"persist": true}'; ta.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(200);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
const persisted = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), input: (document.querySelector('section.jt-panel-edit textarea') || {}).value || '' }));
rec('刷新后主题被记住(dark)', persisted.theme === 'dark', persisted.theme);
rec('刷新后草稿被记住', persisted.input.includes('persist'), JSON.stringify(persisted.input).slice(0, 60));

/* --- P3-3 favicon / 资源 --- */
rec('P3-3 无 favicon 404 / 资源错误', badResponses.length === 0, JSON.stringify(badResponses).slice(0, 300));

/* ============================ R3 复验（Round 3 定向打磨） ============================ */
const SHOTS3 = path.join(__dirname, 'shots', 'round3');
fs.mkdirSync(SHOTS3, { recursive: true });
const shot3 = (n) => page.screenshot({ path: path.join(SHOTS3, n) });
const navTo = async (id, w) => { await page.evaluate((t) => { const el = document.querySelector('.jt-nav-item[data-id="' + t + '"]'); if (el) el.click(); }, id); await page.waitForTimeout(w || 280); };
const setIn = async (v) => { await page.evaluate((val) => { const ta = document.querySelector('section.jt-panel-edit textarea'); ta.value = val; ta.dispatchEvent(new Event('input', { bubbles: true })); }, v); await page.waitForTimeout(120); };
const clickRun2 = async () => { await page.evaluate(() => { const b = document.querySelector('.jt-th-actions .jt-btn-primary'); if (b) b.click(); }); await page.waitForTimeout(240); };
const clickSeg = async (label) => { await page.evaluate((lb) => { const segs = Array.from(document.querySelectorAll('section.jt-panel-view .jt-viewtoggle .jt-seg')); const s = segs.find((x) => x.textContent === lb); if (s) s.click(); }, label); await page.waitForTimeout(260); };
const visRows = () => page.evaluate(() => Array.from(document.querySelectorAll('section.jt-panel-view .jt-tree .jt-trow')).filter((r) => r.offsetParent !== null).length);
const loadExample = async () => { await page.evaluate(() => { const b = Array.from(document.querySelectorAll('section.jt-panel-edit .jt-panel-actions button')).find((x) => (x.title || '').includes('载入示例')); if (b) b.click(); }); await page.waitForTimeout(320); await page.evaluate(() => { const it = document.querySelector('.jt-example'); if (it) it.click(); }); await page.waitForTimeout(400); };

await page.evaluate(() => { window.JT.storage.setTheme('light'); document.documentElement.setAttribute('data-theme', 'light'); });
await navTo('format-pretty', 300);
await loadExample();
{ const hs = await page.evaluate(() => { const ta = document.querySelector('section.jt-panel-edit textarea'); const g = document.querySelector('section.jt-panel-edit .jt-gutter'); return { ta: ta.scrollTop, g: g.scrollTop, first: (ta.value.split('\n')[0] || '').slice(0, 24) }; });
  rec('R3-滚动: 首屏输入区 scrollTop=0（从第 1 行开始）', hs.ta === 0 && hs.g === 0, JSON.stringify(hs)); }
await shot3('01-首屏.png');

/* R3-1 树形：默认展开 / 全部折叠 / 全部展开 */
await clickSeg('树形');
{ const btns = await page.evaluate(() => Array.from(document.querySelectorAll('section.jt-panel-view .jt-tree-bar-btn')).map((b) => b.textContent));
  rec('R3-树: 顶部出现「全部展开/全部折叠」按钮', btns.includes('全部展开') && btns.includes('全部折叠'), JSON.stringify(btns)); }
const rowsDef = await visRows();
rec('R3-树: 默认展开后可见节点 ≥ 8（不再只有折叠根）', rowsDef >= 8, 'visibleRows=' + rowsDef);
await shot3('02-树形视图-默认展开.png');
await page.evaluate(() => { const b = Array.from(document.querySelectorAll('section.jt-panel-view .jt-tree-bar-btn')).find((x) => x.textContent === '全部折叠'); if (b) b.click(); });
await page.waitForTimeout(220);
const rowsCol = await visRows();
rec('R3-树: 点「全部折叠」后可见节点 = 1（仅根）', rowsCol === 1, 'visibleRows=' + rowsCol);
await shot3('03-树形视图-全部折叠.png');
await page.evaluate(() => { const b = Array.from(document.querySelectorAll('section.jt-panel-view .jt-tree-bar-btn')).find((x) => x.textContent === '全部展开'); if (b) b.click(); });
await page.waitForTimeout(340);
const rowsExp = await visRows();
rec('R3-树: 点「全部展开」后可见节点恢复 ≥ 8', rowsExp >= 8, 'visibleRows=' + rowsExp);

/* R3-1 大文档（>3000 节点） */
{ const big = await page.evaluate(() => { const a = []; for (let i = 0; i < 400; i++) a.push({ id: i, name: 'n' + i, a: i, b: i, c: i, d: i, e: i, f: i }); return JSON.stringify(a); });
  await setIn(big); await clickRun2();
  const timing = await page.evaluate(() => { const segs = Array.from(document.querySelectorAll('section.jt-panel-view .jt-viewtoggle .jt-seg')); const s = segs.find((x) => x.textContent === '树形'); const t0 = performance.now(); if (s) s.click(); const t1 = performance.now(); return { ms: +(t1 - t0).toFixed(1) }; });
  await page.waitForTimeout(320);
  const info = await page.evaluate(() => { const tree = document.querySelector('section.jt-panel-view .jt-tree'); const notice = document.querySelector('section.jt-panel-view .jt-tree-notice'); const rows = tree ? Array.from(tree.querySelectorAll('.jt-trow')).filter((r) => r.offsetParent !== null).length : -1; return { hasTree: !!tree, rows, notice: notice ? notice.textContent : '' }; });
  rec('R3-树: >3000 节点大文档根默认展开且提示懒加载（不卡死/不报错）', info.hasTree && info.rows >= 1 && /懒加载|节点数/.test(info.notice), JSON.stringify({ ...info, ms: timing.ms }).slice(0, 220));
  rec('R3-树: 大文档切树形渲染耗时已记录', timing.ms >= 0, 'renderMs≈' + timing.ms + ' 可见行=' + info.rows); }

/* R3-1 极端边界 */
{ const cases = [{ n: '{}', v: '{}' }, { n: '[]', v: '[]' }, { n: 'null', v: 'null' }, { n: '[1]', v: '[1]' }, { n: '[[1,2],[3]]', v: '[[1,2],[3]]' }];
  const out = [];
  for (const c of cases) {
    await navTo('format-pretty', 200); await setIn(c.v); await clickRun2(); await page.waitForTimeout(120);
    const r = await page.evaluate(async () => {
      const segs = Array.from(document.querySelectorAll('section.jt-panel-view .jt-viewtoggle .jt-seg'));
      const s = segs.find((x) => x.textContent === '树形');
      let clicked = false; if (s && !s.disabled) { s.click(); clicked = true; }
      await new Promise((z) => setTimeout(z, 150));
      const t = document.querySelector('section.jt-panel-view .jt-tree');
      const rows = t ? Array.from(t.querySelectorAll('.jt-trow')).filter((x) => x.offsetParent !== null).length : -1;
      const e = document.querySelector('section.jt-panel-view .jt-errbar');
      return { clicked, hasTree: !!t, rows, err: !!(e && e.style.display !== 'none') };
    });
    out.push({ c: c.n, ...r });
  }
  rec('R3-树: 极端边界({},[],null,[1],嵌套数组) 不崩溃且无空面板异常', out.every((r) => !r.err) && out.filter((r) => r.hasTree).every((r) => r.rows >= 1), JSON.stringify(out).slice(0, 420)); }

/* R3 深色主题截图 */
await navTo('format-pretty', 250); await loadExample();
await page.evaluate(() => { document.querySelector('.jt-top-actions .jt-icon-btn[title="切换主题"]').click(); });
await page.waitForTimeout(320);
await page.evaluate(() => { const b = Array.from(document.querySelectorAll('section.jt-panel-view .jt-viewtoggle .jt-seg')).find((x) => x.textContent === '树形'); if (b) b.click(); });
await page.waitForTimeout(280);
{ const t = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  rec('R3-UI: 深色主题切换生效', t === 'dark', t);
  await shot3('04-深色主题.png'); }
await page.evaluate(() => { window.JT.storage.setTheme('light'); document.documentElement.setAttribute('data-theme', 'light'); });

/* R3-2 保留字（UI）——Java / Python */
const reservedSample = JSON.stringify({ 'class': 1, 'int': 2, 'public': 3, 'default': 4, 'func': 5, 'if': 6, 'for': 7, 'return': 8, 'var': 9, 'fun': 10, 'type': 11, 'interface': 12 }, null, 2);
await navTo('convert-java', 300); await setIn(reservedSample); await clickRun2();
{ const j = await page.evaluate(() => (document.querySelector('section.jt-panel-view .jt-code') || {}).textContent || '');
  rec('R3-UI: Java 输出含 @JsonProperty("class") 且无裸 class 标识符', /@JsonProperty\("class"\)/.test(j) && /class_1/.test(j) && !/private\s+\w+\s+class\s*;/.test(j), j.replace(/\s+/g, ' ').slice(0, 150));
  await shot3('05-代码生成-保留字(Java).png'); }
await navTo('convert-python', 300); await setIn(reservedSample); await clickRun2();
{ const p = await page.evaluate(() => (document.querySelector('section.jt-panel-view .jt-code') || {}).textContent || '');
  rec('R3-UI: Python 输出含 class_1 且无裸 class: 字段', /class_1:\s*int/.test(p) && !/^\s*class\s*:/m.test(p), p.replace(/\s+/g, ' ').slice(0, 150));
  await shot3('06-代码生成-保留字(Python).png'); }

/* R3-3 滚动归零：4 条路径 */
async function scrollBottom() { await page.evaluate(() => { const ta = document.querySelector('section.jt-panel-edit textarea'); ta.scrollTop = 999999; }); }
async function scrollState() { return await page.evaluate(() => { const ta = document.querySelector('section.jt-panel-edit textarea'); const g = document.querySelector('section.jt-panel-edit .jt-gutter'); return { ta: ta.scrollTop, g: g.scrollTop }; }); }
await navTo('format-pretty', 250); await loadExample();
{ await scrollBottom(); const b = (await scrollState()).ta; await loadExample(); const a = await scrollState();
  rec('R3-滚动: ①「载入示例」后 scrollTop 归零', a.ta === 0 && a.g === 0, 'before=' + b + ' after=' + JSON.stringify(a)); }
{ await scrollBottom(); const b = (await scrollState()).ta;
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: () => Promise.resolve(JSON.stringify({ clip: 'x'.repeat(400) })) } }); });
  await page.evaluate(() => { const btns = Array.from(document.querySelectorAll('section.jt-panel-edit .jt-panel-actions button')); const p = btns.find((x) => (x.title || '').includes('粘贴')); if (p) p.click(); });
  await page.waitForTimeout(320); const a = await scrollState();
  rec('R3-滚动: ②「从剪贴板粘贴」后 scrollTop 归零', a.ta === 0 && a.g === 0, 'before=' + b + ' after=' + JSON.stringify(a)); }
{ await navTo('format-pretty', 250); await loadExample(); await scrollBottom(); const b = (await scrollState()).ta;
  await page.evaluate(() => { const s = Array.from(document.querySelectorAll('button')).find((x) => /作为新输入/.test(x.title || '')); if (s) s.click(); });
  await page.waitForTimeout(320); const a = await scrollState();
  rec('R3-滚动: ③「回灌输出为新输入」后 scrollTop 归零', a.ta === 0 && a.g === 0, 'before=' + b + ' after=' + JSON.stringify(a)); }
{ await loadExample(); await scrollBottom(); const b = (await scrollState()).ta;
  await page.evaluate(() => { const btns = Array.from(document.querySelectorAll('section.jt-panel-edit .jt-panel-actions button')); const c = btns.find((x) => (x.title || '').includes('清空')); if (c) c.click(); });
  await page.waitForTimeout(260); const a = await scrollState();
  rec('R3-滚动: ④「清空输入」后 scrollTop 归零', a.ta === 0 && a.g === 0, 'before=' + b + ' after=' + JSON.stringify(a)); }

/* R3-4 flatten 分隔符下拉 + UI 往返 */
await navTo('format-flatten', 300);
{ const sep = await page.evaluate(() => { const sels = Array.from(document.querySelectorAll('.jt-params select')); const s = sels.find((x) => Array.from(x.options).some((o) => o.value === '__')); return s ? { opts: Array.from(s.options).map((o) => o.value), value: s.value } : { opts: [], value: '' }; });
  rec('R3-UI: flatten 分隔符下拉 4 项且默认 .', sep.opts.length === 4 && sep.value === '.', JSON.stringify(sep));
  const desc = await page.evaluate(() => { const d = document.querySelector('.jt-th-desc'); return d ? { t: d.textContent, vis: d.offsetParent !== null } : null; });
  rec('R3-UI: flatten 描述含分隔符往返提示且可见', !!desc && desc.vis && /往返可能不保真|建议改用其他分隔符/.test(desc.t), JSON.stringify(desc).slice(0, 120));
  await shot3('07-flatten分隔符下拉.png'); }
{ const fi = JSON.stringify({ 'a.b': 1, c: 2, 'd.e': { 'f.g': 3 } });
  await setIn(fi);
  await page.evaluate(() => { const s = Array.from(document.querySelectorAll('.jt-params select')).find((x) => Array.from(x.options).some((o) => o.value === '__')); if (s) { s.value = '__'; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  await clickRun2();
  const flat = await page.evaluate(() => (document.querySelector('section.jt-panel-view .jt-code') || {}).textContent || '');
  rec('R3-UI: flatten(separator=__) 输出含 d.e__f.g', /d\.e__f\.g/.test(flat), flat.replace(/\s+/g, ' ').slice(0, 120));
  await page.evaluate(() => { const s = Array.from(document.querySelectorAll('button')).find((x) => /作为新输入/.test(x.title || '')); if (s) s.click(); });
  await page.waitForTimeout(220);
  await page.evaluate(() => { const sels = Array.from(document.querySelectorAll('.jt-params select')); const d = sels.find((x) => Array.from(x.options).some((o) => o.value === 'unflatten')); if (d) { d.value = 'unflatten'; d.dispatchEvent(new Event('change', { bubbles: true })); } });
  await clickRun2();
  const back = await page.evaluate(() => (document.querySelector('section.jt-panel-view .jt-code') || {}).textContent || '');
  let okDeep = false; try { okDeep = JSON.stringify(JSON.parse(back)) === JSON.stringify({ 'a.b': 1, c: 2, 'd.e': { 'f.g': 3 } }); } catch (e) {}
  rec('R3-UI: flatten→回灌→还原(separator=__) 深等价', okDeep, back.replace(/\s+/g, ' ').slice(0, 140)); }

/* R3 错误定位截图 */
await navTo('validate-syntax', 250);
await setIn('{\n  "a": 1,\n  "b": 2\n  "c": 3\n}');
await clickRun2();
{ const e = await page.evaluate(() => { const p = document.querySelector('section.jt-panel-view'); const c = p.querySelector('.jt-code'); const b = p.querySelector('.jt-errbar'); return { code: c ? c.textContent : '', bar: b ? b.textContent : '' }; });
  rec('R3-UI: 非法 JSON 错误定位含行号', /第\s*\d+\s*行/.test(e.code) || /第\s*\d+\s*行/.test(e.bar), JSON.stringify(e).slice(0, 140));
  await shot3('08-错误定位.png'); }

/* ============================ Round 4 终验（收尾改动） ============================ */
const SHOTS4 = path.join(__dirname, 'shots', 'round4');
fs.mkdirSync(SHOTS4, { recursive: true });
const shot4 = (n) => page.screenshot({ path: path.join(SHOTS4, n) });

/* C1 复核：工具数 & 首屏 */
const navCount4 = await page.evaluate(() => document.querySelectorAll('.jt-nav-item').length);
rec('R4-回归: 首屏工具项总数仍 = 68', navCount4 === 68, 'nav=' + navCount4);
await navTo('format-pretty', 280); await loadExample();
await shot4('02-首屏.png');

/* C5-01 树形默认展开 */
await clickSeg('树形');
await page.waitForTimeout(120);
{ const rowsR4 = await visRows();
  rec('R4-回归: 树形默认展开可见节点 ≥ 8', rowsR4 >= 8, 'visibleRows=' + rowsR4);
  await shot4('01-树形视图-默认展开.png'); }

/* C2 UI 级：Swift CodingKeys 全覆盖（改动的 toSwift 走 UI 全链路） */
const swiftSample = JSON.stringify({ 'class': 1, 'userName': 2, 'default_value': 3 }, null, 2);
await navTo('convert-swift', 320); await setIn(swiftSample); await clickRun2();
{ const s = await page.evaluate(() => (document.querySelector('section.jt-panel-view .jt-code') || {}).textContent || '');
  const cases = [...s.matchAll(/case\s+([A-Za-z_$][\w$]*)\s*=\s*"([^"]*)"/g)].map((m) => ({ n: m[1], k: m[2] }));
  const props = [...s.matchAll(/let\s+([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]);
  const map = {}; cases.forEach((c) => { map[c.n] = c.k; });
  rec('R4-UI: Swift CodingKeys case 数 == 属性数 == 3', cases.length === 3 && props.length === 3, JSON.stringify({ cases, props }));
  rec('R4-UI: Swift 逐条映射（class_1↔class / userName↔userName / defaultValue↔default_value）', map['class_1'] === 'class' && map['userName'] === 'userName' && map['defaultValue'] === 'default_value', JSON.stringify(map));
  await shot4('03-代码生成-Swift保留字.png'); }

/* C2 UI 级：无任何映射 → 完全不生成 CodingKeys */
const swiftNoMap = JSON.stringify({ 'userName': 1, 'age': 2 }, null, 2);
await navTo('convert-swift', 280); await setIn(swiftNoMap); await clickRun2();
{ const s = await page.evaluate(() => (document.querySelector('section.jt-panel-view .jt-code') || {}).textContent || '');
  rec('R4-UI: Swift 无映射(userName/age) 不生成 CodingKeys', !/enum CodingKeys/.test(s) && /let userName\s*:/.test(s), s.replace(/\s+/g, ' ').slice(0, 140)); }

/* --- console 汇总 --- */
const errs = consoleMsgs.filter((m) => m.type === 'error' || m.type === 'pageerror');
const warns = consoleMsgs.filter((m) => m.type === 'warning');
rec('页面 console error 数 = 0', errs.length === 0, JSON.stringify(errs).slice(0, 700));
results.push({ name: '__console__', pass: errs.length === 0, detail: JSON.stringify({ errors: errs, warnings: warns, all: consoleMsgs }) });
await ctx.close();

/* ============================ file:// 直开 ============================ */
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page2 = await ctx2.newPage();
const fileMsgs = [];
page2.on('console', (m) => { if (m.type() === 'error') fileMsgs.push({ type: m.type(), text: m.text() }); });
page2.on('pageerror', (e) => fileMsgs.push({ type: 'pageerror', text: e.message }));
await page2.goto(pathToFileURL(path.join(ROOT, 'web', 'index.html')).href, { waitUntil: 'load' });
await page2.waitForTimeout(800);
const fileState = await page2.evaluate(() => ({ nav: document.querySelectorAll('.jt-nav-item').length, hasApp: !!document.querySelector('.jt-workspace') }));
rec('file:// 直开可正常渲染（非白屏）', fileState.hasApp && fileState.nav === 68, JSON.stringify(fileState));
const fileHash = await page2.evaluate(async () => {
  try { const t = window.JT.registry.get('codec-hash'); const r = await t.run('abc', Object.assign({}, t.defaultParams), { parseInput: () => window.JTCore.json.parseLax('"abc"') }); return { error: r.error || null, out: (r.output || '').slice(0, 80) }; } catch (e) { return { threw: e.message }; }
});
rec('file:// 下 codec-hash 正常或友好提示', !fileHash.threw && (fileHash.error || fileHash.out), JSON.stringify(fileHash).slice(0, 160));
results.push({ name: '__file_console__', pass: fileMsgs.length === 0, detail: JSON.stringify(fileMsgs) });

/* --- 先落盘结果与汇总，再做（可能卡住的）浏览器 teardown，避免关闭阶段卡死导致丢结果 --- */
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log('\n=== 浏览器测试 通过 ' + passed + ' / 失败 ' + failed.length + ' ===');
fs.writeFileSync(path.join(__dirname, 'browser-results.json'), JSON.stringify({ passed, failed: failed.length, results, toolReport, consoleMsgs, badResponses }, null, 2), 'utf8');
console.log('失败项：'); failed.forEach((f) => console.log('  ' + f.name + ' :: ' + String(f.detail).slice(0, 200)));
console.log('\nconsole 消息：' + JSON.stringify(consoleMsgs, null, 2));
console.log('\n异常响应：' + JSON.stringify(badResponses, null, 2));

/* teardown 兜底：Edge headless 的 close 偶发卡住，超时即强退（结果此时已落盘） */
const bail = setTimeout(() => { console.log('[warn] browser.close() 超时，强制退出（结果已写入 browser-results.json）'); process.exit(0); }, 8000);
try { await ctx2.close(); } catch (e) { console.log('[warn] ctx2.close 异常：' + (e && e.message)); }
try { await browser.close(); } catch (e) { console.log('[warn] browser.close 异常：' + (e && e.message)); }
clearTimeout(bail);
process.exit(0);
