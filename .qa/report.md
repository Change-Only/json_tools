# JSON 工具箱 · QA 测试报告

- 测试人：Edward（QA Engineer）
- 日期：2024-09-24（本机时间 15:30–16:05）
- 被测版本：工作区当前交付版（68 工具 / 约 6800 行，`web/` + `main.py` + 2 个 `.bat`）
- 结论：**存在 1 个 P1、3 个 P2 缺陷 → 路由判定：Engineer**（需工程师修复后回归）

---

## 一、执行摘要

| 项 | 结果 |
| --- | --- |
| 单元/静态断言（T1+T2，`.qa/run-tests.mjs`） | **164 条：通过 159 / 失败 5**（5 条失败全部为真实产品缺陷） |
| 浏览器端到端断言（T3，`.qa/browser-check.mjs`） | **25 条：通过 18 / 失败 7**（含 1 条重复记录，实际独立失败 6 项） |
| 68 工具全量遍历（真实浏览器） | 全部可点击、可执行；**3 个工具报错均为输入类型不匹配的合理报错**；遍历期间 **0 个 pageerror** |
| 静态一致性 | 16 个引用资源全部存在；**0 外链、0 ES module、0 违规 emoji**；id 唯一、元数据完整、**params 与 run 读取一一对应** |
| 外壳脚本（T4） | main.py 各项符合声明；`启动.bat` 有 P3 级空格路径风险；PyInstaller 打包路径理论兼容 |
| 缺陷分级 | **P0：0　P1：1　P2：3　P3：7** |
| 是否修改过产品代码 | **否**（仅新建 `.qa/` 下的测试脚本与报告） |

核心结论：**核心逻辑层（core/*.js）质量很高**——164 条含大量边界用例的断言只有 5 条失败；但**装配层 app.js 存在一个让 4 个入口按钮全部失效的 P1 缺陷**，以及一个影响所有工具的"陈旧错误条"P2 缺陷。

---

## 二、测试范围与方法（实际执行的命令）

```bash
# T1+T2 单元与静态一致性（Node 22）
cd C:/Users/YZX/WorkBuddy/JSON工具箱
C:/Users/YZX/.workbuddy/binaries/node/versions/22.22.2-3/node.exe .qa/run-tests.mjs

# T3 浏览器端到端（同一条命令内起服务→curl→playwright→杀进程）
"C:/Users/YZX/.workbuddy/binaries/python/versions/3.13.12/python.exe" main.py --no-open --port 8799 &
curl -s --noproxy '*' -o /dev/null -w "%{http_code}" http://127.0.0.1:8799/index.html   # 200
C:/Users/YZX/.workbuddy/binaries/node/versions/22.22.2-3/node.exe .qa/browser-check.mjs
kill $SRV    # 测试后已确认端口 8799 无残留监听

# T4 外壳核查
curl -s --noproxy '*' -o /dev/null -w "%{http_code}" http://127.0.0.1:8799/{index.html,js/core/json.js,css/tokens.css,js/app.js}   # 全 200
curl -s --noproxy '*' -o /dev/null -w "%{http_code}" http://127.0.0.1:8799/nope.txt    # 404（正确）
```

说明：
1. 本机 `http_proxy=http://127.0.0.1:52285` 环境变量会把 curl 劫持成 502，所有 curl 均需 `--noproxy '*'`（属测试环境问题，非产品缺陷）。
2. `playwright-core` 通过绝对路径 `import(pathToFileURL('.build/node_modules/playwright-core/index.mjs'))` 加载，测试脚本因此可放在 `.qa/` 目录运行。
3. 后台进程会被沙箱级联回收，故"起服务 + 跑浏览器 + 杀进程"必须在同一条 shell 命令内完成。

---

## 三、缺陷清单

### [P1] 四个弹窗入口全部崩溃：关于 / 快捷键 / 示例库 / 历史记录

- **复现**：启动应用 → 点击顶栏「历史记录」「快捷键」「关于」「示例库」任一按钮（输入区的「载入示例」同样受影响）→ 无弹窗出现。
- **期望**：弹出对应模态框。
- **实际**：抛出 `TypeError: Cannot read properties of undefined (reading 'open')`，页面无任何反应。
- **证据**（playwright 捕获的 pageerror，4 条）：
  ```
  at HTMLButtonElement.openHistory   (http://127.0.0.1:8799/js/app.js:711:13)
  at HTMLButtonElement.openShortcuts (http://127.0.0.1:8799/js/app.js:660:13)
  at HTMLButtonElement.openAbout     (http://127.0.0.1:8799/js/app.js:638:13)
  at HTMLButtonElement.openExamples  (http://127.0.0.1:8799/js/app.js:676:13)
  ```
- **疑似根因**：`app.js` 第 748 行 `D = JT.dom;`，而这 4 处调用写的是 `D.modal.open(...)`。`JT.dom`（`ui/dom.js`）只导出 `qs/qsa/esc/el/h/frag/clear/on/delegate/toggleClass/append`，**没有 `modal`**；modal 实际挂在 `JT.modal`（`aliasUI` 已把 `JTUI.modal` 别名为 `JT.modal`）。即 `D.modal` 应为 `JT.modal`（或 `JTUI.modal`）。同文件其他地方用的 `JT.toast` / `JT.editor` / `JT.tree` / `JT.split` 都是正确的 `JT.*` 前缀，唯独 modal 误写成了 `D.modal`，共 6 处：`638、660、671（close）、676、701（close）、711`。
- **影响**：4 个顶栏功能 + 输入区"载入示例"完全不可用；由于历史记录依赖弹窗，"回填历史"功能也随之不可达。

### [P2] 输出面板错误条一旦出现，后续成功执行也不会被清除（陈旧错误提示）

- **复现**：① 任选一个会报错的场景（例如选「JSON ⇄ TOML」并输入 `[1,2,3]`）→ 出现错误条；② 切到「JSON 美化」等必然成功的工具并执行。
- **期望**：成功后输出面板的错误提示消失。
- **实际**：错误条永久残留，显示上一次的错误内容，与当前成功结果同时出现。
- **证据**：断言 `报错后再执行成功工具：输出错误条应被清除` 失败：`{"afterErr":true,"errVisibleAfterSuccess":true,"outLen":804}`；68 工具遍历中，从第一个报错工具 `convert-toml` 之后，**50+ 个成功执行的工具全部带 `[STALE-ERRBAR]` 标记**；截图 `05-历史记录.png` 底部可见 format-pretty 成功输出（804 字符）但下方仍挂着"第 4 行 Expected ',' or '}' …"。
- **疑似根因**：`app.js` `renderResult`（约 424–472 行）：错误分支第 432 行调用 `outputEditor.setError(...)`，成功分支第 439 行**只调用了 `inputEditor.clearError()`**，从不调用 `outputEditor.clearError()`；`setTextMode()` 也只清空正文区（`area`），不处理 `errBar`。

### [P2] 展平/还原：`unflatten` 数组还原完全失效，且内部字段 `__arr` 泄漏到输出

- **复现**（Node 可直接复现）：
  ```js
  JTCore.json.flatten({a:[10,20]},{arrays:true})  // {"a.[0]":10,"a.[1]":20}
  JTCore.json.unflatten(上述结果,{})              // {"a":{"__arr":[],"[0]":10,"[1]":20}}
  ```
- **期望**：还原回 `{a:[10,20]}`。
- **实际**：数组未被重建，且出现从未文档化的内部键 `__arr: []`。
- **文件与行号**：`web/js/core/json.js` `unflatten`（约 527–553 行）。第 538–542 行有 `arrMatch` 分支创建 `cur.__arr`，但该变量后续从未被使用（明显的未完成实现/死代码），索引最终被当作普通对象键写入。
- **影响**：「展平 / 还原」工具勾选"展平时也展开数组"后无法往返，输出脏数据。

### [P2] codegen 字段名冲突时生成重复标识符（非法代码）

- **复现**：
  ```js
  JTCore.codegen.toTypeScript({'a b':1, aB:2}, {rootName:'R'})
  // export interface R {
  //   aB: number;
  //   aB: number;      // ← Duplicate identifier
  // }
  ```
- **期望**：字段名做风格归一后若冲突，应去重（例如追加序号）或保留原键名。
- **实际**：`'a b'` 与 `aB` 都归一为 `aB`，产生重复字段，TS/Java/Go/Python/Rust 等输出均无法通过编译。
- **文件与行号**：`web/js/core/codegen.js` `buildModel/emit`（约 137–161 行）：类型名有 `unique()` 去重，**字段名没有**。
- **影响**：字段命名风格不规范的 JSON（含空格/点/大小写混用）会生成非法代码。

### [P3] 展平数组路径与文档不符：`a.[0]`（多一个分隔点）

- `flatten({a:[10,20]},{arrays:true})` → `{"a.[0]":10,"a.[1]":20}`；工具参数标签与通用惯例是 `a[0]`。
- 文件：`web/js/core/json.js` `flatten` 第 517 行 `prefix + sep + '[' + i + ']'`。数组索引前不应再加 `sep`。

### [P3] XML 往返丢失空数组与 null 的类型

- `{empty:[]}` → `<empty/>` → `{empty:{}}`；`{n:null}` → `<n/>` → `{n:{}}`。
- XML 无原生类型标注，属固有限制；但工具描述为"双向互转"且**未在 notices 中提示类型丢失**。建议在 `jsonToXml` 时对空数组/null 写入提示，或在文档说明。其余 XML 能力（嵌套、数组、`@_` 属性、`#text`、CDATA、`&<>"` 实体）往返均正确。

### [P3] favicon.ico 404 产生页面唯一一条非异常 console error

- `index.html` 未声明图标，浏览器自动请求 `/favicon.ico` → 404。
- 建议：`<link rel="icon" href="data:,">` 或内联 SVG 图标。修复后即可达成"console error = 0"。

### [P3] 树形视图组件不可达：68 个工具没有任何一个使用 `view:'tree'`

- `ui/editor.js` 完整实现了 `JT.tree`，`app.js` 第 442 行也有 `view === 'tree'` 渲染分支，但 `tools-registry.js` 中 68 个工具的 `view` 取值只有 `text/code/stats/table/diff`。
- README「已知限制」第 6 条还在描述树形视图懒加载。属"功能未接线"。

### [P3] toast 通知无同屏上限、不去重

- 截图 `02-深色主题.png`、`04-错误定位.png` 中可见 20+ 条 toast 堆叠并遮挡内容（自动化快速执行 68 个工具触发；真人操作频率低，但连续执行/批量操作仍可能堆叠）。
- 建议：同屏上限（如 5 条）+ 相同文案去重。

### [P3] `启动.bat`：Python 路径含空格会导致启动失败；启动失败无提示

- 第 48 行 `start "" %PY% "%DIR%main.py"` 中 `%PY%` 未加引号。若探测到的解释器路径含空格（如 `C:\Program Files\Python\pythonw.exe`），`start` 会把第一个空格前的部分当作命令。
- 另外 `start` 后立即 `exit /b 0`，若 Python 启动失败（如 `main.py` 抛错），无控制台也无提示，表现为"双击闪退"。
- 第 19 行硬编码 `C:\Users\YZX\.workbuddy\...` 属开发机残留（其他机器 `if exist` 会跳过，不致失败，但建议移除）。
- 本机（无空格路径）实测逻辑正确：探测顺序、`%~dp0`、`chcp 65001`、失败提示分支齐全。

### [P3] README 与实际功能的三处偏差

1. README 称 `file://` 下"浏览器会禁用 WebCrypto，「哈希计算」不可用"。**实测 Edge(Chromium) 下 `file://` 属安全上下文，SHA-256 正确算出** `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`，且无任何 console error（见 `07-file协议直开.png`）。该条描述已过时（偏保守，但会让用户误以为功能缺失）。
2. README 写产物为 `dist\JSON 工具箱.exe`（含空格），`打包EXE.bat` 实际 `--name "JSON工具箱"` → `dist\JSON工具箱.exe`。
3. README 提到树形视图（已知限制 6），但界面无任何入口（见上条）。

### 非缺陷说明（避免误报）

| 现象 | 判定 |
| --- | --- |
| 遍历中 `convert-toml`、`codec-jwt`、`codec-timestamp` 报错 | **合理**。默认示例输入是顶层数组，而 TOML 需要顶层 table、JWT/时间戳需要特定格式，报错文案清晰且带上下文 |
| `pickKeys` 不深入"未保留键"的子树取同名键 | 语义为"逐层过滤"，与代码注释一致，非缺陷 |
| codegen 对 `null`-only 数组元素推断为 `null` 类型、int/float 混合推断为 `number` | 符合启发式预期 |
| `main.py` 未显式使用 `sys._MEIPASS` | PyInstaller 4.3+ 会把入口脚本 `__file__` 指到 `_MEIPASS`，`--add-data "web;web"` 恰好落在 `base_dir/web`，**理论兼容**；建议显式改为 `getattr(sys,'_MEIPASS',Path(__file__).parent)` 加固（P3 建议，不计缺陷） |

---

## 四、真实输出粘贴

### T1+T2 单元测试（`.qa/run-tests.mjs`，完整输出见 `.qa/unit-results.json`）

```
================ JSON 工具箱 · 单元/静态测试 ================
=== 通过 159 / 失败 5 ===

--- 失败明细 ---
[T2-convert 往返] XML 空数组往返 [] → []
   实际: {"xml":"…<root>\n  <empty/>\n</root>","back":{"root":{"empty":{}}},"note":"期望 {root:{empty:[]}}，实际类型丢失"}

[T2-convert 往返] XML null 往返 null → null
   实际: {"xml":"…<root>\n  <n/>\n</root>","back":{"root":{"n":{}}},"note":"期望 {root:{n:null}}，实际类型丢失"}

[T2-codegen] 字段名冲突不产生重复标识符（a b / aB）
   实际: aB 字段出现 2 次\nexport interface R {\n  aB: number;\n  aB: number;\n}

[T2-json 操作] flatten arrays:true 展平数组
   实际: {"a.[0]":10,"a.[1]":20}

[T2-json 操作] unflatten 还原数组（往返）
   实际: {"a":{"__arr":[],"[0]":10,"[1]":20}}

分类计数: {"format":13,"convert":20,"query":13,"validate":9,"codec":9,"utility":4}
```

覆盖要点（全部通过的部分）：
- `json.parse` 错误定位：未闭合字符串 / 缺逗号 / 尾逗号 / 中文全角引号，`line` 均 > 0 且指向出错行。
- `parseLax` 9 类修复（单引号、双类尾逗号、`//` 与 `/* */`、裸键、`True/False/None`、BOM、中文引号+全角冒号、转义单引号、混合数组）**修复后的对象值全部正确**。
- 格式化缩进 2/4/8/Tab；A→Z / Z→A **递归**生效；压缩后与原文 `deepEq` 等价且无空白；非 ASCII 转义。
- 转义幂等：3 组含 `\n \t \" \\ 中文 \/ \b \f` 样本，`unescape(escape(x))===x` 与 `escape(unescape(e))===e` 全过。
- 往返：YAML / TOML / CSV（含逗号与引号转义）/ QueryString（bracket 与 repeat）/ Properties / NDJSON 全部 `deepEq` 相等；TOML 含 null 给出告警且不抛异常。
- codegen：TS/Java/Go/Python/Rust/DDL/JSON Schema 输出括号配平、可被解析；`mixed`、`null`-only、int/float 混合推断正确。
- JSONPath（`$.a.b`、`['a']`、`[0]`、`[*]`、`..key`、`[0:2]`）、leafPaths、getByPath 两种写法、pick/omit（含 `*`）、collect、groupBy、aggregate、深合并三策略、diff、JSON Patch 7 类操作（含数组 `-` 追加、根路径、test 失败抛错）、flatten/unflatten（无数组）、dedupe、sortArray、sortKeys、cleanNulls。
- codec：Base64（中文 / URL-safe / 无 padding / 非法字符）、URL、HTML 实体（十进制/十六进制/命名）、JWT（过期 / 未过期 / nbf 未生效 / `alg:none`）、时间戳（秒/毫秒自动识别、0、负值、2038 之后、日期往返）、**UUID 1000 个无重复且 v4 格式合法**、正则分组、`parseLiteral`。
- analyze：语法校验、重复键（2 处含嵌套）、Schema（type/required/enum/min/pattern/format/minItems/uniqueItems/anyOf/oneOf/allOf，**错误条数与路径准确**）、结构统计（手工可数样本：nodes=7、maxDepth=3、类型分布精确）、异常值 4 类、安全检查（敏感字段 + 明文密码 + JWT）。
- **全量 68 工具 × 7 种空/非法输入（`''`、`'   '`、`'null'`、`'[]'`、`'123'`、`'abc'`、`'"str"'`）：0 异常、0 空返回**。
- 压力：30 层深嵌套（stats/stringify/JSONPath 均正常）、2000 条大数组（stats/groupBy/aggregate/stringify 合计 < 5s）。

