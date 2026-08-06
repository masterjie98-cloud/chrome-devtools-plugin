# 给宿主应用内 AI 的 MCP 接入任务

你正在替用户把本机已安装的 **AI DevTools Assistant** 注册到当前宿主应用。
用户把本文件交给你，即表示希望你完成这项本地 MCP 配置工作。不要让用户手工复制
JSON；只在缺少必要权限或无法识别宿主时询问一个最小问题。

## 完成标准

1. 识别当前操作系统、宿主应用及其官方 MCP 配置方式。
2. 读取本机生成的 `genericMcp` stdio 配置。
3. 备份并合并宿主配置，不得覆盖其他 MCP server。
4. 验证宿主已经识别 `ai-devtools`，或明确说明唯一剩余的重启步骤。

## 1. 定位安装目录

将 `INSTALL_ROOT` 设为第一个存在 `runtime/mcp/server.js` 的目录：

1. 本文件所在目录；
2. Windows：`%LOCALAPPDATA%\AI DevTools Assistant`；
3. macOS：`$HOME/Library/Application Support/AI DevTools Assistant`。

如果这些位置都不存在，停止操作并只询问用户解压或安装到了哪里。不要下载替代运行时，
不要修改 `PATH`，不要使用未经验证的系统 Node.js。

## 2. 生成本机绝对路径配置

根据平台运行一条命令。路径必须作为独立参数传递，不要把引号写进 JSON 值。

### Windows（PowerShell）

```powershell
$InstallRoot = Join-Path $env:LOCALAPPDATA "AI DevTools Assistant"
& "$InstallRoot\runtime\node\win32-x64\node.exe" `
  "$InstallRoot\runtime\print-client-config.mjs" `
  --server-path "$InstallRoot\runtime\mcp\server.js"
```

### macOS Apple Silicon

```bash
INSTALL_ROOT="$HOME/Library/Application Support/AI DevTools Assistant"
"$INSTALL_ROOT/runtime/node/darwin-arm64/node" \
  "$INSTALL_ROOT/runtime/print-client-config.mjs" \
  --server-path "$INSTALL_ROOT/runtime/mcp/server.js"
```

### macOS Intel

```bash
INSTALL_ROOT="$HOME/Library/Application Support/AI DevTools Assistant"
"$INSTALL_ROOT/runtime/node/darwin-x64/node" \
  "$INSTALL_ROOT/runtime/print-client-config.mjs" \
  --server-path "$INSTALL_ROOT/runtime/mcp/server.js"
```

输出是 JSON。读取其中的 `genericMcp`：

```json
{
  "serverName": "ai-devtools",
  "transport": "stdio",
  "command": "<本机便携 Node 的绝对路径>",
  "args": ["<runtime/mcp/server.js 的绝对路径>"],
  "env": {
    "AI_DEVTOOLS_MCP_TOOL_PROFILE": "smart"
  }
}
```

其他操作系统当前不受 Release ZIP 支持。遇到不支持的平台必须停止，不能猜测路径。

## 3. 配置当前宿主

先确定当前宿主的名称和版本，再查找其本机帮助、官方 CLI 或现有 MCP 配置。按以下优先级：

1. 宿主官方 MCP CLI 或设置 API；
2. 宿主官方 MCP 配置文件；
3. 都不存在时，说明该宿主不支持本地 stdio MCP，不要创建臆测的配置文件。

注册名使用 `ai-devtools`，transport 使用 `stdio`。把 `genericMcp.command`、
`genericMcp.args` 和 `genericMcp.env` 映射到宿主的等价字段。

修改配置文件时：

- 先解析并验证现有内容；解析失败时停止，不得覆盖。
- 创建同目录时间戳备份。
- 只新增或更新 `ai-devtools`，不得覆盖、删除或重排其他 MCP server。
- 保持宿主原有格式。若宿主使用常见的 `mcpServers` JSON 结构，只合并：

```json
{
  "mcpServers": {
    "ai-devtools": {
      "command": "<genericMcp.command>",
      "args": ["<genericMcp.args[0]>"],
      "env": {
        "AI_DEVTOOLS_MCP_TOOL_PROFILE": "smart"
      }
    }
  }
}
```

不要把尖括号占位文本原样写入配置；必须使用生成器返回的真实绝对路径。

## 4. 安全边界

- **Bridge Token 不属于 MCP 客户端配置。** 不得读取、复制或写入配置、聊天、日志或共享文件。
- 不要启动第二个 daemon。stdio MCP server 会连接安装器已启动的本地 daemon。
- 不要安装第三方客户端、修改系统策略、关闭安全功能或提升权限。
- 写权限被拒绝时，报告被拒绝的文件和所需权限，不要循环重试。

## 5. 验证并结束

优先使用宿主官方命令或 MCP 管理页确认：

1. `ai-devtools` 已出现在服务器列表中；
2. transport 为 stdio，进程没有立即退出；
3. 宿主能够列出该服务器提供的工具。

如果宿主只能在重启后加载 MCP：

- 明确告诉用户需要重启宿主或新开会话；
- 给出重启后的一个验证入口；
- 不得声称当前会话已经获得新工具。

最终只报告：修改了哪个宿主配置、备份位置、连接验证结果，以及是否需要重启。
