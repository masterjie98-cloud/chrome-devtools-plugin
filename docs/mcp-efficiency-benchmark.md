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

## 2026-07-23 最新构建真实复测

本轮加载最新 `dist`、重启 LaunchAgent，并启动 8765 顶层 fixture 与 8766
跨源 child fixture。结果如下；墙钟时间是从 Codex 工具调用侧测量，内部执行时间
来自 daemon 的脱敏审计字段。

### 热态 DOM 与 iframe

| 页面与路径 | 10 次热态样本 | 中位数 | P95 | 输出字符数 |
| --- | --- | ---: | ---: | ---: |
| 安装页，Codex Chrome `domSnapshot()` | 53/25/21/16/21/16/17/16/19/25 ms | 20 ms | 53 ms | 7,094 |
| 安装页，MCP `browser_observe(interactive)` | 65/63/61/66/68/64/64/68/63/74 ms | 64.5 ms | 74 ms | 4,143–4,145 |
| iframe fixture，Codex Chrome `domSnapshot()` | 60/18/17/15/16/18/21/23/17/19 ms | 18 ms | 60 ms | 1,723 |
| iframe fixture，MCP `browser_observe(auto)` | 80/43/44/43/41/39/38/38/39/39 ms | 40 ms | 80 ms | 约 3,727 |

MCP 同一次结果包含顶层 19 个节点和跨源 child frame 2 个节点，且 child 明确
标记 `actionable=false`、不返回 `targetRef`；因此“一次观察所有可访问 frame”
真实通过，同时没有放宽写操作的 document/navigation 绑定。

content 侧热态扫描通常只有 0.2–2.1 ms；daemon 审计中的观察总耗时通常为
7–11 ms，`queueWaitMs=0`。模型侧 40–65 ms 的主要差额来自 stdio/MCP 编排和
结果传递，不是 DOM 扫描。因此下一步应优先用组合工具摊薄往返，而不是继续微调
节点扫描。

iframe fixture 上，MCP 结果约为 Codex Chrome 的 2.16 倍。额外体积主要来自
frame provenance、freshness、分页和 timing；这些字段有安全价值，但应支持投影，
避免每个 child frame 重复页级元数据。

### 批量动作、验证与截图

同一 fixture 上，Codex Chrome 用 5 次控件操作加一次页面内验证，共 682 ms。
MCP 用一次 `browser_act` 完成文本、checkbox、radio、单选和多选共 5 项：

- 审计 `executorMs=324`、`transportMs=314`、`queueWaitMs=1`；
- 人工审批等待为 81,802 ms，不属于浏览器执行耗时；
- 页面真实值复核为 `MCP Benchmark 20260723`、`true`、`b`、`us`、
  `beta,gamma`，5/5 成功。

这证明批量动作的执行效率已经优于逐控件往返，但审批发现成本会完全淹没引擎收益。
审批模式应对当前聊天与当前域名提供清晰常驻状态，并把决策屏障与普通表单动作区分。

`browser_verify` 能正确验证 checkbox/radio，却不能用 `selected=true` 验证
`<select>` 当前值；页面真实状态虽正确，验证结果仍为 false。这是验证协议缺口：
应增加 `value` / `selectedValues`，不能要求模型再换一套读取工具。

截图对照中，Codex Chrome 截图墙钟为 101 ms；MCP 截图审计
`executorMs=81`，扣除审批后的总耗时为 82 ms。MCP 返回真实 `image/png`
Base64 和 artifact URI，`structuredContent` 不含 `dataUrl`，且未写入 Chrome
Downloads。一次 Network + Console 摘要的 `executorMs=25`、结果 597 字符；
空白 fixture 正确返回零请求和零控制台消息。

### 复测发现的运行时一致性缺口

首次调用新参数 `frameScope` 时，工具 schema 已更新但旧 daemon 仍返回
`Unrecognized key: "frameScope"`；重启 LaunchAgent 后立即恢复。这不是页面能力
问题，而是 adapter/daemon/extension 版本不一致。`browser_status` 应公开三端
build ID、schema hash 和兼容状态，并在不一致时提前给出可执行的重启提示，不能
等到业务调用才暴露参数错误。

### 基于最新数据的集成优先级