### T3 浏览器测试（`.qa/browser-check.mjs`，完整输出见 `.qa/browser-results.json`）

```
=== 浏览器测试 通过 18 / 失败 7 ===   （第 7 条失败为重复的 __console__ 记录，独立失败项 6 个）

PASS 首屏左侧分类分组可见(6)                  group=6
PASS 首屏工具项总数 = 68                      nav=68
PASS 首屏输入自动载入示例并已美化              outLen=804 parse=true
PASS 68 工具逐个执行：无空白输出               all-ok
PASS 68 工具逐个执行：可执行的正常产出          有错误提示的工具数=3（convert-toml / codec-jwt / codec-timestamp，均为输入类型不匹配的合理报错）
PASS 68 工具遍历期间无 pageerror              pageerror=0
PASS 切换深色主题：data-theme=dark            theme=dark
PASS 切换深色主题：背景色确实变化              light=rgb(246,247,249) dark=rgb(14,16,20)
PASS 非法 JSON 执行出现错误提示且含行号         "第 4 行 Expected ',' or '}' after property value in JSON at position 23 (line 4 column 3)"，输入/输出双面板均显示，含「定位」按钮
PASS 点击复制按钮出现 toast                   "已复制到剪贴板"
FAIL 历史记录弹窗可打开且含记录条目             {"open":false,"threw":true}   ← P1
FAIL 快捷键弹窗可打开且可见                    {"open":false,"threw":true}   ← P1
FAIL 关于弹窗可打开                           {"open":false,"threw":true}   ← P1
FAIL 示例库弹窗可打开                          {"open":false,"threw":true}   ← P1
FAIL 报错后再执行成功工具：输出错误条应被清除     {"afterErr":true,"errVisibleAfterSuccess":true,"outLen":804}   ← P2
PASS 搜索框过滤左侧列表                        过滤后=1（输入 base64）
PASS 刷新后主题被记住(dark)                    dark
PASS 刷新后草稿被记住                          {"persist": true}
PASS 树形视图组件可渲染（注入演示）             ok（无工具暴露 view:'tree'，故用 JT.tree 直接渲染验证组件本身可用）
PASS YAML 转换工具输出非空                     "- id: 1\n  name: 张三\n…"
PASS file:// 直开可正常渲染（非白屏）           {"nav":68,"hasApp":true}，file:// 下 console 消息 = 0
PASS file:// 下 codec-hash 正常                SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
```

