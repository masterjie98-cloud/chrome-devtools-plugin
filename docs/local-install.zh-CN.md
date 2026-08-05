# AI DevTools Assistant 本地安装说明

本说明以 **CMD 脚手架** 为推荐本地用法（Windows / macOS 均可）：

1. **推荐：开发目录 CMD 脚手架**（`setup-local.cmd` / `.command`）：配置
   daemon / MCP，Chrome 扩展单独加载项目里的 `dist/`。
2. **可选：跨平台 zip 安装包**（`package:local`）：给不用 git 的 Windows /
   macOS 用户（解压后双击安装脚本）。

开发目录里的 LaunchAgent **不是必须的**。Release ZIP 的一键安装器则默认注册
macOS LaunchAgent 或 Windows 登录启动项，用户可用 `--no-autostart` 明确关闭。

---

## A. 开发目录：后台服务 CMD 脚手架（推荐，Win + macOS）

适用于克隆了本仓库的机器。

### 系统要求

- Node.js 20+
- Google Chrome 116+
- Windows 或 macOS（LaunchAgent 仅 macOS 可选）

### 步骤

1. 双击仓库根目录的 `setup-local.cmd`（Windows）或 `setup-local.command`
   （macOS），或执行：

   ```bash
   npm run setup:local
   ```

2. 按提示选择：是否 `npm install`、是否 `npm run build:node`（只构建
   daemon/MCP，**不含** Chrome 扩展）、是否立刻启动 daemon、是否打印 MCP
   客户端配置、是否生成 MCP 调试启动脚本。

3. 脚手架会在 `local-scripts/` 生成：

   - `启动 Daemon` / `停止 Daemon` / `查看 Daemon 状态`
   - `显示连接信息`（Token + 旁路打印扩展 `dist` 路径）
   - `显示 MCP 客户端配置`
   - （可选）`启动 MCP 调试`（`npm run mcp:dev`，仅排错）

4. **Chrome 扩展是独立步骤**（不是后台 install）：

   ```bash
   npm run build:extension   # 若还没有 dist/
   ```

   打开 `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择项目
   的 `dist/` → 用「显示连接信息」里的 Bridge Token 填入侧栏 AI 设置。

### 两个后台分别做什么

| 进程 | 命令 | 是否常开 |
|------|------|----------|
| daemon | `启动 Daemon` / `npm run daemon:start` | **要** |
| MCP adapter | Cursor/Codex 按配置拉起 `mcp:start` | 一般不手动常开；`mcp:dev` 仅调试 |

非交互默认（不弹问答、不自动开 daemon 窗口）：

```bash
npm run setup:local -- --defaults
```

### 开发目录不参与自动更新

源码开发目录由维护者显式切换版本并重新构建。daemon 不会执行 `git pull`、安装依赖或运行构建命令；设置页最多提示存在更高的正式 Release。给普通使用者升级时，请使用下文的正式 Release ZIP。

维护者发版（规范化版本 / GitHub Release）：

```bash
npm run release:dry
npm run release
```

---

## B. 跨平台 zip 安装包（Windows + macOS）

给不用 git 的可信用户：扩展走开发者模式加载，daemon 只听
`127.0.0.1:17321`。维护者本机执行：

```bash
npm run package:local
```

产物：`release/ai-devtools-assistant-local-<version>.zip`。

### 系统要求

- Windows 10+ 或 macOS
- Google Chrome 116+
- 无需预装 Node.js；ZIP 内含 macOS arm64/x64、Windows x64 便携 Node，并在打包时校验 Node 官方 SHA-256
- 必须先完整解压 zip，不要在压缩预览里直接运行

### 一键安装

**Windows**

1. 解压 zip
2. 双击 `安装 AI DevTools Assistant.cmd`
3. 安装目录默认：

   ```text
   %LOCALAPPDATA%\AI DevTools Assistant\
   ```

4. 安装器会注册 Windows 登录自启动、启动 daemon，并打印扩展路径与 Bridge Token

**macOS**

1. 解压 zip
2. 双击 `安装 AI DevTools Assistant.command`
   （若被拦截：右键 → 打开 → 仍要打开）
3. 安装目录默认：

   ```text
   ~/Library/Application Support/AI DevTools Assistant/
   ```

4. 安装器会注册 macOS LaunchAgent、后台启动 daemon，并打印扩展路径与 Bridge Token

如明确不需要登录自启动，可从终端运行安装器并追加 `--no-autostart`。

安装器不会自动改 Chrome，也不会上传 Token。

### 在 Chrome 中加载扩展

1. 打开 `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序
2. 选择安装器打印的 `extension` 目录（见上）
3. 侧栏 AI 设置填入 Bridge Token 并保存

不要把 Token 贴到聊天、日志或共享文档。每台机器用本机生成的 Token。

### 导入第三方 MCP

1. 确认 daemon 已连接，打开侧栏 `设置 → MCP`。
2. 粘贴常见的 `{"mcpServers": {...}}` JSON，点击「导入并注册」。导入后默认停用，不会立即执行命令。
3. 打开对应开关或点击「测试连接」后，daemon 才会启动 stdio `command + args` 或连接 Streamable HTTP。
4. 新对话默认使用 `MCP 自动`，只调用 `tools/list` 探测并在欢迎消息展示能力；也可在聊天顶部选择 `MCP 关闭` 或指定一个已启用 MCP。此选择仅属于当前聊天。

