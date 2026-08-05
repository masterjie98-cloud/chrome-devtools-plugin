# Cherry Studio 聊天交互对比与改造方案

> 状态：方案稿，不包含业务代码改动
>
> 当前项目：`/Users/Copy_Master/Desktop/chrome-devtools-plugin`
>
> 对照版本：Cherry Studio `51549cb199bad3c0821bf17874319dacfdad1d8b`
>
> 调研日期：2026-08-05

## 1. 结论

当前项目和 Cherry Studio 的主要差距不是颜色、圆角或字号，而是聊天内容的表达模型不同：

- 当前项目以扁平的 `ChatMessage[]` 直接渲染用户消息、AI 消息和每一次工具结果。
- Cherry Studio 先把消息投影为 text、reasoning、tool、artifact 等 part，再把相邻工具调用组成一个“执行过程”，把最终答案留在执行过程之外。
- 当前项目已有更严格的工具审批作用域、Tab/会话绑定、daemon 恢复、上下文安全预算和结果脱敏，不能为了模仿 Cherry Studio 而削弱这些能力。
- 当前项目现在最应补的是“状态到视图的统一投影层”，其次才是 compact disclosure、审批条和视觉样式。

目标不是复制 Cherry Studio，而是采用它验证过的交互原则，并保留当前项目在浏览器控制、安全审批和可恢复执行方面的优势。

## 2. 范围与非目标

本方案覆盖：

- MCP 与内置工具的分组、命名和展开详情。
- 工具审批的紧凑交互和自动运行边界。
- 上下文占用的来源、类别和可信度展示。
- Markdown、表格与报告正文的稳定渲染。
- Agent 执行进度、取消、恢复和终态展示。
- 侧栏窄宽度下的信息密度、键盘操作和可访问性。

本方案不包含：

- 替换现有 Ant Design 或引入 Cherry Studio 的 UI 依赖。
- 改变现有工具授权、安全作用域、出站目标和脱敏规则。
- 用 UI 折叠掩盖重复 MCP 调用、卡死或上下文溢出。
- 直接迁移 Cherry Studio 的 Claude Agent 专属状态或 token 分类。
- 本文档阶段修改业务代码。

## 3. 真实源码对照

| 关注点 | 当前项目 | Cherry Studio | 采用方向 |
| --- | --- | --- | --- |
| 消息模型 | `src/sidepanel/types.ts` 的 `ChatMessage` 是扁平消息；工具名、请求参数和结果作为消息字段保存 | `MessagePartsRenderer.tsx` 按 text、reasoning、tool、artifact 等 part 投影 | 先增加只读 presentation adapter，不立即迁移持久化格式 |
| 工具列表 | `ChatPanel.tsx` 对每条 tool message 单独输出一行 | 连续 tool parts 进入 `ToolBlockGroup`，历史过程整体折叠 | 按同一 turn/run 分组；组内仍保留每个真实调用 |
| MCP/内置命名 | 已有 `toolSource`、`toolDisplayName`、`toolServerName`，但部分位置仍可能暴露编码后的原始工具名 | 单个 MCP 行显示 server/tool，状态与自动审批标记明确 | 主行使用来源徽标、可读工具名、Server；原始名只放详情 |
| 展开交互 | `ChatPanel.tsx` 内用 `expandedToolMessages` 管理每条消息 | `ToolDisclosure.tsx` 提供受控/非受控 disclosure、延迟挂载、滚动锚定和 ARIA | 抽出项目内通用 disclosure，继续使用现有 tokens |
| 工具审批 | `PendingToolApproval` 已包含策略、来源、目标、预览、出站目标和外部 MCP 信息 | `useToolApproval.ts` 统一审批状态并使用 optimistic submitted；审批由 composer 区域接管 | 保留当前安全信息，默认只显示必要摘要，详情按需展开 |
| 自动运行 | 当前项目已有多种执行模式和按会话/来源失效的授权 | Cherry hook 支持 MCP 工具自动审批，并维护禁用列表 | 自动运行必须显式、可撤销且有清晰作用域；不默认扩大到整个 Server |
| 上下文占用 | `aiContextUsage.ts` 已有窗口、输入预算、输出/安全预留、类别和压缩计数，但部分是估算 | `ContextUsageSummary.tsx` 展示模型返回的 token 类别；消息级详情按需加载 | 保留当前预算信息，新增“实测/估算”来源和置信提示 |
| Markdown | `MarkdownContent.tsx` 使用 ReactMarkdown + GFM，并在显示层修复扁平 Markdown/异常表格 | `ChatMarkdown.tsx` 区分流式与终态渲染；表格组件保留源位置并支持复制/导出 | 根治存储和流式边界，逐步降低显示层启发式修复的职责 |
| 最终报告 | AI 最终内容与工具行位于同一扁平时间线 | 执行过程可折叠，最终 substantive answer 独立显示；artifact 在流结束后渲染 | 把“过程”和“用户可依赖的最终答案”设为两个视图层级 |
| Agent 状态 | `agentRunRegistry.ts`、daemon `agentRunner.ts`、`agentSession.ts` 分别管理本地运行、持久执行和事件 | live/terminal projection 明确区分 running、paused、cancelled、done | 建立单一的展示状态机，从 AgentSession 快照投影 UI |