**console 消息清单（http 页面全程，共 5 条）**：1 条 favicon.ico 404（P3）+ 4 条 `D.modal` TypeError（P1）。**除此之外 0 条 error/warning**。
**file:// 页面**：console 消息 0 条。

### 68 工具遍历结果表（摘要）

- 前 14 个工具（format-*）与随后全部工具均有输出；**真正的执行错误 3 个**，均为输入类型不匹配：
  | 工具 | 输出 | 报错 |
  | --- | --- | --- |
  | convert-toml | — | TOML 的顶层结构必须是对象（table） |
  | codec-jwt | — | Header 段解码失败（输入不是 JWT） |
  | codec-timestamp | — | 不是合法的时间戳（输入是 JSON 数组） |
- **陈旧错误条 `[STALE-ERRBAR]` 出现在 convert-toml 之后的 50+ 个成功工具上**（见 P2 缺陷）。
- 输出量最大的几个工具：codec-url 1918 字符、convert-dart 1455 字符、codec-html 1451 字符、convert-schema 1178 字符。

### 截图清单（`.qa/shots/`，均为 1440×900 全窗口）

| 文件 | 观感结论 |
| --- | --- |
| 01-首屏-浅色.png | **布局整洁，对比度良好**：侧栏分类+计数、参数区、双栏行号编辑器、状态栏齐整。小问题：载入示例后输入框滚动到了第 18 行（光标在末尾），建议载入后滚回顶部 |
| 02-深色主题.png | 深色配色协调、对比度充足；但可见 20+ 条 toast 堆叠遮挡（P3：toast 无上限） |
| 03-树形视图.png | 树组件可渲染，但根节点默认折叠且**无任何工具入口**（P3） |
| 04-错误定位.png | 错误定位功能完善：双面板显示"第 4 行 …"并带「定位」按钮 |
| 05-历史记录.png | **弹窗未出现**（P1 的直接视觉证据）；同时可见 format-pretty 成功输出下方仍挂着上一次的错误条（P2 的视觉证据） |
| 06-某转换工具(YAML).png | YAML 高亮与排版正确，观感良好 |
| 07-file协议直开.png | file:// 直开渲染完整、非白屏、无 console 报错 |

---

## 五、智能路由判定

```
路由判定：Engineer   （存在 P1 × 1、P2 × 3 源码缺陷，需修复后回归）
```

| 缺陷 | 责任文件 | 修复建议（供工程师参考） |
| --- | --- | --- |
| P1 弹窗崩溃 | `web/js/app.js` 638/660/671/676/701/711 行 | `D.modal` → `JT.modal`（或让 `D = JT` 而非 `JT.dom`） |
| P2 陈旧错误条 | `web/js/app.js` `renderResult` 成功分支 | 补一行 `outputEditor.clearError();` |
| P2 unflatten 数组 | `web/js/core/json.js` 527–553 行 | 重写 `__arr` 死代码：识别 `[n]` 段时创建真数组并按索引写入 |
| P2 字段名冲突 | `web/js/core/codegen.js` `emit` | 字段名归一后做去重（类似类型名的 `unique()`），并同步调整 serde/CodingKeys/alias 映射 |

QA 侧说明：本轮共修正过 5 处**测试脚本自身**的错误（共享参数常量 `OPTIONAL_MODE/NAME_STYLE` 未被静态提取、XML 双根节点测试数据、`pickKeys` 语义预期、Schema 错误条数 6→5、stats 节点数 6→7），修正后判定为真实缺陷的 5 条全部保留为失败，未做任何放宽。

---

## 六、未覆盖 / 存疑项

1. **pywebview 原生窗口**与**浏览器回退**未实测（`--no-open` 模式下不会触发窗口路径；沙箱内也不宜拉起 GUI）。仅做了代码走查：`import webview` 失败 → 返回 False → `webbrowser.open`，逻辑闭环。
2. **PyInstaller 打包**未实际执行（需联网安装 pyinstaller）。路径解析经静态分析判定理论兼容，建议打包后补一次冒烟。
3. **`--browser` 参数**未实测（会拉起系统浏览器），仅代码走查。
4. **拖拽分栏**、**文件上传/拖放**、**下载输出**、**收藏**、**Alt+↑/↓ 切换工具**等次要交互未逐项断言（本次聚焦主链路）。
5. **打印/导出 PDF**、超大数据（>10MB）下的内存与卡顿未压测。
6. 2000 条大数组的各项操作总耗时 < 5s（含 stringify + groupBy + aggregate + stats），未单独记录每项精确毫秒数。
7. `codec-url` 的 `decode` 在 `mode:'uri'` 下的容错回退会忽略 uri 语义（退回 `decodeURIComponent`）——影响极小，未列为缺陷。

---
---

# Round 2 回归验证（追加章节）

- 测试人：Edward（QA Engineer）
- 日期：2024-09-24（本机时间 16:20–16:58）
- 被测版本：工程师寇豆码声称"全部修复"后的交付版
- 结论：**11 个修复项全部确认属实 + 68 工具无回归 + 0 个本轮新引入缺陷 → 路由判定：NoOne**
- 纪律遵守：本轮仍未修改任何产品代码（`web/`、`main.py`、`*.bat`、`README.md`），仅在 `.qa/` 下新增/修改测试资产。

---

## R2-0 · 执行摘要

| 项 | Round 1 | Round 2 | 变化 |
| --- | --- | --- | --- |
| 单元/静态断言（`.qa/run-tests.mjs`） | 164 条：159 通过 / **5 失败** | **209 条：209 通过 / 0 失败** | 原失败 5 条全部转绿；新增 45 条断言 |
| 浏览器端到端（`.qa/browser-check.mjs`） | 25 条：18 通过 / 7 失败 | **42 条：42 通过 / 0 失败** | 新增 P1 逐点击、P2-1、P2-2/P3-1 UI 全流程、P3-4、P3-5、P3-3 等 17+ 条 |
| 页面 console error / 异常响应 | 5 条（1×favicon 404 + 4×P1 TypeError） | **0 / 0** | P1 + P3-3 修复生效 |
| 交付物（exe） | 未打包 | **独立实跑通过**（见 R3） | 新增 |
| 缺陷 | P1×1 P2×3 P3×7 | **P0×0 P1×0 P2×0**；遗留 P3×2（均非本轮引入） | 见 R2-5 |

---

## R2-1 · 修复项逐条核验（源码行号 + 实测双重证据）

> 原则：不只看代码，每条都用 Node 单元或真实浏览器实测复现过"修好了"。

