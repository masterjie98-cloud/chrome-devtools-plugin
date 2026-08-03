# Release ZIP 自动更新与项目缺口修复计划

## 目标

先把分发给普通用户的 Release ZIP 变成可持续更新的安装形态：用户首次仍需下载
ZIP 并运行安装器；安装后的 daemon 可检查 GitHub Release，在用户确认后自动下载
匹配版本的 ZIP，完成完整性与结构校验、事务式覆盖、失败回滚和 daemon 重启。

随后按本计划继续处理当前测试门禁、多 Tab 监听、监听持久化、模型上下文预算、
工具参数纠错、Source Map 项目映射、后台执行和真实 Chrome 验收。

## 范围与安全默认

- 更新源固定为 `masterjie98-cloud/chrome-devtools-plugin` 的 GitHub Release。
- 自动检查不等于静默安装；下载和覆盖必须由用户点击“由 Daemon 更新”确认。
- Release 必须同时包含版本匹配的 ZIP 和 SHA-256 文件；若 GitHub 资产还提供
  `digest`，两者必须一致。
- 只接受 HTTPS、预期仓库、预期文件名、合理体积和安全 ZIP 路径。
- 先在安装目录内准备新版本，校验通过后再切换 `runtime` 与 `extension`；任一步骤
  失败都恢复旧版本。
- Bridge Token、daemon 状态和用户配置位于安装目录之外，不参与覆盖。
- 旧版 ZIP daemon 不具备新更新器时，需要人工安装一次包含本功能的新版本；此后
  才能自动更新。

## 阶段与验收

### R1 — Release ZIP 自动更新（当前阶段）

- [x] 审计现有 git 更新、ZIP 打包、安装目录和重启路径。
- [x] 在 Release 包内写入可验证的更新清单和仓库信息。
- [x] 配置 `release-it` 在正式发版时构建并上传版本精确匹配的 ZIP 与 SHA-256 资产（本轮未实际发布）。
- [x] daemon 自动区分 git 开发目录与 ZIP 安装目录。
- [x] ZIP 模式检查最新正式 Release，并返回安装模式、资产和发布页信息。
- [x] 实现有界下载、SHA-256、资产 digest、ZIP 条目和包结构校验。
- [x] 实现 `runtime`/`extension` 的事务式替换、失败回滚和安装元数据更新。
- [x] 实现 LaunchAgent 与普通后台进程的跨平台重启路径。
- [x] 更新侧栏文案、中文安装说明和 README。
- [x] 补充纯函数、临时安装目录、回滚和协议测试。
- [x] 运行 Release updater、重启辅助进程和安装服务的定向测试。
- [x] 用当前 `ws11` 工作区在沙盒外重新运行完整 WebSocket 套件、
  `verify:packaged` 和 `package:local`；最新结果分别为 504/504、90 个真实打包工具与
  三套官方 Node 成功校验打包，未沿用旧产物。

### R2 — 恢复可信发布门禁

- [x] 修正“读取被拒绝后仍期待继续调用”的过期 Agent 测试。
- [x] 修正“空对话应占满历史上限”的过期 workspace 测试数据。
- [x] 历史 `ws10` 基线曾恢复完整测试全绿（2026-08-03：468/468）。
- [x] `ws11` daemon Agent 协议加入后的完整套件已在允许临时 loopback WebSocket
  的环境执行，最新 504/504 通过。第一次运行发现并修复两项真实问题：任务同步测试仍期待
  旧 `skipTaskContext`，以及授权器把请求 `conversationId` 与自身比较而放过跨对话错绑。
- [x] 同步 `completion-evidence.md` 的测试数、工具数、协议版本和日期。
- [x] 逐项审计五个 `verify:*` 命令；没有删除仍有调用方和独立验证职责的门禁：
  `verify:packaged` 验证真实打包进程，两个 browser-evidence 命令分别用于记录期与
  严格完成门禁，workflow 与 p0-p2 live 分别覆盖真实页面工作流和协作任务持久化。
  当前不存在只剩别名、无脚本或无文档入口的无用命令。

### R3 — 多 Tab 多流监听与持久化

- [x] 为页面监听增加按 Tab 管理的独立 CDP 会话；代理、断点和任意 JS 等普通
  调试工具仍使用当前任务的 `activeSession`，不会被其他 Tab 的监听抢占。