## 4. 必须保留的当前优势

### 4.1 审批安全边界

当前审批对象能表达：

- conversation、origin、Tab、session 等作用域。
- 页面目标、策略类别、审批模式和出站目标。
- Profile、Provider、目标页面或会话变化后的授权失效。
- MCP 与内置浏览器工具的不同来源。

这些信息不应从数据模型删除。UI 可以默认折叠，但审批决策仍必须基于完整数据。

### 4.2 daemon 可恢复执行

当前项目已有 daemon Agent session、事件摘要、取消和恢复入口。Cherry Studio 的 UI 分组不能替代这层持久执行能力。展示层应消费 daemon 的真实状态，而不是用组件是否存在来判断“运行中”或“已取消”。

### 4.3 上下文预算与压缩披露

当前上下文模型能展示：

- context window。
- input budget。
- output reserve 和 safety reserve。
- 被压缩或省略的历史条目。

这些对浏览器 Agent 长流程尤其重要，应继续保留。不能为了界面简洁只显示一个无法解释的百分比。

### 4.4 工具结果虚拟化和脱敏

大结果已有虚拟化、截断和脱敏边界。新的 disclosure 只能改变呈现，不得重新把完整敏感参数或响应保存到聊天历史。

## 5. 目标交互模型

### 5.1 先投影，再渲染

建议新增只读展示模型，不直接替换 `ChatMessage` 持久化契约：

```ts
type ChatTimelineItem =
  | { kind: "message"; messageId: string }
  | { kind: "process"; runId: string; items: ToolProcessItem[]; state: ProcessState }
  | { kind: "approval"; approvalId: string; runId?: string }
  | { kind: "report"; messageId: string };
```

投影规则：

1. 同一 conversation、turn/run 内连续的工具调用进入同一个 process group。
2. reasoning/progress 可进入 process group，但最终回答不能被折叠进去。
3. 用户消息、最终回答和需要立即处理的错误保持时间线一级内容。
4. reload 后使用同一规则从持久消息和 AgentSession 重建，不依赖组件临时状态。
5. tool group 只做视觉分组，不合并、跳过或伪造真实调用。

### 5.2 工具过程组

折叠态主行建议：

```text
[MCP] Prometheus Infra MCP · 8 次调用 · 7 成功 · 1 失败 · ≈3.2k tokens  >
```

单项主行建议：

```text
[MCP] prometheus_query  Prometheus Infra MCP       ≈131 tokens · 完成  >
[内置] browser_verify  当前页面                    ≈420 tokens · 失败  >
```

规则：