| 编号 | 缺陷 | 源码证据（实际行号） | 实测证据 | 判定 |
| --- | --- | --- | --- | --- |
| **P1** | `D.modal` 弹窗崩溃 | `web/js/app.js`：`D.modal` 全文 **0 处**；6 处弹窗调用全部改为 `JT.modal`（689 / 711 / 722 / 727 / 752 / 762） | 浏览器逐点击：关于 / 快捷键 / 示例库 / 历史记录 4 个弹窗 `visible=true`、标题正确、**Esc 可关闭**、0 pageerror；「载入示例」`modalOpen=true` 且输入变化 | ✅ 修复 |
| **P2-1** | 陈旧错误条不清除 | `app.js` 400–401（`run()` 入口清两侧）+ 502–503（`renderResult` 成功分支清两侧）+ 614（`selectTool` 清输出侧） | 浏览器：先构造报错（`errBar` 可见）→ 切「JSON 美化」执行 → `inErrVisible=false, outErrVisible=false` | ✅ 修复 |
| **P2-2** | `unflatten` 数组还原失效 + `__arr` 泄漏 | `web/js/core/json.js`：新增 `parseFlatKey`（504）、`unflatten` 重写（571）+ `childContainer`（581，610 调用）；**全文 `__arr` 0 处** | **250 组随机样本** flatten→unflatten 往返深等价全部通过，`__arr` 泄漏 = 0 | ✅ 修复 |
| **P2-3** | codegen 字段名冲突产生重复标识符 | `web/js/core/codegen.js`：新增 `uniqueField`（135，142 写 report），`emit` 内每结构独立 `usedNames`（164）并在 170 调用；`tools-registry.js` 43 行 `runCodegen` 注入 `report` | 11 个代码生成器字段名全部唯一；二次冲突正确命名为 `aB_2`/`aB_3` 且写 report；Java `@JsonProperty("a b")`、Go ``json:"a b"``、Rust `#[serde(rename = "a b")]` **原始键名全部保留** | ✅ 修复 |
| **P3-1** | 展平数组路径 `a.[0]` 多一个点 | `json.js` 534–536：数组分支 `prefix + '[' + i + ']'`（543），不再拼 `sep` | 展平输出 `{"a[0]":10,"a[1]":20}`；`unflatten` 对 `a[0]` 与旧写法 `a.[0]` **双向兼容**且结果一致；浏览器 UI 全流程（展平 → 还原 → 深等价）通过 | ✅ 修复 |
| **P3-2** | XML 往返类型丢失无提示 | `web/js/core/convert.js`：`collectXmlLossy`（272）、`countEmptyElements`（289）、`xmlOpts.notices`（263）、`jsonToXml` 推入告警（333–338）、`xmlToJson` 推入告警（350–354） | `{a:null,b:[],c:""}` → 输出 `<a/><b/><c/>` 且 notices =「XML 无法无损表达 null / 空数组 / 空字符串：以下 3 处…位置：a、b、c。」；`convert-xml` 工具链路透传成功 | ✅ 修复 |
| **P3-3** | favicon.ico 404 | `web/index.html` 9 行：`<link rel="icon" href="data:," />` | 浏览器全程 `badResponses=[]`，console error = 0 | ✅ 修复 |
| **P3-4** | 树形视图无任何工具入口 | `web/js/ui/editor.js` 新增 `setViewToggle`（295）；`app.js` `isTreeData`（428）/`decideView`（433–439）/`renderOutput`（447+，477 挂 toggle）/`viewMode` 重置（612）；`tools-registry.js` 535 `query-jsonpath` 声明 `view:'tree'` | 浏览器 5 条：控件出现且可点；树可展开/折叠/切回文本；**非 JSON 结果置灰 + tooltip「当前结果不是 JSON 对象/数组…」**；query-jsonpath 默认树形；切工具后 viewMode 重置 | ✅ 修复 |
| **P3-5** | toast 无上限、不去重 | `web/js/ui/toast.js`：`MAX_TOASTS=3`（27）、`DEDUP_MS=1500`（28）、去重（41）、超限移除（47） | Node（DOM stub）：连发 6 条同屏 `count=3`；相同内容 `dupCount=1`。浏览器：连点复制 6 次同屏 ≤3。截图 02/04 右下角**可见恰好 3 条** | ✅ 修复 |
| **P3-6** | `启动.bat` 空格路径风险 + README exe 名 | `启动.bat`：`PYEXE`/`PYARGS` 变量拆分（13–14）、`start "" "%PYEXE%" %PYARGS%`（77，已加引号）、`-c "import sys"` 探测（56）+ 失败提示分支（67–73）；`README.md` 20 行改为 `dist\JSON工具箱.exe`（无空格） | 静态核对通过；行尾 CRLF 95/95（`打包EXE.bat` 56/56）；**README 三处偏差全部修正**（WebCrypto 表述改为"file:// 下通常可用"、exe 名、树形视图入口） | ✅ 修复 |
| **加固** | main.py 打包路径 | `main.py` 160–176：`getattr(sys, "_MEIPASS", None)`（163）→ `candidate_dirs`（162–166）→ 遍历探测（169）→ 兜底（174） | **独立实跑 exe**（见 R3-2），5 个资源全部 200 且字节数与源码一致 | ✅ 生效 |

---

## R2-2 · R1 单元回归（`.qa/run-tests.mjs`，209 通过 / 0 失败）

```
=== 通过 209 / 失败 0 ===
```

**① R1 的 5 条失败全部转绿**（断言未放宽，仅 2 条 XML 往返按 P3-2 新增的"文档化有损行为"改为断言 notices 存在）：

| R1 失败项 | R2 结果 |
| --- | --- |
| flatten arrays:true 展平数组（`a.[0]`） | ✅ PASS：`{"a[0]":10,"a[1]":20}` |
| unflatten 还原数组（`__arr` 泄漏） | ✅ PASS：还原为真数组，无 `__arr` |
| XML 空数组往返类型丢失 | ✅ PASS：输出含明确 notices（有损行为已文档化） |
| XML null 往返类型丢失 | ✅ PASS：同上 |
| codegen 字段名冲突重复标识符 | ✅ PASS：`aB` / `aB_2` / `aB_3` 唯一 |

**② 本轮新增 45 条断言**（分组 `R2-*`，全部通过）：

- **R2-修复核验(静态) 13 条**：上表所有源码符号的静态断言（`D.modal`=0、`__arr`=0、`parseFlatKey` 存在、`uniqueField` 存在、favicon 内联、`_MEIPASS` 等）。
- **P2-2 属性测试（严格键）**：LCG 随机生成器产出 **250 组**随机嵌套 JSON（随机深度/数组/类型/中文键），`flatten→unflatten` 往返 `deepEq` **250/250 通过**，`__arr` 泄漏 0。
- **P2-2 属性测试（含点键·边界观察）**：200 组**键名含分隔符**的样本，往返不一致 **127/200**——见 R2-5 第 2 条说明（固有歧义，非缺陷，且有缓解手段）。
- **P3-1 兼容性 4 条**：`a[0]` 新写法、`a.[0]` 旧写法均能还原，且两者结果一致。
- **P2-3 唯一性 20 条**：11 个代码生成工具（TS/Java/Kotlin/Go/Python/C#/Rust/Swift/Dart/PHP/DDL）字段唯一 + 非空；`aB_2`/`aB_3` 二次冲突；Java `@JsonProperty`、Go `json tag`、Rust `serde rename` 保留原始键；report 文案正确；registry 链路 notice 汇入。
- **P3-2 XML 告警 3 条**、**P3-5 toast 2 条**（Node 侧 DOM stub 实测 count=3 / dup=1）。
- **68 工具全量遍历 + params↔run 对应关系复核**：0 异常、0 空输出，参数声明与 run 读取仍一一对应。

---

## R2-3 · R2 真实浏览器回归（Edge + playwright-core，42 通过 / 0 失败）

```
precheck -> 200
=== 浏览器测试 通过 42 / 失败 0 ===
失败项：
console 消息：[]
异常响应：[]
```

- **console error = 0、异常响应 = 0**（P1 崩溃与 favicon 404 均消失）。
- **P1 逐点击**：4 个弹窗 + 「载入示例」全部真实 click 触发，`offsetParent` 可见性校验，Esc 逐个关闭，0 pageerror。
- **P2-1**：`isVisible()` 双面板断言（不再是文本猜测）。
- **P2-2 / P3-1 UI 全流程**：勾选"展平数组"→ 展平得 `list[0]`/`nested.arr[0].x` → 切"还原"→ 输出与原始输入**深等价**。
- **P3-3**：`page.on('response')` + `requestfailed` 全程监听，0 条 ≥400 / 失败请求。
- **3 个快捷键实按**：`Ctrl+K` 聚焦搜索框（focused=true）、`Alt+↓` 切换工具（JSON ⇄ YAML → JSON ⇄ TOML）、`Ctrl+Shift+C` 出现"已复制输出"toast。
- **file:// 直开**：68 工具齐全、非白屏、0 console 消息；SHA-256("abc") = `ba7816bf…15ad` 正确。
- **主题/搜索/持久化**：深色切换背景色实测变化；刷新后主题与草稿均被记住。
- 测试环境说明：Edge headless 的 `browser.close()` 在本机偶发挂起（约 8s 超时），脚本已在**落盘之后**才做 teardown 并加超时强退，不影响结果完整性（`node exit=0`）。

**截图 8 张**（`.qa/shots/round2/`，1440×900，16:53 生成）观感复核：

| 文件 | 结论 |
| --- | --- |
| 01-首屏.png | 布局整洁、双栏行号编辑器/参数区/状态栏齐整；输出面板出现「文本/树形」切换 |
| 02-关于弹窗.png | 弹窗居中、遮罩正常、内容完整；**右下角恰好 3 条 toast**（P3-5 上限的直观证据） |
| 03-历史记录弹窗.png | 50 条历史记录弹窗正常渲染 |
| 04-深色主题.png | 深色对比度充足、语法高亮正常；toast 仍为 3 条上限 |
| 05-树形视图.png | 树形视图可折叠展开，接入成功 |
| 06-非JSON结果切换置灰.png | Base64 输出（非 JSON）时「树形」**置灰** + tooltip，符合 P3-4 预期 |
| 07-错误定位.png | 行号错误定位与「定位」按钮正常 |
| 08-YAML转换.png | YAML 高亮与排版正常 |

整体观感：**两种主题下对比度、间距、层级一致，无明显视觉缺陷**（R1 的 toast 堆叠问题已消失）。

---

## R2-4 · R3 交付物核验

1. **exe 存在且新鲜**：`dist/JSON工具箱.exe` = **14,976,155 字节**，mtime 2024-09-24 16:33（与"修复后重新打包"时间线吻合）。
2. **中间产物已清理**：项目根目录无 `build/`（`ls: cannot access 'build': No such file or directory`）、无任何 `*.spec`。
3. **独立实跑 exe（端口 8801）**：`./dist/JSON工具箱.exe --no-open --port 8801` 后 curl：
   ```
   index.html     -> 200  bytes=1400
   css/tokens.css -> 200  bytes=2243
   vendor/libs.js -> 200  bytes=181337   ← 与源文件字节数一致
   js/core/json.js -> 200 bytes=47720
   js/app.js      -> 200  bytes=42263
   nope.txt       -> 404                   ← 404 行为正确
   ```
   5 个资源全部 200 且**字节数与 `web/` 源文件完全一致**，实证 `main.py` 的 `_MEIPASS` 加固在打包态生效。测毕已 `taskkill` 清理。
   **exe 与源码一致性抽核**：`vendor/libs.js`(181337) / `core/json.js`(47720) / `css/tokens.css`(2243) 与源文件字节数完全一致；唯 `js/app.js` exe 内为 42263 字节、工作区为 42212 字节（exe 打包于 16:33，`app.js` 最后修改于 16:35）。已把 exe 内的 `app.js` 取出 diff：**仅差 1 行** —— exe 版 `renderResult` 内多一个**从未被使用的局部变量** `var view = result.view || tool.view || 'text';`（该逻辑已等价存在于两个版本共有的 `decideView` 第 435 行），工程师在打包后 2 分钟删除了这行死变量。**两者功能完全等价，非缺陷**；建议下次改动后重新打包以保持字节级一致（P3 流程建议）。
