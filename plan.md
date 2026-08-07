# MCP 大结果与三方协作聊天实施计划

## 目标

1. 外部 MCP 工具即使没有分页能力，也不能因为结果超过本地 1 MiB 限制而被改写成失败。
2. 大结果必须完整保留，由模型按需读取、搜索和提炼；主对话上下文只接收模型真正使用的证据，不使用不可恢复的固定截断作为最终结果。
3. 在现有只读 MCP 协作时间线之上，让用户后续可以加入 `MCP 后端 AI` 与 `插件 AI` 的任务聊天。

## 已确认边界

- 外部 MCP 调用成功与本地结果承接是两件事；本地不得把已成功返回的大结果伪装成远端调用失败。
- 原始结果保存在当前 Chrome Profile / 会话绑定的 artifact 中，沿用现有 TTL、单件大小和会话配额。
- 模型侧通过受限的读取/搜索工具访问 artifact，单次返回保持有界；完整原文仍可继续读取和追溯。
- 不额外静默调用第二个模型，不把任意大小的结果一次性塞进主上下文。
- 三方聊天第一阶段保持任务时间线与聊天消息分离；任务完成状态不等于聊天通道关闭。

## Phase 0：修复外部 MCP 大结果与显示回归

- [x] 删除 `externalMcpRegistry` 中超过 1 MiB 就返回 `isError` 的误拒绝逻辑，仅保留序列化与重复结构内容去重。
- [x] 外部 MCP 的大 JSON 结果进入现有 artifact 外置链路，完整保存原始结果并向 Agent 返回 artifact 元数据与结构概览。
- [x] 新增只读 artifact 检查工具，支持：
  - 按字符游标分块读取，返回 `nextOffset` / `hasMore`；
  - 在完整 JSON 中搜索关键词，返回有界命中片段；
  - 严格校验 artifact 属于当前会话且 MIME 为 JSON。
- [x] 在大结果回执中明确提示模型继续读取/搜索 artifact，而不是把摘要当完整结果。
- [x] 修复供应商把内部推理误放进 `content` 时的最终消息泄露，并兼容与标点粘连的 Markdown 标题。
- [x] 对支持 `namespace` / selector 的列表工具优先使用已知最小范围；全局调用出现 5xx 时只允许基于已知范围收窄一次，不重复相同宽查询。
- [x] 覆盖以下测试：1.49 MiB 级外部 MCP 返回不再失败、完整 artifact 可还原、分块无缺口、搜索可命中尾部关键信息、跨会话不可读取、内部推理清理和标题修复。

验收标准：无分页外部 MCP 能成功完成；UI 不再显示本地 1 MiB 拒绝错误；模型可用 artifact 工具找到原结果任意位置的证据并完成回答。

## Phase 1：用户加入协作聊天

- [ ] 在协作工作区增加独立的 `chat.message` 事件类型，保留 `user`、`extension_agent`、`mcp_agent` 的真实身份。
- [ ] 为聊天事件增加 `conversationId`、`taskId`、`recipient`、`messageId`、`createdAt` 和幂等键；任务生命周期事件继续使用现有状态机。
- [ ] MCP 侧增加长轮询等待消息与回复消息工具；游标推进保证断线重连后不丢消息、不重复消费。
- [ ] 插件侧输入区增加单一收件人选择：`MCP 后端 AI` 或 `插件 AI`；第一版不提供“同时发送给双方”。
- [ ] 允许已完成任务继续聊天，但禁止聊天消息反向篡改任务终态。
- [ ] 沿用现有出站脱敏、审批、Profile / task / conversation 绑定和审计链路。

验收标准：用户消息进入独立协作上下文；目标 AI 可收到并回复；三种身份在左侧时间线中可辨认；刷新和重连后顺序、游标与归属保持正确。

## Phase 2：能力增强

- [ ] MCP 客户端明确声明 Sampling 能力时，可选用 Sampling 缩短后端 AI 回复链路；未声明时继续使用长轮询工具。
- [ ] 增加未读、等待中、失败重试和消息引用状态。
- [ ] 评估用户是否需要同时广播给两侧 AI，并增加循环次数、同一消息重复转发和自动互答上限。

## 预计改动位置

- `src/daemon/externalMcpRegistry.ts`
- `src/daemon/artifacts/externalize.ts`
- `src/mcp/wsServer.ts`
- `src/shared/mcpTools.ts`
- `src/mcp/toolRuntime.ts`
- `src/mcp/toolOutputSchemas.ts`
- `src/shared/toolPolicy.ts`
- `src/shared/mcpExecutionPolicy.ts`
- `src/shared/collaborationWorkspace.ts`
- `src/mcp/collaborationTools.ts`
- `src/mcp/collaborationTaskRuntime.ts`
- `src/sidepanel/components/ChatPanel.tsx`
- 对应 `tests/*.test.ts`

## 验证顺序

1. 大结果、artifact、MCP registry 与工具 schema 的针对性测试。
2. 协作工作区、任务运行时和侧栏时间线的针对性测试。
3. `npm run typecheck`。
4. `npm run build`。
5. Chrome 重载后的真实外部 MCP 大结果测试，以及用户参与协作聊天的端到端测试。

## 非目标

- 不要求第三方 MCP 服务器立即增加分页。
- 不永久保存 artifact；继续遵守本地保留期限和配额。
- 不把 artifact 内容暴露给其他 Profile、会话或任务。
- 不在本阶段引入新的模型供应商、依赖或独立向量数据库。