- [x] daemon 将 activity stream 按 `{browserSessionId, tabId}` 隔离；聊天通过
  `streamId + sequence` 游标绑定具体监听轮次，同一 Tab 的显式重新监听创建新流。
- [x] 复用每类事件的独立容量上限、递增游标和 dropped/missed 披露，并将同时监听
  上限设为 8 个 Tab；单流停止和 debugger 异常分离清理。
- [x] daemon 持久化最近 8 个 Tab 的流元数据、保留事件和游标；重启恢复后标为
  已停止，避免把历史流误显示为仍在监听。
- [x] 增加双 Tab 独立流、切换选中 Tab 和 daemon 重启恢复游标测试。

验证：`npm run typecheck` 通过；activity/CDP/MAIN-world 三个专项文件合计 15/15 通过。真实 Chrome
A2/B2 验收进一步证明：任务固定在 A2、用户切到 B2 审批后仍只修改 A2，B2 保持原值。
双 Tab 同时 CDP 监听与单流停止的 UI 冒烟仍在 R6 的更广泛人工矩阵中单独跟踪。

### R4 — 上下文与工具纠错

- [x] AI Profile 增加 `contextWindowTokens`（默认 128K，可配置 8K–2M）；请求前按
  System、历史、工具 schema、工具调用/结果、CJK 文本、图片和输出预留估算 Token。
- [x] 超预算时按完整消息/工具交换删除旧历史，再对仍过大的旧工具结果做头尾压缩并
  标注省略字符；最新用户请求和最新工具交换保持协议完整，无法安全容纳时本地显式报错。
- [x] Zod 参数错误附带结构化 `argument_constraint`，覆盖字符串/数组上下限、数字
  上下限、枚举、类型和未知字段；CSS 大补丁仍明确要求按完整规则边界拆分。
- [x] 完全相同的无效调用立即阻止；可判断的同约束变体也立即阻止；无法静态判断的
  跨字段约束允许一次修正，连续两次仍失败后停止该分支并把原错误反馈给模型。

验证：上下文预算 3/3、参数约束 5/5、MCP registry 相关断言及两个 Agent 重试场景
均通过；`npm run typecheck` 通过。

### R5 — Source Map、后台执行和产品缺口

- [x] Source Map 工作区根目录按每个 MCP adapter 的启动项目隔离，可用
  `AI_DEVTOOLS_WORKSPACE_ROOTS` 显式增加多个只读根；候选按路径后缀、符号和内容
  评分，并返回稳定 root id、项目名、markers 和匹配分数供每个调用显式选择。
- [x] `browser_diagnose_runtime_errors` 返回本地 root/path/line/column、源码摘录、
  Source Map URL、映射置信度和内容身份校验结果，可供有项目权限的 MCP 客户端定位。
- [x] Source Map 匹配结果增加 `file://`、`vscode://`、`cursor://`、绝对
  `path:line:column` 和明确的 `command + arguments`；daemon 不启动 shell/编辑器，
  由有项目权限的 MCP 客户端决定是否打开。
- [x] 普通本地 Agent 模型循环迁入 daemon；按 `{browserSessionId, conversationId}`
  并发隔离，同一对话拒绝第二个 run，不同对话可同时运行。关闭/重载 Side Panel
  不会中断 daemon run，重新打开后通过持久化 `AgentSession` 恢复状态和最终内容。
- [x] Agent 启动回执或完成事件在 WebSocket 断线期间丢失时，Side Panel 会把重连后的
  `AgentSession` 回放作为接管/终态信号；daemon 在完成、取消或异常时先持久化终态再
  广播，避免任务实际继续却在 UI 误报“启动超时”或永久停留在运行中。
- [x] Side Panel 的停止、删除和切换对话只取消对应 run；审批仍使用既有 requester、
  task/conversation/Tab binding、execution broker 和审计，不因 daemon 托管而绕过。
- [x] Provider API Key 仅存在单次 WebSocket 载荷与 daemon run 内存，未加入
  BrowserStateHub/AgentSession/审计；run 结束在 `finally` 清空引用。daemon 重启会
  安全中止模型调用，不持久化密钥，也不自动重放可能已经产生副作用的工具。
