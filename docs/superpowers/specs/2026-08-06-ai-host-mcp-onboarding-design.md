# 宿主 AI 自动接入 MCP 设计

## 目标

在 Release ZIP 和安装目录中提供一个专门交给宿主应用内 AI 阅读的文件：
`让 AI 自动接入 MCP.md`。用户只需把该文件附加到 AI 对话或让 AI 读取它，
后续宿主识别、配置修改和连接验证由具备终端及文件权限的 AI 完成。

本功能不承诺模型能够绕过宿主权限或热加载限制。宿主不允许写配置、没有终端能力，
或必须重启才能加载 MCP 时，AI 必须明确说明剩余的最小人工步骤。

## 交付内容

1. `让 AI 自动接入 MCP.md`
   - 同时存在于 Release ZIP 根目录和固定安装目录。
   - 面向执行接入工作的 AI，而不是面向用户写操作教程。
   - 说明该文件所在目录即 AI DevTools Assistant 根目录。
2. `runtime/print-client-config.mjs`
   - 保留 Cursor、Codex、Claude Desktop 输出。
   - 增加与宿主无关的标准 stdio 描述，包括服务器名称、transport、command、
     args 和 env，供其他支持本地 stdio MCP 的宿主转换。

## AI 执行流程

文件要求宿主 AI 按以下顺序处理：

1. 确认当前操作系统、宿主应用以及是否拥有终端和配置写权限。
2. 从文件所在目录调用便携 Node 运行时执行 `runtime/print-client-config.mjs`，
   获取本机绝对路径配置；不要求系统预装 Node.js。
3. 优先使用宿主官方 CLI 或设置接口；否则定位其 MCP 配置文件。
4. 以合并方式新增或更新 `ai-devtools`，不得覆盖其他 MCP 服务器；修改现有文件前
   保留备份，并保持原配置格式。
5. 只配置 MCP stdio 进程。Bridge Token 属于扩展与 daemon 的私密连接信息，
   不得写入 MCP 配置、聊天、日志或共享文件。
6. 运行宿主支持的连接检查或工具枚举。若宿主需要重启，告知用户重启后验证，
   不声称当前会话已经获得新工具。
7. 仅在无法确定宿主配置入口、缺少写权限或宿主不支持 stdio MCP 时向用户提问。

## 平台处理

- Windows：使用 `runtime\node\win32-x64\node.exe`。
- macOS Apple Silicon：使用 `runtime/node/darwin-arm64/node`。
- macOS Intel：使用 `runtime/node/darwin-x64/node`。
- 其他平台：当前 Release ZIP 不包含对应运行时，AI 必须停止并说明不受支持，
  不得退回到未经验证的系统 Node 路径。

所有 command 和 args 都由配置生成器解析为绝对路径，避免空格、工作目录和引号差异。

## 错误与安全边界

- 配置文件不存在时，仅在宿主官方约定路径创建。
- 配置文件无法解析时不得覆盖，先向用户报告。
- 不静默安装第三方客户端、修改 PATH 或下载运行时。
- 不启动第二个 daemon；MCP server 是独立 stdio 适配器，连接现有本地 daemon。
- 宿主不支持 MCP 或不允许模型修改配置时，输出一项最小人工动作，不返回大段通用教程。

## 安装与更新

打包脚本生成 AI 接入文件并将其列入 Release 完整性校验。安装脚本把该文件复制到：

- Windows：`%LOCALAPPDATA%\AI DevTools Assistant\让 AI 自动接入 MCP.md`
- macOS：`$HOME/Library/Application Support/AI DevTools Assistant/让 AI 自动接入 MCP.md`

后续覆盖更新同步替换该文件，使接入说明与当前运行时及配置生成器保持一致。

## 测试

1. 配置生成器输出通用 stdio 描述，且 command、args 为绝对路径。
2. AI 接入文件包含宿主识别、非破坏性合并、权限失败、重启和验证要求。
3. AI 接入文件明确禁止复制 Bridge Token。
4. Release 校验要求该文件存在。
5. 安装脚本明确复制该文件到固定安装目录。
6. 全量测试、构建、重新打包、ZIP 完整性和 Windows CMD 格式继续通过。
