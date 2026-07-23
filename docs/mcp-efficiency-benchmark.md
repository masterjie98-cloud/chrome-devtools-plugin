# Codex Chrome 与 AI DevTools MCP 单次效率基准

测试日期：2026-07-17

测试环境：本机单用户 Chrome，`Frame routing host` 固定测试页

测试页面：`http://127.0.0.1:8765/index.html`，跨域子 frame 为
`http://localhost:8766/child.html`

## 结论

这次实测不支持“接入 AI DevTools MCP 后，所有页面任务都会提效”的说法。

- 对简单页面读取，MCP 的单次响应更快，但返回数据约为 Codex Chrome 的
  3.9 倍，而且没有展开跨域 iframe。它降低了工具延迟，却增加了模型上下文并
  丢失了一部分页面覆盖。
- 对五字段表单，MCP 能把五个写操作合并成一次审批和一次批量执行，这是明确的
  编排优势；但逐次审批的人工等待使本次端到端时间远高于 Codex Chrome 基线。
- 对 Network，AI DevTools MCP 能返回 CDP 级请求状态和聚合摘要，Codex Chrome
  当前公开能力没有等价的 Network 录制接口。这是本次最明确的能力增益。
- MCP 的长期价值主要在 Network、可审计审批、Profile/页面状态持久化以及
  Codex 与插件 AI 的协作，不在替代 Codex Chrome 已经擅长的普通 DOM 操作。

本报告是 `n=1` 的同页微基准，只能证明本次环境中的实际行为，不能当作跨机器、
跨页面的稳定性能结论。可靠性能结论仍需固定版本后进行至少 10 次重复并报告
中位数和 P95。

## 对照口径

两组都使用同一 Chrome Profile、同一测试页和同一成功条件。

测试任务：

1. 识别顶层页面、表单区域、敏感数据测试区和跨域 iframe 内容。
2. 将 Name、Agree、Choice、Country、Tags 五类控件改为指定值，并独立验证。
3. 重载页面并观察主文档、子 frame 和扩展脚本产生的 Network 请求。

记录指标：

- 工具调用的墙钟时间；
- 模型侧调用数和浏览器边界操作数；
- 模型可见主结果的字符数，用作上下文体积的近似指标；MCP 使用
  `structuredContent` 序列化长度，Codex Chrome 使用返回的 snapshot 文本长度；
- 成功条件和缺失信息。

墙钟时间包含工具调用开始到结果返回的全部时间。AI DevTools MCP 当前没有分别
返回 `approvalWaitMs`、`executionMs` 和 `transportMs`，因此审批调用只能报告含
人工决策的总时间，不能伪造“纯执行耗时”。

## 原始结果

### 1. 冷启动与连接

| 阶段 | 结果 | 时间 |
| --- | --- | ---: |
| daemon 未启动，列 session | `ECONNREFUSED 127.0.0.1:17321` | 56 ms |
| daemon 未启动，列 tab | `ECONNREFUSED 127.0.0.1:17321` | 25 ms |
| daemon 已启动、侧边栏未唤醒，列 session | 有持久 session，但 browser/UI 均未连接 | 36 ms |
| daemon 已启动、侧边栏未唤醒，列 tab | executor 未连接 | 12 ms |
| 打开侧边栏后，列 session | browser/UI 均连接 | 28 ms |
| 打开侧边栏后，列 tab | 返回 20 个 tab | 32 ms |
| 显式选择 session | 成功 | 27 ms |
| 显式选择测试 tab | 成功 | 42 ms |

结论：安全读取并非总能在后台自动唤醒。此次必须打开一次侧边栏才能使浏览器
executor 恢复连接，这是 MCP 的实际冷启动成本。

### 2. 页面结构读取

| 指标 | Codex Chrome | AI DevTools MCP |
| --- | ---: | ---: |
| 调用 | `domSnapshot()` 1 次 | `browser_snapshot` 1 次 |
| 墙钟时间 | 619 ms | 88 ms |
| 结构化输出字符数 | 1,723 | 6,667 |
| 顶层主要区域 | 完整 | 完整，26 个语义节点 |
| 跨域 iframe 内容 | 返回 `Child frame content` | 未展开子 frame |

单次数据中，MCP 响应时间约为 Codex Chrome 的 1/7，但输出体积约为 3.87 倍。
两者返回结构和覆盖范围不同，不能只用延迟宣称 MCP 更高效。对需要 iframe 内容
的任务，本次 MCP 结果不完整。

### 3. 五字段表单

目标状态：

- Name = `Benchmark User`
- Agree = checked
- Choice = B
- Country = United States (`us`)
- Tags = Beta + Gamma (`beta,gamma`)