- [x] 删除旧 Side Panel 本地 Agent 工具执行器和已经不可达的“增加执行额度”UI；
  daemon 到达运行预算时停止工具调用并用已有结果总结，避免形成双执行栈。
- [x] 状态化 Network Mock 已支持有界 `scenarioSteps`、`hold-last`/`loop`、命中游标、
  重置和规则级清理；现有诊断回归覆盖两阶段 Mock。
- [x] 元素选择器在 Chat 与 Inspector 两处都随 `elementPickerActive` 切换为明确的
  “取消选择元素”操作；`browser_verify(target_state)` 支持单选和多选控件的
  `value`/`selectedValues`；Agent 最终结果仲裁会拒绝没有成功浏览器 mutation 记录、
  或 mutation 后缺少独立只读验证的成功声明，并只允许一次纠正续轮。
- [x] 现有 CSS 规则/Source Map、Storage/IndexedDB schema、WebSocket/EventSource 计数和
  Service Worker 元数据继续复用。实时摘要默认不加入响应体；需要正文时必须显式调用
  审批受控的响应体工具，避免监听上下文和敏感数据再次失控。

验证边界：Source Map/运行时错误、状态化 Mock、实时活动、daemon Agent 并发/取消/
凭据不进入事件、协议角色和 Side Panel run registry 均有专项测试；当前完整 `ws11`
套件最新 504/504 通过，历史 468/468 仅作为旧协议记录保留。

### R5.1 — 零依赖 Release ZIP 安装

- [x] `package:local` 默认从 Node 官方发布目录获取 macOS arm64、macOS x64、Windows
  x64 便携运行时，读取 `SHASUMS256.txt` 并逐档验证 SHA-256，仅打包 node 可执行文件
  与许可证。
- [x] macOS/Windows 双击入口直接使用 ZIP 内 Node；Windows 入口透传
  `--no-autostart` 等参数，不再探测系统 Node。
- [x] 安装器把便携 Node 与 runtime/extension 一起事务式安装，默认注册 macOS
  LaunchAgent 或 Windows Startup，所有 status/token/daemon 调用继续使用已安装的
  便携 Node。
- [x] 本地 daemon 的 service status/set 同时支持 LaunchAgent 与 Windows Startup。
- [x] README 与中文安装说明明确：ZIP 用户无需预装 Node；Chrome 未上商店时仍必须
  首次开启开发者模式并手动加载 unpacked extension，这是 Chrome 平台限制，不伪装
  成可由普通脚本自动完成。
- [x] 实际下载并校验三套 Node v22.22.0，生成当前 ZIP；macOS arm64 内置 Node
  实际执行 `--version` 成功。包含最新语义游标修复的 ZIP 大小为
  108,429,466 bytes（约 103 MiB），SHA-256 为
  `fbbdf434f0cdb3961a64dc5a57de1125c129cd5cc981ccb210dce03685fe0dc2`。

### R6 — 当前验收与发布

- [x] `npm run typecheck` 在 `ws11` 代码与死分支清理后通过。
- [x] 本轮最后代码变更后，29 个不依赖 loopback 监听端口的目标相关测试文件串行
  174/174 通过；过程中发现并修复 activity stream 顶层 target URL 脱敏、MAIN-world
  CSSOM/视觉事件开关、daemon 工具取消传播和 Agent 断线回放四个回归。`npm run build`
  通过，update notice 写出 `0.1.0+ws11`；便携安装/打包脚本的五项 `node --check` 通过。
- [x] 运行当前完整自动化、`verify:packaged`、三平台便携 Node 打包与 ZIP 事务/
  回滚测试；真实已安装用户目录对正式 GitHub Release 的升级仍由下面独立条目跟踪。
- [x] 完成 `docs/browser-validation-results.md` 中全部 18 项真实浏览器验收，严格门禁
  返回 `complete: true`、`pass: 18`、`notRun: 0`、`fail: 0`。
- [x] 覆盖两个真实 Chrome Profile：不同安装 ID、两个独立 adapter、Tab 列表、
  session/resource 拒绝、审批归属与 adapter 独立退出均完成真实验收。