1. 增加一个受限 `browser_workflow`：一次完成观察、最多 20 个动作、确定性验证、
   URL/DOM delta 和可选 Network/Console 证据；跨导航或决策点仍保留 barrier。
   这是当前最高收益项，可直接摊薄每次 40–65 ms 的 MCP 固定往返。
2. 给验证协议增加 `value`、`selectedValues`、`textValue` 和逐动作 post-state，
   让一次批量写入能自证，消除额外查询。
3. 增加 runtime version/schema handshake 与 readiness：adapter、daemon、
   extension build 不一致时 fail-fast，并支持安全读取链路自动恢复。
4. 把动作前后窗口内的 DOM delta、路由、非心跳 Network、Console error 自动
   关联成 operation evidence；不要让模型分别启动、读取、停止录制。
5. 允许观察结果中的 child frame 携带只读 `frameRef`，动作工具显式消费
   `frameRef + documentId + targetRef` 后直达该 frame；仍须重新授权和校验新鲜度，
   从而省掉 list/set/re-observe 三次往返。
6. 增加结果投影和预算：例如 `fields`、`roles`、`includeFrames`、
   `includeFreshness`，并去除 child frame 重复页级元数据。
7. 增加元素裁剪图、截图 hash/diff 和变化区域，只在语义证据不足或视觉状态变化时
   回传像素；避免每轮发送整张截图。
8. 暴露订阅式 page/network/console delta 资源，让 Codex 在页面变化时收到通知，
   而不是轮询相同 DOM。

### 2026-07-23 实现状态

上述第 1–7 项已在当前工作树实现：`browser_workflow`、动作后状态、
`value/selectedValues`、build/schema 握手、关联证据、直接 iframe 引用、字段
投影、元素截图与截图 diff 已进入代码和自动化测试。第 8 项“订阅式增量资源”仍
未实现。

本节只记录实现状态，不伪造新的真实浏览器时延。完成扩展重新加载后，应运行：

```bash
npm run verify:workflow-evidence -- \
  --tab-url-prefix http://127.0.0.1:8765/
```

再把同一代码状态的墙钟时间、结果字符数和图像字节变化追加到本文件。

## 2026-07-24 组合工作流真实验收

在相同 8765 顶层 fixture 与 8766 跨源 child fixture 上，最终构建通过
`verify:workflow-evidence`。本轮用于正确性验收，没有把人工审批等待混入性能数据，
也没有补造新的中位数或 P95。

- 三端兼容身份一致：`0.1.0+ws7 / f085f1dd`。
- 一个 `browser_workflow` 完成 4 个顶层表单动作，返回 4 个 post-state，并在同一
  结果中完成文本值、checkbox、单选与多选值验证。
- 同一结果携带 DOM、URL、Network、Console 四类证据，不再要求模型分别开启和读取
  录制器。
- 重新观察后的 `frameRef + documentId + targetRef` 完成 1 个 OOPIF 写动作；后续
  观察确认 child input 为 `direct-frame-value`。
- 两次相同元素截图的第二次结果为 `changed=false`、
  `changedPixelRatio=0`、`baselineAvailable=true`，且未重复返回 image bytes。

验收过程中暴露并修复的真实成本点：

1. snapshot 引用按 generation 失效，独立后续动作必须重新观察，不能复用工作流前
   的旧 `frameRef`；
2. Chrome MV3 service worker 中 `fetch(data:)` 不可靠，截图 diff 改为本地 Base64
   解码到 `Blob`；
3. child trusted input 必须同时覆盖独立 OOPIF session 和同进程 frame。OOPIF 在
   顶层 CDP 树缺失时只按唯一活跃 URL 关联；重复 sibling URL 继续失败关闭；
4. 扩展重新加载后，已打开页面必须刷新才能重新注册 content scripts。这是开发态
   装载前置条件，不计入运行时任务性能。

## 2026-07-27 增量诊断链路真实验收

本轮继续使用 8765 顶层 fixture、8766 跨源 child fixture，并新增同源
same-process iframe 与固定诊断请求。它是正确性回归，不是新的性能样本，因此不
复用旧中位数或补造 P95。

- 三端兼容身份一致：`0.1.0+ws8 / 3fd82d5a`。
- Smart Profile 实际暴露 20 个任务工具；当前打包 adapter 总计暴露 84 个 MCP 工具。回归
  过程中发现并修复了“工具已实现但未进入公共暴露顺序表”的注册缺陷。
