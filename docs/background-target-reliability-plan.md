# 后台目标页与跨域登录可靠性计划

## 目标

在不抢占用户当前 Chrome 焦点的前提下，让 MCP/插件 AI 能持续控制用户明确选择的目标 Tab；同一 Tab 经历 SPA 路由、登录域名跳转和返回后，重新绑定最新文档再继续执行。侧栏同时显示运行中任务绑定的 Tab，只有用户点击“返回”时才显式聚焦该页。

## 已确认根因

1. `debuggerAdapter` 在附加 CDP 前调用窗口聚焦和 `tab.active=true`。
2. `tabs.onUpdated` 只同步 `tab.active`，手动选择的后台目标 Tab 导航后不会及时更新 Hub 的 `navigationId`、URL 和文档。
3. 没有监听 `webNavigation.onHistoryStateUpdated` / `onReferenceFragmentUpdated`，SPA 路由后仍可能使用旧导航上下文。
4. `ConversationExecutionApproval` 对 `agent` 和 `full` 都绑定 origin，且 Hub 短暂断连会直接撤销，所以跨域登录和服务重连都会重置“完全访问权限”。

## 权限与执行边界

- `请求批准`：每个受控调用按策略询问。
- `替我审批`：绑定当前聊天、Chrome Profile、AI Provider 和 origin；跨域立即失效。
- `完全访问权限`：绑定当前聊天、Chrome Profile、AI Provider 和用户选择的目标 Tab；同一 Tab 的跨域登录跳转、文档替换和返回不失效。
- 权限模式只决定是否需要再次询问。每个实际写操作仍签发短时、一次性、精确绑定 `tabId + frameId + documentId + navigationId + revision + arguments hash` 的 execution grant。
- 旧文档的 grant 不得在新文档重放；导航后必须重新观察并基于新 target/document 执行。
- 切换聊天、Profile、AI Provider、目标 Tab或用户主动关闭模式时撤销持久授权。Hub 短暂断连只暂停执行，不静默重置用户选择。
- 每次运行创建不可复用的 `taskId`，并绑定 `conversationId + executionTabId`。MCP 调用、授权、Agent session、委托结果都必须携带或从连接上下文解析这组绑定。
- 当前架构先采用“单 Profile 单执行器、跨 Tab 任务排队”：用户可在另一个 Tab 创建新任务，但不同 Tab 的写操作不并行，避免共享 CDP/目标选择状态发生竞态。队列中的每项保留独立 task/对话/Tab 绑定。

## 实现切片

1. 移除 CDP 附加的聚焦/激活副作用，始终按稳定 `tabId` 附加。
2. 为手动选择的后台 Tab 同步 loading/complete 导航；监听 SPA history/hash 路由。
3. 导航开始清理旧 frame registry，导航完成等待 content frame 重新注册；观察操作允许一次有界恢复，写操作只重新规划、不自动重放未知结果。
4. 将对话审批结构改为显式 `scope: origin | tab`，并更新 UI 文案、自动失效逻辑和测试。
5. 增加紧凑的任务目标条：显示状态、页面标题/域名和队列数；“返回”是唯一允许主动聚焦任务 Tab 的入口。
6. 保持 daemon task grant 与 execution grant 的职责分离；普通授权可减少询问，但不能放宽精确文档执行校验。

## 验收

- 目标 Tab 在后台时，观察、点击、输入和 CDP Network 不改变用户当前活动窗口/Tab。
- 同一后台 Tab 完整导航、SPA 路由和 hash 路由后，Hub 发布新的 URL/navigation；新 target 可执行，旧 target 被拒绝。
- 用户切到其他 Tab 后，当前任务继续在原 execution Tab 执行；只有点击任务目标条的“返回”才切换焦点。
- 新 Tab 创建的后续任务拥有不同 taskId 和 executionTabId；MCP 响应不能写入另一任务或对话。
- `替我审批` 跨域失效。
- `完全访问权限` 在同一目标 Tab 的 `业务域名 -> 登录域名 -> 业务域名` 跳转中保持；换 Tab/Profile/聊天/Provider 后失效。
- 单元测试、类型检查、构建通过；真实 Chrome 回归记录前台 Tab ID 在操作前后不变。