4. **`打包EXE.bat`**：`--noconfirm --onefile --windowed --name "JSON工具箱" --add-data "web;web" --collect-all webview`，与 README 描述一致；CRLF 56/56。
5. **`启动.bat`**：本轮**未实跑**（双击路径会拉起 pywebview 原生窗口/浏览器，沙箱内不宜弹 GUI）。已静态核对：探测顺序（runtime → 内置路径 → `pyw -3` → `pythonw` → `python`）、`%PYEXE%` 引号包裹、`-c "import sys"` 探测 + 失败提示 + `pause`、CRLF 95/95。等价的非 GUI 链路 `python main.py --no-open` 本轮已实跑 40+ 次（含单元与浏览器回归），全部正常。
6. **README 一致性**（逐条对照源码）：
   - `--browser` / `--port` / `--no-open`：`main.py` 155–157 ✅
   - WebCrypto 表述（"file:// 下通常可用，禁用时给友好提示"）：`codec.js` 267 `hasWebCrypto()` + 284 友好文案，且浏览器实测 file:// 下 SHA-256 正确 ✅
   - 树形视图入口（23–24 行）：P3-4 实测 ✅
   - 快捷键 9 条（124–136 行）：`app.js` 769–786 实现 8 条 keydown（Esc 在 modal、Tab 在编辑器），其中 3 条已实按通过 ✅
   - 68 工具 / vendor 内置三库 / 目录结构 / exe 名：全部一致 ✅

---

## R2-5 · 本轮新发现与遗留（均为 P3，且非本轮修复引入）

1. **[P3·遗留] codegen 对"保留字字段名"未做转义**（新增发现，非回归）
   `{"class":1,"int":2,"public":3,"default":4,"func":5}` 的生成结果中：
   - Java：`private Integer class;` —— **非法**（保留字）
   - Python dataclass：`class: int` —— **非法**
   - Kotlin `val class:`、Swift `let class:`、Dart `final int class:` —— 同样非法
   - TS interface / Go（`Class`）/ C#（`Class`）经大小写归一后合法
   `codegen.js` 的 `uniqueField`（135 行）只处理**归一后重名**，不含保留字表；该问题在 R1 之前就存在（P2-3 的修复未触及也未恶化它）。README「已知限制 1」已声明生成代码"可作为起点、需人工微调"，故不定级为 P2。建议：为 Java/Python/Kotlin/Swift/Dart 增加保留字表，冲突时追加 `_1` 后缀并把原键写入 `@JsonProperty` / `field(name=...)` / `json:"…"` 映射。已作为观察项写入 `unit-results.json`（`观察：生成字段是否含保留字 class`）。

2. **[非缺陷·已验证缓解] 键名含分隔符时 flatten/unflatten 往返不保真**
   200 组含 `.` 的键名样本往返不一致 127 组。这是**所有**单分隔符展平方案的固有歧义（键 `a.b` 与嵌套 `{a:{b}}` 展平后同形），非本轮修复引入。实测工具参数 `separator` 可缓解：改用 `→` 或 `__` 后同样本往返**完全一致**（已单独验证）。建议在工具描述或 README 中提示"键名含分隔符时请更换分隔符"。

3. **[非缺陷] 状态栏字符数/工具 id 为 1.2s 轮询刷新**
   `app.js` 870 行 `setInterval(updateStatusCounts, 1200)`。切换工具后约 1.2s 内状态栏右侧仍显示上一个工具的计数（截图 06 即拍在此窗口内，输出面板已是 1128 字符而状态栏还是 803）。属设计取舍，非功能缺陷；若追求严谨可在 `run()` 内同步调用一次 `updateStatusCounts()`。

4. **[测试环境] Edge headless `browser.close()` 挂起**
   本机偶发，脚本已改为"先落盘再 teardown + 8s 超时强退"，`node exit=0`。与产品无关。

5. **[承 R1] 载入示例后输入编辑器滚动位置停在文末**（截图 01/02/04 输入区从 18 行开始显示）。R1 已提的化妆级建议，未修复也未恶化，不影响功能。

---

## R2-6 · 智能路由判定

```
路由判定：NoOne
（11 个修复项全部亲自复现属实；R1 全部 5 条失败转绿；209 + 42 条断言 0 失败；
 0 个本轮新引入回归；exe 独立实跑通过。遗留 2 条 P3 均为存量问题，已记录在案。）
```

**QA 侧说明**：本轮对测试脚本自身的修正共 3 处（均非放宽断言）：
1. `browser-check.mjs` 把"结果落盘 + 汇总打印"移到浏览器 teardown **之前**，并加 8s 超时强退——否则 Edge 偶发挂起会丢掉全部结果；
2. T1 资源计数器过滤 `^(data:|https?:|mailto:|#|//)`，避免把 P3-3 新增的内联 `data:,` favicon 误判为缺失文件；
3. 2 条 XML 往返断言改为断言 notices 存在（依据 P3-2 修复后的文档化有损语义，已在报告中注明）。

---

## R2-7 · 未覆盖 / 存疑项（增量）

1. `启动.bat` 双击路径未实跑（见 R2-4 第 5 条说明），仅静态核对 + 等价非 GUI 链路实跑。
2. codegen 保留字问题仅验证了 `class/int/public/default/func` 五个键，未穷举各语言完整保留字表。
3. 键名含分隔符的往返歧义仅在 `.`/`→`/`__` 三种分隔符下验证，未覆盖数组下标与分隔符同时冲突的极端组合。
4. pywebview 原生窗口、打印/导出 PDF、>10MB 超大数据仍未实测（承 R1）。
5. 深色主题下树形视图的长键名换行/省略号表现未逐项断言（仅人工目测截图 05，无异常）。

---
---

# Round 3 复验（追加章节 · 交付前最后一关）

- 测试人：Edward（QA Engineer）
- 日期：2024-09-24（本机时间 17:20–17:46）
- 范围：工程师 Round 3 的 **4 项定向打磨**（树形默认展开 / 滚动归零 / codegen 保留字 / flatten 分隔符下拉）+ **全量回归**。按主理人要求，**exe 不在本次范围**（工程师并行重打包，最终 exe 由主理人自验）。
- 结论：**4 项修复全部属实且实测通过；0 个断言回退；0 个本轮新引入回归 → 路由判定：NoOne（可以交付）**

---

## R3-0 · 执行摘要

| 项 | Round 2 | Round 3 | 变化 |
| --- | --- | --- | --- |
| 单元/静态断言（run-tests.mjs） | 209 / 0 | **271 / 0**（新增 62 条 R3 断言） | ✅ 无回退 |
| 浏览器端到端（browser-check.mjs） | 42 / 0 | **62 / 0**（新增 20 条 R3 断言） | ✅ 无回退 |
| 页面 console error / 异常响应 | 0 / 0 | **0 / 0** | ✅ |
| 68 工具全量遍历 | 0 pageerror / 0 空返回 | **0 pageerror / 0 空返回** | ✅ |
| 工具数 / 分类计数 | 68；13/20/13/9/9/4 | **68；13/20/13/9/9/4** | ✅ |
| 断言回退 | — | **仅 1 条测试期望更新（见 R3-5），非产品回归** | — |

---

## R3-1 · 改动范围独立复核（mtime 证据）

以 R2 收尾时间（本机 17:02，`.qa/report.md` 最后写入）为界，**在 17:02 之后被修改的产品文件恰好 4 个**，与工程师声明完全一致，**无第 5 个文件被动过**：

| 文件 | mtime | 声明项 |
| --- | --- | --- |
| `web/js/ui/editor.js` | 17:18:49 | ①树形重构 ②滚动归零 |
| `web/css/components.css` | 17:19:25 | ⑤`.jt-tree-bar*` 样式 |
| `web/js/tools-registry.js` | 17:19:51 | ④flatten 分隔符下拉 |
| `web/js/core/codegen.js` | 17:26:31 | ③保留字表 + Swift/Dart 一致性 |

其余全部 ≤ 16:35:24（`app.js` 16:35:24、`json.js` 16:14、`convert.js` 16:17、`toast.js` 16:17、`index.html` 16:17、`main.py` 16:19、`README.md` 16:22、`codec.js` 16:23、两个 `.bat` 16:23）；**`web/vendor/libs.js` 15:30:51 未被触碰** ✅（纪律达成）。

## R3-2 · 4 项修复的源码定位（实际行号）