- `MCP` 与 `内置` 必须是来源，不再统称为“工具”。
- 首要名称使用 `toolDisplayName`；缺失时才回退到稳定的短名称。
- `extmcp__...` 等编码名不出现在主行，只在详情的“原始工具 ID”显示。
- 组标题优先级：等待审批 > 执行中 > 失败 > 已取消 > 完成。
- 展开后显示每次调用的参数摘要、结果摘要、耗时、token、错误和重试关系。
- 真实重复签名必须以“重复调用 ×N”披露，不能只被折叠成一条正常成功记录。

### 5.3 审批交互

审批默认使用紧凑的 composer 上方操作条：

```text
[MCP] prometheus_query · Prometheus Infra MCP
是否运行此只读查询？                         [取消] [运行 v]
```

交互要求：

- 只有当前会话的活动审批进入 composer 操作条。
- 其他会话审批通过顶部计数/收件箱提示，不把旧审批卡插入当前聊天。
- 主行只显示“谁、做什么、风险级别”；参数、目标、出站地址和策略依据在 disclosure 内。
- 点击后立即进入“提交中”，禁用重复点击，等待 daemon 确认后进入终态。
- “仅本次允许”始终可见；持续自动运行放在运行按钮的菜单中，并写明作用域。
- MCP 自动运行至少区分单工具、单 Server 与当前对话；默认不扩大授权。
- 页面写入、任意 JS、调试器、敏感读取等高风险工具不得被只读 MCP 的自动运行设置覆盖。

### 5.4 上下文占用

继续使用当前 context budget 数据，展示层改为：

- 常驻只显示百分比和 token：`40% · ≈50.7k / 128k`。
- 展开显示系统提示、工具定义、对话、页面上下文、MCP/工具结果、协议开销。
- 明确标记 `实测` 或 `估算`；无法得到 Provider tokenizer 时不得显示成精确值。
- 展示输出预留、安全预留和压缩条目数量。
- 75% 进入提醒态，90% 进入风险态；不使用大面积纯红色制造持续警报。
- 单个工具结果行显示本次输入规模，帮助定位“哪个结果推高上下文”。

### 5.5 Markdown 与报告

最终目标不是继续增加正则补丁，而是保证“模型原文 → 保存 → 重载 → 渲染”不丢失结构：

1. 流式接收阶段保留原始字符和换行，不把多个 delta 先 `trim` 再拼接。
2. streaming 与 terminal 使用不同投影，但终态都基于同一份原始 Markdown。
3. 未完成表格只在 streaming view 做容错；终态不重写模型原文。
4. 持久化保存原始 Markdown；兼容修复只能作为旧数据的带版本迁移。
5. 报告正文独立于 process group，工具错误、停止原因和安全提示不混入报告第一段。
6. GFM 表格提供横向滚动；复制优先保留 Markdown，富文本复制和导出可后置。

### 5.6 任务进度、取消与恢复

展示状态统一为：

```text
idle -> starting -> running -> waiting_approval
     -> cancelling -> cancelled
     -> completed | failed | blocked
```

要求：

- `取消` 先进入 `cancelling`，收到 daemon 终态后显示 `cancelled`。
- 取消后按钮变为“重新运行”或“继续”，不保留失效的停止按钮。
- reload 后从 AgentSession 快照重建状态，不把旧的本地 `AbortController` 当作运行证据。
- 新消息不会静默覆盖旧 run；产品层需明确选择“排队”“取消后发送”或“新建对话”。
- 卡住时显示最后事件时间、当前阶段和可恢复动作，而不是无限 pending。
- `blocked`、`failed`、`cancelled` 必须在视觉和文案上区分。

## 6. P0：先修正确性和状态真相

### P0-1 展示投影层

涉及文件：

- `src/sidepanel/types.ts`
- `src/sidepanel/App.tsx`
- `src/sidepanel/components/ChatPanel.tsx`
- 建议新增 `src/sidepanel/services/chatPresentation.ts`
- `src/shared/agentSession.ts`