| 指标 | Codex Chrome | AI DevTools MCP |
| --- | ---: | ---: |
| 模型侧工具调用 | 1 个组合脚本调用 | 3 次：快照、批量填写、验证 |
| 浏览器边界操作 | 5 次修改 + 1 次验证 | 1 次批量修改 + 1 次验证读取 |
| 写操作调用 | 5 | 1 |
| 基线/预读 | 包含在组合调用中 | 52 ms，6,671 chars |
| 写入墙钟时间 | 包含在总计 1,227 ms 中 | 38,811 ms，含人工审批 |
| 写入结果体积 | 包含在 2,064 chars 中 | 1,487 chars |
| 独立验证 | 同一脚本末尾快照 | 30 ms，1,603 chars |
| 成功结果 | 5/5 | 5/5 |

MCP 的事件日志证明：

- 文本、checkbox 和 radio 通过可信 CDP 输入，事件为 `trusted`；
- 单选和多选 `<select>` 使用受限 DOM 选择，事件为 `synthetic`；
- 最终日志包含 `Benchmark User`、`true`、Choice B、`us` 和
  `beta,gamma`，五项均成功。

MCP 的批量写入减少了浏览器写边界和审批次数，但本次 38.811 秒绝大部分是用户
发现并处理审批卡的交互时间。没有分段计时字段，不能把剩余部分宣称为工具纯执行
耗时。本轮 MCP 表单链路的主结果共 9,761 字符，是 Chrome 基线 2,064 字符的
约 4.73 倍；若任务本来已有新鲜快照，写入加验证为 3,090 字符，仍为约 1.50 倍。
若批量写入结果包含可验证的脱敏后状态，还可省去额外验证读取。

### 4. Network 录制

AI DevTools MCP 流程：清空旧记录、开始录制、重载、读取 digest、停止录制。

| 调用 | 墙钟时间 | 输出字符数 |
| --- | ---: | ---: |
| `browser_network_clear` | 19,550 ms | 137 |
| `browser_network_start_recording` | 20,542 ms | 137 |
| `browser_reload` | 34,770 ms | 108 |
| `browser_network_requests(digestOnly=true)` | 22,018 ms | 929 |
| `browser_network_stop_recording` | 22,358 ms | 138 |

五次调用的总墙钟时间为 119.238 秒，全部包含逐卡人工审批。聚合结果成功记录
6 个请求、3 个组：

- 主文档 `GET http://127.0.0.1:8765/index.html`，Document，200；
- 子 frame `GET http://localhost:8766/child.html`，Document，200；
- 扩展脚本 4 次，Script，200，URL 已归一化为 `chrome-extension://`。

`digestOnly=true` 没有返回原始请求行，只返回 929 字符的聚合数据，证明心跳折叠
和低上下文 Network 摘要路径可用。Codex Chrome 本次暴露的 browser capability
只有 `viewport`，tab capability 只有 `pageAssets`，没有等价的请求 method、
status、resource type 或聚合录制接口，因此 Network 项无法做同能力耗时对照。

## 实际提效边界

### 明确有收益

- 一个任务需要成批修改多个控件，并且能在一次审批中完成预检与执行；
- 需要用真实 Network 状态、失败、跳转或请求分组作为任务成功证据；
- 需要把页面证据持久保存给其他 Codex 任务或插件 AI 使用；
- 需要 Profile、tab、document、revision 绑定、审计和写操作审批。

### 当前可能负收益

- 只读一个普通页面或操作一两个稳定控件；
- 任务需要读取跨域 iframe，而语义快照只覆盖顶层 frame；
- 每个 Network 生命周期动作都需要用户分别审批；
- 返回完整语义节点而模型只需要少量可交互控件；
- daemon、extension background 或 sidepanel 尚未唤醒。

## 基于数据的优化优先级

1. 给所有审批工具结果增加 `approvalWaitMs`、`executionMs`、`transportMs`，否则
   无法持续做真实性能分析。
2. 将 `start_recording(preserveLog=false)` 与清空旧记录合并为一次用户意图；
   `stop_recording` 只关闭本地采集，不应再要求独立高风险审批。
3. 让“当前会话 + 当前域名”的用户授权覆盖同一 Network 工作流，并始终保留
   可见的主动关闭开关；目标或会话变化后立即失效。
4. 为 `browser_snapshot` 增加 `interactive`、`outline`、`full` 三种预算模式，
   普通任务默认只返回可交互节点和必要状态；当前 fixture 的目标应低于 2,000
   字符，而不是 6,667 字符。
5. 补齐显式 frame 列举和按 frame 读取，或者让快照在预算内展开可访问 iframe；
   不能把顶层页面成功误报为整页完整。