1. **树形组件重构**（`editor.js`）：`buildNode(key, value, path, depth, expandTo)` 返回句柄 `self{node,row,children,leaf,setOpen}`（373–438）；默认展开 `if (!leaf && depth <= expandTo) self.setOpen(true)`（436）；`countNodes`（440–449）；`expandAll()` 预算 20000（452–461）；`collapseAll()`（464–470）；`render()` 内 `expandTo = n>3000 ? 0 : (singleRoot ? 2 : 1)`（484）+ 工具栏「全部展开/全部折叠」（486–491）。
2. **滚动归零**（`editor.js` `applyText` 190–201）：197–200 行统一 `scroller.scrollTop = 0; gutter.scrollTop = 0;`（覆盖编辑/查看两种模式）。
3. **保留字**（`codegen.js`）：`RESERVED` 11 语言表（48–60）+ `LANG_LABEL`(62) + `KEY_MAPPING`(63–75) + `CASE_NOTE`(77–80)；`uniqueField` 命中保留字 → `_1` 后缀并写 report（176–202）；字段带 `reserved` 标记（230）；**11 个生成器各自注入 `opts.lang`**（270/300/386/417/461/525/562/593/631/690/735）；`reservedWords` 导出（879）。
   - **Swift/Dart 一致性修正**：Swift 属性 `let f.name`（603）与 `case f.name = "jsonKey"`（604）；Dart 属性/构造参数/fromJson/toJson 全部统一用 `f.name`（639/645/660/666–668），JSON 键一律用 `f.jsonKey`（原键）。全文已无 `toCamel(f.name)`。
4. **flatten 分隔符**（`tools-registry.js` 218–228）：`separator` 由文本框改为 `sel` 下拉，4 个选项（`.`/`__`/`→`/`/`，默认 `.`），选项文案自带提示，`desc` 追加「键名本身含分隔符字符时往返可能不保真，建议改用其他分隔符」。
5. **样式**（`components.css` 242–254）：`.jt-tree-bar` / `-title` / `-spacer` / `-btn`（含 hover）。

## R3-3 · V1 全量回归（防重构破坏公共路径）

- **单元 271 / 0**：R1+R2 的 209 条全部保留且通过；新增 `R3-*` 6 组 62 条（修复核验静态 13、保留字 11 生成器 22、原键映射 8、Swift/Dart 自洽 10、非保留字回归 2、flatten 分隔符 7）。
- **浏览器 62 / 0**：R1/R2 的 42 条全部保留且通过；新增 R3 20 条。`console 消息：[]`、`异常响应：[]`。
- **68 工具全量遍历**：`无空白输出 all-ok`、`pageerror=0`、真实报错工具仍为 3 个（convert-toml / codec-jwt / codec-timestamp，输入类型不匹配的合理报错）。
- **注册表**：工具数 68 ✅；分类计数 `{"format":13,"convert":20,"query":13,"validate":9,"codec":9,"utility":4}` ✅；`T1-参数一一对应` 通过 ✅（工程师改了 registry，重核无漂移）。

## R3-4 · V2 专项实测证据

### ① 树形默认展开（R2 遗留缺陷，本轮修复目标）
| 断言 | 实测 | 结果 |
| --- | --- | --- |
| format-pretty 默认示例切「树形」可视节点 ≥ 8 | **visibleRows = 40** | ✅（R2 时是"只有 1 个折叠根"） |
| 顶部出现「全部展开/全部折叠」按钮 | `["全部展开","全部折叠"]` | ✅ |
| 点「全部折叠」→ 可见节点 = 1（仅根） | **visibleRows = 1** | ✅ |
| 点「全部展开」→ 恢复 ≥ 8 | **visibleRows = 40** | ✅ |
| 大文档（400 条 × 9 字段 ≈ **3601 节点**）切树形 | 根默认展开、**可见 401 行**、notice「节点数约 3601，已启用懒加载…」、**渲染 ≈14.6ms**、不卡死不报错 | ✅ |
| 极端边界 `{}` / `[]` / `null` / `[1]` / `[[1,2],[3]]` | 分别 1 / 1 / （树形置灰，合理）/ 2 / 6 行；**全部 err=false、无空面板异常、无崩溃** | ✅ |

### ② 保留字转义（11 生成器 × 12 个保留字键）
- 样本 `{"class","int","public","default","func","if","for","return","var","fun","type","interface"}` → **11 个生成器全部**：声明标识符中 **0 个裸保留字**、**0 个重名**、输出非空；每语言 `notices` 非空且文案包含「是 X 保留字」「已重命名为」「原键已保留在 …」。
- **原键映射未断裂**（逐语言定点断言全过）：
  - Java `@JsonProperty("class")` ↔ `private Integer class_1;`
  - Kotlin `@JsonProperty("class") val class_1:`
  - Go `` json:"class" ``（`Class` 字段，Go 无 `class` 关键字，不误改）
  - Rust `#[serde(rename = "type")]` ↔ `pub type_1:`
  - C# `[JsonPropertyName("class")]` ↔ `public int Class1`
  - Swift `case class_1 = "class"` ↔ `let class_1:`
  - Dart `class_1: json['class']` 与 `'class': class_1`
  - PHP `public int $class_1;`
  - DDL 列名反引号包裹，原键保留在列注释
- **Swift/Dart 映射自洽性**（混合样本 `{"class":1,"userName":2,"default_value":3}`）：
  - Swift：3 个属性唯一；每个 `case X = "…"` 的 `X` 都严格对应一个 `let X`；`class_1`↔`class`、`defaultValue`↔`default_value`；驼峰键 `userName` 未被多余改写 ✅
  - Dart：3 个属性唯一；构造参数 `this.X` 与属性一一对应；`fromJson` 的键字符串 == 原键集合；`toJson` 的键字符串 == 原键集合且值 ∈ 属性集 ✅
  - **审查结论：`toCamel(f.name)` → `f.name` 的改动是修复而非回归**。原因是唯一可能产生分歧的场景是「归一后追加 `_2/_3` 冲突后缀」的键（如 `aB_2`：旧代码属性会变成 `aB2`，与 `uniqueField` 登记名不一致 → toJson 引用不存在的属性）；新代码统一用 `f.name` 消除了这处断裂。默认 camel 风格下 `toCamel(f.name) === f.name`，普通键行为不变（已用 `{"userName":1,"age":2}` 回归验证）。
- **非保留字回归**：10 个生成器对普通键输出**无多余 `_1` 后缀**且原名保留 ✅。

### ③ 滚动归零（4 条路径，均为"深处 → 0"的实测）
先把输入滚到文末（实测 `before = 362px`），再触发动作：
| 路径 | before | after(textarea / 行号槽) | 结果 |
| --- | --- | --- | --- |
| ①「载入示例」 | 362 | 0 / 0 | ✅ |
| ②「从剪贴板粘贴」（stub `navigator.clipboard.readText`） | 362 | 0 / 0 | ✅ |
| ③「回灌输出为新输入」（交换左右） | 362 | 0 / 0 | ✅ |
| ④「清空输入」 | 362 | 0 / 0 | ✅ |
另：首屏加载后 `scrollTop = 0`（输入区从第 1 行开始，R2 时是第 18 行）✅。
> 测试方法说明：③④ 初版因输入内容过短无法产生滚动条（before=0），已改为先载入长示例再滚动，确保是真"深处归零"而非恒为 0。

### ④ flatten 分隔符
- 下拉实测选项 `[".","__","→","/"]` 共 4 项，**默认 `.`** ✅；工具描述提示文案**真实可见**（`offsetParent !== null`）✅。
- UI 全流程（`{'a.b':1,c:2,'d.e':{'f.g':3}}`）：`separator=__` → 展平输出含 `"d.e__f.g"` ✅ → 回灌 → 还原 → **与原输入深等价** ✅；`separator=.` 允许不保真（`d.e.f.g`），且描述/选项文案已明示 ✅。

## R3-5 · Round 2 → Round 3 断言回退核查（逐条）

**结论：0 条产品行为回退。唯一改动的是 1 条测试期望，且该改动正是本轮修复目标：**

| 断言 | R2 期望 | R3 现状 | 判定 |
| --- | --- | --- | --- |
| `P3-4 点「树形」渲染树节点且可折叠` | 根节点**默认折叠**（`before === 'none'`） | 根节点**默认展开**（`before === ''`），点击仍可折叠/再展开 | **测试期望更新**（R3 的修复目标就是"不再只有一个折叠根"）；已改为状态无关断言：`hasTree && childCount>0 && before!==afterExpand && afterExpand!==afterCollapse` |

其余 R1/R2 共 251 条断言（209 单元 + 42 浏览器）**逐条原样保留且全部通过**，无任何放宽或删除。
另：R2 的记录型观察项「生成字段是否含保留字 class」由 `java:true, python:true` 变为 `false/false` —— 这不是回退，是保留字修复生效的直接证据（该观察项恒为 pass，仅记录）。

## R3-6 · 本轮新引入的回归

**未发现。** 重点审查过的两个高风险点：
1. **Swift/Dart `f.name` 改动**：见 R3-4 ②，结论为修复（消除了冲突后缀场景下的属性名/映射断裂），普通键行为不变。
2. **树组件重构（公共路径）**：68 工具全量遍历 0 pageerror / 0 空返回；`query-jsonpath` 默认树形、非 JSON 置灰、切工具 viewMode 重置等 R2 断言全部仍过；深浅两主题下树渲染正常（截图 02/04）。

## R3-7 · 本轮新发现 / 遗留（均不阻塞交付）