- [x] 完成 DNR、弹窗、敏感读取、截图/视觉路径、凭据隔离和断线恢复的真实浏览器验收。
- [ ] 使用正式 GitHub Release 资产做一次真实已安装 daemon 的升级；本轮没有发布 Release。
- [x] 历史 `ws10` 已确认 Chrome 扩展与 daemon/MCP buildId 一致：2026-08-03 用全新
  `dist/mcp/server.js` adapter 连接当前 LaunchAgent，三方均返回
  `0.1.0+ws10 / 4e215a6f` 且 `compatible=true`。本线程早先启动的旧 MCP 连接仍需
  由客户端重开；该证据不证明当前 `ws11` 已部署。
- [x] 完成真实双 Tab 任务绑定验收：工作流明确绑定 A2，用户切到 B2 完成约十项独立
  高风险操作审批，最终只修改 A2；B2 的复选框、单选、多选和文本值均保持原样。
- [x] 执行 `stop-slop` 最终检查和 `git diff --check`，同步计划/证据；真实 Chrome
  18 项均由实际操作关闭，不以自动化替代人工证据。
- [x] 当前扩展已在 `chrome://extensions` 重载，Side Panel 目测为“AI 已就绪 / Daemon
  已连接”；LaunchAgent 热重启后两个 Profile 自动恢复。当前 adapter、daemon 与浏览器
  均返回 `0.1.0+ws11 / 0a990f43` 且 `compatible=true`，三方 build identity 一致。
- [x] 用全新 v11 adapter 对真实 A3 fixture 做同 URL、同 DOM 重载测试，发现旧
  snapshot cursor 只绑定语义指纹而未绑定文档。加入 content-script 生命周期文档键后，
  重建并重载扩展，旧游标明确返回 `STALE_SNAPSHOT_CURSOR`；浏览器验收 3.2 已关闭。

## 当前验证基线

- 当前协议源码：`0.1.0+ws11`；任何 `ws10` handshake、buildId、工具 schema hash、
  ZIP checksum 和 468/468 结果都是本轮改动前的历史证据。
- `npm run typecheck`：本轮最新代码通过。
- 完整测试：沙盒外 `npm test` 504/504 通过；其中包括多 Tab/持久化/页面扩展事件、
  Token 预算、参数重试、daemon Agent/断线回放、协议、Source Map、Release 更新、
  自启动和便携包契约。
- `npm run build`：通过；Vite、content、daemon、MCP、status、print-token 和
  update-notice 均生成，build id 为 `0.1.0+ws11`。
- `node --check`：`bundle-portable-node.mjs`、`package-local.mjs`、
  `install-local.mjs`、`manage-local-service.mjs`、`restart-daemon.mjs` 全部通过。
- `npm run verify:browser-evidence:complete`：严格门禁返回 `ok: true`、`complete: true`、
  `errors: []`；18 项均为 `pass`，无 `not-run` 或 `fail`。
- 完整 WebSocket 套件：已在沙盒外进入全部业务断言并通过；历史初跑 483/485 暴露的
  两项任务绑定问题已修复，当前完整套件随全部新增回归一起为 504/504。
- `verify:packaged`：当前 `dist` daemon、两个并行 stdio adapter、私有配置权限、重启与
  独立退出全部通过，报告 90 个工具。
- `package:local`：Node v22.22.0 的 macOS arm64/x64 与 Windows x64 官方资产均完成
  SHA-256 校验，当前 ZIP 与独立 SHA-256 已生成；macOS arm64 内置 Node 可执行。
- `verify:*`：五个命令均有独立职责和现存文档入口，本轮不删除；
  `verify:packaged` 当前结果已通过。
- 当前工作区包含大量用户未提交改动；所有实现保留无关变更，不执行 destructive
  checkout、reset 或清理。

## 主要风险

- GitHub 仓库或发布凭据被攻破时，HTTPS 与 SHA-256 不能阻止恶意发布；若未来面向
  不受信任的大规模用户，应增加离线保管的 Ed25519 发布签名。
- Chrome 对“已解压扩展”不会像商店扩展一样自动刷新；磁盘覆盖后仍必须调用扩展
  重载或让用户到 `chrome://extensions` 重载。
- Windows 和无 LaunchAgent 场景必须由独立重启辅助进程等待旧 daemon 退出后启动
  新版本，不能由正在被覆盖的 daemon 直接自替换后继续运行。
- 多 Tab CDP 会话会增加 debugger 资源占用，必须有显式上限、单流停止和异常清理。