工作项：

- 为消息补充稳定的 run/turn/toolCall 关联，或从 AgentSession 事件可靠推导。
- 把扁平消息转换为 `ChatTimelineItem[]`。
- 区分执行过程、审批、最终回答和报告。
- 对历史旧消息提供兼容投影，不一次性迁移所有数据。

验收：

- 20 次连续 MCP 调用默认显示为一个过程组，展开后仍能看到 20 个真实调用。
- 过程组之后的最终回答始终可见，不随组折叠。
- 刷新侧栏前后分组、终态和最终回答一致。
- 不同 conversation/run 的调用绝不错误合并。

### P0-2 重复调用与无进展不能被 UI 隐藏

涉及文件：

- `src/sidepanel/services/autonomousAgent.ts`
- `src/shared/agentRunBudget.ts`
- `src/daemon/agentRunner.ts`
- `tests/agentRunBudget.test.ts`
- `tests/daemonAgentRunner.test.ts`

工作项：

- 使用稳定参数签名识别完全重复、交替重复和“结果不变但参数轻微漂移”的无进展。
- 把重复判定、终止原因和最后有效证据写入 AgentSession 事件。
- UI 分组显示重复次数和停止原因。
- 保留模型自主探索空间，硬限制只作为安全兜底；优先依赖无进展判定和上下文预算。

验收：

- 同工具同参数同结果连续重复不会无限执行。
- 不同参数的合理批量查询不会被错误当作重复。
- 达到安全预算时文案说明是系统预算触发，不能写成“用户选择停止”。
- 停止后下一次 run 能正常启动，不出现残留 session 导致 daemon start 超时。

### P0-3 统一运行终态

涉及文件：

- `src/sidepanel/services/agentRunRegistry.ts`
- `src/sidepanel/App.tsx`
- `src/daemon/agentRunner.ts`
- `src/shared/agentSession.ts`
- `src/sidepanel/components/ChatPanel.tsx`

工作项：

- 建立由 daemon session 驱动的展示状态。
- 明确 starting、running、waiting approval、cancelling 和 terminal。
- 清理 conversation 切换、新建对话、侧栏重载后的临时 UI 状态。

验收：

- 取消后 daemon run、审批和 UI 都进入一致终态。
- 关闭并重新打开侧栏后不会出现幽灵“停止”按钮。
- 正在其他对话运行的任务只显示顶部提醒，不污染当前对话。

### P0-4 Markdown 原文不变性

涉及文件：

- `src/sidepanel/components/MarkdownContent.tsx`
- `src/sidepanel/services/aiClient.ts`
- `src/sidepanel/services/chatWorkspace.ts`
- `src/sidepanel/App.tsx`
- `tests/markdownContent.test.ts`
- `tests/chatWorkspace.test.ts`

工作项：

- 增加 delta 拼接、保存和恢复的原文一致性测试。
- 查清换行丢失发生在 Provider stream、消息累积还是持久化边界。
- 把旧数据修复与新数据正常渲染分开。

验收：

- 同一回答在流式完成、切换对话、关闭重开侧栏后 Markdown 源字符串一致。
- GFM 表格、列表、代码块、段落和中英文混排均保持结构。
- 未闭合流式表格不会破坏后续终态表格。
- 模型的过程性英文不能因为内部提示拼接泄漏到最终报告。

## 7. P1：统一主要交互

### P1-1 ToolProcessGroup 与 ToolDisclosure

涉及文件：

- `src/sidepanel/components/ChatPanel.tsx`
- 建议新增 `src/sidepanel/components/ToolProcessGroup.tsx`
- 建议新增 `src/sidepanel/components/ToolDisclosure.tsx`
- `src/sidepanel/styles.css`
- `src/sidepanel/toolResultPresentation.ts`

工作项：

- 提取 disclosure 的 open state、延迟挂载、滚动锚定和键盘行为。
- 设计 MCP/内置来源徽标、可读名称、Server、副信息和状态。
- 组头提供调用总数、成功/失败/取消和 token 汇总。