1. **[P3·存量，非本轮引入] Swift `CodingKeys` 覆盖不全**：仅当字段名 ≠ 原 JSON 键时才生成 `case`，名字相同的字段被省略。Swift 规范要求自定义 `CodingKeys` 覆盖所有无默认值的存储属性，否则合成解码器会编译失败。例：`{"class":1,"userName":2,"default_value":3}` 生成的 CodingKeys 只有 `class_1`、`defaultValue`，缺 `userName`。**R2 时代同样如此**（旧条件 `toCamel(f.name) !== f.jsonKey` 对 `userName` 同样省略），故非本轮回归；但保留字修复会让 CodingKeys 出现得更频繁，建议后续改为"覆盖全部字段（未改名也生成 `case userName`）"。
2. **[P3·观察] DDL 对已反引号保护的列名仍追加 `_1`**：`default`→`` `default_1` ``、`type`→`` `type_1` ``。因列名本就被反引号包裹，重命名会改变实际列名（原键保留在列注释）。属过度保守，非错误；如需保真可在 DDL 分支跳过保留字改名。
3. **[非缺陷·承 R2] 状态栏计数/工具 id 为 1.2s 轮询刷新**（`app.js:870`）：截图 08 中状态栏右侧显示上一工具的 `format-flatten`，属刷新窗口内现象，功能无误。
4. **[测试侧] 本轮修正测试脚本 3 处（均非放宽产品断言）**：① 参数区选择器由 `section.jt-params` 改为 `div.jt-params`（产品里参数容器是 `<div>`，我的初版选择器写错）；② R2 的树形断言按 R3 新默认展开行为更新（见 R3-5）；③ 滚动 ③④ 路径先载入长示例，确保是"深处→0"的真验证。另修正我自己的 2 处正则笔误（Rust `[` 未转义、Swift 引号位置）与 `parseLax` 返回包装对象的取值。

## R3-8 · 智能路由判定

```
路由判定：NoOne   ——  可以交付
（4 项修复全部亲自复现属实；271 单元 + 62 浏览器断言 0 失败；68 工具遍历 0 pageerror/0 空返回；
  0 条断言回退（唯一变化是树形默认展开的测试期望，即本轮修复目标）；0 个本轮新引入回归。）
```

## R3-9 · 截图与最终观感（`.qa/shots/round3/`，1440×900，17:44–17:45 生成）

| 文件 | 观感结论 |
| --- | --- |
| 01-首屏.png | **输入区从第 1 行开始**（R2 是第 18 行）✅；双栏行号编辑器对齐、参数区/状态栏齐整 |
| 02-树形视图-默认展开.png | **树形视图现在是"能用的"**：根 `[3 项]` 展开到 2–3 层，键/字符串/数字/布尔分色，`{8 项}`/`[2 项]` 计数徽标，右上角「全部展开/全部折叠」 |
| 03-树形视图-全部折叠.png | 仅剩 1 个折叠根 `[3 项]`，箭头朝右，符合预期 |
| 04-深色主题.png | 深色下树形分色与对比度充足，工具栏按钮可见 |
| 05-代码生成-保留字(Java).png | `@JsonProperty("class") private Integer class_1;`…**无裸保留字**；右下角 3 条 toast 逐一说明改名与原键保留位置（上限仍为 3） |
| 06-代码生成-保留字(Python).png | `class_1: int  # 原 JSON 键: "class"` 等，**无裸 `class:`**；注释保留原键 |
| 07-flatten分隔符下拉.png | 下拉默认 `.（点号）— 键名含点时不保真`，描述含提示；输出为数组规范 `list[0]` 形式 |
| 08-错误定位.png | 双面板红色错误条「第 4 行 Expected ',' or '}' …」+ 定位按钮 |

**最终美观度评价**：树形视图已从"不可用的折叠根"变为**可正常浏览的层级视图**，展开/折叠、计数徽标、配色、行内复制按钮齐备；两种主题下**无布局错乱、无文字截断、无元素重叠、无面板大面积空白**。整体达到可交付水准。

## R3-10 · 未覆盖 / 存疑项

1. **exe 未验**（按主理人指示，工程师并行重打包，最终 exe 由主理人自验）。提醒一点：工程师本次改了 4 个源文件，**重打包务必在本次源码之后进行**，否则 exe 会落后于源码（R2 曾出现打包早于最后清理 2 分钟的情况，功能等价但字节不一致）。
2. Swift `CodingKeys` 覆盖问题仅推理 + 生成结果比对，未做真实 Swift 编译验证（本机无 Swift 工具链）。
3. 保留字表为"非穷尽"（源码注释自述），未逐语言穷举验证；本次用 12 个高频键覆盖 11 语言。
4. `expandAll` 的 20000 节点预算只在 3601 节点文档上验证（远低于预算），未构造 >20000 节点的极端样本。
5. 树形超长字符串值（>120 字符截断）与超深嵌套（>30 层）在树形视图下的表现未逐项断言。

---

# Round 4 终验（收尾改动 + exe 独立核验）

> 验证人：严过关（QA）· 时间：2026-09-24 18:00–18:25 · 纪律：只写 `.qa/`，未触碰任何产品文件
> 本轮工程师改动仅 3 个文件，改动晚于 R3 验证，故按规矩再做一次**独立确认**（不采信其自测 271/0 + 62/0）。

## R4-1 · 改动真实性核验（mtime 独立复核）

| 文件 | mtime | 大小 | 归属 |
| --- | --- | --- | --- |
| `web/js/core/codegen.js` | 17:50:31 | 48709 B | **R4 改动**（toSwift CodingKeys） |
| `启动.bat` | 17:51:06 | 3567 B | **R4 改动**（exe 兜底） |
| `README.md` | 17:52:40 | 12280 B | **R4 改动**（方式2/目录/已知限制#8） |
| `main.py` | 16:19:36 | 8415 B | R3 时代，未动 |
| `web/js/ui/editor.js` | 17:18:49 | 23989 B | R3，未动 |
| `web/js/tools-registry.js` | 17:19:51 | 58452 B | R3，未动 |
| `web/vendor/libs.js` | 15:30:51 | 181337 B | 自始未动 |
| `dist/JSON工具箱.exe` | **17:59:02** | 14979442 B | **晚于全部 3 处源码改动 → 打包滞后于源码** ✅ |

**结论**：与工程师声称"只有 3 个文件"完全一致；`libs.js` 15:30 后再未改动（R1 的红线守住）；exe 重打包发生在最后一处源码改动（17:52:40）之后 6 分 22 秒，**不存在 R2 那种"打包早于清理"的时序倒挂**。

## R4-2 · C1 全量回归（不采信自测，全部重跑）

| 项 | 结果 | 基线对比 |
| --- | --- | --- |
| `.qa/run-tests.mjs`（单元+静态） | **290 通过 / 0 失败** | R3 基线 271/0 → +19 条 R4 新断言（10 静态核验 + 9 Swift CodingKeys），0 回退 |
| `.qa/browser-check.mjs`（Edge E2E） | **67 通过 / 0 失败** | R3 基线 62/0 → +5 条 R4 新断言，0 回退 |
| 页面 console error | **0** | 持平 |
| 68 工具逐个执行 | **无空白输出（all-ok）**、**遍历期间 pageerror=0** | 持平 |
| 首屏工具项总数 | **68** | 持平 |

R4 新增断言（浏览器侧）全过：树形默认展开 `visibleRows=40`（≥8）；Swift `case 数==属性数==3`；逐条映射 `class_1↔class / userName↔userName / defaultValue↔default_value`；无映射时完全不生成 CodingKeys。

## R4-3 · C2 Swift CodingKeys 亲眼验证（本轮最易"只改一半"的点）

用独立探针 `.qa/r4-swift.mjs` 直接打印生成结果并逐条断言（**20 通过 / 0 失败**），另走 UI 全链路复核 5 条：

**主用例 `{"class":1,"userName":2,"default_value":3}`**（生成结果原文）：
```swift
struct Root: Codable {
    let class_1: Int
    let userName: Int
    let defaultValue: Int

    enum CodingKeys: String, CodingKey {
        case class_1 = "class"
        case userName = "userName"
        case defaultValue = "default_value"
    }
}
```
- ✅ `case` 数 **3 == 存储属性数 3**（严格相等，无遗漏）
- ✅ 每个 case 值 == 原 JSON 键；**`case userName = "userName"` 显式写出**（R3 遗留的覆盖缺口已补上）
- ✅ 属性集与 case 集双向一一对应（`every` 双向断言）

**`{"userName":1,"age":2}`（无任何映射）**：
```swift
struct Root: Codable {
    let userName: Int
    let age: Int
}
```
- ✅ **完全不生成 `enum CodingKeys`**（needKeys 门控生效，不是"生成空枚举"）

**边界用例**：
- `{"a_b":1,"aB":2}` → `aB` / `aB_2` 冲突重命名，CodingKeys 2 case ↔ 2 属性一一对应（`aB↔"a_b"`、`aB_2↔"aB"`），不崩溃 ✅
- `{"中文":1}` → 名==键 → 不生成 CodingKeys，`let 中文: Int` 正常 ✅

**R3 沉淀回归**：11 语言生成器 × 12 个高频保留字键，逐语言按**各自 RESERVED 表**断言"无裸保留字标识符 + 无重复 + ≥10 标识符" → **11/11 全过**。要点：`class` 在 Go/Rust 并非保留字，故合法保留原名（Go 靠 `json:"class"` 标签保键，Rust 字段名即键）；C# PascalCase → `Class1` + `[JsonPropertyName("class")]`；DDL 列名反引号包裹。这不是回退，是各语言命名风格的正确差异。