- `resources/subscribe` 收到活动资源的 `resources/updated` 通知；一次资源读取
  包含 `console`、`dom`、`navigation`、`network` 四类有序增量事件，无需轮询。
- 固定按钮触发的 `/activity-fixture.json` 请求被关联到动作
  `activity-trigger`，置信度为 high；理由同时包含受限动作时间窗和 CDP initiator
  stack，未把时间邻近伪装成确定因果。
- 一次观察返回两个可操作 child frame。OOPIF 与 same-process frame 都通过
  `frameRef + documentId + targetRef` 完成直接输入，独立观察分别验证
  `direct-frame-value` 与 `same-process-after`。
- 纯 HTML 按钮的源码定位返回 `matched=true`、`framework=unknown`，证明未在缺少
  React/Vue 元数据时虚构组件归属。
- 问题证据包返回 session artifact URI；JSON manifest 不包含 inline data URL，
  截图仍作为独立受限 artifact 保存。
- 自动化最终为 338/338 通过；TypeScript、生产构建和 diff whitespace 检查通过。

### 下一批高收益能力（当前实现状态）

1. **CSS 级解释已实现 V2。** `browser_explain_css` 返回 matched rules、computed
   values、CSS 变量、box model、生成样式表来源，以及同源可读样式表的原始
   source-map sources；React/Vue/JavaScript 归属继续由
   `browser_locate_source` 负责。
2. **最小复现协议已实现 V1。** 配方写入 session artifact，重放前校验 URL，重新
   走审批和 execution grant；未知状态写操作不自动重放。
3. **本地工作区源码桥已实现 V1。** `browser_find_workspace_source` 只扫描
   `AI_DEVTOOLS_WORKSPACE_ROOTS` 或 adapter cwd，限制 5,000 文件、512 KiB/文件和
   50 个结果，可选返回 1,500 字符 excerpt。
4. **性能诊断已实现 V2。** 返回 Navigation/Resource Timing、buffered LCP、
   layout shift、Long Task、bounded interaction/INP 和 trace summary；动作到
   Network/组件/源码的因果关联仍由 activity correlation 单独给出置信度。
5. **实时应用摘要已实现 V1。** 返回无正文的 WebSocket/SSE 计数、Service Worker
   元数据和 IndexedDB schema；现有订阅资源仍负责 DOM/Network/Console 增量。
6. **状态化 Mock 已实现。** 现有代理规则支持最多 50 个响应步骤、
   `hold-last/loop`、持久化游标/命中数与显式 reset。

当前自动化为 370/370，生产构建和 86-tool 打包进程验证通过。

## 2026-07-28 Diagnostic Automation V3 真实验收

在刷新后的 8765 顶层 fixture、跨源 OOPIF 和同源 same-process iframe 上，
`verify:workflow-evidence` 最终返回 `"ok": true`。本轮仍是正确性验收，不把人工
审批耗时写成浏览器执行性能，也不补造中位数或 P95。

- 三端兼容身份一致：`0.1.0+ws8 / 91428723`。
- 四动作 `browser_workflow` 返回四个 post-state，验证通过，并同时返回
  DOM、URL、Network、Console 四类证据。
- OOPIF 和 same-process iframe 都以 `frameRef + documentId + targetRef` 完成
  直接动作并由新观察验证。
- 相同元素的第二次截图 diff 为 `changed=false`、`changedPixelRatio=0`、
  `baselineAvailable=true`。
- 增量活动包含 console、DOM、navigation、network；固定请求的动作因果置信度为
  high。
- CSS 解释返回一条匹配规则和 180px box width；未发现原始 CSS source hint，
  因而没有虚构 source-map 归属。
- 本地源码桥扫描 212 个受限文件，命中 `src/mcp/workspaceTools.ts`。
- 可复现配方重放完成且验证通过；性能诊断返回 Navigation/FCP/LCP/Long Task
  数据；实时摘要返回 IndexedDB 的数据库、版本和 store schema。
- Stateful Mock 在两次命中后到达 step index 1，验证通过。
- 问题证据包完成并返回 session artifact URI；截图 diff 没有以内联 data URL
  混入 structured content。

当前仍明确不读取 WebSocket/SSE 正文和 IndexedDB 值。CSS source map 只解析
同源可读资源；跨源或无 map 的生产 bundle 会返回空 source hint，不虚构归属。