验收：

- 320px、420px、680px 宽度不溢出，名称正确省略，状态不换成第二个边框。
- Enter/Space 可展开，`aria-expanded` 正确，focus-visible 清晰。
- 大工具结果折叠时不挂载昂贵内容，展开仍沿用虚拟化。
- “工具结果已收起”不占第二行；token 与状态留在同一主行。

### P1-2 紧凑审批 Dock

涉及文件：

- `src/sidepanel/components/ChatPanel.tsx`
- `src/sidepanel/agentRunApprovals.ts`
- `src/sidepanel/App.tsx`
- `src/sidepanel/styles.css`

工作项：

- 将活动审批从大卡片收敛为 composer 上方的紧凑操作条。
- 保留详情 disclosure 和高风险提示。
- 增加 optimistic submitted，防止审批后短暂重复显示。
- 后台审批通过计数入口进入对应会话处理。

验收：

- 审批主行在窄侧栏中一屏可读，无嵌套双边框。
- 点击运行/取消后按钮立即锁定且只提交一次。
- 新建对话不显示旧对话审批；顶部计数仍能找到旧任务。
- 持续授权的作用域和失效条件可见、可撤销。

### P1-3 上下文占用可信度

涉及文件：

- `src/shared/aiContextUsage.ts`
- `src/shared/tokenEstimate.ts`
- `src/sidepanel/components/ChatPanel.tsx`
- 建议新增 `src/sidepanel/components/ContextUsagePopover.tsx`
- `src/sidepanel/services/aiClient.ts`

工作项：

- 将 Provider 返回 usage 与本地估算统一为带 `source` 的 snapshot。
- 显示类别、预留、压缩和最大窗口来源。
- 工具行 token 使用同一估算器和同一格式。

验收：

- 分类合计与总量误差有明确解释。
- Provider 实测存在时优先显示；否则明确写 `≈` 和“估算”。
- 模型切换后 window 与百分比即时更新，不沿用旧模型。

### P1-4 进度和取消反馈

涉及文件：

- `src/shared/agentSession.ts`
- `src/sidepanel/App.tsx`
- `src/sidepanel/components/ChatPanel.tsx`
- `src/sidepanel/services/backgroundConversationWork.ts`

工作项：

- 在过程组头显示当前阶段、最近事件和耗时。
- 正在审批、模型分析、工具执行和取消中采用不同状态文本。
- terminal 后移除持续动画和停止按钮。

验收：

- 用户能区分“模型正在思考”“工具等待响应”“等待审批”“连接已断开”。
- pending 超过阈值后提供诊断入口，而不是一直显示 0 秒等待。
- 取消、失败、被策略阻止和上下文不足的文案不混用。

## 8. P2：增强报告和诊断体验

### P2-1 报告 artifact

建议将长报告作为显式 artifact，而不是普通工具结果或过程消息：

- 报告正文在工具过程完成后渲染。
- artifact 保存标题、Markdown 源、数据来源摘要和生成时间。
- 过程错误可以附注，但不能替代或污染报告正文。

涉及文件：

- `src/sidepanel/types.ts`
- `src/sidepanel/components/ChatPanel.tsx`
- `src/sidepanel/components/MarkdownContent.tsx`
- `src/sidepanel/services/chatWorkspace.ts`

### P2-2 表格能力

- 横向滚动与固定可读边界。
- 复制 Markdown 表格。
- 富文本复制。
- CSV/XLSX 导出仅在真实数据结构稳定后提供，不从已渲染 DOM 猜测数据。

### P2-3 消息级性能诊断

- 模型等待、工具执行、审批等待、传输和渲染分段耗时。
- 只在详情中按需加载，不占聊天主线。
- 用于解释“为什么卡住”，不展示不可信的伪精确数字。

## 9. 不要照搬 Cherry Studio 的部分