6. `browser_fill_form` 返回脱敏后的逐字段最终状态和事件类型，使一次批量执行能
   自证结果，减少一次验证调用；敏感文本仍必须省略或脱敏。
7. 安全读取应能由 extension background 自动唤醒，不应要求用户先打开侧边栏；
   只有真正需要审批或插件 AI 接单时才依赖可见 UI。
8. 基准脚本化后固定 Chrome、扩展 build、daemon build 和 fixture revision，运行
   至少 10 次，分别报告 warm/cold 的中位数、P95、失败率和上下文字符数。

## 复现限制

- Codex Chrome 和 AI DevTools MCP 使用不同的返回模型，字符数只是上下文近似值，
  不是 API 账单 token 的精确值。
- Codex Chrome 基线将多个 Playwright 操作放在一次 Node 工具调用内；因此同时
  报告“模型侧调用”和“浏览器边界操作”，避免用单一调用数误导。
- 人工审批速度取决于用户是否正在看审批卡。本轮结果真实体现当前产品交互，但
  不代表浏览器执行引擎本身需要几十秒。
- 本轮没有测试截图理解、复杂 SPA、长任务恢复、断线续接和跨任务协作的收益。

## 2026-07-21 同页复测与改进

在 `http://localhost:5667/overview` 上重新比较了 Codex Chrome 的
`domSnapshot()` 与 AI DevTools 的智能观察入口。以下仍是本机单次小样本，不是
跨环境性能结论。

| 路径 | 热态样本 | 中位数 | 结果字符数 | 覆盖 |
| --- | --- | ---: | ---: | --- |
| Codex Chrome DOM snapshot | 31/23/25/18/19 ms | 23 ms | 3,034 | 交互控件与页面大纲 |
| AI DevTools `browser_observe(interactive)` | 92/42/47/36 ms（排除一次 508 ms 重连样本） | 44.5 ms | 1,603 | 交互控件、状态、`targetRef`、目标新鲜度 |
| AI DevTools `browser_observe(outline)` | 37/38/38/43/53/57/59/65/80/119 ms | 53 ms | 3,459 | 交互控件、页面大纲、`targetRef`、目标新鲜度 |

本轮落地了三项针对实测差距的改进：

- 智能观察不再重复返回 selector、tag、bounds 和页内短 `ref`；这些字段仍由专家
  `browser_snapshot` 提供。`interactive` 结果在本页降到 1,603 字符。
- `browser_observe` 遇到一次目标切换竞态时在内部安全重读一次；连续变化仍返回
  `STALE_CONTEXT`，不会把旧页面结果伪装成新页面结果。
- 默认 `browser_act` 复用现有受控执行器，新增双击、hover、拖拽、滚轮和窗口尺寸
  操作；模型不需要为了这些能力切换到 74-tool 专家表面或退回脆弱坐标调用。

以上数据暴露了两项差距：Codex Chrome 的 DOM snapshot 可在一次结果中展开可访问
iframe，而当时 AI DevTools 仍需 `browser_list_frames`、
`browser_set_target_frame` 后读取；Codex Chrome 热态 DOM 读取在本页也更快。

随后实现的修复如下，数字必须在新 daemon 和新扩展同时加载后重新测量，不能沿用
上表旧值：

- `browser_observe` 默认 `frameScope=auto`，一次并行读取最多 4 个已注册可访问
  frame；`all-accessible` 默认 8、硬上限 12。节点数和 source 字符预算在 frame
  之间分配，失败 frame 作为部分结果明确返回。
- 只有当前选中 frame 返回可执行 `targetRef`；子 frame 标记
  `actionable=false` 并移除引用。要写入子 frame，仍须显式选择并重新观察，不能
  用一次读取绕过 document/navigation 绑定。
- content 侧 `compact` 路径不再构造旧 DOM summary，同一节点只计算一次可见矩形
  和 selector；页面状态同步和只读审计持久化移出 MCP 响应关键路径。
- 自动化验证覆盖默认参数、跨 frame 输出、子 frame 不可执行、游标与多 frame
  冲突拒绝，以及 frame 排序不会改变当前选择。真实热态中位数和 P95 待下方
  运行条件满足后写回本报告。

待执行的真实复测命令与条件：加载最新 `dist`、重启 LaunchAgent，同时启动
`tests/fixtures/frame-host` 的 8765 服务和 `frame-child` 的 8766 服务；随后对
`browser_observe(interactive)` 连续采集至少 10 个热态样本，并确认同一次结果
出现顶层和 child frame。当前受控执行环境禁止监听本机端口，因此本段不伪造
运行结果。