远程配置同时兼容 `type: "streamable-http" + url` 和常见的
`type: "streamableHttp" + baseUrl`，并支持 `description`、
`timeout`/`timeoutMs`、`disabledTools`。外部配置里的 `isActive: true` 只会标记
“配置请求启用”，不会在导入时自动连接；仍需在设置页手动确认启用。

远程 MCP 必须使用 HTTPS（`localhost` 可使用 HTTP），旧 SSE 不支持。第三方工具默认逐次请求审批；如用户在设置中明确“信任只读声明”，仅 server 声明 `readOnlyHint: true` 且没有 destructive 冲突的工具可免重复审批。审批条右侧下拉菜单还可选择“此后自动运行这个 MCP 的全部工具”：此授权按 server 隔离并由 daemon 持久化，会跳过该 server 后续读取、写入、删除和未知工具的逐次确认，直到在 `设置 → MCP` 中关闭；不会授权其他 MCP 或浏览器工具。传输类型或 HTTP GET 不能证明工具只读，server 声明也不会在未信任时自动生效。`env` 和 HTTP `headers` 仅保存在 daemon 的 0600 私有配置中，不进入 Chrome 扩展存储。导入 `npx`、`uvx` 等命令后，首次启用可能由该命令自身下载包，请只使用可信配置。

### 获取 Provider 模型列表

在 `设置 → 模型管理` 中可添加多个模型，并在聊天输入框直接切换。模型 ID 支持手动填写，也可点击「获取列表」，使用当前 API URL 和 API Key 请求 OpenAI-compatible 的 `GET /v1/models`，再选择一个或多个模型添加。填写 Provider 根地址时会分别推导 `/v1/models` 和 `/v1/chat/completions`；返回结果只用于模型选择，不会复制 API Key 到 MCP 或 localStorage。

### 查看状态 / 重新取 Token

Windows（PowerShell）：

```powershell
$aiHome = "$env:LOCALAPPDATA\AI DevTools Assistant"
& "$aiHome\runtime\node\win32-x64\node.exe" "$aiHome\runtime\daemon\status.js"
& "$aiHome\runtime\node\win32-x64\node.exe" "$aiHome\runtime\daemon\printToken.js"
```

macOS：

```bash
AI_DEVTOOLS_HOME="$HOME/Library/Application Support/AI DevTools Assistant"
NODE_TARGET="$([ "$(uname -m)" = arm64 ] && echo darwin-arm64 || echo darwin-x64)"
"$AI_DEVTOOLS_HOME/runtime/node/$NODE_TARGET/node" "$AI_DEVTOOLS_HOME/runtime/daemon/status.js"
"$AI_DEVTOOLS_HOME/runtime/node/$NODE_TARGET/node" "$AI_DEVTOOLS_HOME/runtime/daemon/printToken.js"
```

### 更新（zip 用户）

首次安装后，只要 daemon 正在运行，即可在侧栏 AI 设置中执行：

1. 点击「检查更新」；daemon 查询本项目最新正式 GitHub Release。
2. 有新版本时点击「由 Daemon 更新」。
3. daemon 只接受版本精确匹配的
   `ai-devtools-assistant-local-<version>.zip` 与 `.zip.sha256`，校验 HTTPS
   来源、大小、SHA-256、ZIP 路径和包内版本。
4. 校验成功后事务式替换 `runtime` 与 `extension`；失败会恢复旧目录。
5. daemon 自动重启。侧栏重新连接后，按提示重载扩展；已解压扩展不会像商店扩展
   一样自动刷新。

本机尚未安装 daemon 时，仍需手动下载最新 ZIP。包含自动更新器之前的旧 ZIP 也要
人工覆盖安装一次；之后即可使用上述流程。本机 Token 和 daemon 状态目录不会被
Release ZIP 覆盖。

开发目录（`git clone`）不会走应用内自动更新。

### 卸载

macOS 可先卸 LaunchAgent：

```bash
AI_DEVTOOLS_HOME="$HOME/Library/Application Support/AI DevTools Assistant"
NODE_TARGET="$([ "$(uname -m)" = arm64 ] && echo darwin-arm64 || echo darwin-x64)"
"$AI_DEVTOOLS_HOME/runtime/node/$NODE_TARGET/node" \
  "$AI_DEVTOOLS_HOME/runtime/manage-local-service.mjs" uninstall \
  --server-path "$AI_DEVTOOLS_HOME/runtime/daemon/server.js"
```

再在 Chrome 移除扩展，并删除安装目录。本机配对配置
（`~/.config/ai-devtools-assistant/` 等）不会被自动删除。

### 常见问题

**提示缺少便携 Node** — ZIP 不完整或未完整解压；重新下载 Release ZIP，不要从压缩预览中直接运行。

**daemon 未连接** — 先跑 status；不要同时起两个 daemon。

**Token 不对** — 用 `printToken.js` 覆盖扩展设置；不要从别的电脑复制。

**更新后能力没变** — `chrome://extensions` 重载扩展，并刷新目标网页。