1. 不引入 Cherry Studio 的 Tailwind、组件库或整套消息系统依赖。
2. 不用英文工具名正则作为唯一语义分类器。当前项目应优先使用工具注册元数据、策略类别和 MCP Server 信息。
3. 不复制当前 Cherry commit 中偏大的审批 composer 卡。用户已经明确偏好紧凑的 Cursor 风格审批行。
4. 不照搬 Claude Agent 专属 token 分类；当前项目需要兼容 OpenAI-compatible、Kimi、本地模型等 Provider。
5. 不删除当前审批中的 origin、Tab、session、egress 和高风险信息，只在默认视图中降噪。
6. 不把完整工具参数、Cookie、响应体或敏感结果写回持久聊天。
7. 不把多个真实调用合并为一个调用。分组只是视觉投影，重复执行仍要被系统检测和披露。
8. 不用大量嵌套卡片、玻璃背景、阴影或新颜色体系。继续使用项目现有 Ant Design tokens 和紧凑边框。
9. 不让“最终报告漂亮”优先于证据正确。事实、推断、缺失数据和失败查询必须可追溯。

## 10. 建议实施顺序

### 阶段 A：契约和回归基线

- 为同一 run 的多工具调用、审批、取消、恢复和 Markdown reload 建 fixture。
- 冻结现有安全与脱敏行为。
- 记录当前 320/420/680px 侧栏截图。

### 阶段 B：presentation adapter

- 新增 `chatPresentation.ts`。
- 先保持旧组件视觉，只替换数据投影。
- 验证分组不改变实际调用数量和消息持久化。

### 阶段 C：compact UI

- 新增 `ToolDisclosure`、`ToolProcessGroup` 和 approval dock。
- 统一名称、来源、状态、token 和详情。
- 完成键盘、焦点、窄宽度与大结果验证。

### 阶段 D：Markdown/报告边界

- 修正原始 delta、持久化和重载。
- 再逐步减少显示层启发式修复。
- 最后增加 report artifact 和表格复制/导出。

### 阶段 E：真实联调

- 多轮 MCP 查询。
- 大结果截断和上下文压缩。
- 审批、取消、断连、侧栏重载和 daemon 重启。
- 多 conversation 与多 Profile。

## 11. 总体验收清单

- [ ] MCP 与内置工具主行来源清晰，编码原始名不污染 UI。
- [ ] 连续调用进入一个过程组，最终答案永远独立可见。
- [ ] 展开后每个真实调用、参数、错误、重试和 token 可追溯。
- [ ] 重复调用不会被分组隐藏，Agent 能因无进展而正确收尾。
- [ ] 审批只出现在所属会话，后台审批通过顶部入口处理。
- [ ] 持续自动运行有明确作用域、风险、撤销和失效条件。
- [ ] 上下文用量区分实测与估算，显示预留和压缩。
- [ ] Markdown 在流式结束、保存和重载后三次结果一致。
- [ ] 表格、列表、代码块和报告正文不依赖临时正则补丁维持结构。
- [ ] cancelled、failed、blocked、completed 的状态和按钮完全不同。
- [ ] 侧栏重载后不出现幽灵运行、幽灵审批或错误的回到底部按钮。
- [ ] 320px、420px、680px 宽度完成视觉和交互验证。
- [ ] 工具结果虚拟化、敏感信息脱敏和审批安全作用域无回归。

## 12. 与现有设计文档的关系

`docs/chat-experience-redesign.md` 描述了当前项目已实施或正在验收的聊天体验方向。本文不是替代它的事实记录，而是：

- 补充 Cherry Studio 源码对比证据。
- 把后续工作从“继续调 CSS”提升为 presentation architecture。
- 明确重复调用、终态、Markdown 原文和最终报告是 P0 正确性问题。
- 给出可以分阶段落地、又不破坏现有安全能力的文件映射与验收标准。

实施前应先核对两份文档与当时实际源码；真实源码和运行证据始终优先。