## R4-4 · C3 exe 独立性核验（本轮必须 QA 亲自验）

**① 文件事实**：`14979442` bytes，mtime `2026-09-24 17:59:02`，sha256 `4cf71d12091cde6179b69cb4b994543239cf14c8aea89fd0d1f4310dda5db6d4`。

**② 残留物清查**：产品 `build/`、`*.spec`、`*.pyc`、`__pycache__` **全部不存在**；全仓库 `.py` 仅 `main.py`，`.bat` 仅 `启动.bat` + `打包EXE.bat`（均合法）。`.build/` 是 QA 自建 Node 测试夹具（playwright-core/esbuild），非产品构建残留。

**③ 内嵌资源逐字节比对**（PyInstaller 6.22.3 `CArchiveReader` 直接读 exe，`.qa/extract-web.py`）：
```
CArchive 条目 270 个，内嵌 web 资源 17 个
源码文件数=17  MATCH=17  DIFFER=0  MISSING=0   →  ALL-MATCH
```
17/17 **全部字节一致**，含本轮改动的 `codegen.js`（48709 B）。**这直接证明 exe 是用当前源码打的**（R2 曾出现 app.js 差 1 行死代码，本轮已消除）。

**④ 实际运行核验**（`dist/JSON工具箱.exe --no-open --port 8805`，`.qa/r4-exe-run.sh`，单次调用内完成 start→curl→kill）：
```
服务就绪：ready=1（首次探测即 200）
GET /index.html             HTTP 200  MATCH  1400 B   sha=ef0eeddc28ee
GET /js/core/codegen.js     HTTP 200  MATCH  48709 B  sha=5d49bf363416
GET /js/ui/editor.js        HTTP 200  MATCH  23989 B  sha=4e632794e863
GET /css/components.css     HTTP 200  MATCH  19722 B  sha=1abeb74d792e
ALLMATCH=1
清理：netstat 定位 PID 43040（父 48744）→ taskkill //F //T 成功终止
关停后 curl → HTTP 000（连接拒绝）→ PORT-RELEASED=yes
```

**结论**：exe 与源码**字节级一致**，可独立运行，资源 200，进程可干净回收、端口正常释放。

## R4-5 · C4 启动.bat 兜底逻辑核验

**① 静态核验（读码记行号）**
- `:BADPY` L67–79、`:NOTFOUND` L93–108 各含 `if exist "%DIR%dist\JSON工具箱.exe" ( echo…; start "" "…exe"; exit /b 0 )`；`:NOTFOUND` 另有方案三（L105）。
- **5 级 Python 探测优先级未变**（L17/25/31/39/46）：runtime → 本机固定路径 → `pyw` → `pythonw` → `python`，`goto PROBE` 逐级短路。
- **`:RUN` L81–91 仍只 `start "" "%PYEXE%" %PYARGS% "%DIR%main.py"`，其分支内完全未引用 exe** → exe 兜底只存在于 :BADPY/:NOTFOUND 两个"Python 不可用"分支。
- 无 goto 死循环（所有 goto 目标 :PROBE/:RUN/:BADPY/:NOTFOUND 均单向、无回跳）；每个分支以 `exit /b 0|1` 收口，**无 fallthrough 穿透**。
- 编码：**纯 CRLF（108 CRLF / 0 纯 LF / 0 孤立 CR）**，3567 B，结尾 `exit /b 1\r\n`；引号规范（`start "" "path"` 空 标题 + 带引号路径）。

**② 动态仿真（`.qa/bat-sim.py`，3 场景全过）**
方法：把 启动.bat 复制到独立临时目录做**插桩副本**——只把 3 处 `start` 启动动作换成写 marker 文件，**所有 `if exist` / `where` / 分支条件与控制流原样保留**；用受控 PATH 构造环境（副本同时 ASCII 化以规避 cmd 在 65001 代码页解析多字节批处理的已知缺陷，不影响逻辑）。

| 场景 | PATH 构造 | 期望 | 实测 marker | 判定 |
| --- | --- | --- | --- | --- |
| A 无 Python | 空（仅 System32/Windows） | :NOTFOUND → 启动 exe | `SIM_NOTFOUND_EXE` | ✅ PASS |
| B 有可用 Python | 真实 Python 目录 | :RUN → 启动 main.py，**不启动 exe** | `SIM_RUN_PYTHON` | ✅ PASS |
| C Python 损坏 | ping.exe 冒充 python.exe | :BADPY → 启动 exe | `SIM_BADPY_EXE` | ✅ PASS |

**③ KEY QUESTION 的明确回答：exe 兜底不会抢占，只在最后生效。**
- 证据一（静态）：exe 启动语句只出现在 `:BADPY` 与 `:NOTFOUND`；只要 5 级探测中任一级 `if exist`/`where` 命中且 `:PROBE` 校验通过，就 `goto RUN` 直接 `python main.py`，**根本不会走到那两个分支**。
- 证据二（动态）：场景 B 在真实 Python 可用时 marker 为 `SIM_RUN_PYTHON`（而非任何 `_EXE`），实测 exe 兜底 0 次触发。
- 场景 C 进一步证明：即便解释器"找得到但跑不动"，也是先在 `:PROBE` 校验失败后才落到 `:BADPY` 的 exe 兜底——顺序正确。

## R4-6 · C5 截图（`.qa/shots/round4/`，1440×900，18:19 生成）

| 文件 | 观感结论 |
| --- | --- |
| 01-树形视图-默认展开.png | 默认展开到 2–3 层，键/字符串/数字/布尔分色，`[3 项]`/`{8 项}` 计数徽标，右上「全部展开/全部折叠」，可见节点 40 ✅ |
| 02-首屏.png | 输入区从第 1 行开始，双栏行号编辑器对齐，参数区/状态栏齐整，无空白/错位 ✅ |
| 03-代码生成-Swift保留字.png | **本轮修复的直观证据**：`case class_1 = "class"` / `case userName = "userName"` / `case defaultValue = "default_value"` 三 case 与三属性一一对应；右下 toast 说明「字段 class 是 Swift 保留字，已重命名为 class_1（原键已保留在 CodingKeys）」✅ |

三种画面下均无布局错乱、无文字截断、无元素重叠。

## R4-7 · 测试侧修正（均非放宽产品断言）

1. `.qa/run-tests.mjs` R4 静态断言正则修正：原 `'case ' \+ f\.name` 要求引号紧贴 `case`，而源码是 `'        case '`（引号后跟缩进空格），故恒不匹配——**是我写的正则错，产品代码正确**。已改为 `case ' \+ f\.name \+ ' = "' \+ f\.jsonKey` 并补 1 条 needKeys 块收口断言。
2. `.qa/r4-swift.mjs` 首版误以为 11 语言都会输出 `class_1`（Go/Rust/DDL/C# 实为 `Class`/原名/反引号列/PascalCase），已改为**按各语言自身 RESERVED 表**判定"无裸保留字"。

## R4-8 · 智能路由判定

```
路由判定：NoOne   ——  可以交付
（3 处收尾改动全部亲自复现属实；290 单元 + 67 浏览器断言 0 失败；
  68 工具遍历 0 pageerror / 0 空返回；console error = 0；0 条断言回退；
  exe 与源码字节级一致（17/17 ALL-MATCH）且实测可独立运行；
  启动.bat 兜底 3 场景动态仿真全过，exe 仅作最后兜底、不抢占 Python。）
```

## R4-9 · 本轮新发现 / 遗留（均不阻塞交付）

1. **[P3·存量，非本轮引入] Rust 对驼峰键缺 `#[serde(rename)]`**：`{"userName":1}` → `pub user_name: i64` 且无 serde 重命名属性，serde 默认按字段名序列化为 `"user_name"`，**原键 `userName` 丢失**（Go 有 `json:"userName"` 标签故无此问题）。R2/R3 均如此，本轮未触及 toRust，非回归。修法：`f.name !== f.jsonKey` 时补 `#[serde(rename = "userName")]`。
2. **[观察·非缺陷] cmd.exe 在起始代码页已是 65001 时解析含中文的批处理会报 2 条 `'…' is not recognized`**（`rem` 行被多字节截断）。实测：起始代码页为 936/437（即正常双击场景）时**零报错**、分支流转正确；且相关 `rem` 行 R3 以来未改动，非本轮引入。仅影响极少数把控制台默认设为 65001 的用户，且属打印噪音不影响功能。
3. **[承 R3] DDL 对已反引号保护的列名仍追加 `_1`**（`default`→`` `default_1` ``）：过度保守而非错误，列注释保留原键。
4. **[承 R3] Swift CodingKeys 未做真实 swiftc 编译验证**（本机无 Swift 工具链）；本轮已按 Swift 规范逐条断言 case 覆盖完整性。

## R4-10 · 未覆盖 / 存疑项

1. exe 的 pywebview 原生窗口路径未验（自动化环境无法断言窗口创建，仅验 `--no-open` 服务路径；该路径 R2 已验过且 main.py 本轮未改动）。
2. `启动.bat` 5 级探测中「随包 runtime\pythonw.exe」与「本机固定路径」两级未在仿真中构造（本机真实环境命中的是第 2 级，属环境事实而非脚本逻辑）；其余三级均已动态覆盖。
3. 安装包体积/签名、Windows 7 兼容性等分发议题不在本轮范围。
